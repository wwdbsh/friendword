import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import ffmpegPath from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';
import { describe, expect, it } from 'vitest';

import { extractOpeningFrames } from '@/lib/pitchRender/openingFrames';
import { renderScene } from '@/lib/pitchRender/renderScene';

import { FIXTURE_TEXT, FIXTURE_WORDS, audioM4a, photoAsset, qaScene } from './fixtures';

// §0 verdict 6 — the acceptance criterion for the derivative path: four runs of
// the same highlight produce the same PICTURE and the same SOUND. Byte
// identity of the container is a manual bench check (mp4 headers carry a
// creation time); frame and PCM hashes are what CI can own.
//
// Gated (PITCH_RENDER_E2E=1) like the rest of the capture suite: it needs a
// real headless Chrome and a running server.

const E2E = process.env.PITCH_RENDER_E2E === '1';
const BASE_URL = process.env.PITCH_RENDER_BASE_URL ?? 'http://127.0.0.1:3120';
const OUT_DIR = path.join(os.tmpdir(), 'friendword-render-highlight');

/** Two short windows out of the 15s QA scene — a cut, kept cheap on purpose. */
const WINDOWS = [
  { startMs: 1_000, endMs: 2_200 },
  { startMs: 8_000, endMs: 9_000 },
] as const;

const TIMED_WORDS = [
  { segmentIndex: 0, wordIndex: 0, text: 'Honestly', startMs: 1_000, endMs: 1_400 },
  { segmentIndex: 0, wordIndex: 1, text: 'she', startMs: 1_400, endMs: 1_700 },
  { segmentIndex: 2, wordIndex: 0, text: 'Kind', startMs: 8_000, endMs: 8_400 },
  { segmentIndex: 2, wordIndex: 1, text: 'always', startMs: 8_400, endMs: 8_900 },
];

/** ffmpeg's own md5 of the DECODED stream — independent of container bytes. */
function streamMd5(file: string, stream: 'v' | 'a'): string {
  if (ffmpegPath === null) {
    throw new Error('ffmpeg-static missing');
  }
  return execFileSync(ffmpegPath, [
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    file,
    '-map',
    `0:${stream}`,
    '-f',
    'md5',
    '-',
  ])
    .toString('utf8')
    .trim();
}

function probeDurations(file: string): { video: number; audio: number } {
  const raw = execFileSync(ffprobeStatic.path, [
    '-v',
    'error',
    '-print_format',
    'json',
    '-show_streams',
    file,
  ]).toString('utf8');
  const parsed = JSON.parse(raw) as {
    streams: { codec_type: string; duration?: string }[];
  };
  const of = (kind: string): number =>
    Number.parseFloat(parsed.streams.find((s) => s.codec_type === kind)?.duration ?? '0');
  return { video: of('video'), audio: of('audio') };
}

describe.runIf(E2E)('the highlight render is reproducible', () => {
  it('renders the same frames and the same PCM four times over', async () => {
    const scene = qaScene();
    const photos = scene.assetIds.map((assetId, index) => photoAsset(assetId, index));
    mkdirSync(OUT_DIR, { recursive: true });

    const videoHashes: string[] = [];
    const audioHashes: string[] = [];
    let lastFile = '';

    for (let run = 0; run < 4; run += 1) {
      const workDir = path.join(OUT_DIR, `run-${run}`);
      mkdirSync(workDir, { recursive: true });
      const { mp4, stats } = await renderScene(
        scene,
        { photos, audio: audioM4a(15) },
        {
          baseUrl: BASE_URL,
          // A DIFFERENT render key per run: the output must depend on the
          // inputs, not on the temp paths.
          renderKey: `highlight-determinism-${run}`,
          campaignSlug: 'demo-blair',
          shareOrigin: 'https://friendword-e2e.example',
          words: FIXTURE_WORDS,
          text: FIXTURE_TEXT,
          captions: [],
          variant: 'highlight',
          cutWindows: WINDOWS,
          music: true,
          musicSeed: 'c'.repeat(64),
          daterName: 'Blair',
          overlayStage: {
            introducerLabel: 'MAYA INTRODUCES',
            daterName: 'Blair',
            relationshipChip: 'Friends for 3–10 years',
          },
          timedWords: TIMED_WORDS,
          workDir,
          timeBudgetMs: 240_000,
        },
      );
      expect(stats.effectiveVariant).toBe('highlight');
      // 2.2s of cut at 30fps, rounded up per window, plus the 3s end card.
      expect(stats.sceneFrames).toBe(36 + 30);
      expect(stats.endCardMs).toBe(3_000);

      lastFile = path.join(OUT_DIR, `run-${run}.mp4`);
      writeFileSync(lastFile, mp4);
      videoHashes.push(streamMd5(lastFile, 'v'));
      audioHashes.push(streamMd5(lastFile, 'a'));
    }

    expect(new Set(videoHashes).size).toBe(1);
    expect(new Set(audioHashes).size).toBe(1);

    // §2.2-6: the picture outlasts the sound, music tail included.
    const durations = probeDurations(lastFile);
    expect(durations.video).toBeGreaterThanOrEqual(durations.audio - 0.001);
    // The cut is real: 2.2s of voice plus a 3s card, not the 15s scene.
    expect(durations.video).toBeGreaterThan(5);
    expect(durations.video).toBeLessThan(6.5);
  });
});

// §2.2-4 — the selfie opening, rendered end to end.
//
// The opening is stills from ffmpeg with the capture page's TRANSPARENT chrome
// composited on top, spliced in front of the highlight, and the whole audio
// track pushed back behind it. The two things that could go wrong here and
// nowhere else are (a) an opaque chrome capture hiding the footage, and (b) the
// voice starting before the picture it belongs to.
describe.runIf(E2E)('the selfie opening', () => {
  it('splices the clip in front, silently, and stays deterministic', async () => {
    if (ffmpegPath === null) {
      throw new Error('ffmpeg-static missing');
    }
    const scene = qaScene();
    const photos = scene.assetIds.map((assetId, index) => photoAsset(assetId, index));
    const workRoot = path.join(OUT_DIR, 'selfie');
    mkdirSync(workRoot, { recursive: true });

    const clip = path.join(workRoot, 'selfie.mp4');
    execFileSync(ffmpegPath, [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'testsrc=size=180x320:rate=30:duration=2',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-pix_fmt',
      'yuv420p',
      clip,
    ]);
    const openingFrames = await extractOpeningFrames({
      ffmpegPath,
      videoPath: clip,
      fps: 30,
      workDir: workRoot,
      prefix: 'base',
      // Short on purpose: this asserts the join, not the 2.5s cap (which
      // openingFrames.render.test.ts owns).
      maxMs: 500,
    });
    expect(openingFrames).toHaveLength(15);

    const hashes: string[] = [];
    let lastFile = '';
    for (let run = 0; run < 2; run += 1) {
      const workDir = path.join(workRoot, `run-${run}`);
      mkdirSync(workDir, { recursive: true });
      const { mp4, stats } = await renderScene(
        scene,
        { photos, audio: audioM4a(15) },
        {
          baseUrl: BASE_URL,
          renderKey: `selfie-opening-${run}`,
          campaignSlug: 'demo-blair',
          shareOrigin: 'https://friendword-e2e.example',
          words: FIXTURE_WORDS,
          text: FIXTURE_TEXT,
          captions: [],
          variant: 'highlight',
          cutWindows: WINDOWS,
          music: true,
          musicSeed: 'c'.repeat(64),
          daterName: 'Blair',
          overlayStage: {
            introducerLabel: 'MAYA INTRODUCES',
            daterName: 'Blair',
            relationshipChip: 'Friends for 3–10 years',
          },
          timedWords: TIMED_WORDS,
          openingFrames,
          workDir,
          timeBudgetMs: 240_000,
        },
      );
      expect(stats.openingFrames).toBe(15);
      // The scene is untouched by the opening: the same 66 frames as the run
      // above, with the opening in front of them.
      expect(stats.sceneFrames).toBe(36 + 30);
      lastFile = path.join(workRoot, `run-${run}.mp4`);
      writeFileSync(lastFile, mp4);
      hashes.push(streamMd5(lastFile, 'v'));
    }
    expect(new Set(hashes).size).toBe(1);

    const durations = probeDurations(lastFile);
    // §2.2-6 still holds with the lead in: the picture outlasts the sound.
    expect(durations.video).toBeGreaterThanOrEqual(durations.audio - 0.001);
    // …and the file really is half a second longer than the opening-less run.
    expect(durations.video).toBeGreaterThan(5.4);
  });
});
