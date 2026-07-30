import { describe, expect, it } from 'vitest';

import {
  sanitizeTranscriptWords,
  type SanitizedWord,
  type TranscriptWordTiming,
} from './transcriptWords';

const word = (
  segmentIndex: number,
  wordIndex: number,
  startMs: number,
  endMs: number,
): TranscriptWordTiming => ({ segmentIndex, wordIndex, startMs, endMs });

/** The invariants every downstream beat grid is allowed to assume. */
function assertSanitized(words: readonly SanitizedWord[]): void {
  let cursor = 0;
  const seen = new Set<string>();
  for (const entry of words) {
    expect(Number.isSafeInteger(entry.startMs)).toBe(true);
    expect(Number.isSafeInteger(entry.endMs)).toBe(true);
    expect(entry.startMs).toBeGreaterThanOrEqual(cursor);
    expect(entry.endMs).toBeGreaterThan(entry.startMs);
    const key = `${entry.segmentIndex}:${entry.wordIndex}`;
    expect(seen.has(key)).toBe(false);
    seen.add(key);
    cursor = entry.endMs;
  }
}

describe('sanitizeTranscriptWords', () => {
  it('keeps a clean list untouched', () => {
    const words = [word(0, 0, 0, 300), word(0, 1, 300, 700), word(1, 0, 900, 1_400)];

    expect(sanitizeTranscriptWords(words)).toEqual(words);
  });

  it('sorts words that arrive out of order', () => {
    const sanitized = sanitizeTranscriptWords([
      word(1, 0, 900, 1_400),
      word(0, 0, 0, 300),
      word(0, 1, 300, 700),
    ]);

    expect(sanitized.map((entry) => entry.startMs)).toEqual([0, 300, 900]);
    assertSanitized(sanitized);
  });

  it('clamps a word that starts before the previous one ended', () => {
    const sanitized = sanitizeTranscriptWords([word(0, 0, 0, 500), word(0, 1, 420, 900)]);

    expect(sanitized).toEqual([word(0, 0, 0, 500), word(0, 1, 500, 900)]);
    assertSanitized(sanitized);
  });

  it('drops a word nested entirely inside its predecessor', () => {
    // Whisper does emit this. Clamping alone would leave a 0ms word.
    const sanitized = sanitizeTranscriptWords([
      word(0, 0, 1_000, 2_000),
      word(0, 1, 1_200, 1_800),
      word(0, 2, 2_000, 2_400),
    ]);

    expect(sanitized).toEqual([word(0, 0, 1_000, 2_000), word(0, 2, 2_000, 2_400)]);
    assertSanitized(sanitized);
  });

  it('drops zero-length words, including one produced by rounding', () => {
    const sanitized = sanitizeTranscriptWords([
      word(0, 0, 100, 100),
      word(0, 1, 200.4, 200.4),
      word(0, 2, 300.2, 300.4),
      word(0, 3, 400, 900),
    ]);

    expect(sanitized).toEqual([word(0, 3, 400, 900)]);
  });

  it('clamps a word that overruns its predecessor, even when that swallows the next', () => {
    // (0,1) starts inside (0,0) but ends long after it, so it is clamped rather
    // than dropped — and everything it now covers is dropped. With no word text
    // to arbitrate, refusing to emit overlapping accents is the safe answer, and
    // it is the same answer every time.
    const sanitized = sanitizeTranscriptWords([
      word(0, 0, 1_000, 2_000),
      word(0, 1, 1_100, 9_000),
      word(0, 2, 2_000, 2_500),
    ]);

    expect(sanitized).toEqual([word(0, 0, 1_000, 2_000), word(0, 1, 2_000, 9_000)]);
    assertSanitized(sanitized);
  });

  it('clamps an end that precedes its own start, then removes the result', () => {
    const sanitized = sanitizeTranscriptWords([word(0, 0, 500, 200), word(0, 1, 600, 900)]);

    expect(sanitized).toEqual([word(0, 1, 600, 900)]);
  });

  it('clamps negative times to zero', () => {
    const sanitized = sanitizeTranscriptWords([word(0, 0, -40, 300)]);

    expect(sanitized).toEqual([word(0, 0, 0, 300)]);
  });

  it('rounds fractional milliseconds', () => {
    const sanitized = sanitizeTranscriptWords([word(0, 0, 12.4, 480.6), word(0, 1, 480.6, 900.5)]);

    expect(sanitized).toEqual([word(0, 0, 12, 481), word(0, 1, 481, 901)]);
  });

  it('preserves the original transcript indices of the survivors', () => {
    // A dropped word must never renumber the ones that remain: a stored wordPop
    // points at (segmentIndex, wordIndex), and renumbering would silently
    // re-point an approved effect at a different word.
    const sanitized = sanitizeTranscriptWords([
      word(3, 7, 1_000, 1_400),
      word(3, 8, 1_100, 1_200),
      word(4, 0, 1_400, 1_900),
    ]);

    expect(sanitized.map((entry) => [entry.segmentIndex, entry.wordIndex])).toEqual([
      [3, 7],
      [4, 0],
    ]);
  });

  it('drops a repeated transcript reference', () => {
    const sanitized = sanitizeTranscriptWords([
      word(0, 0, 0, 300),
      word(0, 0, 400, 700),
      word(0, 1, 800, 900),
    ]);

    expect(sanitized).toEqual([word(0, 0, 0, 300), word(0, 1, 800, 900)]);
    assertSanitized(sanitized);
  });

  it('drops entries that cannot be reasoned about at all', () => {
    const sanitized = sanitizeTranscriptWords([
      word(0, 0, Number.NaN, 300),
      word(0, 1, 300, Number.POSITIVE_INFINITY),
      word(-1, 0, 400, 700),
      word(0, 1.5, 400, 700),
      word(0, 2, 800, 1_200),
    ]);

    expect(sanitized).toEqual([word(0, 2, 800, 1_200)]);
  });

  it('survives an empty list', () => {
    expect(sanitizeTranscriptWords([])).toEqual([]);
  });

  it('is deterministic and does not mutate its input', () => {
    const words = [
      word(0, 2, 900, 1_400),
      word(0, 0, 0, 500),
      word(0, 1, 400, 900),
      word(0, 3, 1_000, 1_000),
    ];
    const snapshot = JSON.stringify(words);

    const first = sanitizeTranscriptWords(words);
    const second = sanitizeTranscriptWords(words);

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(JSON.stringify(words)).toBe(snapshot);
    assertSanitized(first);
  });

  it('holds its invariants over a pathological list', () => {
    const chaotic: TranscriptWordTiming[] = [];
    for (let index = 0; index < 200; index += 1) {
      // Deliberately overlapping, occasionally backwards, occasionally empty.
      const start = index * 90 - (index % 7) * 40;
      const end = start + (index % 5 === 0 ? 0 : 120 - (index % 3) * 30);
      chaotic.push(word(Math.floor(index / 10), index % 10, start, end));
    }

    assertSanitized(sanitizeTranscriptWords(chaotic));
  });

  it('carries no word text', () => {
    const sanitized = sanitizeTranscriptWords([word(0, 0, 0, 300)]);

    expect(Object.keys(sanitized[0] ?? {}).sort()).toEqual([
      'endMs',
      'segmentIndex',
      'startMs',
      'wordIndex',
    ]);
  });
});
