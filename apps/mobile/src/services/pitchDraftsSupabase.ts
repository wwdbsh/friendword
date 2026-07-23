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

import { putLocalFile } from './mediaFiles';
import { requestMediaValidation } from './mediaValidation';
import { requestPitchTextModeration } from './textModeration';
import {
  MockPitchDraftService,
  PitchDraftSubmissionError,
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

export class HybridPitchDraftService implements PitchDraftService {
  constructor(
    private readonly client: BrowserSupabaseClient | null,
    private readonly local = new MockPitchDraftService(),
    private readonly repo: PitchDraftRepository | null = client === null
      ? null
      : new PitchDraftRepo(client),
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

  async getMyDrafts(): Promise<readonly PitchDraft[]> {
    const localDrafts = await this.local.getMyDrafts();
    if (this.repo === null) {
      return localDrafts;
    }
    try {
      const [visibleServerDrafts, requests, currentUserId] = await Promise.all([
        this.repo.listMyDrafts(),
        this.repo.listMyConsentRequests(),
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
          updatedAt: serverDraft.updated_at,
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
    } catch (error: unknown) {
      if (error instanceof UnauthenticatedError) {
        return localDrafts;
      }
      throw error;
    }
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
   */
  async uploadDraftMedia(id: PitchDraftId): Promise<PitchDraft> {
    const draft = await findDraft(this.local, id);
    if (this.repo === null || draft.server === null) {
      return draft;
    }
    // Idempotent: the signed upload URL is created with upsert:false and
    // registerAsset inserts a row, so a second pass (e.g. retrying after a
    // transient transcribe failure) must not re-upload.
    if (draft.server.mediaUploaded) {
      return draft;
    }
    if (draft.recording === null) {
      throw new PitchDraftSubmissionError('Record a voice track before continuing.');
    }
    const serverDraftId = draft.server.draftId;
    try {
      await this.uploadFile(
        this.repo,
        serverDraftId,
        'voice.m4a',
        draft.recording.uri,
        'audio/mp4',
      );
      await this.repo.registerAsset(serverDraftId, 'voice', 'voice.m4a');
      for (const [index, photo] of draft.photos.entries()) {
        const fileName = `photo-${index + 1}.jpg`;
        await this.uploadFile(this.repo, serverDraftId, fileName, photo.uri, 'image/jpeg');
        await this.repo.registerAsset(serverDraftId, 'photo', fileName, index);
      }
      return this.local.markDraftMediaUploaded(id);
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
    const draft = await findDraft(this.local, id);
    if (this.repo === null) {
      return this.local.finalizeConsent(id);
    }
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
      // their existing generic surfacing.
      if (isPitchMediaValidationGateRejection(error)) {
        throw new ManualPitchNeedsAiReviewError();
      }
      throw error;
    }
  }

  private async uploadFile(
    repo: PitchDraftRepository,
    draftId: string,
    fileName: string,
    uri: string,
    contentType: string,
  ): Promise<void> {
    const upload = await repo.requestAssetUpload(draftId, fileName);
    const status = await putLocalFile(upload.signedUrl, uri, {
      'Content-Type': contentType,
      'x-upsert': 'false',
    });
    if (status < 200 || status >= 300) {
      throw new PitchDraftSubmissionError(`Upload of ${fileName} failed (${status}).`);
    }
    const verdict = await requestMediaValidation(`${draftId}/${fileName}`);
    if (verdict === 'rejected') {
      throw new PitchDraftSubmissionError(
        `${fileName} is not a supported photo or audio file. Pick a different one.`,
      );
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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
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
