import AsyncStorage from '@react-native-async-storage/async-storage';
import { canTransitionPitchDraft } from '@friendword/domain';

import {
  PitchDraftListSchema,
  type ClipIngestState,
  type PitchClip,
  type PitchDraft,
  type PitchDraftId,
  type PitchPhoto,
  type PitchRecording,
  type PitchRelationship,
  type PitchReview,
} from './types';
import {
  isConsentConcludedStatus,
  purgeConsentToken,
  purgeUploadedMedia,
  purgeableMediaUris,
  purgeInvitationContact,
  localMediaUris,
} from './draftStorage';
import { createMediaAssetKey, deleteLocalMediaFile } from './mediaFiles';

const STORAGE_KEY = '@friendword/pitch-drafts';

/** What a {@link PitchDraftService.purgeSensitiveDraftData} call clears. */
export type PurgeScope = 'consent' | 'publish';

export type PitchDraftStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
};

/**
 * Whether a draft listing was confirmed against the server on the read that
 * produced it.
 * - `confirmed`: the server refresh completed, so every server-backed draft in
 *   the listing carries the status and review the server holds.
 * - `unconfirmed`: the refresh timed out or failed. The listing is what this
 *   device saved, which may lag whatever the dater has since done, and drafts
 *   that live only on the server are missing from it.
 * - `signed_out`: there is no session to sync against, so the same caveats
 *   apply, but signing in — not retrying — is the fix.
 */
export type DraftSyncState = 'confirmed' | 'unconfirmed' | 'signed_out';

export type PitchDraftListing = {
  readonly drafts: readonly PitchDraft[];
  readonly sync: DraftSyncState;
};

/** What {@link PitchDraftService.eraseAllLocalDrafts} managed to destroy. */
export type LocalDraftErasure = {
  /** Drafts that were readable, and whose media files were therefore named. */
  readonly erasedDrafts: number;
  /**
   * True only when the stored drafts were readable AND every media file they
   * named was deleted. False means the storage blob is gone but at least one
   * recording or photo is still on this device, which a deletion screen has to
   * say out loud rather than claiming the phone is clean.
   */
  readonly complete: boolean;
};

export interface PitchDraftService {
  createDraft(): Promise<PitchDraft>;
  saveRelationship(id: PitchDraftId, relationship: PitchRelationship): Promise<PitchDraft>;
  savePhotos(id: PitchDraftId, photos: readonly PitchPhoto[]): Promise<PitchDraft>;
  /** Rejects with {@link StoredClipRemovalError} for a clip whose bytes are already stored. */
  saveClips(id: PitchDraftId, clips: readonly PitchClip[]): Promise<PitchDraft>;
  /**
   * Re-reads the ingest state of this draft's uploaded clips from the server and
   * updates the local mirror. A no-op for a draft with no uploaded clip, and for
   * the local-only store, which has no server to ask.
   */
  refreshClipIngest(id: PitchDraftId): Promise<PitchDraft>;
  /** Rejects with {@link StoredVoiceReplacementError} for a take that would replace stored bytes. */
  saveRecording(id: PitchDraftId, recording: PitchRecording): Promise<PitchDraft>;
  prepareForReview(id: PitchDraftId): Promise<PitchDraft>;
  uploadDraftMedia(id: PitchDraftId): Promise<PitchDraft>;
  loadGeneratedReview(id: PitchDraftId): Promise<PitchDraft>;
  saveReview(id: PitchDraftId, review: PitchReview): Promise<PitchDraft>;
  finalizeConsent(id: PitchDraftId): Promise<PitchDraft>;
  purgeInvitationContact(id: PitchDraftId): Promise<PitchDraft>;
  purgeSensitiveDraftData(id: PitchDraftId, scope: PurgeScope): Promise<PitchDraft>;
  purgeAllConsentTokens(): Promise<number>;
  /**
   * Removes every draft this device holds and deletes their media files.
   *
   * Account deletion only — sign-out deliberately keeps drafts (the same person
   * signs back in), but a deleted account has no server draft left to sync
   * against, so leaving the voice recordings and photos on the phone would
   * leave the one copy nobody can erase later.
   *
   * Rejects only when the stored blob itself could not be cleared. Everything
   * short of that is reported in {@link LocalDraftErasure.complete} so the
   * screen can say what actually happened.
   */
  eraseAllLocalDrafts(): Promise<LocalDraftErasure>;
  /**
   * Removes ONE pitch the introducer started — this device's copy and, when the
   * draft reached the server, the server's rows too (T010, Issue #47).
   *
   * Distinct from {@link eraseAllLocalDrafts} in both scope and authority: that
   * one is the local half of account deletion and never talks to the server;
   * this one is a person tidying a list, and the server is the authority on
   * whether the pitch may go at all. A server-backed draft is therefore deleted
   * server-first and only removed from this device once the server has said yes
   * — a local-only removal would hide a pitch the server still holds and that
   * the next sync would bring straight back, minus the media files this device
   * had already thrown away.
   *
   * Rejects with {@link PitchDraftDeletionError} carrying a sentence the screen
   * can show, and leaves everything in place when it does.
   */
  deleteDraft(id: PitchDraftId): Promise<void>;
  /**
   * The screen-facing draft read. It carries its own {@link DraftSyncState}
   * rather than a bare array so no caller can present a list this device could
   * not confirm as the current one — that is the whole failure mode the
   * local-drafts fallback would otherwise hide.
   */
  listMyDrafts(): Promise<PitchDraftListing>;
}

export function hasFinalizedConsent(draft: PitchDraft): boolean {
  return draft.server !== null && draft.server.consentRequestId !== null;
}

/**
 * True when editing or resubmitting this draft would mean acting on state the
 * server may already have moved past: it has been submitted for consent, so the
 * dater can have approved it or asked for changes, and this listing was not
 * confirmed against the server. A draft that was never submitted has no server
 * state to fall behind, so it stays editable offline.
 */
export function isUnconfirmedSubmission(draft: PitchDraft, sync: DraftSyncState): boolean {
  return sync !== 'confirmed' && hasFinalizedConsent(draft);
}

/** Says why a submitted draft could not be confirmed, without overclaiming. */
export function unconfirmedDraftMessage(sync: DraftSyncState, friendName: string): string {
  return sync === 'signed_out'
    ? `Sign in to check whether ${friendName} has already answered this pitch. ` +
        'Until then this device only has its own saved copy, and resending could ' +
        'overwrite a change request you have not seen.'
    : `Friendword could not be reached, so this is only the copy saved on this device. ` +
        `${friendName} may have answered or asked for changes since. ` +
        'Check again before editing or resending.';
}

/**
 * Resolves with `value`'s result, or with `fallback()` when `value` has not
 * settled within `timeoutMs`. Neither supabase-js nor `fetch` carries a request
 * timeout here, so an unbounded draft call would otherwise leave a screen on its
 * loading state forever. `value` cannot be cancelled, so it keeps running and a
 * late result is discarded; its rejection is still observed here so it never
 * surfaces as an unhandled rejection.
 */
export function settleWithin<T>(
  value: Promise<T>,
  timeoutMs: number,
  fallback: () => T,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      resolve(fallback());
    }, timeoutMs);
    value.then(
      (settled) => {
        clearTimeout(timer);
        resolve(settled);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export class PitchDraftNotFoundError extends Error {
  constructor(readonly draftId: PitchDraftId) {
    super(`Pitch draft ${draftId} was not found.`);
    this.name = 'PitchDraftNotFoundError';
  }
}

export class PitchDraftStorageError extends Error {
  constructor() {
    super('Saved pitch drafts could not be read.');
    this.name = 'PitchDraftStorageError';
  }
}

export class PitchDraftSubmissionError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = 'PitchDraftSubmissionError';
  }
}

/**
 * Raised when deleting a pitch did not happen, carrying the sentence the screen
 * shows. Nothing was destroyed on either side when this is thrown — the local
 * removal is the last step and only runs after the server has agreed.
 *
 * `partial` is the one case where that is not the whole truth: the server
 * accepted the deletion and this device could not finish clearing its own
 * copies. The pitch really is gone from Friendword; the screen has to say the
 * files may still be on the phone rather than claiming a clean removal.
 */
export class PitchDraftDeletionError extends Error {
  constructor(
    readonly reason: string,
    readonly partial: boolean = false,
  ) {
    super(reason);
    this.name = 'PitchDraftDeletionError';
  }
}

/**
 * §12: the deletion went through on Friendword and this phone did not finish
 * clearing itself, so the copy claim has to be withdrawn rather than softened.
 * "Delete the app" is the only remaining lever a person has over files this
 * code could not remove.
 */
export const LOCAL_MEDIA_LEFTOVER_MESSAGE =
  'This pitch is deleted from Friendword, but we could not finish clearing this phone. The ' +
  'recording or photos may still be in the app on this device — deleting the app removes them.';

export const STORED_VOICE_REPLACEMENT_MESSAGE =
  'The recording for this pitch has already been sent to Friendword and cannot be replaced ' +
  'yet, so this new take was not saved. Continue with the take you already sent, or start a ' +
  'new pitch to use the new one.';

/**
 * Raised when this device's upload ledger says the draft's voice bytes are
 * already stored and a different take is saved over them locally.
 *
 * The voice object name is fixed (`{draftId}/voice.m4a`: /api/transcribe and
 * the published pitch both read that exact path) and it is written once —
 * signed uploads are `upsert:false` and the storage policies grant creators
 * INSERT only. Nothing this app can do replaces those bytes, so accepting the
 * new take would leave the draft claiming a recording the dater will never
 * hear. `keptRecording` is the take the server actually holds, so the caller
 * can put the screen back on it instead of dead-ending.
 */
export class StoredVoiceReplacementError extends Error {
  constructor(readonly keptRecording: PitchRecording) {
    super(STORED_VOICE_REPLACEMENT_MESSAGE);
    this.name = 'StoredVoiceReplacementError';
  }
}

export const STORED_CLIP_REMOVAL_MESSAGE =
  'This video has already been sent to Friendword, and it cannot be taken off this pitch yet, ' +
  'so it was kept. It is only published if it passes the automated safety checks.';

/**
 * Raised when a clip whose bytes are already stored is dropped from the draft.
 *
 * The server's asset-removal RPC handles photos only (0046 refuses any other
 * asset type), so a clip that has been uploaded and registered cannot be
 * detached. Accepting the local removal would leave a pitch_assets row the
 * submit snapshots into the consent revision while the local draft no longer
 * mentions it — and `reconcileRegisteredAssets` would then refuse to send the
 * pitch at all, because a non-photo leftover is exactly the state it fails
 * closed on. Keeping the clip is the honest outcome: it stays visible, and the
 * ingest verdict decides whether it is ever published. `keptClips` is what the
 * draft actually holds, so the screen can put itself back on that.
 */
export class StoredClipRemovalError extends Error {
  constructor(readonly keptClips: readonly PitchClip[]) {
    super(STORED_CLIP_REMOVAL_MESSAGE);
    this.name = 'StoredClipRemovalError';
  }
}

/**
 * True when this device recorded that the draft's voice object was uploaded.
 *
 * Not an invariant about the server: both fields are written *after* the PUT
 * returns, so an app kill in that window loses the record while the object
 * stands. A later take is then accepted and published as the earlier one. The
 * check is deliberately local — the record screen has to work offline, and a
 * server probe that fails open when there is no network reopens exactly this
 * window. Closing it needs a per-take voice object name, which /api/transcribe
 * and the published pitch both read as a fixed path today.
 */
function hasStoredVoiceObject(draft: PitchDraft): boolean {
  return draft.recording?.upload !== undefined || draft.server?.mediaUploaded === true;
}

/**
 * Reconciles a photo save against what the draft already holds.
 *
 * The photos screen hands back freshly picked values, so each surviving photo's
 * identity and upload record are carried across by uri. Without that, a save
 * after a removal strips them, and the next upload renames the survivors into
 * the removed photo's object — publishing bytes the introducer took out. A
 * photo missing from `next` is genuinely gone and its record leaves with it;
 * the pitch_assets row registered at upload time does not, which is why
 * `HybridPitchDraftService.reconcileRegisteredAssets` detaches that row before
 * the submit, rather than letting the consent revision snapshot it.
 *
 * A fresh identity goes to a photo that is new to this draft, and to a survivor
 * of a removal that has no upload record: the latter is stored (if at all) under
 * a position-derived name from an older build, and that name stops describing it
 * the moment an earlier photo is dropped.
 */
function mergePhotoIdentities(
  current: readonly PitchPhoto[],
  next: readonly PitchPhoto[],
): PitchPhoto[] {
  const unclaimed = [...current];
  const matched = next.map((photo) => {
    const position = unclaimed.findIndex((stored) => stored.uri === photo.uri);
    return { photo, stored: position < 0 ? undefined : unclaimed.splice(position, 1)[0] };
  });
  const removedAny = unclaimed.length > 0;
  return matched.map(({ photo, stored }) => {
    const upload = photo.upload ?? stored?.upload;
    const assetKey =
      photo.assetKey ??
      stored?.assetKey ??
      (stored === undefined || (removedAny && upload === undefined)
        ? createMediaAssetKey()
        : undefined);
    return {
      ...photo,
      ...(assetKey === undefined ? {} : { assetKey }),
      ...(upload === undefined ? {} : { upload }),
    };
  });
}

/**
 * Reconciles a clip save against what the draft already holds.
 *
 * Same contract as {@link mergePhotoIdentities} for identities and upload
 * records — the stored object is named after the clip's identity, so a save must
 * never strip one — with one added rule: dropping a clip whose bytes are already
 * stored is refused ({@link StoredClipRemovalError}). Unlike a photo, an
 * uploaded clip cannot be detached from the server draft.
 */
function mergeClipIdentities(
  current: readonly PitchClip[],
  next: readonly PitchClip[],
): PitchClip[] {
  const kept = current.filter(
    (clip) => clip.upload !== undefined && !next.some((candidate) => candidate.uri === clip.uri),
  );
  if (kept.length > 0) {
    throw new StoredClipRemovalError(current);
  }
  return next.map((clip) => {
    const stored = current.find((candidate) => candidate.uri === clip.uri);
    const upload = clip.upload ?? stored?.upload;
    const ingest = clip.ingest ?? stored?.ingest;
    return {
      ...clip,
      assetKey: clip.assetKey ?? stored?.assetKey ?? createMediaAssetKey(),
      ...(upload === undefined ? {} : { upload }),
      ...(ingest === undefined ? {} : { ingest }),
    };
  });
}

export class MockPitchDraftService implements PitchDraftService {
  private pending: Promise<void> = Promise.resolve();

  constructor(
    private readonly storage: PitchDraftStorage = AsyncStorage,
    private readonly deleteMediaFile: (uri: string) => Promise<void> = deleteLocalMediaFile,
  ) {}

  async createDraft(): Promise<PitchDraft> {
    return this.runExclusive(async () => {
      const drafts = await this.readDrafts();
      const now = new Date().toISOString();
      const draft = PitchDraftListSchema.element.parse({
        id: `draft-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        status: 'draft',
        contextRole: 'INTRODUCER',
        relationship: null,
        photos: [],
        recording: null,
        createdAt: now,
        updatedAt: now,
      });

      await this.writeDrafts([...drafts, draft]);
      return draft;
    });
  }

  async saveRelationship(id: PitchDraftId, relationship: PitchRelationship): Promise<PitchDraft> {
    // The raw email is needed for submit, then the share screen purges it from this local draft.
    return this.updateDraft(id, (draft) => ({ ...draft, relationship }));
  }

  async savePhotos(id: PitchDraftId, photos: readonly PitchPhoto[]): Promise<PitchDraft> {
    return this.updateDraft(id, (draft) => ({
      ...draft,
      photos: mergePhotoIdentities(draft.photos, photos),
    }));
  }

  async saveClips(id: PitchDraftId, clips: readonly PitchClip[]): Promise<PitchDraft> {
    return this.updateDraft(id, (draft) => ({
      ...draft,
      clips: mergeClipIdentities(draft.clips, clips),
    }));
  }

  /**
   * The local store has no server behind it, so there is no ingest job to ask
   * about; the hybrid service overrides this. Kept as a read rather than a throw
   * so a screen can poll without first knowing which store it is talking to.
   */
  async refreshClipIngest(id: PitchDraftId): Promise<PitchDraft> {
    const draft = (await this.getMyDrafts()).find((candidate) => candidate.id === id);
    if (draft === undefined) {
      throw new PitchDraftNotFoundError(id);
    }
    return draft;
  }

  /**
   * Drops a clip whose bytes were stored but which the server refused to
   * register (the clip entitlement or the absolute ceiling).
   *
   * Safe where {@link saveClips} refuses: no pitch_assets row names this object,
   * so nothing can be snapshotted into a consent revision and the reconcile has
   * nothing to detach. The stored bytes are left to the 48h orphan sweep, which
   * is the only path that can reclaim them. A registered clip is never touched.
   */
  async dropUnregisteredClip(id: PitchDraftId, objectName: string): Promise<PitchDraft> {
    return this.updateDraft(id, (draft) => ({
      ...draft,
      clips: draft.clips.filter(
        (clip) =>
          clip.upload === undefined ||
          clip.upload.registered ||
          clip.upload.objectName !== objectName,
      ),
    }));
  }

  /**
   * Writes the server's ingest verdicts into the local mirror. Separate from
   * {@link saveClips} because it must not touch identities or the removal guard:
   * it is a refresh of server-owned state, not an edit by the introducer.
   */
  async saveClipIngestStates(
    id: PitchDraftId,
    states: ReadonlyMap<string, ClipIngestState>,
  ): Promise<PitchDraft> {
    return this.updateDraft(id, (draft) => ({
      ...draft,
      clips: draft.clips.map((clip) => {
        const objectName = clip.upload?.objectName;
        const state = objectName === undefined ? undefined : states.get(objectName);
        return state === undefined ? clip : { ...clip, ingest: state };
      }),
    }));
  }

  /**
   * Saves a recording, refusing to swap in a different take once this device
   * has recorded that the draft's voice object was uploaded
   * ({@link StoredVoiceReplacementError}) — that object cannot be rewritten, so
   * the local draft must keep pointing at the take the dater will actually
   * hear. Edits that keep the same take (the text recap) and the upload
   * bookkeeping still go through. See {@link hasStoredVoiceObject} for what
   * this does not cover.
   */
  async saveRecording(id: PitchDraftId, recording: PitchRecording): Promise<PitchDraft> {
    return this.updateDraft(id, (draft) => {
      const stored = draft.recording;
      if (stored !== null && stored.uri !== recording.uri && hasStoredVoiceObject(draft)) {
        throw new StoredVoiceReplacementError(stored);
      }
      const upload =
        recording.upload ?? (stored?.uri === recording.uri ? stored.upload : undefined);
      return {
        ...draft,
        recording: { ...recording, ...(upload === undefined ? {} : { upload }) },
      };
    });
  }

  async prepareForReview(id: PitchDraftId): Promise<PitchDraft> {
    return this.updateDraft(id, (draft) => {
      this.requireCompleteDraft(draft);
      if (draft.status !== 'draft' && draft.status !== 'changes_requested') {
        throw new PitchDraftSubmissionError('This pitch is no longer editable.');
      }
      return draft;
    });
  }

  async saveReview(id: PitchDraftId, review: PitchReview): Promise<PitchDraft> {
    return this.updateDraft(id, (draft) => ({ ...draft, review }));
  }

  loadGeneratedReview(id: PitchDraftId): Promise<PitchDraft> {
    return this.prepareForReview(id);
  }

  async uploadDraftMedia(id: PitchDraftId): Promise<PitchDraft> {
    // Local-only drafts keep their media on the device; there is nothing to
    // upload. The hybrid service overrides this for server-backed drafts.
    const drafts = await this.getMyDrafts();
    const draft = drafts.find((candidate) => candidate.id === id);
    if (draft === undefined) {
      throw new PitchDraftNotFoundError(id);
    }
    return draft;
  }

  async finalizeConsent(id: PitchDraftId): Promise<PitchDraft> {
    return this.updateDraft(id, (draft) => {
      this.requireCompleteDraft(draft);
      if (draft.review.headline.trim() === '' || draft.review.body.trim() === '') {
        throw new PitchDraftSubmissionError('Write a headline and body before sending.');
      }
      if (!canTransitionPitchDraft(draft.status, 'consent_pending')) {
        throw new PitchDraftSubmissionError('This pitch is no longer editable.');
      }
      return {
        ...draft,
        status: 'consent_pending',
        review: { ...draft.review, responseNote: null },
      };
    });
  }

  async attachServerDraft(id: PitchDraftId, draftId: string): Promise<PitchDraft> {
    return this.updateDraft(id, (draft) => ({
      ...draft,
      server: { draftId, consentRequestId: null, consentToken: null, mediaUploaded: false },
    }));
  }

  async markDraftMediaUploaded(id: PitchDraftId): Promise<PitchDraft> {
    return this.updateDraft(id, (draft) => {
      if (draft.server === null) {
        throw new PitchDraftSubmissionError('Prepare this pitch before uploading media.');
      }
      return { ...draft, server: { ...draft.server, mediaUploaded: true } };
    });
  }

  async attachFinalizedConsent(
    id: PitchDraftId,
    submission: {
      readonly consentRequestId: string;
      readonly consentToken: string | null;
    },
  ): Promise<PitchDraft> {
    return this.updateDraft(id, (draft) => {
      if (draft.server === null) {
        throw new PitchDraftSubmissionError('Prepare this pitch before sending.');
      }
      return {
        ...draft,
        status: 'consent_pending',
        review: { ...draft.review, responseNote: null },
        server: {
          ...draft.server,
          consentRequestId: submission.consentRequestId,
          consentToken: submission.consentToken ?? draft.server.consentToken,
        },
      };
    });
  }

  async syncServerReview(
    id: PitchDraftId,
    state: Pick<PitchDraft, 'status' | 'review'> & Partial<Pick<PitchDraft, 'updatedAt'>>,
  ): Promise<PitchDraft> {
    const orphanedUris: string[] = [];
    const synced = await this.runExclusive(async () => {
      const drafts = await this.readDrafts();
      const current = drafts.find((draft) => draft.id === id);
      if (current === undefined) {
        throw new PitchDraftNotFoundError(id);
      }
      let next = PitchDraftListSchema.element.parse({
        ...current,
        ...state,
        updatedAt:
          state.updatedAt === undefined || current.updatedAt > state.updatedAt
            ? current.updatedAt
            : state.updatedAt,
      });
      // Observing a concluded consent request is the moment the bearer token
      // stops being useful — drop it. Once published, the server holds the
      // media originals, so the uploaded local copies go too.
      if (isConsentConcludedStatus(next.status)) {
        next = purgeConsentToken(next);
        if (next.status === 'published') {
          orphanedUris.push(...purgeableMediaUris(next));
          next = purgeUploadedMedia(next);
        }
      }
      await this.writeDrafts(drafts.map((draft) => (draft.id === id ? next : draft)));
      return next;
    });
    await this.deleteMediaFiles(orphanedUris);
    return synced;
  }

  /**
   * Single entry point for clearing sensitive local state once a draft reaches
   * a terminal point. `'consent'` drops just the bearer token; `'publish'`
   * additionally clears the uploaded on-device media and deletes those files.
   */
  async purgeSensitiveDraftData(id: PitchDraftId, scope: PurgeScope): Promise<PitchDraft> {
    const orphanedUris: string[] = [];
    const result = await this.updateDraft(id, (draft) => {
      let next = purgeConsentToken(draft);
      if (scope === 'publish') {
        orphanedUris.push(...purgeableMediaUris(next));
        next = purgeUploadedMedia(next);
      }
      return next;
    });
    await this.deleteMediaFiles(orphanedUris);
    return result;
  }

  /**
   * Strips the raw consent token from every stored draft. Called on sign-out
   * and account switch so a shared device never leaves a previous user's bearer
   * secrets behind. Local media is intentionally left in place — draft
   * ownership across an account switch is ambiguous, so only the token goes.
   * Returns the number of drafts that still held a token.
   */
  async purgeAllConsentTokens(): Promise<number> {
    return this.runExclusive(async () => {
      const drafts = await this.readDrafts();
      let removed = 0;
      const next = drafts.map((draft) => {
        if (draft.server === null || draft.server.consentToken === null) {
          return draft;
        }
        removed += 1;
        return purgeConsentToken(draft);
      });
      if (removed > 0) {
        await this.writeDrafts(next);
      }
      return removed;
    });
  }

  /**
   * The local half of account deletion. Every draft goes, and so does every
   * media file they reference — uploaded or not, because the server copy is
   * being erased in the same breath.
   *
   * The stored blob is cleared unconditionally, including when it cannot be
   * parsed. That case is the one where clearing matters most: an unreadable
   * value is still a value, and this one holds raw consent bearer tokens and the
   * invited friend's email address. Refusing to write because the read failed
   * would leave exactly those bytes on a phone whose account no longer exists.
   * What is lost with the parse is the list of media files, so the erasure is
   * reported as incomplete rather than as a success.
   */
  async eraseAllLocalDrafts(): Promise<LocalDraftErasure> {
    const orphanedUris: string[] = [];
    let readable = true;
    const erasedDrafts = await this.runExclusive(async () => {
      let drafts: readonly PitchDraft[] = [];
      try {
        drafts = await this.readDrafts();
      } catch {
        readable = false;
      }
      for (const draft of drafts) {
        orphanedUris.push(...localMediaUris(draft));
      }
      await this.writeDrafts([]);
      return drafts.length;
    });
    let deletedEveryFile = true;
    for (const uri of orphanedUris) {
      try {
        await this.deleteMediaFile(uri);
      } catch {
        deletedEveryFile = false;
      }
    }
    return { erasedDrafts, complete: readable && deletedEveryFile };
  }

  /**
   * Removes one draft from this device and deletes the media files it named.
   *
   * The local store has no server behind it, so this IS the whole deletion
   * here; {@link HybridPitchDraftService.deleteDraft} is what puts the server
   * in front of it. A draft that is not on this device is not an error — the
   * caller asked for it to be gone and it is, and a device that never held it
   * (a draft recovered from the account on another phone) must not dead-end.
   *
   * Media deletion failures are reported as a partial deletion rather than
   * swallowed: the recording is the one thing on the phone this call promised
   * to remove.
   */
  async deleteDraft(id: PitchDraftId): Promise<void> {
    const orphanedUris = await this.runExclusive(async () => {
      const drafts = await this.readDrafts();
      const target = drafts.find((draft) => draft.id === id);
      if (target === undefined) {
        return [] as readonly string[];
      }
      await this.writeDrafts(drafts.filter((draft) => draft.id !== id));
      return localMediaUris(target);
    });
    let deletedEveryFile = true;
    for (const uri of orphanedUris) {
      try {
        await this.deleteMediaFile(uri);
      } catch {
        deletedEveryFile = false;
      }
    }
    if (!deletedEveryFile) {
      throw new PitchDraftDeletionError(LOCAL_MEDIA_LEFTOVER_MESSAGE, true);
    }
  }

  private async deleteMediaFiles(uris: readonly string[]): Promise<void> {
    for (const uri of uris) {
      await this.deleteMediaFile(uri);
    }
  }

  async restoreServerDraft(draft: PitchDraft): Promise<PitchDraft> {
    return this.runExclusive(async () => {
      const drafts = await this.readDrafts();
      const existing = drafts.find(
        (candidate) =>
          candidate.id === draft.id ||
          (candidate.server !== null &&
            draft.server !== null &&
            candidate.server.draftId === draft.server.draftId),
      );
      if (existing !== undefined) {
        return existing;
      }
      const restored = PitchDraftListSchema.element.parse(draft);
      await this.writeDrafts([...drafts, restored]);
      return restored;
    });
  }

  async purgeInvitationContact(id: PitchDraftId): Promise<PitchDraft> {
    return this.updateDraft(id, purgeInvitationContact);
  }

  /** The on-device store, with no claim about the server. */
  async getMyDrafts(): Promise<readonly PitchDraft[]> {
    return this.runExclusive(async () => {
      const drafts = await this.readDrafts();
      return [...drafts].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    });
  }

  /**
   * This store has no server behind it, so a listing straight from it is never
   * confirmed. {@link HybridPitchDraftService} overrides this with the real
   * refresh.
   */
  async listMyDrafts(): Promise<PitchDraftListing> {
    return { drafts: await this.getMyDrafts(), sync: 'signed_out' };
  }

  private requireCompleteDraft(draft: PitchDraft): void {
    if (!draft.relationship || draft.photos.length === 0 || !draft.recording) {
      throw new PitchDraftSubmissionError('Complete every track before continuing.');
    }
    if (draft.recording.durationMillis < 30_000) {
      throw new PitchDraftSubmissionError('Record at least 30 seconds before continuing.');
    }
  }

  private async updateDraft(
    id: PitchDraftId,
    update: (draft: PitchDraft) => PitchDraft,
  ): Promise<PitchDraft> {
    return this.runExclusive(async () => {
      const drafts = await this.readDrafts();
      const current = drafts.find((draft) => draft.id === id);
      if (!current) {
        throw new PitchDraftNotFoundError(id);
      }

      const updated = PitchDraftListSchema.element.parse({
        ...update(current),
        updatedAt: new Date().toISOString(),
      });
      const nextDrafts = drafts.map((draft) => (draft.id === id ? updated : draft));
      await this.writeDrafts(nextDrafts);
      return updated;
    });
  }

  private runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.pending.then(operation, operation);
    this.pending = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async readDrafts(): Promise<readonly PitchDraft[]> {
    const serialized = await this.storage.getItem(STORAGE_KEY);
    if (!serialized) {
      return [];
    }

    const parsed: unknown = JSON.parse(serialized);
    const result = PitchDraftListSchema.safeParse(parsed);
    if (!result.success) {
      throw new PitchDraftStorageError();
    }
    return result.data;
  }

  private async writeDrafts(drafts: readonly PitchDraft[]): Promise<void> {
    await this.storage.setItem(STORAGE_KEY, JSON.stringify(drafts));
  }
}
