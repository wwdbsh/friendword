import { describe, expect, it } from 'vitest';

import {
  buildPitchSceneV1,
  PITCH_SCENE_CANVAS,
  pitchSceneV1Schema,
  type PitchSceneSegment,
  type PitchSceneV1,
} from './pitchScene';
import {
  CROP_LEVEL_MIN_SIZE,
  examplePitchSceneV2,
  isPitchSceneV1,
  isPitchSceneV2,
  lightLeakFlashPeaks,
  MAX_FLICKER_HZ,
  MAX_GRAIN_ANIMATION_HZ,
  MAX_GRAIN_INTENSITY,
  MAX_SHOT_DURATION_MS,
  MAX_STATIC_SHOT_MS,
  MIN_FLASH_INTERVAL_MS,
  MIN_LADDER_REPEAT_GAP_SHOTS,
  MIN_SHOT_DURATION_MS,
  parsePitchScene,
  PITCH_EASINGS,
  PITCH_SCENE_TEMPLATES,
  PITCH_SCENE_V2_SCHEMA_VERSION,
  PITCH_SHOT_LEVELS,
  PITCH_TEXT_SOURCES,
  pitchSceneSchema,
  pitchSceneV2Schema,
  type PitchCropRect,
  type PitchPhotoShotLevel,
  type PitchSceneV2,
  type PitchShotV2,
  type PitchTextSource,
} from './pitchSceneV2';

type JsonRecord = Record<string, unknown>;

const assetId = (index: number): string =>
  `40000000-0000-0000-0000-${String(index).padStart(12, '0')}`;

const square = (x: number, y: number, size: number): PitchCropRect => ({
  x,
  y,
  width: size,
  height: size,
});

const FIXTURE_DURATION_MS = 14_400;

function amplitudes(durationMs: number, intervalMs: number): number[] {
  return Array.from(
    { length: Math.ceil(durationMs / intervalMs) },
    (_value, index) => (index % 10) / 10,
  );
}

/**
 * The canonical example, exported from the contract itself so the DB, web and
 * mobile surfaces share one scene with these tests. Every mutation below starts
 * from it.
 */
const validScene = examplePitchSceneV2;

function mutate(apply: (scene: JsonRecord) => void): unknown {
  const copy = structuredClone(validScene()) as unknown as JsonRecord;
  apply(copy);
  return copy;
}

function accepts(apply: (scene: JsonRecord) => void): boolean {
  return pitchSceneV2Schema.safeParse(mutate(apply)).success;
}

function shotAt(scene: JsonRecord, index: number): JsonRecord {
  return (scene.shots as JsonRecord[])[index] as JsonRecord;
}

function effectAt(scene: JsonRecord, shotIndex: number, effectIndex: number): JsonRecord {
  return (shotAt(scene, shotIndex).effects as JsonRecord[])[effectIndex] as JsonRecord;
}

function setPath(scene: JsonRecord, path: readonly (string | number)[], value: unknown): void {
  let cursor: JsonRecord = scene;
  for (const key of path.slice(0, -1)) {
    cursor = cursor[key as string] as JsonRecord;
  }
  cursor[path[path.length - 1] as string] = value;
}

/** Rewrites the timeline so a shot list of any lengths stays contiguous. */
function withTimeline(shots: readonly PitchShotV2[]): unknown {
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
  const used = placed
    .filter((shot) => shot.level !== 'typographic')
    .map((shot) => shot.assetId as string);
  scene.assetIds = [...new Set(used)];
  scene.overlays = [];
  scene.chrome = { progressBar: { thicknessPx: 4, opacity: 0.6, anchor: 'bottom' } };
  return scene;
}

function photoShot(
  level: PitchPhotoShotLevel,
  asset: number,
  durationMs: number,
  options: { readonly kenBurns?: boolean } = {},
): PitchShotV2 {
  const size = CROP_LEVEL_MIN_SIZE[level];
  const crop = square(0, 0, size);
  const kenBurns = options.kenBurns ?? durationMs > MAX_STATIC_SHOT_MS;
  return {
    level,
    assetId: assetId(asset),
    startMs: 0,
    endMs: durationMs,
    crop,
    effects: kenBurns
      ? [{ type: 'kenBurns', to: square(0, 1 - size, size), easing: 'linear' }]
      : [],
  };
}

function textShot(durationMs: number, source: PitchTextSource): PitchShotV2 {
  return {
    level: 'typographic',
    startMs: 0,
    endMs: durationMs,
    text: { type: 'kineticText', source, revealMs: 300, easing: 'easeOut', emphasis: 0.5 },
  };
}

describe('pitchSceneV2Schema — the shape', () => {
  it('accepts a scene that uses every effect in the vocabulary', () => {
    const parsed = pitchSceneV2Schema.safeParse(validScene());

    expect(parsed.error?.issues ?? []).toEqual([]);
    expect(parsed.success).toBe(true);
  });

  it('exports the canonical example every surface will share', () => {
    // Annotated on purpose: if the inferred type and the exported example ever
    // diverge, this stops compiling.
    const scene: PitchSceneV2 = examplePitchSceneV2();

    expect(scene.durationMs).toBe(FIXTURE_DURATION_MS);
    expect(scene.assetIds).toEqual([assetId(1), assetId(2), assetId(3), assetId(4)]);
    expect(scene.shots.map((shot) => shot.level)).toEqual([
      'wide',
      'punchIn',
      'detail',
      'typographic',
      'wideAlt',
      'wide',
    ]);
    // A fresh object each call, so a caller may mutate it, but always the same one.
    expect(examplePitchSceneV2()).not.toBe(scene);
    expect(examplePitchSceneV2()).toEqual(scene);
  });

  it('keeps the v1 canvas', () => {
    expect(validScene().canvas).toEqual({ ...PITCH_SCENE_CANVAS });
    expect(validScene().canvas).toEqual({ width: 1080, height: 1920, fps: 30 });
    expect(accepts((scene) => setPath(scene, ['canvas', 'fps'], 0))).toBe(false);
  });

  it('pins the schema version', () => {
    expect(PITCH_SCENE_V2_SCHEMA_VERSION).toBe(2);
    expect(accepts((scene) => setPath(scene, ['schemaVersion'], 3))).toBe(false);
    expect(accepts((scene) => setPath(scene, ['schemaVersion'], 1))).toBe(false);
  });

  it('offers exactly two templates', () => {
    expect(PITCH_SCENE_TEMPLATES).toEqual(['warm', 'hype']);
    expect(accepts((scene) => setPath(scene, ['template'], 'hype'))).toBe(true);
    expect(accepts((scene) => setPath(scene, ['template'], 'cinematic'))).toBe(false);
    expect(accepts((scene) => setPath(scene, ['template'], ''))).toBe(false);
  });
});

describe('pitchSceneV2Schema — no text can enter a scene', () => {
  const TOKENS = new Set<string>([
    ...PITCH_SHOT_LEVELS,
    ...PITCH_SCENE_TEMPLATES,
    ...PITCH_TEXT_SOURCES,
    ...PITCH_EASINGS,
    'top',
    'bottom',
    'kenBurns',
    'punch',
    'wordPop',
    'backdropBlur',
    'kineticText',
    'lightLeak',
    'countBadge',
  ]);
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

  function collectStrings(value: unknown, found: string[]): void {
    if (typeof value === 'string') {
      found.push(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const entry of value) {
        collectStrings(entry, found);
      }
      return;
    }
    if (typeof value === 'object' && value !== null) {
      for (const entry of Object.values(value)) {
        collectStrings(entry, found);
      }
    }
  }

  it('holds no string that is not a uuid or a closed-enum token', () => {
    const found: string[] = [];
    collectStrings(validScene(), found);

    expect(found.length).toBeGreaterThan(0);
    for (const value of found) {
      expect(TOKENS.has(value) || UUID.test(value), value).toBe(true);
    }
  });

  it('rejects a caption smuggled onto a shot, an effect or the scene', () => {
    expect(accepts((scene) => setPath(scene, ['shots', 0, 'text'], 'copy nobody approved'))).toBe(
      false,
    );
    expect(
      accepts((scene) => setPath(scene, ['shots', 3, 'text', 'value'], 'copy nobody approved')),
    ).toBe(false);
    expect(accepts((scene) => setPath(scene, ['caption'], 'copy nobody approved'))).toBe(false);
    expect(accepts((scene) => setPath(scene, ['overlays', 0, 'label'], 'three things'))).toBe(
      false,
    );
  });

  it('rejects a font or a colour, because the template owns both', () => {
    expect(accepts((scene) => setPath(scene, ['look', 'fontFamily'], 'Inter'))).toBe(false);
    expect(accepts((scene) => setPath(scene, ['look', 'grade', 'tint'], '#ff8800'))).toBe(false);
  });

  it('names a text card by reference to a reviewed field, never by content', () => {
    expect(PITCH_TEXT_SOURCES).toEqual([
      'hook',
      'relationship_context',
      'quality:0',
      'quality:1',
      'quality:2',
      'evidence_or_anecdote',
      'good_match_for',
    ]);
    for (const source of PITCH_TEXT_SOURCES) {
      expect(accepts((scene) => setPath(scene, ['shots', 3, 'text', 'source'], source))).toBe(true);
    }
    expect(accepts((scene) => setPath(scene, ['shots', 3, 'text', 'source'], 'quality:3'))).toBe(
      false,
    );
    expect(accepts((scene) => setPath(scene, ['shots', 3, 'text', 'source'], 'headline'))).toBe(
      false,
    );
  });

  it('identifies a popped word by transcript index only', () => {
    expect(
      Object.keys(effectAt(validScene() as unknown as JsonRecord, 1, 1).word as JsonRecord),
    ).toEqual(['segmentIndex', 'wordIndex']);
    expect(
      accepts((scene) => setPath(scene, ['shots', 1, 'effects', 1, 'word', 'text'], 'kind')),
    ).toBe(false);
  });
});

describe('pitchSceneV2Schema — the union is closed, not lenient', () => {
  it('rejects the effects deferred past v2 rather than ignoring them', () => {
    for (const type of ['parallax', 'maskReveal', 'sticker', 'speedRamp']) {
      expect(
        accepts((scene) => {
          (shotAt(scene, 5).effects as unknown[]).push({ type, intensity: 0.5 });
        }),
        type,
      ).toBe(false);
    }
  });

  it('rejects an unknown key inside a known effect', () => {
    expect(accepts((scene) => setPath(scene, ['shots', 0, 'effects', 0, 'rotate'], 3))).toBe(false);
    expect(accepts((scene) => setPath(scene, ['shots', 1, 'effects', 0, 'bounce'], true))).toBe(
      false,
    );
  });

  it('rejects an unknown key on a shot, a layer and the scene root', () => {
    expect(accepts((scene) => setPath(scene, ['shots', 0, 'zIndex'], 2))).toBe(false);
    expect(accepts((scene) => setPath(scene, ['chrome', 'watermark'], {}))).toBe(false);
    expect(accepts((scene) => setPath(scene, ['music'], { bpm: 120 }))).toBe(false);
  });

  it('rejects an unknown ladder level and an unknown easing', () => {
    expect(accepts((scene) => setPath(scene, ['shots', 5, 'level'], 'closeUp'))).toBe(false);
    expect(
      accepts((scene) => setPath(scene, ['shots', 0, 'effects', 0, 'easing'], 'bounceOut')),
    ).toBe(false);
  });

  it('rejects a photo field on a text card and a text field on a photo shot', () => {
    expect(accepts((scene) => setPath(scene, ['shots', 3, 'assetId'], assetId(1)))).toBe(false);
    expect(
      accepts((scene) =>
        setPath(scene, ['shots', 5, 'text'], {
          type: 'kineticText',
          source: 'hook',
          revealMs: 200,
          easing: 'linear',
          emphasis: 0.5,
        }),
      ),
    ).toBe(false);
  });

  it('keeps kineticText out of the photo effect union', () => {
    expect(
      accepts((scene) => {
        (shotAt(scene, 5).effects as unknown[]).push({
          type: 'kineticText',
          source: 'good_match_for',
          revealMs: 200,
          easing: 'linear',
          emphasis: 0.5,
        });
      }),
    ).toBe(false);
  });
});

describe('pitchSceneV2Schema — the 1200ms shot floor', () => {
  it('is 1200ms', () => {
    expect(MIN_SHOT_DURATION_MS).toBe(1_200);
  });

  it('accepts a shot exactly at the floor and rejects one millisecond under', () => {
    expect(pitchSceneV2Schema.safeParse(withTimeline([photoShot('wide', 1, 1_200)])).success).toBe(
      true,
    );
    expect(pitchSceneV2Schema.safeParse(withTimeline([photoShot('wide', 1, 1_199)])).success).toBe(
      false,
    );
  });

  it('rejects a short shot in the middle of a legal timeline', () => {
    const shots = [
      photoShot('wide', 1, 2_000),
      photoShot('punchIn', 2, 1_199),
      photoShot('detail', 3, 2_000),
    ];
    expect(pitchSceneV2Schema.safeParse(withTimeline(shots)).success).toBe(false);
  });

  it('accepts a shot exactly at the ceiling and rejects one millisecond over', () => {
    expect(
      pitchSceneV2Schema.safeParse(withTimeline([photoShot('wide', 1, MAX_SHOT_DURATION_MS)]))
        .success,
    ).toBe(true);
    expect(
      pitchSceneV2Schema.safeParse(withTimeline([photoShot('wide', 1, MAX_SHOT_DURATION_MS + 1)]))
        .success,
    ).toBe(false);
  });

  it('rejects a gap, an overlap and a cover that misses the duration', () => {
    expect(accepts((scene) => setPath(scene, ['shots', 1, 'startMs'], 3_100))).toBe(false);
    expect(accepts((scene) => setPath(scene, ['shots', 1, 'startMs'], 2_900))).toBe(false);
    expect(accepts((scene) => setPath(scene, ['durationMs'], 14_500))).toBe(false);
    expect(accepts((scene) => setPath(scene, ['shots', 0, 'startMs'], 100))).toBe(false);
  });
});

describe('pitchSceneV2Schema — nothing may sit still', () => {
  it('demands a kenBurns on a photo shot longer than the static ceiling', () => {
    expect(
      pitchSceneV2Schema.safeParse(
        withTimeline([photoShot('wide', 1, MAX_STATIC_SHOT_MS + 1, { kenBurns: false })]),
      ).success,
    ).toBe(false);
    expect(
      pitchSceneV2Schema.safeParse(
        withTimeline([photoShot('wide', 1, MAX_STATIC_SHOT_MS, { kenBurns: false })]),
      ).success,
    ).toBe(true);
  });

  it('rejects a kenBurns that does not travel', () => {
    expect(
      accepts((scene) => setPath(scene, ['shots', 0, 'effects', 0, 'to'], square(0, 0, 1))),
    ).toBe(false);
    expect(
      accepts((scene) => setPath(scene, ['shots', 0, 'effects', 0, 'to'], square(0, 0, 0.99))),
    ).toBe(false);
    expect(
      accepts((scene) => setPath(scene, ['shots', 0, 'effects', 0, 'to'], square(0, 0, 0.98))),
    ).toBe(true);
  });

  it('caps a text card at the static ceiling and never lets two follow each other', () => {
    expect(
      pitchSceneV2Schema.safeParse(
        withTimeline([photoShot('wide', 1, 2_000), textShot(MAX_STATIC_SHOT_MS, 'hook')]),
      ).success,
    ).toBe(true);
    expect(
      pitchSceneV2Schema.safeParse(
        withTimeline([photoShot('wide', 1, 2_000), textShot(MAX_STATIC_SHOT_MS + 1, 'hook')]),
      ).success,
    ).toBe(false);
    expect(
      pitchSceneV2Schema.safeParse(
        withTimeline([
          photoShot('wide', 1, 2_000),
          textShot(2_000, 'hook'),
          textShot(2_000, 'good_match_for'),
        ]),
      ).success,
    ).toBe(false);
  });

  it('refuses a scene made only of text cards', () => {
    expect(pitchSceneV2Schema.safeParse(withTimeline([textShot(2_000, 'hook')])).success).toBe(
      false,
    );
  });

  it('refuses to show the same sentence as a card twice', () => {
    expect(
      pitchSceneV2Schema.safeParse(
        withTimeline([
          textShot(2_000, 'hook'),
          photoShot('wide', 1, 2_000),
          textShot(2_000, 'hook'),
        ]),
      ).success,
    ).toBe(false);
  });
});

describe('pitchSceneV2Schema — the crop ladder', () => {
  it('exposes five levels, four of them photo framings', () => {
    expect(PITCH_SHOT_LEVELS).toEqual(['wide', 'punchIn', 'detail', 'wideAlt', 'typographic']);
    expect(Object.keys(CROP_LEVEL_MIN_SIZE).sort()).toEqual([
      'detail',
      'punchIn',
      'wide',
      'wideAlt',
    ]);
  });

  it('keeps the two zoom ceilings the plan fixes', () => {
    expect(1 / CROP_LEVEL_MIN_SIZE.punchIn).toBeLessThanOrEqual(1.25);
    expect(1 / CROP_LEVEL_MIN_SIZE.detail).toBeLessThanOrEqual(1.5);
    // ... and they are real ceilings, not decoration.
    expect(1 / CROP_LEVEL_MIN_SIZE.punchIn).toBeGreaterThan(1.2);
    expect(1 / CROP_LEVEL_MIN_SIZE.detail).toBeGreaterThan(1.45);
  });

  it('pins the frozen ladder values', () => {
    // Written out rather than derived: the bounds tests below read the constants,
    // so without this a loosened ladder would move the goalposts silently.
    expect(CROP_LEVEL_MIN_SIZE).toEqual({
      wide: 0.96,
      wideAlt: 0.86,
      punchIn: 0.8,
      detail: 0.67,
    });
  });

  it('rejects a zoom past the ladder whatever level asks for it', () => {
    for (const level of ['wide', 'punchIn', 'detail', 'wideAlt'] as const) {
      // 1/0.6 = 1.67x, past every level's ceiling.
      const tooTight = withTimeline([photoShot(level, 1, 2_000)]) as JsonRecord;
      setPath(tooTight, ['shots', 0, 'crop'], square(0, 0, 0.6));
      expect(pitchSceneV2Schema.safeParse(tooTight).success, level).toBe(false);
    }
  });

  it('accepts each level exactly at its tightest crop and rejects a hair tighter', () => {
    for (const level of ['wide', 'punchIn', 'detail', 'wideAlt'] as const) {
      const size = CROP_LEVEL_MIN_SIZE[level];
      expect(
        pitchSceneV2Schema.safeParse(withTimeline([photoShot(level, 1, 2_000)])).success,
        level,
      ).toBe(true);
      const tooTight = structuredClone(withTimeline([photoShot(level, 1, 2_000)])) as JsonRecord;
      setPath(tooTight, ['shots', 0, 'crop'], square(0, 0, size - 0.001));
      expect(pitchSceneV2Schema.safeParse(tooTight).success, level).toBe(false);
    }
  });

  it('rejects a crop that is not square, because a square crop is 9:16 in pixels', () => {
    expect(
      accepts((scene) =>
        setPath(scene, ['shots', 2, 'crop'], { x: 0.1, y: 0.1, width: 0.8, height: 0.7 }),
      ),
    ).toBe(false);
  });

  it('rejects a crop that leaves the reviewed frame', () => {
    expect(accepts((scene) => setPath(scene, ['shots', 2, 'crop'], square(0.4, 0.1, 0.7)))).toBe(
      false,
    );
    expect(accepts((scene) => setPath(scene, ['shots', 2, 'crop'], square(0.1, 0.4, 0.7)))).toBe(
      false,
    );
    expect(accepts((scene) => setPath(scene, ['shots', 2, 'crop'], square(0.3, 0.3, 0.7)))).toBe(
      true,
    );
    expect(accepts((scene) => setPath(scene, ['shots', 2, 'crop'], square(-0.01, 0.1, 0.7)))).toBe(
      false,
    );
  });

  it('bounds the kenBurns destination by the same level ceiling', () => {
    expect(
      accepts((scene) =>
        setPath(scene, ['shots', 0, 'effects', 0, 'to'], square(0, 0, CROP_LEVEL_MIN_SIZE.detail)),
      ),
    ).toBe(false);
  });

  it('counts the punch against the level ceiling', () => {
    // 1/0.9 * 1.1 = 1.22x, inside punchIn's 1.25x...
    expect(accepts((scene) => setPath(scene, ['shots', 1, 'effects', 0, 'scale'], 1.1))).toBe(true);
    // ...but the same punch on a crop already at the ceiling is not.
    expect(
      accepts((scene) => {
        setPath(scene, ['shots', 1, 'crop'], square(0, 0, CROP_LEVEL_MIN_SIZE.punchIn));
        setPath(scene, ['shots', 1, 'effects', 0, 'scale'], 1.1);
      }),
    ).toBe(false);
  });

  it('makes the same photo and framing wait out the repeat gap', () => {
    expect(MIN_LADDER_REPEAT_GAP_SHOTS).toBe(3);
    const withGap = [
      photoShot('wide', 1, 2_000),
      photoShot('punchIn', 1, 2_000),
      photoShot('detail', 1, 2_000),
      photoShot('wide', 1, 2_000),
    ];
    const withoutGap = [
      photoShot('wide', 1, 2_000),
      photoShot('punchIn', 1, 2_000),
      photoShot('wide', 1, 2_000),
    ];
    expect(pitchSceneV2Schema.safeParse(withTimeline(withGap)).success).toBe(true);
    expect(pitchSceneV2Schema.safeParse(withTimeline(withoutGap)).success).toBe(false);
  });
});

describe('pitchSceneV2Schema — the photo set', () => {
  it('rejects a shot referencing a photo the scene does not declare', () => {
    expect(accepts((scene) => setPath(scene, ['shots', 5, 'assetId'], assetId(9)))).toBe(false);
  });

  it('rejects a declared photo that never appears', () => {
    expect(
      accepts((scene) => {
        (scene.assetIds as string[]).push(assetId(9));
      }),
    ).toBe(false);
  });

  it('rejects a repeated or non-uuid entry in the declared set', () => {
    expect(accepts((scene) => setPath(scene, ['assetIds', 1], assetId(1)))).toBe(false);
    expect(accepts((scene) => setPath(scene, ['assetIds', 1], 'photo-two'))).toBe(false);
    expect(accepts((scene) => setPath(scene, ['assetIds'], []))).toBe(false);
  });

  it('lets one photo carry several shots, which is the whole point of v2', () => {
    const scene = validScene();
    const perAsset = new Map<string, number>();
    for (const shot of scene.shots) {
      if (shot.level !== 'typographic') {
        perAsset.set(shot.assetId, (perAsset.get(shot.assetId) ?? 0) + 1);
      }
    }
    expect(perAsset.get(assetId(1))).toBe(2);
  });
});

describe('pitchSceneV2Schema — viewer safety', () => {
  it('caps luminance-flash oscillation at 3Hz', () => {
    expect(MAX_FLICKER_HZ).toBe(3);
    expect(accepts((scene) => setPath(scene, ['overlays', 1, 'pulseHz'], 3))).toBe(true);
    expect(accepts((scene) => setPath(scene, ['overlays', 1, 'pulseHz'], 3.01))).toBe(false);
    expect(accepts((scene) => setPath(scene, ['overlays', 1, 'pulseHz'], 3.5))).toBe(false);
    expect(accepts((scene) => setPath(scene, ['overlays', 1, 'pulseHz'], -0.1))).toBe(false);
  });

  it('bounds grain by intensity rather than by frequency', () => {
    // Sub-pixel texture, not a flash: it may resample up to frame rate, and its
    // luminance swing is what the schema holds down.
    expect(MAX_GRAIN_ANIMATION_HZ).toBe(30);
    expect(MAX_GRAIN_INTENSITY).toBe(0.25);
    expect(accepts((scene) => setPath(scene, ['look', 'grain', 'animationHz'], 30))).toBe(true);
    expect(accepts((scene) => setPath(scene, ['look', 'grain', 'animationHz'], 30.01))).toBe(false);
    expect(accepts((scene) => setPath(scene, ['look', 'grain', 'animationHz'], -0.01))).toBe(false);
    expect(accepts((scene) => setPath(scene, ['look', 'grain', 'intensity'], 0.25))).toBe(true);
    expect(accepts((scene) => setPath(scene, ['look', 'grain', 'intensity'], 0.251))).toBe(false);
  });

  it('spaces momentary flashes at least one third of a second apart', () => {
    expect(MIN_FLASH_INTERVAL_MS).toBe(334);
    const addPunch = (atMs: number) => (scene: JsonRecord) => {
      (shotAt(scene, 1).effects as unknown[]).push({
        type: 'punch',
        atMs,
        durationMs: 120,
        scale: 1.05,
        easing: 'easeOut',
      });
    };
    // The fixture already punches at 3600.
    expect(accepts(addPunch(3_600 + MIN_FLASH_INTERVAL_MS))).toBe(true);
    expect(accepts(addPunch(3_600 + MIN_FLASH_INTERVAL_MS - 1))).toBe(false);
  });

  it('counts a punch and a light leak on the same flash budget', () => {
    // The fixture punches at 10_200. A light leak 200ms before it is a 5Hz
    // stimulus whatever the two types are called.
    const leakAt = (startMs: number) => (scene: JsonRecord) => {
      setPath(scene, ['overlays', 1, 'startMs'], startMs);
      setPath(scene, ['overlays', 1, 'endMs'], startMs + 300);
    };
    expect(accepts(leakAt(10_000))).toBe(false);
    expect(accepts(leakAt(10_200 - MIN_FLASH_INTERVAL_MS))).toBe(true);
  });

  it('bounds flash intensity', () => {
    expect(accepts((scene) => setPath(scene, ['overlays', 1, 'peakIntensity'], 0.6))).toBe(true);
    expect(accepts((scene) => setPath(scene, ['overlays', 1, 'peakIntensity'], 0.61))).toBe(false);
  });

  it('takes pulseHz in whole Hz only, so three implementations floor alike', () => {
    expect(accepts((scene) => setPath(scene, ['overlays', 1, 'pulseHz'], 2))).toBe(true);
    expect(accepts((scene) => setPath(scene, ['overlays', 1, 'pulseHz'], 2.5))).toBe(false);
    expect(accepts((scene) => setPath(scene, ['overlays', 1, 'pulseHz'], 0.5))).toBe(false);
  });
});

describe('lightLeakFlashPeaks — the pulse expansion three implementations share', () => {
  it('counts the appearance and every pulse inside the half-open interval', () => {
    // 3Hz repeats every floor(1000 / 3) = 333ms, which is why a leak this long is
    // rejected below: its own peaks are one millisecond inside the budget.
    expect(lightLeakFlashPeaks({ startMs: 1_000, endMs: 2_200, pulseHz: 3 })).toEqual([
      1_000, 1_333, 1_666, 2_000,
    ]);
    expect(lightLeakFlashPeaks({ startMs: 1_000, endMs: 2_200, pulseHz: 2 })).toEqual([
      1_000, 1_500, 2_000,
    ]);
    expect(lightLeakFlashPeaks({ startMs: 1_000, endMs: 2_200, pulseHz: 1 })).toEqual([
      1_000, 2_000,
    ]);
  });

  it('stops before a peak that lands exactly on endMs', () => {
    expect(lightLeakFlashPeaks({ startMs: 0, endMs: 1_000, pulseHz: 1 })).toEqual([0]);
    expect(lightLeakFlashPeaks({ startMs: 0, endMs: 1_001, pulseHz: 1 })).toEqual([0, 1_000]);
  });

  it('reads pulseHz 0 as one appearance rather than as no event', () => {
    expect(lightLeakFlashPeaks({ startMs: 700, endMs: 1_900, pulseHz: 0 })).toEqual([700]);
    expect(lightLeakFlashPeaks({ startMs: 700, endMs: 700, pulseHz: 0 })).toEqual([]);
  });
});

describe('pitchSceneV2Schema — the flash budget counts every appearance', () => {
  it('expands a light leak into its pulses instead of counting it once', () => {
    // The fixture leak runs 7400..7700. Widened to 1200ms it is legal at 2Hz (peaks
    // 500ms apart) and illegal at 3Hz (333ms apart) with nothing else changed.
    const widen = (pulseHz: number) => (scene: JsonRecord) => {
      setPath(scene, ['overlays', 1, 'endMs'], 8_600);
      setPath(scene, ['overlays', 1, 'pulseHz'], pulseHz);
    };
    expect(accepts(widen(2))).toBe(true);
    expect(accepts(widen(3))).toBe(false);
  });

  it('leaves out a pulse that would land exactly on the leak’s end', () => {
    const leakUntil = (endMs: number) => (scene: JsonRecord) => {
      setPath(scene, ['overlays', 1, 'pulseHz'], 3);
      setPath(scene, ['overlays', 1, 'endMs'], endMs);
    };
    // A second peak would land at 7733: outside [7400, 7733), inside [7400, 7734).
    expect(accepts(leakUntil(7_733))).toBe(true);
    expect(accepts(leakUntil(7_734))).toBe(false);
  });

  it('counts a wordPop appearance against the same budget as the punch above it', () => {
    // The fixture punches at 3600 and pops at 4300; moved to 3933 the pop is a 3Hz
    // stimulus with the punch, whatever the layer that drew it is called.
    const popAt = (startMs: number) => (scene: JsonRecord) => {
      setPath(scene, ['shots', 1, 'effects', 1, 'startMs'], startMs);
      setPath(scene, ['shots', 1, 'effects', 1, 'endMs'], startMs + 400);
    };
    expect(accepts(popAt(3_600 + MIN_FLASH_INTERVAL_MS))).toBe(true);
    expect(accepts(popAt(3_600 + MIN_FLASH_INTERVAL_MS - 1))).toBe(false);
  });

  it('counts two wordPops against each other', () => {
    const secondPop = (startMs: number) => (scene: JsonRecord) => {
      (shotAt(scene, 1).effects as unknown[]).push({
        type: 'wordPop',
        word: { segmentIndex: 0, wordIndex: 9 },
        startMs,
        endMs: startMs + 200,
        scale: 1.2,
        easing: 'easeOut',
      });
    };
    expect(accepts(secondPop(4_300 + MIN_FLASH_INTERVAL_MS))).toBe(true);
    expect(accepts(secondPop(4_300 + MIN_FLASH_INTERVAL_MS - 1))).toBe(false);
  });

  it('counts a countBadge appearance', () => {
    // The fixture badge opens at 5500 and the next pop is at 6000.
    const badgeAt = (startMs: number) => (scene: JsonRecord) => {
      setPath(scene, ['overlays', 0, 'startMs'], startMs);
    };
    expect(accepts(badgeAt(6_000 - MIN_FLASH_INTERVAL_MS))).toBe(true);
    expect(accepts(badgeAt(6_000 - MIN_FLASH_INTERVAL_MS + 1))).toBe(false);
  });
});

describe('pitchSceneV2Schema — effects stay inside their shot', () => {
  it('rejects a punch that straddles a cut', () => {
    expect(accepts((scene) => setPath(scene, ['shots', 1, 'effects', 0, 'atMs'], 5_300))).toBe(
      false,
    );
    expect(accepts((scene) => setPath(scene, ['shots', 1, 'effects', 0, 'atMs'], 2_900))).toBe(
      false,
    );
  });

  it('rejects a wordPop that straddles a cut', () => {
    expect(accepts((scene) => setPath(scene, ['shots', 1, 'effects', 1, 'endMs'], 5_500))).toBe(
      false,
    );
    expect(accepts((scene) => setPath(scene, ['shots', 1, 'effects', 1, 'startMs'], 2_800))).toBe(
      false,
    );
  });

  it('bounds how long a wordPop may hold', () => {
    // Shot 2 runs 5400..7600 and its pop starts at 6000, so both duration bounds
    // land inside the shot and it is the hold that is under test.
    expect(accepts((scene) => setPath(scene, ['shots', 2, 'effects', 1, 'endMs'], 6_120))).toBe(
      true,
    );
    expect(accepts((scene) => setPath(scene, ['shots', 2, 'effects', 1, 'endMs'], 6_119))).toBe(
      false,
    );
    expect(accepts((scene) => setPath(scene, ['shots', 2, 'effects', 1, 'endMs'], 7_200))).toBe(
      true,
    );
    expect(accepts((scene) => setPath(scene, ['shots', 2, 'effects', 1, 'endMs'], 7_201))).toBe(
      false,
    );
  });

  it('allows at most one kenBurns and one backdropBlur per shot', () => {
    expect(
      accepts((scene) => {
        (shotAt(scene, 0).effects as unknown[]).push({
          type: 'kenBurns',
          to: square(0.04, 0.04, 0.96),
          easing: 'linear',
        });
      }),
    ).toBe(false);
    expect(
      accepts((scene) => {
        (shotAt(scene, 2).effects as unknown[]).push({
          type: 'backdropBlur',
          radiusPx: 32,
          dim: 0.2,
        });
      }),
    ).toBe(false);
  });

  it('refuses to pop the same word twice, even from different shots', () => {
    expect(
      accepts((scene) =>
        setPath(scene, ['shots', 2, 'effects', 1, 'word'], {
          segmentIndex: 0,
          wordIndex: 3,
        }),
      ),
    ).toBe(false);
  });

  it('bounds a word reference', () => {
    expect(
      accepts((scene) => setPath(scene, ['shots', 1, 'effects', 1, 'word', 'wordIndex'], 999)),
    ).toBe(true);
    expect(
      accepts((scene) => setPath(scene, ['shots', 1, 'effects', 1, 'word', 'wordIndex'], 1_000)),
    ).toBe(false);
    expect(
      accepts((scene) => setPath(scene, ['shots', 1, 'effects', 1, 'word', 'segmentIndex'], -1)),
    ).toBe(false);
    expect(
      accepts((scene) => setPath(scene, ['shots', 1, 'effects', 1, 'word', 'wordIndex'], 2.5)),
    ).toBe(false);
  });
});

describe('pitchSceneV2Schema — overlays and baked layers', () => {
  it('keeps an overlay inside the scene', () => {
    expect(
      accepts((scene) => {
        setPath(scene, ['overlays', 1, 'startMs'], 14_100);
        setPath(scene, ['overlays', 1, 'endMs'], 14_400);
      }),
    ).toBe(true);
    expect(
      accepts((scene) => {
        setPath(scene, ['overlays', 1, 'startMs'], 14_300);
        setPath(scene, ['overlays', 1, 'endMs'], 14_500);
      }),
    ).toBe(false);
  });

  it('bounds how long each overlay type may last', () => {
    expect(accepts((scene) => setPath(scene, ['overlays', 1, 'endMs'], 7_520))).toBe(true);
    expect(accepts((scene) => setPath(scene, ['overlays', 1, 'endMs'], 7_519))).toBe(false);
    expect(accepts((scene) => setPath(scene, ['overlays', 1, 'endMs'], 8_600))).toBe(true);
    expect(accepts((scene) => setPath(scene, ['overlays', 1, 'endMs'], 8_601))).toBe(false);
    expect(accepts((scene) => setPath(scene, ['overlays', 0, 'endMs'], 5_900))).toBe(true);
    expect(accepts((scene) => setPath(scene, ['overlays', 0, 'endMs'], 5_899))).toBe(false);
  });

  it('refuses two overlays of the same type that overlap or arrive out of order', () => {
    const addBadge = (startMs: number, endMs: number) => (scene: JsonRecord) => {
      (scene.overlays as unknown[]).push({
        type: 'countBadge',
        source: 'quality:1',
        startMs,
        endMs,
        emphasis: 0.5,
      });
    };
    expect(accepts(addBadge(6_500, 7_500))).toBe(true);
    expect(accepts(addBadge(6_400, 7_500))).toBe(false);
    expect(accepts(addBadge(1_000, 2_000))).toBe(false);
  });

  it('bakes the waveform envelope to the scene it belongs to', () => {
    expect(
      accepts((scene) => {
        (((scene.chrome as JsonRecord).waveViz as JsonRecord).amplitudes as number[]).pop();
      }),
    ).toBe(false);
    expect(accepts((scene) => setPath(scene, ['chrome', 'waveViz', 'sampleIntervalMs'], 200))).toBe(
      false,
    );
    expect(
      accepts((scene) => {
        setPath(scene, ['chrome', 'waveViz', 'sampleIntervalMs'], 200);
        setPath(scene, ['chrome', 'waveViz', 'amplitudes'], amplitudes(FIXTURE_DURATION_MS, 200));
      }),
    ).toBe(true);
  });

  it('accepts a scene with no chrome and no overlays at all', () => {
    expect(
      accepts((scene) => {
        scene.chrome = {};
        scene.overlays = [];
      }),
    ).toBe(true);
  });

  it('requires the look, so a player never has to invent one', () => {
    expect(
      accepts((scene) => {
        delete (scene.look as JsonRecord).grain;
      }),
    ).toBe(false);
    expect(accepts((scene) => setPath(scene, ['look'], {}))).toBe(false);
  });

  it('freezes the grain seed as an integer, never a runtime draw', () => {
    expect(accepts((scene) => setPath(scene, ['look', 'grain', 'seed'], 0))).toBe(true);
    expect(accepts((scene) => setPath(scene, ['look', 'grain', 'seed'], -1))).toBe(false);
    expect(accepts((scene) => setPath(scene, ['look', 'grain', 'seed'], 1.5))).toBe(false);
    expect(
      accepts((scene) => {
        delete (scene.look as JsonRecord as { grain: JsonRecord }).grain.seed;
      }),
    ).toBe(false);
  });
});

describe('pitchSceneV2Schema — every number is bounded on both sides', () => {
  const table: readonly {
    readonly path: readonly (string | number)[];
    readonly min: number;
    readonly max: number;
    readonly step: number;
  }[] = [
    { path: ['look', 'grade', 'warmth'], min: -1, max: 1, step: 0.001 },
    { path: ['look', 'grade', 'contrast'], min: 0.8, max: 1.4, step: 0.001 },
    { path: ['look', 'grade', 'saturation'], min: 0.6, max: 1.4, step: 0.001 },
    { path: ['look', 'grade', 'vignette'], min: 0, max: 0.6, step: 0.001 },
    { path: ['look', 'grain', 'intensity'], min: 0, max: 0.25, step: 0.001 },
    { path: ['look', 'grain', 'sizePx'], min: 1, max: 4, step: 0.001 },
    { path: ['look', 'grain', 'animationHz'], min: 0, max: 30, step: 0.001 },
    { path: ['look', 'grain', 'seed'], min: 0, max: 2_147_483_647, step: 1 },
    { path: ['chrome', 'progressBar', 'thicknessPx'], min: 2, max: 12, step: 1 },
    { path: ['chrome', 'progressBar', 'opacity'], min: 0.2, max: 1, step: 0.001 },
    { path: ['chrome', 'waveViz', 'heightPx'], min: 24, max: 240, step: 1 },
    { path: ['chrome', 'waveViz', 'opacity'], min: 0.2, max: 1, step: 0.001 },
    { path: ['chrome', 'waveViz', 'amplitudes', 0], min: 0, max: 1, step: 0.001 },
    { path: ['shots', 1, 'effects', 0, 'durationMs'], min: 80, max: 400, step: 1 },
    { path: ['shots', 1, 'effects', 0, 'scale'], min: 1.02, max: 1.12, step: 0.001 },
    { path: ['shots', 1, 'effects', 1, 'scale'], min: 1, max: 1.6, step: 0.001 },
    { path: ['shots', 2, 'effects', 0, 'radiusPx'], min: 8, max: 64, step: 1 },
    { path: ['shots', 2, 'effects', 0, 'dim'], min: 0, max: 0.6, step: 0.001 },
    { path: ['shots', 3, 'text', 'revealMs'], min: 80, max: 800, step: 1 },
    { path: ['shots', 3, 'text', 'emphasis'], min: 0, max: 1, step: 0.001 },
    { path: ['overlays', 0, 'emphasis'], min: 0, max: 1, step: 0.001 },
    { path: ['overlays', 1, 'peakIntensity'], min: 0, max: 0.6, step: 0.001 },
    { path: ['overlays', 1, 'pulseHz'], min: 0, max: 3, step: 0.001 },
    { path: ['overlays', 1, 'angleDeg'], min: 0, max: 360, step: 0.001 },
  ];

  it('accepts both bounds and rejects a step past either', () => {
    for (const entry of table) {
      const label = entry.path.join('.');
      expect(
        accepts((scene) => setPath(scene, entry.path, entry.min)),
        `${label} min`,
      ).toBe(true);
      expect(
        accepts((scene) => setPath(scene, entry.path, entry.max)),
        `${label} max`,
      ).toBe(true);
      expect(
        accepts((scene) => setPath(scene, entry.path, entry.min - entry.step)),
        `${label} under`,
      ).toBe(false);
      expect(
        accepts((scene) => setPath(scene, entry.path, entry.max + entry.step)),
        `${label} over`,
      ).toBe(false);
    }
  });

  it('rejects a non-number where a number belongs', () => {
    expect(accepts((scene) => setPath(scene, ['look', 'grade', 'warmth'], '0.3'))).toBe(false);
    expect(accepts((scene) => setPath(scene, ['durationMs'], Number.NaN))).toBe(false);
    expect(accepts((scene) => setPath(scene, ['shots', 0, 'endMs'], 3_000.5))).toBe(false);
  });
});

describe('pitchScene — v1 and v2 coexist', () => {
  const segments = (count: number, totalMs: number): readonly PitchSceneSegment[] =>
    Array.from({ length: count }, (_value, index) => ({
      startMs: Math.round((index * totalMs) / count),
      endMs: Math.round(((index + 1) * totalMs) / count),
    }));

  const v1 = (): PitchSceneV1 =>
    buildPitchSceneV1({
      photoAssetIds: [assetId(1), assetId(2)],
      segments: segments(4, 20_000),
    }) as PitchSceneV1;

  it('still parses a v1 scene with the v1 schema', () => {
    expect(pitchSceneV1Schema.safeParse(v1()).success).toBe(true);
  });

  it('never lets one version satisfy the other', () => {
    expect(pitchSceneV2Schema.safeParse(v1()).success).toBe(false);
    expect(pitchSceneV1Schema.safeParse(validScene()).success).toBe(false);
  });

  it('accepts either version through the union', () => {
    expect(pitchSceneSchema.safeParse(v1()).success).toBe(true);
    expect(pitchSceneSchema.safeParse(validScene()).success).toBe(true);
  });

  it('discriminates on schemaVersion when parsing', () => {
    const parsedV1 = parsePitchScene(v1());
    const parsedV2 = parsePitchScene(validScene());

    expect(parsedV1).not.toBeNull();
    expect(parsedV2).not.toBeNull();
    expect(parsedV1 !== null && isPitchSceneV1(parsedV1)).toBe(true);
    expect(parsedV1 !== null && isPitchSceneV2(parsedV1)).toBe(false);
    expect(parsedV2 !== null && isPitchSceneV2(parsedV2)).toBe(true);
    expect(parsedV2 !== null && isPitchSceneV1(parsedV2)).toBe(false);
  });

  it('narrows to the version it reports', () => {
    const parsed = parsePitchScene(validScene());
    if (parsed === null || !isPitchSceneV2(parsed)) {
      throw new Error('expected a v2 scene');
    }
    // Compiles only because the guard narrowed the union.
    expect(parsed.shots.length).toBe(6);
    expect(parsed.template).toBe('warm');
  });

  it('returns null for a version it does not know, and for junk', () => {
    expect(parsePitchScene({ ...validScene(), schemaVersion: 3 })).toBeNull();
    expect(parsePitchScene(null)).toBeNull();
    expect(parsePitchScene('a scene')).toBeNull();
    expect(parsePitchScene({})).toBeNull();
    expect(parsePitchScene({ schemaVersion: 2 })).toBeNull();
  });
});
