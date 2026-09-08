import { describe, expect, it } from 'vitest';

import {
  COVERAGE_TRUSTED_WORD_COUNT,
  judgeTranscriptSufficiency,
  MIN_TRANSCRIPT_DISTINCT_WORDS,
  MIN_TRANSCRIPT_WORD_COUNT,
} from './transcriptSufficiency';

/**
 * Verbatim from production (issue #70): pitch_drafts.transcript for a 54.5s
 * recording that whisper-1 returned as three "." segments — and which the
 * structuring model turned into a complete invented pitch.
 */
const SILENT_PRODUCTION_TRANSCRIPT = {
  text: '.     .  .  ',
  segments: [
    { start: 28.58, end: 29.98, text: '.' },
    { start: 36.24, end: 37.64, text: '.' },
    { start: 37.64, end: 37.66, text: '.' },
  ],
  durationMs: 54_543,
};

/** A realistic ~45s introducer take: 100 words, continuous speech. */
const REAL_INTRODUCTION_TEXT =
  'Okay so this is my friend Jordan and we met in our first year of university, ' +
  'which is about eight years ago now. He is the person who drove four hours in ' +
  'the rain to help me move apartments and then refused to take gas money, and I ' +
  'think that tells you most of what you need to know about him. He cooks way too ' +
  'much food for everyone, he remembers small things people say, and he is genuinely ' +
  'funny without being mean about it. I think he would be great with someone who is ' +
  'curious and likes being outside and who will actually argue with him about films.';

const REAL_INTRODUCTION = {
  text: REAL_INTRODUCTION_TEXT,
  segments: [
    { start: 0.4, end: 15.2, text: REAL_INTRODUCTION_TEXT.slice(0, 120) },
    { start: 15.2, end: 31.0, text: REAL_INTRODUCTION_TEXT.slice(120, 300) },
    { start: 31.0, end: 44.8, text: REAL_INTRODUCTION_TEXT.slice(300) },
  ],
  durationMs: 45_200,
};

describe('judgeTranscriptSufficiency', () => {
  it('refuses the silent production transcript that produced an invented pitch', () => {
    const verdict = judgeTranscriptSufficiency(SILENT_PRODUCTION_TRANSCRIPT);

    expect(verdict.sufficient).toBe(false);
    expect(verdict.reason).toBe('no_words');
    expect(verdict.wordCount).toBe(0);
    expect(verdict.speechCoverage).toBeLessThan(0.05);
  });

  it('refuses whisper silence hallucinations', () => {
    for (const text of [
      'Thank you.',
      'Subtitles by the Amara.org community',
      'you you you you you you you you you you you you you you',
    ]) {
      const verdict = judgeTranscriptSufficiency({ text });
      expect(verdict.sufficient).toBe(false);
      expect(verdict.reason).toBe('too_few_words');
    }
  });

  it('accepts a real introducer recording', () => {
    const verdict = judgeTranscriptSufficiency(REAL_INTRODUCTION);

    expect(verdict.sufficient).toBe(true);
    expect(verdict.reason).toBeUndefined();
    expect(verdict.wordCount).toBeGreaterThan(90);
  });

  it('treats the word-count and distinct-word thresholds as inclusive floors', () => {
    const twelveDistinct =
      'jordan drove through heavy rain helping everyone move apartments without complaining once';
    const atFloor = judgeTranscriptSufficiency({ text: twelveDistinct });
    expect(atFloor.wordCount).toBe(MIN_TRANSCRIPT_WORD_COUNT);
    expect(atFloor.distinctWords).toBeGreaterThanOrEqual(MIN_TRANSCRIPT_DISTINCT_WORDS);
    expect(atFloor.sufficient).toBe(true);

    const oneWordShort = judgeTranscriptSufficiency({
      text: 'jordan drove through heavy rain helping everyone move apartments without complaining',
    });
    expect(oneWordShort.wordCount).toBe(MIN_TRANSCRIPT_WORD_COUNT - 1);
    expect(oneWordShort.sufficient).toBe(false);
    expect(oneWordShort.reason).toBe('too_few_words');

    // Enough words, too few distinct ones: a repeated hallucination.
    const repeated = judgeTranscriptSufficiency({
      text: 'okay so okay so okay so okay so okay so okay so okay so',
    });
    expect(repeated.wordCount).toBeGreaterThanOrEqual(MIN_TRANSCRIPT_WORD_COUNT);
    expect(repeated.distinctWords).toBeLessThan(MIN_TRANSCRIPT_DISTINCT_WORDS);
    expect(repeated.sufficient).toBe(false);
    expect(repeated.reason).toBe('too_few_words');
  });

  it('counts only tokens with two or more letters, unicode-aware', () => {
    expect(judgeTranscriptSufficiency({ text: '. . - ? ! 123 a I' }).wordCount).toBe(0);
    expect(judgeTranscriptSufficiency({ text: "don't we’ve café" }).wordCount).toBe(3);
    expect(judgeTranscriptSufficiency({ text: '조던은 정말 좋은 사람이에요' }).wordCount).toBe(4);
  });

  it('flags low coverage when a handful of words is scattered over a long recording', () => {
    const verdict = judgeTranscriptSufficiency({
      text: 'okay um so yeah hello there right okay um well anyway hmm',
      segments: [
        { start: 2, end: 3, text: 'okay um so yeah' },
        { start: 40, end: 41, text: 'hello there right okay' },
        { start: 70, end: 72, text: 'um well anyway hmm' },
      ],
      durationMs: 90_000,
    });

    expect(verdict.wordCount).toBeGreaterThanOrEqual(MIN_TRANSCRIPT_WORD_COUNT);
    expect(verdict.speechCoverage).toBeLessThan(0.15);
    expect(verdict.sufficient).toBe(false);
    expect(verdict.reason).toBe('low_coverage');
  });

  it('never rejects on coverage alone once the words are plentiful', () => {
    // Distinct, digit-free words: the token rule counts letters only.
    const alphabet = 'abcdefghijklmnopqrstuvwxyz';
    const text = Array.from(
      { length: COVERAGE_TRUSTED_WORD_COUNT },
      (_unused, index) => `word${alphabet[Math.floor(index / 26)]}${alphabet[index % 26]}`,
    ).join(' ');
    const verdict = judgeTranscriptSufficiency({
      text,
      segments: [{ start: 0, end: 1, text }],
      durationMs: 120_000,
    });

    expect(verdict.speechCoverage).toBeLessThan(0.15);
    expect(verdict.sufficient).toBe(true);
  });

  it('judges on words alone when timings are absent or unusable', () => {
    expect(
      judgeTranscriptSufficiency({ text: REAL_INTRODUCTION_TEXT }).speechCoverage,
    ).toBeUndefined();
    expect(
      judgeTranscriptSufficiency({ text: REAL_INTRODUCTION_TEXT, segments: [], durationMs: 0 })
        .sufficient,
    ).toBe(true);
  });
});
