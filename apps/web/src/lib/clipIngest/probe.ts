import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { promisify } from 'node:util';

import { resolveFfprobePath } from './binaries';

const execFileAsync = promisify(execFile);

/**
 * Longest source clip the pipeline accepts (user cap 2026-07-30, U8-U11):
 * 15 seconds. The DB CHECK on pitch_video_ingests.duration_ms is `<= 15000`,
 * so this constant and the schema state the same fact.
 */
export const CLIP_MAX_SOURCE_DURATION_MS = 15_000;

/**
 * A capture stopped at "15 seconds" routinely probes at 15.0x seconds (encoder
 * padding, container rounding). Refusing those would refuse the cap itself, so
 * the probe tolerates half a second and the stored duration_ms is clamped to
 * the cap — a scene window checked against min(actual, 15000) can never point
 * past real footage. A 16-second clip stays a refusal.
 */
export const CLIP_PROBE_DURATION_TOLERANCE_MS = 500;

const DEFAULT_VIDEO_MAX_BYTES = 52_428_800;

/**
 * Server-authoritative upload ceiling for one clip. The mobile picker mirrors
 * the default (DEFAULT_CLIP_MAX_BYTES) but this value — the env, not the
 * client — is what refuses a file.
 */
export function videoMaxBytes(env: Record<string, string | undefined> = process.env): number {
  const raw = Number(env.FRIENDWORD_VIDEO_MAX_BYTES);
  return Number.isInteger(raw) && raw > 0 ? raw : DEFAULT_VIDEO_MAX_BYTES;
}

/** Containers the probe accepts, as ffprobe names them inside format_name. */
const ALLOWED_CONTAINERS = ['mp4', 'mov'] as const;
/** Codecs the probe accepts for the single video stream it requires. */
const ALLOWED_VIDEO_CODECS = ['h264', 'hevc'] as const;

export type ClipProbeResult =
  | {
      readonly ok: true;
      /** Source duration, clamped to the 15s cap (see tolerance note above). */
      readonly durationMs: number;
      readonly width: number;
      readonly height: number;
      readonly videoCodec: string;
      readonly byteSize: number;
    }
  | { readonly ok: false; readonly reason: string };

type FfprobeOutput = {
  readonly streams?: readonly {
    readonly codec_type?: string;
    readonly codec_name?: string;
    readonly width?: number;
    readonly height?: number;
  }[];
  readonly format?: {
    readonly format_name?: string;
    readonly duration?: string;
  };
};

/**
 * The ingest gatekeeper: re-reads the real bytes with the bundled ffprobe and
 * refuses everything outside the pinned allowlist — container not mp4/mov,
 * codec not H.264/HEVC, longer than 15s, or larger than the env byte cap. The
 * client's picker mirrors these caps but is never trusted; a refusal here fails
 * the ingest with the reason recorded on the row.
 */
export async function probeClipFile(
  filePath: string,
  options: { readonly maxBytes?: number } = {},
): Promise<ClipProbeResult> {
  const maxBytes = options.maxBytes ?? videoMaxBytes();

  let byteSize: number;
  try {
    byteSize = (await stat(filePath)).size;
  } catch {
    return { ok: false, reason: 'the uploaded clip could not be read' };
  }
  if (byteSize > maxBytes) {
    return {
      ok: false,
      reason: `the clip is ${byteSize} bytes; the ceiling is ${maxBytes}`,
    };
  }

  let parsed: FfprobeOutput;
  try {
    const { stdout } = await execFileAsync(
      resolveFfprobePath(),
      [
        '-v',
        'error',
        '-show_entries',
        'format=format_name,duration:stream=codec_type,codec_name,width,height',
        '-of',
        'json',
        filePath,
      ],
      { maxBuffer: 1024 * 1024 },
    );
    parsed = JSON.parse(stdout) as FfprobeOutput;
  } catch {
    return { ok: false, reason: 'the file is not a video ffprobe can read' };
  }

  const containerNames = (parsed.format?.format_name ?? '').split(',');
  if (!ALLOWED_CONTAINERS.some((container) => containerNames.includes(container))) {
    return { ok: false, reason: 'only mp4 and mov clips are accepted' };
  }

  const videoStream = parsed.streams?.find((stream) => stream.codec_type === 'video');
  if (videoStream === undefined) {
    return { ok: false, reason: 'the file has no video stream' };
  }
  const codec = videoStream.codec_name ?? '';
  if (!ALLOWED_VIDEO_CODECS.includes(codec as (typeof ALLOWED_VIDEO_CODECS)[number])) {
    return { ok: false, reason: `video codec must be H.264 or HEVC, not ${codec || 'unknown'}` };
  }

  const durationSeconds = Number(parsed.format?.duration);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return { ok: false, reason: 'the clip duration could not be measured' };
  }
  const durationMs = Math.round(durationSeconds * 1000);
  if (durationMs > CLIP_MAX_SOURCE_DURATION_MS + CLIP_PROBE_DURATION_TOLERANCE_MS) {
    return { ok: false, reason: 'clips longer than 15 seconds are not accepted' };
  }

  const width = videoStream.width ?? 0;
  const height = videoStream.height ?? 0;
  if (width <= 0 || height <= 0) {
    return { ok: false, reason: 'the clip frame size could not be measured' };
  }

  return {
    ok: true,
    durationMs: Math.min(durationMs, CLIP_MAX_SOURCE_DURATION_MS),
    width,
    height,
    videoCodec: codec,
    byteSize,
  };
}
