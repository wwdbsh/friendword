import { execFile } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { resolveFfmpegPath, resolveFfprobePath } from './binaries';
import { CLIP_MAX_SOURCE_DURATION_MS, CLIP_PROBE_DURATION_TOLERANCE_MS } from './probe';

const execFileAsync = promisify(execFile);

/** The proxy's fixed portrait geometry (plan §3.2): one normalized artifact. */
export const PROXY_WIDTH = 1080;
export const PROXY_HEIGHT = 1920;
export const PROXY_FPS = 30;
export const PROXY_GOP = 15;

/**
 * Output-side hard cut (`-t`): the proxy can never carry more footage than the
 * 15s cap, even when the SOURCE container's mvhd/tkhd/mdhd were patched to
 * claim a short duration (a 30s clip probing at 4.8s sailed past the probe;
 * only its first 15 sampled frames were ever moderated). The proxy is then
 * re-probed and that measured duration — never the source's claim — is what
 * the pipeline records and checks moderation coverage against.
 */
export const PROXY_MAX_DURATION_SECONDS = CLIP_MAX_SOURCE_DURATION_MS / 1000;

/** The longest a produced proxy may measure before the ingest refuses it. */
export const PROXY_MAX_MEASURED_DURATION_MS =
  CLIP_MAX_SOURCE_DURATION_MS + CLIP_PROBE_DURATION_TOLERANCE_MS;

/**
 * How many frames frame moderation samples at 1fps, on top of the poster.
 * A 15s source can never produce more.
 */
export const MAX_MODERATION_FRAMES = 15;

/** Moderation/detection frames are downscaled; the boxes are normalized, so the scale cancels out. */
const FRAME_WIDTH = 512;

/**
 * The silent-proxy argument list, exported so the audit tests can pin the two
 * arguments that carry a privacy promise: `-an` (the proxy has NO audio stream —
 * asserted again with ffprobe after every transcode) and `-map_metadata -1`
 * (GPS and capture metadata do not survive into a derivative that outlives the
 * original). `-threads 2` keeps the measured memory profile: the feasibility
 * run showed unbounded threads peaking at 1.29GB on 4K HEVC vs 362MB at 2.
 */
export function buildSilentProxyArgs(inputPath: string, outputPath: string): readonly string[] {
  return [
    '-y',
    '-threads',
    '2',
    '-i',
    inputPath,
    '-vf',
    `scale=${PROXY_WIDTH}:${PROXY_HEIGHT}:force_original_aspect_ratio=increase,crop=${PROXY_WIDTH}:${PROXY_HEIGHT},fps=${PROXY_FPS}`,
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '23',
    '-g',
    String(PROXY_GOP),
    '-an',
    '-map_metadata',
    '-1',
    '-movflags',
    '+faststart',
    '-pix_fmt',
    'yuv420p',
    '-t',
    String(PROXY_MAX_DURATION_SECONDS),
    '-threads',
    '2',
    outputPath,
  ];
}

export async function transcodeToSilentProxy(inputPath: string, outputPath: string): Promise<void> {
  await execFileAsync(resolveFfmpegPath(), [...buildSilentProxyArgs(inputPath, outputPath)], {
    maxBuffer: 4 * 1024 * 1024,
  });
}

export type ProxyStreamFacts = {
  readonly audioStreams: number;
  readonly width: number;
  readonly height: number;
  /** Measured from the PRODUCED artifact, the pipeline's only duration authority. */
  readonly durationMs: number;
};

/** ffprobe's read of a produced proxy — the evidence behind the silence and duration claims. */
export async function probeProxyStreams(proxyPath: string): Promise<ProxyStreamFacts> {
  const { stdout } = await execFileAsync(
    resolveFfprobePath(),
    [
      '-v',
      'error',
      '-show_entries',
      'stream=codec_type,width,height:format=duration',
      '-of',
      'json',
      proxyPath,
    ],
    { maxBuffer: 1024 * 1024 },
  );
  const parsed = JSON.parse(stdout) as {
    readonly streams?: readonly {
      readonly codec_type?: string;
      readonly width?: number;
      readonly height?: number;
    }[];
    readonly format?: { readonly duration?: string };
  };
  const streams = parsed.streams ?? [];
  const video = streams.find((stream) => stream.codec_type === 'video');
  const durationSeconds = Number(parsed.format?.duration);
  return {
    audioStreams: streams.filter((stream) => stream.codec_type === 'audio').length,
    width: video?.width ?? 0,
    height: video?.height ?? 0,
    durationMs: Number.isFinite(durationSeconds) ? Math.round(durationSeconds * 1000) : 0,
  };
}

/**
 * Refuses to hand a proxy onward unless ffprobe confirms the audio stream count
 * is ZERO, the geometry is the pinned portrait frame, and the MEASURED duration
 * sits inside the 15s cap (plus the probe's rounding tolerance). Belt to the
 * `-an`/`-t` suspenders: a build where the argument list regressed produces
 * proxies that fail here, not proxies that publish the introducer's kitchen
 * conversation or footage that outlived its moderation sampling. Returns the
 * measured facts so the caller records the artifact's real duration, never the
 * source container's claim.
 */
export async function assertSilentProxy(proxyPath: string): Promise<ProxyStreamFacts> {
  const facts = await probeProxyStreams(proxyPath);
  if (facts.audioStreams !== 0) {
    throw new Error(`proxy carries ${facts.audioStreams} audio stream(s); it must carry none`);
  }
  if (facts.width !== PROXY_WIDTH || facts.height !== PROXY_HEIGHT) {
    throw new Error(
      `proxy is ${facts.width}x${facts.height}; expected ${PROXY_WIDTH}x${PROXY_HEIGHT}`,
    );
  }
  if (facts.durationMs <= 0) {
    throw new Error('the proxy duration could not be measured');
  }
  if (facts.durationMs > PROXY_MAX_MEASURED_DURATION_MS) {
    throw new Error(
      `proxy measures ${facts.durationMs}ms; the ceiling is ${PROXY_MAX_MEASURED_DURATION_MS}ms`,
    );
  }
  return facts;
}

/** First proxy frame as a JPEG poster. */
export async function extractPoster(proxyPath: string, posterPath: string): Promise<void> {
  await execFileAsync(
    resolveFfmpegPath(),
    ['-y', '-i', proxyPath, '-frames:v', '1', '-q:v', '3', posterPath],
    { maxBuffer: 4 * 1024 * 1024 },
  );
}

/**
 * 1fps JPEG samples for frame moderation and face detection, at most
 * MAX_MODERATION_FRAMES. Returns the produced file paths in frame order.
 */
export async function extractModerationFrames(
  proxyPath: string,
  framesDir: string,
): Promise<readonly string[]> {
  await execFileAsync(
    resolveFfmpegPath(),
    [
      '-y',
      '-i',
      proxyPath,
      '-vf',
      `fps=1,scale=${FRAME_WIDTH}:-2`,
      '-frames:v',
      String(MAX_MODERATION_FRAMES),
      '-q:v',
      '4',
      join(framesDir, 'frame_%02d.jpg'),
    ],
    { maxBuffer: 4 * 1024 * 1024 },
  );
  const entries = await readdir(framesDir);
  return entries
    .filter((name) => /^frame_\d{2}\.jpg$/.test(name))
    .sort()
    .map((name) => join(framesDir, name));
}
