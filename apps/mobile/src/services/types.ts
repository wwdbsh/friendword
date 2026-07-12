import { PITCH_DRAFT_STATUSES, type ContextRole, type PitchDraftStatus } from '@friendword/domain';
import { z } from 'zod';

export const RELATIONSHIP_KINDS = ['Friend', 'Coworker', 'Family', 'Roommate', 'Other'] as const;

export const RELATIONSHIP_DURATIONS = [
  'Less than 1 year',
  '1–3 years',
  '3–10 years',
  '10+ years',
] as const;

export type RelationshipKind = (typeof RELATIONSHIP_KINDS)[number];
export type RelationshipDuration = (typeof RELATIONSHIP_DURATIONS)[number];

const PitchDraftIdSchema = z.string().min(1).brand<'PitchDraftId'>();
const PitchDraftStatusSchema = z.enum(PITCH_DRAFT_STATUSES);
export const InvitationContactSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('phone'),
    value: z.string().refine((value) => value.replace(/\D/g, '').length >= 7),
  }),
  z.object({ kind: z.literal('email'), value: z.email() }),
]);
const PitchRelationshipSchema = z.object({
  kind: z.enum(RELATIONSHIP_KINDS),
  duration: z.enum(RELATIONSHIP_DURATIONS),
  friendFirstName: z.string().min(1),
  contact: InvitationContactSchema,
});
const PitchPhotoSchema = z.object({
  uri: z.string().min(1),
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
});
const PitchRecordingSchema = z.object({
  uri: z.string().min(1),
  durationMillis: z.number().int().positive().max(60_000),
  caption: z.string().min(1),
});

export const PitchDraftSchema = z.object({
  id: PitchDraftIdSchema,
  status: PitchDraftStatusSchema,
  contextRole: z.literal('INTRODUCER'),
  relationship: PitchRelationshipSchema.nullable(),
  photos: z.array(PitchPhotoSchema).max(4),
  recording: PitchRecordingSchema.nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const PitchDraftListSchema = z.array(PitchDraftSchema);

export type PitchDraftId = z.infer<typeof PitchDraftIdSchema>;
export type InvitationContact = z.infer<typeof InvitationContactSchema>;
export type PitchRelationship = z.infer<typeof PitchRelationshipSchema>;
export type PitchPhoto = z.infer<typeof PitchPhotoSchema>;
export type PitchRecording = z.infer<typeof PitchRecordingSchema>;
export type PitchDraft = z.infer<typeof PitchDraftSchema> & {
  readonly status: PitchDraftStatus;
  readonly contextRole: Extract<ContextRole, 'INTRODUCER'>;
};
