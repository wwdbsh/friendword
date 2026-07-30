import type { PitchSceneSegment } from './pitchScene';
import type { PitchSceneTemplate } from './pitchSceneV2';
import type { TranscriptWordTiming } from './transcriptWords';

// GOLDEN VECTORS for the PitchScene v2 flash budget.
//
// Three implementations enforce the same viewer-safety rule and they are written in
// three languages: the zod `superRefine` in pitchSceneV2.ts, the PL/pgSQL mirror in
// migration 0049, and this package's builder, which pays the budget while it
// assembles. Comments claiming they agree are how a viewer-safety review found a
// proof that was wrong about its own code (finding F1). So the agreement is forced
// by DATA instead: this file is the single list of scenes and verdicts, the
// contracts suite runs it against the parser, and `supabase/tests/25_motion_scene_v2.sql`
// runs the SAME rows against the database — inlined from here by
// {@link pitchSceneGoldenVectorsSql}, never retyped.
//
// Every vector is a scene the OLD onset-only budget accepted (see
// `acceptedByOnsetOnlyBudget`), which is what makes a reject vector a regression
// witness rather than just some invalid JSON. The two accept vectors at 334ms
// exactly are the other half of the device: an implementation that expanded the
// pulses but got the interval or the half-open end wrong fails those instead.
//
// Adding a vector: give it a stable `name` (it is the SQL row key), say WHY in
// `why`, and regenerate the SQL block. Never edit the generated block by hand.
//
// v3 (the clip shot) has its OWN list, {@link PITCH_SCENE_V3_GOLDEN_VECTORS}, and its
// own generated block. Two reasons, in order of importance: the rows above are the
// rows `supabase/tests/25_motion_scene_v2.sql` runs today, and that harness asserts
// the database still REJECTS `schemaVersion: 3` — mixing v3 rows into the block it
// reads would break it — and a v3 vector witnesses a clip rule rather than the
// onset-only flash budget these were built to catch, so it cannot carry
// `acceptedByOnsetOnlyBudget` honestly.

/**
 * What every implementation must answer for one vector. A rejection carries both
 * messages because the two implementations word them differently on purpose: zod
 * reports a path and a bare sentence, the database returns one string a mobile
 * client matches on a `pitch scene` prefix.
 */
export type PitchSceneGoldenVerdict =
  | { readonly accept: true }
  | {
      readonly accept: false;
      /** Substring expected among the zod issue messages. */
      readonly zodMessage: string;
      /** Exact string `private.pitch_scene_violation` must return. */
      readonly dbReason: string;
    };

export type PitchSceneGoldenVector = {
  /** Stable identifier, also the row key on the SQL side. */
  readonly name: string;
  /** What this vector pins down that no other vector does. */
  readonly why: string;
  /**
   * True when the scene names a reviewed structure field, which the DB only accepts
   * on a revision carrying all five published fields. The SQL harness needs to know
   * which fixture row to point the vector at; zod does not check it at all.
   */
  readonly requiresReviewedStructure: boolean;
  /**
   * True when the budget this file replaced — punch onsets plus lightLeak ONSETS,
   * with wordPop and countBadge appearances uncounted — accepted this scene. Every
   * reject vector here is such a scene.
   */
  readonly acceptedByOnsetOnlyBudget: boolean;
  readonly scene: Readonly<Record<string, unknown>>;
  readonly verdict: PitchSceneGoldenVerdict;
};

const PHOTO_A = '40000000-0000-0000-0000-000000000001';

const CANVAS = { width: 1080, height: 1920, fps: 30 } as const;

/** One look for every hand-written vector: none of them is about the grade. */
const LOOK = {
  grade: { warmth: 0.12, contrast: 1.28, saturation: 1.22, vignette: 0.18 },
  grain: { intensity: 0.1, sizePx: 2, seed: 1_234_567, animationHz: 30 },
} as const;

const CHROME = { progressBar: { thicknessPx: 5, opacity: 0.8, anchor: 'top' } } as const;

const FLASH_BUDGET_VERDICT: PitchSceneGoldenVerdict = {
  accept: false,
  zodMessage: 'flashes must be at least 334ms apart',
  dbReason: 'pitch scene flashes must be at least 334ms apart',
};

/**
 * A `punchIn` shot on one photo, 4 effects of room, whose composed zoom
 * (1 / 0.86 x 1.05) clears the level's 1.25x ceiling. Every hand-written vector
 * below uses this frame so the only thing that differs between them is timing.
 */
function punchInShot(
  endMs: number,
  effects: readonly Readonly<Record<string, unknown>>[],
): Readonly<Record<string, unknown>> {
  return {
    level: 'punchIn',
    assetId: PHOTO_A,
    startMs: 0,
    endMs,
    crop: { x: 0.05, y: 0.05, width: 0.9, height: 0.9 },
    effects: [
      { type: 'kenBurns', to: { x: 0.07, y: 0.05, width: 0.86, height: 0.86 }, easing: 'easeOut' },
      ...effects,
    ],
  };
}

/** A `wide` shot, used where the vector is about overlays and wants no punch. */
function wideShot(endMs: number): Readonly<Record<string, unknown>> {
  return {
    level: 'wide',
    assetId: PHOTO_A,
    startMs: 0,
    endMs,
    crop: { x: 0, y: 0, width: 1, height: 1 },
    effects: [
      { type: 'kenBurns', to: { x: 0.035, y: 0, width: 0.965, height: 0.965 }, easing: 'easeOut' },
    ],
  };
}

/**
 * A photo shot anywhere on the timeline, holding its framing while a kenBurns zooms
 * in on the same centre. The helpers above all start at 0 because their vectors are
 * one shot long; a vector about the scene DURATION needs a row of shots that closes
 * on it, and every shot over 2500ms has to carry a travelling kenBurns.
 */
function zoomShot(
  level: 'wide' | 'wideAlt' | 'punchIn' | 'detail',
  startMs: number,
  endMs: number,
  size: number,
  toSize: number,
): Readonly<Record<string, unknown>> {
  return {
    level,
    assetId: PHOTO_A,
    startMs,
    endMs,
    crop: { x: 0.01, y: 0.01, width: size, height: size },
    effects: [
      {
        type: 'kenBurns',
        to: { x: 0.01, y: 0.01, width: toSize, height: toSize },
        easing: 'easeInOut',
      },
    ],
  };
}

function punch(atMs: number): Readonly<Record<string, unknown>> {
  return { type: 'punch', atMs, durationMs: 200, scale: 1.05, easing: 'easeOut' };
}

function wordPop(
  wordIndex: number,
  startMs: number,
  endMs: number,
): Readonly<Record<string, unknown>> {
  return {
    type: 'wordPop',
    word: { segmentIndex: 0, wordIndex },
    startMs,
    endMs,
    scale: 1.34,
    easing: 'easeOut',
  };
}

function lightLeak(
  startMs: number,
  endMs: number,
  pulseHz: number,
): Readonly<Record<string, unknown>> {
  return { type: 'lightLeak', startMs, endMs, peakIntensity: 0.38, pulseHz, angleDeg: 35 };
}

function countBadge(startMs: number, endMs: number): Readonly<Record<string, unknown>> {
  return { type: 'countBadge', source: 'quality:0', startMs, endMs, emphasis: 0.9 };
}

function scene(
  durationMs: number,
  shots: readonly Readonly<Record<string, unknown>>[],
  overlays: readonly Readonly<Record<string, unknown>>[],
): Readonly<Record<string, unknown>> {
  return {
    schemaVersion: 2,
    template: 'hype',
    canvas: CANVAS,
    durationMs,
    assetIds: [PHOTO_A],
    shots,
    look: LOOK,
    chrome: CHROME,
    overlays,
  };
}

/**
 * The recording that vector `f1-builder-output` was built from, and the reason it is
 * in this file at all.
 *
 * F1 was a comment claiming the builder's flash budget could never fire, "proved" by
 * arithmetic over the wrong quantities. The function was in fact load-bearing. This
 * is a real recording — a slow speaker, two sentences, three long words each — where
 * bypassing the budget makes the builder emit a punch and a wordPop on the SAME
 * millisecond (7700) and throw at its own self-validating parse. Kept as an input,
 * not only as an output, so `buildPitchSceneV2` staying equal to the frozen scene is
 * itself a test.
 */
export const PITCH_SCENE_F1_BUILDER_INPUT: {
  readonly template: PitchSceneTemplate;
  readonly photoAssetIds: readonly string[];
  readonly segments: readonly PitchSceneSegment[];
  readonly words: readonly TranscriptWordTiming[];
} = {
  template: 'warm',
  photoAssetIds: [PHOTO_A],
  segments: [
    { startMs: 0, endMs: 7_300 },
    { startMs: 7_700, endMs: 15_000 },
  ],
  words: [
    { segmentIndex: 0, wordIndex: 0, startMs: 0, endMs: 1_946 },
    { segmentIndex: 0, wordIndex: 1, startMs: 2_433, endMs: 4_379 },
    { segmentIndex: 0, wordIndex: 2, startMs: 4_866, endMs: 6_812 },
    { segmentIndex: 1, wordIndex: 0, startMs: 7_700, endMs: 9_646 },
    { segmentIndex: 1, wordIndex: 1, startMs: 10_133, endMs: 12_079 },
    { segmentIndex: 1, wordIndex: 2, startMs: 12_566, endMs: 14_512 },
  ],
};

/** The scene {@link PITCH_SCENE_F1_BUILDER_INPUT} builds. Frozen, not generated. */
const F1_BUILDER_OUTPUT: Readonly<Record<string, unknown>> = {
  schemaVersion: 2,
  template: 'warm',
  canvas: {
    width: 1080,
    height: 1920,
    fps: 30,
  },
  durationMs: 15000,
  assetIds: ['40000000-0000-0000-0000-000000000001'],
  shots: [
    {
      level: 'wide',
      assetId: '40000000-0000-0000-0000-000000000001',
      startMs: 0,
      endMs: 2433,
      crop: {
        x: 0,
        y: 0,
        width: 1,
        height: 1,
      },
      effects: [
        {
          type: 'kenBurns',
          to: {
            x: 0.035,
            y: 0,
            width: 0.965,
            height: 0.965,
          },
          easing: 'easeInOut',
        },
        {
          type: 'wordPop',
          word: {
            segmentIndex: 0,
            wordIndex: 0,
          },
          startMs: 0,
          endMs: 560,
          scale: 1.18,
          easing: 'easeOut',
        },
      ],
    },
    {
      level: 'punchIn',
      assetId: '40000000-0000-0000-0000-000000000001',
      startMs: 2433,
      endMs: 6000,
      crop: {
        x: 0.07,
        y: 0,
        width: 0.86,
        height: 0.86,
      },
      effects: [
        {
          type: 'kenBurns',
          to: {
            x: 0.08,
            y: 0,
            width: 0.9,
            height: 0.9,
          },
          easing: 'easeInOut',
        },
        {
          type: 'punch',
          atMs: 4866,
          durationMs: 320,
          scale: 1.04,
          easing: 'easeOut',
        },
        {
          type: 'wordPop',
          word: {
            segmentIndex: 0,
            wordIndex: 1,
          },
          startMs: 2433,
          endMs: 2993,
          scale: 1.18,
          easing: 'easeOut',
        },
      ],
    },
    {
      level: 'detail',
      assetId: '40000000-0000-0000-0000-000000000001',
      startMs: 6000,
      endMs: 9000,
      crop: {
        x: 0.11,
        y: 0,
        width: 0.78,
        height: 0.78,
      },
      effects: [
        {
          type: 'kenBurns',
          to: {
            x: 0.1,
            y: 0,
            width: 0.74,
            height: 0.74,
          },
          easing: 'easeInOut',
        },
        {
          type: 'punch',
          atMs: 7700,
          durationMs: 320,
          scale: 1.04,
          easing: 'easeOut',
        },
      ],
    },
    {
      level: 'wideAlt',
      assetId: '40000000-0000-0000-0000-000000000001',
      startMs: 9000,
      endMs: 12566,
      crop: {
        x: 0.0375,
        y: 0,
        width: 0.925,
        height: 0.925,
      },
      effects: [
        {
          type: 'kenBurns',
          to: {
            x: 0.04,
            y: 0,
            width: 0.96,
            height: 0.96,
          },
          easing: 'easeInOut',
        },
        {
          type: 'wordPop',
          word: {
            segmentIndex: 1,
            wordIndex: 1,
          },
          startMs: 10133,
          endMs: 10693,
          scale: 1.18,
          easing: 'easeOut',
        },
      ],
    },
    {
      level: 'wide',
      assetId: '40000000-0000-0000-0000-000000000001',
      startMs: 12566,
      endMs: 15000,
      crop: {
        x: 0,
        y: 0,
        width: 1,
        height: 1,
      },
      effects: [
        {
          type: 'kenBurns',
          to: {
            x: 0.035,
            y: 0,
            width: 0.965,
            height: 0.965,
          },
          easing: 'easeInOut',
        },
        {
          type: 'wordPop',
          word: {
            segmentIndex: 1,
            wordIndex: 2,
          },
          startMs: 12566,
          endMs: 13126,
          scale: 1.18,
          easing: 'easeOut',
        },
      ],
    },
  ],
  look: {
    grade: {
      warmth: 0.3,
      contrast: 1.08,
      saturation: 1.05,
      vignette: 0.28,
    },
    grain: {
      intensity: 0.06,
      sizePx: 2,
      seed: 111430214,
      animationHz: 24,
    },
  },
  chrome: {
    progressBar: {
      thicknessPx: 3,
      opacity: 0.45,
      anchor: 'bottom',
    },
  },
  overlays: [],
};

export const PITCH_SCENE_GOLDEN_VECTORS: readonly PitchSceneGoldenVector[] = [
  {
    name: 'p8-leak-pulses-between-punches',
    why: 'Attack scene P8. A 3Hz leak lasting 1200ms delivers peaks at 1200, 1533, 1866 and 2200; three punches sit at 700, 1600 and 2100, every one of them more than 334ms from the leak ONSET. Counting the onset alone puts five events inside the second starting at 1200.',
    requiresReviewedStructure: false,
    acceptedByOnsetOnlyBudget: true,
    scene: scene(
      4_000,
      [punchInShot(4_000, [punch(700), punch(1_600), punch(2_100)])],
      [lightLeak(1_200, 2_400, 3)],
    ),
    verdict: FLASH_BUDGET_VERDICT,
  },
  {
    name: 'punch-and-wordpop-200ms-apart',
    why: 'A wordPop scrim arriving is an appearance event (finding F3). 200ms after a punch it is a 5Hz stimulus, whatever the layer that drew it is called.',
    requiresReviewedStructure: false,
    acceptedByOnsetOnlyBudget: true,
    scene: scene(3_000, [punchInShot(3_000, [punch(1_000), wordPop(4, 1_200, 1_600)])], []),
    verdict: FLASH_BUDGET_VERDICT,
  },
  {
    name: 'four-wordpops-one-millisecond-apart',
    why: 'Finding F3 as measured: four pops at 1ms intervals, the per-shot pop ceiling exactly, no punch and no leak anywhere. The old budget saw an empty timeline.',
    requiresReviewedStructure: false,
    acceptedByOnsetOnlyBudget: true,
    scene: scene(
      3_000,
      [
        punchInShot(3_000, [
          wordPop(0, 1_000, 1_400),
          wordPop(1, 1_001, 1_401),
          wordPop(2, 1_002, 1_402),
          wordPop(3, 1_003, 1_403),
        ]),
      ],
      [],
    ),
    verdict: FLASH_BUDGET_VERDICT,
  },
  {
    name: 'countbadge-inside-a-leak-pulse',
    why: 'A badge 100ms after a leak’s third pulse peak (leak 1000..2200 at 2Hz peaks at 1000, 1500, 2000). Reachable from the builder: a leak straddles a hard cut and a badge is inset 100ms into the card that cut opens.',
    requiresReviewedStructure: true,
    acceptedByOnsetOnlyBudget: true,
    scene: scene(3_600, [wideShot(3_600)], [lightLeak(1_000, 2_200, 2), countBadge(2_100, 2_600)]),
    verdict: FLASH_BUDGET_VERDICT,
  },
  {
    name: 'pulsehz-zero-leak-still-appears',
    why: 'pulseHz 0 means "no oscillation", not "no event": the leak still appears once, at startMs. An implementation that skipped the 0 case to dodge the division by zero would accept this punch 200ms later.',
    requiresReviewedStructure: false,
    acceptedByOnsetOnlyBudget: false,
    scene: scene(3_000, [punchInShot(3_000, [punch(1_200)])], [lightLeak(1_000, 2_200, 0)]),
    verdict: FLASH_BUDGET_VERDICT,
  },
  {
    name: 'fractional-pulsehz',
    why: 'pulseHz is a whole number so floor(k * 1000 / pulseHz) lands on the same millisecond in a JavaScript float, in PL/pgSQL NUMERIC and in the builder. 2.5Hz is rejected at the field, before any peak list exists.',
    requiresReviewedStructure: false,
    acceptedByOnsetOnlyBudget: true,
    scene: scene(3_000, [punchInShot(3_000, [punch(1_600)])], [lightLeak(1_000, 1_240, 2.5)]),
    verdict: {
      accept: false,
      zodMessage: 'Expected integer, received float',
      dbReason:
        'pitch scene lightLeak must carry a peakIntensity, a whole-number pulseHz of at most 3 and an angleDeg in range',
    },
  },
  {
    name: 'three-hz-leak-short-enough-for-one-peak',
    why: 'The half-open interval and the 334ms boundary at once. A 3Hz leak running 1000..1300 would pulse again at 1333, which is outside [1000, 1300), so it delivers ONE peak and a punch at exactly 1334 is legal. A closed interval, or an interval of 333ms, rejects this.',
    requiresReviewedStructure: false,
    acceptedByOnsetOnlyBudget: true,
    scene: scene(3_000, [punchInShot(3_000, [punch(1_334)])], [lightLeak(1_000, 1_300, 3)]),
    verdict: { accept: true },
  },
  {
    name: 'countbadge-exactly-334-after-a-leak-pulse',
    why: 'The twin of countbadge-inside-a-leak-pulse: same leak, same peaks, badge moved to 2334. An implementation that expanded the pulses but compared against the wrong peak rejects this one instead.',
    requiresReviewedStructure: true,
    acceptedByOnsetOnlyBudget: true,
    scene: scene(3_600, [wideShot(3_600)], [lightLeak(1_000, 2_200, 2), countBadge(2_334, 2_834)]),
    verdict: { accept: true },
  },
  {
    name: 'four-decimal-transcript-duration',
    why: 'A duration that only exists because the database now rounds the way the clients do. A transcript ending at 16.0005s is 16000ms in IEEE double arithmetic — the double nearest 16.0005 times 1000 is 16000.499999999998 — and was 16001ms while migration 0049 rounded in NUMERIC. Four 4000ms shots so the timeline closes on 16000 exactly and nothing but the number is under test. The arithmetic itself is pinned by section (A2) of supabase/tests/25_motion_scene_v2.sql, which submits this duration against a four-decimal transcript; this vector pins that both implementations accept the scene the winning answer produces.',
    requiresReviewedStructure: false,
    acceptedByOnsetOnlyBudget: true,
    scene: scene(
      16_000,
      [
        zoomShot('wide', 0, 4_000, 0.99, 0.96),
        zoomShot('wideAlt', 4_000, 8_000, 0.95, 0.87),
        zoomShot('punchIn', 8_000, 12_000, 0.9, 0.82),
        zoomShot('detail', 12_000, 16_000, 0.75, 0.68),
      ],
      [],
    ),
    verdict: { accept: true },
  },
  {
    name: 'f1-builder-output',
    why: 'What the builder emits for PITCH_SCENE_F1_BUILDER_INPUT. Bypass its flash budget and the same input puts a punch and a wordPop both at 7700; with the budget the pop is gone and the whole timeline clears 334ms. The one vector in this file that no human placed.',
    requiresReviewedStructure: false,
    acceptedByOnsetOnlyBudget: true,
    scene: F1_BUILDER_OUTPUT,
    verdict: { accept: true },
  },
];

// ── v3: the clip shot ───────────────────────────────────────────────────────
//
// Same device as above, one version later. Three implementations will enforce the
// clip rules — the zod parser in pitchSceneV3.ts, the PL/pgSQL mirror that must land
// before any v3 scene can be stored, and the builder that will emit clips — so the
// rules are written down once, here, as scenes and verdicts rather than as prose.
//
// The vectors are chosen so that each one fails EXACTLY ONE rule, which is why, for
// example, the over-long clip is a single 10001ms window (the per-shot ceiling, the
// window ceiling and the per-clip total all answer with the same sentence) while the
// two-window vector splits 10001ms across windows that are each legal on their own.
// A repeated window is deliberately absent: an identical window also overlaps
// itself, so no scene can isolate that rule, and pitchSceneV3.test.ts pins it
// instead.

export type PitchSceneV3GoldenVector = {
  /** Stable identifier, also the row key on the SQL side. */
  readonly name: string;
  /** What this vector pins down that no other vector does. */
  readonly why: string;
  /** See {@link PitchSceneGoldenVector.requiresReviewedStructure}. */
  readonly requiresReviewedStructure: boolean;
  readonly scene: Readonly<Record<string, unknown>>;
  readonly verdict: PitchSceneGoldenVerdict;
};

/** Illustrative clip ids, deliberately a different prefix from the photos. */
function clipId(index: number): string {
  return `50000000-0000-0000-0000-${String(index).padStart(12, '0')}`;
}

/** The 2000ms opening photo every v3 vector uses: a clip may never stand alone. */
function v3OpeningPhotoShot(): Readonly<Record<string, unknown>> {
  return {
    level: 'wide',
    assetId: PHOTO_A,
    startMs: 0,
    endMs: 2_000,
    crop: { x: 0, y: 0, width: 1, height: 1 },
    effects: [],
  };
}

function v3ClipShot(
  clip: number,
  startMs: number,
  endMs: number,
  clipInMs: number,
  clipOutMs: number,
  effects: readonly Readonly<Record<string, unknown>>[] = [],
): Readonly<Record<string, unknown>> {
  return { level: 'clip', assetId: clipId(clip), startMs, endMs, clipInMs, clipOutMs, effects };
}

function v3Scene(
  durationMs: number,
  clips: readonly number[],
  shots: readonly Readonly<Record<string, unknown>>[],
): Readonly<Record<string, unknown>> {
  return {
    schemaVersion: 3,
    template: 'hype',
    canvas: CANVAS,
    durationMs,
    assetIds: [PHOTO_A],
    clipAssetIds: clips.map(clipId),
    shots: [v3OpeningPhotoShot(), ...shots],
    look: LOOK,
    chrome: CHROME,
    overlays: [],
  };
}

const CLIP_HOLD_VERDICT: PitchSceneGoldenVerdict = {
  accept: false,
  zodMessage: 'a clip may not hold the screen longer than 10000ms',
  dbReason: 'pitch scene clip may not hold the screen longer than 10000ms',
};

export const PITCH_SCENE_V3_GOLDEN_VECTORS: readonly PitchSceneV3GoldenVector[] = [
  {
    name: 'v3-one-clip-after-a-photo',
    why: 'The smallest legal v3 scene: one photo, one clip, one declared clip id. Pins that a clip shot needs no kenBurns however long it runs (4000ms is past the 2500ms static ceiling) and that clipAssetIds is a list of its own rather than an entry in assetIds.',
    requiresReviewedStructure: false,
    scene: v3Scene(6_000, [1], [v3ClipShot(1, 2_000, 6_000, 0, 4_000)]),
    verdict: { accept: true },
  },
  {
    name: 'v3-three-clips-at-every-cap',
    why: 'Three distinct clips, which is the cap, with the third holding the screen for exactly 10000ms over the source window [5000, 15000) — the last millisecond of a 15s recording. An implementation off by one on the clip count, on the 10s hold or on the 15s source bound rejects this scene.',
    requiresReviewedStructure: false,
    scene: v3Scene(
      19_000,
      [1, 2, 3],
      [
        v3ClipShot(1, 2_000, 5_000, 0, 3_000),
        v3ClipShot(2, 5_000, 9_000, 1_000, 5_000),
        v3ClipShot(3, 9_000, 19_000, 5_000, 15_000),
      ],
    ),
    verdict: { accept: true },
  },
  {
    name: 'v3-clip-card-and-wordpop-mixed',
    why: 'A clip, a text card and a photo in one timeline, with a wordPop drawn ON the clip. Pins the two things a mixed scene must not lose: a wordPop is the one effect a clip may carry, and it pays the 334ms flash budget from a clip exactly as it would from a photo.',
    requiresReviewedStructure: true,
    scene: v3Scene(
      8_200,
      [1, 2],
      [
        v3ClipShot(1, 2_000, 5_000, 2_000, 5_000, [
          {
            type: 'wordPop',
            word: { segmentIndex: 0, wordIndex: 2 },
            startMs: 2_200,
            endMs: 2_600,
            scale: 1.25,
            easing: 'easeOut',
          },
        ]),
        {
          level: 'typographic',
          startMs: 5_000,
          endMs: 7_000,
          text: {
            type: 'kineticText',
            source: 'hook',
            revealMs: 300,
            easing: 'easeOut',
            emphasis: 0.8,
          },
        },
        v3ClipShot(2, 7_000, 8_200, 0, 1_200),
      ],
    ),
    verdict: { accept: true },
  },
  {
    name: 'v3-clip-retimed-not-1to1',
    why: 'A 3000ms source window played over 2000ms of screen time: a 1.5x speed-up of footage the Dater reviewed at normal speed. Every other bound holds, so only the 1:1 playback equation can catch it — and an implementation that merely checks "the window is long enough for the shot" accepts it.',
    requiresReviewedStructure: false,
    scene: v3Scene(4_000, [1], [v3ClipShot(1, 2_000, 4_000, 0, 3_000)]),
    verdict: {
      accept: false,
      zodMessage: 'a clip shot must replay its source 1:1',
      dbReason:
        'pitch scene clip shot must replay its source 1:1 (clipOut - clipIn must equal endMs - startMs)',
    },
  },
  {
    name: 'v3-clip-window-past-ten-seconds',
    why: 'One clip window of 10001ms, played 1:1, one millisecond past the scene-use cap the product fixed. The three checks that could catch it — per-shot hold, window length, per-clip total — answer with the same sentence on purpose, so a mirror may evaluate them in any order.',
    requiresReviewedStructure: false,
    scene: v3Scene(12_001, [1], [v3ClipShot(1, 2_000, 12_001, 0, 10_001)]),
    verdict: CLIP_HOLD_VERDICT,
  },
  {
    name: 'v3-clip-total-past-ten-seconds-across-windows',
    why: 'Two windows of ONE clip, 6000ms and 4001ms, each legal alone and 10001ms together. The per-shot ceiling alone waves this through, which is how three adjacent 5s windows would replay 15s of a 15s recording; the per-clip total is what stops it.',
    requiresReviewedStructure: false,
    scene: v3Scene(
      12_001,
      [1],
      [v3ClipShot(1, 2_000, 8_000, 0, 6_000), v3ClipShot(1, 8_000, 12_001, 6_000, 10_001)],
    ),
    verdict: CLIP_HOLD_VERDICT,
  },
  {
    name: 'v3-four-distinct-clips',
    why: 'Four clips where the product allows three (free tier 1, premium 3 — the entitlement is the database’s, the absolute ceiling is the schema’s). Rejected at the field, before any timeline rule runs.',
    requiresReviewedStructure: false,
    scene: v3Scene(
      6_800,
      [1, 2, 3, 4],
      [
        v3ClipShot(1, 2_000, 3_200, 0, 1_200),
        v3ClipShot(2, 3_200, 4_400, 0, 1_200),
        v3ClipShot(3, 4_400, 5_600, 0, 1_200),
        v3ClipShot(4, 5_600, 6_800, 0, 1_200),
      ],
    ),
    verdict: {
      accept: false,
      zodMessage: 'a scene may use at most 3 clips',
      dbReason: 'pitch scene may use at most 3 clips',
    },
  },
  {
    name: 'v3-overlapping-windows-of-one-clip',
    why: 'Two windows of one clip, [0, 3000) and [2900, 5900): 2900ms of the same frames replayed a tenth of a second later, which reads as a stutter rather than as a return. Unique-window uniqueness alone admits it, so the overlap rule is separate.',
    requiresReviewedStructure: false,
    scene: v3Scene(
      8_000,
      [1],
      [v3ClipShot(1, 2_000, 5_000, 0, 3_000), v3ClipShot(1, 5_000, 8_000, 2_900, 5_900)],
    ),
    verdict: {
      accept: false,
      zodMessage: 'two windows of the same clip may not overlap',
      dbReason: 'pitch scene two windows of the same clip may not overlap',
    },
  },
  {
    name: 'v3-kenburns-on-a-clip',
    why: 'A kenBurns over footage that is already moving: a camera move invented for a still, double-transforming pixels the Dater approved. The effect union on a clip shot holds wordPop and nothing else, so this fails at the discriminator rather than at a rule.',
    requiresReviewedStructure: false,
    scene: v3Scene(
      5_000,
      [1],
      [
        v3ClipShot(1, 2_000, 5_000, 0, 3_000, [
          {
            type: 'kenBurns',
            to: { x: 0.02, y: 0.02, width: 0.96, height: 0.96 },
            easing: 'easeInOut',
          },
        ]),
      ],
    ),
    verdict: {
      accept: false,
      zodMessage: "Invalid discriminator value. Expected 'wordPop'",
      dbReason: 'pitch scene clip shot may carry only wordPop effects',
    },
  },
];

/** Where the generated block is kept, relative to this file. */
export const PITCH_SCENE_GOLDEN_VECTORS_SQL_FILE = 'pitchSceneGoldenVectors.generated.sql';

/** Where the v3 block is kept, relative to this file. */
export const PITCH_SCENE_GOLDEN_VECTORS_V3_SQL_FILE = 'pitchSceneGoldenVectorsV3.generated.sql';

/**
 * The vectors as a SQL block for `supabase/tests/25_motion_scene_v2.sql` to run.
 *
 * Generated rather than shared at runtime because pgTAP cannot import TypeScript, and
 * checked in beside this file as {@link PITCH_SCENE_GOLDEN_VECTORS_SQL_FILE} so the
 * database side reads a file instead of a paste that can quietly age. The suite here
 * asserts the two are byte-identical, which is the only thing that makes "the same
 * data" true rather than intended.
 *
 * To regenerate after changing a vector: call this function from anywhere in this
 * package (the vitest suite already imports it) and write the result over that file.
 * Never hand-edit either side — a vector that says one thing in vitest and another in
 * pgTAP is worse than no vector at all.
 *
 * `expected_reason` NULL means "this scene must be accepted".
 */
export function pitchSceneGoldenVectorsSql(): string {
  const rows = PITCH_SCENE_GOLDEN_VECTORS.map((vector) => {
    const reason = vector.verdict.accept ? 'NULL' : quote(vector.verdict.dbReason);
    return [
      `  (${quote(vector.name)},`,
      `   ${vector.requiresReviewedStructure},`,
      `   ${reason},`,
      `   $vector$${JSON.stringify(vector.scene)}$vector$::JSONB)`,
    ].join('\n');
  });
  return [
    '-- ── GOLDEN VECTORS (GENERATED — DO NOT EDIT) ─────────────────────────────',
    '-- Source: packages/contracts/src/pitchSceneGoldenVectors.ts',
    '--         (PITCH_SCENE_GOLDEN_VECTORS, printed by pitchSceneGoldenVectorsSql)',
    '-- The same rows run against the zod parser in that package’s vitest suite.',
    '-- expected_reason NULL means the scene must be ACCEPTED.',
    'CREATE TEMPORARY TABLE pitch_scene_golden_vector (',
    '  name TEXT PRIMARY KEY,',
    '  requires_structure BOOLEAN NOT NULL,',
    '  expected_reason TEXT,',
    '  scene JSONB NOT NULL',
    ');',
    'INSERT INTO pitch_scene_golden_vector (name, requires_structure, expected_reason, scene)',
    'VALUES',
    `${rows.join(',\n')};`,
    '-- ── END GOLDEN VECTORS ───────────────────────────────────────────────────',
  ].join('\n');
}

/**
 * The v3 vectors as their own SQL block, into its own temporary table.
 *
 * Separate from {@link pitchSceneGoldenVectorsSql} because the v2 block is inlined in
 * `supabase/tests/25_motion_scene_v2.sql`, which today asserts the database REJECTS
 * `schemaVersion: 3`. This block is checked in beside this file and is ready for the
 * harness that comes with the v3 migration; until that migration exists, no database
 * reads it, and the contracts suite still guards it against drift.
 */
export function pitchSceneV3GoldenVectorsSql(): string {
  const rows = PITCH_SCENE_V3_GOLDEN_VECTORS.map((vector) => {
    const reason = vector.verdict.accept ? 'NULL' : quote(vector.verdict.dbReason);
    return [
      `  (${quote(vector.name)},`,
      `   ${vector.requiresReviewedStructure},`,
      `   ${reason},`,
      `   $vector$${JSON.stringify(vector.scene)}$vector$::JSONB)`,
    ].join('\n');
  });
  return [
    '-- ── GOLDEN VECTORS, v3 CLIP SHOT (GENERATED — DO NOT EDIT) ───────────────',
    '-- Source: packages/contracts/src/pitchSceneGoldenVectors.ts',
    '--         (PITCH_SCENE_V3_GOLDEN_VECTORS, printed by pitchSceneV3GoldenVectorsSql)',
    '-- The same rows run against the zod parser in that package’s vitest suite.',
    '-- expected_reason NULL means the scene must be ACCEPTED.',
    'CREATE TEMPORARY TABLE pitch_scene_golden_vector_v3 (',
    '  name TEXT PRIMARY KEY,',
    '  requires_structure BOOLEAN NOT NULL,',
    '  expected_reason TEXT,',
    '  scene JSONB NOT NULL',
    ');',
    'INSERT INTO pitch_scene_golden_vector_v3 (name, requires_structure, expected_reason, scene)',
    'VALUES',
    `${rows.join(',\n')};`,
    '-- ── END GOLDEN VECTORS, v3 ───────────────────────────────────────────────',
  ].join('\n');
}

function quote(text: string): string {
  return `'${text.replaceAll("'", "''")}'`;
}
