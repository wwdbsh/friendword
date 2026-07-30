import ffmpegPath from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';

/**
 * The statically-bundled ffmpeg/ffprobe binaries the ingest pipeline execs.
 * Resolved through the packages (never a system PATH lookup) so the binary that
 * ran in the feasibility measurement is the binary that runs in production —
 * on Vercel these are the linux-x64 builds traced into the function bundle via
 * next.config.mjs `outputFileTracingIncludes`.
 */
export function resolveFfmpegPath(): string {
  if (ffmpegPath === null) {
    throw new Error('ffmpeg-static did not resolve a binary for this platform');
  }
  return ffmpegPath;
}

export function resolveFfprobePath(): string {
  return ffprobeStatic.path;
}
