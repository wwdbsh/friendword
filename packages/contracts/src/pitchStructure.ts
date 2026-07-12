import { z } from 'zod';

export const pitchStructureSchema = z.object({
  hook: z.string(),
  relationship_context: z.string(),
  three_specific_qualities: z.array(z.string()).length(3),
  evidence_or_anecdote: z.string(),
  good_match_for: z.string(),
  // These sensitive or hard-to-verify public claims require Dater confirmation before publishing.
  hard_claims_requiring_confirmation: z.array(z.string()),
});

export type PitchStructure = z.infer<typeof pitchStructureSchema>;
