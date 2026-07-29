import { z } from 'zod';

/**
 * The five pitch-structure fields the Dater edits and approves at consent.
 * `hard_claims_requiring_confirmation` is deliberately absent from the edit
 * schema: the Dater cannot rewrite the AI's safety flags. They decide per claim
 * whether it stays on the page, and the retained subset travels as its own RPC
 * argument (`retained_hard_claims`), which can only shrink the flagged list.
 */

/**
 * Length ceilings enforced by private.normalized_dater_pitch_structure.
 *
 * These are CHARACTER counts, matching PostgreSQL `char_length`. Zod's `.max()`
 * counts UTF-16 code units, which disagrees with the server on astral
 * characters (one emoji = 2 code units but 1 character), so the schema below
 * measures with `characterLength` instead of `.max()`.
 */
export const DATER_PITCH_FIELD_LIMITS = {
  hook: 120,
  relationshipContext: 500,
  quality: 120,
  evidenceOrAnecdote: 500,
  goodMatchFor: 500,
} as const;

export const DATER_PITCH_QUALITY_COUNT = 3;

/**
 * Verbatim rejection strings raised by the RPC. Reusing them keeps the client
 * check and the server check describing the same rule.
 */
export const DATER_PITCH_STRUCTURE_ERRORS = {
  missingField: 'pitch structure requires all five fields',
  qualityCount: 'pitch structure requires exactly three qualities',
  tooLong: 'pitch structure field is too long',
} as const;

/**
 * Verbatim rejection raised when the retained list names a claim the AI never
 * flagged. The client may only shrink the flagged list, never invent an entry.
 */
export const DATER_HARD_CLAIM_ERRORS = {
  notFlagged: 'hard claim is not one of the flagged claims',
} as const;

/**
 * Code point ranges that occupy no visible space, mirroring
 * private.invisible_codepoint (migration 0047) range for range.
 *
 * JavaScript's `\s` covers NBSP and the EM-SPACE family but not the zero-width
 * or format characters, and PostgreSQL's one-argument `btrim` strips only
 * U+0020 — which is how a field of tabs or U+200B used to satisfy the "all five
 * fields" guard and publish as an empty section. Written as ranges rather than
 * a regex character class because a class holding ZWJ and the variation
 * selectors is, correctly, reported as misleading.
 */
const INVISIBLE_CODE_POINT_RANGES: readonly (readonly [number, number])[] = [
  [0x0000, 0x0020], // C0 controls, TAB, LF, CR, SPACE
  [0x007f, 0x00a0], // DEL, C1 controls, NBSP
  [0x00ad, 0x00ad], // SOFT HYPHEN
  [0x034f, 0x034f], // COMBINING GRAPHEME JOINER
  [0x061c, 0x061c], // ARABIC LETTER MARK
  [0x115f, 0x1160], // HANGUL CHOSEONG/JUNGSEONG FILLER
  [0x1680, 0x1680], // OGHAM SPACE MARK
  [0x17b4, 0x17b5], // KHMER INHERENT VOWELS
  [0x180b, 0x180f], // MONGOLIAN SELECTORS
  [0x2000, 0x200f], // SPACES, ZWSP/ZWNJ/ZWJ, LRM/RLM
  [0x2028, 0x202f], // SEPARATORS, BIDI, NNBSP
  [0x205f, 0x206f], // MMSP, WORD JOINER, FORMAT
  [0x3000, 0x3000], // IDEOGRAPHIC SPACE
  [0x3164, 0x3164], // HANGUL FILLER
  [0xfe00, 0xfe0f], // VARIATION SELECTORS
  [0xfeff, 0xfeff], // ZERO WIDTH NO-BREAK SPACE
  [0xffa0, 0xffa0], // HALFWIDTH HANGUL FILLER
];

/** True when the value renders as empty space, whatever it is made of. */
export function rendersBlank(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    const invisible = INVISIBLE_CODE_POINT_RANGES.some(
      ([start, end]) => code >= start && code <= end,
    );
    if (!invisible) {
      return false;
    }
  }
  return true;
}

/** Character count the way PostgreSQL `char_length` counts it (code points). */
export function characterLength(value: string): number {
  return Array.from(value).length;
}

function requiredField(maxLength: number) {
  return z
    .string({
      required_error: DATER_PITCH_STRUCTURE_ERRORS.missingField,
      invalid_type_error: DATER_PITCH_STRUCTURE_ERRORS.missingField,
    })
    .trim()
    .refine((value) => !rendersBlank(value), DATER_PITCH_STRUCTURE_ERRORS.missingField)
    .refine((value) => characterLength(value) <= maxLength, DATER_PITCH_STRUCTURE_ERRORS.tooLong);
}

export const daterPitchStructureEditSchema = z.object({
  hook: requiredField(DATER_PITCH_FIELD_LIMITS.hook),
  relationship_context: requiredField(DATER_PITCH_FIELD_LIMITS.relationshipContext),
  three_specific_qualities: z
    .array(requiredField(DATER_PITCH_FIELD_LIMITS.quality), {
      required_error: DATER_PITCH_STRUCTURE_ERRORS.missingField,
      invalid_type_error: DATER_PITCH_STRUCTURE_ERRORS.missingField,
    })
    .length(DATER_PITCH_QUALITY_COUNT, DATER_PITCH_STRUCTURE_ERRORS.qualityCount),
  evidence_or_anecdote: requiredField(DATER_PITCH_FIELD_LIMITS.evidenceOrAnecdote),
  good_match_for: requiredField(DATER_PITCH_FIELD_LIMITS.goodMatchFor),
});

export type DaterPitchStructureEdit = z.infer<typeof daterPitchStructureEditSchema>;

/**
 * Server-derived headline. Mirrors create_dater_revision, which mirrors the
 * transcription route — the published headline is always the hook.
 */
export function deriveDaterPitchHeadline(structure: DaterPitchStructureEdit): string {
  return structure.hook.trim();
}

/**
 * Server-derived body. Byte-identical to create_dater_revision and the
 * transcription route, so the derived copy can never diverge from the
 * structure the public page renders.
 */
export function deriveDaterPitchBody(structure: DaterPitchStructureEdit): string {
  return [
    structure.relationship_context.trim(),
    structure.evidence_or_anecdote.trim(),
    `A good match: ${structure.good_match_for.trim()}`,
  ].join('\n\n');
}

/**
 * The exact string the text_moderations ledger is keyed on for a structure
 * edit — mirrors private.dater_revision_moderation_text. The qualities are
 * appended because the public page prints them verbatim while the derived
 * headline/body do not contain them.
 */
export function daterPitchModerationText(structure: DaterPitchStructureEdit): string {
  return [
    deriveDaterPitchHeadline(structure),
    deriveDaterPitchBody(structure),
    ...structure.three_specific_qualities.map((quality) => quality.trim()),
  ].join('\n\n');
}
