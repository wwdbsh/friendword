import { describe, expect, it } from 'vitest';

import { buildTimedCaptionWords, type IndexedWordTiming } from './timedCaptionWords';

/**
 * The input is what `indexTranscriptWords` (packages/data) returns for a real
 * transcript — the one numbering rule the scene builder, the player and the
 * render worker share. These fixtures mirror its own test's shape so a drift
 * there is visible here.
 */
const WORDS: readonly IndexedWordTiming[] = [
  { segmentIndex: 0, wordIndex: 0, startMs: 100, endMs: 500, text: 'Okay' },
  { segmentIndex: 0, wordIndex: 1, startMs: 600, endMs: 900, text: 'so' },
  { segmentIndex: 0, wordIndex: 2, startMs: 1_000, endMs: 1_600, text: 'Maya' },
  { segmentIndex: 1, wordIndex: 0, startMs: 4_200, endMs: 4_800, text: 'Maya' },
  { segmentIndex: 1, wordIndex: 1, startMs: 4_900, endMs: 5_400, text: 'brought' },
  { segmentIndex: 1, wordIndex: 2, startMs: 5_500, endMs: 6_100, text: 'soup' },
];

describe('buildTimedCaptionWords', () => {
  it('carries the word, its transcript position and its timing', () => {
    expect(buildTimedCaptionWords(WORDS)).toEqual([
      { segmentIndex: 0, wordIndex: 0, text: 'Okay', startMs: 100, endMs: 500 },
      { segmentIndex: 0, wordIndex: 1, text: 'so', startMs: 600, endMs: 900 },
      { segmentIndex: 0, wordIndex: 2, text: 'Maya', startMs: 1_000, endMs: 1_600 },
      { segmentIndex: 1, wordIndex: 0, text: 'Maya', startMs: 4_200, endMs: 4_800 },
      { segmentIndex: 1, wordIndex: 1, text: 'brought', startMs: 4_900, endMs: 5_400 },
      { segmentIndex: 1, wordIndex: 2, text: 'soup', startMs: 5_500, endMs: 6_100 },
    ]);
  });

  it('keeps the numbering it was given rather than renumbering', () => {
    // The caption highlight and an approved wordPop reference the same pair, so
    // a dropped word must not shift the ones after it.
    const withGap: readonly IndexedWordTiming[] = [
      { segmentIndex: 1, wordIndex: 0, startMs: 4_200, endMs: 4_800, text: 'Maya' },
      { segmentIndex: 1, wordIndex: 2, startMs: 5_500, endMs: 6_100, text: 'soup' },
    ];
    expect(buildTimedCaptionWords(withGap)?.map((word) => word.wordIndex)).toEqual([0, 2]);
  });

  it('orders words and removes overlap, so the highlight never jumps back', () => {
    const messy: readonly IndexedWordTiming[] = [
      { segmentIndex: 0, wordIndex: 1, startMs: 600, endMs: 900, text: 'so' },
      { segmentIndex: 0, wordIndex: 0, startMs: 100, endMs: 700, text: 'Okay' },
    ];
    const timed = buildTimedCaptionWords(messy);
    expect(timed?.map((word) => word.text)).toEqual(['Okay', 'so']);
    // The second word starts where the first was clamped to end.
    expect(timed?.[0]?.endMs).toBe(700);
    expect(timed?.[1]?.startMs).toBe(700);
    for (let i = 1; i < (timed?.length ?? 0); i += 1) {
      expect(timed?.[i]?.startMs).toBeGreaterThanOrEqual(timed?.[i - 1]?.endMs ?? 0);
    }
  });

  it('returns null when the transcript has no word timings', () => {
    expect(buildTimedCaptionWords(undefined)).toBeNull();
    expect(buildTimedCaptionWords(null)).toBeNull();
    expect(buildTimedCaptionWords([])).toBeNull();
  });

  it('returns null when nothing survives, so the caller falls back to segment captions', () => {
    // Blank text and a zero-length word: neither can be drawn, and there is
    // nothing left to draw.
    expect(
      buildTimedCaptionWords([
        { segmentIndex: 0, wordIndex: 0, startMs: 100, endMs: 500, text: '   ' },
        { segmentIndex: 0, wordIndex: 1, startMs: 900, endMs: 900, text: 'so' },
      ]),
    ).toBeNull();
  });

  it('drops only the unreadable word when others survive', () => {
    const timed = buildTimedCaptionWords([
      { segmentIndex: 0, wordIndex: 0, startMs: 100, endMs: 500, text: '' },
      { segmentIndex: 0, wordIndex: 1, startMs: 600, endMs: 900, text: 'so' },
    ]);
    expect(timed).toEqual([
      { segmentIndex: 0, wordIndex: 1, text: 'so', startMs: 600, endMs: 900 },
    ]);
  });

  it('trims the provider padding the transcript stores', () => {
    const timed = buildTimedCaptionWords([
      { segmentIndex: 0, wordIndex: 0, startMs: 100, endMs: 500, text: ' Okay' },
    ]);
    expect(timed?.[0]?.text).toBe('Okay');
  });

  it('is deterministic', () => {
    const first = buildTimedCaptionWords(WORDS);
    const second = buildTimedCaptionWords([...WORDS].reverse());
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});
