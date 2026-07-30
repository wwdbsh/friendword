import {
  isPitchSceneV2,
  type PitchEasing,
  type PitchSceneAnyVersion,
  type PitchSceneTemplate,
  type PitchSceneV2,
  type PitchShotLevel,
  type PitchTextSource,
  type PitchWordRef,
} from '@friendword/contracts';

// The PitchScene v2 interpreter. Pure: a scene plus a millisecond gives exactly
// one frame description, on every device, forever.
//
// INTERPRETER SEMANTICS ARE FROZEN PER schemaVersion. How this file reads a v2
// parameter is part of the approval boundary: the Dater said yes to a timeline,
// and "yes" only means something if the same JSON keeps producing the same
// picture. A visually meaningful change to any interpretation therefore needs a
// NEW schemaVersion with the old interpreter preserved, not an edit here. Pixel
// identity is not promised — browsers differ in filter and blur implementations,
// and that inherent tolerance is what U5 already accepted ("the approval is the
// content, not the rendering"). What is promised is the content: which photo, how
// framed, which reviewed sentence, at which millisecond.
//
// Two consequences of that rule, both visible below:
//   1. no wall clock, no dice, no audio re-analysis. Grain phase, ken burns
//      progress and every opacity are functions of the scene and `elapsedMs`.
//   2. an out-of-range reference SKIPS ITS EFFECT and nothing else. A wordPop
//      pointing past the transcript (a pre-A7 recording) or a text card naming a
//      structure field this revision does not carry must never crash the player
//      and must never print a placeholder — the viewer would be reading text
//      nobody approved. The DB refuses to store those references (0049); this is
//      the second line of the same defence.
//
// Every layer that appears or disappears mid-scene does so over an opacity ramp
// of at least MIN_TEXT_RAMP_MS (see below). A layer that pops in at full opacity
// is a luminance flash however small it is, and the schema's flash budget only
// spaces events apart — it cannot make an individual event gentle.
//
// waveViz is deliberately never rendered. Phase 2 templates do not emit it (no
// real audio envelope exists before Phase 4's ffmpeg pass), and drawing word
// density as if it were a waveform would claim an analysis the code did not do
// (CLAUDE.md §12). A defensively-arriving waveViz is ignored, not drawn.

/** A transcript word a `wordPop` may reference. Text included: the player draws it. */
export type SceneWord = {
  readonly segmentIndex: number;
  readonly wordIndex: number;
  readonly text: string;
};

/**
 * The five reviewed sentences a text effect may print. Exactly the fields the
 * public page already prints under the player — a scene can name one of these
 * and nothing else, which is why a card cannot smuggle in unreviewed copy.
 */
export type SceneTextFields = {
  readonly hook: string;
  readonly relationship_context: string;
  readonly three_specific_qualities: readonly string[];
  readonly evidence_or_anecdote: string;
  readonly good_match_for: string;
};

export type SceneV2FrameOptions = {
  readonly words: readonly SceneWord[];
  readonly text: SceneTextFields | null;
  /**
   * Honour `prefers-reduced-motion` (and, by the same switch, photosensitivity):
   * no camera travel, no punch, no light leak, no animated grain. The shot list
   * still plays, so the Dater's approved photo order and text cards are unchanged
   * — the cuts become plain crossfades, which is what v1 always was, and text
   * fades in over MIN_TEXT_RAMP_MS and then holds.
   */
  readonly reducedMotion: boolean;
};

export type SceneV2PhotoFrame = {
  readonly assetId: string;
  /** Index into the player's photo list. */
  readonly photoIndex: number;
  /** Places the crop inside the 9:16 stage; see `cropTransform`. */
  readonly transform: string;
  /** Composed zoom (crop travel and punch included), for assertions. */
  readonly zoom: number;
  readonly blurPx: number;
  readonly dim: number;
};

export type SceneV2Frame = {
  readonly shotIndex: number;
  readonly level: PitchShotLevel;
  /** The photo on screen. Null on a text card, which shows `backdrop` instead. */
  readonly photo: SceneV2PhotoFrame | null;
  /** A text card's blurred bed: the nearest photo shot, held still. */
  readonly backdrop: SceneV2PhotoFrame | null;
  /** Scene-wide grade for the media layer. */
  readonly filter: string;
  /** Signed warmth, -1 (cool) to 1 (warm); the tint layer's own strength. */
  readonly warmth: number;
  readonly vignette: number;
  readonly grain: {
    readonly opacity: number;
    readonly seed: number;
    readonly sizePx: number;
  } | null;
  readonly lightLeak: { readonly opacity: number; readonly angleDeg: number } | null;
  readonly wordPop: {
    readonly text: string;
    readonly scale: number;
    /** Ramped in and out; never a step. See `textRamp`. */
    readonly opacity: number;
  } | null;
  readonly card: {
    readonly text: string;
    readonly emphasis: number;
    /** 0..1 reveal progress; 1 for the rest of the shot. Drives the slide only. */
    readonly reveal: number;
    /** Ramped in and out; never a step. See `textRamp`. */
    readonly opacity: number;
  } | null;
  readonly badge: {
    readonly text: string;
    readonly emphasis: number;
    /** Ramped in and out; never a step. See `textRamp`. */
    readonly opacity: number;
  } | null;
  readonly progressBar: {
    readonly percent: number;
    readonly thicknessPx: number;
    readonly opacity: number;
    readonly anchor: 'top' | 'bottom';
  } | null;
};

/**
 * How blurred and dark a text card's photo bed is. A template constant, not a
 * scene parameter: a typographic shot carries only its text, and the look of the
 * bed is exactly the kind of thing `template` exists to decide.
 */
const CARD_BACKDROP: Readonly<Record<PitchSceneTemplate, { blurPx: number; dim: number }>> = {
  warm: { blurPx: 28, dim: 0.55 },
  hype: { blurPx: 18, dim: 0.42 },
};

/** How many seeded noise tiles animated grain cycles through. */
export const GRAIN_PHASES = 4;

/**
 * The floor on every text layer's fade, in milliseconds.
 *
 * A wordPop and a countBadge carry a scrim, so switching one on is a rectangle of
 * light arriving — the same photosensitivity event as a light leak, and one the
 * schema's 334ms flash budget cannot soften because that budget only spaces
 * events apart. So no text layer may change opacity faster than 1/150 per
 * millisecond, in EITHER motion mode: reduced motion is about vestibular motion,
 * while a hard-edged luminance step is a problem for every viewer.
 *
 * A consequence worth stating: the schema allows a 120ms wordPop, which is
 * shorter than a ramp in and a ramp out, so the shortest accents peak dim (0.4)
 * instead of arriving fast. That is the safe direction, and the builder's accents
 * are ≥240ms in practice.
 */
export const MIN_TEXT_RAMP_MS = 150;

/**
 * A text layer's opacity inside `[startMs, endMs)`: a trapezoid that rises over
 * MIN_TEXT_RAMP_MS, holds, and falls over MIN_TEXT_RAMP_MS. 0 exactly at the
 * window's first millisecond and near 0 at its last, so mounting and unmounting
 * the element is never visible as a step.
 *
 * Deliberately linear and deliberately not a CSS transition: the eased `reveal`
 * curve can be arbitrarily steep at one end (revealMs may be 80ms), and a CSS
 * transition would make the fade's real shape depend on the browser's frame
 * pacing — while a v2 frame has to be a function of the scene and the clock.
 */
function textRamp(clock: number, startMs: number, endMs: number): number {
  const rise = (clock - startMs) / MIN_TEXT_RAMP_MS;
  const fall = (endMs - clock) / MIN_TEXT_RAMP_MS;
  return round(clamp01(Math.min(rise, fall)), 4);
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function ease(easing: PitchEasing, progress: number): number {
  const t = clamp01(progress);
  switch (easing) {
    case 'linear':
      return t;
    case 'easeIn':
      return t * t;
    case 'easeOut':
      return 1 - (1 - t) * (1 - t);
    case 'easeInOut':
      return t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t);
  }
}

/**
 * A momentary effect's rise-and-fall, eased on both halves so it lands and
 * leaves on the same curve. 0 at the edges, 1 at the middle.
 */
function bump(easing: PitchEasing, progress: number): number {
  const t = clamp01(progress);
  return t < 0.5 ? ease(easing, t / 0.5) : ease(easing, (1 - t) / 0.5);
}

type CropRect = { readonly x: number; readonly y: number; readonly width: number };

/**
 * The crop rect as a CSS transform on a photo that already covers the stage.
 *
 * A v2 crop is normalized against the CANVAS-FITTED frame — the photo after
 * cover-fitting to 1080x1920 — which is exactly what an `inset: 0;
 * object-fit: cover` image is. So the element's own box IS the coordinate space,
 * `translate` percentages are percentages of it, and a square crop is 9:16 in
 * pixels with one uniform scale. Transform origin must stay the default centre:
 * the maths below places the crop's centre at the stage's centre.
 */
export function cropTransform(
  crop: CropRect,
  punchScale: number,
): {
  readonly transform: string;
  readonly zoom: number;
} {
  const zoom = (1 / crop.width) * punchScale;
  const centreX = crop.x + crop.width / 2;
  // Square in this space, so height === width and one centre offset serves both.
  const centreY = crop.y + crop.width / 2;
  const translateX = round((0.5 - centreX) * zoom * 100, 3);
  const translateY = round((0.5 - centreY) * zoom * 100, 3);
  return {
    transform: `translate(${translateX}%, ${translateY}%) scale(${round(zoom, 4)})`,
    zoom: round(zoom, 4),
  };
}

/** Key for a word reference. One place, so the builder and player cannot drift. */
export function wordKey(ref: PitchWordRef): string {
  return `${ref.segmentIndex}:${ref.wordIndex}`;
}

export function buildWordLookup(words: readonly SceneWord[]): ReadonlyMap<string, string> {
  const lookup = new Map<string, string>();
  for (const word of words) {
    const text = word.text.trim();
    if (text !== '') {
      lookup.set(wordKey(word), text);
    }
  }
  return lookup;
}

/**
 * Resolves a text source token against the reviewed structure. A missing or
 * blank field yields null, and every caller treats null as "skip this effect" —
 * never as "print something else".
 */
export function resolveTextSource(
  text: SceneTextFields | null,
  source: PitchTextSource,
): string | null {
  if (text === null) {
    return null;
  }
  const raw =
    source === 'hook'
      ? text.hook
      : source === 'relationship_context'
        ? text.relationship_context
        : source === 'evidence_or_anecdote'
          ? text.evidence_or_anecdote
          : source === 'good_match_for'
            ? text.good_match_for
            : text.three_specific_qualities[
                source === 'quality:0' ? 0 : source === 'quality:1' ? 1 : 2
              ];
  const trimmed = raw?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
}

/** The v2 scene on this revision, or null when there is none to interpret. */
export function asPitchSceneV2(scene: PitchSceneAnyVersion | null): PitchSceneV2 | null {
  return scene !== null && isPitchSceneV2(scene) ? scene : null;
}

/**
 * Binds every photo the scene names to the player's photo list, or returns null
 * when one is missing — the same fail-closed rule as v1's `sceneMotionWindows`.
 * A scene half-bound to the rendered photos would leave holes or show a photo the
 * Dater excluded, so the surface falls back to the legacy path instead (A4).
 */
export function sceneV2PhotoIndexes(
  scene: PitchSceneV2,
  photoAssetIds: readonly (string | null)[],
): ReadonlyMap<string, number> | null {
  const indexes = new Map<string, number>();
  for (const assetId of scene.assetIds) {
    const index = photoAssetIds.indexOf(assetId);
    if (index === -1) {
      return null;
    }
    indexes.set(assetId, index);
  }
  return indexes;
}

/** Stable serialization of the shot list for tests and QA. `t` = text card. */
export function sceneV2ShotSignature(
  scene: PitchSceneV2,
  photoIndexes: ReadonlyMap<string, number>,
): string {
  return scene.shots
    .map((shot) => {
      const slot =
        shot.level === 'typographic' ? 't' : String(photoIndexes.get(shot.assetId) ?? -1);
      return `${slot}:${shot.startMs}-${shot.endMs}`;
    })
    .join(',');
}

/** Index of the shot on screen at `elapsedMs`, clamped at both ends. */
export function activeShotIndex(scene: PitchSceneV2, elapsedMs: number): number {
  const shots = scene.shots;
  let index = 0;
  for (let candidate = 0; candidate < shots.length; candidate += 1) {
    const shot = shots[candidate];
    if (shot !== undefined && shot.startMs <= elapsedMs) {
      index = candidate;
    }
  }
  return index;
}

/**
 * The photo shot whose image beds a text card: the nearest one before it, or the
 * nearest one after when the card opens the scene. A scene always has at least
 * one photo shot (schema), so this always finds one.
 */
function backdropShotIndex(scene: PitchSceneV2, shotIndex: number): number | null {
  for (let index = shotIndex - 1; index >= 0; index -= 1) {
    if (scene.shots[index]?.level !== 'typographic') {
      return index;
    }
  }
  for (let index = shotIndex + 1; index < scene.shots.length; index += 1) {
    if (scene.shots[index]?.level !== 'typographic') {
      return index;
    }
  }
  return null;
}

export function sceneV2Frame(
  scene: PitchSceneV2,
  photoIndexes: ReadonlyMap<string, number>,
  elapsedMs: number,
  options: SceneV2FrameOptions,
): SceneV2Frame {
  const clock = Math.max(0, Math.min(elapsedMs, scene.durationMs));
  const shotIndex = activeShotIndex(scene, clock);
  const shot = scene.shots[shotIndex];
  const words = buildWordLookup(options.words);
  const { grade, grain } = scene.look;

  let photo: SceneV2PhotoFrame | null = null;
  let backdrop: SceneV2PhotoFrame | null = null;
  let wordPop: SceneV2Frame['wordPop'] = null;
  let card: SceneV2Frame['card'] = null;

  if (shot !== undefined && shot.level !== 'typographic') {
    const shotDuration = shot.endMs - shot.startMs;
    const local = clock - shot.startMs;
    const kenBurns = options.reducedMotion
      ? undefined
      : shot.effects.find((effect) => effect.type === 'kenBurns');
    const travel = kenBurns === undefined ? 0 : ease(kenBurns.easing, local / shotDuration);
    const crop =
      kenBurns === undefined
        ? shot.crop
        : {
            x: shot.crop.x + (kenBurns.to.x - shot.crop.x) * travel,
            y: shot.crop.y + (kenBurns.to.y - shot.crop.y) * travel,
            width: shot.crop.width + (kenBurns.to.width - shot.crop.width) * travel,
          };

    // Loudest active punch, never the product: the schema checked the composed
    // zoom against the level ceiling using the loudest punch, so multiplying
    // overlapping punches together could exceed the limit it verified.
    let punchScale = 1;
    if (!options.reducedMotion) {
      for (const effect of shot.effects) {
        if (
          effect.type === 'punch' &&
          clock >= effect.atMs &&
          clock < effect.atMs + effect.durationMs
        ) {
          const rise = bump(effect.easing, (clock - effect.atMs) / effect.durationMs);
          punchScale = Math.max(punchScale, 1 + (effect.scale - 1) * rise);
        }
      }
    }

    const blur = shot.effects.find((effect) => effect.type === 'backdropBlur');
    const framing = cropTransform(crop, punchScale);
    photo = {
      assetId: shot.assetId,
      photoIndex: photoIndexes.get(shot.assetId) ?? 0,
      transform: framing.transform,
      zoom: framing.zoom,
      // On a photo shot, backdropBlur pushes the media itself back so a word or
      // a badge reads over it. There is no second media layer to blur: a v2 crop
      // always covers the frame, so blurring "behind" would be invisible.
      blurPx: blur?.radiusPx ?? 0,
      dim: blur?.dim ?? 0,
    };

    // Last resolvable active wordPop wins, so two overlapping accents are
    // deterministic. An unresolvable reference leaves `wordPop` null: the effect
    // is skipped, not replaced with a placeholder.
    for (const effect of shot.effects) {
      if (effect.type !== 'wordPop' || clock < effect.startMs || clock >= effect.endMs) {
        continue;
      }
      const text = words.get(wordKey(effect.word));
      if (text === undefined) {
        continue;
      }
      const rise = options.reducedMotion
        ? 0
        : bump(effect.easing, (clock - effect.startMs) / (effect.endMs - effect.startMs));
      wordPop = {
        text,
        scale: round(1 + (effect.scale - 1) * rise, 4),
        // The scale is the pop and drops out under reduced motion; the fade is
        // the flash guard and applies in both modes.
        opacity: textRamp(clock, effect.startMs, effect.endMs),
      };
    }
  } else if (shot !== undefined) {
    const bedIndex = backdropShotIndex(scene, shotIndex);
    const bed = bedIndex === null ? undefined : scene.shots[bedIndex];
    if (bed !== undefined && bed.level !== 'typographic') {
      const framing = cropTransform(bed.crop, 1);
      const look = CARD_BACKDROP[scene.template];
      backdrop = {
        assetId: bed.assetId,
        photoIndex: photoIndexes.get(bed.assetId) ?? 0,
        transform: framing.transform,
        zoom: framing.zoom,
        blurPx: look.blurPx,
        dim: look.dim,
      };
    }
    const text = resolveTextSource(options.text, shot.text.source);
    if (text !== null) {
      card = {
        text,
        emphasis: shot.text.emphasis,
        // The scene's own eased reveal, which the player spends on the SLIDE.
        // Reduced motion holds the card in place, so it is 1 from the first frame.
        reveal: options.reducedMotion
          ? 1
          : round(ease(shot.text.easing, (clock - shot.startMs) / shot.text.revealMs), 4),
        // Fade in, hold, fade out — in both modes. Under reduced motion this is
        // the whole of the card's arrival: a fade-in, then it stays.
        opacity: textRamp(clock, shot.startMs, shot.endMs),
      };
    }
  }

  let lightLeak: SceneV2Frame['lightLeak'] = null;
  let badge: SceneV2Frame['badge'] = null;
  for (const overlay of scene.overlays) {
    if (clock < overlay.startMs || clock >= overlay.endMs) {
      continue;
    }
    if (overlay.type === 'lightLeak') {
      // NOT RENDERED under reduced motion, rather than pinned to a static
      // opacity. Both would kill the pulse, but a frozen leak is a bright wash
      // laid over the Dater's photo for the whole window — a look nobody
      // approved as a still — while dropping it leaves every other layer of the
      // frame exactly as approved. Absence is also the only version of this that
      // a test can prove outright.
      if (options.reducedMotion) {
        continue;
      }
      const span = overlay.endMs - overlay.startMs;
      const fade = Math.sin(Math.PI * clamp01((clock - overlay.startMs) / span));
      // `pulseHz` is an integer 0..3 (schema). 0 means "one appearance, no
      // pulse", which is why it short-circuits instead of dividing. The peaks of
      // this cosine sit at startMs + k * 1000 / pulseHz — the same peak set the
      // flash budget enumerates with floor(k * 1000 / pulseHz), on the
      // millisecond grid. Nothing here divides by pulseHz, so no float/numeric
      // disagreement with the SQL and builder implementations is possible.
      const pulse =
        overlay.pulseHz === 0
          ? 1
          : 0.5 +
            0.5 * Math.cos((2 * Math.PI * overlay.pulseHz * (clock - overlay.startMs)) / 1000);
      lightLeak = {
        opacity: round(overlay.peakIntensity * fade * pulse, 4),
        angleDeg: overlay.angleDeg,
      };
      continue;
    }
    const text = resolveTextSource(options.text, overlay.source);
    if (text !== null) {
      badge = {
        text,
        emphasis: overlay.emphasis,
        opacity: textRamp(clock, overlay.startMs, overlay.endMs),
      };
    }
  }

  const grainPhase =
    options.reducedMotion || grain.animationHz === 0
      ? 0
      : Math.floor((clock * grain.animationHz) / 1000) % GRAIN_PHASES;

  return {
    shotIndex,
    level: shot?.level ?? 'wide',
    photo,
    backdrop,
    filter: `contrast(${round(grade.contrast, 3)}) saturate(${round(grade.saturation, 3)})`,
    warmth: round(grade.warmth, 3),
    vignette: round(grade.vignette, 3),
    grain:
      grain.intensity === 0
        ? null
        : { opacity: grain.intensity, seed: grain.seed + grainPhase, sizePx: grain.sizePx },
    lightLeak,
    wordPop,
    card,
    badge,
    progressBar:
      scene.chrome.progressBar === undefined
        ? null
        : {
            percent: round(clamp01(clock / scene.durationMs) * 100, 2),
            thicknessPx: scene.chrome.progressBar.thicknessPx,
            opacity: scene.chrome.progressBar.opacity,
            anchor: scene.chrome.progressBar.anchor,
          },
  };
}

/**
 * True when this scene prints a reviewed sentence (a text card or a count badge).
 * The public page's player projection uses it to decide whether to ship the five
 * sentences at all: a player that draws no card must not carry the copy, which is
 * the rule `PitchPlayerView` exists to enforce.
 */
export function sceneV2ReferencesText(scene: PitchSceneV2): boolean {
  return (
    scene.shots.some((shot) => shot.level === 'typographic') ||
    scene.overlays.some((overlay) => overlay.type === 'countBadge')
  );
}

/** True when this scene lifts a transcript word, i.e. needs the word list. */
export function sceneV2ReferencesWords(scene: PitchSceneV2): boolean {
  return scene.shots.some(
    (shot) =>
      shot.level !== 'typographic' && shot.effects.some((effect) => effect.type === 'wordPop'),
  );
}

/** Which photo the stage is showing, for the QA attribute both surfaces print. */
export function sceneV2ActivePhotoIndex(frame: SceneV2Frame): number {
  return frame.photo?.photoIndex ?? frame.backdrop?.photoIndex ?? 0;
}

/**
 * A deterministic film-grain tile. Seeded from the scene, so the "random" texture
 * is frozen at build time like every other v2 parameter — the player never draws
 * a number.
 */
export function grainTileUri(seed: number, sizePx: number): string {
  const baseFrequency = round(1 / Math.max(1, sizePx * 2), 3);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64">` +
    `<filter id="g"><feTurbulence type="fractalNoise" baseFrequency="${baseFrequency}" numOctaves="2" seed="${seed}" stitchTiles="stitch"/>` +
    `<feColorMatrix type="saturate" values="0"/></filter>` +
    `<rect width="64" height="64" filter="url(#g)"/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}
