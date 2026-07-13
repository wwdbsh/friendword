import { describe, expect, it } from '../../../../packages/data/node_modules/vitest';
import type { PitchDraftRow } from '@friendword/data';

import { hasFinalizedConsent, MockPitchDraftService, type PitchDraftStorage } from './pitchDrafts';
import { HybridPitchDraftService } from './pitchDraftsSupabase';
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
  relationship_type: 'friend',
  relationship_duration: 'y3to10',
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
});
