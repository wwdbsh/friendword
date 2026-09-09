/**
 * T002 (issue #98) — the word-caption payload the MP4 renderer draws from.
 *
 * `docs/REEL_V3_DESIGN.md` §2.4 wants each word on screen with the moment it is
 * spoken: `TimedCaptionWord {segmentIndex, wordIndex, text, startMs, endMs}`.
 *
 * WHERE THE MAPPING LIVES, AND WHY NOT HERE. A transcript stores a FLAT
 * provider word list (`{start, end, word}` in seconds); a scene stores
 * (segmentIndex, wordIndex) pairs. Exactly one function in this repo turns one
 * into the other — `indexTranscriptWords` in
 * `packages/data/src/transcriptWordIndex.ts` — and it is load-bearing on
 * purpose: the scene builder, the published player and the render worker
 * (`jobRunner.ts:437-449`) all call it, so an approved word accent and a
 * caption highlight point at the same word. Re-deriving that assignment here
 * would create a second numbering rule and, the first time the two disagreed,
 * light up a different word than the one the Dater approved.
 *
 * So this module does NOT map. It takes words that are already numbered and
 * gives the renderer the two guarantees a moving highlight needs and the
 * indexer deliberately does not provide:
 *
 *  1. ORDERED AND NON-OVERLAPPING, via `sanitizeTranscriptWords` — provider
 *     word lists really do contain words that start before the previous one
 *     ended (see `transcriptWords.ts`), and a cursor driven by that jumps
 *     backwards mid-sentence.
 *  2. A SINGLE FALLBACK SIGNAL: `null` when there are no usable timings, which
 *     is the caller's cue to draw the existing segment captions (§2.4) rather
 *     than a half-empty word band.
 *
 * The word text is the provider's, exactly as `indexTranscriptWords` carries it
 * and as `CaptionWord` already renders it today — a word of the transcript the
 * Dater reviewed, never new copy.
 */

import { sanitizeTranscriptWords, type TranscriptWordTiming } from './transcriptWords';

/** One spoken word, ready to render: where it is, what it says, when it is said. */
export type TimedCaptionWord = {
  readonly segmentIndex: number;
  readonly wordIndex: number;
  readonly text: string;
  readonly startMs: number;
  readonly endMs: number;
};

/**
 * The input shape: a transcript word that already carries its scene reference
 * and its text. `IndexedTranscriptWord` from `@friendword/data` satisfies it
 * structurally, which is how the render worker feeds this without contracts
 * depending on the data package.
 */
export type IndexedWordTiming = TranscriptWordTiming & {
  readonly text: string;
};

/**
 * Sanitizes already-numbered words into the caption payload, or `null` when
 * this transcript cannot drive word captions at all.
 *
 * Pure and total: a malformed list yields `null`, never an exception, because
 * the fallback (segment captions) is a good video and a thrown error is a
 * failed render.
 */
export function buildTimedCaptionWords(
  words: readonly IndexedWordTiming[] | null | undefined,
): readonly TimedCaptionWord[] | null {
  if (words === null || words === undefined || words.length === 0) {
    return null;
  }

  const texts = new Map<string, string>();
  for (const word of words) {
    if (typeof word.text !== 'string') {
      continue;
    }
    const text = word.text.trim();
    if (text === '') {
      continue;
    }
    // First writer wins: `sanitizeTranscriptWords` drops repeats of a
    // (segmentIndex, wordIndex) pair the same way, so the surviving timing and
    // the surviving text are the same entry.
    const key = `${word.segmentIndex}:${word.wordIndex}`;
    if (!texts.has(key)) {
      texts.set(key, text);
    }
  }

  const timed: TimedCaptionWord[] = [];
  for (const word of sanitizeTranscriptWords(words)) {
    const text = texts.get(`${word.segmentIndex}:${word.wordIndex}`);
    if (text === undefined) {
      // A word with no readable text is not a caption. Skipped rather than
      // rendered blank, and it does not shift its neighbours: the index pair
      // travels with each word.
      continue;
    }
    timed.push({
      segmentIndex: word.segmentIndex,
      wordIndex: word.wordIndex,
      text,
      startMs: word.startMs,
      endMs: word.endMs,
    });
  }
  return timed.length === 0 ? null : timed;
}
