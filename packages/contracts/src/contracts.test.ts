import { describe, expect, it } from 'vitest';

import { draftInputsSchema } from './draftInputs';
import { pitchStructureSchema } from './pitchStructure';

describe('draftInputsSchema', () => {
  it('accepts supported relationship context when values are valid', () => {
    const result = draftInputsSchema.safeParse({
      relationshipType: 'friend',
      relationshipDuration: 'y3to10',
    });

    expect(result.success).toBe(true);
  });

  it('rejects unsupported relationship context when values are unknown', () => {
    const result = draftInputsSchema.safeParse({
      relationshipType: 'stranger',
      relationshipDuration: 'forever',
    });

    expect(result.success).toBe(false);
  });
});

describe('pitchStructureSchema', () => {
  const validPitchStructure = {
    hook: 'You should meet my friend.',
    relationship_context: 'We have been friends for six years.',
    three_specific_qualities: ['kind', 'curious', 'reliable'],
    evidence_or_anecdote: 'They always make time for friends.',
    good_match_for: 'Someone thoughtful and adventurous.',
    hard_claims_requiring_confirmation: [],
  };

  it('accepts a complete structure when it has exactly three qualities', () => {
    expect(pitchStructureSchema.safeParse(validPitchStructure).success).toBe(true);
  });

  it('rejects a structure when it does not have exactly three qualities', () => {
    const result = pitchStructureSchema.safeParse({
      ...validPitchStructure,
      three_specific_qualities: ['kind', 'curious'],
    });

    expect(result.success).toBe(false);
  });
});
