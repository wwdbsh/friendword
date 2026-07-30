// The (segmentIndex, wordIndex) pair a v2 wordPop stores is DERIVED, not
// provided: the transcript snapshot holds a flat word list. This mapping is
// therefore load-bearing in a way a formatting helper is not — the scene builder
// and the player both call it, and if it ever renumbers, an approved accent lands
// on a word the Dater never saw lifted.
import { describe, expect, it } from 'vitest';

import { indexTranscriptWords } from './transcriptWordIndex';

const SEGMENTS = [{ startMs: 0 }, { startMs: 4_000 }, { startMs: 11_000 }];

const TRANSCRIPT = {
  text: 'Okay so Blair. Blair turns Tuesdays into stories. You should meet Blair.',
  segments: [
    { start: 0, end: 4, text: 'Okay so Blair.' },
    { start: 4, end: 11, text: 'Blair turns Tuesdays into stories.' },
    { start: 11, end: 18, text: 'You should meet Blair.' },
  ],
  words: [
    { start: 0.1, end: 0.5, word: ' Okay' },
    { start: 0.6, end: 0.9, word: ' so' },
    { start: 1.0, end: 1.6, word: ' Blair' },
    { start: 4.2, end: 4.8, word: ' Blair' },
    { start: 4.9, end: 5.4, word: ' turns' },
    { start: 12.0, end: 12.4, word: ' You' },
  ],
};

describe('indexTranscriptWords', () => {
  it('numbers each word inside the segment that was speaking', () => {
    expect(indexTranscriptWords(TRANSCRIPT, SEGMENTS)).toEqual([
      { segmentIndex: 0, wordIndex: 0, startMs: 100, endMs: 500, text: 'Okay' },
      { segmentIndex: 0, wordIndex: 1, startMs: 600, endMs: 900, text: 'so' },
      { segmentIndex: 0, wordIndex: 2, startMs: 1_000, endMs: 1_600, text: 'Blair' },
      // A new segment restarts the word count — the index is a position inside
      // the sentence, which is what makes it stable when another segment changes.
      { segmentIndex: 1, wordIndex: 0, startMs: 4_200, endMs: 4_800, text: 'Blair' },
      { segmentIndex: 1, wordIndex: 1, startMs: 4_900, endMs: 5_400, text: 'turns' },
      { segmentIndex: 2, wordIndex: 0, startMs: 12_000, endMs: 12_400, text: 'You' },
    ]);
  });

  it('numbers in provider order, not in time order', () => {
    // Whisper really does return words out of order across segment boundaries.
    // Sorting first would renumber the sentence; the contract's sanitizer sorts
    // afterwards and keeps these pairs, so the reading position survives.
    const outOfOrder = {
      segments: TRANSCRIPT.segments,
      words: [
        { start: 0.6, end: 0.9, word: 'so' },
        { start: 0.1, end: 0.5, word: 'Okay' },
      ],
    };

    expect(indexTranscriptWords(outOfOrder, SEGMENTS)).toEqual([
      { segmentIndex: 0, wordIndex: 0, startMs: 600, endMs: 900, text: 'so' },
      { segmentIndex: 0, wordIndex: 1, startMs: 100, endMs: 500, text: 'Okay' },
    ]);
  });

  it('drops what it cannot read without shifting what it can', () => {
    const partial = {
      words: [
        { start: 0.1, end: 0.5, word: 'Okay' },
        { start: 'soon', end: 0.9, word: 'so' },
        null,
        { start: 1.0, end: 1.6, word: '   ' },
        { start: 4.2, end: 4.8, word: 'Blair' },
      ],
    };

    expect(indexTranscriptWords(partial, SEGMENTS)).toEqual([
      { segmentIndex: 0, wordIndex: 0, startMs: 100, endMs: 500, text: 'Okay' },
      { segmentIndex: 1, wordIndex: 0, startMs: 4_200, endMs: 4_800, text: 'Blair' },
    ]);
  });

  it('yields nothing a scene could reference when there is nothing to index', () => {
    // Pre-A7 recording, manual pitch, or a snapshot with no segments. Every one
    // of these must leave the builder with no words rather than a guess.
    expect(indexTranscriptWords(TRANSCRIPT, [])).toEqual([]);
    expect(indexTranscriptWords({ segments: TRANSCRIPT.segments }, SEGMENTS)).toEqual([]);
    expect(indexTranscriptWords(null, SEGMENTS)).toEqual([]);
    expect(indexTranscriptWords('a transcript', SEGMENTS)).toEqual([]);
    expect(indexTranscriptWords([{ start: 0, end: 1, word: 'Okay' }], SEGMENTS)).toEqual([]);
  });

  it('clamps a word that starts before the first segment into it', () => {
    const early = { words: [{ start: -2, end: 0.2, word: 'Okay' }] };

    expect(indexTranscriptWords(early, SEGMENTS)).toEqual([
      { segmentIndex: 0, wordIndex: 0, startMs: 0, endMs: 200, text: 'Okay' },
    ]);
  });
});
