import { z } from 'zod';

import { pitchSceneV1Schema, type PitchSceneV1 } from './pitchScene';

// PitchScene v2 — the shot list a Dater approves and a render worker replays.
//
// v2 is what turns four photos into a dozen shots: a crop ladder, a closed
// effect vocabulary, and two templates. It is ADDITIVE. v1 is untouched and
// still parses; `pitchSceneSchema` accepts either.
//
// Five properties hold this file together. Everything below is downstream of
// them, and none of them is aesthetic:
//
// 1. NO TEXT. There is not one free-string field in a v2 scene. A word effect
//    stores {segmentIndex, wordIndex}; a text card stores a `source` token naming
//    which reviewed structure field to print. Copy lives in the revision the
//    Dater approved, so a scene can never smuggle in words nobody read.
//    Fonts and colours are likewise absent: they come from `template`, which is a
//    closed enum, which is why no hex string or font name can appear either.
//
// 2. CLOSED VOCABULARY. Exactly eleven effects exist, every object is `.strict()`,
//    and every union is discriminated. An unknown effect or an unknown key is a
//    PARSE FAILURE, not something a renderer skips. That is what makes "effects
//    only, original pixels preserved" a code guarantee rather than a promise.
//    (parallax, maskReveal, sticker and speedRamp are deliberately out of v2:
//    multi-layer, complex masks, asset licensing and video-only respectively.)
//
// 3. FROZEN AT BUILD TIME. Every parameter, including the grain seed and the
//    waveform envelope, is baked. The player is an interpreter: no runtime
//    randomness, no re-derivation from audio metadata, no recomputation of shot
//    boundaries. Approve once, play identically everywhere, forever.
//
// 4. ABSOLUTE TIME. Every *Ms field is milliseconds from the start of the scene.
//    There are no offsets to add. Effects that span their whole shot (kenBurns,
//    backdropBlur, a text card's reveal) carry no times at all, so they cannot
//    disagree with the shot that owns them.
//
// 5. VIEWER SAFETY IS A SCHEMA RANGE. The viewer never consented to anything, so
//    photosensitivity limits are enforced by the parser: a 1200ms shot floor, a
//    3Hz ceiling on luminance-flash oscillation, and one 334ms budget over the
//    UNION of every momentary luminance or appearance event on the timeline —
//    punch onsets, each expanded lightLeak pulse peak, wordPop appearances and
//    countBadge appearances. A shot floor alone stops strobing between shots but
//    not inside one. Grain is the exception and is bounded by intensity instead —
//    see grainSchema.
//
// FREEZE EXCEPTION — 2026-07-30, ONE TIME ONLY.
//
// v2 was frozen when the first client emitted it. It is edited in place here
// because nothing had been published yet: 0049 was uncommitted, the hosted 0048
// still rejected every v2 write with `schemaVersion must be 1`, and every client
// that emits v2 was uncommitted too, so the set of scenes this change could
// invalidate was empty. Two rules changed, both because a viewer-safety review
// reproduced scenes this file used to accept:
//
//   - the flash budget now counts the union above, expanding a lightLeak into its
//     pulse peaks. Counting only the onset let a 3Hz leak deliver four peaks with
//     three punches between them: five events inside one second (finding P8). And
//     a wordPop or countBadge scrim arriving is an appearance a viewer perceives
//     as a flash whatever the layer that drew it is called (finding F3).
//   - `lightLeak.pulseHz` is a whole number, so `floor(k * 1000 / pulseHz)` lands
//     on the same millisecond in a JavaScript float, in PL/pgSQL NUMERIC and in
//     the builder.
//
// THE EXCEPTION WINDOW CLOSES THE MOMENT 0049 IS PUSHED TO A HOSTED DATABASE.
// Every visual change after that is schemaVersion 3, additively, because from
// then on a stored scene exists that some surface has already replayed.
//
// Crop coordinates deserve their own note, because it is the least obvious
// decision here. A crop rect is normalized against the CANVAS-FITTED frame — the
// photo already cover-fitted to 1080x1920 — not against the source image. Two
// consequences, both wanted: a rect can never reveal pixels outside the frame the
// Dater reviewed, and `width === height` in that space is exactly 9:16 in pixels,
// so no crop can distort a face and no asset pixel dimensions are needed to
// validate one. Zoom is therefore `1 / width`.

const FLOAT_SLACK = 1e-9;

export const PITCH_SCENE_V2_SCHEMA_VERSION = 2;

/**
 * Shot length bounds. The floor is viewer safety (mirrored by the DB CHECK); the
 * ceiling is why a long recording becomes many shots instead of a slideshow.
 * TARGET is guidance for the builder, not a parsed constraint.
 */
export const MIN_SHOT_DURATION_MS = 1200;
export const TARGET_SHOT_DURATION_MS = 2600;
export const MAX_SHOT_DURATION_MS = 4500;

/**
 * "Nothing may sit visually still for longer than this." A photo shot longer than
 * this must carry a kenBurns that actually travels; a text card may not last
 * longer than this at all, because its reveal is momentary and cannot fill the
 * rest.
 */
export const MAX_STATIC_SHOT_MS = 2500;

/** Smallest crop-space travel that counts as visual change, not a no-op. */
export const MIN_KEN_BURNS_TRAVEL = 0.02;

/**
 * Photosensitivity ceiling for LUMINANCE FLASH oscillation — lightLeak.pulseHz and
 * the combined flash rate below. It is not a blanket cap on anything that changes
 * per frame: film grain is sub-pixel texture that normally resamples every frame,
 * and holding it to 3Hz would only make it read as a visible flicker. Grain is
 * bounded by INTENSITY instead (see grainSchema), which is what keeps its
 * luminance swing under the general-flash threshold however fast it moves.
 */
export const MAX_FLICKER_HZ = 3;

/**
 * Minimum spacing between any two events on the flash timeline. 334ms means any
 * one-second window holds at most three, which is WCAG 2.3.1's general flash
 * threshold.
 *
 * Note what this implies for `pulseHz = 3`, because it is not obvious: a 3Hz pulse
 * repeats every `floor(1000 / 3) = 333`ms, one millisecond inside the budget. So a
 * 3Hz leak is only legal while it is short enough to deliver a single peak (under
 * 334ms). That is the honest consequence of rounding the interval UP, and rounding
 * it down to 333 would let a real 3Hz stimulus through.
 */
export const MIN_FLASH_INTERVAL_MS = Math.ceil(1000 / MAX_FLICKER_HZ);

/**
 * Termination bound on the pulse walk in {@link lightLeakFlashPeaks}, not part of
 * the rule: the half-open interval decides which peaks count. 60s x 3Hz = 180 caps
 * the walk even if MAX_LIGHT_LEAK_MS ever widened. Mirrors 0049's
 * `leak_pulse_max_index`.
 */
const MAX_LEAK_PULSE_INDEX = 180;

/** Grain may resample up to frame rate; its safety bound is MAX_GRAIN_INTENSITY. */
export const MAX_GRAIN_ANIMATION_HZ = 30;
export const MAX_GRAIN_INTENSITY = 0.25;

export const MIN_SCENE_DURATION_MS_V2 = MIN_SHOT_DURATION_MS;
export const MAX_SCENE_DURATION_MS = 600_000;
export const MAX_SHOTS_PER_SCENE = 300;
export const MAX_EFFECTS_PER_SHOT = 8;
export const MAX_OVERLAYS_PER_SCENE = 64;
export const MAX_PUNCHES_PER_SHOT = 3;
export const MAX_WORD_POPS_PER_SHOT = 4;

/**
 * Sanity ceiling on the referenced photo set, well above the current picker cap
 * of 4. The authoritative set is the Dater's include list, which the DB compares
 * against `assetIds` at publish time — this bound only stops an absurd scene.
 */
export const MAX_SCENE_ASSETS = 12;

/**
 * How many shots must pass before the same (asset, ladder step) pair may repeat.
 * Without it, "12 shots" degenerates into the same two framings alternating.
 */
export const MIN_LADDER_REPEAT_GAP_SHOTS = 3;

/**
 * Ceiling on a word reference. The real bound is the revision's transcript, which
 * only the server can check; this stops a nonsense index from being stored.
 */
export const MAX_TRANSCRIPT_SEGMENT_INDEX = 999;
export const MAX_TRANSCRIPT_WORD_INDEX = 999;

const MAX_CANVAS_DIMENSION = 4096;
const MAX_CANVAS_FPS = 60;
const MAX_WAVE_SAMPLES = 4096;

/**
 * The crop ladder (plan §3.6 L0-L4). L1 is named `punchIn` rather than `punch` so
 * it cannot be confused with the `punch` EFFECT: the level is a framing step used
 * by the repeat-gap rule, the effect is a momentary scale pop.
 */
export const PITCH_SHOT_LEVELS = ['wide', 'punchIn', 'detail', 'wideAlt', 'typographic'] as const;

export type PitchShotLevel = (typeof PITCH_SHOT_LEVELS)[number];

export type PitchPhotoShotLevel = Exclude<PitchShotLevel, 'typographic'>;

/**
 * Smallest crop a level may use, i.e. its zoom ceiling (`zoom = 1 / size`):
 * wide 1.04x, wideAlt 1.16x, punchIn 1.25x, detail 1.49x. The two ceilings the
 * plan fixes — punch <=1.25x, detail <=1.5x — are these two entries, and they are
 * enforced on the COMPOSED zoom: the crop, the kenBurns destination and the punch
 * scale multiply together and must still fit under the level's ceiling. A detail
 * shot cannot reach 1.5x and then punch past it.
 */
export const CROP_LEVEL_MIN_SIZE: Readonly<Record<PitchPhotoShotLevel, number>> = {
  wide: 0.96,
  wideAlt: 0.86,
  punchIn: 0.8,
  detail: 0.67,
};

/**
 * Which reviewed structure field a text effect prints. A token, never the text:
 * the player reads the string from the approved revision, so an edited sentence
 * cannot leave a stale copy behind in the scene.
 */
export const PITCH_TEXT_SOURCES = [
  'hook',
  'relationship_context',
  'quality:0',
  'quality:1',
  'quality:2',
  'evidence_or_anecdote',
  'good_match_for',
] as const;

export const pitchTextSourceSchema = z.enum(PITCH_TEXT_SOURCES);

export type PitchTextSource = z.infer<typeof pitchTextSourceSchema>;

export const PITCH_SCENE_TEMPLATES = ['warm', 'hype'] as const;

export const pitchSceneTemplateSchema = z.enum(PITCH_SCENE_TEMPLATES);

export type PitchSceneTemplate = z.infer<typeof pitchSceneTemplateSchema>;

export const PITCH_EASINGS = ['linear', 'easeIn', 'easeOut', 'easeInOut'] as const;

const easingSchema = z.enum(PITCH_EASINGS);

export type PitchEasing = z.infer<typeof easingSchema>;

const timestampSchema = z.number().int().min(0).max(MAX_SCENE_DURATION_MS);

const unitScalarSchema = z.number().min(0).max(1);

const wordRefSchema = z
  .object({
    segmentIndex: z.number().int().min(0).max(MAX_TRANSCRIPT_SEGMENT_INDEX),
    wordIndex: z.number().int().min(0).max(MAX_TRANSCRIPT_WORD_INDEX),
  })
  .strict();

export type PitchWordRef = z.infer<typeof wordRefSchema>;

function cropRectSchema(minSize: number) {
  return z
    .object({
      x: unitScalarSchema,
      y: unitScalarSchema,
      width: z.number().min(minSize).max(1),
      height: z.number().min(minSize).max(1),
    })
    .strict()
    .refine(
      (crop) => Math.abs(crop.width - crop.height) <= FLOAT_SLACK,
      'a crop must be square in canvas-normalized space, which is 9:16 in pixels',
    )
    .refine(
      (crop) => crop.x + crop.width <= 1 + FLOAT_SLACK && crop.y + crop.height <= 1 + FLOAT_SLACK,
      'a crop must stay inside the frame the Dater reviewed',
    );
}

/** Shape only — the per-level bounds live in the level's own schema. */
export type PitchCropRect = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

// --- Shot-local effects -----------------------------------------------------
//
// A shot-local effect is a transform of THIS shot's own pixels, or a mark tied to
// a word spoken while this shot is on screen. Nesting them makes two invariants
// structural instead of cross-referential: an effect cannot outlive its shot, and
// a kenBurns destination is bounded by the level that owns it.

function kenBurnsSchema(minSize: number) {
  return z
    .object({
      type: z.literal('kenBurns'),
      /** Destination crop. The shot's own `crop` is the start; there is no timing
       * field because a kenBurns always spans exactly its shot. */
      to: cropRectSchema(minSize),
      easing: easingSchema,
    })
    .strict();
}

const punchSchema = z
  .object({
    type: z.literal('punch'),
    atMs: timestampSchema,
    durationMs: z.number().int().min(80).max(400),
    scale: z.number().min(1.02).max(1.12),
    easing: easingSchema,
  })
  .strict();

const wordPopSchema = z
  .object({
    type: z.literal('wordPop'),
    /** Which transcript word to lift. Never the word itself. */
    word: wordRefSchema,
    startMs: timestampSchema,
    endMs: timestampSchema,
    scale: z.number().min(1).max(1.6),
    easing: easingSchema,
  })
  .strict();

const backdropBlurSchema = z
  .object({
    type: z.literal('backdropBlur'),
    radiusPx: z.number().int().min(8).max(64),
    dim: z.number().min(0).max(0.6),
  })
  .strict();

const kineticTextSchema = z
  .object({
    type: z.literal('kineticText'),
    source: pitchTextSourceSchema,
    revealMs: z.number().int().min(80).max(800),
    easing: easingSchema,
    emphasis: unitScalarSchema,
  })
  .strict();

export type PitchKineticText = z.infer<typeof kineticTextSchema>;

// --- Shots ------------------------------------------------------------------

function photoShotSchema<Level extends PitchPhotoShotLevel>(level: Level, minSize: number) {
  return z
    .object({
      level: z.literal(level),
      assetId: z.string().uuid(),
      startMs: timestampSchema,
      endMs: timestampSchema,
      /** Start framing. Normalized against the canvas-fitted frame, square. */
      crop: cropRectSchema(minSize),
      effects: z
        .array(
          z.discriminatedUnion('type', [
            kenBurnsSchema(minSize),
            punchSchema,
            wordPopSchema,
            backdropBlurSchema,
          ]),
        )
        .max(MAX_EFFECTS_PER_SHOT),
    })
    .strict();
}

/**
 * L4. No photo, no crop: the card IS the reviewed sentence, animated. It is the
 * only place kineticText exists — text over a photo is limited to wordPop and
 * countBadge, so "text everywhere" is not expressible.
 */
const typographicShotSchema = z
  .object({
    level: z.literal('typographic'),
    startMs: timestampSchema,
    endMs: timestampSchema,
    text: kineticTextSchema,
  })
  .strict();

const shotSchema = z.discriminatedUnion('level', [
  photoShotSchema('wide', CROP_LEVEL_MIN_SIZE.wide),
  photoShotSchema('punchIn', CROP_LEVEL_MIN_SIZE.punchIn),
  photoShotSchema('detail', CROP_LEVEL_MIN_SIZE.detail),
  photoShotSchema('wideAlt', CROP_LEVEL_MIN_SIZE.wideAlt),
  typographicShotSchema,
]);

export type PitchShotV2 = z.infer<typeof shotSchema>;

export type PitchPhotoShotV2 = Extract<PitchShotV2, { level: PitchPhotoShotLevel }>;

export type PitchShotEffectV2 = PitchPhotoShotV2['effects'][number];

// --- Scene-wide look and chrome ---------------------------------------------
//
// These four are scene-level rather than shot-level for one reason: restarting
// them at a cut is visible. A per-shot grade flickers between shots, per-shot
// grain re-seeds with a pop, and a progress bar or waveform that resets 12 times
// is not a progress bar. They are keyed by name rather than listed in an array so
// "at most one grade" is structural — an array would need a uniqueness refine and
// would leave compositing order undefined.

const gradeSchema = z
  .object({
    warmth: z.number().min(-1).max(1),
    contrast: z.number().min(0.8).max(1.4),
    saturation: z.number().min(0.6).max(1.4),
    vignette: z.number().min(0).max(0.6),
  })
  .strict();

/**
 * Grain is the one place where safety is an amplitude bound rather than a frequency
 * bound. The 3Hz ceiling exists to stop luminance FLASHES (lightLeak.pulseHz, and
 * the combined flash rate); grain is sub-pixel texture, it resamples per frame in
 * every real film emulation, and forcing it to 3Hz would turn texture into visible
 * flicker. So it may animate up to frame rate, and its luminance swing is held
 * under the general-flash threshold by MAX_GRAIN_INTENSITY instead.
 */
const grainSchema = z
  .object({
    intensity: z.number().min(0).max(MAX_GRAIN_INTENSITY),
    sizePx: z.number().min(1).max(4),
    /** Frozen at build time. The player never draws a random number. */
    seed: z.number().int().min(0).max(2_147_483_647),
    /** 0 = still grain. Up to frame rate; see the note above on why not 3Hz. */
    animationHz: z.number().min(0).max(MAX_GRAIN_ANIMATION_HZ),
  })
  .strict();

const progressBarSchema = z
  .object({
    thicknessPx: z.number().int().min(2).max(12),
    opacity: z.number().min(0.2).max(1),
    anchor: z.enum(['top', 'bottom']),
  })
  .strict();

const waveVizSchema = z
  .object({
    /**
     * The baked voice envelope, one sample per `sampleIntervalMs`, covering the
     * whole scene. Baked because a player that ran a live analyser would be
     * recomputing at playback time, which is exactly what approval forbids.
     */
    amplitudes: z.array(unitScalarSchema).min(1).max(MAX_WAVE_SAMPLES),
    sampleIntervalMs: z.number().int().min(40).max(1000),
    heightPx: z.number().int().min(24).max(240),
    opacity: z.number().min(0.2).max(1),
    anchor: z.enum(['top', 'bottom']),
  })
  .strict();

const lookSchema = z.object({ grade: gradeSchema, grain: grainSchema }).strict();

const chromeSchema = z
  .object({
    progressBar: progressBarSchema.optional(),
    waveViz: waveVizSchema.optional(),
  })
  .strict();

// --- Timed overlays ---------------------------------------------------------
//
// Overlays float above the shots on absolute time: a light leak is a transition
// device that may straddle a cut, and a count badge labels a passage rather than a
// photo. Keeping every flash-capable element in one array is also what makes the
// flash-rate audit a single sorted list.

const lightLeakSchema = z
  .object({
    type: z.literal('lightLeak'),
    startMs: timestampSchema,
    endMs: timestampSchema,
    peakIntensity: z.number().min(0).max(0.6),
    /**
     * Whole Hz only, 0..3. A fractional Hz can put `floor(k * 1000 / pulseHz)` on
     * either side of a millisecond boundary in a JavaScript float, in PL/pgSQL
     * NUMERIC and in the builder, which would split the three peak lists the flash
     * budget compares. 0 means "appears once, never oscillates".
     */
    pulseHz: z.number().int().min(0).max(MAX_FLICKER_HZ),
    angleDeg: z.number().min(0).max(360),
  })
  .strict();

const countBadgeSchema = z
  .object({
    type: z.literal('countBadge'),
    source: pitchTextSourceSchema,
    startMs: timestampSchema,
    endMs: timestampSchema,
    emphasis: unitScalarSchema,
  })
  .strict();

const overlaySchema = z.discriminatedUnion('type', [lightLeakSchema, countBadgeSchema]);

export type PitchSceneOverlayV2 = z.infer<typeof overlaySchema>;

/** How long each timed element may hold. Exported because the DB mirrors them. */
export const MIN_LIGHT_LEAK_MS = 120;
export const MAX_LIGHT_LEAK_MS = 1200;
export const MIN_COUNT_BADGE_MS = 400;
export const MAX_COUNT_BADGE_MS = 4000;
export const MIN_WORD_POP_MS = 120;
export const MAX_WORD_POP_MS = 1200;

const sceneShapeSchema = z
  .object({
    schemaVersion: z.literal(PITCH_SCENE_V2_SCHEMA_VERSION),
    template: pitchSceneTemplateSchema,
    canvas: z
      .object({
        width: z.number().int().min(1).max(MAX_CANVAS_DIMENSION),
        height: z.number().int().min(1).max(MAX_CANVAS_DIMENSION),
        fps: z.number().int().min(1).max(MAX_CANVAS_FPS),
      })
      .strict(),
    durationMs: z.number().int().min(MIN_SCENE_DURATION_MS_V2).max(MAX_SCENE_DURATION_MS),
    /**
     * Every photo the scene uses, in publication order. Redundant with the shots
     * on purpose: the DB compares this one array against the Dater's include set
     * instead of walking a nested jsonb path, and "every included photo appears at
     * least once" becomes checkable inside the scene itself.
     */
    assetIds: z.array(z.string().uuid()).min(1).max(MAX_SCENE_ASSETS),
    shots: z.array(shotSchema).min(1).max(MAX_SHOTS_PER_SCENE),
    look: lookSchema,
    chrome: chromeSchema,
    overlays: z.array(overlaySchema).max(MAX_OVERLAYS_PER_SCENE),
  })
  .strict();

type PitchSceneV2Shape = z.infer<typeof sceneShapeSchema>;

function checkShotTimeline(scene: PitchSceneV2Shape, ctx: z.RefinementCtx): void {
  let expectedStart = 0;
  for (const [index, shot] of scene.shots.entries()) {
    const duration = shot.endMs - shot.startMs;
    if (shot.startMs !== expectedStart) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['shots', index, 'startMs'],
        message: 'shots must be contiguous with no gap or overlap',
      });
    }
    if (duration < MIN_SHOT_DURATION_MS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['shots', index, 'endMs'],
        message: `every shot must last at least ${MIN_SHOT_DURATION_MS}ms`,
      });
    }
    if (duration > MAX_SHOT_DURATION_MS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['shots', index, 'endMs'],
        message: `no shot may last longer than ${MAX_SHOT_DURATION_MS}ms`,
      });
    }
    expectedStart = shot.endMs;
  }
  if (expectedStart !== scene.durationMs) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['shots'],
      message: 'shots must cover exactly [0, durationMs]',
    });
  }
}

function checkVisualChange(scene: PitchSceneV2Shape, ctx: z.RefinementCtx): void {
  let previousLevel: PitchShotLevel | null = null;
  let photoShots = 0;
  for (const [index, shot] of scene.shots.entries()) {
    const duration = shot.endMs - shot.startMs;
    if (shot.level === 'typographic') {
      if (previousLevel === 'typographic') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['shots', index, 'level'],
          message: 'two text cards may not follow each other',
        });
      }
      if (duration > MAX_STATIC_SHOT_MS) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['shots', index, 'endMs'],
          message: `a text card may not last longer than ${MAX_STATIC_SHOT_MS}ms`,
        });
      }
    } else {
      photoShots += 1;
      const kenBurns = shot.effects.filter((effect) => effect.type === 'kenBurns');
      if (duration > MAX_STATIC_SHOT_MS && kenBurns.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['shots', index, 'effects'],
          message: `a shot longer than ${MAX_STATIC_SHOT_MS}ms must carry a kenBurns`,
        });
      }
      for (const move of kenBurns) {
        const travel = Math.max(
          Math.abs(move.to.width - shot.crop.width),
          Math.abs(move.to.x - shot.crop.x),
          Math.abs(move.to.y - shot.crop.y),
        );
        if (travel < MIN_KEN_BURNS_TRAVEL) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['shots', index, 'effects'],
            message: 'a kenBurns must actually travel',
          });
        }
      }
    }
    previousLevel = shot.level;
  }
  if (photoShots === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['shots'],
      message: 'a scene must show at least one photo',
    });
  }
}

function checkShotEffects(scene: PitchSceneV2Shape, ctx: z.RefinementCtx): void {
  for (const [index, shot] of scene.shots.entries()) {
    if (shot.level === 'typographic') {
      continue;
    }
    const path = ['shots', index, 'effects'];
    const counts = new Map<string, number>();
    const maxZoom = 1 / CROP_LEVEL_MIN_SIZE[shot.level];
    let punchScale = 1;
    let tightest = shot.crop.width;
    for (const effect of shot.effects) {
      counts.set(effect.type, (counts.get(effect.type) ?? 0) + 1);
      switch (effect.type) {
        case 'kenBurns':
          tightest = Math.min(tightest, effect.to.width);
          break;
        case 'punch':
          punchScale = Math.max(punchScale, effect.scale);
          if (effect.atMs < shot.startMs || effect.atMs + effect.durationMs > shot.endMs) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path,
              message: 'a punch must start and end inside its own shot',
            });
          }
          break;
        case 'wordPop': {
          const duration = effect.endMs - effect.startMs;
          if (effect.startMs < shot.startMs || effect.endMs > shot.endMs) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path,
              message: 'a wordPop must start and end inside its own shot',
            });
          }
          if (duration < MIN_WORD_POP_MS || duration > MAX_WORD_POP_MS) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path,
              message: `a wordPop must last between ${MIN_WORD_POP_MS}ms and ${MAX_WORD_POP_MS}ms`,
            });
          }
          break;
        }
        case 'backdropBlur':
          break;
      }
    }
    if ((counts.get('kenBurns') ?? 0) > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path,
        message: 'a shot may carry at most one kenBurns',
      });
    }
    if ((counts.get('backdropBlur') ?? 0) > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path,
        message: 'a shot may carry at most one backdropBlur',
      });
    }
    if ((counts.get('punch') ?? 0) > MAX_PUNCHES_PER_SHOT) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path,
        message: `a shot may carry at most ${MAX_PUNCHES_PER_SHOT} punches`,
      });
    }
    if ((counts.get('wordPop') ?? 0) > MAX_WORD_POPS_PER_SHOT) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path,
        message: `a shot may carry at most ${MAX_WORD_POPS_PER_SHOT} wordPops`,
      });
    }
    // The zoom ceiling is on what the viewer actually sees: the tightest crop the
    // shot reaches, multiplied by its loudest punch.
    if ((1 / tightest) * punchScale > maxZoom + FLOAT_SLACK) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['shots', index, 'crop'],
        message: `a ${shot.level} shot may not exceed ${maxZoom.toFixed(2)}x zoom, punch included`,
      });
    }
  }
}

function checkAssetLadder(scene: PitchSceneV2Shape, ctx: z.RefinementCtx): void {
  if (new Set(scene.assetIds).size !== scene.assetIds.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['assetIds'],
      message: 'assetIds must not repeat',
    });
  }
  const declared = new Set(scene.assetIds);
  const used = new Set<string>();
  const lastLadderIndex = new Map<string, number>();
  for (const [index, shot] of scene.shots.entries()) {
    if (shot.level === 'typographic') {
      continue;
    }
    used.add(shot.assetId);
    if (!declared.has(shot.assetId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['shots', index, 'assetId'],
        message: 'a shot may only use a photo listed in assetIds',
      });
    }
    const key = `${shot.assetId}:${shot.level}`;
    const previous = lastLadderIndex.get(key);
    if (previous !== undefined && index - previous < MIN_LADDER_REPEAT_GAP_SHOTS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['shots', index, 'level'],
        message: `the same photo and framing may not repeat within ${MIN_LADDER_REPEAT_GAP_SHOTS} shots`,
      });
    }
    lastLadderIndex.set(key, index);
  }
  for (const [index, assetId] of scene.assetIds.entries()) {
    if (!used.has(assetId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['assetIds', index],
        message: 'every listed photo must appear in at least one shot',
      });
    }
  }
}

function checkTextReferences(scene: PitchSceneV2Shape, ctx: z.RefinementCtx): void {
  const cardSources = new Set<PitchTextSource>();
  for (const [index, shot] of scene.shots.entries()) {
    if (shot.level !== 'typographic') {
      continue;
    }
    if (cardSources.has(shot.text.source)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['shots', index, 'text', 'source'],
        message: 'the same sentence may not be shown as a card twice',
      });
    }
    cardSources.add(shot.text.source);
  }
  const poppedWords = new Set<string>();
  for (const [index, shot] of scene.shots.entries()) {
    if (shot.level === 'typographic') {
      continue;
    }
    for (const effect of shot.effects) {
      if (effect.type !== 'wordPop') {
        continue;
      }
      const key = `${effect.word.segmentIndex}:${effect.word.wordIndex}`;
      if (poppedWords.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['shots', index, 'effects'],
          message: 'the same word may not pop twice',
        });
      }
      poppedWords.add(key);
    }
  }
}

function checkOverlays(scene: PitchSceneV2Shape, ctx: z.RefinementCtx): void {
  const lastEnd = new Map<string, number>();
  for (const [index, overlay] of scene.overlays.entries()) {
    const duration = overlay.endMs - overlay.startMs;
    const path = ['overlays', index];
    if (overlay.endMs > scene.durationMs) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path,
        message: 'an overlay must end within the scene',
      });
    }
    const bounds =
      overlay.type === 'lightLeak'
        ? { min: MIN_LIGHT_LEAK_MS, max: MAX_LIGHT_LEAK_MS }
        : { min: MIN_COUNT_BADGE_MS, max: MAX_COUNT_BADGE_MS };
    if (duration < bounds.min || duration > bounds.max) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path,
        message: `a ${overlay.type} must last between ${bounds.min}ms and ${bounds.max}ms`,
      });
    }
    const previousEnd = lastEnd.get(overlay.type);
    if (previousEnd !== undefined && overlay.startMs < previousEnd) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path,
        message: `overlays of type ${overlay.type} must be ordered and must not overlap`,
      });
    }
    lastEnd.set(overlay.type, overlay.endMs);
  }
}

/**
 * The luminance peaks one light leak delivers, ascending.
 *
 * `peak_k = startMs + floor(k * 1000 / pulseHz)` over the HALF-OPEN interval
 * [startMs, endMs): k = 0 is a peak because the appearance is itself an event, and
 * a peak landing exactly on endMs belongs to no frame the leak is still drawn on.
 * `pulseHz = 0` is "appears once, never oscillates", which is also what keeps the
 * division safe.
 *
 * Exported because three implementations have to agree on it to the millisecond:
 * this parser, the builder that emits leaks, and 0049's PL/pgSQL mirror.
 */
export function lightLeakFlashPeaks(leak: {
  readonly startMs: number;
  readonly endMs: number;
  readonly pulseHz: number;
}): readonly number[] {
  if (leak.endMs <= leak.startMs) {
    return [];
  }
  if (leak.pulseHz <= 0) {
    return [leak.startMs];
  }
  const maxIndex = Math.min(
    Math.ceil(((leak.endMs - leak.startMs) * leak.pulseHz) / 1000),
    MAX_LEAK_PULSE_INDEX,
  );
  const peaks: number[] = [];
  for (let k = 0; k <= maxIndex; k += 1) {
    const atMs = leak.startMs + Math.floor((k * 1000) / leak.pulseHz);
    if (atMs >= leak.endMs) {
      break;
    }
    peaks.push(atMs);
  }
  return peaks;
}

/**
 * THE FLASH TIMELINE: the union of every instantaneous luminance or appearance
 * event a scene delivers, ascending.
 *
 * Four kinds, one budget. A punch onset and a light leak are both momentary
 * luminance jumps, so two of them 100ms apart is a 10Hz stimulus no matter which
 * types they were; a leak is EXPANDED into its pulse peaks rather than counted
 * once, because counting the onset alone let a 3Hz leak deliver four peaks with
 * three punches between them; and a wordPop or countBadge arriving is an event a
 * viewer perceives as a flash whatever the layer that drew it is called. Shot cuts
 * are already >=1200ms apart, so they cannot contribute.
 *
 * Exported for the same reason as {@link lightLeakFlashPeaks}: the builder pays
 * this budget while it assembles, and it must be paying the same one.
 */
export function pitchSceneV2FlashEvents(scene: {
  readonly shots: readonly PitchShotV2[];
  readonly overlays: readonly PitchSceneOverlayV2[];
}): readonly number[] {
  const events: number[] = [];
  for (const shot of scene.shots) {
    if (shot.level === 'typographic') {
      continue;
    }
    for (const effect of shot.effects) {
      if (effect.type === 'punch') {
        events.push(effect.atMs);
      } else if (effect.type === 'wordPop') {
        events.push(effect.startMs);
      }
    }
  }
  for (const overlay of scene.overlays) {
    if (overlay.type === 'lightLeak') {
      events.push(...lightLeakFlashPeaks(overlay));
    } else {
      events.push(overlay.startMs);
    }
  }
  return events.sort((left, right) => left - right);
}

/** The budget itself: no two events on that timeline closer than 334ms. */
function checkFlashRate(scene: PitchSceneV2Shape, ctx: z.RefinementCtx): void {
  const events = pitchSceneV2FlashEvents(scene);
  for (let index = 1; index < events.length; index += 1) {
    const gap = (events[index] as number) - (events[index - 1] as number);
    if (gap < MIN_FLASH_INTERVAL_MS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['shots'],
        message: `flashes must be at least ${MIN_FLASH_INTERVAL_MS}ms apart (${MAX_FLICKER_HZ}Hz)`,
      });
      return;
    }
  }
}

function checkWaveViz(scene: PitchSceneV2Shape, ctx: z.RefinementCtx): void {
  const waveViz = scene.chrome.waveViz;
  if (waveViz === undefined) {
    return;
  }
  const expected = Math.ceil(scene.durationMs / waveViz.sampleIntervalMs);
  if (waveViz.amplitudes.length !== expected) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['chrome', 'waveViz', 'amplitudes'],
      message: `the baked envelope must hold exactly ${expected} samples for this scene`,
    });
  }
}

/**
 * Client-side mirror of the stored v2 shape plus every invariant the DB enforces.
 * A stored scene that fails this parse reads as "no scene": the surface falls
 * back rather than rendering something half-valid (plan A4).
 */
export const pitchSceneV2Schema = sceneShapeSchema.superRefine((scene, ctx) => {
  checkShotTimeline(scene, ctx);
  checkVisualChange(scene, ctx);
  checkShotEffects(scene, ctx);
  checkAssetLadder(scene, ctx);
  checkTextReferences(scene, ctx);
  checkOverlays(scene, ctx);
  checkFlashRate(scene, ctx);
  checkWaveViz(scene, ctx);
});

export type PitchSceneV2 = z.infer<typeof pitchSceneV2Schema>;

// --- Reading either version -------------------------------------------------

export type PitchSceneAnyVersion = PitchSceneV1 | PitchSceneV2;

/**
 * Union parser for callers that accept whatever a revision happens to hold. Both
 * branches pin `schemaVersion` to a literal and both are strict, so a v1 scene can
 * never satisfy v2 or the reverse.
 */
export const pitchSceneSchema = z.union([pitchSceneV1Schema, pitchSceneV2Schema]);

export function isPitchSceneV2(scene: PitchSceneAnyVersion): scene is PitchSceneV2 {
  return scene.schemaVersion === PITCH_SCENE_V2_SCHEMA_VERSION;
}

export function isPitchSceneV1(scene: PitchSceneAnyVersion): scene is PitchSceneV1 {
  return scene.schemaVersion === 1;
}

/**
 * Parses a stored scene of either version, dispatching on `schemaVersion` first so
 * a broken v2 reports v2 issues instead of a union error naming both branches.
 * Returns null for anything else, which every surface already treats as "no
 * scene".
 */
export function parsePitchScene(value: unknown): PitchSceneAnyVersion | null {
  const version =
    typeof value === 'object' && value !== null && 'schemaVersion' in value
      ? (value as { readonly schemaVersion: unknown }).schemaVersion
      : undefined;
  if (version === PITCH_SCENE_V2_SCHEMA_VERSION) {
    const parsed = pitchSceneV2Schema.safeParse(value);
    return parsed.success ? parsed.data : null;
  }
  if (version === 1) {
    const parsed = pitchSceneV1Schema.safeParse(value);
    return parsed.success ? parsed.data : null;
  }
  return null;
}

// --- The canonical example --------------------------------------------------

/** Illustrative photo ids. They belong to no revision; nothing may resolve them. */
function examplePhotoId(index: number): string {
  return `40000000-0000-0000-0000-${String(index).padStart(12, '0')}`;
}

function exampleEnvelope(durationMs: number, intervalMs: number): number[] {
  return Array.from(
    { length: Math.ceil(durationMs / intervalMs) },
    (_value, index) => (index % 10) / 10,
  );
}

const EXAMPLE_DURATION_MS = 14_400;
const EXAMPLE_WAVE_INTERVAL_MS = 100;

/**
 * One valid scene that exercises all eleven effects, every ladder level and both
 * kinds of overlay. Exported so the DB, web and mobile surfaces test against the
 * same example instead of each inventing one that drifts; the contract's own test
 * suite parses and mutates this exact object.
 *
 * A fresh object every call, so a caller may mutate it freely. The timeline:
 *
 *   0 wide        photo 1   0..3000      kenBurns
 *   1 punchIn     photo 2   3000..5400   punch, wordPop
 *   2 detail      photo 3   5400..7600   backdropBlur, wordPop
 *   3 typographic           7600..9800   hook
 *   4 wideAlt     photo 4   9800..12000  punch
 *   5 wide        photo 1   12000..14400 (repeat, five shots after its first turn)
 *
 * Its flash timeline is 3600, 4300, 5500, 6000, 7400, 10200 — six events, the
 * closest pair 500ms apart. The wordPops sit where they do because they are on the
 * same 334ms budget as the punch above them and the badge beside them, which is
 * also why this example leaves room on both sides of every event for a test to
 * probe the boundary.
 */
export function examplePitchSceneV2(): PitchSceneV2 {
  return {
    schemaVersion: 2,
    template: 'warm',
    canvas: { width: 1080, height: 1920, fps: 30 },
    durationMs: EXAMPLE_DURATION_MS,
    assetIds: [examplePhotoId(1), examplePhotoId(2), examplePhotoId(3), examplePhotoId(4)],
    shots: [
      {
        level: 'wide',
        assetId: examplePhotoId(1),
        startMs: 0,
        endMs: 3_000,
        crop: { x: 0, y: 0, width: 1, height: 1 },
        effects: [
          {
            type: 'kenBurns',
            to: { x: 0.02, y: 0.02, width: 0.96, height: 0.96 },
            easing: 'easeInOut',
          },
        ],
      },
      {
        level: 'punchIn',
        assetId: examplePhotoId(2),
        startMs: 3_000,
        endMs: 5_400,
        crop: { x: 0.05, y: 0.05, width: 0.9, height: 0.9 },
        effects: [
          { type: 'punch', atMs: 3_600, durationMs: 200, scale: 1.1, easing: 'easeOut' },
          {
            type: 'wordPop',
            word: { segmentIndex: 0, wordIndex: 3 },
            startMs: 4_300,
            endMs: 4_700,
            scale: 1.3,
            easing: 'easeOut',
          },
        ],
      },
      {
        level: 'detail',
        assetId: examplePhotoId(3),
        startMs: 5_400,
        endMs: 7_600,
        crop: { x: 0.1, y: 0.15, width: 0.7, height: 0.7 },
        effects: [
          { type: 'backdropBlur', radiusPx: 24, dim: 0.3 },
          {
            type: 'wordPop',
            word: { segmentIndex: 1, wordIndex: 0 },
            startMs: 6_000,
            endMs: 6_400,
            scale: 1.2,
            easing: 'linear',
          },
        ],
      },
      {
        level: 'typographic',
        startMs: 7_600,
        endMs: 9_800,
        text: {
          type: 'kineticText',
          source: 'hook',
          revealMs: 400,
          easing: 'easeOut',
          emphasis: 1,
        },
      },
      {
        level: 'wideAlt',
        assetId: examplePhotoId(4),
        startMs: 9_800,
        endMs: 12_000,
        crop: { x: 0.05, y: 0.05, width: 0.9, height: 0.9 },
        effects: [{ type: 'punch', atMs: 10_200, durationMs: 160, scale: 1.03, easing: 'easeOut' }],
      },
      {
        level: 'wide',
        assetId: examplePhotoId(1),
        startMs: 12_000,
        endMs: 14_400,
        crop: { x: 0, y: 0, width: 1, height: 1 },
        effects: [],
      },
    ],
    look: {
      grade: { warmth: 0.3, contrast: 1.1, saturation: 1.05, vignette: 0.25 },
      grain: { intensity: 0.12, sizePx: 2, seed: 1_234_567, animationHz: 24 },
    },
    chrome: {
      progressBar: { thicknessPx: 4, opacity: 0.6, anchor: 'bottom' },
      waveViz: {
        amplitudes: exampleEnvelope(EXAMPLE_DURATION_MS, EXAMPLE_WAVE_INTERVAL_MS),
        sampleIntervalMs: EXAMPLE_WAVE_INTERVAL_MS,
        heightPx: 64,
        opacity: 0.5,
        anchor: 'bottom',
      },
    },
    overlays: [
      { type: 'countBadge', source: 'quality:0', startMs: 5_500, endMs: 6_500, emphasis: 0.8 },
      {
        type: 'lightLeak',
        startMs: 7_400,
        endMs: 7_700,
        peakIntensity: 0.4,
        pulseHz: 2,
        angleDeg: 35,
      },
    ],
  };
}
