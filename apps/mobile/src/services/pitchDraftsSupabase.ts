import { PitchDraftRepo, UnauthenticatedError, type BrowserSupabaseClient } from '@friendword/data';
import type {
  DraftInputs,
  RelationshipDuration as ServerRelationshipDuration,
  RelationshipType as ServerRelationshipType,
} from '@friendword/contracts';

import {
  MockPitchDraftService,
  PitchDraftSubmissionError,
  type PitchDraftService,
} from './pitchDrafts';
import type {
  PitchDraft,
  PitchDraftId,
  PitchPhoto,
  PitchRecording,
  PitchRelationship,
  RelationshipDuration,
  RelationshipKind,
} from './types';

/** Signals the UI to open the sign-in sheet, then retry the submit. */
export class NeedsSignInError extends Error {
  constructor() {
    super('Sign in to send this pitch for approval.');
    this.name = 'NeedsSignInError';
  }
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

function toDraftInputs(relationship: PitchRelationship): DraftInputs {
  return {
    relationshipType: RELATIONSHIP_TYPE_MAP[relationship.kind],
    relationshipDuration: RELATIONSHIP_DURATION_MAP[relationship.duration],
  };
}

/**
 * Drafts compose locally (photos and audio are local files anyway); the
 * moment of truth is submit, when the draft is created on Supabase, the
 * voice recording is uploaded to the private bucket, and the server RPC
 * issues the consent request. Without a configured client this degrades to
 * the pure local mock so the flow stays usable in development.
 */
export class HybridPitchDraftService implements PitchDraftService {
  private readonly local = new MockPitchDraftService();

  constructor(private readonly client: BrowserSupabaseClient | null) {}

  createDraft(): Promise<PitchDraft> {
    return this.local.createDraft();
  }

  saveRelationship(id: PitchDraftId, relationship: PitchRelationship): Promise<PitchDraft> {
    return this.local.saveRelationship(id, relationship);
  }

  savePhotos(id: PitchDraftId, photos: readonly PitchPhoto[]): Promise<PitchDraft> {
    return this.local.savePhotos(id, photos);
  }

  saveRecording(id: PitchDraftId, recording: PitchRecording): Promise<PitchDraft> {
    return this.local.saveRecording(id, recording);
  }

  getMyDrafts(): Promise<readonly PitchDraft[]> {
    return this.local.getMyDrafts();
  }

  async submitForConsent(id: PitchDraftId): Promise<PitchDraft> {
    if (this.client === null) {
      return this.local.submitForConsent(id);
    }

    const drafts = await this.local.getMyDrafts();
    const draft = drafts.find((candidate) => candidate.id === id);
    if (!draft || !draft.relationship || draft.photos.length === 0 || !draft.recording) {
      throw new PitchDraftSubmissionError('Complete every track before sending for approval.');
    }
    if (draft.status !== 'draft') {
      throw new PitchDraftSubmissionError('This pitch has already been sent for approval.');
    }

    const repo = new PitchDraftRepo(this.client);
    let submission;
    try {
      const serverDraft = await repo.createDraft(toDraftInputs(draft.relationship));
      await this.uploadRecording(repo, serverDraft.id, draft.recording);
      submission = {
        serverDraftId: serverDraft.id,
        ...(await repo.submitForConsent(serverDraft.id)),
      };
    } catch (error: unknown) {
      if (error instanceof UnauthenticatedError) {
        throw new NeedsSignInError();
      }
      throw error;
    }

    return this.local.attachServerSync(id, {
      draftId: submission.serverDraftId,
      consentRequestId: submission.consentRequestId,
      consentToken: submission.consentToken,
    });
  }

  private async uploadRecording(
    repo: PitchDraftRepo,
    serverDraftId: string,
    recording: PitchRecording,
  ): Promise<void> {
    const upload = await repo.requestAssetUpload(serverDraftId, 'voice.m4a');
    const file = await fetch(recording.uri);
    const body = await file.blob();
    const response = await fetch(upload.signedUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'audio/mp4', 'x-upsert': 'false' },
      body,
    });
    if (!response.ok) {
      throw new PitchDraftSubmissionError(
        `Voice upload failed (${response.status}). Check your connection and try again.`,
      );
    }
  }
}
