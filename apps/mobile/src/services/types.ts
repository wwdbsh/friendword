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
 * Container types the server's ingest probe accepts for a pitch clip (mp4 and
 * mov, H.264/HEVC inside). The probe re-reads the real bytes and is the
 * authority; this list only keeps the app from uploading a file under a name and
 * Content-Type the probe would refuse.
 */
export const CLIP_MIME_TYPES = ['video/mp4', 'video/quicktime'] as const;

export type ClipMimeType = (typeof CLIP_MIME_TYPES)[number];

/**
 * Longest source clip the pipeline accepts (user cap, 2026-07-30): 15 seconds
 * in, at most 10 seconds of it used per scene window. `videoMaxDuration` only
 * bounds *recording*, so a library pick has to be measured and refused here.
 */
export const CLIP_MAX_SOURCE_DURATION_MS = 15_000;

/**
 * How many photos and clips one pitch may carry. The server enforces both (the
 * storage quota and the clip entitlement); these are the client mirror that
 * keeps the picker from handing over a selection the server would reject.
 * `MAX_PITCH_VISUALS` is the combined ceiling — with today's per-kind caps it is
 * never the binding one, but it is what a scene's shot budget is spent on, so
 * the picker checks it rather than assuming the sum stays small.
 */
export const MAX_PITCH_PHOTOS = 4;
export const MAX_PITCH_CLIPS = 3;
export const MAX_PITCH_VISUALS = MAX_PITCH_PHOTOS + MAX_PITCH_CLIPS;

/**
 * Clips a draft may register without a Campaign Pass.
 *
 * `MAX_PITCH_CLIPS` is the absolute schema ceiling; this is the allowance the
 * server actually applies to an ordinary draft (0050
 * `private.pitch_draft_video_allowance`: 3 while the pitch's campaign holds an
 * active pass, otherwise 1 — and a campaign exists only after publish, so a
 * first-time draft always gets 1). The picker mirrors this so the introducer is
 * told before the upload, not by a registration the server refuses. The server
 * decides; this never grants anything.
 */
export const FREE_PITCH_CLIP_ALLOWANCE = 1;

/**
 * Upload ceiling for one clip when the app was built without a configured value:
 * 50MB, which is what Supabase Storage accepts on the current Free plan. Kept in
 * sync with `FRIENDWORD_VIDEO_MAX_BYTES` on the server, which is the authority —
 * this is the mirror that saves the introducer a doomed upload.
 */
export const DEFAULT_CLIP_MAX_BYTES = 52_428_800;

/**
 * Where one uploaded clip stands in the server's ingest pipeline (probe → silent
 * proxy → poster → frame moderation). The five values of
 * `pitch_video_ingests.ingest_status` (0050), mirrored exactly so this app can
 * never invent a sixth state or collapse two into one:
 * - `pending`: queued, nothing has run yet.
 * - `processing`: a worker holds the lease.
 * - `succeeded`: every automated check came back clean and the derivatives exist.
 * - `flagged`: frame moderation refused it. The clip stays unpublishable, the
 *   original is kept as review evidence, and a person decides next.
 * - `failed`: the pipeline could not process it (probe refusal, transcode error).
 *
 * Never a claim about identity, face matching, or audio — the proxy has no audio
 * track at all. Only about the automated checks that actually ran.
 */
export const CLIP_INGEST_STATES = [
  'pending',
  'processing',
  'succeeded',
  'flagged',
  'failed',
] as const;

export type ClipIngestState = (typeof CLIP_INGEST_STATES)[number];

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
  // Stable identity for one picked photo, assigned when it is first saved and
  // kept for as long as that photo stays in the draft. The stored object is
  // named after it, so a removal can never hand a photo's object — and its
  // bytes — to whichever photo later takes its position. The object it names,
  // `photo-<assetKey>.<ext>`, has to match `[A-Za-z0-9][A-Za-z0-9._-]{0,254}`
  // end to end — the storage policy's pattern (0003:63, matched
  // case-insensitively) and the data layer's file-name schema. Lowercase
  // alphanumerics is a subset of that with room to spare, not a requirement of
  // its own; the leading character is always the `p` of the prefix.
  // Absent on photos saved before this was tracked; those keep position-derived
  // object names, which stay correct only while no earlier photo is removed.
  assetKey: z
    .string()
    .max(32)
    .regex(/^[a-z0-9]+$/)
    .optional(),
  // The real type of the picked bytes, carried through to the upload so the
  // stored object's extension and Content-Type match what the server sniffs.
  // Absent on drafts persisted before this was tracked — the upload path then
  // falls back to the file extension.
  mimeType: z.enum(PHOTO_MIME_TYPES).optional(),
  upload: UploadedAssetSchema.optional(),
});
/**
 * One short video the introducer picked. Kept apart from `PitchPhoto` because
 * the two are handled differently end to end: a clip's bytes are judged by the
 * ingest pipeline rather than by `/api/media/validate`, and `durationMillis` /
 * `byteSize` are load-bearing (they mirror the caps the server enforces), not
 * decoration.
 */
const PitchClipSchema = z.object({
  uri: z.string().min(1),
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
  // Source length as the picker measured it. Required: a clip whose length
  // could not be read cannot be checked against the 15s cap, and the picker
  // refuses it rather than uploading a file the probe would reject.
  durationMillis: z.number().int().positive().max(CLIP_MAX_SOURCE_DURATION_MS),
  // Byte size, from the picker or from the local file. Required for the same
  // reason: it is what the client-side mirror of the upload ceiling reads.
  byteSize: z.number().int().positive(),
  // Same identity contract as PitchPhoto.assetKey: the stored object is named
  // `clip-<assetKey>.<ext>`, which must match the storage policy's object-name
  // pattern end to end.
  assetKey: z
    .string()
    .max(32)
    .regex(/^[a-z0-9]+$/)
    .optional(),
  mimeType: z.enum(CLIP_MIME_TYPES),
  // The optional 3-second front-camera opener the introducer recorded in the
  // app, as opposed to a clip they picked from their library
  // (docs/REEL_V3_DESIGN.md §3). Carried through to `pitch_assets.asset_role`
  // at registration so the render worker can find the opener without parsing
  // storage paths (0063). Absent on every other clip; there is no second role.
  role: z.literal('selfie').optional(),
  upload: UploadedAssetSchema.optional(),
  // Cached mirror of the server's ingest job state, refreshed by polling. The
  // server is the authority; absence means this device has not heard yet.
  ingest: z.enum(CLIP_INGEST_STATES).optional(),
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
  photos: z.array(PitchPhotoSchema).max(MAX_PITCH_PHOTOS),
  // Defaulted so drafts persisted before clips existed still parse.
  clips: z.array(PitchClipSchema).max(MAX_PITCH_CLIPS).default([]),
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
export type PitchClip = z.infer<typeof PitchClipSchema>;
export type PitchRecording = z.infer<typeof PitchRecordingSchema>;
export type PitchDraft = z.infer<typeof PitchDraftSchema> & {
  readonly status: PitchDraftStatus;
  readonly contextRole: Extract<ContextRole, 'INTRODUCER'>;
};
