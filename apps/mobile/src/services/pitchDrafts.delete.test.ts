// T010 (Issue #47): deleting one pitch the introducer started.
//
// The property every test here defends is the ORDER. The server decides whether
// a pitch may go, and this device's copy — the recording, the photos, the clips
// — is removed only after it has said yes. A local-first deletion would throw
// away the media and then discover the pitch is live, still on the server, and
// about to come back on the next sync.
import { describe, expect, it, vi } from 'vitest';

import {
  MockPitchDraftService,
  PitchDraftDeletionError,
  type PitchDraftStorage,
} from './pitchDrafts';
import {
  DELETE_FAILED_MESSAGE,
  DELETE_IN_FLIGHT_MESSAGE,
  DELETE_NEEDS_SIGN_IN_MESSAGE,
  DELETE_PUBLISHED_MESSAGE,
  DELETE_PURCHASED_MESSAGE,
  HybridPitchDraftService,
  type PitchDraftRepository,
} from './pitchDraftsSupabase';
import {
  EMPTY_PITCH_STRUCTURE,
  PitchDraftSchema,
  type PitchDraftId,
  type PitchReview,
} from './types';

const STORAGE_KEY = '@friendword/pitch-drafts';
const SERVER_DRAFT_ID = '10000000-0000-4000-8000-000000000001';
const CONSENT_REQUEST_ID = '30000000-0000-4000-8000-000000000001';
const TOKEN = 'a'.repeat(32);

const REVIEW: PitchReview = {
  headline: 'Jordan makes ordinary days memorable',
  body: 'Jordan is thoughtful, curious, and always ready with a good story.',
  structure: {
    ...EMPTY_PITCH_STRUCTURE,
    hook: 'Jordan makes ordinary days memorable',
    three_specific_qualities: ['Thoughtful', 'Curious', 'Dependable'],
  },
  generationMode: 'generated',
  responseNote: null,
};

function createStorage(): { storage: PitchDraftStorage; values: Map<string, string> } {
  const values = new Map<string, string>();
  const storage: PitchDraftStorage = {
    getItem: async (key) => values.get(key) ?? null,
    setItem: async (key, value) => {
      values.set(key, value);
    },
  };
  return { storage, values };
}

/** A draft with media on this device, optionally already known to the server. */
async function createDraft(
  service: MockPitchDraftService,
  options: { readonly onServer?: boolean } = {},
): Promise<PitchDraftId> {
  const draft = await service.createDraft();
  await service.saveRelationship(draft.id, {
    kind: 'Friend',
    duration: '3–10 years',
    friendFirstName: 'Jordan',
    contact: { kind: 'email', value: 'friend@example.com' },
  });
  await service.savePhotos(draft.id, [{ uri: 'file:///one.jpg', width: 100, height: 100 }]);
  await service.saveRecording(draft.id, {
    uri: 'file:///voice.m4a',
    durationMillis: 30_000,
    caption: 'A real story about Jordan.',
  });
  await service.saveReview(draft.id, REVIEW);
  if (options.onServer === true) {
    await service.attachServerDraft(draft.id, SERVER_DRAFT_ID);
    await service.attachFinalizedConsent(draft.id, {
      consentRequestId: CONSENT_REQUEST_ID,
      consentToken: TOKEN,
    });
  }
  return draft.id;
}

const unexpected = async (): Promise<never> => {
  throw new Error('Unexpected repository method');
};

/** A repository whose only live method is deleteDraft. */
function repositoryWith(deleteDraft: PitchDraftRepository['deleteDraft']): PitchDraftRepository {
  return {
    createDraft: unexpected,
    deleteDraft,
    getDraft: unexpected,
    listAssets: unexpected,
    listMyConsentRequests: unexpected,
    listMyDrafts: unexpected,
    registerAsset: unexpected,
    removeAsset: unexpected,
    requestAssetUpload: unexpected,
    submitForConsent: unexpected,
    updateDraft: unexpected,
  };
}

/** The shape a PostgREST refusal reaches the service in. */
function serverRefusal(message: string): Error {
  return Object.assign(new Error('pitchDraft.delete failed'), {
    cause: { message, code: 'P0001' },
  });
}

describe('MockPitchDraftService.deleteDraft (this device only)', () => {
  it('removes the draft and deletes its media files', async () => {
    const { storage, values } = createStorage();
    const deleteMediaFile = vi.fn(async () => {});
    const service = new MockPitchDraftService(storage, deleteMediaFile);
    const id = await createDraft(service);
    const kept = await createDraft(service);

    await service.deleteDraft(id);

    const remaining = await service.getMyDrafts();
    expect(remaining.map((draft) => draft.id)).toEqual([kept]);
    expect(deleteMediaFile).toHaveBeenCalledWith('file:///voice.m4a');
    expect(deleteMediaFile).toHaveBeenCalledWith('file:///one.jpg');
    // Two drafts share the fixture URIs; only the deleted one's are named.
    expect(deleteMediaFile).toHaveBeenCalledTimes(2);
    expect(values.get(STORAGE_KEY)).toContain(kept);
  });

  it('is a no-op for a draft this device does not hold', async () => {
    // A draft recovered from the account on another phone has no local copy.
    // Treating that as an error would dead-end the very list this feature
    // exists to let people clear.
    const { storage } = createStorage();
    const deleteMediaFile = vi.fn(async () => {});
    const service = new MockPitchDraftService(storage, deleteMediaFile);

    const absent = PitchDraftSchema.shape.id.parse('draft-nothing-here');
    await expect(service.deleteDraft(absent)).resolves.toBeUndefined();
    expect(deleteMediaFile).not.toHaveBeenCalled();
  });

  it('reports a partial deletion when a media file could not be removed', async () => {
    const { storage } = createStorage();
    const deleteMediaFile = vi.fn(async (uri: string) => {
      if (uri === 'file:///voice.m4a') throw new Error('file is locked');
    });
    const service = new MockPitchDraftService(storage, deleteMediaFile);
    const id = await createDraft(service);

    const failure = await service.deleteDraft(id).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(PitchDraftDeletionError);
    expect((failure as PitchDraftDeletionError).partial).toBe(true);
    // The draft is still gone: the recording is what survived, and the screen
    // has to say that rather than pretend the phone is clean.
    expect(await service.getMyDrafts()).toEqual([]);
  });
});

describe('HybridPitchDraftService.deleteDraft (server first)', () => {
  it('deletes on the server before removing this device’s copy', async () => {
    const { storage } = createStorage();
    const deleteMediaFile = vi.fn(async () => {});
    const local = new MockPitchDraftService(storage, deleteMediaFile);
    const id = await createDraft(local, { onServer: true });
    const asked: string[] = [];
    const service = new HybridPitchDraftService(
      null,
      local,
      repositoryWith(async (draftId) => {
        // The local copy must still be here when the server is asked.
        expect((await local.getMyDrafts()).map((draft) => draft.id)).toEqual([id]);
        asked.push(draftId);
      }),
    );

    await service.deleteDraft(id);

    expect(asked).toEqual([SERVER_DRAFT_ID]);
    expect(await local.getMyDrafts()).toEqual([]);
    expect(deleteMediaFile).toHaveBeenCalledWith('file:///voice.m4a');
  });

  it('never asks the server about a draft that never reached it', async () => {
    const { storage } = createStorage();
    const local = new MockPitchDraftService(storage, async () => {});
    const id = await createDraft(local);
    const service = new HybridPitchDraftService(null, local, repositoryWith(unexpected));

    await service.deleteDraft(id);

    expect(await local.getMyDrafts()).toEqual([]);
  });

  it.each([
    ['a published pitch is taken down by the person it is about', DELETE_PUBLISHED_MESSAGE],
    ['this pitch is still being processed and cannot be deleted yet', DELETE_IN_FLIGHT_MESSAGE],
    ['this pitch has a purchase attached and cannot be deleted here', DELETE_PURCHASED_MESSAGE],
  ])('keeps everything when the server refuses with "%s"', async (sqlerrm, shown) => {
    const { storage } = createStorage();
    const deleteMediaFile = vi.fn(async () => {});
    const local = new MockPitchDraftService(storage, deleteMediaFile);
    const id = await createDraft(local, { onServer: true });
    const service = new HybridPitchDraftService(
      null,
      local,
      repositoryWith(async () => {
        throw serverRefusal(sqlerrm);
      }),
    );

    const failure = await service.deleteDraft(id).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(PitchDraftDeletionError);
    expect((failure as PitchDraftDeletionError).message).toBe(shown);
    expect((failure as PitchDraftDeletionError).partial).toBe(false);
    // The whole point of server-first: the refusal costs nothing.
    expect((await local.getMyDrafts()).map((draft) => draft.id)).toEqual([id]);
    expect(deleteMediaFile).not.toHaveBeenCalled();
  });

  it('does not invent a reason for a failure the server did not explain', async () => {
    const { storage } = createStorage();
    const deleteMediaFile = vi.fn(async () => {});
    const local = new MockPitchDraftService(storage, deleteMediaFile);
    const id = await createDraft(local, { onServer: true });
    const service = new HybridPitchDraftService(
      null,
      local,
      repositoryWith(async () => {
        throw new Error('network request failed');
      }),
    );

    const failure = await service.deleteDraft(id).catch((error: unknown) => error);

    expect((failure as PitchDraftDeletionError).message).toBe(DELETE_FAILED_MESSAGE);
    expect((await local.getMyDrafts()).map((draft) => draft.id)).toEqual([id]);
    expect(deleteMediaFile).not.toHaveBeenCalled();
  });

  it('refuses to clear a server-backed draft while signed out', async () => {
    // Removing only this device's copy would hide a pitch Friendword still
    // holds — the opposite of what was asked for — and would take the media
    // with it.
    const { storage } = createStorage();
    const deleteMediaFile = vi.fn(async () => {});
    const local = new MockPitchDraftService(storage, deleteMediaFile);
    const id = await createDraft(local, { onServer: true });
    const service = new HybridPitchDraftService(null, local, null);

    const failure = await service.deleteDraft(id).catch((error: unknown) => error);

    expect((failure as PitchDraftDeletionError).message).toBe(DELETE_NEEDS_SIGN_IN_MESSAGE);
    expect((await local.getMyDrafts()).map((draft) => draft.id)).toEqual([id]);
    expect(deleteMediaFile).not.toHaveBeenCalled();
  });
});
