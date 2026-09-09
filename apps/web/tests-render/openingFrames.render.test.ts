import { createHash } from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

import ffmpegPath from 'ffmpeg-static';
import { describe, expect, it } from 'vitest';

import {
  OPENING_MAX_MS,
  compositeOpeningFrames,
  extractOpeningFrames,
  mjpegQualityScale,
  openingFrameCount,
} from '@/lib/pitchRender/openingFrames';
import { planCaptureFrames, planOpeningCaptureFrames } from '@/lib/pitchRender/renderScene';

// §2.2-4 — the selfie opening.
//
// The determinism claim is the whole point: the capture page has no `<video>`
// precisely because a headless decoder seek is not reproducible, so the stills
// ffmpeg produces have to be. These run the bundled ffmpeg over a synthetic
// clip generated on the spot — small, fast, and no fixture to keep in the repo
// (and no real person's face in a test artefact).

const WORK = path.join(os.tmpdir(), 'friendword-opening-frames-test');
const FPS = 10;

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(Buffer.from(bytes)).digest('hex');
}

/** A 3s 320x180 landscape clip — wider than the frame, so the crop matters. */
function synthesizeClip(ffmpeg: string, file: string): void {
  execFileSync(ffmpeg, [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-fflags',
    '+bitexact',
    '-flags',
    '+bitexact',
    '-f',
    'lavfi',
    '-i',
    `testsrc=size=320x180:rate=${String(FPS)}:duration=3`,
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-pix_fmt',
    'yuv420p',
    file,
  ]);
}

/** A fully transparent PNG, standing in for a chrome capture. */
function synthesizeTransparentPng(ffmpeg: string, file: string): void {
  execFileSync(ffmpeg, [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'color=c=black@0.0:s=1080x1920:d=1,format=rgba',
    '-frames:v',
    '1',
    file,
  ]);
}

describe('openingFrameCount', () => {
  it('never runs past the 2.5s cap, whatever the clip length', () => {
    expect(openingFrameCount(1_000, 30)).toBe(30);
    expect(openingFrameCount(OPENING_MAX_MS, 30)).toBe(75);
    expect(openingFrameCount(15_000, 30)).toBe(75);
    expect(openingFrameCount(0, 30)).toBe(0);
  });
});

describe('mjpegQualityScale', () => {
  it('maps the capture quality onto ffmpeg qscale, best-to-best', () => {
    expect(mjpegQualityScale(100)).toBe(1);
    expect(mjpegQualityScale(92)).toBeLessThanOrEqual(4);
    expect(mjpegQualityScale(1)).toBe(31);
  });
});

describe('the opening frame cursors', () => {
  it('puts the opening ahead of the scene on ONE output timeline', () => {
    const openingCount = 5;
    const scene = planCaptureFrames([{ startMs: 0, endMs: 1_000 }], FPS, openingCount);
    const opening = planOpeningCaptureFrames(openingCount, openingCount + scene.length);

    expect(opening).toHaveLength(openingCount);
    // Chrome over nothing, and before the first spoken millisecond, so no word
    // caption can light up over the selfie.
    expect(opening.every((frame) => frame.cursor.overlayOnly === true)).toBe(true);
    expect(opening.every((frame) => frame.tMs < 0)).toBe(true);
    expect(opening.map((frame) => frame.cursor.outputFrame)).toEqual([0, 1, 2, 3, 4]);
    // The scene starts where the opening ends, and both agree on the total.
    expect(scene[0]?.cursor.outputFrame).toBe(openingCount);
    expect(scene[0]?.cursor.totalFrames).toBe(openingCount + scene.length);
    expect(opening[0]?.cursor.totalFrames).toBe(openingCount + scene.length);
  });

  it('is the render it has always been when there is no opening', () => {
    const scene = planCaptureFrames([{ startMs: 0, endMs: 1_000 }], FPS);
    expect(planOpeningCaptureFrames(0, scene.length)).toEqual([]);
    expect(scene[0]?.cursor.outputFrame).toBe(0);
    expect(scene[0]?.cursor.totalFrames).toBe(scene.length);
  });
});

describe('extractOpeningFrames', () => {
  const ffmpeg = ffmpegPath;
  if (ffmpeg === null) {
    it.skip('needs ffmpeg-static', () => undefined);
    return;
  }
  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(WORK, { recursive: true });
  const clip = path.join(WORK, 'clip.mp4');
  synthesizeClip(ffmpeg, clip);

  it('extracts the capped opening at the render fps, cover-cropped', async () => {
    const frames = await extractOpeningFrames({
      ffmpegPath: ffmpeg,
      videoPath: clip,
      fps: FPS,
      workDir: WORK,
      prefix: 'run-a',
    });
    expect(frames).toHaveLength(openingFrameCount(OPENING_MAX_MS, FPS));
    // PNG magic, so this really is the lossless layer the hash is taken over.
    expect([...(frames[0] ?? []).slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    // IHDR carries the pixel size: bytes 16..24 are width and height, BE.
    const first = Buffer.from(frames[0] ?? new Uint8Array());
    expect(first.readUInt32BE(16)).toBe(1080);
    expect(first.readUInt32BE(20)).toBe(1920);
  });

  it('produces byte-identical frames on a second run', async () => {
    const one = await extractOpeningFrames({
      ffmpegPath: ffmpeg,
      videoPath: clip,
      fps: FPS,
      workDir: WORK,
      prefix: 'det-1',
    });
    const two = await extractOpeningFrames({
      ffmpegPath: ffmpeg,
      videoPath: clip,
      fps: FPS,
      workDir: WORK,
      prefix: 'det-2',
    });
    expect(one).toHaveLength(two.length);
    expect(one.map(sha256)).toEqual(two.map(sha256));
    // …and the run is not trivially "every frame the same", which would make
    // the equality above meaningless.
    expect(new Set(one.map(sha256)).size).toBeGreaterThan(1);
  });

  it('composites the chrome over the stills and hands back MJPEG', async () => {
    const base = await extractOpeningFrames({
      ffmpegPath: ffmpeg,
      videoPath: clip,
      fps: FPS,
      workDir: WORK,
      prefix: 'comp',
      maxMs: 300,
    });
    const basePaths = base.map((_frame, index) =>
      path.join(WORK, `comp-${String(index + 1).padStart(5, '0')}.png`),
    );
    const overlayPaths = base.map((_frame, index) => {
      const file = path.join(WORK, `chrome-${String(index + 1).padStart(5, '0')}.png`);
      synthesizeTransparentPng(ffmpeg, file);
      return file;
    });

    const composited = await compositeOpeningFrames({
      ffmpegPath: ffmpeg,
      basePaths,
      overlayPaths,
      workDir: WORK,
      prefix: 'out',
      jpegQuality: 92,
    });
    expect(composited).toHaveLength(base.length);
    // JPEG SOI — exactly what the image2pipe/mjpeg encoder input expects, so
    // the opening is indistinguishable from a captured frame downstream.
    expect([...(composited[0] ?? []).slice(0, 2)]).toEqual([0xff, 0xd8]);
    // A fully transparent overlay must leave the picture alone: decode both to
    // raw RGB and compare. (An opaque chrome capture here would be a black
    // rectangle, which is the bug this asserts against.)
    const decoded = path.join(WORK, 'decoded.rawvideo');
    execFileSync(ffmpeg, [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      path.join(WORK, 'out-00001.jpg'),
      '-f',
      'rawvideo',
      '-pix_fmt',
      'gray',
      decoded,
    ]);
    const gray = await readFile(decoded);
    // testsrc is a bright colour-bar pattern; a black rectangle would average
    // near zero.
    const mean = gray.reduce((sum, value) => sum + value, 0) / gray.length;
    expect(mean).toBeGreaterThan(40);
  });

  it('refuses a chrome sequence that does not match the stills', async () => {
    await expect(
      compositeOpeningFrames({
        ffmpegPath: ffmpeg,
        basePaths: ['a-00001.png'],
        overlayPaths: [],
        workDir: WORK,
        prefix: 'bad',
        jpegQuality: 92,
      }),
    ).rejects.toThrow(/1 frames but 0 chrome frames/);
  });
});
