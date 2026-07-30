import { z } from 'zod';

import { pitchSceneV1Schema, type PitchSceneV1 } from './pitchScene';
import {
  CROP_LEVEL_MIN_SIZE,
  lightLeakFlashPeaks,
  MAX_COUNT_BADGE_MS,
  MAX_EFFECTS_PER_SHOT,
  MAX_FLICKER_HZ,
  MAX_GRAIN_ANIMATION_HZ,
  MAX_GRAIN_INTENSITY,
  MAX_LIGHT_LEAK_MS,
  MAX_OVERLAYS_PER_SCENE,
  MAX_PUNCHES_PER_SHOT,
  MAX_SCENE_ASSETS,
  MAX_SCENE_DURATION_MS,
  MAX_SHOT_DURATION_MS,
  MAX_SHOTS_PER_SCENE,
  MAX_STATIC_SHOT_MS,
  MAX_TRANSCRIPT_SEGMENT_INDEX,
  MAX_TRANSCRIPT_WORD_INDEX,
  MAX_WORD_POP_MS,
  MAX_WORD_POPS_PER_SHOT,
  MIN_COUNT_BADGE_MS,
  MIN_FLASH_INTERVAL_MS,
  MIN_KEN_BURNS_TRAVEL,
  MIN_LADDER_REPEAT_GAP_SHOTS,
  MIN_LIGHT_LEAK_MS,
  MIN_SCENE_DURATION_MS_V2,
  MIN_SHOT_DURATION_MS,
  MIN_WORD_POP_MS,
  PITCH_EASINGS,
  PITCH_SHOT_LEVELS,
  pitchSceneTemplateSchema,
  pitchSceneV2Schema,
  pitchTextSourceSchema,
  type PitchPhotoShotLevel,
  type PitchSceneV2,
  type PitchTextSource,
} from './pitchSceneV2';

// PitchScene v3 — v2 plus the video clip shot (Phase 3).
//
// v2 is FROZEN (its own file says why and when the one-time exception closed), and
// a new visual capability is therefore a new schemaVersion rather than an edit.
// This file re-declares the whole v2 shape because v2's shot and layer schemas are
// module-private, and it imports every v2 BOUND it shares so no number can drift by
// copy. The re-declaration is not taken on trust: `pitchSceneV3.test.ts` sweeps
// every numeric leaf and a list of structural mutations of the canonical v2 example
// and asserts the two parsers return the same verdict for each, which is what makes
// "v3 is a superset of v2" a measurement instead of a claim.
//
// Everything v2 says about itself still holds here — no text, closed vocabulary,
// frozen at build time, absolute time, viewer safety as a schema range — and the
// clip shot is designed so that none of it weakens:
//
// 1. NO AUDIO FIELD EXISTS. A clip plays silent, structurally: there is no volume,
//    no mix, no ducking, nowhere to put one. The Introducer's original voice is the
//    only audio a pitch has ever had, and the render proxy is cut with `-an`, so
//    the schema cannot even express a clip talking over it.
//
// 2. 1:1 PLAYBACK. `clipOutMs - clipInMs === endMs - startMs`, exactly. A clip
//    advances through its source at real speed: no slow motion, no time remap, no
//    freeze. Two reasons, and the safety one is not the obvious one — a retimed
//    clip is a second interpretation of footage the Dater reviewed at normal speed
//    (a 4x speed-up turns a walk into a stumble), and a frozen clip would smuggle a
//    still photo past the include list the Dater approved. Speed, if it is ever
//    wanted, is v4 with its own approval surface.
//
// 3. NO CROP. A clip is replayed cover-fitted to the canvas, which is the frame the
//    Dater reviewed, and nothing else. A static crop rect cannot follow a moving
//    subject, so cropping a clip is the one place where "effects only, original
//    pixels preserved" would stop being true by construction: the rect would sit
//    still while the face walked out of it. Deferred to v4 deliberately.
//
// 4. wordPop IS THE ONLY EFFECT A CLIP MAY CARRY. kenBurns and punch are camera
//    moves invented for a STILL: they exist to give a photo the motion it does not
//    have, and layering them over footage that is already moving is a double
//    transform of pixels the Dater approved (and, at 1.12x, a scale pop competing
//    with the subject's own motion). backdropBlur is a still-photo device too: it
//    blurs the frame so a text mark can sit on it, and a clip carries no card.
//    wordPop survives because it marks a word the Introducer SPOKE, on the voice
//    timeline, which is independent of what the shot underneath is doing.
//
// 5. A CLIP IS NOT A FLASH EVENT. Its shot boundary is a cut like any other (and
//    cuts are already >=1200ms apart) and its own frames are continuous change, not
//    a momentary luminance jump. So a clip contributes nothing to the 334ms budget,
//    while a wordPop drawn ON a clip still costs exactly what it costs anywhere
//    else. For the same reason the "nothing may sit visually still for longer than
//    2500ms" rule does not apply to a clip shot: the clip IS the visual change, and
//    demanding a kenBurns on top of it would contradict rule 4.
//
// 6. CLIPS ARE ADDITIVE, NEVER A SUBSTITUTE FOR PHOTOS. A v3 scene still has to
//    declare at least one photo and show it: the pre-publication identity and
//    face-match review is built on the photo set the Dater individually approved,
//    and a clip-only scene would route around it. `assetIds` therefore keeps its
//    v2 meaning — photos only, compared by the DB against the Dater's include set —
//    and clips get their own declared list, while MAX_SCENE_ASSETS stays a ceiling
//    over the two lists TOGETHER.

const FLOAT_SLACK = 1e-9;

export const PITCH_SCENE_V3_SCHEMA_VERSION = 3;

/**
 * Longest source window a clip shot may open, and, because playback is 1:1, the
 * longest a clip may hold the screen — per shot AND summed over every window of the
 * same clip in the scene (2026-07-30 product cap: source recording <=15s, scene use
 * <=10s). The aggregate half is what stops three adjacent 5s windows of one clip
 * from replaying 15s of footage that the per-shot ceiling alone would wave through.
 *
 * Both checks report the SAME message on purpose: they answer one question ("has
 * this clip held the screen too long?") and only the issue path differs, so a
 * mirror implementation may check them in either order and still return the string
 * the golden vectors pin.
 */
export const MAX_CLIP_USAGE_MS = 10_000;

/**
 * Source recordings are capped at 15s at capture, so no legal window can reach past
 * it. The authoritative check is the media probe, which only the server can run;
 * this bound keeps the scene self-validating without one.
 */
export const MAX_CLIP_SOURCE_MS = 15_000;

/** A clip shot obeys the same viewer-safety floor as every other shot. */
export const MIN_CLIP_SHOT_MS = MIN_SHOT_DURATION_MS;

/**
 * Distinct video clips one scene may reference. The product cap is 3 (free tier 1,
 * premium 3); which tier a given pitch gets is an entitlement question the DB owns,
 * so the schema pins only the absolute ceiling.
 */
export const MAX_CLIP_ASSETS_PER_SCENE = 3;

/** v2's five levels plus the clip. Order is stable; `clip` is appended. */
export const PITCH_SHOT_LEVELS_V3 = [...PITCH_SHOT_LEVELS, 'clip'] as const;

export type PitchShotLevelV3 = (typeof PITCH_SHOT_LEVELS_V3)[number];

const CLIP_HOLD_MESSAGE = `a clip may not hold the screen longer than ${MAX_CLIP_USAGE_MS}ms`;

const CLIP_PLAYBACK_MESSAGE =
  'a clip shot must replay its source 1:1 (clipOut - clipIn must equal endMs - startMs)';

const CLIP_WINDOW_MESSAGE = `a clip window must run forward and last at least ${MIN_CLIP_SHOT_MS}ms`;

const CLIP_LIST_MESSAGE = 'a clip shot may only use a clip listed in clipAssetIds';

/**
 * v2 keeps these three private, so they are re-stated rather than imported. They are
 * not re-decided: the parity sweep in pitchSceneV3.test.ts drives the canvas fields
 * and the envelope length past each bound and asserts v2 and v3 answer alike, so a
 * typo here fails a test instead of quietly widening v3.
 */
const MAX_CANVAS_DIMENSION = 4096;
const MAX_CANVAS_FPS = 60;
const MAX_WAVE_SAMPLES = 4096;

const easingSchema = z.enum(PITCH_EASINGS);

const timestampSchema = z.number().int().min(0).max(MAX_SCENE_DURATION_MS);

const unitScalarSchema = z.number().min(0).max(1);

const wordRefSchema = z
  .object({
    segmentIndex: z.number().int().min(0).max(MAX_TRANSCRIPT_SEGMENT_INDEX),
    wordIndex: z.number().int().min(0).max(MAX_TRANSCRIPT_WORD_INDEX),
  })
  .strict();

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

// --- Shot-local effects -----------------------------------------------------

function kenBurnsSchema(minSize: number) {
  return z
    .object({
      type: z.literal('kenBurns'),
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

// --- Shots ------------------------------------------------------------------

function photoShotSchema<Level extends PitchPhotoShotLevel>(level: Level, minSize: number) {
  return z
    .object({
      level: z.literal(level),
      assetId: z.string().uuid(),
      startMs: timestampSchema,
      endMs: timestampSchema,
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

const typographicShotSchema = z
  .object({
    level: z.literal('typographic'),
    startMs: timestampSchema,
    endMs: timestampSchema,
    text: kineticTextSchema,
  })
  .strict();

/**
 * L5, new in v3. A window into one reviewed video clip, replayed at real speed with
 * no audio, no crop and no camera move — see notes 1-4 at the top of this file.
 *
 * `clipInMs`/`clipOutMs` are milliseconds into the SOURCE clip; `startMs`/`endMs`
 * are milliseconds into the scene, like every other *Ms field here. The two are
 * bound together by the 1:1 rule, so there is exactly one way to read the pair and
 * a player never has to derive a rate.
 */
const clipShotSchema = z
  .object({
    level: z.literal('clip'),
    assetId: z.string().uuid(),
    startMs: timestampSchema,
    endMs: timestampSchema,
    clipInMs: z.number().int().min(0).max(MAX_CLIP_SOURCE_MS),
    clipOutMs: z.number().int().min(0).max(MAX_CLIP_SOURCE_MS),
    /**
     * wordPop only. A single-member discriminated union rather than a bare array so
     * an unknown effect type is still a discriminator failure with the same shape of
     * error a photo shot produces, and so adding a clip effect in v4 is one entry
     * rather than a restructure.
     */
    effects: z.array(z.discriminatedUnion('type', [wordPopSchema])).max(MAX_EFFECTS_PER_SHOT),
  })
  .strict();

const shotSchema = z.discriminatedUnion('level', [
  photoShotSchema('wide', CROP_LEVEL_MIN_SIZE.wide),
  photoShotSchema('punchIn', CROP_LEVEL_MIN_SIZE.punchIn),
  photoShotSchema('detail', CROP_LEVEL_MIN_SIZE.detail),
  photoShotSchema('wideAlt', CROP_LEVEL_MIN_SIZE.wideAlt),
  typographicShotSchema,
  clipShotSchema,
]);

export type PitchShotV3 = z.infer<typeof shotSchema>;

export type PitchPhotoShotV3 = Extract<PitchShotV3, { level: PitchPhotoShotLevel }>;

export type PitchClipShotV3 = Extract<PitchShotV3, { level: 'clip' }>;

export type PitchShotEffectV3 = PitchPhotoShotV3['effects'][number];

export type PitchClipShotEffectV3 = PitchClipShotV3['effects'][number];

// --- Scene-wide look and chrome ---------------------------------------------

const gradeSchema = z
  .object({
    warmth: z.number().min(-1).max(1),
    contrast: z.number().min(0.8).max(1.4),
    saturation: z.number().min(0.6).max(1.4),
    vignette: z.number().min(0).max(0.6),
  })
  .strict();

const grainSchema = z
  .object({
    intensity: z.number().min(0).max(MAX_GRAIN_INTENSITY),
    sizePx: z.number().min(1).max(4),
    seed: z.number().int().min(0).max(2_147_483_647),
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

const lightLeakSchema = z
  .object({
    type: z.literal('lightLeak'),
    startMs: timestampSchema,
    endMs: timestampSchema,
    peakIntensity: z.number().min(0).max(0.6),
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

export type PitchSceneOverlayV3 = z.infer<typeof overlaySchema>;

const sceneShapeSchema = z
  .object({
    schemaVersion: z.literal(PITCH_SCENE_V3_SCHEMA_VERSION),
    template: pitchSceneTemplateSchema,
    canvas: z
      .object({
        width: z.number().int().min(1).max(MAX_CANVAS_DIMENSION),
        height: z.number().int().min(1).max(MAX_CANVAS_DIMENSION),
        fps: z.number().int().min(1).max(MAX_CANVAS_FPS),
      })
      .strict(),
    durationMs: z.number().int().min(MIN_SCENE_DURATION_MS_V2).max(MAX_SCENE_DURATION_MS),
    /** Photos only, exactly as in v2: the array the DB compares against the include set. */
    assetIds: z.array(z.string().uuid()).min(1).max(MAX_SCENE_ASSETS),
    /**
     * Every video clip the scene uses, in publication order. ABSENT — never `[]` —
     * when the scene plays no clip, so "no clips" has one representation and a v2
     * scene is a v3 scene with nothing but its schemaVersion changed. Kept apart
     * from `assetIds` because the two are compared against different approval
     * lists: photos against the reviewed photo set, clips against the reviewed clip
     * set.
     */
    clipAssetIds: z
      .array(z.string().uuid())
      .min(1)
      .max(MAX_CLIP_ASSETS_PER_SCENE, `a scene may use at most ${MAX_CLIP_ASSETS_PER_SCENE} clips`)
      .optional(),
    shots: z.array(shotSchema).min(1).max(MAX_SHOTS_PER_SCENE),
    look: lookSchema,
    chrome: chromeSchema,
    overlays: z.array(overlaySchema).max(MAX_OVERLAYS_PER_SCENE),
  })
  .strict();

type PitchSceneV3Shape = z.infer<typeof sceneShapeSchema>;

/** A clip shot may hold the screen for MAX_CLIP_USAGE_MS; every other shot for MAX_SHOT_DURATION_MS. */
function shotCeilingMs(level: PitchShotLevelV3): number {
  return level === 'clip' ? MAX_CLIP_USAGE_MS : MAX_SHOT_DURATION_MS;
}

function checkShotTimeline(scene: PitchSceneV3Shape, ctx: z.RefinementCtx): void {
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
    if (duration > shotCeilingMs(shot.level)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['shots', index, 'endMs'],
        message:
          shot.level === 'clip'
            ? CLIP_HOLD_MESSAGE
            : `no shot may last longer than ${MAX_SHOT_DURATION_MS}ms`,
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

function checkVisualChange(scene: PitchSceneV3Shape, ctx: z.RefinementCtx): void {
  let previousLevel: PitchShotLevelV3 | null = null;
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
    } else if (shot.level !== 'clip') {
      // A clip shot is exempt: its own frames are the visual change, and the only
      // effect it may carry is a wordPop (note 4 above), so there is no kenBurns to
      // demand of it.
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
    // Unchanged from v2, and load-bearing in v3: a clip may not stand in for the
    // photo set the Dater approved face by face (note 6 above).
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['shots'],
      message: 'a scene must show at least one photo',
    });
  }
}

function checkWordPop(
  effect: z.infer<typeof wordPopSchema>,
  shot: { readonly startMs: number; readonly endMs: number },
  path: readonly (string | number)[],
  ctx: z.RefinementCtx,
): void {
  const duration = effect.endMs - effect.startMs;
  if (effect.startMs < shot.startMs || effect.endMs > shot.endMs) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [...path],
      message: 'a wordPop must start and end inside its own shot',
    });
  }
  if (duration < MIN_WORD_POP_MS || duration > MAX_WORD_POP_MS) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [...path],
      message: `a wordPop must last between ${MIN_WORD_POP_MS}ms and ${MAX_WORD_POP_MS}ms`,
    });
  }
}

function checkShotEffects(scene: PitchSceneV3Shape, ctx: z.RefinementCtx): void {
  for (const [index, shot] of scene.shots.entries()) {
    if (shot.level === 'typographic') {
      continue;
    }
    const path = ['shots', index, 'effects'];
    if (shot.level === 'clip') {
      for (const effect of shot.effects) {
        checkWordPop(effect, shot, path, ctx);
      }
      if (shot.effects.length > MAX_WORD_POPS_PER_SHOT) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path,
          message: `a shot may carry at most ${MAX_WORD_POPS_PER_SHOT} wordPops`,
        });
      }
      continue;
    }
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
        case 'wordPop':
          checkWordPop(effect, shot, path, ctx);
          break;
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
    if ((1 / tightest) * punchScale > maxZoom + FLOAT_SLACK) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['shots', index, 'crop'],
        message: `a ${shot.level} shot may not exceed ${maxZoom.toFixed(2)}x zoom, punch included`,
      });
    }
  }
}

function checkAssetLadder(scene: PitchSceneV3Shape, ctx: z.RefinementCtx): void {
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
    if (shot.level === 'typographic' || shot.level === 'clip') {
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

/**
 * The clip rules, and the one place v3 deliberately does NOT copy a v2 rule.
 *
 * A photo's repeat rule is a GAP: the same (photo, framing) pair may not come back
 * within MIN_LADDER_REPEAT_GAP_SHOTS shots, because the same pixels in the same
 * framing read as a slideshow stalling. Neither half of that transfers to a clip. A
 * second window of the same clip is different pixels in continuous motion, so
 * waiting three shots buys nothing; and the SAME window replayed is worse than a
 * repeated photo however far apart it sits, because identical motion arriving twice
 * reads as a playback glitch rather than as a deliberate return. So the gap is
 * replaced by two rules that match what a clip actually does wrong:
 *
 *   - a window (assetId, clipInMs, clipOutMs) may appear at most ONCE, at any
 *     distance; and
 *   - two windows of the same clip may not OVERLAP in source time, which is the
 *     near-miss uniqueness alone would admit — [0,3000) and [100,3100) replay 2900ms
 *     of the same frames offset by a tenth of a second, i.e. a stutter.
 *
 * Non-overlapping windows are strictly new footage, so they need no gap at all: two
 * adjacent windows of one clip are simply that clip playing on through a cut.
 */
function checkClipShots(scene: PitchSceneV3Shape, ctx: z.RefinementCtx): void {
  const declared = scene.clipAssetIds;
  const declaredSet = new Set(declared ?? []);
  const used = new Set<string>();
  const usageMs = new Map<string, number>();
  const windowsByAsset = new Map<string, { readonly inMs: number; readonly outMs: number }[]>();
  const seenWindows = new Set<string>();
  let clipShots = 0;

  if (declared !== undefined && declaredSet.size !== declared.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['clipAssetIds'],
      message: 'clipAssetIds must not repeat',
    });
  }

  // The scene asset ceiling is SHARED: 12 covers photos and clips together
  // (docs/DECISIONS.md, 2026-07-30 U8), so a 12-photo scene has no room for a clip.
  // Two separate ceilings would have let one scene reference 15 assets.
  if (scene.assetIds.length + (declared?.length ?? 0) > MAX_SCENE_ASSETS) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['clipAssetIds'],
      message: `a scene may reference at most ${MAX_SCENE_ASSETS} assets, photos and clips together`,
    });
  }

  for (const [index, shot] of scene.shots.entries()) {
    if (shot.level !== 'clip') {
      continue;
    }
    clipShots += 1;
    used.add(shot.assetId);
    if (!declaredSet.has(shot.assetId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['shots', index, 'assetId'],
        message: CLIP_LIST_MESSAGE,
      });
    }
    const window = shot.clipOutMs - shot.clipInMs;
    if (window < MIN_CLIP_SHOT_MS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['shots', index, 'clipOutMs'],
        message: CLIP_WINDOW_MESSAGE,
      });
    } else if (window > MAX_CLIP_USAGE_MS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['shots', index, 'clipOutMs'],
        message: CLIP_HOLD_MESSAGE,
      });
    }
    if (window !== shot.endMs - shot.startMs) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['shots', index, 'clipOutMs'],
        message: CLIP_PLAYBACK_MESSAGE,
      });
    }
    const key = `${shot.assetId}:${shot.clipInMs}:${shot.clipOutMs}`;
    if (seenWindows.has(key)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['shots', index, 'clipInMs'],
        message: 'the same clip window may not play twice',
      });
    }
    seenWindows.add(key);
    const previousWindows = windowsByAsset.get(shot.assetId) ?? [];
    for (const previous of previousWindows) {
      if (shot.clipInMs < previous.outMs && previous.inMs < shot.clipOutMs) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['shots', index, 'clipInMs'],
          message: 'two windows of the same clip may not overlap',
        });
        break;
      }
    }
    previousWindows.push({ inMs: shot.clipInMs, outMs: shot.clipOutMs });
    windowsByAsset.set(shot.assetId, previousWindows);
    usageMs.set(shot.assetId, (usageMs.get(shot.assetId) ?? 0) + (shot.endMs - shot.startMs));
  }

  for (const [assetId, held] of usageMs) {
    if (held > MAX_CLIP_USAGE_MS) {
      const declaredIndex = declared?.indexOf(assetId) ?? -1;
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: declaredIndex >= 0 ? ['clipAssetIds', declaredIndex] : ['shots'],
        message: CLIP_HOLD_MESSAGE,
      });
    }
  }

  if (declared === undefined) {
    if (clipShots > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['clipAssetIds'],
        message: CLIP_LIST_MESSAGE,
      });
    }
    return;
  }
  if (clipShots === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['clipAssetIds'],
      message: 'clipAssetIds must be absent when no shot plays a clip',
    });
  }
  for (const [index, assetId] of declared.entries()) {
    if (!used.has(assetId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['clipAssetIds', index],
        message: 'every listed clip must appear in at least one shot',
      });
    }
  }
}

function checkTextReferences(scene: PitchSceneV3Shape, ctx: z.RefinementCtx): void {
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

function checkOverlays(scene: PitchSceneV3Shape, ctx: z.RefinementCtx): void {
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
 * THE FLASH TIMELINE, v3. Identical to v2's union of momentary luminance and
 * appearance events, with one addition and one deliberate non-addition: a wordPop
 * drawn on a CLIP shot counts exactly like one drawn on a photo, and a clip shot
 * itself contributes nothing (note 5 above).
 *
 * Exported for the same reason as its v2 twin: the builder pays this budget while it
 * assembles and the DB mirrors it, so all three must be paying the same one.
 */
export function pitchSceneV3FlashEvents(scene: {
  readonly shots: readonly PitchShotV3[];
  readonly overlays: readonly PitchSceneOverlayV3[];
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

function checkFlashRate(scene: PitchSceneV3Shape, ctx: z.RefinementCtx): void {
  const events = pitchSceneV3FlashEvents(scene);
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

function checkWaveViz(scene: PitchSceneV3Shape, ctx: z.RefinementCtx): void {
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
 * Client-side mirror of the stored v3 shape plus every invariant the DB enforces. A
 * stored scene that fails this parse reads as "no scene": the surface falls back
 * rather than rendering something half-valid (plan A4).
 */
export const pitchSceneV3Schema = sceneShapeSchema.superRefine((scene, ctx) => {
  checkShotTimeline(scene, ctx);
  checkVisualChange(scene, ctx);
  checkShotEffects(scene, ctx);
  checkAssetLadder(scene, ctx);
  checkClipShots(scene, ctx);
  checkTextReferences(scene, ctx);
  checkOverlays(scene, ctx);
  checkFlashRate(scene, ctx);
  checkWaveViz(scene, ctx);
});

export type PitchSceneV3 = z.infer<typeof pitchSceneV3Schema>;

// --- Reading any version ----------------------------------------------------
//
// `pitchSceneSchema`, `parsePitchScene` and `PitchSceneAnyVersion` in pitchSceneV2.ts
// are NOT widened to admit v3, and not only because that file is frozen.
//
// A reader that cannot draw video must not receive a scene that contains video. The
// v2 reader answers null for `schemaVersion: 3` today, and null already means "no
// scene, fall back" on every surface — so a player built before clips existed
// degrades to the audio-and-photos pitch instead of silently dropping a clip shot
// and playing a timeline with holes in it. Widening the v2 union would turn that
// fail-closed default into a fail-open one.
//
// A surface therefore opts in to v3 by switching to `parseAnyPitchScene` once it can
// actually replay a clip. Both unions discriminate on `schemaVersion` first, so a
// scene never satisfies the wrong branch.

export type PitchSceneAny = PitchSceneV1 | PitchSceneV2 | PitchSceneV3;

/** The union for a v3-CAPABLE reader. See the note above before reaching for it. */
export const pitchSceneAnySchema = z.union([
  pitchSceneV1Schema,
  pitchSceneV2Schema,
  pitchSceneV3Schema,
]);

export function isPitchSceneV3(scene: PitchSceneAny): scene is PitchSceneV3 {
  return scene.schemaVersion === PITCH_SCENE_V3_SCHEMA_VERSION;
}

/**
 * v1 and v2 narrowing over the THREE-version union.
 *
 * `isPitchSceneV1` and `isPitchSceneV2` in pitchSceneV2.ts are typed to the union
 * that file froze, so they do not accept a `PitchSceneAny`. These two are the same
 * predicates over the wider union, and a v3-capable reader needs them: without a way
 * to narrow the other two branches, `parseAnyPitchScene` would force every caller to
 * compare `schemaVersion` by hand.
 */
export function isPitchSceneAnyV1(scene: PitchSceneAny): scene is PitchSceneV1 {
  return scene.schemaVersion === 1;
}

export function isPitchSceneAnyV2(scene: PitchSceneAny): scene is PitchSceneV2 {
  return scene.schemaVersion === 2;
}

/**
 * Parses a stored scene of any version, dispatching on `schemaVersion` first so a
 * broken v3 reports v3 issues instead of a union error naming all three branches.
 * Returns null for anything else, which every surface already treats as "no scene".
 */
export function parseAnyPitchScene(value: unknown): PitchSceneAny | null {
  const version =
    typeof value === 'object' && value !== null && 'schemaVersion' in value
      ? (value as { readonly schemaVersion: unknown }).schemaVersion
      : undefined;
  if (version === PITCH_SCENE_V3_SCHEMA_VERSION) {
    const parsed = pitchSceneV3Schema.safeParse(value);
    return parsed.success ? parsed.data : null;
  }
  if (version === 2) {
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

/** Illustrative clip ids, deliberately a different prefix from the photos. */
function exampleClipId(index: number): string {
  return `50000000-0000-0000-0000-${String(index).padStart(12, '0')}`;
}

function exampleEnvelope(durationMs: number, intervalMs: number): number[] {
  return Array.from(
    { length: Math.ceil(durationMs / intervalMs) },
    (_value, index) => (index % 10) / 10,
  );
}

const EXAMPLE_DURATION_MS = 27_600;
const EXAMPLE_WAVE_INTERVAL_MS = 100;

/**
 * One valid v3 scene: the v2 example's first five shots unchanged, then everything
 * the clip shot adds. Exported so the DB, web and mobile surfaces test against the
 * same example instead of each inventing one that drifts.
 *
 * A fresh object every call, so a caller may mutate it freely. The timeline:
 *
 *   0 wide        photo 1  0..3000       kenBurns
 *   1 punchIn     photo 2  3000..5400    punch, wordPop
 *   2 detail      photo 3  5400..7600    backdropBlur, wordPop
 *   3 typographic          7600..9800    hook
 *   4 wideAlt     photo 4  9800..12000   punch
 *   5 clip        clip 1   12000..16000  source [2000, 6000), wordPop
 *   6 clip        clip 2   16000..21000  source [0, 5000)
 *   7 wide        photo 1  21000..23400  (repeat, seven shots after its first turn)
 *   8 clip        clip 1   23400..26400  source [6000, 9000) — a second, later window
 *   9 clip        clip 3   26400..27600  source [0, 1200) — a clip at the shot floor
 *
 * Clip 1 holds the screen 4000 + 3000 = 7000ms over two non-overlapping windows,
 * inside the 10000ms per-clip ceiling; three distinct clips is the maximum a scene
 * may reference. Its flash timeline is 3600, 4300, 5500, 6000, 7400, 10200, 12500 —
 * seven events, the closest pair 500ms apart, the last of them a wordPop drawn on a
 * clip to prove a clip pays the same budget a photo does.
 */
export function examplePitchSceneV3(): PitchSceneV3 {
  return {
    schemaVersion: 3,
    template: 'warm',
    canvas: { width: 1080, height: 1920, fps: 30 },
    durationMs: EXAMPLE_DURATION_MS,
    assetIds: [examplePhotoId(1), examplePhotoId(2), examplePhotoId(3), examplePhotoId(4)],
    clipAssetIds: [exampleClipId(1), exampleClipId(2), exampleClipId(3)],
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
        level: 'clip',
        assetId: exampleClipId(1),
        startMs: 12_000,
        endMs: 16_000,
        clipInMs: 2_000,
        clipOutMs: 6_000,
        effects: [
          {
            type: 'wordPop',
            word: { segmentIndex: 2, wordIndex: 0 },
            startMs: 12_500,
            endMs: 12_900,
            scale: 1.25,
            easing: 'easeOut',
          },
        ],
      },
      {
        level: 'clip',
        assetId: exampleClipId(2),
        startMs: 16_000,
        endMs: 21_000,
        clipInMs: 0,
        clipOutMs: 5_000,
        effects: [],
      },
      {
        level: 'wide',
        assetId: examplePhotoId(1),
        startMs: 21_000,
        endMs: 23_400,
        crop: { x: 0, y: 0, width: 1, height: 1 },
        effects: [],
      },
      {
        level: 'clip',
        assetId: exampleClipId(1),
        startMs: 23_400,
        endMs: 26_400,
        clipInMs: 6_000,
        clipOutMs: 9_000,
        effects: [],
      },
      {
        level: 'clip',
        assetId: exampleClipId(3),
        startMs: 26_400,
        endMs: 27_600,
        clipInMs: 0,
        clipOutMs: 1_200,
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
