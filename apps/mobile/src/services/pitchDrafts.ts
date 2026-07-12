import AsyncStorage from '@react-native-async-storage/async-storage';
import { canTransitionPitchDraft } from '@friendword/domain';

import {
  PitchDraftListSchema,
  type PitchDraft,
  type PitchDraftId,
  type PitchPhoto,
  type PitchRecording,
  type PitchRelationship,
  type PitchServerSync,
} from './types';

const STORAGE_KEY = '@friendword/pitch-drafts';

export interface PitchDraftService {
  createDraft(): Promise<PitchDraft>;
  saveRelationship(id: PitchDraftId, relationship: PitchRelationship): Promise<PitchDraft>;
  savePhotos(id: PitchDraftId, photos: readonly PitchPhoto[]): Promise<PitchDraft>;
  saveRecording(id: PitchDraftId, recording: PitchRecording): Promise<PitchDraft>;
  submitForConsent(id: PitchDraftId): Promise<PitchDraft>;
  getMyDrafts(): Promise<readonly PitchDraft[]>;
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
    return this.updateDraft(id, (draft) => ({ ...draft, relationship }));
  }

  async savePhotos(id: PitchDraftId, photos: readonly PitchPhoto[]): Promise<PitchDraft> {
    return this.updateDraft(id, (draft) => ({ ...draft, photos: [...photos] }));
  }

  async saveRecording(id: PitchDraftId, recording: PitchRecording): Promise<PitchDraft> {
    return this.updateDraft(id, (draft) => ({ ...draft, recording }));
  }

  async submitForConsent(id: PitchDraftId): Promise<PitchDraft> {
    return this.updateDraft(id, (draft) => {
      if (!draft.relationship || draft.photos.length === 0 || !draft.recording) {
        throw new PitchDraftSubmissionError('Complete every track before sending for approval.');
      }
      if (draft.recording.durationMillis < 30_000) {
        throw new PitchDraftSubmissionError('Record at least 30 seconds before sending.');
      }
      if (!canTransitionPitchDraft(draft.status, 'consent_pending')) {
        throw new PitchDraftSubmissionError('This pitch has already been sent for approval.');
      }
      return { ...draft, status: 'consent_pending' };
    });
  }

  async getMyDrafts(): Promise<readonly PitchDraft[]> {
    return this.runExclusive(async () => {
      const drafts = await this.readDrafts();
      return [...drafts].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    });
  }

  /**
   * Records a completed server submission: the draft leaves local-only life
   * and keeps the consent share info (raw token stays on-device only).
   */
  async attachServerSync(id: PitchDraftId, server: PitchServerSync): Promise<PitchDraft> {
    return this.updateDraft(id, (draft) => {
      if (!canTransitionPitchDraft(draft.status, 'consent_pending')) {
        throw new PitchDraftSubmissionError('This pitch has already been sent for approval.');
      }
      return { ...draft, status: 'consent_pending', server };
    });
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
    const serialized = await AsyncStorage.getItem(STORAGE_KEY);
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
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(drafts));
  }
}
