/**
 * T001 (issue #70): a voice note that transcribes to nothing usable must never
 * reach the structuring model.
 *
 * Production evidence (2026-09-08): a 54.5s recording came back from whisper-1
 * as `".     .  .  "` — three "." segments totalling 1.42s of "speech" — and
 * the structuring model invented a whole pitch from it ("spontaneous trip…",
 * qualities kind/funny/adventurous). A real device recording from July
 * transcribed to 585 characters over ~46s. The gap between those two is not
 * subtle, so the guard is deliberately blunt and sits on the server boundary.
 *
 * This module is pure: no I/O, no provider types, so both the web route and any
 * future caller can share exactly one definition of "enough speech to write
 * from".
 */

export type TranscriptSegment = {
  readonly start: number;
  readonly end: number;
  readonly text: string;
};

export type TranscriptSufficiencyInput = {
  readonly text: string;
  readonly segments?: readonly TranscriptSegment[];
  readonly durationMs?: number;
};

export type TranscriptSufficiencyReason = 'no_words' | 'too_few_words' | 'low_coverage';

export type TranscriptSufficiency = {
  readonly sufficient: boolean;
  readonly reason?: TranscriptSufficiencyReason;
  readonly wordCount: number;
  readonly distinctWords: number;
  readonly speechCoverage?: number;
};

/**
 * A word must carry at least two letters. This is what rejects whisper's
 * silence output: "." and "-" produce no tokens at all, and a stray "a" or "I"
 * cannot on its own make a transcript look substantive.
 */
const MIN_LETTERS_PER_WORD = 2;

/**
 * 12 words is below anything a human says when introducing a friend (the real
 * July recording ran ~110 words in 46s) and comfortably above whisper's known
 * silence hallucinations ("Thank you.", "Subtitles by the Amara.org community"
 * — 5 words). Set low on purpose: this guard exists to catch *nothing*, not to
 * judge pitch quality, which the dater's review already does.
 */
export const MIN_TRANSCRIPT_WORD_COUNT = 12;

/**
 * Distinct words defeat a repeated hallucination ("you you you you …") that
 * would otherwise clear the word count. Six distinct words is still far below
 * any real sentence about a person.
 */
export const MIN_TRANSCRIPT_DISTINCT_WORDS = 6;

/**
 * Share of the recording that whisper attributed to segments containing actual
 * words. The production failure sat at 0.026 (1.42s of 54.5s); real speech runs
 * well above 0.6. 0.15 leaves a wide margin for a long pause before someone
 * starts talking.
 */
export const MIN_TRANSCRIPT_SPEECH_COVERAGE = 0.15;

/**
 * Words are the primary signal; coverage is a secondary one computed from
 * provider timings we do not control. Above this many words we trust the words
 * and ignore coverage entirely, so a fast talker or an odd segmentation can
 * never be rejected for a timing artefact.
 */
export const COVERAGE_TRUSTED_WORD_COUNT = 40;

const WORD_CANDIDATE_PATTERN = /[\p{L}\p{M}'’]+/gu;
const LETTER_PATTERN = /[\p{L}\p{M}]/gu;

function wordTokens(text: string): readonly string[] {
  return (text.match(WORD_CANDIDATE_PATTERN) ?? []).filter(
    (token) => (token.match(LETTER_PATTERN) ?? []).length >= MIN_LETTERS_PER_WORD,
  );
}

function speechCoverage(
  segments: readonly TranscriptSegment[] | undefined,
  durationMs: number | undefined,
): number | undefined {
  if (segments === undefined || durationMs === undefined || durationMs <= 0) {
    return undefined;
  }
  const spokenSeconds = segments
    .filter((segment) => wordTokens(segment.text).length > 0)
    .reduce((total, segment) => total + Math.max(0, segment.end - segment.start), 0);
  return (spokenSeconds * 1000) / durationMs;
}

/**
 * Decides whether a transcript contains enough real speech to draft a pitch
 * from. Callers must refuse to structure or persist anything when this returns
 * `sufficient: false`.
 */
export function judgeTranscriptSufficiency(
  input: TranscriptSufficiencyInput,
): TranscriptSufficiency {
  const words = wordTokens(input.text);
  const wordCount = words.length;
  const distinctWords = new Set(words.map((word) => word.toLocaleLowerCase())).size;
  const coverage = speechCoverage(input.segments, input.durationMs);
  const base = {
    wordCount,
    distinctWords,
    ...(coverage === undefined ? {} : { speechCoverage: coverage }),
  };

  if (wordCount === 0) {
    return { sufficient: false, reason: 'no_words', ...base };
  }
  if (wordCount < MIN_TRANSCRIPT_WORD_COUNT || distinctWords < MIN_TRANSCRIPT_DISTINCT_WORDS) {
    return { sufficient: false, reason: 'too_few_words', ...base };
  }
  if (
    coverage !== undefined &&
    coverage < MIN_TRANSCRIPT_SPEECH_COVERAGE &&
    wordCount < COVERAGE_TRUSTED_WORD_COUNT
  ) {
    return { sufficient: false, reason: 'low_coverage', ...base };
  }
  return { sufficient: true, ...base };
}
