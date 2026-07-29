import {
  PitchDraftRepo,
  UnauthenticatedError,
  type BrowserSupabaseClient,
  type ConsentRequestRow,
  type PitchDraftRow,
} from '@friendword/data';
import type {
  DraftInputs,
  RelationshipDuration as ServerRelationshipDuration,
  RelationshipType as ServerRelationshipType,
} from '@friendword/contracts';

import { photoMimeType, photoObjectName, putLocalFile } from './mediaFiles';
import { requestMediaValidation, type MediaValidationOutcome } from './mediaValidation';
import { requestPitchTextModeration } from './textModeration';
import {
  MockPitchDraftService,
  PitchDraftSubmissionError,
  settleWithin,
  type PitchDraftService,
  type PurgeScope,
} from './pitchDrafts';
import {
  EMPTY_PITCH_STRUCTURE,
  PitchDraftListSchema,
  PitchReviewSchema,
  type PitchDraft,
  type PitchDraftId,
  type PitchPhoto,
  type PitchRecording,
  type PitchRelationship,
  type PitchReview,
  type RelationshipDuration,
  type RelationshipKind,
  type UploadedAsset,
} from './types';

type PitchDraftRepository = Pick<
  PitchDraftRepo,
  | 'createDraft'
  | 'getDraft'
  | 'listMyConsentRequests'
  | 'listMyDrafts'
  | 'registerAsset'
  | 'requestAssetUpload'
  | 'submitForConsent'
  | 'updateDraft'
>;

export class NeedsSignInError extends Error {
  constructor() {
    super('Sign in to continue this pitch.');
  }
}

/**
 * Stable substring of the SQLERRM raised by 0016 `submit_for_consent` when
 * `media_validation_enforcement` is on and a pitch asset has no `passed`
 * media_validations row. A manual ("Write it myself") pitch never transcribes
 * or voice-moderates, so its voice validation stays 'skipped' and this gate
 * fails the submission closed. Match on a stable substring — the message text
 * is owned by the migration. Distinct from the profile gate ('profile photos
 * require completed validation').
 */
const MEDIA_VALIDATION_GATE_MESSAGE = 'pitch media requires completed validation';

/**
 * Copy for the honest manual→AI trade-off: while safety review is on, a pitch
 * the introducer wrote without AI review cannot be published, because its voice
 * was never transcribed or moderated. They can switch to AI review (which runs
 * that moderation, with consent) or keep the pitch saved as a draft.
 */
export const MANUAL_PITCH_NEEDS_AI_REVIEW_MESSAGE =
  'You wrote this pitch yourself, so its recording never went through AI safety review. ' +
  'While safety review is on, only AI-reviewed pitches can be published. ' +
  'Use AI review to submit it, or keep it saved as a draft for now.';

/**
 * Copy for the other way the 0016 gate can fail an AI-reviewed pitch: its media
 * was uploaded but no `passed` verdict was ever recorded, because the validate
 * call itself could not run (offline, auth, or a server error). Nothing is wrong
 * with the pitch, so say so and let them try again.
 */
export const MEDIA_VALIDATION_INCOMPLETE_MESSAGE =
  'Safety review has not finished for this pitch’s photos or recording yet. ' +
  'Check your connection and try sending it again.';

/**
 * Thrown when {@link HybridPitchDraftService.finalizeConsent} hits the 0016
 * media-validation gate on a manual (no-AI) draft. The review screen surfaces
 * this as a product decision — offer the AI review path — rather than a generic
 * "submission failed".
 */
export class ManualPitchNeedsAiReviewError extends PitchDraftSubmissionError {
  constructor() {
    super(MANUAL_PITCH_NEEDS_AI_REVIEW_MESSAGE);
    this.name = 'ManualPitchNeedsAiReviewError';
  }
}

/** Walks the error → cause chain for a Postgres SQLERRM substring. */
function includesServerMessage(error: unknown, needle: string, depth = 0): boolean {
  if (depth > 5 || error === null || typeof error !== 'object') {
    return false;
  }
  const record = error as { message?: unknown; cause?: unknown };
  if (typeof record.message === 'string' && record.message.includes(needle)) {
    return true;
  }
  return includesServerMessage(record.cause, needle, depth + 1);
}

/**
 * True when a caught submit_for_consent failure is the media-validation gate
 * rejection (fail-closed under enforcement), as opposed to network, auth, text
 * moderation, or ownership errors.
 */
export function isPitchMediaValidationGateRejection(error: unknown): boolean {
  return includesServerMessage(error, MEDIA_VALIDATION_GATE_MESSAGE);
}

const RELATIONSHIP_TYPE_MAP: Record<RelationshipKind, ServerRelationshipType> = {
  Friend: 'friend',
  Coworker: 'coworker',
  Family: 'family',
  Roommate: 'roommate',
  Other: 'other',
};

const RELATIONSHIP_DURATION_MAP: Record<RelationshipDuration, ServerRelationshipDuration> = {
  'Less than 1 year': 'lt1y',
  '1–3 years': 'y1to3',
  '3–10 years': 'y3to10',
  '10+ years': 'gt10y',
};

const MOBILE_RELATIONSHIP_TYPE: Record<ServerRelationshipType, RelationshipKind> = {
  friend: 'Friend',
  coworker: 'Coworker',
  family: 'Family',
  roommate: 'Roommate',
  other: 'Other',
};

const MOBILE_RELATIONSHIP_DURATION: Record<ServerRelationshipDuration, RelationshipDuration> = {
  lt1y: 'Less than 1 year',
  y1to3: '1–3 years',
  y3to10: '3–10 years',
  gt10y: '10+ years',
};

/**
 * How long the server refresh may hold up {@link HybridPitchDraftService.getMyDrafts}.
 * Local storage already holds every draft the introducer needs to act on —
 * including the raw consent token behind the approval link — so a stalled
 * PostgREST call must degrade to that local truth instead of blocking a screen.
 */
export const SERVER_REFRESH_TIMEOUT_MS = 8_000;

/**
 * PostgREST returns `timestamptz` as an offset instant with microsecond
 * precision ("2026-07-29T10:39:45.3091+00:00"). The local draft schema accepts
 * only UTC "Z" instants, and `syncServerReview` compares timestamps
 * lexicographically, which is sound only on that canonical form. An unparseable
 * value is passed through so the schema reports it rather than this masking it.
 */
function toIsoInstant(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

export class HybridPitchDraftService implements PitchDraftService {
  constructor(
    private readonly client: BrowserSupabaseClient | null,
    private readonly local = new MockPitchDraftService(),
    private readonly repo: PitchDraftRepository | null = client === null
      ? null
      : new PitchDraftRepo(client),
    private readonly refreshTimeoutMs = SERVER_REFRESH_TIMEOUT_MS,
    private readonly validateMedia: (
      objectName: string,
    ) => Promise<MediaValidationOutcome> = requestMediaValidation,
  ) {}

  createDraft(): Promise<PitchDraft> {
    return this.local.createDraft();
  }

  saveRelationship(id: PitchDraftId, value: PitchRelationship): Promise<PitchDraft> {
    return this.local.saveRelationship(id, value);
  }

  savePhotos(id: PitchDraftId, value: readonly PitchPhoto[]): Promise<PitchDraft> {
    return this.local.savePhotos(id, value);
  }

  saveRecording(id: PitchDraftId, value: PitchRecording): Promise<PitchDraft> {
    return this.local.saveRecording(id, value);
  }

  purgeInvitationContact(id: PitchDraftId): Promise<PitchDraft> {
    return this.local.purgeInvitationContact(id);
  }

  purgeSensitiveDraftData(id: PitchDraftId, scope: PurgeScope): Promise<PitchDraft> {
    return this.local.purgeSensitiveDraftData(id, scope);
  }

  purgeAllConsentTokens(): Promise<number> {
    return this.local.purgeAllConsentTokens();
  }

  /**
   * Local drafts are the answer; the server pass only enriches them. It is
   * therefore both time-bounded and non-fatal: a stalled, unauthenticated or
   * failing refresh returns the local list rather than rejecting, so a caller
   * that owns a consent token can always render it. Only a local storage
   * failure (read before the refresh) still rejects.
   */
  async getMyDrafts(): Promise<readonly PitchDraft[]> {
    const localDrafts = await this.local.getMyDrafts();
    const repo = this.repo;
    if (repo === null) {
      return localDrafts;
    }
    try {
      return await settleWithin(
        this.refreshFromServer(repo, localDrafts),
        this.refreshTimeoutMs,
        () => localDrafts,
      );
    } catch (error: unknown) {
      if (!(error instanceof UnauthenticatedError)) {
        console.warn(
          'Pitch draft server refresh failed; showing the drafts saved on this device:',
          error instanceof Error ? error.message : 'Unknown refresh error.',
        );
      }
      return localDrafts;
    }
  }

  private async refreshFromServer(
    repo: PitchDraftRepository,
    localDrafts: readonly PitchDraft[],
  ): Promise<readonly PitchDraft[]> {
    const [visibleServerDrafts, requests, currentUserId] = await Promise.all([
      repo.listMyDrafts(),
      repo.listMyConsentRequests(),
      this.getCurrentUserId(),
    ]);
    const serverDrafts =
      currentUserId === null
        ? visibleServerDrafts
        : visibleServerDrafts.filter((row) => row.created_by_user_id === currentUserId);
    for (const draft of localDrafts) {
      const serverDraft = serverDrafts.find((row) => row.id === draft.server?.draftId);
      if (serverDraft === undefined) {
        continue;
      }
      const request = requests.find((row) => row.pitch_draft_id === serverDraft.id);
      await this.local.syncServerReview(draft.id, {
        status: serverDraft.status,
        review: reviewFromServer(serverDraft, draft.review, request),
        updatedAt: toIsoInstant(serverDraft.updated_at),
      });
    }
    const knownServerIds = new Set(
      localDrafts.flatMap((draft) => (draft.server === null ? [] : [draft.server.draftId])),
    );
    for (const serverDraft of serverDrafts) {
      if (knownServerIds.has(serverDraft.id)) {
        continue;
      }
      const request = requests.find((row) => row.pitch_draft_id === serverDraft.id);
      await this.local.restoreServerDraft(recoverServerDraft(serverDraft, request));
    }
    return this.local.getMyDrafts();
  }

  /**
   * Creates the server draft record ONLY — no voice or photo bytes are
   * uploaded and nothing is sent to `/api/media/validate` here. Third audit
   * P0-NEW-2: media upload and external-AI validation must run *after* the
   * AI-processing consent is on record, so that work is deferred to
   * {@link uploadDraftMedia}. The local completeness/status guards still run.
   */
  async prepareForReview(id: PitchDraftId): Promise<PitchDraft> {
    const draft = await this.local.prepareForReview(id);
    if (this.repo === null || draft.server !== null) {
      return draft;
    }
    if (draft.relationship?.contact.kind !== 'email') {
      throw new PitchDraftSubmissionError('Enter a valid email before continuing.');
    }
    if (draft.recording === null) {
      throw new PitchDraftSubmissionError('Record a voice track before continuing.');
    }
    try {
      const serverDraft = await this.repo.createDraft(toDraftInputs(draft.relationship));
      return this.local.attachServerDraft(id, serverDraft.id);
    } catch (error: unknown) {
      if (error instanceof UnauthenticatedError) {
        throw new NeedsSignInError();
      }
      throw error;
    }
  }

  /**
   * Uploads the voice track and photos for an already-created server draft and
   * asks the server to validate each object. Callers must only reach this after
   * recording AI-processing consent (or deliberately choosing the manual path,
   * where the server does a structure-only check). Local-only drafts keep their
   * media on the device and no-op here.
   *
   * Every step is recorded per asset as it lands, so a retry after a partial
   * failure resumes instead of re-sending bytes to an upsert:false object or
   * re-registering a pitch_assets row. A validation that could not run leaves
   * the asset un-validated, which is what brings the next call back here to run
   * it again — the server contract is unchanged, `unavailable` is never treated
   * as a pass.
   */
  async uploadDraftMedia(id: PitchDraftId): Promise<PitchDraft> {
    const draft = await findDraft(this.local, id);
    const repo = this.repo;
    if (repo === null || draft.server === null) {
      return draft;
    }
    const plans = planDraftMedia(draft);
    if (plans.every((plan) => plan.record?.validated === true)) {
      return draft;
    }
    if (draft.recording === null) {
      throw new PitchDraftSubmissionError('Record a voice track before continuing.');
    }
    const serverDraftId = draft.server.draftId;
    let recording = draft.recording;
    let photos = [...draft.photos];
    let unvalidated = 0;
    try {
      for (const plan of plans) {
        const persist = async (record: UploadedAsset): Promise<void> => {
          if (plan.kind === 'voice') {
            recording = { ...recording, upload: record };
            await this.local.saveRecording(id, recording);
            return;
          }
          photos = photos.map((photo, index) =>
            index === plan.index ? { ...photo, upload: record } : photo,
          );
          await this.local.savePhotos(id, photos);
        };
        if ((await this.syncAsset(repo, serverDraftId, plan, persist)) !== 'passed') {
          unvalidated += 1;
        }
      }
      if (unvalidated > 0) {
        console.warn(
          `Media validation did not complete for ${unvalidated} of ${plans.length} pitch assets; it will run again on the next attempt.`,
        );
      }
      // Every asset's bytes are on the server now, which is what the local
      // media purge keys off. Validation state stays per asset.
      return draft.server.mediaUploaded
        ? findDraft(this.local, id)
        : this.local.markDraftMediaUploaded(id);
    } catch (error: unknown) {
      if (error instanceof UnauthenticatedError) {
        throw new NeedsSignInError();
      }
      throw error;
    }
  }

  async loadGeneratedReview(id: PitchDraftId): Promise<PitchDraft> {
    const draft = await findDraft(this.local, id);
    if (this.repo === null || draft.server === null) {
      return draft;
    }
    const serverDraft = await this.repo.getDraft(draft.server.draftId);
    const review = reviewFromServer(serverDraft, draft.review, undefined);
    if (review.headline.trim() === '' || review.body.trim() === '') {
      throw new PitchDraftSubmissionError('The AI draft was empty. Please try again.');
    }
    return this.local.saveReview(id, { ...review, generationMode: 'generated' });
  }

  async saveReview(id: PitchDraftId, review: PitchReview): Promise<PitchDraft> {
    const parsed = PitchReviewSchema.parse(review);
    const draft = await findDraft(this.local, id);
    if (this.repo !== null && draft.server !== null) {
      await this.repo.updateDraft(draft.server.draftId, {
        headline: parsed.headline.trim(),
        body: parsed.body.trim(),
        structure: parsed.structure,
      });
    }
    return this.local.saveReview(id, parsed);
  }

  async finalizeConsent(id: PitchDraftId): Promise<PitchDraft> {
    if (this.repo === null) {
      return this.local.finalizeConsent(id);
    }
    // Validation that could not run during the upload gets its retry here, on
    // the submit that the DB gate would otherwise fail closed. Guarded on media
    // that is already stored, so submitting never becomes the step that first
    // sends bytes — that stays behind the consent ordering in preparePitchReview.
    const current = await findDraft(this.local, id);
    const draft = hasPendingMediaValidation(current) ? await this.uploadDraftMedia(id) : current;
    if (draft.server === null) {
      throw new PitchDraftSubmissionError('Prepare this pitch before sending.');
    }
    await this.repo.updateDraft(draft.server.draftId, {
      headline: draft.review.headline.trim(),
      body: draft.review.body.trim(),
      structure: draft.review.structure,
    });
    // Text moderation happens on the saved server copy so edited drafts are
    // covered. 'flagged' blocks honestly; 'unavailable' defers to the DB
    // gate, which fails closed while media_validation_enforcement is on.
    const textVerdict = await requestPitchTextModeration(draft.server.draftId);
    if (textVerdict === 'flagged') {
      throw new PitchDraftSubmissionError(
        'This pitch text did not pass moderation. Edit the wording and try again.',
      );
    }
    const invitation = invitationForFinalize(draft);
    try {
      const submission = await this.repo.submitForConsent(draft.server.draftId, invitation);
      if (draft.server.consentRequestId === null && submission.consentToken === null) {
        throw new PitchDraftSubmissionError('The approval invite was not created. Please retry.');
      }
      return this.local.attachFinalizedConsent(id, submission);
    } catch (error: unknown) {
      if (error instanceof UnauthenticatedError) {
        throw new NeedsSignInError();
      }
      // A manual (no-AI) draft's voice is never transcribed/moderated, so the
      // 0016 gate fails its submission closed while enforcement is on. Map that
      // one server rejection to an honest product prompt; other failures keep
      // their existing generic surfacing. An AI-reviewed draft that hits the
      // same gate has a different cause — a verdict that never got recorded —
      // and telling its author they wrote it themselves would be wrong.
      if (isPitchMediaValidationGateRejection(error)) {
        throw draft.review.generationMode === 'generated'
          ? new PitchDraftSubmissionError(MEDIA_VALIDATION_INCOMPLETE_MESSAGE)
          : new ManualPitchNeedsAiReviewError();
      }
      throw error;
    }
  }

  /**
   * Brings one asset up to date — upload, register, validate — skipping
   * whatever a previous attempt already completed and persisting each step
   * before the next one runs. Returns the validation outcome; `rejected`
   * throws, because the introducer has to replace that file.
   */
  private async syncAsset(
    repo: PitchDraftRepository,
    draftId: string,
    plan: MediaAssetPlan,
    persist: (record: UploadedAsset) => Promise<void>,
  ): Promise<MediaValidationOutcome> {
    let record = plan.record;
    if (record === null) {
      await this.uploadAssetBytes(repo, draftId, plan);
      record = { objectName: plan.objectName, registered: false, validated: false };
      await persist(record);
    }
    if (!record.registered) {
      await repo.registerAsset(draftId, plan.kind, record.objectName, plan.index);
      record = { ...record, registered: true };
      await persist(record);
    }
    if (record.validated) {
      return 'passed';
    }
    const outcome = await this.validateMedia(`${draftId}/${record.objectName}`);
    if (outcome === 'rejected') {
      throw new PitchDraftSubmissionError(
        `${plan.label} is not a file we can publish. Pick a different one.`,
      );
    }
    if (outcome === 'passed') {
      await persist({ ...record, validated: true });
    }
    return outcome;
  }

  private async uploadAssetBytes(
    repo: PitchDraftRepository,
    draftId: string,
    plan: MediaAssetPlan,
  ): Promise<void> {
    const upload = await repo.requestAssetUpload(draftId, plan.objectName);
    const status = await putLocalFile(upload.signedUrl, plan.sourceUri, {
      'Content-Type': plan.contentType,
      'x-upsert': 'false',
    });
    if (status >= 200 && status < 300) {
      return;
    }
    // 409 from an upsert:false signed URL means an object already sits at this
    // path. Only this draft's creator can write there, so those bytes are an
    // earlier attempt of this same upload that crashed before it was recorded;
    // the server re-reads and re-moderates whatever is actually stored.
    if (status !== 409) {
      throw new PitchDraftSubmissionError(`Upload of ${plan.label} failed (${status}).`);
    }
  }

  private async getCurrentUserId(): Promise<string | null> {
    if (this.client === null) {
      return null;
    }
    const { data, error } = await this.client.auth.getSession();
    if (error !== null) {
      throw error;
    }
    return data.session?.user.id ?? null;
  }
}

/** The voice object name is fixed: /api/transcribe reads `{draftId}/voice.m4a`. */
const VOICE_OBJECT_NAME = 'voice.m4a';

export type MediaAssetPlan = {
  readonly kind: 'voice' | 'photo';
  /** Photo position, also its pitch_assets sort_order. Always 0 for the voice. */
  readonly index: number;
  /** How this asset is named to the introducer when something goes wrong. */
  readonly label: string;
  readonly sourceUri: string;
  readonly contentType: string;
  readonly objectName: string;
  readonly record: UploadedAsset | null;
};

/**
 * Drafts uploaded before per-asset records existed only carry the single
 * `mediaUploaded` flag, so their bytes are on the server under the old
 * always-`.jpg` names. Rebuild that much rather than re-uploading (which the
 * upsert:false URL refuses) or re-registering (which duplicates rows); the
 * validation verdict was never persisted, so it runs again.
 */
function legacyRecord(objectName: string): UploadedAsset {
  return { objectName, registered: true, validated: false };
}

/**
 * What `uploadDraftMedia` has to do for each of a draft's assets, given what
 * previous attempts already completed.
 */
export function planDraftMedia(draft: PitchDraft): readonly MediaAssetPlan[] {
  const uploadedBeforeRecords = draft.server?.mediaUploaded === true;
  const plans: MediaAssetPlan[] = [];
  if (draft.recording !== null) {
    plans.push({
      kind: 'voice',
      index: 0,
      label: 'Your recording',
      sourceUri: draft.recording.uri,
      contentType: 'audio/mp4',
      objectName: VOICE_OBJECT_NAME,
      record:
        draft.recording.upload ?? (uploadedBeforeRecords ? legacyRecord(VOICE_OBJECT_NAME) : null),
    });
  }
  draft.photos.forEach((photo, index) => {
    plans.push({
      kind: 'photo',
      index,
      label: `Photo ${index + 1}`,
      sourceUri: photo.uri,
      contentType: photoMimeType(photo),
      objectName: photoObjectName(photo, index),
      record:
        photo.upload ?? (uploadedBeforeRecords ? legacyRecord(`photo-${index + 1}.jpg`) : null),
    });
  });
  return plans;
}

/**
 * True when every asset's bytes are already on the server but at least one has
 * no `passed` verdict — the state a submit can resolve by asking the validator
 * again, as opposed to one that still needs an upload.
 */
export function hasPendingMediaValidation(draft: PitchDraft): boolean {
  const plans = planDraftMedia(draft);
  return (
    plans.length > 0 &&
    plans.every((plan) => plan.record !== null) &&
    plans.some((plan) => plan.record?.validated === false)
  );
}

function toDraftInputs(relationship: PitchRelationship | null): DraftInputs {
  if (relationship === null) {
    throw new PitchDraftSubmissionError('Add your friend details before continuing.');
  }
  return {
    relationshipType: RELATIONSHIP_TYPE_MAP[relationship.kind],
    relationshipDuration: RELATIONSHIP_DURATION_MAP[relationship.duration],
  };
}

function invitationForFinalize(draft: PitchDraft) {
  const relationship = draft.relationship;
  if (relationship?.contact.kind !== 'email') {
    return undefined;
  }
  return {
    channel: 'email' as const,
    contact: relationship.contact.value,
    friendName: relationship.friendFirstName,
  };
}

async function findDraft(local: MockPitchDraftService, id: PitchDraftId): Promise<PitchDraft> {
  const draft = (await local.getMyDrafts()).find((candidate) => candidate.id === id);
  if (draft === undefined) {
    throw new PitchDraftSubmissionError('This pitch could not be found.');
  }
  return draft;
}

function reviewFromServer(
  row: PitchDraftRow,
  fallback: PitchReview,
  request: ConsentRequestRow | undefined,
): PitchReview {
  const structure = PitchReviewSchema.shape.structure.safeParse(row.structure);
  const hasGeneratedCopy = (row.headline?.trim() ?? '') !== '' && (row.body?.trim() ?? '') !== '';
  return PitchReviewSchema.parse({
    headline: row.headline ?? fallback.headline,
    body: row.body ?? fallback.body,
    structure: structure.success ? structure.data : fallback.structure,
    generationMode:
      fallback.generationMode === 'pending' && hasGeneratedCopy
        ? 'generated'
        : fallback.generationMode,
    responseNote: request?.response_note ?? null,
  });
}

function recoverServerDraft(
  row: PitchDraftRow,
  request: ConsentRequestRow | undefined,
): PitchDraft {
  const relationship = recoverRelationship(row, request);
  const fallbackReview: PitchReview = {
    headline: '',
    body: '',
    structure: EMPTY_PITCH_STRUCTURE,
    generationMode: 'manual',
    responseNote: null,
  };
  return PitchDraftListSchema.element.parse({
    id: row.id,
    status: row.status,
    contextRole: 'INTRODUCER',
    relationship,
    photos: [],
    recording: null,
    review: reviewFromServer(row, fallbackReview, request),
    server: {
      draftId: row.id,
      consentRequestId: request?.id ?? null,
      consentToken: null,
      // Server-recovered drafts were already submitted, so their media lives on
      // the server; never re-upload it.
      mediaUploaded: true,
    },
    createdAt: toIsoInstant(row.created_at),
    updatedAt: toIsoInstant(row.updated_at),
  });
}

function recoverRelationship(
  row: PitchDraftRow,
  request: ConsentRequestRow | undefined,
): PitchRelationship | null {
  if (
    row.relationship_type === null ||
    row.relationship_duration === null ||
    request?.invite_friend_name === null ||
    request?.invite_friend_name === undefined
  ) {
    return null;
  }
  return {
    kind: MOBILE_RELATIONSHIP_TYPE[row.relationship_type],
    duration: MOBILE_RELATIONSHIP_DURATION[row.relationship_duration],
    friendFirstName: request.invite_friend_name,
    contact: { kind: 'sent' },
  };
}

export function isRecoveredServerDraft(draft: PitchDraft): boolean {
  return draft.server !== null && draft.id === draft.server.draftId;
}
