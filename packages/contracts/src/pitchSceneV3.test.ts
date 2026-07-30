import { describe, expect, it } from 'vitest';

import { buildPitchSceneV1, pitchSceneV1Schema, type PitchSceneV1 } from './pitchScene';
import { PITCH_SCENE_GOLDEN_VECTORS } from './pitchSceneGoldenVectors';
import {
  examplePitchSceneV2,
  isPitchSceneV1,
  isPitchSceneV2,
  MAX_SCENE_ASSETS,
  MAX_SHOT_DURATION_MS,
  MAX_STATIC_SHOT_MS,
  MAX_WORD_POPS_PER_SHOT,
  MIN_FLASH_INTERVAL_MS,
  MIN_SHOT_DURATION_MS,
  parsePitchScene,
  PITCH_SHOT_LEVELS,
  pitchSceneSchema,
  pitchSceneV2Schema,
} from './pitchSceneV2';
import {
  examplePitchSceneV3,
  isPitchSceneAnyV1,
  isPitchSceneAnyV2,
  isPitchSceneV3,
  MAX_CLIP_ASSETS_PER_SCENE,
  MAX_CLIP_SOURCE_MS,
  MAX_CLIP_USAGE_MS,
  MIN_CLIP_SHOT_MS,
  PITCH_SCENE_V3_SCHEMA_VERSION,
  PITCH_SHOT_LEVELS_V3,
  pitchSceneAnySchema,
  pitchSceneV3FlashEvents,
  pitchSceneV3Schema,
  parseAnyPitchScene,
  type PitchSceneV3,
  type PitchShotV3,
} from './pitchSceneV3';

type JsonRecord = Record<string, unknown>;

const photoId = (index: number): string =>
  `40000000-0000-0000-0000-${String(index).padStart(12, '0')}`;

const clipId = (index: number): string =>
  `50000000-0000-0000-0000-${String(index).padStart(12, '0')}`;

const validScene = examplePitchSceneV3;

function mutate(apply: (scene: JsonRecord) => void): unknown {
  const copy = structuredClone(validScene()) as unknown as JsonRecord;
  apply(copy);
  return copy;
}

function accepts(apply: (scene: JsonRecord) => void): boolean {
  return pitchSceneV3Schema.safeParse(mutate(apply)).success;
}

function issues(apply: (scene: JsonRecord) => void): readonly string[] {
  const parsed = pitchSceneV3Schema.safeParse(mutate(apply));
  return parsed.success ? [] : parsed.error.issues.map((issue) => issue.message);
}

function shotAt(scene: JsonRecord, index: number): JsonRecord {
  return (scene.shots as JsonRecord[])[index] as JsonRecord;
}

function setPath(scene: JsonRecord, path: readonly (string | number)[], value: unknown): void {
  let cursor: JsonRecord = scene;
  for (const key of path.slice(0, -1)) {
    cursor = cursor[key as string] as JsonRecord;
  }
  cursor[path[path.length - 1] as string] = value;
}

/** The first clip shot in the canonical example (index 5), which every clip test moves. */
const FIRST_CLIP_SHOT = 5;

/**
 * Rewrites the timeline so a shot list of any lengths stays contiguous, and declares
 * exactly the photos and clips those shots use. Every structural clip test builds its
 * scene this way so the only thing under test is the rule it names.
 */
function withTimeline(shots: readonly PitchShotV3[]): unknown {
  const scene = structuredClone(validScene()) as unknown as JsonRecord;
  const placed = structuredClone(shots) as unknown as JsonRecord[];
  let cursor = 0;
  for (const shot of placed) {
    const duration = (shot.endMs as number) - (shot.startMs as number);
    shot.startMs = cursor;
    shot.endMs = cursor + duration;
    cursor += duration;
  }
  scene.shots = placed;
  scene.durationMs = cursor;
  scene.assetIds = [
    ...new Set(
      placed
        .filter((shot) => shot.level !== 'typographic' && shot.level !== 'clip')
        .map((shot) => shot.assetId as string),
    ),
  ];
  const clips = [
    ...new Set(
      placed.filter((shot) => shot.level === 'clip').map((shot) => shot.assetId as string),
    ),
  ];
  if (clips.length === 0) {
    delete scene.clipAssetIds;
  } else {
    scene.clipAssetIds = clips;
  }
  scene.overlays = [];
  scene.chrome = { progressBar: { thicknessPx: 4, opacity: 0.6, anchor: 'bottom' } };
  return scene;
}

/** A photo shot at its level's widest legal crop; carries a kenBurns only when it must. */
function photoShot(durationMs: number, asset = 1): PitchShotV3 {
  return {
    level: 'wide',
    assetId: photoId(asset),
    startMs: 0,
    endMs: durationMs,
    crop: { x: 0, y: 0, width: 1, height: 1 },
    effects:
      durationMs > MAX_STATIC_SHOT_MS
        ? [{ type: 'kenBurns', to: { x: 0, y: 0.04, width: 0.96, height: 0.96 }, easing: 'linear' }]
        : [],
  };
}

function clipShot(
  asset: number,
  clipInMs: number,
  durationMs: number,
  options: { readonly clipOutMs?: number } = {},
): PitchShotV3 {
  return {
    level: 'clip',
    assetId: clipId(asset),
    startMs: 0,
    endMs: durationMs,
    clipInMs,
    clipOutMs: options.clipOutMs ?? clipInMs + durationMs,
    effects: [],
  };
}

describe('pitchSceneV3Schema — the shape', () => {
  it('accepts the canonical example, which uses every v2 effect and every clip rule', () => {
    const parsed = pitchSceneV3Schema.safeParse(validScene());

    expect(parsed.error?.issues ?? []).toEqual([]);
    expect(parsed.success).toBe(true);
  });

  it('exports the canonical example every surface will share', () => {
    // Annotated on purpose: if the inferred type and the exported example ever
    // diverge, this stops compiling.
    const scene: PitchSceneV3 = examplePitchSceneV3();

    expect(scene.durationMs).toBe(27_600);
    expect(scene.clipAssetIds).toEqual([clipId(1), clipId(2), clipId(3)]);
    expect(scene.shots.map((shot) => shot.level)).toEqual([
      'wide',
      'punchIn',
      'detail',
      'typographic',
      'wideAlt',
      'clip',
      'clip',
      'wide',
      'clip',
      'clip',
    ]);
    expect(examplePitchSceneV3()).not.toBe(scene);
    expect(examplePitchSceneV3()).toEqual(scene);
  });

  it('pins the schema version and the level list', () => {
    expect(PITCH_SCENE_V3_SCHEMA_VERSION).toBe(3);
    expect(PITCH_SHOT_LEVELS_V3).toEqual([...PITCH_SHOT_LEVELS, 'clip']);
    expect(accepts((scene) => setPath(scene, ['schemaVersion'], 2))).toBe(false);
    expect(accepts((scene) => setPath(scene, ['schemaVersion'], 4))).toBe(false);
  });

  it('rejects an unknown key on a clip shot and on the scene root', () => {
    expect(accepts((scene) => setPath(scene, ['shots', FIRST_CLIP_SHOT, 'zIndex'], 2))).toBe(false);
    expect(accepts((scene) => setPath(scene, ['clipTemplate'], 'reels'))).toBe(false);
  });
});

describe('pitchSceneV3Schema — a clip carries no audio, no crop and no speed', () => {
  it('holds no audio, mix, speed or crop field anywhere in the example', () => {
    const keys = new Set<string>();
    const walk = (value: unknown): void => {
      if (Array.isArray(value)) {
        for (const entry of value) {
          walk(entry);
        }
        return;
      }
      if (typeof value === 'object' && value !== null) {
        for (const [key, entry] of Object.entries(value)) {
          keys.add(key);
          walk(entry);
        }
      }
    };
    walk(validScene());

    for (const forbidden of ['volume', 'gain', 'muted', 'audio', 'mix', 'rate', 'speed', 'loop']) {
      expect(keys.has(forbidden), forbidden).toBe(false);
    }
    // `crop` exists — on photo shots. It is the clip shot that may not carry one.
    expect(keys.has('crop')).toBe(true);
    for (const shot of validScene().shots) {
      expect(shot.level === 'clip' ? !('crop' in shot) : true, shot.level).toBe(true);
    }
  });

  it('rejects a volume, a playback rate, a loop flag and a crop on a clip shot', () => {
    for (const [key, value] of [
      ['volume', 0.5],
      ['muted', true],
      ['rate', 2],
      ['speed', 0.5],
      ['loop', true],
      ['crop', { x: 0, y: 0, width: 1, height: 1 }],
    ] as const) {
      expect(
        accepts((scene) => setPath(scene, ['shots', FIRST_CLIP_SHOT, key], value)),
        key,
      ).toBe(false);
    }
  });
});

describe('pitchSceneV3Schema — 1:1 playback', () => {
  it('demands clipOut - clipIn === endMs - startMs, to the millisecond', () => {
    // The example's first clip runs 12000..16000 over source [2000, 6000).
    expect(accepts((scene) => setPath(scene, ['shots', FIRST_CLIP_SHOT, 'clipOutMs'], 6_000))).toBe(
      true,
    );
    // A longer source window than screen time is a fast-forward...
    expect(accepts((scene) => setPath(scene, ['shots', FIRST_CLIP_SHOT, 'clipOutMs'], 6_001))).toBe(
      false,
    );
    // ...and a shorter one is slow motion. Both are v4 questions, not v3 scenes.
    expect(accepts((scene) => setPath(scene, ['shots', FIRST_CLIP_SHOT, 'clipOutMs'], 5_999))).toBe(
      false,
    );
    expect(
      issues((scene) => setPath(scene, ['shots', FIRST_CLIP_SHOT, 'clipOutMs'], 5_999)),
    ).toEqual([
      'a clip shot must replay its source 1:1 (clipOut - clipIn must equal endMs - startMs)',
    ]);
  });

  it('catches a retime that keeps the window and moves the screen time', () => {
    // Shortening the shot by 400ms and giving those 400ms to the next shot keeps the
    // timeline contiguous, so only the playback equation can catch this one.
    const retimed = (shift: number) => (scene: JsonRecord) => {
      setPath(scene, ['shots', FIRST_CLIP_SHOT, 'endMs'], 16_000 - shift);
      setPath(scene, ['shots', FIRST_CLIP_SHOT + 1, 'startMs'], 16_000 - shift);
    };
    expect(accepts(retimed(0))).toBe(true);
    expect(accepts(retimed(400))).toBe(false);
  });

  it('rejects a frozen clip, which would smuggle a still past the include list', () => {
    expect(
      accepts((scene) => {
        setPath(scene, ['shots', FIRST_CLIP_SHOT, 'clipInMs'], 2_000);
        setPath(scene, ['shots', FIRST_CLIP_SHOT, 'clipOutMs'], 2_000);
      }),
    ).toBe(false);
  });
});

describe('pitchSceneV3Schema — how long a clip may hold the screen', () => {
  it('pins the caps the product fixed', () => {
    expect(MAX_CLIP_USAGE_MS).toBe(10_000);
    expect(MAX_CLIP_SOURCE_MS).toBe(15_000);
    expect(MAX_CLIP_ASSETS_PER_SCENE).toBe(3);
    expect(MIN_CLIP_SHOT_MS).toBe(MIN_SHOT_DURATION_MS);
    expect(MIN_CLIP_SHOT_MS).toBe(1_200);
  });

  it('accepts a clip shot exactly at 10000ms and rejects one millisecond over', () => {
    expect(
      pitchSceneV3Schema.safeParse(
        withTimeline([photoShot(2_000), clipShot(1, 0, MAX_CLIP_USAGE_MS)]),
      ).success,
    ).toBe(true);
    expect(
      pitchSceneV3Schema.safeParse(
        withTimeline([photoShot(2_000), clipShot(1, 0, MAX_CLIP_USAGE_MS + 1)]),
      ).success,
    ).toBe(false);
  });

  it('lets a clip shot run past the photo ceiling, which is what a clip is for', () => {
    expect(MAX_CLIP_USAGE_MS).toBeGreaterThan(MAX_SHOT_DURATION_MS);
    expect(
      pitchSceneV3Schema.safeParse(
        withTimeline([photoShot(2_000), clipShot(1, 0, MAX_SHOT_DURATION_MS + 1)]),
      ).success,
    ).toBe(true);
    // ...while a photo shot still stops at 4500ms.
    expect(
      pitchSceneV3Schema.safeParse(withTimeline([photoShot(MAX_SHOT_DURATION_MS + 1)])).success,
    ).toBe(false);
  });

  it('accepts a clip shot exactly at the 1200ms floor and rejects one under', () => {
    expect(
      pitchSceneV3Schema.safeParse(withTimeline([photoShot(2_000), clipShot(1, 0, 1_200)])).success,
    ).toBe(true);
    expect(
      pitchSceneV3Schema.safeParse(withTimeline([photoShot(2_000), clipShot(1, 0, 1_199)])).success,
    ).toBe(false);
  });

  it('sums every window of one clip against the same 10000ms ceiling', () => {
    // Two windows that are each legal and together are not: the per-shot ceiling
    // alone would let three adjacent 5s windows replay 15s of a 15s source.
    const twoWindows = (secondDurationMs: number): unknown =>
      withTimeline([
        photoShot(2_000),
        clipShot(1, 0, 6_000),
        photoShot(2_000, 2),
        clipShot(1, 6_000, secondDurationMs),
      ]);
    expect(pitchSceneV3Schema.safeParse(twoWindows(4_000)).success).toBe(true);
    expect(pitchSceneV3Schema.safeParse(twoWindows(4_001)).success).toBe(false);
    expect(
      pitchSceneV3Schema.safeParse(twoWindows(4_001)).success
        ? []
        : pitchSceneV3Schema
            .safeParse(twoWindows(4_001))
            .error?.issues.map((issue) => issue.message),
    ).toEqual(['a clip may not hold the screen longer than 10000ms']);
  });

  it('bounds a source window inside the 15s capture cap', () => {
    expect(accepts((scene) => setPath(scene, ['shots', FIRST_CLIP_SHOT, 'clipInMs'], -1))).toBe(
      false,
    );
    expect(accepts((scene) => setPath(scene, ['shots', FIRST_CLIP_SHOT, 'clipInMs'], 1.5))).toBe(
      false,
    );
    expect(
      pitchSceneV3Schema.safeParse(
        withTimeline([photoShot(2_000), clipShot(1, MAX_CLIP_SOURCE_MS - 2_000, 2_000)]),
      ).success,
    ).toBe(true);
    expect(
      pitchSceneV3Schema.safeParse(
        withTimeline([
          photoShot(2_000),
          clipShot(1, MAX_CLIP_SOURCE_MS - 2_000, 2_000, { clipOutMs: MAX_CLIP_SOURCE_MS + 1 }),
        ]),
      ).success,
    ).toBe(false);
  });
});

describe('pitchSceneV3Schema — which clips a scene may reference', () => {
  it('accepts three distinct clips and rejects a fourth', () => {
    const clips = (count: number): unknown =>
      withTimeline([
        photoShot(2_000),
        ...Array.from({ length: count }, (_value, index) => clipShot(index + 1, 0, 1_200)),
      ]);
    expect(pitchSceneV3Schema.safeParse(clips(MAX_CLIP_ASSETS_PER_SCENE)).success).toBe(true);
    const tooMany = pitchSceneV3Schema.safeParse(clips(MAX_CLIP_ASSETS_PER_SCENE + 1));
    expect(tooMany.success).toBe(false);
    expect(tooMany.success ? [] : tooMany.error.issues.map((issue) => issue.message)).toEqual([
      'a scene may use at most 3 clips',
    ]);
  });

  it('requires clipAssetIds to declare every clip a shot plays', () => {
    expect(
      accepts((scene) => {
        delete scene.clipAssetIds;
      }),
    ).toBe(false);
    expect(
      accepts((scene) => setPath(scene, ['shots', FIRST_CLIP_SHOT, 'assetId'], clipId(9))),
    ).toBe(false);
    expect(accepts((scene) => setPath(scene, ['clipAssetIds', 2], clipId(1)))).toBe(false);
    expect(
      accepts((scene) => {
        (scene.clipAssetIds as string[]).push(clipId(4));
      }),
    ).toBe(false);
  });

  it('spells "no clips" one way only — the key is absent, never empty', () => {
    const noClips = withTimeline([photoShot(2_000)]) as JsonRecord;
    expect(pitchSceneV3Schema.safeParse(noClips).success).toBe(true);
    expect('clipAssetIds' in noClips).toBe(false);
    const empty = structuredClone(noClips);
    empty.clipAssetIds = [];
    expect(pitchSceneV3Schema.safeParse(empty).success).toBe(false);
    const unusedList = structuredClone(noClips);
    unusedList.clipAssetIds = [clipId(1)];
    expect(pitchSceneV3Schema.safeParse(unusedList).success).toBe(false);
  });

  it('counts photos and clips against one shared asset ceiling', () => {
    // docs/DECISIONS.md (2026-07-30 U8): the scene asset ceiling of 12 is shared with
    // the photos, so 12 photos leave no room for a clip.
    const withPhotos = (count: number): unknown =>
      withTimeline([
        ...Array.from({ length: count }, (_value, index) => photoShot(1_200, index + 1)),
        clipShot(1, 0, 1_200),
      ]);
    expect(pitchSceneV3Schema.safeParse(withPhotos(MAX_SCENE_ASSETS - 1)).success).toBe(true);
    expect(pitchSceneV3Schema.safeParse(withPhotos(MAX_SCENE_ASSETS)).success).toBe(false);
  });

  it('still demands a photo, because a clip is not a substitute for the reviewed set', () => {
    expect(
      pitchSceneV3Schema.safeParse(withTimeline([clipShot(1, 0, 3_000), clipShot(2, 0, 3_000)]))
        .success,
    ).toBe(false);
    expect(
      pitchSceneV3Schema.safeParse(
        withTimeline([clipShot(1, 0, 3_000), photoShot(2_000), clipShot(2, 0, 3_000)]),
      ).success,
    ).toBe(true);
  });
});

describe('pitchSceneV3Schema — the same footage may not play twice', () => {
  it('rejects a repeated window at any distance, and accepts a later one', () => {
    const repeated = withTimeline([
      photoShot(2_000),
      clipShot(1, 0, 2_000),
      photoShot(2_000, 2),
      photoShot(2_000, 3),
      photoShot(2_000, 4),
      clipShot(1, 0, 2_000),
    ]);
    const later = withTimeline([
      photoShot(2_000),
      clipShot(1, 0, 2_000),
      photoShot(2_000, 2),
      photoShot(2_000, 3),
      photoShot(2_000, 4),
      clipShot(1, 2_000, 2_000),
    ]);
    expect(pitchSceneV3Schema.safeParse(repeated).success).toBe(false);
    expect(pitchSceneV3Schema.safeParse(later).success).toBe(true);
  });

  it('rejects two windows of one clip that overlap in source time', () => {
    const windows = (secondInMs: number): unknown =>
      withTimeline([photoShot(2_000), clipShot(1, 0, 3_000), clipShot(1, secondInMs, 3_000)]);
    // Adjacent windows are the same clip playing on through a cut: legal.
    expect(pitchSceneV3Schema.safeParse(windows(3_000)).success).toBe(true);
    // A tenth of a second of overlap replays 2900ms of the same frames: a stutter.
    expect(pitchSceneV3Schema.safeParse(windows(2_900)).success).toBe(false);
    expect(pitchSceneV3Schema.safeParse(windows(0)).success).toBe(false);
  });

  it('does not impose the photo repeat gap on a clip, and says why in its own rule', () => {
    // The photo rule refuses (photo, framing) inside 3 shots. Two DIFFERENT windows of
    // one clip two shots apart are new footage, so v3 accepts them...
    expect(
      pitchSceneV3Schema.safeParse(
        withTimeline([photoShot(2_000), clipShot(1, 0, 2_000), clipShot(1, 5_000, 2_000)]),
      ).success,
    ).toBe(true);
    // ...while the photo rule itself is untouched.
    expect(
      pitchSceneV3Schema.safeParse(
        withTimeline([photoShot(2_000, 1), photoShot(2_000, 2), photoShot(2_000, 1)]),
      ).success,
    ).toBe(false);
  });
});

describe('pitchSceneV3Schema — a clip may carry a wordPop and nothing else', () => {
  const clipEffect = (effect: JsonRecord) => (scene: JsonRecord) => {
    (shotAt(scene, FIRST_CLIP_SHOT).effects as unknown[]).push(effect);
  };

  it('rejects every still-photo effect on a clip shot', () => {
    expect(
      clipEffectAccepted({
        type: 'kenBurns',
        to: { x: 0, y: 0, width: 0.96, height: 0.96 },
        easing: 'linear',
      }),
    ).toBe(false);
    expect(
      clipEffectAccepted({
        type: 'punch',
        atMs: 13_000,
        durationMs: 200,
        scale: 1.05,
        easing: 'easeOut',
      }),
    ).toBe(false);
    expect(clipEffectAccepted({ type: 'backdropBlur', radiusPx: 24, dim: 0.3 })).toBe(false);
    expect(
      clipEffectAccepted({
        type: 'kineticText',
        source: 'good_match_for',
        revealMs: 200,
        easing: 'linear',
        emphasis: 0.5,
      }),
    ).toBe(false);
    expect(clipEffectAccepted({ type: 'speedRamp', to: 0.5 })).toBe(false);
  });

  function clipEffectAccepted(effect: JsonRecord): boolean {
    return accepts(clipEffect(effect));
  }

  it('accepts a wordPop on a clip and holds it to the same bounds as on a photo', () => {
    // Shot 5 runs 12000..16000 and already pops at 12500..12900.
    expect(
      accepts((scene) => setPath(scene, ['shots', FIRST_CLIP_SHOT, 'effects', 0, 'endMs'], 12_620)),
    ).toBe(true);
    expect(
      accepts((scene) => setPath(scene, ['shots', FIRST_CLIP_SHOT, 'effects', 0, 'endMs'], 12_619)),
    ).toBe(false);
    expect(
      accepts((scene) => setPath(scene, ['shots', FIRST_CLIP_SHOT, 'effects', 0, 'endMs'], 13_700)),
    ).toBe(true);
    expect(
      accepts((scene) => setPath(scene, ['shots', FIRST_CLIP_SHOT, 'effects', 0, 'endMs'], 13_701)),
    ).toBe(false);
    // ...and inside its own shot.
    expect(
      accepts((scene) =>
        setPath(scene, ['shots', FIRST_CLIP_SHOT, 'effects', 0, 'startMs'], 11_900),
      ),
    ).toBe(false);
  });

  it('refuses to pop the same word on a clip that a photo already popped', () => {
    expect(
      accepts((scene) =>
        setPath(scene, ['shots', FIRST_CLIP_SHOT, 'effects', 0, 'word'], {
          segmentIndex: 0,
          wordIndex: 3,
        }),
      ),
    ).toBe(false);
  });

  it('caps wordPops per clip shot at the photo number', () => {
    // The clip shot lands at 2000..5000 once withTimeline has placed the photo before
    // it, so the pops are written where they will end up.
    const pops = (count: number): PitchShotV3 => ({
      ...(clipShot(1, 0, 3_000) as Extract<PitchShotV3, { level: 'clip' }>),
      effects: Array.from({ length: count }, (_value, index) => ({
        type: 'wordPop' as const,
        word: { segmentIndex: 0, wordIndex: index },
        // 400ms apart, which clears the 334ms flash budget by design.
        startMs: 2_100 + index * 400,
        endMs: 2_300 + index * 400,
        scale: 1.2,
        easing: 'easeOut' as const,
      })),
    });
    expect(
      pitchSceneV3Schema.safeParse(withTimeline([photoShot(2_000), pops(MAX_WORD_POPS_PER_SHOT)]))
        .success,
    ).toBe(true);
    expect(
      pitchSceneV3Schema.safeParse(
        withTimeline([photoShot(2_000), pops(MAX_WORD_POPS_PER_SHOT + 1)]),
      ).success,
    ).toBe(false);
  });
});

describe('pitchSceneV3Schema — viewer safety with clips on the timeline', () => {
  it('exempts a clip shot from the "nothing may sit still" rule', () => {
    // A photo this long must carry a travelling kenBurns; a clip may not carry one at
    // all, because the clip itself is the movement.
    expect(
      pitchSceneV3Schema.safeParse(
        withTimeline([photoShot(2_000), clipShot(1, 0, MAX_STATIC_SHOT_MS + 1)]),
      ).success,
    ).toBe(true);
    expect(
      pitchSceneV3Schema.safeParse(withTimeline([photoShot(2_000), photoShot(2_000, 2)])).success,
    ).toBe(true);
  });

  it('counts a wordPop on a clip against the flash budget', () => {
    // The example's clip pop is at 12500, the previous event (a punch) at 10200. Add a
    // second pop on the same clip and the two must stay 334ms apart.
    const secondPop = (startMs: number) => (scene: JsonRecord) => {
      (shotAt(scene, FIRST_CLIP_SHOT).effects as unknown[]).push({
        type: 'wordPop',
        word: { segmentIndex: 2, wordIndex: 4 },
        startMs,
        endMs: startMs + 200,
        scale: 1.2,
        easing: 'easeOut',
      });
    };
    expect(accepts(secondPop(12_500 + MIN_FLASH_INTERVAL_MS))).toBe(true);
    expect(accepts(secondPop(12_500 + MIN_FLASH_INTERVAL_MS - 1))).toBe(false);
  });

  it('does not count a clip shot itself as a flash event', () => {
    expect(pitchSceneV3FlashEvents(validScene())).toEqual([
      3_600, 4_300, 5_500, 6_000, 7_400, 10_200, 12_500,
    ]);
    const clipsOnly = withTimeline([
      photoShot(2_000),
      clipShot(1, 0, 1_200),
      clipShot(2, 0, 1_200),
      clipShot(3, 0, 1_200),
    ]);
    const parsed = pitchSceneV3Schema.safeParse(clipsOnly);
    expect(parsed.error?.issues ?? []).toEqual([]);
    expect(pitchSceneV3FlashEvents(parsed.data as PitchSceneV3)).toEqual([]);
  });
});

// --- The superset property, measured -----------------------------------------
//
// v3 re-declares v2's shape because v2's schemas are module-private. So the claim
// "v3 accepts exactly the v2 scenes v2 accepts, with schemaVersion bumped" is a
// COPY, and a copy is a place for a typo to hide a loosened bound. These two suites
// are how it stops being a claim: the same mutation is applied to the same scene for
// both parsers and the verdicts must match, over every numeric leaf, a list of
// structural edits, and every golden vector.

const V2_EXAMPLE = examplePitchSceneV2();

function bumped(scene: unknown): unknown {
  const copy = structuredClone(scene) as JsonRecord;
  copy.schemaVersion = PITCH_SCENE_V3_SCHEMA_VERSION;
  return copy;
}

function numericPaths(value: unknown, prefix: readonly (string | number)[]): (string | number)[][] {
  if (typeof value === 'number') {
    return [[...prefix]];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) =>
      // The baked envelope is 144 identical-in-kind samples; two of them prove the
      // bound and the rest only slow the sweep down.
      prefix.at(-1) === 'amplitudes' && index !== 0 && index !== value.length - 1
        ? []
        : numericPaths(entry, [...prefix, index]),
    );
  }
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).flatMap(([key, entry]) =>
      // schemaVersion is the ONE field that must differ between the two copies.
      key === 'schemaVersion' ? [] : numericPaths(entry, [...prefix, key]),
    );
  }
  return [];
}

describe('pitchSceneV3Schema — every v2 bound answers alike in v3', () => {
  const CANDIDATES: readonly unknown[] = [-1, 0, 0.5, 1, 1e9, Number.NaN, 'x', null];

  it('agrees with the v2 parser on every numeric leaf of the shared example', () => {
    const paths = numericPaths(V2_EXAMPLE, []);
    expect(paths.length).toBeGreaterThan(40);
    let rejected = 0;
    for (const path of paths) {
      for (const candidate of CANDIDATES) {
        const v2 = structuredClone(V2_EXAMPLE) as unknown as JsonRecord;
        setPath(v2, path, candidate);
        const v3 = bumped(v2);
        const v2Verdict = pitchSceneV2Schema.safeParse(v2).success;
        const v3Verdict = pitchSceneV3Schema.safeParse(v3).success;
        expect(v3Verdict, `${path.join('.')} = ${String(candidate)}`).toBe(v2Verdict);
        if (!v2Verdict) {
          rejected += 1;
        }
      }
    }
    // Not a vacuous sweep: most of those mutations really are rejections.
    expect(rejected).toBeGreaterThan(paths.length * 4);
  });

  it('agrees with the v2 parser on a list of structural edits', () => {
    const edits: readonly {
      readonly name: string;
      readonly apply: (scene: JsonRecord) => void;
    }[] = [
      { name: 'no mutation', apply: () => {} },
      {
        name: 'drop the look',
        apply: (scene) => {
          delete scene.look;
        },
      },
      {
        name: 'drop the grain seed',
        apply: (scene) => {
          delete (scene.look as { grain: JsonRecord }).grain.seed;
        },
      },
      { name: 'unknown scene key', apply: (scene) => setPath(scene, ['music'], { bpm: 120 }) },
      { name: 'unknown shot key', apply: (scene) => setPath(scene, ['shots', 0, 'zIndex'], 1) },
      {
        name: 'unknown chrome key',
        apply: (scene) => setPath(scene, ['chrome', 'watermark'], {}),
      },
      { name: 'caption on the scene', apply: (scene) => setPath(scene, ['caption'], 'hello') },
      {
        name: 'text on a photo shot',
        apply: (scene) => setPath(scene, ['shots', 0, 'text'], 'hello'),
      },
      {
        name: 'deferred effect',
        apply: (scene) => {
          (shotAt(scene, 5).effects as unknown[]).push({ type: 'parallax', intensity: 0.5 });
        },
      },
      {
        name: 'kineticText in the photo effect union',
        apply: (scene) => {
          (shotAt(scene, 5).effects as unknown[]).push({
            type: 'kineticText',
            source: 'good_match_for',
            revealMs: 200,
            easing: 'linear',
            emphasis: 0.5,
          });
        },
      },
      { name: 'unknown level', apply: (scene) => setPath(scene, ['shots', 5, 'level'], 'closeUp') },
      { name: 'unknown template', apply: (scene) => setPath(scene, ['template'], 'cinematic') },
      {
        name: 'unknown text source',
        apply: (scene) => setPath(scene, ['shots', 3, 'text', 'source'], 'headline'),
      },
      {
        name: 'unknown easing',
        apply: (scene) => setPath(scene, ['shots', 0, 'effects', 0, 'easing'], 'bounceOut'),
      },
      {
        name: 'photo field on a card',
        apply: (scene) => setPath(scene, ['shots', 3, 'assetId'], photoId(1)),
      },
      {
        name: 'second kenBurns',
        apply: (scene) => {
          (shotAt(scene, 0).effects as unknown[]).push({
            type: 'kenBurns',
            to: { x: 0.04, y: 0.04, width: 0.96, height: 0.96 },
            easing: 'linear',
          });
        },
      },
      {
        name: 'kenBurns that does not travel',
        apply: (scene) =>
          setPath(scene, ['shots', 0, 'effects', 0, 'to'], {
            x: 0,
            y: 0,
            width: 0.995,
            height: 0.995,
          }),
      },
      {
        name: 'non-square crop',
        apply: (scene) =>
          setPath(scene, ['shots', 2, 'crop'], { x: 0.1, y: 0.1, width: 0.8, height: 0.7 }),
      },
      {
        name: 'crop outside the frame',
        apply: (scene) =>
          setPath(scene, ['shots', 2, 'crop'], { x: 0.4, y: 0.1, width: 0.7, height: 0.7 }),
      },
      {
        name: 'undeclared photo',
        apply: (scene) => setPath(scene, ['shots', 5, 'assetId'], photoId(9)),
      },
      {
        name: 'unused declared photo',
        apply: (scene) => {
          (scene.assetIds as string[]).push(photoId(9));
        },
      },
      {
        name: 'repeated assetIds entry',
        apply: (scene) => setPath(scene, ['assetIds', 1], photoId(1)),
      },
      { name: 'empty assetIds', apply: (scene) => setPath(scene, ['assetIds'], []) },
      {
        name: 'gap in the timeline',
        apply: (scene) => setPath(scene, ['shots', 1, 'startMs'], 3_100),
      },
      { name: 'duration past the shots', apply: (scene) => setPath(scene, ['durationMs'], 14_500) },
      {
        name: 'envelope one sample short',
        apply: (scene) => {
          (((scene.chrome as JsonRecord).waveViz as JsonRecord).amplitudes as number[]).pop();
        },
      },
      {
        name: 'envelope past the sample ceiling',
        apply: (scene) => {
          setPath(scene, ['durationMs'], 600_000);
          setPath(scene, ['chrome', 'waveViz', 'sampleIntervalMs'], 40);
          setPath(
            scene,
            ['chrome', 'waveViz', 'amplitudes'],
            Array.from({ length: 15_000 }, () => 0.5),
          );
        },
      },
      {
        name: 'overlay past the scene',
        apply: (scene) => setPath(scene, ['overlays', 1, 'endMs'], 14_500),
      },
      {
        name: 'two cards in a row',
        apply: (scene) => setPath(scene, ['shots', 4, 'level'], 'typographic'),
      },
      {
        name: 'flash budget',
        apply: (scene) => setPath(scene, ['shots', 1, 'effects', 1, 'startMs'], 3_700),
      },
    ];

    for (const edit of edits) {
      const v2 = structuredClone(V2_EXAMPLE) as unknown as JsonRecord;
      edit.apply(v2);
      const v3 = bumped(v2);
      expect(pitchSceneV3Schema.safeParse(v3).success, edit.name).toBe(
        pitchSceneV2Schema.safeParse(v2).success,
      );
    }
  });

  it('agrees with the v2 parser on every golden vector', () => {
    for (const vector of PITCH_SCENE_GOLDEN_VECTORS) {
      expect(pitchSceneV3Schema.safeParse(bumped(vector.scene)).success, vector.name).toBe(
        pitchSceneV2Schema.safeParse(vector.scene).success,
      );
    }
  });

  it('accepts the v2 example itself with nothing but the version changed', () => {
    const parsed = pitchSceneV3Schema.safeParse(bumped(V2_EXAMPLE));

    expect(parsed.error?.issues ?? []).toEqual([]);
    // ...and the parse adds nothing: no defaulted clipAssetIds, no normalisation.
    expect(parsed.data).toEqual(bumped(V2_EXAMPLE));
  });
});

// --- Reading the three versions ---------------------------------------------

describe('pitchScene — v1, v2 and v3 coexist', () => {
  const v1 = (): PitchSceneV1 =>
    buildPitchSceneV1({
      photoAssetIds: [photoId(1), photoId(2)],
      segments: Array.from({ length: 4 }, (_value, index) => ({
        startMs: index * 5_000,
        endMs: (index + 1) * 5_000,
      })),
    }) as PitchSceneV1;

  it('never lets one version satisfy another', () => {
    expect(pitchSceneV1Schema.safeParse(validScene()).success).toBe(false);
    expect(pitchSceneV2Schema.safeParse(validScene()).success).toBe(false);
    expect(pitchSceneV3Schema.safeParse(v1()).success).toBe(false);
    expect(pitchSceneV3Schema.safeParse(V2_EXAMPLE).success).toBe(false);
  });

  it('accepts all three through the v3-aware union', () => {
    expect(pitchSceneAnySchema.safeParse(v1()).success).toBe(true);
    expect(pitchSceneAnySchema.safeParse(V2_EXAMPLE).success).toBe(true);
    expect(pitchSceneAnySchema.safeParse(validScene()).success).toBe(true);
  });

  it('leaves the v1/v2 union closed, so a player that cannot draw video falls back', () => {
    // Not an oversight: null already means "no scene, fall back" on every surface, and
    // a v2-era player must degrade to photos-and-voice rather than silently drop a
    // clip shot and play a timeline with a hole in it.
    expect(pitchSceneSchema.safeParse(validScene()).success).toBe(false);
    expect(parsePitchScene(validScene())).toBeNull();
  });

  it('discriminates on schemaVersion when parsing', () => {
    const parsedV1 = parseAnyPitchScene(v1());
    const parsedV2 = parseAnyPitchScene(V2_EXAMPLE);
    const parsedV3 = parseAnyPitchScene(validScene());

    expect(parsedV1 !== null && isPitchSceneAnyV1(parsedV1)).toBe(true);
    expect(parsedV2 !== null && isPitchSceneAnyV2(parsedV2)).toBe(true);
    expect(parsedV3 !== null && isPitchSceneV3(parsedV3)).toBe(true);
    expect(parsedV3 !== null && isPitchSceneAnyV2(parsedV3)).toBe(false);
    expect(parsedV3 !== null && isPitchSceneAnyV1(parsedV3)).toBe(false);
    expect(parsedV1 !== null && isPitchSceneV3(parsedV1)).toBe(false);
    // The v2 file's own guards still answer for a v2 scene parsed by the v2 reader.
    const v2Only = parsePitchScene(V2_EXAMPLE);
    expect(v2Only !== null && isPitchSceneV2(v2Only)).toBe(true);
    expect(v2Only !== null && isPitchSceneV1(v2Only)).toBe(false);
  });

  it('narrows to the version it reports', () => {
    const parsed = parseAnyPitchScene(validScene());
    if (parsed === null || !isPitchSceneV3(parsed)) {
      throw new Error('expected a v3 scene');
    }
    // Compiles only because the guard narrowed the union.
    expect(parsed.clipAssetIds?.length).toBe(3);
    expect(parsed.shots.filter((shot) => shot.level === 'clip').length).toBe(4);

    // ...and the v2 branch narrows the same way, which is what makes a three-version
    // reader writable at all.
    const v2Scene = parseAnyPitchScene(V2_EXAMPLE);
    if (v2Scene === null || !isPitchSceneAnyV2(v2Scene)) {
      throw new Error('expected a v2 scene');
    }
    expect(v2Scene.shots.length).toBe(6);
  });

  it('returns null for a version it does not know, and for junk', () => {
    expect(parseAnyPitchScene({ ...validScene(), schemaVersion: 4 })).toBeNull();
    expect(parseAnyPitchScene(null)).toBeNull();
    expect(parseAnyPitchScene('a scene')).toBeNull();
    expect(parseAnyPitchScene({})).toBeNull();
    expect(parseAnyPitchScene({ schemaVersion: 3 })).toBeNull();
  });
});
