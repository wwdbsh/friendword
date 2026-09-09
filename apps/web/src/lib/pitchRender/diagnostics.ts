import type { ChildProcess } from 'node:child_process';

// Instrumentation for render failures we can only ever observe REMOTELY.
//
// The first linux (Vercel) bench answered `{"error":"NetworkError: A network
// error occurred."}` and nothing else: the puppeteer<->Chromium socket had
// dropped, which says the browser process died but not WHEN, not WHY, and not
// whether the self-extracted binary was even intact. This module holds the
// pieces that make the next 500 answer those questions — a stage marker, a
// bounded error detail, a bounded stderr tail, and the pre-launch probe shape.
//
// It is DIAGNOSTIC ONLY: nothing here participates in what a rendered file
// looks like, and every consumer wires it in behind an optional sink so the
// render path with no sink behaves exactly as it did before.

/**
 * Every variable-length field that can reach a response has an explicit
 * ceiling. A Chromium crash dump or a runaway message must never BE the
 * response body — a 500 that cannot be delivered diagnoses nothing.
 */
export const DIAGNOSTIC_LIMITS = {
  errorMessageBytes: 2_000,
  errorStackBytes: 4_000,
  stderrTailBytes: 16_000,
  launchArgsBytes: 2_000,
} as const;

/**
 * Where a render pass was when it died. Ordered as the pipeline runs them, and
 * deliberately coarse: each stage is a different suspect list.
 */
export type RenderStage =
  | 'input-synthesis'
  | 'scene-prepare'
  /** §2.2-2: cut, fade and (optionally) mix the derivative audio track. */
  | 'audio-build'
  | 'browser-launch'
  | 'page-goto'
  | 'harness-ready'
  | 'payload-load'
  | 'capture'
  | 'encode'
  | 'output-read';

export type StageRecorder = (stage: RenderStage) => void;

export type StageTracker = {
  /** The most recently ENTERED stage — i.e. the one in flight on a throw. */
  readonly current: () => RenderStage;
  readonly mark: StageRecorder;
};

export function createStageTracker(initial: RenderStage): StageTracker {
  let current: RenderStage = initial;
  return {
    current: () => current,
    mark: (stage) => {
      current = stage;
    },
  };
}

export type TruncatedText = {
  readonly text: string;
  /** Size of the ORIGINAL value, so a reader knows how much was dropped. */
  readonly totalBytes: number;
  readonly truncated: boolean;
};

/** Largest cut at or below `maxBytes` that lands on a UTF-8 lead byte. */
function boundaryBefore(bytes: Buffer, maxBytes: number): number {
  let cut = Math.min(maxBytes, bytes.byteLength);
  while (cut > 0) {
    const byte = bytes[cut];
    if (byte === undefined || (byte & 0xc0) !== 0x80) {
      break;
    }
    cut -= 1;
  }
  return cut;
}

/** First offset in `bytes` that is not a stranded UTF-8 continuation byte. */
function boundaryAfter(bytes: Buffer): number {
  let start = 0;
  while (start < bytes.byteLength) {
    const byte = bytes[start];
    if (byte === undefined || (byte & 0xc0) !== 0x80) {
      break;
    }
    start += 1;
  }
  return start;
}

/**
 * Cap a string at a BYTE ceiling (the thing a response size actually costs),
 * never splitting a character — a diagnostic full of replacement glyphs is a
 * diagnostic nobody trusts.
 */
export function truncateUtf8(value: string, maxBytes: number): TruncatedText {
  const bytes = Buffer.from(value, 'utf8');
  if (bytes.byteLength <= maxBytes) {
    return { text: value, totalBytes: bytes.byteLength, truncated: false };
  }
  return {
    text: bytes.subarray(0, boundaryBefore(bytes, maxBytes)).toString('utf8'),
    totalBytes: bytes.byteLength,
    truncated: true,
  };
}

export type StderrTail = {
  readonly append: (chunk: Uint8Array) => void;
  readonly read: () => TruncatedText;
};

/**
 * A ring of the LAST `maxBytes` of a stream. The tail is the half that matters:
 * a Chromium process that dies prints its reason last.
 */
export function createStderrTail(maxBytes: number): StderrTail {
  let kept = Buffer.alloc(0);
  let totalBytes = 0;
  return {
    append: (chunk) => {
      totalBytes += chunk.byteLength;
      const merged = Buffer.concat([kept, Buffer.from(chunk)]);
      kept = merged.byteLength > maxBytes ? merged.subarray(merged.byteLength - maxBytes) : merged;
    },
    read: () => ({
      text: kept.subarray(boundaryAfter(kept)).toString('utf8'),
      totalBytes,
      truncated: totalBytes > kept.byteLength,
    }),
  };
}

export type ErrorDetail = {
  readonly name: string;
  readonly message: string;
  readonly stack: string | null;
  readonly truncated: boolean;
};

/**
 * `error.message` alone was what production had, and it was not enough. The
 * name separates a TimeoutError from a ProtocolError, and the stack names the
 * call site — both bounded, and neither invented for a non-Error throw.
 */
export function describeError(error: unknown, fallbackMessage: string): ErrorDetail {
  if (!(error instanceof Error)) {
    return { name: 'NonError', message: fallbackMessage, stack: null, truncated: false };
  }
  const message = truncateUtf8(error.message, DIAGNOSTIC_LIMITS.errorMessageBytes);
  const stack =
    error.stack === undefined ? null : truncateUtf8(error.stack, DIAGNOSTIC_LIMITS.errorStackBytes);
  return {
    name: truncateUtf8(error.name, 200).text,
    message: message.text,
    stack: stack === null ? null : stack.text,
    truncated: message.truncated || (stack?.truncated ?? false),
  };
}

/**
 * What the launch attempt looked like from OUTSIDE the browser, collected
 * before puppeteer is asked for anything. On linux the binary is self-extracted
 * to /tmp on first use, so its presence, its size and the remaining /tmp
 * headroom are the first three suspects when a launch dies; `headless` and
 * `args` are the next two, because a headless mode paired with the wrong build
 * fails exactly like a corrupt binary.
 */
export type LaunchProbe = {
  readonly mode: 'sparticuz-linux' | 'local';
  readonly platform: string;
  readonly executablePath: string | null;
  readonly executableExists: boolean;
  readonly executableBytes: number | null;
  /** Octal permission bits: a binary without +x cannot launch. */
  readonly executableMode: string | null;
  readonly statError: string | null;
  readonly resolveError: string | null;
  readonly tmpDir: string;
  readonly tmpFreeBytes: number | null;
  readonly tmpTotalBytes: number | null;
  readonly headless: string;
  readonly argCount: number;
  readonly args: string;
  readonly argsTruncated: boolean;
};

export type BrowserExit = {
  readonly code: number | null;
  /** SIGKILL here is the OOM killer's signature; SIGSEGV is a crash. */
  readonly signal: string | null;
};

export type LaunchDiagnostics = {
  readonly onProbe?: (probe: LaunchProbe) => void;
  readonly onStderr?: (chunk: Uint8Array) => void;
  readonly onExit?: (exit: BrowserExit) => void;
};

export type RenderDiagnostics = {
  readonly onStage?: StageRecorder;
  readonly launch?: LaunchDiagnostics;
};

/**
 * Tap a launched browser process. Puppeteer already spawns Chromium with piped
 * stdio and drains stderr itself, so an extra listener adds a reader and
 * changes no launch flag — the measured pass stays the pass being measured.
 * Attached only when a sink asks for it.
 */
export function collectProcessDiagnostics(child: ChildProcess, sink: LaunchDiagnostics): void {
  const { onStderr, onExit } = sink;
  const stderr = child.stderr;
  if (onStderr !== undefined && stderr !== null) {
    stderr.on('data', (chunk: unknown) => {
      if (typeof chunk === 'string') {
        onStderr(Buffer.from(chunk, 'utf8'));
      } else if (chunk instanceof Uint8Array) {
        onStderr(chunk);
      }
    });
  }
  if (onExit !== undefined) {
    child.once('exit', (code, signal) => {
      onExit({ code, signal });
    });
  }
}
