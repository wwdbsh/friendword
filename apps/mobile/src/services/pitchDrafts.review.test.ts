import { describe, expect, it, vi } from 'vitest';
import type { ConsentRequestRow, PitchDraftRow } from '@friendword/data';

import { hasFinalizedConsent, MockPitchDraftService, type PitchDraftStorage } from './pitchDrafts';
import { HybridPitchDraftService, isRecoveredServerDraft } from './pitchDraftsSupabase';
import { EMPTY_PITCH_STRUCTURE, type PitchDraftId, type PitchReview } from './types';

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

const SERVER_ROW: PitchDraftRow = {
  id: '10000000-0000-4000-8000-000000000001',
  created_by_user_id: '00000000-0000-4000-8000-000000000001',
  subject_user_id: null,
  status: 'changes_requested',
  headline: REVIEW.headline,
  body: REVIEW.body,
  structure: REVIEW.structure,
  transcript: null,
  audience_policy: null,
  location_precision: null,
  publish_days: null,
  relationship_type: 'friend',
  relationship_duration: 'y3to10',
  created_at: '2026-07-13T00:00:00.000Z',
  updated_at: '2026-07-13T00:00:00.000Z',
};

const CONSENT_REQUEST: ConsentRequestRow = {
  id: '30000000-0000-4000-8000-000000000001',
  pitch_draft_id: SERVER_ROW.id,
  subject_user_id: '00000000-0000-4000-8000-000000000002',
  token_hash: 'hashed-token',
  status: 'claimed',
  responded_at: null,
  invite_contact_channel: 'email',
  invite_contact_hash: 'hashed-contact',
  invite_friend_name: 'Jordan',
  revision_id: '60000000-0000-4000-8000-000000000001',
  response_note: 'Please clarify the story.',
  created_at: '2026-07-13T00:00:00.000Z',
  updated_at: '2026-07-13T00:00:00.000Z',
};

function createService(): MockPitchDraftService {
  const values = new Map<string, string>();
  const storage: PitchDraftStorage = {
    getItem: async (key) => values.get(key) ?? null,
    setItem: async (key, value) => {
      values.set(key, value);
    },
  };
  return new MockPitchDraftService(storage);
}

async function createCompleteDraft(service: MockPitchDraftService): Promise<PitchDraftId> {
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
  return draft.id;
}

describe('pitch draft AI review flow', () => {
  it('keeps the draft editable through generation and finalizes only after review', async () => {
    const service = createService();
    const id = await createCompleteDraft(service);

    const prepared = await service.prepareForReview(id);
    const reviewed = await service.saveReview(id, REVIEW);
    const finalized = await service.finalizeConsent(id);

    expect(prepared.status).toBe('draft');
    expect(reviewed.review).toEqual(REVIEW);
    expect(finalized.status).toBe('consent_pending');
  });

  it('supports the honest manual-writing fallback and blocks an empty finalize', async () => {
    const service = createService();
    const id = await createCompleteDraft(service);
    await service.prepareForReview(id);

    await expect(service.finalizeConsent(id)).rejects.toThrow('Write a headline and body');

    const manualReview: PitchReview = {
      ...REVIEW,
      generationMode: 'manual',
    };
    await service.saveReview(id, manualReview);
    await expect(service.finalizeConsent(id)).resolves.toEqual(
      expect.objectContaining({ status: 'consent_pending', review: manualReview }),
    );
  });

  it('preserves the original token when a changes-requested draft is re-finalized', async () => {
    const service = createService();
    const id = await createCompleteDraft(service);
    await service.saveReview(id, REVIEW);
    await service.attachServerDraft(id, '10000000-0000-4000-8000-000000000001');
    await service.attachFinalizedConsent(id, {
      consentRequestId: '30000000-0000-4000-8000-000000000001',
      consentToken: 'a'.repeat(32),
    });
    await service.syncServerReview(id, {
      status: 'changes_requested',
      review: { ...REVIEW, responseNote: 'Please remove the ownership claim.' },
    });

    await service.saveReview(id, {
      ...REVIEW,
      structure: { ...REVIEW.structure, hard_claims_requiring_confirmation: [] },
    });
    const finalized = await service.attachFinalizedConsent(id, {
      consentRequestId: '30000000-0000-4000-8000-000000000001',
      consentToken: null,
    });

    expect(finalized.status).toBe('consent_pending');
    expect(finalized.server?.consentToken).toBe('a'.repeat(32));
    expect(finalized.review.responseNote).toBeNull();
  });

  it('marks invitation contact purge as eligible only after finalize', async () => {
    const service = createService();
    const id = await createCompleteDraft(service);
    const prepared = await service.attachServerDraft(id, '10000000-0000-4000-8000-000000000001');

    expect(hasFinalizedConsent(prepared)).toBe(false);
    const finalized = await service.attachFinalizedConsent(id, {
      consentRequestId: '30000000-0000-4000-8000-000000000001',
      consentToken: 'a'.repeat(32),
    });
    expect(hasFinalizedConsent(finalized)).toBe(true);
  });

  it('runs the hybrid changes-requested re-finalize without resending contact', async () => {
    const finalizeInvitations: unknown[] = [];
    const local = createService();
    const id = await createCompleteDraft(local);
    await local.saveReview(id, REVIEW);
    await local.attachServerDraft(id, '10000000-0000-4000-8000-000000000001');
    await local.attachFinalizedConsent(id, {
      consentRequestId: '30000000-0000-4000-8000-000000000001',
      consentToken: 'a'.repeat(32),
    });
    await local.purgeInvitationContact(id);
    await local.syncServerReview(id, {
      status: 'changes_requested',
      review: { ...REVIEW, responseNote: 'Please clarify the story.' },
    });
    const unused = async (): Promise<never> => {
      throw new Error('Unexpected repository method');
    };
    const service = new HybridPitchDraftService(null, local, {
      createDraft: unused,
      getDraft: unused,
      listMyConsentRequests: unused,
      listMyDrafts: unused,
      registerAsset: unused,
      requestAssetUpload: unused,
      updateDraft: async () => SERVER_ROW,
      submitForConsent: async (_draftId, invitation) => {
        finalizeInvitations.push(invitation);
        return {
          consentRequestId: '30000000-0000-4000-8000-000000000001',
          consentToken: null,
        };
      },
    });

    const finalized = await service.finalizeConsent(id);

    expect(finalizeInvitations).toEqual([undefined]);
    expect(finalized.status).toBe('consent_pending');
    expect(finalized.server?.consentToken).toBe('a'.repeat(32));
    expect(finalized.review.responseNote).toBeNull();
  });

  it('restores a server-only introducer draft and persists it without duplication', async () => {
    const local = createService();
    const unexpected = async (): Promise<never> => {
      throw new Error('Unexpected repository method');
    };
    const service = new HybridPitchDraftService(null, local, {
      createDraft: unexpected,
      getDraft: unexpected,
      listMyConsentRequests: async () => [CONSENT_REQUEST],
      listMyDrafts: async () => [SERVER_ROW],
      registerAsset: unexpected,
      requestAssetUpload: unexpected,
      submitForConsent: unexpected,
      updateDraft: unexpected,
    });

    const firstLoad = await service.getMyDrafts();
    const secondLoad = await service.getMyDrafts();
    const restored = firstLoad[0];
    if (restored === undefined) {
      throw new Error('Expected a recovered server draft');
    }

    expect(firstLoad).toHaveLength(1);
    expect(secondLoad).toHaveLength(1);
    expect(firstLoad[0]).toEqual(
      expect.objectContaining({
        id: SERVER_ROW.id,
        status: 'changes_requested',
        relationship: expect.objectContaining({
          friendFirstName: 'Jordan',
          contact: { kind: 'sent' },
        }),
        review: expect.objectContaining({
          headline: REVIEW.headline,
          body: REVIEW.body,
          generationMode: 'manual',
          responseNote: 'Please clarify the story.',
        }),
        server: expect.objectContaining({
          draftId: SERVER_ROW.id,
          consentRequestId: CONSENT_REQUEST.id,
        }),
      }),
    );
    expect(isRecoveredServerDraft(restored)).toBe(true);
    await expect(local.getMyDrafts()).resolves.toHaveLength(1);
  });

  it('deduplicates by server draft id while retaining richer local media', async () => {
    const local = createService();
    const localId = await createCompleteDraft(local);
    await local.attachServerDraft(localId, SERVER_ROW.id);
    const unexpected = async (): Promise<never> => {
      throw new Error('Unexpected repository method');
    };
    const service = new HybridPitchDraftService(null, local, {
      createDraft: unexpected,
      getDraft: unexpected,
      listMyConsentRequests: async () => [CONSENT_REQUEST],
      listMyDrafts: async () => [SERVER_ROW],
      registerAsset: unexpected,
      requestAssetUpload: unexpected,
      submitForConsent: unexpected,
      updateDraft: unexpected,
    });

    const drafts = await service.getMyDrafts();
    const merged = drafts[0];
    if (merged === undefined) {
      throw new Error('Expected a merged draft');
    }

    expect(drafts).toHaveLength(1);
    expect(merged.id).toBe(localId);
    expect(merged.photos).toHaveLength(1);
    expect(merged.recording?.uri).toBe('file:///voice.m4a');
    expect(merged.status).toBe('changes_requested');
    expect(isRecoveredServerDraft(merged)).toBe(false);
  });

  it('separates server-draft creation from media upload so consent can run in between', async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn(async () => new Response('', { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      const local = createService();
      const id = await createCompleteDraft(local);
      const assetUploads: string[] = [];
      const registeredAssets: Array<{ kind: string; fileName: string }> = [];
      const unexpected = async (): Promise<never> => {
        throw new Error('Unexpected repository method');
      };
      const service = new HybridPitchDraftService(null, local, {
        createDraft: async () => SERVER_ROW,
        getDraft: unexpected,
        listMyConsentRequests: unexpected,
        listMyDrafts: unexpected,
        registerAsset: async (draftId, kind, fileName, sortOrder) => {
          registeredAssets.push({ kind, fileName });
          return {
            id: `asset-${fileName}`,
            pitch_draft_id: draftId,
            uploaded_by_user_id: '00000000-0000-4000-8000-000000000001',
            asset_type: kind,
            storage_path: `pitch-media/${draftId}/${fileName}`,
            sort_order: sortOrder ?? 0,
            created_at: '2026-07-13T00:00:00.000Z',
            updated_at: '2026-07-13T00:00:00.000Z',
          };
        },
        requestAssetUpload: async (draftId, fileName) => {
          assetUploads.push(fileName);
          return {
            storagePath: `pitch-media/${draftId}/${fileName}`,
            signedUrl: 'https://storage.test/upload',
            token: 'signed-token',
          };
        },
        submitForConsent: unexpected,
        updateDraft: unexpected,
      });

      // Creating the server draft must NOT upload or validate any media —
      // that is what lets consent be recorded before anything is sent out.
      const prepared = await service.prepareForReview(id);
      expect(prepared.server?.draftId).toBe(SERVER_ROW.id);
      expect(assetUploads).toEqual([]);
      expect(registeredAssets).toEqual([]);

      // The explicit second step performs the uploads and registrations.
      await service.uploadDraftMedia(id);
      expect(assetUploads).toEqual(['voice.m4a', 'photo-1.jpg']);
      expect(registeredAssets).toEqual([
        { kind: 'voice', fileName: 'voice.m4a' },
        { kind: 'photo', fileName: 'photo-1.jpg' },
      ]);

      // Idempotent: retrying (e.g. after a transient transcribe failure) must
      // not re-upload — the signed URL is upsert:false and registerAsset would
      // duplicate rows.
      await service.uploadDraftMedia(id);
      expect(assetUploads).toEqual(['voice.m4a', 'photo-1.jpg']);
      expect(registeredAssets).toHaveLength(2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('sorts recovered server drafts by their latest update', async () => {
    const local = createService();
    const olderServerRow: PitchDraftRow = {
      ...SERVER_ROW,
      id: '10000000-0000-4000-8000-000000000002',
      created_at: '2026-07-11T00:00:00.000Z',
      updated_at: '2026-07-12T00:00:00.000Z',
    };
    const unexpected = async (): Promise<never> => {
      throw new Error('Unexpected repository method');
    };
    const service = new HybridPitchDraftService(null, local, {
      createDraft: unexpected,
      getDraft: unexpected,
      listMyConsentRequests: async () => [CONSENT_REQUEST],
      listMyDrafts: async () => [olderServerRow, SERVER_ROW],
      registerAsset: unexpected,
      requestAssetUpload: unexpected,
      submitForConsent: unexpected,
      updateDraft: unexpected,
    });

    const drafts = await service.getMyDrafts();
    const draftsAfterSync = await service.getMyDrafts();

    expect(drafts.map((draft) => draft.id)).toEqual([SERVER_ROW.id, olderServerRow.id]);
    expect(draftsAfterSync.map((draft) => draft.id)).toEqual([SERVER_ROW.id, olderServerRow.id]);
  });
});
