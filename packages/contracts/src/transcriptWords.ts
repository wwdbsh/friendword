// Word-level transcript timings, cleaned into something a scene builder can
// index safely.
//
// Whisper's `timestamp_granularities=['word']` output is not a tidy sequence.
// Real responses contain words that start before the previous word ended, words
// fully contained inside another word, words whose end equals their start, and
// (on retries or across segment boundaries) words that arrive out of order. A
// beat grid built straight off that list produces overlapping accents and, worse,
// word references that point at the wrong word once anything is dropped.
//
// So the scene builder never sees raw words. It sees the output of
// `sanitizeTranscriptWords`, which is sorted, strictly monotonic and free of
// zero-length entries — and which keeps each surviving word's ORIGINAL
// (segmentIndex, wordIndex), because that pair is what a PitchScene v2 wordPop
// stores. Renumbering after a drop would silently re-point an approved effect at
// a different word.
//
// This module carries no word text on purpose. Text lives in the revision's
// transcript, which the Dater reviewed; the scene and everything derived from it
// reference words by index only.

/** Where a word sits in the revision transcript. The only word identity we store. */
export type TranscriptWordRef = {
  readonly segmentIndex: number;
  readonly wordIndex: number;
};

/** A provider word timing, in milliseconds from the start of the recording. */
export type TranscriptWordTiming = TranscriptWordRef & {
  readonly startMs: number;
  readonly endMs: number;
};

declare const sanitizedWordBrand: unique symbol;

/**
 * A word timing that has been through `sanitizeTranscriptWords`. The brand is
 * type-only (nothing is added at runtime) and exists so a function that needs
 * ordered, non-overlapping words cannot be handed the raw provider list by
 * mistake.
 */
export type SanitizedWord = TranscriptWordTiming & {
  readonly [sanitizedWordBrand]: true;
};

function isUsableIndex(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function isUsableTime(value: number): boolean {
  return Number.isFinite(value);
}

/**
 * Total order, so the result never depends on the input order or on the
 * engine's sort stability: start, then end, then the transcript position.
 */
function compareWords(left: TranscriptWordTiming, right: TranscriptWordTiming): number {
  return (
    left.startMs - right.startMs ||
    left.endMs - right.endMs ||
    left.segmentIndex - right.segmentIndex ||
    left.wordIndex - right.wordIndex
  );
}

/**
 * Sort, clamp to strictly increasing, drop what is left with no duration.
 * Deterministic and pure: the same input always yields the same output.
 *
 * The rules, in order:
 *  1. Drop entries that cannot be reasoned about at all — a non-finite time or a
 *     negative/fractional index. A provider glitch must not become a scene.
 *  2. Round times to whole milliseconds (the scene stores integers) and clamp
 *     negatives to 0.
 *  3. Sort by the total order above, then drop repeats of a
 *     (segmentIndex, wordIndex) already seen — a duplicated reference would break
 *     the "one wordPop per word" invariant downstream.
 *  4. Clamp each start up to the previous kept word's end, then clamp the end up
 *     to its own start. A word nested inside its predecessor collapses to zero
 *     length here, which is exactly what step 5 removes.
 *  5. Drop zero-length words. The cursor does not advance on a dropped word, so
 *     one bad entry cannot push every later word forward.
 */
export function sanitizeTranscriptWords(
  words: readonly TranscriptWordTiming[],
): readonly SanitizedWord[] {
  const usable: TranscriptWordTiming[] = [];
  for (const word of words) {
    if (
      !isUsableIndex(word.segmentIndex) ||
      !isUsableIndex(word.wordIndex) ||
      !isUsableTime(word.startMs) ||
      !isUsableTime(word.endMs)
    ) {
      continue;
    }
    usable.push({
      segmentIndex: word.segmentIndex,
      wordIndex: word.wordIndex,
      startMs: Math.max(0, Math.round(word.startMs)),
      endMs: Math.max(0, Math.round(word.endMs)),
    });
  }
  usable.sort(compareWords);

  const sanitized: SanitizedWord[] = [];
  const seen = new Set<string>();
  let cursorMs = 0;
  for (const word of usable) {
    const key = `${word.segmentIndex}:${word.wordIndex}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const startMs = Math.max(word.startMs, cursorMs);
    const endMs = Math.max(word.endMs, startMs);
    if (endMs <= startMs) {
      continue;
    }
    const kept: TranscriptWordTiming = {
      segmentIndex: word.segmentIndex,
      wordIndex: word.wordIndex,
      startMs,
      endMs,
    };
    sanitized.push(kept as SanitizedWord);
    cursorMs = endMs;
  }
  return sanitized;
}
