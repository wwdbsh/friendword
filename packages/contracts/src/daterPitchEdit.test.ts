// FIFTH-AUDIT REGRESSION — P0 (the Dater approves the words that publish).
// The Dater edits the five published structure fields; the server derives
// headline/body from them. These boundaries must match
// private.normalized_dater_pitch_structure and
// private.dater_revision_moderation_text (migration 0047) exactly.
import { describe, expect, it } from 'vitest';

import {
  DATER_PITCH_FIELD_LIMITS,
  DATER_PITCH_STRUCTURE_ERRORS,
  characterLength,
  daterPitchModerationText,
  daterPitchStructureEditSchema,
  deriveDaterPitchBody,
  deriveDaterPitchHeadline,
  rendersBlank,
  type DaterPitchStructureEdit,
} from './daterPitchEdit';

const valid: DaterPitchStructureEdit = {
  hook: 'Blair turns ordinary Tuesdays into stories.',
  relationship_context: 'We shared a wall in a Capitol Hill apartment for four years.',
  three_specific_qualities: ['Remembers every birthday', 'Cooks for a crowd', 'Never gossips'],
  evidence_or_anecdote: 'Blair drove three hours to sit with me after my surgery.',
  good_match_for: 'Someone who likes long walks and longer conversations.',
};

function firstMessage(input: unknown): string {
  const parsed = daterPitchStructureEditSchema.safeParse(input);
  expect(parsed.success).toBe(false);
  return parsed.success ? '' : (parsed.error.issues[0]?.message ?? '');
}

describe('daterPitchStructureEditSchema', () => {
  it('states the same ceilings as private.normalized_dater_pitch_structure', () => {
    // Literals on purpose: these mirror migration 0047 and must not drift with
    // the constant they are meant to pin.
    expect(DATER_PITCH_FIELD_LIMITS).toEqual({
      hook: 120,
      relationshipContext: 500,
      quality: 120,
      evidenceOrAnecdote: 500,
      goodMatchFor: 500,
    });
  });

  it('accepts the five fields and trims every value', () => {
    const parsed = daterPitchStructureEditSchema.parse({
      ...valid,
      hook: `  ${valid.hook}  `,
      three_specific_qualities: [
        '  Remembers every birthday  ',
        'Cooks for a crowd',
        'Never gossips',
      ],
    });

    expect(parsed.hook).toBe(valid.hook);
    expect(parsed.three_specific_qualities[0]).toBe('Remembers every birthday');
  });

  it('requires exactly three qualities', () => {
    expect(daterPitchStructureEditSchema.safeParse(valid).success).toBe(true);
    expect(firstMessage({ ...valid, three_specific_qualities: ['one', 'two'] })).toBe(
      DATER_PITCH_STRUCTURE_ERRORS.qualityCount,
    );
    expect(
      firstMessage({ ...valid, three_specific_qualities: ['one', 'two', 'three', 'four'] }),
    ).toBe(DATER_PITCH_STRUCTURE_ERRORS.qualityCount);
  });

  it('rejects a blank or missing field with the server rejection string', () => {
    expect(firstMessage({ ...valid, good_match_for: '   ' })).toBe(
      DATER_PITCH_STRUCTURE_ERRORS.missingField,
    );
    expect(firstMessage({ ...valid, three_specific_qualities: ['one', '  ', 'three'] })).toBe(
      DATER_PITCH_STRUCTURE_ERRORS.missingField,
    );
    const withoutHook: Record<string, unknown> = { ...valid };
    delete withoutHook.hook;
    expect(firstMessage(withoutHook)).toBe(DATER_PITCH_STRUCTURE_ERRORS.missingField);
  });

  it('accepts each field at its limit and rejects one character more', () => {
    const at = (length: number) => 'a'.repeat(length);
    const { hook, relationshipContext, quality, evidenceOrAnecdote, goodMatchFor } =
      DATER_PITCH_FIELD_LIMITS;

    expect(
      daterPitchStructureEditSchema.safeParse({
        hook: at(hook),
        relationship_context: at(relationshipContext),
        three_specific_qualities: [at(quality), at(quality), at(quality)],
        evidence_or_anecdote: at(evidenceOrAnecdote),
        good_match_for: at(goodMatchFor),
      }).success,
    ).toBe(true);

    expect(firstMessage({ ...valid, hook: at(hook + 1) })).toBe(
      DATER_PITCH_STRUCTURE_ERRORS.tooLong,
    );
    expect(firstMessage({ ...valid, relationship_context: at(relationshipContext + 1) })).toBe(
      DATER_PITCH_STRUCTURE_ERRORS.tooLong,
    );
    expect(firstMessage({ ...valid, evidence_or_anecdote: at(evidenceOrAnecdote + 1) })).toBe(
      DATER_PITCH_STRUCTURE_ERRORS.tooLong,
    );
    expect(firstMessage({ ...valid, good_match_for: at(goodMatchFor + 1) })).toBe(
      DATER_PITCH_STRUCTURE_ERRORS.tooLong,
    );
    expect(
      firstMessage({ ...valid, three_specific_qualities: [at(quality + 1), 'two', 'three'] }),
    ).toBe(DATER_PITCH_STRUCTURE_ERRORS.tooLong);
  });

  // Fifth-audit verdicts 1/3/5: btrim(text) strips U+0020 only, so the RPC's
  // non-blank guard accepts a field that renders as nothing. The editor is the
  // only place that can stop a blank public section, so it must reject them.
  it('rejects a field that renders as nothing but survives trim()', () => {
    const invisible = ['\t', '\n', '\r', '\v', ' ', ' ', '​', '﻿', '​ '];
    for (const value of invisible) {
      expect(firstMessage({ ...valid, hook: value })).toBe(
        DATER_PITCH_STRUCTURE_ERRORS.missingField,
      );
      expect(firstMessage({ ...valid, three_specific_qualities: ['one', value, 'three'] })).toBe(
        DATER_PITCH_STRUCTURE_ERRORS.missingField,
      );
    }
    expect(rendersBlank('​')).toBe(true);
    expect(rendersBlank('​ok')).toBe(false);
  });
  // The client mirror must match private.invisible_codepoint (0047) exactly:
  // stricter is fail-safe, but looser publishes a blank public section and
  // over-strict refuses text a Dater is entitled to write.
  it('treats exactly the code points private.invisible_codepoint treats as blank', () => {
    const invisible = [
      '\u0009', // TAB
      '\u000A', // LF
      '\u000B', // VT
      '\u000C', // FF
      '\u000D', // CR
      '\u00A0', // NBSP
      '\u00AD', // SOFT HYPHEN
      '\u034F', // COMBINING GRAPHEME JOINER
      '\u061C', // ARABIC LETTER MARK
      '\u115F', // HANGUL CHOSEONG FILLER
      '\u1160', // HANGUL JUNGSEONG FILLER
      '\u1680', // OGHAM SPACE MARK
      '\u180E', // MONGOLIAN VOWEL SEPARATOR
      '\u2003', // EM SPACE
      '\u200A', // HAIR SPACE
      '\u200B', // ZWSP
      '\u200C', // ZWNJ
      '\u200D', // ZWJ
      '\u2028', // LINE SEPARATOR
      '\u2029', // PARAGRAPH SEPARATOR
      '\u202F', // NARROW NBSP
      '\u205F', // MEDIUM MATHEMATICAL SPACE
      '\u2060', // WORD JOINER
      '\u3000', // IDEOGRAPHIC SPACE
      '\u3164', // HANGUL FILLER
      '\uFE0F', // VARIATION SELECTOR-16
      '\uFEFF', // ZERO WIDTH NO-BREAK SPACE
      '\uFFA0', // HALFWIDTH HANGUL FILLER
    ];
    for (const character of invisible) {
      expect({ character, blank: rendersBlank(character.repeat(3)) }).toEqual({
        character,
        blank: true,
      });
    }
    // Real text the Dater is entitled to publish must never read as blank.
    const visible = [
      '\uAC00', // HANGUL SYLLABLE GA
      '\u3131', // HANGUL LETTER KIYEOK
      '\u002E', // FULL STOP
      '\u{1F642}', // EMOJI
      '\u0061', // LATIN a
      '\u2013', // EN DASH
    ];
    for (const character of visible) {
      expect({ character, blank: rendersBlank(character) }).toEqual({ character, blank: false });
    }
  });

  // Fifth-audit verdict 6: `char_length` counts code points; `.max()` and
  // String.length count UTF-16 units, so an emoji hook was rejected a character
  // early. Both sides must draw the line in the same place.
  it('counts length in code points, like char_length', () => {
    const emoji = '🙂';
    expect(emoji.length).toBe(2);
    expect(characterLength(emoji.repeat(DATER_PITCH_FIELD_LIMITS.hook))).toBe(
      DATER_PITCH_FIELD_LIMITS.hook,
    );
    expect(
      daterPitchStructureEditSchema.safeParse({
        ...valid,
        hook: emoji.repeat(DATER_PITCH_FIELD_LIMITS.hook),
      }).success,
    ).toBe(true);
    expect(firstMessage({ ...valid, hook: emoji.repeat(DATER_PITCH_FIELD_LIMITS.hook + 1) })).toBe(
      DATER_PITCH_STRUCTURE_ERRORS.tooLong,
    );
  });

  it('derives headline and body exactly as the RPC does', () => {
    expect(deriveDaterPitchHeadline(valid)).toBe(valid.hook);
    expect(deriveDaterPitchBody(valid)).toBe(
      `${valid.relationship_context}\n\n${valid.evidence_or_anecdote}\n\nA good match: ${valid.good_match_for}`,
    );
  });

  it('keys moderation on the derived copy plus the three qualities', () => {
    expect(daterPitchModerationText(valid)).toBe(
      `${deriveDaterPitchHeadline(valid)}\n\n${deriveDaterPitchBody(valid)}\n\n${valid.three_specific_qualities.join('\n\n')}`,
    );
    // The qualities publish verbatim, so they must be inside the moderated text.
    expect(daterPitchModerationText(valid)).toContain('Never gossips');
  });
});
