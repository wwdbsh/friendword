import type { TimedCaptionWord } from '@friendword/contracts';

// §2.4 — word-timed captions for the MP4.
//
// One pure function of (words, elapsedMs), for the same reason the segment
// caption band is pure (captionChrome.ts): the renderer captures discrete
// seeks, so anything animated by the wall clock would smear frames by however
// fast the capture loop happened to run. Everything below is arithmetic on the
// frozen transcript's own word timings.
//
// What it is NOT: a re-transcribe, a paraphrase, or a re-timing. `words` comes
// from `buildTimedCaptionWords` over the revision's frozen transcript — the
// same words, in the same order, with the provider's own millisecond stamps.
// With no word timings the renderer falls back to the segment caption band, and
// this module is never consulted.
//
// Client-safe: the capture page imports it. No Node APIs.

/** The 1080x1920 capture frame the coordinates below are stated in. */
export const FRAME_WIDTH_PX = 1080;
export const FRAME_HEIGHT_PX = 1920;

/**
 * Platform safe areas for a 9:16 reel, as pixels of the 1080x1920 frame.
 * TikTok/Reels overlay their own UI here; anything inside these bands is
 * covered on at least one platform, which is exactly the defect the cold
 * review found in the first reel.
 */
export const SAFE_TOP_PX = 130;
export const SAFE_BOTTOM_PX = 484;
export const SAFE_LEFT_PX = 44;
export const SAFE_RIGHT_PX = 140;

/** The caption block: inside the side gutters, sitting ON the bottom safe band. */
export const WORD_CAPTION_LEFT_PX = SAFE_LEFT_PX;
export const WORD_CAPTION_RIGHT_PX = SAFE_RIGHT_PX;
export const WORD_CAPTION_BOTTOM_PX = SAFE_BOTTOM_PX;
export const WORD_CAPTION_WIDTH_PX = FRAME_WIDTH_PX - SAFE_LEFT_PX - SAFE_RIGHT_PX;

/** §2.4 typography, shared with the stylesheet through these constants. */
export const WORD_CAPTION_FONT_SIZE_PX = 44;
export const WORD_CAPTION_FONT_WEIGHT = 700;
export const WORD_CAPTION_OUTLINE_PX = 3;
/** Static, never animated: a spring here would depend on the capture clock. */
export const WORD_CAPTION_ACTIVE_SCALE = 1.06;

/** §2.4: at most five words per line, and never across a sentence boundary. */
export const WORD_CAPTION_MAX_WORDS_PER_LINE = 5;

/** The cut window being played, when there is one (§2.2-5). */
export type CaptionWindow = {
  readonly startMs: number;
  readonly endMs: number;
};

export type WordCaptionWord = {
  readonly text: string;
  readonly active: boolean;
};

export type WordCaptionFrame = {
  /** Which transcript sentence this line belongs to. */
  readonly segmentIndex: number;
  /** Position of the line among ALL lines, so a signature can name it. */
  readonly lineIndex: number;
  readonly words: readonly WordCaptionWord[];
  /** Index of the mustard sticker word within `words`. Never -1: a line is
   *  only shown once one of its words has started. */
  readonly activeIndex: number;
  /** Position of the active word in the whole word list (signature input). */
  readonly activeWordIndex: number;
};

type WordCaptionLine = {
  readonly segmentIndex: number;
  readonly lineIndex: number;
  readonly from: number;
  readonly to: number;
};

/**
 * Splits the word list into render lines. Deterministic and independent of
 * time: a line break happens at a sentence boundary, or after five words.
 */
export function wordCaptionLines(words: readonly TimedCaptionWord[]): readonly WordCaptionLine[] {
  const lines: WordCaptionLine[] = [];
  let from = 0;
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    const next = words[index + 1];
    if (word === undefined) {
      continue;
    }
    const full = index - from + 1 >= WORD_CAPTION_MAX_WORDS_PER_LINE;
    const boundary = next === undefined || next.segmentIndex !== word.segmentIndex;
    if (full || boundary) {
      lines.push({
        segmentIndex: word.segmentIndex,
        lineIndex: lines.length,
        from,
        to: index,
      });
      from = index + 1;
    }
  }
  return lines;
}

/**
 * The caption line for `elapsedMs`, or null before the first word is spoken.
 *
 * The active word is the LAST word that has started. It stays lit through the
 * gap after it ends, so a pause between words holds the line rather than
 * blanking the band — and the rule stays a total order, which is what keeps
 * the frame signature reproducible.
 *
 * `elapsedMs` is always a timestamp on the ORIGINAL recording's timeline, even
 * for the highlight variant: the cut moves which milliseconds are captured, it
 * never re-times the words inside them. `window` is that cut's current window,
 * and it bounds which words may be lit — see the clamp below.
 */
export function wordCaptionFrame(
  words: readonly TimedCaptionWord[] | null | undefined,
  elapsedMs: number,
  window?: CaptionWindow | null,
): WordCaptionFrame | null {
  if (words === null || words === undefined || words.length === 0) {
    return null;
  }
  // Inside a highlight, the "last word that started" is only meaningful within
  // the window being played: without this clamp the first frames after a cut
  // still showed the sentence the cut removed, because that sentence's last
  // word is the newest one whose start is behind the clock. Found in review,
  // 2026-09-09.
  const from = window == null ? 0 : window.startMs;
  let activeWordIndex = -1;
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    if (word !== undefined && word.startMs <= elapsedMs && word.startMs >= from) {
      activeWordIndex = index;
    }
  }
  if (activeWordIndex < 0) {
    return null;
  }
  const line = wordCaptionLines(words).find(
    (candidate) => candidate.from <= activeWordIndex && activeWordIndex <= candidate.to,
  );
  if (line === undefined) {
    return null;
  }
  const rendered: WordCaptionWord[] = [];
  for (let index = line.from; index <= line.to; index += 1) {
    const word = words[index];
    if (word === undefined) {
      continue;
    }
    rendered.push({ text: word.text, active: index === activeWordIndex });
  }
  return {
    segmentIndex: line.segmentIndex,
    lineIndex: line.lineIndex,
    words: rendered,
    activeIndex: activeWordIndex - line.from,
    activeWordIndex,
  };
}
