import { execFile } from 'node:child_process';
import { readdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

// §2.2-4 — the selfie opening.
//
// The APPROVED, snapshot-included selfie clip becomes the first seconds of the
// MP4. Two rules shape everything here:
//
//   1. The capture page has no `<video>`. A headless `<video>` seek is a
//      classic source of non-determinism (the decoder may land on a different
//      frame run to run), so the footage is turned into still PNGs by ffmpeg —
//      which decodes the same file the same way every time — and the browser
//      only ever contributes the transparent chrome that sits on top.
//   2. Nothing here reaches the published page or the approved scene. This is
//      the MP4 derivative and nothing else (§0 verdict 1).
//
// Every ffmpeg pass runs bitexact and with no metadata, so two runs of the same
// proxy produce byte-identical PNGs — which is what `openingFrames` determinism
// is actually asserted on.

/** §2.2-4: the opening is the first 2.5s of the clip, never more. */
export const OPENING_MAX_MS = 2_500;

/** The output frame, so a portrait clip fills it and a landscape one is cropped. */
export const OPENING_FRAME_WIDTH = 1080;
export const OPENING_FRAME_HEIGHT = 1920;

const BITEXACT = ['-fflags', '+bitexact', '-flags', '+bitexact'] as const;
const BASE_ARGS = ['-y', '-hide_banner', '-loglevel', 'error', ...BITEXACT] as const;

/**
 * Cover crop: scale until BOTH axes cover 1080x1920, then take the centre.
 * `force_original_aspect_ratio=increase` never letterboxes, so a frame can only
 * ever lose edges — it can never gain invented pixels.
 */
export const OPENING_SCALE_FILTER =
  `scale=${String(OPENING_FRAME_WIDTH)}:${String(OPENING_FRAME_HEIGHT)}` +
  `:force_original_aspect_ratio=increase,` +
  `crop=${String(OPENING_FRAME_WIDTH)}:${String(OPENING_FRAME_HEIGHT)}`;

/** How many frames the opening runs to, at the render's own fps. */
export function openingFrameCount(clipDurationMs: number, fps: number): number {
  const ms = Math.min(Math.max(0, clipDurationMs), OPENING_MAX_MS);
  return Math.max(0, Math.floor((ms * fps) / 1000));
}

const PASS_TIMEOUT_MS = 120_000;

async function ffmpeg(ffmpegPath: string, args: readonly string[]): Promise<void> {
  try {
    await run(ffmpegPath, [...args], {
      maxBuffer: 8 * 1024 * 1024,
      timeout: PASS_TIMEOUT_MS,
      killSignal: 'SIGKILL',
    });
  } catch (error) {
    const killed =
      typeof error === 'object' && error !== null && 'killed' in error
        ? error.killed === true
        : false;
    if (killed) {
      throw new Error(`selfie opening pass exceeded ${String(PASS_TIMEOUT_MS)}ms and was killed`);
    }
    throw error;
  }
}

/** The numbered file names each pass writes, so callers never glob blindly. */
function sequencePattern(dir: string, prefix: string, extension: string): string {
  return path.join(dir, `${prefix}-%05d.${extension}`);
}

/** Removes every numbered file a previous pass of this prefix left behind. */
async function clearSequence(dir: string, prefix: string, extension: string): Promise<void> {
  const names = await readdir(dir).catch(() => [] as string[]);
  for (const name of names) {
    if (name.startsWith(`${prefix}-`) && name.endsWith(`.${extension}`)) {
      await rm(path.join(dir, name), { force: true });
    }
  }
}

async function readSequence(
  dir: string,
  prefix: string,
  extension: string,
): Promise<readonly { readonly file: string; readonly bytes: Uint8Array }[]> {
  const names = (await readdir(dir))
    .filter((name) => name.startsWith(`${prefix}-`) && name.endsWith(`.${extension}`))
    .sort();
  const frames = [];
  for (const name of names) {
    const file = path.join(dir, name);
    frames.push({ file, bytes: new Uint8Array(await readFile(file)) });
  }
  return frames;
}

export type ExtractOpeningInput = {
  readonly ffmpegPath: string;
  /** The SILENT proxy the ingest pipeline produced, written to disk. */
  readonly videoPath: string;
  readonly fps: number;
  /** Deterministic scratch directory; the caller owns its lifetime. */
  readonly workDir: string;
  /** Deterministic file prefix, so a retry overwrites its own files. */
  readonly prefix: string;
  readonly maxMs?: number;
};

/**
 * The opening's base layer: the clip's first `maxMs`, one PNG per output frame,
 * cover-cropped to the render frame.
 *
 * PNG, not JPEG: this is the layer whose hash the determinism test compares, and
 * a lossless still cannot hide a one-bit decode difference behind quantisation.
 */
export async function extractOpeningFrames(
  input: ExtractOpeningInput,
): Promise<readonly Uint8Array[]> {
  const maxMs = Math.min(input.maxMs ?? OPENING_MAX_MS, OPENING_MAX_MS);
  // Clear the NUMBERED files, not the `%05d` pattern (which is a literal name
  // on disk and deletes nothing). A shorter second run would otherwise leave
  // its predecessor's tail behind, and the `prefix-*.png` read below would
  // splice frames from the previous clip onto this one.
  await clearSequence(input.workDir, input.prefix, 'png');
  await ffmpeg(input.ffmpegPath, [
    ...BASE_ARGS,
    '-i',
    input.videoPath,
    '-t',
    (maxMs / 1000).toFixed(3),
    '-vf',
    `fps=${String(input.fps)},${OPENING_SCALE_FILTER}`,
    // Frames as the filter produced them: no duplication, no drop heuristics.
    '-fps_mode',
    'passthrough',
    '-frames:v',
    String(openingFrameCount(maxMs, input.fps)),
    '-map_metadata',
    '-1',
    '-f',
    'image2',
    sequencePattern(input.workDir, input.prefix, 'png'),
  ]);
  const frames = await readSequence(input.workDir, input.prefix, 'png');
  return frames.map((frame) => frame.bytes);
}

export type CompositeOpeningInput = {
  readonly ffmpegPath: string;
  /** The extracted selfie stills, in output order. */
  readonly basePaths: readonly string[];
  /** The transparent chrome captures, same length and same order. */
  readonly overlayPaths: readonly string[];
  readonly workDir: string;
  readonly prefix: string;
  readonly jpegQuality: number;
};

/**
 * Chrome over selfie, one ffmpeg `overlay` pass over two PNG sequences, encoded
 * to the same MJPEG the capture path pipes. The result is the opening exactly as
 * it will appear — the encoder downstream cannot tell it from a screenshot.
 */
export async function compositeOpeningFrames(
  input: CompositeOpeningInput,
): Promise<readonly Uint8Array[]> {
  if (input.basePaths.length !== input.overlayPaths.length) {
    throw new Error(
      `selfie opening has ${String(input.basePaths.length)} frames but ${String(
        input.overlayPaths.length,
      )} chrome frames`,
    );
  }
  if (input.basePaths.length === 0) {
    return [];
  }
  await clearSequence(input.workDir, input.prefix, 'jpg');
  const basePattern = input.basePaths[0]?.replace(/-\d{5}\.png$/, '-%05d.png') ?? '';
  const overlayPattern = input.overlayPaths[0]?.replace(/-\d{5}\.png$/, '-%05d.png') ?? '';
  await ffmpeg(input.ffmpegPath, [
    ...BASE_ARGS,
    '-start_number',
    '1',
    '-i',
    basePattern,
    '-start_number',
    '1',
    '-i',
    overlayPattern,
    '-filter_complex',
    // The chrome carries alpha; `format=auto` keeps ffmpeg from flattening it
    // to yuv before the blend and losing the anti-aliased edges.
    '[0:v][1:v]overlay=0:0:format=auto:eof_action=pass[out]',
    '-map',
    '[out]',
    '-frames:v',
    String(input.basePaths.length),
    '-c:v',
    'mjpeg',
    '-q:v',
    String(mjpegQualityScale(input.jpegQuality)),
    '-pix_fmt',
    'yuvj420p',
    '-map_metadata',
    '-1',
    '-f',
    'image2',
    sequencePattern(input.workDir, input.prefix, 'jpg'),
  ]);
  const frames = await readSequence(input.workDir, input.prefix, 'jpg');
  if (frames.length !== input.basePaths.length) {
    throw new Error(
      `selfie opening composite produced ${String(frames.length)} of ${String(
        input.basePaths.length,
      )} frames`,
    );
  }
  return frames.map((frame) => frame.bytes);
}

/**
 * Puppeteer's 0-100 JPEG quality onto ffmpeg's 1-31 qscale (1 = best). Kept as
 * one named conversion so the opening cannot silently be coarser than the
 * frames it is spliced onto.
 */
export function mjpegQualityScale(jpegQuality: number): number {
  const clamped = Math.min(100, Math.max(1, Math.round(jpegQuality)));
  return Math.min(31, Math.max(1, Math.round(((100 - clamped) * 30) / 99) + 1));
}
