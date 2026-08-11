import { describe, expect, it, vi } from 'vitest';

import { MockPitchDraftService, type PitchDraftStorage } from './pitchDrafts';
import { shouldPurgeConsentTokensOnAuthChange } from './authDraftPurge';
import { EMPTY_PITCH_STRUCTURE, type PitchDraftId, type PitchReview } from './types';

const STORAGE_KEY = '@friendword/pitch-drafts';
const TOKEN = 'a'.repeat(32);
const SERVER_DRAFT_ID = '10000000-0000-4000-8000-000000000001';
const CONSENT_REQUEST_ID = '30000000-0000-4000-8000-000000000001';

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

async function createSubmittedDraft(
  service: MockPitchDraftService,
  options: { readonly mediaUploaded?: boolean } = {},
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
  await service.attachServerDraft(draft.id, SERVER_DRAFT_ID);
  if (options.mediaUploaded === true) {
    await service.markDraftMediaUploaded(draft.id);
  }
  await service.attachFinalizedConsent(draft.id, {
    consentRequestId: CONSENT_REQUEST_ID,
    consentToken: TOKEN,
  });
  return draft.id;
}

async function firstDraft(service: MockPitchDraftService) {
  const [draft] = await service.getMyDrafts();
  return draft;
}

describe('consent token purge on server-observed termination', () => {
  it.each(['approved', 'expired', 'archived'] as const)(
    'drops the raw consent token when the draft syncs to the terminal status %s',
    async (status) => {
      const { storage, values } = createStorage();
      const service = new MockPitchDraftService(storage);
      const id = await createSubmittedDraft(service);

      await service.syncServerReview(id, { status, review: REVIEW });

      const draft = await firstDraft(service);
      expect(draft.server?.consentToken).toBeNull();
      expect(values.get(STORAGE_KEY)).not.toContain(TOKEN);
    },
  );

  it('keeps the token while awaiting a response and through changes_requested', async () => {
    const { storage } = createStorage();
    const service = new MockPitchDraftService(storage);
    const id = await createSubmittedDraft(service);

    await service.syncServerReview(id, {
      status: 'changes_requested',
      review: { ...REVIEW, responseNote: 'Please clarify the story.' },
    });

    const draft = await firstDraft(service);
    expect(draft.server?.consentToken).toBe(TOKEN);
  });
});

describe('publish purge of uploaded local media', () => {
  it('removes uploaded recording and photo URIs and deletes the local files on publish', async () => {
    const { storage, values } = createStorage();
    const deleteMediaFile = vi.fn(async () => {});
    const service = new MockPitchDraftService(storage, deleteMediaFile);
    const id = await createSubmittedDraft(service, { mediaUploaded: true });

    await service.syncServerReview(id, { status: 'published', review: REVIEW });

    const draft = await firstDraft(service);
    expect(draft.server?.consentToken).toBeNull();
    expect(draft.recording).toBeNull();
    expect(draft.photos).toEqual([]);
    expect(deleteMediaFile).toHaveBeenCalledWith('file:///voice.m4a');
    expect(deleteMediaFile).toHaveBeenCalledWith('file:///one.jpg');
    const serialized = values.get(STORAGE_KEY) ?? '';
    expect(serialized).not.toContain('file:///voice.m4a');
    expect(serialized).not.toContain('file:///one.jpg');
  });

  it('removes the local copy of an uploaded clip on publish', async () => {
    const { storage, values } = createStorage();
    const deleteMediaFile = vi.fn(async () => {});
    const service = new MockPitchDraftService(storage, deleteMediaFile);
    const id = await createSubmittedDraft(service, { mediaUploaded: true });
    await service.saveClips(id, [
      {
        uri: 'file:///beach.mov',
        width: 1080,
        height: 1920,
        durationMillis: 9_000,
        byteSize: 8_000_000,
        mimeType: 'video/quicktime',
      },
    ]);

    await service.syncServerReview(id, { status: 'published', review: REVIEW });

    const draft = await firstDraft(service);
    expect(draft.clips).toEqual([]);
    expect(deleteMediaFile).toHaveBeenCalledWith('file:///beach.mov');
    expect(values.get(STORAGE_KEY) ?? '').not.toContain('file:///beach.mov');
  });

  it('preserves local media that has not been uploaded to the server yet', async () => {
    const { storage } = createStorage();
    const deleteMediaFile = vi.fn(async () => {});
    const service = new MockPitchDraftService(storage, deleteMediaFile);
    const id = await createSubmittedDraft(service, { mediaUploaded: false });

    await service.syncServerReview(id, { status: 'published', review: REVIEW });

    const draft = await firstDraft(service);
    expect(draft.recording?.uri).toBe('file:///voice.m4a');
    expect(draft.photos).toHaveLength(1);
    expect(deleteMediaFile).not.toHaveBeenCalled();
    // The bearer token is still purged even when media is retained.
    expect(draft.server?.consentToken).toBeNull();
  });

  it('exposes an explicit publish purge entry point', async () => {
    const { storage } = createStorage();
    const deleteMediaFile = vi.fn(async () => {});
    const service = new MockPitchDraftService(storage, deleteMediaFile);
    const id = await createSubmittedDraft(service, { mediaUploaded: true });

    const purged = await service.purgeSensitiveDraftData(id, 'publish');

    expect(purged.server?.consentToken).toBeNull();
    expect(purged.recording).toBeNull();
    expect(deleteMediaFile).toHaveBeenCalledWith('file:///voice.m4a');
  });
});

describe('account switch / logout token purge', () => {
  it('removes the consent token from every stored draft', async () => {
    const { storage, values } = createStorage();
    const service = new MockPitchDraftService(storage);
    await createSubmittedDraft(service);

    const removed = await service.purgeAllConsentTokens();

    expect(removed).toBe(1);
    const drafts = await service.getMyDrafts();
    expect(drafts.every((draft) => draft.server?.consentToken == null)).toBe(true);
    expect(values.get(STORAGE_KEY)).not.toContain(TOKEN);
  });

  it('leaves local media untouched on a bulk token purge', async () => {
    const { storage } = createStorage();
    const service = new MockPitchDraftService(storage);
    const id = await createSubmittedDraft(service, { mediaUploaded: true });

    await service.purgeAllConsentTokens();

    const [draft] = (await service.getMyDrafts()).filter((candidate) => candidate.id === id);
    expect(draft?.recording?.uri).toBe('file:///voice.m4a');
    expect(draft?.photos).toHaveLength(1);
  });
});

describe('legacy draft compatibility', () => {
  it('loads and purges a draft persisted before the mediaUploaded field existed', async () => {
    const { storage, values } = createStorage();
    values.set(
      STORAGE_KEY,
      JSON.stringify([
        {
          id: 'legacy-draft',
          status: 'consent_pending',
          contextRole: 'INTRODUCER',
          relationship: {
            kind: 'Friend',
            duration: '3–10 years',
            friendFirstName: 'Jordan',
            contact: { kind: 'sent' },
          },
          photos: [],
          recording: null,
          server: {
            draftId: SERVER_DRAFT_ID,
            consentRequestId: CONSENT_REQUEST_ID,
            consentToken: TOKEN,
          },
          createdAt: '2026-07-13T00:00:00.000Z',
          updatedAt: '2026-07-13T00:00:00.000Z',
        },
      ]),
    );
    const service = new MockPitchDraftService(storage);

    const loaded = await firstDraft(service);
    expect(loaded.server?.mediaUploaded).toBe(false);

    const removed = await service.purgeAllConsentTokens();
    expect(removed).toBe(1);
    expect(values.get(STORAGE_KEY)).not.toContain(TOKEN);
  });
});

describe('auth-change purge policy', () => {
  it('purges on sign-out', () => {
    expect(shouldPurgeConsentTokensOnAuthChange('SIGNED_OUT', 'user-1', null)).toBe(true);
  });

  it('purges when a different account signs in', () => {
    expect(shouldPurgeConsentTokensOnAuthChange('SIGNED_IN', 'user-1', 'user-2')).toBe(true);
  });

  it('does not purge on a cold-start sign-in or a token refresh for the same user', () => {
    expect(shouldPurgeConsentTokensOnAuthChange('SIGNED_IN', undefined, 'user-1')).toBe(false);
    expect(shouldPurgeConsentTokensOnAuthChange('SIGNED_IN', 'user-1', 'user-1')).toBe(false);
    expect(shouldPurgeConsentTokensOnAuthChange('TOKEN_REFRESHED', 'user-1', 'user-1')).toBe(false);
  });
});

describe('account deletion purge of every local draft', () => {
  it('erases the drafts and deletes their media, uploaded or not', async () => {
    // Sign-out keeps drafts (the same person comes back). Account deletion is
    // the opposite case: the server copy is being erased, so a recording left
    // on this phone would be the only copy nobody can reach to delete.
    const { storage, values } = createStorage();
    const deleteMediaFile = vi.fn(async () => {});
    const service = new MockPitchDraftService(storage, deleteMediaFile);
    await createSubmittedDraft(service);

    await expect(service.eraseAllLocalDrafts()).resolves.toEqual({
      erasedDrafts: 1,
      complete: true,
    });

    await expect(service.getMyDrafts()).resolves.toEqual([]);
    expect(deleteMediaFile).toHaveBeenCalledWith('file:///voice.m4a');
    expect(deleteMediaFile).toHaveBeenCalledWith('file:///one.jpg');
    const serialized = values.get(STORAGE_KEY) ?? '';
    expect(serialized).not.toContain('file:///voice.m4a');
    expect(serialized).not.toContain(TOKEN);
  });

  it('is a no-op with nothing stored', async () => {
    const { storage } = createStorage();
    const deleteMediaFile = vi.fn(async () => {});
    const service = new MockPitchDraftService(storage, deleteMediaFile);

    await expect(service.eraseAllLocalDrafts()).resolves.toEqual({
      erasedDrafts: 0,
      complete: true,
    });

    expect(deleteMediaFile).not.toHaveBeenCalled();
  });

  // The blob is unreadable, so the media files cannot be named — but the blob
  // is still full of personal data. Refusing to clear it because the parse
  // failed would leave a raw consent bearer token and the invited friend's
  // email address on a phone whose account no longer exists.
  it('clears the stored blob even when it cannot be parsed', async () => {
    const { storage, values } = createStorage();
    const deleteMediaFile = vi.fn(async () => {});
    const service = new MockPitchDraftService(storage, deleteMediaFile);
    await createSubmittedDraft(service);
    const stored = values.get(STORAGE_KEY) ?? '';
    expect(stored).toContain(TOKEN);
    values.set(STORAGE_KEY, `${stored.slice(0, 40)} not json at all ${TOKEN}`);

    await expect(service.eraseAllLocalDrafts()).resolves.toEqual({
      erasedDrafts: 0,
      // Honest: the token blob is gone, the media files were never named.
      complete: false,
    });

    expect(values.get(STORAGE_KEY)).toBe('[]');
    expect(values.get(STORAGE_KEY) ?? '').not.toContain(TOKEN);
  });

  it('reports an incomplete erasure when a media file will not delete', async () => {
    const { storage } = createStorage();
    const deleteMediaFile = vi.fn(async (uri: string) => {
      if (uri === 'file:///voice.m4a') throw new Error('file busy');
    });
    const service = new MockPitchDraftService(storage, deleteMediaFile);
    await createSubmittedDraft(service);

    await expect(service.eraseAllLocalDrafts()).resolves.toEqual({
      erasedDrafts: 1,
      complete: false,
    });

    // One rejection must not stop the rest of the media from going.
    expect(deleteMediaFile).toHaveBeenCalledWith('file:///one.jpg');
  });
});
