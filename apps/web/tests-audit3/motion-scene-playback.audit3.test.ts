// MOTION PHASE 1 — the Dater approves a scene, so playback IS that scene.
//
// The failure this pins: both surfaces used to recompute photo windows at
// runtime from `distributePhotoScenes(photos.length, durationMs, segments)`,
// where `durationMs` came from the <audio> element's metadata. That made the
// timeline a function of the viewer's browser, so "the page I approved" and
// "the page that published" were only accidentally the same. The approved scene
// JSON is now the single source of truth, and the runtime distribution survives
// only as the legacy fallback for rows published before it existed (A4).
/* global describe, expect, it */

import { readFileSync } from 'node:fs';

import { buildPitchSceneV1, type PitchSceneV1 } from '@friendword/contracts';

import {
  activeMotionPhotoIndex,
  legacyMotionWindows,
  motionWindowSignature,
  sceneDurationDriftMs,
  sceneMotionWindows,
} from '../src/pitch/motion';
import { fromPublishedPitch, toPitchPlayerView } from '../src/pitch/view';

const PHOTO_ONE = '40000000-0000-0000-0000-000000000001';
const PHOTO_TWO = '40000000-0000-0000-0000-000000000002';
const PHOTO_THREE = '40000000-0000-0000-0000-000000000003';

/** A scene the server stored, round-tripped through JSON like a jsonb read. */
function storedScene(): PitchSceneV1 {
  const scene = buildPitchSceneV1({
    photoAssetIds: [PHOTO_ONE, PHOTO_TWO],
    segments: [
      { startMs: 0, endMs: 4_000 },
      { startMs: 4_000, endMs: 11_000 },
      { startMs: 11_000, endMs: 18_000 },
      { startMs: 18_000, endMs: 24_000 },
    ],
  });
  return JSON.parse(JSON.stringify(scene)) as PitchSceneV1;
}

function publishedPitch(overrides: Record<string, unknown> = {}) {
  return {
    campaignId: '20000000-0000-0000-0000-000000000001',
    campaignSlug: 'blair-abc123',
    publishedAt: '2026-07-29T00:00:00Z',
    daterDisplayName: 'Blair',
    introducerDisplayName: 'Maya',
    relationshipType: 'friend',
    relationshipDuration: 'y3to10',
    headline: 'Blair, in Blair’s own words.',
    body: 'Approved body.',
    // The recording's segments say 60s; the approved scene says 24s. The player
    // must follow the scene.
    transcript: {
      text: 'Blair is the best.',
      segments: [
        { start: 0, end: 30, text: 'Blair is the best.' },
        { start: 30, end: 60, text: 'Truly.' },
      ],
    },
    structure: null,
    daterReviewedStructure: true,
    age: 32,
    datingIntent: 'long-term',
    approximateLocation: 'Seattle, Puget Sound',
    voiceUrl: 'https://storage.example/voice.m4a',
    photos: [
      { assetId: PHOTO_ONE, url: 'https://storage.example/one.jpg', sortOrder: 0 },
      { assetId: PHOTO_TWO, url: 'https://storage.example/two.jpg', sortOrder: 1 },
    ],
    scene: storedScene(),
    ...overrides,
  } as unknown as Parameters<typeof fromPublishedPitch>[0];
}

describe('the approved scene reaches the player untouched', () => {
  it('carries the scene through the read boundary and the player projection', () => {
    const scene = storedScene();
    const player = toPitchPlayerView(fromPublishedPitch(publishedPitch()));

    expect(player.scene).toEqual(scene);
    expect(player.photos.map((photo) => photo.assetId)).toEqual([PHOTO_ONE, PHOTO_TWO]);
  });

  it('plays the scene windows verbatim even when the recording says otherwise', () => {
    const player = toPitchPlayerView(fromPublishedPitch(publishedPitch()));
    const windows = sceneMotionWindows(
      player.scene,
      player.photos.map((photo) => photo.assetId),
    );

    // The scene's own boundary, snapped to the segment starts the Dater's save
    // saw — NOT the 60s the published transcript segments imply, and not
    // anything derived from an <audio> duration.
    expect(windows).toEqual([
      { photoIndex: 0, startMs: 0, endMs: 11_000 },
      { photoIndex: 1, startMs: 11_000, endMs: 24_000 },
    ]);
    // What the recompute would have produced instead, for contrast.
    expect(motionWindowSignature(windows ?? [])).not.toBe(
      motionWindowSignature(
        legacyMotionWindows(2, 60_000, [
          { startMs: 0, endMs: 30_000 },
          { startMs: 30_000, endMs: 60_000 },
        ]),
      ),
    );
  });

  it('gives the consent preview and the public page the same windows', () => {
    // The consent preview receives the scene from getConsentReview and the
    // public page from getPublishedPitchBySlug. Same stored bytes, same photo
    // set — so the same signature. Photo ORDER differs here on purpose: the
    // scene binds by asset id, not by position.
    const scene = storedScene();
    const consent = sceneMotionWindows(scene, [PHOTO_ONE, PHOTO_TWO]);
    const published = sceneMotionWindows(scene, [PHOTO_TWO, PHOTO_ONE]);

    expect(consent?.map((window) => [window.startMs, window.endMs])).toEqual(
      published?.map((window) => [window.startMs, window.endMs]),
    );
    expect(consent?.[0]?.photoIndex).toBe(0);
    expect(published?.[0]?.photoIndex).toBe(1);
  });

  it('switches photos on the approved boundary', () => {
    const windows = sceneMotionWindows(storedScene(), [PHOTO_ONE, PHOTO_TWO]) ?? [];

    expect(activeMotionPhotoIndex(windows, 0)).toBe(0);
    expect(activeMotionPhotoIndex(windows, 10_999)).toBe(0);
    expect(activeMotionPhotoIndex(windows, 11_000)).toBe(1);
    // Clamped past the end rather than falling off the list.
    expect(activeMotionPhotoIndex(windows, 999_999)).toBe(1);
  });
});

describe('fail closed instead of playing a broken timeline', () => {
  it('falls back when the scene names a photo the page no longer shows', () => {
    // Exactly the state after the Dater excludes a photo but before the save
    // rebuilds the scene. Playing it would show an excluded photo.
    expect(sceneMotionWindows(storedScene(), [PHOTO_ONE])).toBeNull();
  });

  it('falls back when a photo has no asset id at all (fixtures)', () => {
    expect(sceneMotionWindows(storedScene(), [null, null])).toBeNull();
  });

  it('falls back for a legacy row with no scene', () => {
    const player = toPitchPlayerView(fromPublishedPitch(publishedPitch({ scene: null })));

    expect(player.scene).toBeNull();
    expect(sceneMotionWindows(player.scene, [PHOTO_ONE, PHOTO_TWO])).toBeNull();
    // …and the legacy distribution still covers the real duration.
    const legacy = legacyMotionWindows(2, 60_000, [
      { startMs: 0, endMs: 30_000 },
      { startMs: 30_000, endMs: 60_000 },
    ]);
    expect(legacy.at(-1)?.endMs).toBe(60_000);
  });

  it('refuses to strobe on the legacy path either', () => {
    // 3 photos over 2 seconds. The unguarded distribution gave each ~666ms;
    // the viewer carries the photosensitivity risk and consented to nothing.
    const windows = legacyMotionWindows(3, 2_000, [{ startMs: 0, endMs: 2_000 }]);

    expect(windows.length).toBe(2);
    windows.forEach((window) => {
      expect(window.endMs - window.startMs).toBeGreaterThanOrEqual(1_000);
    });
    // An unknown duration shows one photo rather than flashing them all.
    expect(legacyMotionWindows(3, 0, []).length).toBe(1);
  });
});

describe('the measured audio duration is diagnostics only', () => {
  it('reports the drift without changing a single window', () => {
    const scene = storedScene();
    const before = sceneMotionWindows(scene, [PHOTO_ONE, PHOTO_TWO]);

    expect(sceneDurationDriftMs(scene, 25_400)).toBe(1_400);
    expect(sceneDurationDriftMs(scene, 22_000)).toBe(-2_000);
    expect(sceneDurationDriftMs(scene, null)).toBeNull();
    expect(sceneDurationDriftMs(null, 25_400)).toBeNull();
    expect(sceneMotionWindows(scene, [PHOTO_ONE, PHOTO_TWO])).toEqual(before);
  });

  it('keeps the runtime distribution out of the shared player', () => {
    // The player may only reach the legacy distribution through
    // `legacyMotionWindows`, i.e. the branch taken when there is no approved
    // scene. A direct call here is how the drift got in the first time.
    const source = readFileSync(
      new URL('../src/components/MotionPitchPlayer.tsx', import.meta.url),
      'utf8',
    );

    expect(source).not.toContain('distributePhotoScenes');
    expect(source).toContain('sceneMotionWindows');
  });
});

describe('what the Dater saves is what the page plays', () => {
  it('rebuilds the identical scene from the revision segments and included photos', () => {
    // The consent save path: buildPitchSceneV1(orderedIncludedPhotoIds,
    // revision transcript segments). Re-running it must reproduce the stored
    // scene byte for byte, or the preview and the publication would diverge.
    const segments = [
      { startMs: 0, endMs: 4_000 },
      { startMs: 4_000, endMs: 11_000 },
      { startMs: 11_000, endMs: 18_000 },
      { startMs: 18_000, endMs: 24_000 },
    ];
    const rebuilt = buildPitchSceneV1({
      photoAssetIds: [PHOTO_ONE, PHOTO_TWO],
      segments,
    });

    expect(rebuilt).toEqual(storedScene());
  });

  it('builds no scene when a photo the Dater added cannot get a legal turn', () => {
    // Three photos, a 2s recording: publishing a scene that references only two
    // of them would be rejected by approve_and_publish_pitch (the excluded
    // asset gets deleted), so there is no scene and the page falls back.
    expect(
      buildPitchSceneV1({
        photoAssetIds: [PHOTO_ONE, PHOTO_TWO, PHOTO_THREE],
        segments: [{ startMs: 0, endMs: 2_000 }],
      }),
    ).toBeNull();
  });
});
