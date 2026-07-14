import AsyncStorage from '@react-native-async-storage/async-storage';
import { canTransitionPitchDraft } from '@friendword/domain';

import {
  PitchDraftListSchema,
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
} from './draftStorage';
import { deleteLocalMediaFile } from './mediaFiles';

const STORAGE_KEY = '@friendword/pitch-drafts';

/** What a {@link PitchDraftService.purgeSensitiveDraftData} call clears. */
export type PurgeScope = 'consent' | 'publish';

export type PitchDraftStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
};

export interface PitchDraftService {
  createDraft(): Promise<PitchDraft>;
  saveRelationship(id: PitchDraftId, relationship: PitchRelationship): Promise<PitchDraft>;
  savePhotos(id: PitchDraftId, photos: readonly PitchPhoto[]): Promise<PitchDraft>;
  saveRecording(id: PitchDraftId, recording: PitchRecording): Promise<PitchDraft>;
  prepareForReview(id: PitchDraftId): Promise<PitchDraft>;
  uploadDraftMedia(id: PitchDraftId): Promise<PitchDraft>;
  loadGeneratedReview(id: PitchDraftId): Promise<PitchDraft>;
  saveReview(id: PitchDraftId, review: PitchReview): Promise<PitchDraft>;
  finalizeConsent(id: PitchDraftId): Promise<PitchDraft>;
  purgeInvitationContact(id: PitchDraftId): Promise<PitchDraft>;
  purgeSensitiveDraftData(id: PitchDraftId, scope: PurgeScope): Promise<PitchDraft>;
  purgeAllConsentTokens(): Promise<number>;
  getMyDrafts(): Promise<readonly PitchDraft[]>;
}

export function hasFinalizedConsent(draft: PitchDraft): boolean {
  return draft.server !== null && draft.server.consentRequestId !== null;
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
    return this.updateDraft(id, (draft) => ({ ...draft, photos: [...photos] }));
  }

  async saveRecording(id: PitchDraftId, recording: PitchRecording): Promise<PitchDraft> {
    return this.updateDraft(id, (draft) => ({ ...draft, recording }));
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

  async getMyDrafts(): Promise<readonly PitchDraft[]> {
    return this.runExclusive(async () => {
      const drafts = await this.readDrafts();
      return [...drafts].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    });
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
