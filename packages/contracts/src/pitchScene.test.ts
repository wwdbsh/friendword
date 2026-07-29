import { describe, expect, it } from 'vitest';

import {
  activeSceneIndex,
  buildPitchSceneV1,
  MIN_SCENE_DURATION_MS,
  pitchSceneV1Schema,
  type PitchSceneSegment,
  type PitchSceneV1,
} from './pitchScene';

const photoId = (index: number): string =>
  `40000000-0000-0000-0000-${String(index).padStart(12, '0')}`;

const photoIds = (count: number): readonly string[] =>
  Array.from({ length: count }, (_value, index) => photoId(index + 1));

/** Evenly spaced segments, the shape a real provider returns. */
function segments(count: number, totalMs: number): readonly PitchSceneSegment[] {
  return Array.from({ length: count }, (_value, index) => ({
    startMs: Math.round((index * totalMs) / count),
    endMs: Math.round(((index + 1) * totalMs) / count),
  }));
}

/** Every invariant the DB enforces (migration 0048), re-checked structurally. */
function assertSafe(scene: PitchSceneV1, photoAssetIds: readonly string[]): void {
  expect(pitchSceneV1Schema.safeParse(scene).success).toBe(true);
  // Set equality with the included photos — what approve_and_publish_pitch
  // demands before it will publish the scene.
  expect(scene.scenes.length).toBe(photoAssetIds.length);
  expect(new Set(scene.scenes.map((window) => window.assetId)).size).toBe(scene.scenes.length);
  expect(scene.scenes.every((window) => photoAssetIds.includes(window.assetId))).toBe(true);
  expect(scene.scenes[0]?.startMs).toBe(0);
  expect(scene.scenes.at(-1)?.endMs).toBe(scene.durationMs);
  scene.scenes.forEach((window, index) => {
    expect(window.endMs - window.startMs).toBeGreaterThanOrEqual(MIN_SCENE_DURATION_MS);
    if (index > 0) {
      expect(window.startMs).toBe(scene.scenes[index - 1]?.endMs);
    }
  });
}

describe('buildPitchSceneV1 — shape', () => {
  it('emits the v1 header and derives the duration from the last segment', () => {
    const scene = buildPitchSceneV1({
      photoAssetIds: photoIds(2),
      segments: segments(4, 25_000),
    });

    expect(scene).not.toBeNull();
    expect(scene?.schemaVersion).toBe(1);
    expect(scene?.canvas).toEqual({ width: 1080, height: 1920, fps: 30 });
    // NOT a client-measured audio duration: the last segment end, so the
    // approved timeline is identical on every device.
    expect(scene?.durationMs).toBe(25_000);
  });

  it('carries no text field — captions come from the transcript segments', () => {
    const scene = buildPitchSceneV1({
      photoAssetIds: photoIds(3),
      segments: segments(6, 30_000),
    });

    const serialized = JSON.stringify(scene);
    expect(serialized).not.toContain('text');
    expect(Object.keys(scene?.scenes[0] ?? {}).sort()).toEqual(['assetId', 'endMs', 'startMs']);
  });

  it('keeps parity with the runtime distribution it replaces', () => {
    // 4 segments, 2 photos -> photo 1 covers segments 0-1, photo 2 covers 2-3,
    // exactly what distributePhotoScenes produced at runtime.
    const scene = buildPitchSceneV1({
      photoAssetIds: photoIds(2),
      segments: [
        { startMs: 0, endMs: 5_000 },
        { startMs: 5_000, endMs: 11_000 },
        { startMs: 11_000, endMs: 18_000 },
        { startMs: 18_000, endMs: 25_000 },
      ],
    });

    expect(scene?.scenes).toEqual([
      { assetId: photoId(1), startMs: 0, endMs: 11_000 },
      { assetId: photoId(2), startMs: 11_000, endMs: 25_000 },
    ]);
  });

  it('splits the real duration evenly when there are fewer segments than photos', () => {
    const scene = buildPitchSceneV1({
      photoAssetIds: photoIds(3),
      segments: [{ startMs: 0, endMs: 30_000 }],
    });

    expect(scene?.scenes).toEqual([
      { assetId: photoId(1), startMs: 0, endMs: 10_000 },
      { assetId: photoId(2), startMs: 10_000, endMs: 20_000 },
      { assetId: photoId(3), startMs: 20_000, endMs: 30_000 },
    ]);
  });
});

describe('buildPitchSceneV1 — null is a real answer', () => {
  it('returns null without photos', () => {
    expect(buildPitchSceneV1({ photoAssetIds: [], segments: segments(3, 20_000) })).toBeNull();
  });

  it('returns null without transcript segments (legacy fallback)', () => {
    expect(buildPitchSceneV1({ photoAssetIds: photoIds(3), segments: [] })).toBeNull();
  });

  it('returns null when the recording is too short for one legal scene', () => {
    expect(
      buildPitchSceneV1({
        photoAssetIds: photoIds(1),
        segments: [{ startMs: 0, endMs: 900 }],
      }),
    ).toBeNull();
  });

  it('accepts a recording exactly at the floor', () => {
    const scene = buildPitchSceneV1({
      photoAssetIds: photoIds(1),
      segments: [{ startMs: 0, endMs: 1_000 }],
    });

    expect(scene?.scenes).toEqual([{ assetId: photoId(1), startMs: 0, endMs: 1_000 }]);
  });
});

describe('buildPitchSceneV1 — the 1000ms floor cannot be violated', () => {
  it('returns null rather than strobe when there are more photos than seconds', () => {
    // 8 approved photos over a 4s recording. The old runtime distribution gave
    // all 8 a 500ms window (a photosensitivity risk carried by the viewer, who
    // never consented to anything). Dropping four photos is not ours to decide
    // either — and approve_and_publish_pitch requires the scene to reference
    // exactly the included set — so there is simply no scene yet.
    expect(
      buildPitchSceneV1({ photoAssetIds: photoIds(8), segments: segments(8, 4_000) }),
    ).toBeNull();
  });

  it('covers every included photo whenever it returns a scene', () => {
    const ids = photoIds(4);
    const scene = buildPitchSceneV1({ photoAssetIds: ids, segments: segments(9, 20_000) });

    expect(scene?.scenes.map((window) => window.assetId)).toEqual(ids);
    assertSafe(scene as PitchSceneV1, ids);
  });

  it('abandons segment alignment when a real pause would cut a scene short', () => {
    // A 200ms opening segment would have produced a 200ms first scene.
    const ids = photoIds(2);
    const scene = buildPitchSceneV1({
      photoAssetIds: ids,
      segments: [
        { startMs: 0, endMs: 200 },
        { startMs: 200, endMs: 20_000 },
      ],
    });

    expect(scene?.scenes).toEqual([
      { assetId: photoId(1), startMs: 0, endMs: 10_000 },
      { assetId: photoId(2), startMs: 10_000, endMs: 20_000 },
    ]);
    assertSafe(scene as PitchSceneV1, ids);
  });

  it('holds every invariant across the photo count x duration grid', () => {
    for (const photoCount of [1, 2, 3, 5, 8]) {
      for (const durationMs of [
        1_000, 1_001, 2_001, 3_002, 7_777, 15_000, 15_333, 32_768, 60_000, 61_001,
      ]) {
        for (const segmentCount of [1, 2, 3, 7, 41]) {
          const ids = photoIds(photoCount);
          const label = `${photoCount} photos / ${durationMs}ms / ${segmentCount} segments`;
          const scene = buildPitchSceneV1({
            photoAssetIds: ids,
            segments: segments(segmentCount, durationMs),
          });
          if (photoCount > Math.floor(durationMs / MIN_SCENE_DURATION_MS)) {
            expect(scene, label).toBeNull();
            continue;
          }
          expect(scene, label).not.toBeNull();
          assertSafe(scene as PitchSceneV1, ids);
        }
      }
    }
  });

  it('is deterministic: the same input always yields the same scene', () => {
    const input = { photoAssetIds: photoIds(4), segments: segments(9, 47_321) };
    expect(JSON.stringify(buildPitchSceneV1(input))).toBe(JSON.stringify(buildPitchSceneV1(input)));
  });

  it('never gives one photo two scenes, even from duplicated input ids', () => {
    const duplicated = [photoId(1), photoId(1), photoId(2)];
    const scene = buildPitchSceneV1({ photoAssetIds: duplicated, segments: segments(6, 30_000) });

    expect(scene?.scenes.map((window) => window.assetId)).toEqual([photoId(1), photoId(2)]);
  });
});

describe('pitchSceneV1Schema — rejects what the DB rejects', () => {
  const valid = (): PitchSceneV1 =>
    buildPitchSceneV1({
      photoAssetIds: photoIds(3),
      segments: segments(6, 30_000),
    }) as PitchSceneV1;

  it('accepts a builder output', () => {
    expect(pitchSceneV1Schema.safeParse(valid()).success).toBe(true);
  });

  it('rejects a scene under the floor', () => {
    const scene = valid();
    const mutated = {
      ...scene,
      scenes: [
        { assetId: photoId(1), startMs: 0, endMs: 30 },
        { assetId: photoId(2), startMs: 30, endMs: 30_000 },
      ],
    };
    expect(pitchSceneV1Schema.safeParse(mutated).success).toBe(false);
  });

  it('rejects a gap, an overlap and a short cover', () => {
    const scene = valid();
    const gap = {
      ...scene,
      scenes: [
        { assetId: photoId(1), startMs: 0, endMs: 10_000 },
        { assetId: photoId(2), startMs: 12_000, endMs: 30_000 },
      ],
    };
    const overlap = {
      ...scene,
      scenes: [
        { assetId: photoId(1), startMs: 0, endMs: 10_000 },
        { assetId: photoId(2), startMs: 9_000, endMs: 30_000 },
      ],
    };
    const short = {
      ...scene,
      scenes: [{ assetId: photoId(1), startMs: 0, endMs: 20_000 }],
    };
    expect(pitchSceneV1Schema.safeParse(gap).success).toBe(false);
    expect(pitchSceneV1Schema.safeParse(overlap).success).toBe(false);
    expect(pitchSceneV1Schema.safeParse(short).success).toBe(false);
  });

  it('rejects a repeated asset and a non-uuid asset', () => {
    const scene = valid();
    const repeated = {
      ...scene,
      scenes: [
        { assetId: photoId(1), startMs: 0, endMs: 15_000 },
        { assetId: photoId(1), startMs: 15_000, endMs: 30_000 },
      ],
    };
    const notUuid = {
      ...scene,
      scenes: [{ assetId: 'photo-one', startMs: 0, endMs: 30_000 }],
    };
    expect(pitchSceneV1Schema.safeParse(repeated).success).toBe(false);
    expect(pitchSceneV1Schema.safeParse(notUuid).success).toBe(false);
  });

  it('rejects a text field smuggled onto a scene', () => {
    const scene = valid();
    const withText = {
      ...scene,
      scenes: scene.scenes.map((window) => ({ ...window, text: 'copy nobody approved' })),
    };
    expect(pitchSceneV1Schema.safeParse(withText).success).toBe(false);
  });

  it('rejects an unknown schema version', () => {
    expect(pitchSceneV1Schema.safeParse({ ...valid(), schemaVersion: 2 }).success).toBe(false);
  });
});

describe('activeSceneIndex', () => {
  const windows = [
    { startMs: 0, endMs: 10_000 },
    { startMs: 10_000, endMs: 20_000 },
    { startMs: 20_000, endMs: 30_000 },
  ];

  it('returns the scene containing the elapsed time', () => {
    expect(activeSceneIndex(windows, 0)).toBe(0);
    expect(activeSceneIndex(windows, 9_999)).toBe(0);
    expect(activeSceneIndex(windows, 10_000)).toBe(1);
    expect(activeSceneIndex(windows, 25_000)).toBe(2);
  });

  it('clamps past the end and survives an empty list', () => {
    expect(activeSceneIndex(windows, 999_999)).toBe(2);
    expect(activeSceneIndex([], 5_000)).toBe(0);
  });
});
