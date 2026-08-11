import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import ffmpegPath from 'ffmpeg-static';
import { buildPitchSceneV2, pitchSceneV2Schema, type PitchSceneV2 } from '@friendword/contracts';

import type { CaptionSegment } from '@/pitch/captionChrome';
import type { SceneTextFields, SceneWord } from '@/pitch/sceneV2';
import type { RenderPhotoAsset } from '@/lib/pitchRender/renderScene';

// Deterministic media fixtures, generated locally with the bundled ffmpeg —
// no binary blobs in the repo, no network. All of it is synthetic test data;
// nothing here fabricates product claims.

const FIXTURE_DIR = path.join(os.tmpdir(), 'friendword-render-fixtures');

function ffmpeg(args: readonly string[]): void {
  if (ffmpegPath === null) {
    throw new Error('ffmpeg-static missing');
  }
  execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', ...args]);
}

/** The Advisor's QA scene: 15s, 5 shots, kenBurns+punch, seeded grain. */
export function qaScene(): PitchSceneV2 {
  const raw: unknown = JSON.parse(
    readFileSync(new URL('./fixtures/qa-v2-scene.json', import.meta.url), 'utf8'),
  );
  return pitchSceneV2Schema.parse(raw);
}

/** A distinct-looking 1440x2560 JPEG per index (hue-rotated test pattern). */
export function photoAsset(assetId: string, index: number): RenderPhotoAsset {
  mkdirSync(FIXTURE_DIR, { recursive: true });
  const file = path.join(FIXTURE_DIR, `photo-${index}.jpg`);
  if (!existsSync(file)) {
    ffmpeg([
      '-f',
      'lavfi',
      '-i',
      `testsrc2=size=1440x2560:rate=1:duration=1`,
      '-vf',
      `hue=h=${index * 70}`,
      '-frames:v',
      '1',
      '-q:v',
      '3',
      file,
    ]);
  }
  return { assetId, bytes: readFileSync(file), mimeType: 'image/jpeg' };
}

/** AAC-in-m4a voice stand-in (sine sweep), the product's stored audio kind. */
export function audioM4a(durationSec: number): { bytes: Buffer; mimeType: string } {
  mkdirSync(FIXTURE_DIR, { recursive: true });
  const file = path.join(FIXTURE_DIR, `audio-${durationSec}.m4a`);
  if (!existsSync(file)) {
    ffmpeg([
      '-f',
      'lavfi',
      '-i',
      `sine=frequency=330:duration=${durationSec}`,
      '-c:a',
      'aac',
      '-b:a',
      '96k',
      file,
    ]);
  }
  return { bytes: readFileSync(file), mimeType: 'audio/mp4' };
}

export const FIXTURE_TEXT: SceneTextFields = {
  hook: 'The friend who never cancels',
  relationship_context: 'Roommates for three years',
  three_specific_qualities: ['Loyal', 'Curious', 'Funny'],
  evidence_or_anecdote: 'Drove four hours for a birthday dinner',
  good_match_for: 'Someone who loves slow mornings',
};

/**
 * Caption band fixture for the 15s QA scene (T017). Segment boundaries at 4s,
 * 8s and 11.5s are what the boundary-frame checks in renderCapture.e2e aim at.
 * The segmentIndexes line up with FIXTURE_WORDS so the keyword highlight has
 * real word data to select from.
 */
export const FIXTURE_CAPTIONS: readonly CaptionSegment[] = [
  {
    segmentIndex: 0,
    startMs: 0,
    endMs: 4_000,
    text: 'Honestly, this is the friend who never cancels.',
  },
  { segmentIndex: 1, startMs: 4_000, endMs: 8_000, text: 'Loyal in a way that costs her time.' },
  {
    segmentIndex: 2,
    startMs: 8_000,
    endMs: 11_500,
    text: 'Kind to strangers, funny with friends.',
  },
  { segmentIndex: 3, startMs: 11_500, endMs: 15_000, text: 'Brave enough to say yes to this.' },
];

export const FIXTURE_WORDS: readonly SceneWord[] = [
  { segmentIndex: 0, wordIndex: 0, text: 'Honestly' },
  { segmentIndex: 1, wordIndex: 0, text: 'Loyal' },
  { segmentIndex: 2, wordIndex: 0, text: 'Kind' },
  { segmentIndex: 3, wordIndex: 0, text: 'Brave' },
];

function fixtureAssetId(index: number): string {
  return `97000000-0000-0000-0000-0000000000${String(10 + index)}`;
}

/**
 * The worst case the brief fixes the feasibility criteria against: a full 60s
 * scene, built by the REAL builder (so it is a valid v2 document with cards,
 * badges, word pops and leaks), not a hand-tiled fixture.
 */
export function worstCaseScene(): {
  scene: PitchSceneV2;
  photos: readonly RenderPhotoAsset[];
  words: readonly SceneWord[];
  text: SceneTextFields;
  captions: readonly CaptionSegment[];
} {
  const assetIds = [0, 1, 2, 3].map(fixtureAssetId);
  const segments = Array.from({ length: 12 }, (_, index) => ({
    startMs: index * 5_000,
    endMs: (index + 1) * 5_000,
  }));
  const words = segments.map((segment, index) => ({
    segmentIndex: index,
    wordIndex: 0,
    startMs: segment.startMs + 400,
    endMs: segment.startMs + 900,
  }));
  const scene = buildPitchSceneV2({
    template: 'warm',
    photoAssetIds: assetIds,
    segments,
    words,
    structure: FIXTURE_TEXT,
  });
  if (scene === null) {
    throw new Error('builder refused the 60s worst-case input');
  }
  if (scene.durationMs !== 60_000) {
    throw new Error(`expected a 60s scene, got ${scene.durationMs}ms`);
  }
  return {
    scene,
    photos: assetIds.map((assetId, index) => photoAsset(assetId, index)),
    words: words.map((word) => ({
      segmentIndex: word.segmentIndex,
      wordIndex: word.wordIndex,
      text: `Word${word.segmentIndex}`,
    })),
    text: FIXTURE_TEXT,
    // The worst case has to carry the caption band too, or the measurement
    // would understate what a real 60s render actually composites (T017).
    captions: segments.map((segment, index) => ({
      segmentIndex: index,
      startMs: segment.startMs,
      endMs: segment.endMs,
      text: `Segment ${index}: Word${index} carries this line of the pitch.`,
    })),
  };
}
