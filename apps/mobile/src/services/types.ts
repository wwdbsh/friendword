import type { PitchStructure } from '@friendword/contracts';
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
export const EmailInvitationContactSchema = z.object({
  kind: z.literal('email'),
  value: z.email(),
});
export const InvitationContactSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('phone'),
    value: z.string().refine((value) => value.replace(/\D/g, '').length >= 7),
  }),
  EmailInvitationContactSchema,
  z.object({ kind: z.literal('sent') }),
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

/**
 * Filled in once the draft is synced to Supabase on submit. The raw consent
 * token lives only on the introducer's device so they can share the approval
 * link; the server stores just its hash.
 */
const PitchServerSyncSchema = z.object({
  draftId: z.uuid(),
  consentRequestId: z.uuid().nullable().default(null),
  consentToken: z.string().min(24).nullable().default(null),
  // True once the voice/photo objects have been uploaded to Supabase storage
  // for this server draft. The upload step (`uploadDraftMedia`) is split off
  // from server-draft creation so AI-processing consent can be recorded in
  // between; this flag keeps that step idempotent because the signed upload
  // URL is created with upsert:false and re-registering assets would duplicate
  // rows. Defaults false so drafts persisted before this field parse cleanly.
  mediaUploaded: z.boolean().default(false),
});

export const EMPTY_PITCH_STRUCTURE = {
  hook: '',
  relationship_context: '',
  three_specific_qualities: ['', '', ''],
  evidence_or_anecdote: '',
  good_match_for: '',
  hard_claims_requiring_confirmation: [],
} satisfies PitchStructure;

const MobilePitchStructureSchema: z.ZodType<PitchStructure> = z.object({
  hook: z.string(),
  relationship_context: z.string(),
  three_specific_qualities: z.tuple([z.string(), z.string(), z.string()]),
  evidence_or_anecdote: z.string(),
  good_match_for: z.string(),
  hard_claims_requiring_confirmation: z.array(z.string()),
});

export const PitchReviewSchema = z.object({
  headline: z.string(),
  body: z.string(),
  structure: MobilePitchStructureSchema,
  generationMode: z.enum(['pending', 'generated', 'manual']),
  responseNote: z.string().nullable(),
});

export const PitchDraftSchema = z.object({
  id: PitchDraftIdSchema,
  status: PitchDraftStatusSchema,
  contextRole: z.literal('INTRODUCER'),
  relationship: PitchRelationshipSchema.nullable(),
  photos: z.array(PitchPhotoSchema).max(4),
  recording: PitchRecordingSchema.nullable(),
  review: PitchReviewSchema.default({
    headline: '',
    body: '',
    structure: EMPTY_PITCH_STRUCTURE,
    generationMode: 'pending',
    responseNote: null,
  }),
  server: PitchServerSyncSchema.nullable().default(null),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const PitchDraftListSchema = z.array(PitchDraftSchema);

export type PitchServerSync = z.infer<typeof PitchServerSyncSchema>;
export type PitchReview = z.infer<typeof PitchReviewSchema>;
export type PitchDraftId = z.infer<typeof PitchDraftIdSchema>;
export type EmailInvitationContact = z.infer<typeof EmailInvitationContactSchema>;
export type InvitationContact = z.infer<typeof InvitationContactSchema>;
export type PitchRelationship = z.infer<typeof PitchRelationshipSchema>;
export type PitchPhoto = z.infer<typeof PitchPhotoSchema>;
export type PitchRecording = z.infer<typeof PitchRecordingSchema>;
export type PitchDraft = z.infer<typeof PitchDraftSchema> & {
  readonly status: PitchDraftStatus;
  readonly contextRole: Extract<ContextRole, 'INTRODUCER'>;
};
