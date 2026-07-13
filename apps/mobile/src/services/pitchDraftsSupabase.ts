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

import {
  MockPitchDraftService,
  PitchDraftSubmissionError,
  type PitchDraftService,
} from './pitchDrafts';
import {
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

export class HybridPitchDraftService implements PitchDraftService {
  constructor(
    client: BrowserSupabaseClient | null,
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

  async getMyDrafts(): Promise<readonly PitchDraft[]> {
    const localDrafts = await this.local.getMyDrafts();
    if (this.repo === null || localDrafts.every((draft) => draft.server === null)) {
      return localDrafts;
    }
    const [serverDrafts, requests] = await Promise.all([
      this.repo.listMyDrafts(),
      this.repo.listMyConsentRequests(),
    ]);
    for (const draft of localDrafts) {
      const serverDraft = serverDrafts.find((row) => row.id === draft.server?.draftId);
      if (serverDraft === undefined) {
        continue;
      }
      const request = requests.find((row) => row.pitch_draft_id === serverDraft.id);
      await this.local.syncServerReview(draft.id, {
        status: serverDraft.status,
        review: reviewFromServer(serverDraft, draft.review, request),
      });
    }
    return this.local.getMyDrafts();
  }

  async prepareForReview(id: PitchDraftId): Promise<PitchDraft> {
    const draft = await this.local.prepareForReview(id);
    if (this.repo === null || draft.server !== null) {
      return draft;
    }
    if (draft.relationship?.contact.kind !== 'email') {
      throw new PitchDraftSubmissionError('Enter a valid email before continuing.');
    }
    try {
      const serverDraft = await this.repo.createDraft(toDraftInputs(draft.relationship));
      if (draft.recording === null) {
        throw new PitchDraftSubmissionError('Record a voice track before continuing.');
      }
      await this.uploadFile(
        this.repo,
        serverDraft.id,
        'voice.m4a',
        draft.recording.uri,
        'audio/mp4',
      );
      await this.repo.registerAsset(serverDraft.id, 'voice', 'voice.m4a');
      for (const [index, photo] of draft.photos.entries()) {
        const fileName = `photo-${index + 1}.jpg`;
        await this.uploadFile(this.repo, serverDraft.id, fileName, photo.uri, 'image/jpeg');
        await this.repo.registerAsset(serverDraft.id, 'photo', fileName, index);
      }
      return this.local.attachServerDraft(id, serverDraft.id);
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
    const response = await fetch(upload.signedUrl, {
      method: 'PUT',
      headers: { 'Content-Type': contentType, 'x-upsert': 'false' },
      body: await (await fetch(uri)).blob(),
    });
    if (!response.ok) {
      throw new PitchDraftSubmissionError(`Upload of ${fileName} failed (${response.status}).`);
    }
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
