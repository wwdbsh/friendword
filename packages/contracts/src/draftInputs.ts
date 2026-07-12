import { z } from 'zod';

export const relationshipTypeSchema = z.enum(['friend', 'coworker', 'family', 'roommate', 'other']);

export const relationshipDurationSchema = z.enum(['lt1y', 'y1to3', 'y3to10', 'gt10y']);

export const draftInputsSchema = z.object({
  relationshipType: relationshipTypeSchema,
  relationshipDuration: relationshipDurationSchema,
});

export type DraftInputs = z.infer<typeof draftInputsSchema>;
export type RelationshipType = z.infer<typeof relationshipTypeSchema>;
export type RelationshipDuration = z.infer<typeof relationshipDurationSchema>;
