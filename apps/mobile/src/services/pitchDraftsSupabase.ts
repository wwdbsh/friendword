import {
  buildPitchMediaPath,
  PitchDraftRepo,
  UnauthenticatedError,
  type AssetDimensions,
  type BrowserSupabaseClient,
  type ConsentRequestRow,
  type ConsentSubmission,
  type PitchAssetRow,
  type PitchDraftRow,
} from '@friendword/data';
import {
  buildPitchSceneV2,
  type DraftInputs,
  type PitchSceneV2,
  type RelationshipDuration as ServerRelationshipDuration,
  type RelationshipType as ServerRelationshipType,
} from '@friendword/contracts';

import { clipObjectName, photoMimeType, photoObjectName, putLocalFile } from './mediaFiles';
import { requestMediaValidation, type MediaValidationOutcome } from './mediaValidation';
import {
  mergeClipIngestStates,
  requestClipIngestStates,
  type ClipIngestReader,
} from './clipIngest';
import {
  PITCH_SCENE_TEMPLATE,
  pitchSceneRejectionMessage,
  reportPitchSceneDemotion,
  transcriptSegmentWindows,
  type PitchSceneBuilder,
  type PitchSceneDemotionReporter,
} from './pitchSceneInput';
import { requestPitchTextModeration } from './textModeration';
import {
  MockPitchDraftService,
  PitchDraftSubmissionError,
  settleWithin,
  type LocalDraftErasure,
  type PitchDraftListing,
  type PitchDraftService,
  type PurgeScope,
} from './pitchDrafts';
import {
  EMPTY_PITCH_STRUCTURE,
  PitchDraftListSchema,
  PitchReviewSchema,
  DEFAULT_CLIP_MAX_BYTES,
  type PitchClip,
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

/**
 * The `pitch_assets.asset_type` values this app registers, pinned to the closed
 * set 0050 put a CHECK constraint on: `voice`, `photo`, `video`. The introducer's
 * short clips register as `video` — the draft model calls them clips, the column
 * does not, and this is the one place the two names meet.
 */
export type PitchAssetKind = 'voice' | 'photo' | 'video';

export type PitchDraftRepository = Omit<
  Pick<
    PitchDraftRepo,
    | 'createDraft'
    | 'getDraft'
    | 'listAssets'
    | 'listMyConsentRequests'
    | 'listMyDrafts'
    | 'registerAsset'
    | 'removeAsset'
    | 'requestAssetUpload'
    | 'submitForConsent'
    | 'updateDraft'
  >,
  'registerAsset'
> & {
  /**
   * Widened from the data layer's `'voice' | 'photo'` so a clip can be
   * registered as `video`. Method syntax on purpose: TypeScript checks method
   * parameters bivariantly, so the narrower `PitchDraftRepo` still satisfies
   * this. The data layer's own signature is what has to catch up (owned by the
   * web worker); until it does, this seam is where the mobile side declares what
   * it actually sends, rather than casting at the call site.
   */
  registerAsset(
    draftId: string,
    assetType: PitchAssetKind,
    fileName: string,
    sortOrder?: number,
    dimensions?: AssetDimensions,
  ): Promise<PitchAssetRow>;
};

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
 * Stable substrings of the three server refusals a clip can produce (0050). All
 * of them are raised by triggers, so they hold on every write path and their
 * text is owned by the migration — matched on a substring for that reason.
 */
const CLIP_ENTITLEMENT_MESSAGE = 'requires a Campaign Pass';
const CLIP_CEILING_MESSAGE = 'at most 3 video clips';
const FLAGGED_CLIP_GATE_MESSAGE = 'remove the flagged video clip before requesting consent';

/**
 * Copy for the entitlement refusal. Honest about the shape of the limit: the
 * server allows one clip per draft unless the pitch's campaign holds a Campaign
 * Pass, and a campaign only exists after publish — so on today's flow a first
 * pitch gets one clip. The rest of the pitch is intact, which is the part the
 * introducer needs to hear.
 */
export const CLIP_NEEDS_CAMPAIGN_PASS_MESSAGE =
  'Friendword includes one video per pitch; more than that needs a Campaign Pass. ' +
  'This video was not attached — everything else on your pitch was saved.';

export const CLIP_CEILING_REACHED_MESSAGE =
  'A pitch can carry at most three videos, so this one was not attached. ' +
  'Everything else on your pitch was saved.';

/**
 * Copy for the one server gate a flagged clip creates: the draft cannot enter
 * consent review while it carries a clip frame moderation refused (0050
 * `reject_flagged_video_on_consent`). Says what is true — the pitch is blocked,
 * a person reviews the flag — and does not promise a removal this app cannot do.
 */
export const FLAGGED_CLIP_BLOCKS_SUBMIT_MESSAGE =
  'One of your videos did not pass Friendword’s automated safety checks, so this pitch cannot be ' +
  'sent while it is attached. Someone reviews every flag; if they clear it, the checks run again ' +
  'and you can send the pitch then.';

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
 * Copy for the one media state a submit cannot resolve on its own: a photo the
 * introducer removed is still attached to the pitch on the server and could not
 * be detached. Retryable — the usual cause is the network — so it does not send
 * anyone back to the start.
 */
export const STALE_PITCH_ASSETS_MESSAGE =
  'A photo you removed is still attached to this pitch, and we could not take it off. ' +
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

/**
 * The introducer-facing message for a clip registration the server refused on a
 * count, or null when the failure is something else (network, auth, ownership).
 * Only these two are treated as "this clip cannot be attached": everything else
 * has to keep propagating, because a clip silently dropped on a network error
 * would leave the introducer thinking they sent a video they did not.
 */
export function clipRegistrationRefusalMessage(error: unknown): string | null {
  if (includesServerMessage(error, CLIP_ENTITLEMENT_MESSAGE)) {
    return CLIP_NEEDS_CAMPAIGN_PASS_MESSAGE;
  }
  return includesServerMessage(error, CLIP_CEILING_MESSAGE) ? CLIP_CEILING_REACHED_MESSAGE : null;
}

/** True when the submit failed because a flagged clip is still attached (0050). */
export function isFlaggedClipSubmitRejection(error: unknown): boolean {
  return includesServerMessage(error, FLAGGED_CLIP_GATE_MESSAGE);
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
 * Marks a server refresh the caller has stopped waiting for. `settleWithin`
 * cannot cancel the underlying request, so this is what stops its side effects.
 */
type RefreshLifetime = { superseded: boolean };

/**
 * How long the server refresh may hold up {@link HybridPitchDraftService.listMyDrafts}.
 * Local storage already holds every draft the introducer needs to act on —
 * including the raw consent token behind the approval link — so a stalled
 * PostgREST call must degrade to that local truth instead of blocking a screen.
 */
export const SERVER_REFRESH_TIMEOUT_MS = 8_000;

const SERVER_TIMESTAMP =
  /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|z|[+-]\d{2}(?::?\d{2})?)?$/;

/**
 * PostgREST returns `timestamptz` as an offset instant with microsecond
 * precision ("2026-07-29T10:39:45.3091+00:00"). The local draft schema accepts
 * only UTC "Z" instants, and `syncServerReview` compares timestamps
 * lexicographically, which is sound only on that canonical form. An unparseable
 * value is passed through so the schema reports it rather than this masking it.
 *
 * The shape is decomposed rather than handed straight to `new Date`, because
 * that constructor reads an offsetless timestamp (a `timestamp` column, or a
 * computed RPC field) in the *device* zone and would silently move the instant
 * by the device's UTC offset. Sub-second digits are normalized to exactly three
 * here so both sides of the lexicographic comparison have the same width as the
 * `new Date().toISOString()` stamps local drafts carry; a wider server value
 * would otherwise sort below an equal local one on the trailing "Z".
 */
export function toIsoInstant(value: string): string {
  const match = SERVER_TIMESTAMP.exec(value.trim());
  if (match === null) {
    return value;
  }
  const [, date, time, fraction, offset] = match;
  const millis = (fraction ?? '').padEnd(3, '0').slice(0, 3);
  const parsed = new Date(`${date}T${time}.${millis}${toUtcOffset(offset)}`);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

/** Normalizes the offset spellings Postgres emits ("+09", "+0900", none) to "±HH:MM". */
function toUtcOffset(offset: string | undefined): string {
  if (offset === undefined || offset.toUpperCase() === 'Z') {
    return 'Z';
  }
  const digits = offset.slice(1).replace(':', '');
  return `${offset.slice(0, 1)}${digits.slice(0, 2)}:${digits.slice(2).padEnd(2, '0')}`;
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
    private readonly buildScene: PitchSceneBuilder = buildPitchSceneV2,
    private readonly reportSceneDemotion: PitchSceneDemotionReporter = reportPitchSceneDemotion,
    private readonly readClipIngest: ClipIngestReader = requestClipIngestStates,
    private readonly clipMaxBytes: () => Promise<number> = resolveClipMaxBytes,
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

  saveClips(id: PitchDraftId, value: readonly PitchClip[]): Promise<PitchDraft> {
    return this.local.saveClips(id, value);
  }

  /**
   * Asks the server where this draft's uploaded clips stand and writes the answer
   * into the local mirror.
   *
   * Only uploaded clips are asked about — a clip that has never been sent has no
   * job — and a clip the server says nothing about keeps whatever state it had:
   * an unreachable server must not be able to reset a `flagged` verdict to
   * `pending`. Never throws for an unavailable server; the caller's poll phase is
   * what says "not confirmed yet".
   */
  async refreshClipIngest(id: PitchDraftId): Promise<PitchDraft> {
    const draft = await findDraft(this.local, id);
    if (draft.server === null) {
      return draft;
    }
    const objectNames = draft.clips.flatMap((clip) =>
      clip.upload === undefined ? [] : [clip.upload.objectName],
    );
    if (objectNames.length === 0) {
      return draft;
    }
    const observed = await this.readClipIngest({
      draftId: draft.server.draftId,
      objectNames,
    });
    if (mergeClipIngestStates(draft.clips, observed) === draft.clips) {
      return draft;
    }
    return this.local.saveClipIngestStates(id, observed);
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

  eraseAllLocalDrafts(): Promise<LocalDraftErasure> {
    return this.local.eraseAllLocalDrafts();
  }

  /**
   * Local drafts are the answer; the server pass only enriches them. It is
   * therefore both time-bounded and non-fatal: a stalled, unauthenticated or
   * failing refresh returns the local list rather than rejecting, so a caller
   * that owns a consent token can always render it. The returned
   * `sync` state is how the caller tells a list the server confirmed
   * from one this device produced alone — without it the fallback would hide a
   * permanently broken sync behind a normal-looking screen. Only a local
   * storage failure (read before the refresh) still rejects.
   */
  async listMyDrafts(): Promise<PitchDraftListing> {
    const localDrafts = await this.local.getMyDrafts();
    const repo = this.repo;
    if (repo === null) {
      return { drafts: localDrafts, sync: 'signed_out' };
    }
    const refresh: RefreshLifetime = { superseded: false };
    try {
      return await settleWithin(
        this.refreshFromServer(repo, localDrafts, refresh),
        this.refreshTimeoutMs,
        () => {
          refresh.superseded = true;
          return { drafts: localDrafts, sync: 'unconfirmed' };
        },
      );
    } catch (error: unknown) {
      refresh.superseded = true;
      if (error instanceof UnauthenticatedError) {
        return { drafts: localDrafts, sync: 'signed_out' };
      }
      console.warn(
        'Pitch draft server refresh failed; showing the drafts saved on this device:',
        error instanceof Error ? error.message : 'Unknown refresh error.',
      );
      return { drafts: localDrafts, sync: 'unconfirmed' };
    }
  }

  /**
   * The refresh cannot be cancelled, so every local write it performs is gated
   * on `refresh` still being live. Once the caller has taken the fallback list
   * it has already acted on it — the share screen publishes the invite and
   * purges the raw contact — and a late write interleaving with that has no
   * defined order. Abandoning the refresh makes the outcome deterministic: the
   * next read runs it again.
   */
  private async refreshFromServer(
    repo: PitchDraftRepository,
    localDrafts: readonly PitchDraft[],
    refresh: RefreshLifetime,
  ): Promise<PitchDraftListing> {
    const abandoned: PitchDraftListing = { drafts: localDrafts, sync: 'unconfirmed' };
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
      if (refresh.superseded) {
        return abandoned;
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
      if (refresh.superseded) {
        return abandoned;
      }
      const request = requests.find((row) => row.pitch_draft_id === serverDraft.id);
      await this.local.restoreServerDraft(recoverServerDraft(serverDraft, request));
    }
    if (refresh.superseded) {
      return abandoned;
    }
    return { drafts: await this.local.getMyDrafts(), sync: 'confirmed' };
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
   *
   * Registration happens here rather than at submit because a pitch_assets row
   * is the only thing that marks an uploaded object as in use:
   * `scripts/cleanup-orphan-media.mjs` deletes any pitch-media object older than
   * 48h that no pitch_assets row names and whose draft has no consent revision.
   * A draft uploaded but not yet sent for approval has neither, so deferring
   * registration would let the routine sweep (docs/OPS.md) delete the
   * introducer's voice track and photos while the local draft still claims they
   * are stored and validated.
   */
  async uploadDraftMedia(id: PitchDraftId): Promise<PitchDraft> {
    const draft = await findDraft(this.local, id);
    const repo = this.repo;
    if (repo === null || draft.server === null) {
      return draft;
    }
    const plans = planDraftMedia(draft);
    if (plans.every(isAssetSyncSettled)) {
      return draft;
    }
    if (draft.recording === null) {
      throw new PitchDraftSubmissionError('Record a voice track before continuing.');
    }
    const serverDraftId = draft.server.draftId;
    let recording = draft.recording;
    let photos = [...draft.photos];
    let clips = [...draft.clips];
    let unvalidated = 0;
    try {
      for (const plan of plans) {
        const persist = async (record: UploadedAsset): Promise<void> => {
          if (plan.kind === 'voice') {
            recording = { ...recording, upload: record };
            await this.local.saveRecording(id, recording);
            return;
          }
          if (plan.kind === 'video') {
            clips = clips.map((clip, index) =>
              // `pending` from the moment the bytes are stored: the ingest job
              // exists from then on, and a clip with an upload record but no
              // state would read as "nothing is happening to this video".
              index === plan.index
                ? { ...clip, upload: record, ingest: clip.ingest ?? 'pending' }
                : clip,
            );
            await this.local.saveClips(id, clips);
            return;
          }
          photos = photos.map((photo, index) =>
            index === plan.index ? { ...photo, upload: record } : photo,
          );
          await this.local.savePhotos(id, photos);
        };
        const outcome = await this.syncAssetOrDropRefusedClip(
          repo,
          id,
          serverDraftId,
          plan,
          persist,
        );
        if (outcome !== 'passed' && outcome !== 'ingest_pending') {
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
    const savedDraft = await this.repo.updateDraft(draft.server.draftId, {
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
      await this.reconcileRegisteredAssets(this.repo, draft);
      // After the reconcile, so the scene can only reference photos the submit
      // will actually snapshot into the revision.
      const scene = await this.submissionScene(
        this.repo,
        draft.server.draftId,
        savedDraft.transcript,
      );
      const submission = await this.submitWithSceneFallback(
        this.repo,
        draft.server.draftId,
        invitation,
        scene,
      );
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
      // A clip frame moderation refused blocks the draft from entering consent
      // review at all (0050). Surfaced as its own message: nothing is wrong with
      // the pitch text, and the media-validation copy would send the introducer
      // to check their connection for a decision the network had no part in.
      if (isFlaggedClipSubmitRejection(error)) {
        throw new PitchDraftSubmissionError(FLAGGED_CLIP_BLOCKS_SUBMIT_MESSAGE);
      }
      throw error;
    }
  }

  /**
   * Submits the consent request, retrying once without the scene if the server
   * rejected the scene itself.
   *
   * A scene is an enhancement: the surfaces still play the pitch from the
   * transcript when a revision carries none. So a builder that disagrees with the
   * DB validator on one rule must not be able to block the introducer's submit —
   * the only thing that should be lost is the motion.
   *
   * Retrying is safe because the rejection happens before the RPC writes
   * anything: `submit_pitch_for_consent` calls `assert_scene_definition`
   * (0049:1159) ahead of the `consent_revisions` insert (0049:1183), the
   * `consent_requests` insert/update (0049:1214) and the draft status update
   * (0049:1250), and a `RAISE` in a plpgsql function aborts every effect of the
   * statement that called it. No revision, no request, no status change — so the
   * second call sees exactly the state the first one did.
   *
   * Only the pinned rejection messages trigger this. Network, auth, ownership and
   * media-gate failures rethrow, because sending the pitch without motion would
   * not fix any of them.
   *
   * One retry, never a loop: if the sceneless submit fails too, the cause is not
   * the scene.
   */
  private async submitWithSceneFallback(
    repo: PitchDraftRepository,
    serverDraftId: string,
    invitation: ReturnType<typeof invitationForFinalize>,
    scene: PitchSceneV2 | null,
  ): Promise<ConsentSubmission> {
    if (scene === null) {
      return repo.submitForConsent(serverDraftId, invitation, scene);
    }
    try {
      return await repo.submitForConsent(serverDraftId, invitation, scene);
    } catch (error: unknown) {
      const reason = pitchSceneRejectionMessage(error);
      if (reason === null) {
        throw error;
      }
      // The introducer is told nothing — their pitch was sent — so this report is
      // the only way a builder regression that silently strips motion from every
      // submit becomes visible.
      this.reportSceneDemotion({ draftId: serverDraftId, reason });
      return repo.submitForConsent(serverDraftId, invitation, null);
    }
  }

  /**
   * The PitchScene v2 to send with the consent request, or null when this pitch
   * cannot carry one.
   *
   * The introducer's submit is where the scene has to be built: it is the only
   * moment at which both the transcript and the final asset set are known, and a
   * dater who approves without editing never saves a revision of their own — so
   * without this their published page would have no motion at all.
   *
   * Null whenever the timeline cannot be derived (a manual pitch is never
   * transcribed, and a pitch can be submitted with no photos). The consent and
   * public surfaces then fall back to deriving windows at play time, which is
   * what they did before scenes existed.
   *
   * `listAssets` failures are not swallowed: they are the same class of failure
   * as the submit that follows, and the reconcile above already depends on that
   * read.
   *
   * The server still accepts v1 scenes, so reverting this to the v1 builder is a
   * safe rollback: only what this device writes changes.
   */
  private async submissionScene(
    repo: PitchDraftRepository,
    serverDraftId: string,
    transcript: PitchDraftRow['transcript'],
  ): Promise<PitchSceneV2 | null> {
    const segments = transcriptSegmentWindows(transcript);
    if (segments.length === 0) {
      return null;
    }
    // listAssets orders by sort_order, which is the photo order the introducer
    // arranged and the order the page plays them in.
    const photoAssetIds = (await repo.listAssets(serverDraftId))
      .filter((row) => row.asset_type === 'photo')
      .map((row) => row.id);
    if (photoAssetIds.length === 0) {
      return null;
    }
    return this.buildScene({ template: PITCH_SCENE_TEMPLATE, photoAssetIds, segments });
  }

  /**
   * Brings this draft's pitch_assets rows back in line with the photos the
   * introducer is actually looking at, before the submit snapshots them.
   *
   * `submit_pitch_for_consent` snapshots *every* pitch_assets row of the draft
   * into the consent revision (0013:198-206), so a row left over from a photo
   * the introducer removed would be sent to the dater and could be published.
   * Registration happens at upload time (it is what keeps the orphan sweep off
   * an in-flight draft), so those leftovers are expected and are detached here
   * through `remove_pitch_draft_asset` (0046). Only the row is deleted; the
   * bytes go to the 48h sweep, which is the only path that can actually reclaim
   * them.
   *
   * A leftover that is not a removable photo, or a removal the server refuses,
   * stops the submit: sending a pitch that carries a photo the introducer took
   * out is the failure this exists to prevent, so it fails closed rather than
   * proceeding.
   *
   * Scoped to rows this account registered and to drafts this device uploaded:
   * a server-recovered draft carries no local photos, and the dater's own
   * consent-time uploads (0032:84) are not the introducer's to reconcile.
   */
  private async reconcileRegisteredAssets(
    repo: PitchDraftRepository,
    draft: PitchDraft,
  ): Promise<void> {
    if (draft.server === null || hasNoAssetRecords(draft)) {
      return;
    }
    const userId = await this.getCurrentUserId();
    if (userId === null) {
      // No session to attribute rows to. Not a way past this check: the submit
      // that follows needs the same session and rejects without one.
      return;
    }
    const serverDraftId = draft.server.draftId;
    const expected = new Set(
      planDraftMedia(draft).map((plan) =>
        buildPitchMediaPath(serverDraftId, plan.record?.objectName ?? plan.objectName),
      ),
    );
    const orphaned = (await repo.listAssets(serverDraftId)).filter(
      (row) => row.uploaded_by_user_id === userId && !expected.has(row.storage_path),
    );
    if (orphaned.length === 0) {
      return;
    }
    // 0046 removes photos only, by design: the introducer's voice is a server
    // invariant. A stray voice row means the local draft lost its recording
    // rather than that a photo was removed, and detaching it is not the fix. A
    // stray clip row is the same class of problem — which is why dropping an
    // uploaded clip locally is refused (StoredClipRemovalError) instead of
    // producing one here.
    if (orphaned.some((row) => row.asset_type !== 'photo')) {
      throw new PitchDraftSubmissionError(STALE_PITCH_ASSETS_MESSAGE);
    }
    try {
      for (const row of orphaned) {
        await repo.removeAsset(row.id);
      }
    } catch (error: unknown) {
      if (error instanceof UnauthenticatedError) {
        throw error;
      }
      console.warn(
        'Could not detach a removed photo from this pitch; refusing to send it:',
        error instanceof Error ? error.message : 'Unknown removal error.',
      );
      throw new PitchDraftSubmissionError(STALE_PITCH_ASSETS_MESSAGE);
    }
  }

  /**
   * {@link syncAsset}, with the one failure that must not leave a pitch
   * permanently unsendable handled: the server refusing to register a clip on a
   * count (the entitlement, or the absolute ceiling of three).
   *
   * That clip's bytes are stored but no row names them, so the local draft is the
   * only thing still claiming the pitch has this video. Dropping it there is what
   * makes the next attempt succeed with the rest of the pitch; the object goes to
   * the 48h orphan sweep. The introducer is told why, and it is a raise rather
   * than a silent drop because a video vanishing from a pitch without a word is
   * exactly the kind of thing they would only find out after publishing.
   */
  private async syncAssetOrDropRefusedClip(
    repo: PitchDraftRepository,
    id: PitchDraftId,
    serverDraftId: string,
    plan: MediaAssetPlan,
    persist: (record: UploadedAsset) => Promise<void>,
  ): Promise<AssetSyncOutcome> {
    try {
      return await this.syncAsset(repo, serverDraftId, plan, persist);
    } catch (error: unknown) {
      const refusal = plan.kind === 'video' ? clipRegistrationRefusalMessage(error) : null;
      if (refusal === null) {
        throw error;
      }
      await this.local.dropUnregisteredClip(id, plan.objectName);
      throw new PitchDraftSubmissionError(refusal);
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
  ): Promise<AssetSyncOutcome> {
    let record = plan.record;
    if (record === null) {
      await this.uploadAssetBytes(repo, draftId, plan);
      record = { objectName: plan.objectName, registered: false, validated: false };
      await persist(record);
    }
    if (!record.registered) {
      await repo.registerAsset(
        draftId,
        plan.kind,
        record.objectName,
        plan.index,
        plan.dimensions ?? undefined,
      );
      record = { ...record, registered: true };
      await persist(record);
    }
    // A clip is never sent to `/api/media/validate`: that route's allowlist is
    // image and audio kinds, so it would refuse video bytes the server itself
    // accepts, and this call site turns a `rejected` into "pick a different
    // file". Video is judged by the ingest pipeline (probe → silent proxy →
    // poster → frame moderation) and its verdict reaches the app as an ingest
    // state. Nothing here may record `validated`, which would claim a check that
    // never ran.
    if (plan.kind === 'video') {
      return 'ingest_pending';
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
    // Last mirror of the server's byte ceiling. The picker already refused an
    // oversized clip, but a draft can outlive a lowered ceiling, and the upload
    // reads the whole file into memory — so this refuses before the read rather
    // than letting the phone allocate bytes the server will not accept.
    if (plan.byteSize !== null && plan.byteSize > (await this.clipMaxBytes())) {
      throw new PitchDraftSubmissionError(
        `${plan.label} is too large to upload. Trim it or export it smaller, then pick it again.`,
      );
    }
    const upload = await repo.requestAssetUpload(draftId, plan.objectName);
    const status = await putLocalFile(upload.signedUrl, plan.sourceUri, {
      'Content-Type': plan.contentType,
      'x-upsert': 'false',
    });
    if (status >= 200 && status < 300) {
      return;
    }
    // 409 from an upsert:false signed URL means an object already sits at this
    // path. For a photo the path carries the photo's own identity, so those
    // bytes are an earlier attempt of this same upload that crashed before it
    // was recorded. The voice path is fixed, so a 409 there can also be a
    // different take this device stored and then lost the record of; the guard
    // in {@link StoredVoiceReplacementError} only covers the case where that
    // record survived. Either way the server re-reads and re-moderates whatever
    // is actually stored, and the local draft may name a take the dater will
    // not hear.
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

/**
 * What one `syncAsset` call settled on. `ingest_pending` is a clip's stored-and
 * -registered state: not a pass, and not a failure the introducer can act on.
 */
type AssetSyncOutcome = MediaValidationOutcome | 'ingest_pending';

/** The voice object name is fixed: /api/transcribe reads `{draftId}/voice.m4a`. */
const VOICE_OBJECT_NAME = 'voice.m4a';

export type MediaAssetPlan = {
  readonly kind: PitchAssetKind;
  /** Photo/clip position, also its pitch_assets sort_order. Always 0 for the voice. */
  readonly index: number;
  /** How this asset is named to the introducer when something goes wrong. */
  readonly label: string;
  readonly sourceUri: string;
  readonly contentType: string;
  readonly objectName: string;
  readonly record: UploadedAsset | null;
  /**
   * Pixel size to record with the asset, so the render worker can letterbox a
   * photo without downloading it first. Null for the voice track, and for a
   * photo whose picker never reported a usable size — the columns are nullable
   * and CHECK `> 0`, so a missing measurement is left absent rather than faked.
   */
  readonly dimensions: AssetDimensions | null;
  /**
   * Measured byte size, for the assets that carry one (clips). Null where the
   * app never measured it — the voice track it recorded itself, and photos,
   * whose size the picker does not have to report.
   */
  readonly byteSize: number | null;
};

/**
 * The configured clip byte ceiling, or the built-in default when this runtime
 * cannot read app config (tests, web). Imported lazily: `expo-constants` pulls in
 * React Native, which must not be a static dependency of the draft service.
 */
async function resolveClipMaxBytes(): Promise<number> {
  try {
    const { getClipMaxBytes } = await import('./clipUploadLimits');
    return getClipMaxBytes();
  } catch {
    return DEFAULT_CLIP_MAX_BYTES;
  }
}

/** The picker's reported size, or null when it is not a size a visual can have. */
function visualDimensions(visual: PitchPhoto | PitchClip): AssetDimensions | null {
  const width = Math.round(visual.width);
  const height = Math.round(visual.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }
  return { width, height };
}

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
 * True when this draft was uploaded by a build that kept no per-asset records —
 * the only state in which `mediaUploaded` alone may be read as "every asset is
 * already stored". A draft that carries even one record is tracked per asset,
 * where an asset without a record is one whose bytes have never been sent (a
 * photo added after the upload), and inventing a record for it would publish
 * some other photo's object in its place.
 */
function hasNoAssetRecords(draft: PitchDraft): boolean {
  return (
    draft.recording?.upload === undefined &&
    draft.photos.every((photo) => photo.upload === undefined) &&
    draft.clips.every((clip) => clip.upload === undefined)
  );
}

/**
 * What `uploadDraftMedia` has to do for each of a draft's assets, given what
 * previous attempts already completed.
 */
export function planDraftMedia(draft: PitchDraft): readonly MediaAssetPlan[] {
  const uploadedBeforeRecords = draft.server?.mediaUploaded === true && hasNoAssetRecords(draft);
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
      dimensions: null,
      byteSize: null,
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
      // A photo that carries its own identity was picked by a build that names
      // its object after that identity, so the pre-identity name below would
      // point at a different photo's bytes.
      record:
        photo.upload ??
        (uploadedBeforeRecords && photo.assetKey === undefined
          ? legacyRecord(`photo-${index + 1}.jpg`)
          : null),
      dimensions: visualDimensions(photo),
      byteSize: null,
    });
  });
  // Clips last, so a draft that gains one keeps every photo's plan — and its
  // upload record — exactly where it was. `uploadedBeforeRecords` has no clip
  // case: no build that predates per-asset records could store a clip.
  draft.clips.forEach((clip, index) => {
    plans.push({
      kind: 'video',
      index,
      label: `Video ${index + 1}`,
      sourceUri: clip.uri,
      contentType: clip.mimeType,
      objectName: clipObjectName(clip, index),
      record: clip.upload ?? null,
      dimensions: visualDimensions(clip),
      byteSize: clip.byteSize,
    });
  });
  return plans;
}

/**
 * True when this plan needs nothing more from `uploadDraftMedia`.
 *
 * For a voice track or photo that means a recorded `passed` verdict from
 * `/api/media/validate`. A clip has no verdict to record there: its bytes are
 * judged by the server's ingest pipeline, whose outcome arrives later as an
 * ingest state, so "stored and registered" is as far as the upload step can get.
 */
function isAssetSyncSettled(plan: MediaAssetPlan): boolean {
  return plan.kind === 'video' ? plan.record?.registered === true : plan.record?.validated === true;
}

/**
 * True when every asset's bytes are already on the server but at least one has
 * no `passed` verdict — the state a submit can resolve by asking the validator
 * again, as opposed to one that still needs an upload. Clips are excluded: no
 * number of retries produces a validation verdict for one, so counting them here
 * would make every submit re-run the upload step for nothing.
 */
export function hasPendingMediaValidation(draft: PitchDraft): boolean {
  const plans = planDraftMedia(draft);
  return (
    plans.length > 0 &&
    plans.every((plan) => plan.record !== null) &&
    plans.some((plan) => plan.kind !== 'video' && plan.record?.validated === false)
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
    clips: [],
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
