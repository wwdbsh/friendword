import { spawn } from 'node:child_process';
import { once } from 'node:events';

// FFmpeg is the ENCODER here, never a compositor (2026-07-29 architecture).
// Frames arrive as JPEG bytes over stdin (image2pipe) so nothing is ever
// staged on disk (P1) — /tmp holds only the audio input and the output file.

/** Audio containers whose product path already carries AAC (validate/route.ts). */
const AAC_MIME_TYPES = new Set(['audio/mp4', 'audio/aac', 'audio/x-m4a', 'audio/m4a']);

export function audioFileExtension(mimeType: string): string {
  const base = mimeType.split(';')[0]?.trim().toLowerCase() ?? '';
  switch (base) {
    case 'audio/mp4':
    case 'audio/x-m4a':
    case 'audio/m4a':
      return 'm4a';
    case 'audio/aac':
      return 'aac';
    case 'audio/mpeg':
      return 'mp3';
    case 'audio/webm':
      return 'webm';
    case 'audio/ogg':
      return 'ogg';
    case 'audio/wav':
    case 'audio/x-wav':
      return 'wav';
    default:
      return 'bin';
  }
}

/** §2.2-7: the derivative track is delivered at a fixed, modest AAC bitrate. */
export const DERIVATIVE_AUDIO_BITRATE = '128k';

/**
 * The web page is the ORIGINAL, the MP4 is a DERIVATIVE (decision 2026-09-09,
 * REEL_V3_DESIGN §0 verdict 3).
 *
 * On the LEGACY path — full variant, music off, or RENDER_HIGHLIGHT_ENABLED=0 —
 * nothing has touched the waveform, and this behaves exactly as P5 always
 * demanded: an AAC stream is copied bit-for-bit, anything else is
 * codec-transcoded and nothing more. No loudnorm, no tempo, no fades.
 *
 * On the highlight/music path `audio.ts` has already produced a new WAV (cut,
 * faded at the cuts, and optionally mixed with the generated bed), so a copy is
 * impossible and the codec has to encode. The published PAGE still streams the
 * Introducer's recording as stored; nothing on that path passes through here.
 */
export function audioCodecArgs(mimeType: string, audioTouched = false): readonly string[] {
  if (audioTouched) {
    return ['-c:a', 'aac', '-b:a', DERIVATIVE_AUDIO_BITRATE];
  }
  const base = mimeType.split(';')[0]?.trim().toLowerCase() ?? '';
  return AAC_MIME_TYPES.has(base) ? ['-c:a', 'copy'] : ['-c:a', 'aac', '-b:a', '160k'];
}

export type EncoderArgsInput = {
  readonly fps: number;
  /** Null renders a silent video (a scene with no recording is not exported today, but the encoder must not invent audio). */
  readonly audioPath: string | null;
  readonly audioMimeType: string | null;
  readonly outputPath: string;
  /**
   * True once audio.ts has cut, faded or mixed the track. Two consequences,
   * both deliberate: the audio is re-encoded rather than copied, and the muxer
   * runs bitexact so two runs of the same derivative produce the same bytes
   * (§0 verdict 6). False leaves the argv byte-identical to the legacy one.
   */
  readonly audioTouched?: boolean;
};

/**
 * The full ffmpeg argv. Deliberately WITHOUT `-shortest`: the end card frames
 * extend the video past the audio's end, and the audio simply ends — silence by
 * absence, never a stretched or truncated waveform (P4/P5). Pinned by
 * tests-render/encoderArgs.render.test.ts.
 */
export function buildEncoderArgs(input: EncoderArgsInput): readonly string[] {
  const { fps, audioPath, audioMimeType, outputPath } = input;
  const audioTouched = input.audioTouched === true;
  return [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'image2pipe',
    '-framerate',
    String(fps),
    '-c:v',
    'mjpeg',
    '-i',
    'pipe:0',
    ...(audioPath === null ? [] : ['-i', audioPath]),
    '-map',
    '0:v',
    ...(audioPath === null ? [] : ['-map', '1:a']),
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '20',
    // Pinned, not auto: x264 allocates per-thread frame buffers (measured
    // 2026-08-03: default threading on a 10-core host peaked ffmpeg at 651MB
    // RSS vs a 1,638MB function budget shared with Chromium), and the deploy
    // target has 1-2 vCPUs anyway. A fixed count also keeps the encoded bytes
    // machine-independent (P7).
    '-threads',
    '2',
    // sRGB screenshots into the BT.709 video the vertical platforms expect,
    // with the conversion done explicitly instead of tagging mismatched frames.
    '-vf',
    'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p',
    '-color_primaries',
    'bt709',
    '-color_trc',
    'bt709',
    '-colorspace',
    'bt709',
    '-r',
    String(fps),
    ...(audioPath === null || audioMimeType === null
      ? []
      : audioCodecArgs(audioMimeType, audioTouched)),
    // Reproducibility for the derivative only: adding these to the legacy path
    // would change bytes that a released render already has.
    ...(audioTouched ? ['-fflags', '+bitexact', '-flags', '+bitexact'] : []),
    '-movflags',
    '+faststart',
    outputPath,
  ];
}

export type FrameSink = {
  /** Streams one encoded frame, awaiting stdin drain under backpressure (P1). */
  readonly write: (frame: Uint8Array) => Promise<void>;
  readonly end: () => void;
};

export type Encoder = {
  readonly sink: FrameSink;
  /** Resolves on clean exit; rejects with ffmpeg's stderr on failure. */
  readonly done: Promise<void>;
};

export function startEncoder(ffmpegPath: string, args: readonly string[]): Encoder {
  const child = spawn(ffmpegPath, [...args], { stdio: ['pipe', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    // Keep the tail: on failure the last lines carry the actual cause.
    stderr = (stderr + chunk).slice(-8_192);
  });

  let exited = false;
  const done = new Promise<void>((resolve, reject) => {
    child.on('error', (error) => {
      exited = true;
      reject(new Error(`ffmpeg failed to start: ${error.message}`));
    });
    child.on('close', (code) => {
      exited = true;
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`ffmpeg exited with code ${String(code)}: ${stderr.trim()}`));
      }
    });
  });
  // An encoder that dies mid-stream must fail the render, not the process:
  // stdin EPIPE surfaces through `done` above once ffmpeg closes.
  child.stdin.on('error', () => undefined);

  const sink: FrameSink = {
    write: async (frame) => {
      if (exited) {
        throw new Error('ffmpeg is no longer running; see encoder error');
      }
      if (!child.stdin.write(frame)) {
        await once(child.stdin, 'drain');
      }
    },
    end: () => child.stdin.end(),
  };
  return { sink, done };
}
