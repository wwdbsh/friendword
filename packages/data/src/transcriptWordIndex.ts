import { z } from 'zod';

// Where a PitchScene v2 `wordPop` reference comes from.
//
// A7 stores provider word timings on `pitch_drafts.transcript` (and the consent
// revision's snapshot of it) as a FLAT list of `{ start, end, word }` in seconds.
// A v2 wordPop stores `{ segmentIndex, wordIndex }` instead — a position in the
// transcript, never the word itself. Something has to turn one into the other,
// and that something has to be ONE function: the scene builder's input and the
// player's lookup must agree, or an approved accent lands on a different word
// than the one the Dater watched light up.
//
// This module is that function. It is a read-side derivation of a snapshot the
// server already froze, so it is pure and total: anything it cannot read yields
// no words, which degrades the builder to segment rhythm (its documented
// fallback) rather than guessing.
//
// The assignment rule, in full:
//
//   segmentIndex = the last segment whose start is at or before the word's start
//                  (0 for a word that starts before the first segment)
//   wordIndex    = the word's position among the words assigned to that segment,
//                  counted in PROVIDER ORDER
//
// Provider order, not time order, is what makes `wordIndex` the reading position
// inside the sentence the reader sees. `sanitizeTranscriptWords` in
// @friendword/contracts sorts and de-overlaps afterwards and deliberately keeps
// each surviving word's original pair, so sorting here would only misnumber it.

/**
 * One transcript word, carrying both the reference a scene stores and the text a
 * player needs to draw it.
 *
 * The text is safe to carry: it is a word of the transcript, which the Dater
 * reviewed read-only at consent and which publishes in full on the page. It is
 * NOT part of the scene — the scene holds the index pair only, which is what
 * keeps an approved effect pointing at reviewed copy after an edit.
 */
export type IndexedTranscriptWord = {
  readonly segmentIndex: number;
  readonly wordIndex: number;
  readonly startMs: number;
  readonly endMs: number;
  readonly text: string;
};

/** Only `startMs` is read; both segment shapes in this package satisfy it. */
export type WordIndexSegment = {
  readonly startMs: number;
};

const providerWordSchema = z
  .object({ start: z.number(), end: z.number(), word: z.string() })
  .passthrough();

/**
 * Tolerant per-entry parse. `/api/transcribe` drops the whole `words` key when
 * the list is malformed, so a partial list here can only come from an older
 * write or a provider change; dropping the unreadable entries keeps the readable
 * ones usable, and a dropped entry cannot shift the others because the index is
 * assigned from the surviving position in provider order.
 */
const providerWordsSchema = z.array(providerWordSchema.nullable().catch(null)).catch([]);

function segmentIndexFor(segments: readonly WordIndexSegment[], startMs: number): number {
  let index = 0;
  for (let candidate = 0; candidate < segments.length; candidate += 1) {
    const segment = segments[candidate];
    if (segment !== undefined && segment.startMs <= startMs) {
      index = candidate;
    }
  }
  return index;
}

/**
 * Reads the frozen transcript snapshot's word timings and gives each one the
 * (segmentIndex, wordIndex) pair a v2 scene references.
 *
 * Returns an empty list when there are no segments: a word reference is a
 * position inside a segment, so without segments there is nothing to reference —
 * and a scene with no segments is null anyway.
 */
export function indexTranscriptWords(
  transcript: unknown,
  segments: readonly WordIndexSegment[],
): readonly IndexedTranscriptWord[] {
  if (segments.length === 0) {
    return [];
  }
  if (typeof transcript !== 'object' || transcript === null || Array.isArray(transcript)) {
    return [];
  }
  const parsed = providerWordsSchema.safeParse(
    (transcript as { readonly words?: unknown }).words ?? [],
  );
  if (!parsed.success) {
    return [];
  }

  const perSegmentCount = new Map<number, number>();
  const indexed: IndexedTranscriptWord[] = [];
  for (const word of parsed.data) {
    if (word === null) {
      continue;
    }
    const text = word.word.trim();
    if (text === '') {
      continue;
    }
    const startMs = Math.max(0, Math.round(word.start * 1000));
    const endMs = Math.max(startMs, Math.round(word.end * 1000));
    const segmentIndex = segmentIndexFor(segments, startMs);
    const wordIndex = perSegmentCount.get(segmentIndex) ?? 0;
    perSegmentCount.set(segmentIndex, wordIndex + 1);
    indexed.push({ segmentIndex, wordIndex, startMs, endMs, text });
  }
  return indexed;
}
