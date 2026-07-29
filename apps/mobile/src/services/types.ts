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
/**
 * Image types the server accepts for pitch photos (`ALLOWED_IMAGE_KINDS` in
 * `@friendword/domain`, enforced by `/api/media/validate` from the real magic
 * bytes). A picked asset outside this set is refused at pick time rather than
 * uploaded under a name and Content-Type that do not match its bytes.
 */
export const PHOTO_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export type PhotoMimeType = (typeof PHOTO_MIME_TYPES)[number];

/**
 * What already succeeded for one asset of a server-backed draft, recorded as
 * soon as each step lands so a retry after a partial failure neither re-uploads
 * (the signed URL is upsert:false) nor re-registers (which would duplicate
 * pitch_assets rows). `validated` is true only for a server verdict of
 * `passed`; a validation that could not run leaves it false so a later submit
 * runs it again instead of latching a completion that never happened.
 */
const UploadedAssetSchema = z.object({
  objectName: z.string().min(1),
  registered: z.boolean(),
  validated: z.boolean(),
});
const PitchPhotoSchema = z.object({
  uri: z.string().min(1),
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
  // The real type of the picked bytes, carried through to the upload so the
  // stored object's extension and Content-Type match what the server sniffs.
  // Absent on drafts persisted before this was tracked — the upload path then
  // falls back to the file extension.
  mimeType: z.enum(PHOTO_MIME_TYPES).optional(),
  upload: UploadedAssetSchema.optional(),
});
const PitchRecordingSchema = z.object({
  uri: z.string().min(1),
  durationMillis: z.number().int().positive().max(60_000),
  // CP-8: the text recap is optional at recording time — the AI path derives
  // captions from the transcript. The manual (no-AI) path re-requires a recap
  // at submission (preparePitchReview) since it is the only caption source.
  caption: z.string().max(500),
  upload: UploadedAssetSchema.optional(),
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
  // True once every voice/photo object's bytes are on Supabase storage and
  // registered for this server draft. It says nothing about media validation —
  // that verdict is per asset (`UploadedAssetSchema.validated`) — because
  // `purgeableMediaUris` deletes the on-device originals off this flag and must
  // keep doing so once the server holds them. The upload step
  // (`uploadDraftMedia`) is split off from server-draft creation so
  // AI-processing consent can be recorded in between. Defaults false so drafts
  // persisted before this field parse cleanly.
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

export type UploadedAsset = z.infer<typeof UploadedAssetSchema>;
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
