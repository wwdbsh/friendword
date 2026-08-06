import { readFile as readFileAsync } from 'node:fs/promises';

// The bench's memory instrument (T013). The T002 verdict is "peak ≤ 80% of the
// 2048MB instance budget", and that verdict is only meaningful if the number
// counts the CHILDREN: a render pass is Node plus a headless Chromium plus
// ffmpeg, and Node's own maxRSS sees none of them. The first production bench
// answered `self-maxrss` — cgroup v2's memory.peak is not exposed on Vercel —
// so the verdict could not be reached at all.
//
// Hence a chain, ordered most to least trustworthy, with the source reported
// honestly so a reader never mistakes an approximation for a kernel high-water
// mark:
//
//   1. cgroup-v2-peak              /sys/fs/cgroup/memory.peak
//      The kernel's own maximum — what the OOM killer enforces. Exact.
//   2. cgroup-v2-current-sampled   /sys/fs/cgroup/memory.current, polled
//      memory.peak can be absent while memory.current is readable. Polling it
//      across the pass gives the maximum OBSERVED, which can miss a spike
//      between samples: an approximation, and `sampled` says so.
//   3. cgroup-v1-max-usage         /sys/fs/cgroup/memory/memory.max_usage_in_bytes
//      The v1 equivalent of memory.peak. Exact where the host is still v1.
//   4. self-maxrss                 process.resourceUsage().maxRSS
//      Last resort: this Node process ALONE. Children excluded.
//
// Every attempt is reported in `probes` so the next bench shows which fallback
// actually answered on this platform instead of leaving it to be guessed
// again. Probe details carry a path, an outcome and a byte count — no file
// contents beyond the number, and nothing user-derived: this route touches no
// user data at all.

export const MEMORY_PATHS = {
  cgroupV2Peak: '/sys/fs/cgroup/memory.peak',
  cgroupV2Current: '/sys/fs/cgroup/memory.current',
  cgroupV1MaxUsage: '/sys/fs/cgroup/memory/memory.max_usage_in_bytes',
} as const;

export type MemorySource =
  'cgroup-v2-peak' | 'cgroup-v2-current-sampled' | 'cgroup-v1-max-usage' | 'self-maxrss';

/** What one source was asked, and what it answered. */
export type MemoryProbe = {
  readonly path: string;
  readonly ok: boolean;
  /** 'ok', an errno code ('ENOENT'), 'unparsable', or a sampling summary. */
  readonly detail: string;
};

export type MemoryReading = {
  readonly bytes: number;
  readonly source: MemorySource;
  /** true when `bytes` is a polled maximum, not a kernel-tracked peak. */
  readonly sampled: boolean;
  /** Successful memory.current reads taken during the pass. */
  readonly samples: number;
  readonly probes: readonly MemoryProbe[];
};

export type MemorySamplerOptions = {
  /** Poll period for memory.current. 0 disables the timer (tests drive it). */
  readonly intervalMs?: number;
  readonly readFile?: (path: string) => Promise<string>;
  readonly maxRssBytes?: () => number;
};

export type MemorySampler = {
  /** Take one memory.current reading now; the timer calls this too. */
  sampleNow(): Promise<void>;
  /** Stop polling. Idempotent, and always safe to call twice. */
  stop(): void;
  /** Stop, take a final sample, then resolve the chain above. */
  read(): Promise<MemoryReading>;
};

/**
 * 750ms: ~360 one-line procfs reads across the 270s worst-case pass. The cost
 * is unmeasurable next to a 1,845-frame capture, and the window is short
 * enough that a transient allocation spike is unlikely to hide entirely
 * between two samples.
 */
const DEFAULT_INTERVAL_MS = 750;

function errorDetail(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code: unknown = error.code;
    if (typeof code === 'string') {
      return code;
    }
  }
  return error instanceof Error ? error.name : 'unknown';
}

/**
 * Sampling and the one-shot reads must never take the bench down: a missing or
 * unreadable file is a probe entry, not an exception.
 */
async function readBytes(
  readFile: (path: string) => Promise<string>,
  path: string,
): Promise<{ bytes: number | null; detail: string }> {
  try {
    const parsed = Number.parseInt((await readFile(path)).trim(), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return { bytes: null, detail: 'unparsable' };
    }
    return { bytes: parsed, detail: 'ok' };
  } catch (error) {
    return { bytes: null, detail: errorDetail(error) };
  }
}

/**
 * Start watching memory. Bench-only by construction: render-run's worker never
 * calls this, so the poll cannot cost a real render anything.
 */
export function startMemorySampler(options: MemorySamplerOptions = {}): MemorySampler {
  const readFile = options.readFile ?? ((path: string) => readFileAsync(path, 'utf8'));
  const maxRssBytes = options.maxRssBytes ?? (() => process.resourceUsage().maxRSS * 1024);
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;

  let sampledMax = 0;
  let samples = 0;
  let sampleFailures = 0;
  let lastFailure = '';
  let inFlight = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  const sampleNow = async (): Promise<void> => {
    if (inFlight) {
      // A previous read has not returned; skipping keeps the poll bounded.
      return;
    }
    inFlight = true;
    try {
      const reading = await readBytes(readFile, MEMORY_PATHS.cgroupV2Current);
      if (reading.bytes === null) {
        sampleFailures += 1;
        lastFailure = reading.detail;
        return;
      }
      samples += 1;
      sampledMax = Math.max(sampledMax, reading.bytes);
    } finally {
      inFlight = false;
    }
  };

  const stop = (): void => {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };

  if (intervalMs > 0) {
    timer = setInterval(() => {
      void sampleNow();
    }, intervalMs);
    // Never hold the process open for a poll.
    if (typeof timer === 'object' && 'unref' in timer && typeof timer.unref === 'function') {
      timer.unref();
    }
  }

  const read = async (): Promise<MemoryReading> => {
    stop();
    await sampleNow();

    const peak = await readBytes(readFile, MEMORY_PATHS.cgroupV2Peak);
    const v1 = await readBytes(readFile, MEMORY_PATHS.cgroupV1MaxUsage);
    const samplingDetail =
      samples > 0
        ? `${samples} samples, ${sampleFailures} failed, max ${sampledMax}`
        : `no samples, ${sampleFailures} failed${lastFailure === '' ? '' : ` (${lastFailure})`}`;
    const probes: readonly MemoryProbe[] = [
      { path: MEMORY_PATHS.cgroupV2Peak, ok: peak.bytes !== null, detail: peak.detail },
      { path: MEMORY_PATHS.cgroupV2Current, ok: samples > 0, detail: samplingDetail },
      { path: MEMORY_PATHS.cgroupV1MaxUsage, ok: v1.bytes !== null, detail: v1.detail },
    ];

    if (peak.bytes !== null) {
      return { bytes: peak.bytes, source: 'cgroup-v2-peak', sampled: false, samples, probes };
    }
    if (sampledMax > 0) {
      return {
        bytes: sampledMax,
        source: 'cgroup-v2-current-sampled',
        sampled: true,
        samples,
        probes,
      };
    }
    if (v1.bytes !== null) {
      return { bytes: v1.bytes, source: 'cgroup-v1-max-usage', sampled: false, samples, probes };
    }
    return { bytes: maxRssBytes(), source: 'self-maxrss', sampled: false, samples, probes };
  };

  return { sampleNow, stop, read };
}
