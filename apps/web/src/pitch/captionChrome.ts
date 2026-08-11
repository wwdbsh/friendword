// T017 — the caption chrome ("sticker pop", user-approved 2026-08-11, Issue #31).
//
// ONE interpretation, two surfaces. The web player animates the card with CSS
// (it only learns the clock at `timeupdate` rate, so the browser has to do the
// tweening), while the MP4 renderer captures discrete seeks and therefore
// cannot use CSS at all: a transition or animation interpolates on the WALL
// CLOCK, so under `seek(t) → screenshot` the same millisecond would produce
// different pixels depending on how fast the capture loop happened to run
// (docs/SESSION_HANDOFF §5). Everything in this module is consequently a pure
// function of (segments, elapsedMs) — the renderer evaluates it per frame and
// writes the result as an inline style, exactly the way the v2 scene
// interpreter already works.
//
// The two surfaces share the numbers below, so the curve the Dater approved in
// the preview is the curve that is burned into the MP4.
//
// Nothing here invents copy. Caption text is the provider's own transcript
// segment, and the keyword highlight is SELECTED from the provider's word list
// (`transcriptWords`); with no word data, or no recorded word that actually
// occurs in the caption, the caption simply renders unhighlighted.

/** One transcript segment, positioned in the transcript by `segmentIndex`. */
export type CaptionSegment = {
  /**
   * Position in the transcript's segment list. Carried explicitly rather than
   * implied by array position, because a word reference (`CaptionWord`) is a
   * (segmentIndex, wordIndex) pair against the FULL list — a dropped or
   * unreadable segment must not shift the highlight onto a different sentence.
   */
  readonly segmentIndex: number;
  readonly startMs: number;
  readonly endMs: number;
  readonly text: string;
};

/** A provider word, as `indexTranscriptWords` numbered it. */
export type CaptionWord = {
  readonly segmentIndex: number;
  readonly wordIndex: number;
  readonly text: string;
};

/** Approved entrance: 0.38s spring pop. */
export const CAPTION_ENTER_MS = 380;
/** Approved exit: 0.26s ease-in fade-down. */
export const CAPTION_EXIT_MS = 260;
/** The spring the entrance rides; overshoots y > 1 on purpose. */
export const CAPTION_ENTER_BEZIER = [0.2, 1.4, 0.4, 1] as const;
/** CSS `ease-in`, spelled out so the renderer can evaluate it. */
export const CAPTION_EXIT_BEZIER = [0.42, 0, 1, 1] as const;
export const CAPTION_ENTER_TRANSLATE_CQH = 2.4;
export const CAPTION_ENTER_SCALE = 0.94;
export const CAPTION_ENTER_ROTATE_DEG = -0.4;
/** How far the card drifts down as it leaves. */
export const CAPTION_EXIT_TRANSLATE_CQH = 1.6;

/**
 * Emphasis floor for the keyword highlight. The product has no curated
 * "important word" data — only the provider's flat word list — so the rule has
 * to be stated rather than guessed at: the first recorded word of the segment
 * with at least this many letters, and only if it really occurs in the caption.
 * Short function words ("She", "and", "is") would read as a mistake, and
 * choosing a word the transcript never recorded would be fabrication.
 */
export const CAPTION_KEYWORD_MIN_LENGTH = 4;

export type CaptionParts = {
  readonly before: string;
  /** Null whenever no recorded word qualified — never a guessed word. */
  readonly keyword: string | null;
  readonly after: string;
};

export type CaptionMotion = {
  readonly opacity: number;
  /** Container-height units, so the pop scales with the frame like the card. */
  readonly translateCqh: number;
  readonly scale: number;
  readonly rotateDeg: number;
};

export type CaptionFrame = {
  readonly segmentIndex: number;
  readonly text: string;
  readonly parts: CaptionParts;
  readonly motion: CaptionMotion;
  /** Ready for `style.transform`; container units resolve against the stage. */
  readonly transform: string;
};

export type CaptionFrameOptions = {
  readonly words: readonly CaptionWord[];
  readonly reducedMotion: boolean;
};

function bezierAxis(t: number, p1: number, p2: number): number {
  const inverse = 1 - t;
  return 3 * inverse * inverse * t * p1 + 3 * inverse * t * t * p2 + t * t * t;
}

/**
 * A CSS `cubic-bezier(x1, y1, x2, y2)` as a callable easing. Fixed iteration
 * counts (no convergence-dependent loop bound, no clock, no randomness) so the
 * same x always yields bit-identical y — which is what makes a captured frame
 * reproducible.
 */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (x: number) => number {
  return (x: number): number => {
    if (!(x > 0)) {
      return 0;
    }
    if (x >= 1) {
      return 1;
    }
    let t = x;
    for (let iteration = 0; iteration < 8; iteration += 1) {
      const error = bezierAxis(t, x1, x2) - x;
      if (Math.abs(error) < 1e-7) {
        return bezierAxis(t, y1, y2);
      }
      const slope = 3 * (1 - t) * (1 - t) * x1 + 6 * (1 - t) * t * (x2 - x1) + 3 * t * t * (1 - x2);
      if (Math.abs(slope) < 1e-9) {
        break;
      }
      t -= error / slope;
    }
    let low = 0;
    let high = 1;
    t = x;
    for (let iteration = 0; iteration < 32; iteration += 1) {
      const current = bezierAxis(t, x1, x2);
      if (Math.abs(current - x) < 1e-7) {
        break;
      }
      if (current > x) {
        high = t;
      } else {
        low = t;
      }
      t = (low + high) / 2;
    }
    return bezierAxis(t, y1, y2);
  };
}

const easeEnter = cubicBezier(...CAPTION_ENTER_BEZIER);
const easeExit = cubicBezier(...CAPTION_EXIT_BEZIER);

/**
 * 4dp is finer than a 1080-wide frame can resolve and keeps strings stable.
 * `+ 0` normalises -0, which would otherwise serialise as "-0deg" and make two
 * identical frames compare unequal.
 */
function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000 + 0;
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * Index into `captions` of the last segment that has started, or null before
 * the first one. Gaps hold the previous segment here; `captionFrame` is what
 * decides it has already faded out and shows nothing.
 */
export function activeCaptionIndex(
  captions: readonly CaptionSegment[],
  elapsedMs: number,
): number | null {
  for (let index = captions.length - 1; index >= 0; index -= 1) {
    const caption = captions[index];
    if (caption !== undefined && elapsedMs >= caption.startMs) {
      return index;
    }
  }
  return null;
}

/** Provider tokens carry punctuation; the letters are what we match on. */
function bareWord(text: string): string {
  return text.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
}

function escapeForRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Split `text` around the segment's one highlighted word.
 *
 * Candidates come only from `words`, in the provider's own order; the first one
 * that clears `CAPTION_KEYWORD_MIN_LENGTH` and occurs in `text` as a whole word
 * wins. The returned `keyword` is the slice of `text` itself, so the caption's
 * capitalisation is preserved and `before + keyword + after === text` always.
 */
export function captionParts(
  text: string,
  words: readonly CaptionWord[],
  segmentIndex: number,
): CaptionParts {
  const candidates = words
    .filter((word) => word.segmentIndex === segmentIndex)
    .slice()
    .sort((left, right) => left.wordIndex - right.wordIndex);

  for (const candidate of candidates) {
    const bare = bareWord(candidate.text);
    if (bare.length < CAPTION_KEYWORD_MIN_LENGTH) {
      continue;
    }
    const match = new RegExp(
      `(^|[^\\p{L}\\p{N}])(${escapeForRegExp(bare)})(?![\\p{L}\\p{N}])`,
      'iu',
    ).exec(text);
    if (match === null) {
      continue;
    }
    const start = match.index + (match[1]?.length ?? 0);
    const end = start + (match[2]?.length ?? 0);
    return {
      before: text.slice(0, start),
      keyword: text.slice(start, end),
      after: text.slice(end),
    };
  }
  return { before: text, keyword: null, after: '' };
}

/**
 * The card's opacity and transform at `elapsedMs`. Pure: no clock, no state,
 * no randomness — `captionMotion(s, t)` is the same value forever.
 *
 * `reducedMotion` collapses both ramps to a step, which is the accessible
 * reading of "appear immediately / hide immediately".
 */
export function captionMotion(
  segment: CaptionSegment,
  elapsedMs: number,
  reducedMotion: boolean,
): CaptionMotion {
  if (reducedMotion) {
    const visible = elapsedMs >= segment.startMs && elapsedMs < segment.endMs;
    return { opacity: visible ? 1 : 0, translateCqh: 0, scale: 1, rotateDeg: 0 };
  }

  const enterProgress = clamp01((elapsedMs - segment.startMs) / CAPTION_ENTER_MS);
  const entered = easeEnter(enterProgress);
  // The fade-down owns the tail of the segment; a segment shorter than the exit
  // still starts leaving at its own start rather than before it.
  const exitStart = Math.max(segment.startMs, segment.endMs - CAPTION_EXIT_MS);
  const exitProgress = clamp01((elapsedMs - exitStart) / CAPTION_EXIT_MS);
  const left = easeExit(exitProgress);
  const remaining = 1 - entered;

  return {
    // The entrance overshoots the transform, never the opacity.
    opacity: round4(clamp01(entered) * (1 - left)),
    translateCqh: round4(
      CAPTION_ENTER_TRANSLATE_CQH * remaining + CAPTION_EXIT_TRANSLATE_CQH * left,
    ),
    scale: round4(1 + (CAPTION_ENTER_SCALE - 1) * remaining),
    rotateDeg: round4(CAPTION_ENTER_ROTATE_DEG * remaining),
  };
}

/** The motion as a `transform` value; container units, like every other metric. */
export function captionTransform(motion: CaptionMotion): string {
  return `translateY(${motion.translateCqh}cqh) scale(${motion.scale}) rotate(${motion.rotateDeg}deg)`;
}

/**
 * Everything a surface needs to draw the caption band at `elapsedMs`, or null
 * when nothing should be on screen: before the first segment, inside a gap once
 * the previous card has left, and after the last segment ends. The renderer
 * relies on that null — the appended end card carries no caption.
 */
export function captionFrame(
  captions: readonly CaptionSegment[],
  elapsedMs: number,
  options: CaptionFrameOptions,
): CaptionFrame | null {
  const index = activeCaptionIndex(captions, elapsedMs);
  if (index === null) {
    return null;
  }
  const segment = captions[index];
  if (segment === undefined) {
    return null;
  }
  const motion = captionMotion(segment, elapsedMs, options.reducedMotion);
  if (motion.opacity <= 0) {
    return null;
  }
  return {
    segmentIndex: segment.segmentIndex,
    text: segment.text,
    parts: captionParts(segment.text, options.words, segment.segmentIndex),
    motion,
    transform: captionTransform(motion),
  };
}
