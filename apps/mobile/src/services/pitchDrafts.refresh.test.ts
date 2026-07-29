import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataLayerError } from '@friendword/data';
import type { ConsentRequestRow, PitchDraftRow } from '@friendword/data';

import { MockPitchDraftService, type PitchDraftStorage } from './pitchDrafts';
import { HybridPitchDraftService } from './pitchDraftsSupabase';
import { EMPTY_PITCH_STRUCTURE, type PitchDraftId, type PitchReview } from './types';

const SERVER_DRAFT_ID = '10000000-0000-4000-8000-000000000001';
const CONSENT_REQUEST_ID = '30000000-0000-4000-8000-000000000001';
const CONSENT_TOKEN = 'pWnhpdxKfdZx9-XwDwQ23MrZ0e0thzvn';

// PostgREST renders `timestamptz` with a numeric offset and microsecond
// precision, never the "Z" instant the local draft schema accepts. The year is
// far out so the row always looks newer than the just-written local draft,
// which is what makes the sync adopt the server timestamp.
const POSTGREST_UPDATED_AT = '2099-01-01T00:00:00.123456+00:00';
const POSTGREST_CREATED_AT = '2098-01-01T00:00:00.654321+00:00';

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
  id: SERVER_DRAFT_ID,
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
  created_at: POSTGREST_CREATED_AT,
  updated_at: POSTGREST_UPDATED_AT,
};

const CONSENT_REQUEST: ConsentRequestRow = {
  id: CONSENT_REQUEST_ID,
  pitch_draft_id: SERVER_DRAFT_ID,
  subject_user_id: '00000000-0000-4000-8000-000000000002',
  token_hash: 'hashed-token',
  status: 'pending',
  responded_at: null,
  invite_contact_channel: 'email',
  invite_contact_hash: 'hashed-contact',
  invite_friend_name: 'Jordan',
  revision_id: '60000000-0000-4000-8000-000000000001',
  response_note: null,
  created_at: POSTGREST_CREATED_AT,
  updated_at: POSTGREST_UPDATED_AT,
};

const unexpected = async (): Promise<never> => {
  throw new Error('Unexpected repository method');
};

function createLocalService(): MockPitchDraftService {
  const values = new Map<string, string>();
  const storage: PitchDraftStorage = {
    getItem: async (key) => values.get(key) ?? null,
    setItem: async (key, value) => {
      values.set(key, value);
    },
  };
  return new MockPitchDraftService(storage);
}

/** A draft in the state the share screen loads: submitted, token held locally. */
async function createSubmittedDraft(local: MockPitchDraftService): Promise<PitchDraftId> {
  const draft = await local.createDraft();
  await local.saveRelationship(draft.id, {
    kind: 'Friend',
    duration: '3–10 years',
    friendFirstName: 'Jordan',
    contact: { kind: 'email', value: 'friend@example.com' },
  });
  await local.savePhotos(draft.id, [{ uri: 'file:///one.jpg', width: 100, height: 100 }]);
  await local.saveRecording(draft.id, {
    uri: 'file:///voice.m4a',
    durationMillis: 30_000,
    caption: 'A real story about Jordan.',
  });
  await local.saveReview(draft.id, REVIEW);
  await local.attachServerDraft(draft.id, SERVER_DRAFT_ID);
  await local.attachFinalizedConsent(draft.id, {
    consentRequestId: CONSENT_REQUEST_ID,
    consentToken: CONSENT_TOKEN,
  });
  return draft.id;
}

describe('draft list resilience to a slow or failing server refresh', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the locally held invite when the server refresh never settles', async () => {
    const local = createLocalService();
    const id = await createSubmittedDraft(local);
    const service = new HybridPitchDraftService(
      null,
      local,
      {
        createDraft: unexpected,
        getDraft: unexpected,
        listMyConsentRequests: async () => [CONSENT_REQUEST],
        listMyDrafts: () => new Promise<readonly PitchDraftRow[]>(() => undefined),
        registerAsset: unexpected,
        requestAssetUpload: unexpected,
        submitForConsent: unexpected,
        updateDraft: unexpected,
      },
      20,
    );

    const drafts = await service.getMyDrafts();

    expect(drafts.map((draft) => draft.id)).toEqual([id]);
    expect(drafts[0]?.server?.consentToken).toBe(CONSENT_TOKEN);
  });

  it('returns the locally held invite when the server refresh rejects', async () => {
    const local = createLocalService();
    const id = await createSubmittedDraft(local);
    const service = new HybridPitchDraftService(null, local, {
      createDraft: unexpected,
      getDraft: unexpected,
      listMyConsentRequests: async () => [CONSENT_REQUEST],
      listMyDrafts: async () => {
        throw new DataLayerError('pitchDraft.listMine', { message: 'network request failed' });
      },
      registerAsset: unexpected,
      requestAssetUpload: unexpected,
      submitForConsent: unexpected,
      updateDraft: unexpected,
    });

    const drafts = await service.getMyDrafts();

    expect(drafts.map((draft) => draft.id)).toEqual([id]);
    expect(drafts[0]?.server?.consentToken).toBe(CONSENT_TOKEN);
  });

  it('syncs a server row whose timestamp carries a PostgREST offset', async () => {
    const local = createLocalService();
    const id = await createSubmittedDraft(local);
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

    expect(drafts.map((draft) => draft.id)).toEqual([id]);
    // The refresh actually landed rather than being swallowed by the fallback.
    expect(drafts[0]?.status).toBe('changes_requested');
    expect(drafts[0]?.updatedAt).toBe('2099-01-01T00:00:00.123Z');
    expect(drafts[0]?.server?.consentToken).toBe(CONSENT_TOKEN);
  });

  it('recovers a server-only draft whose timestamps carry a PostgREST offset', async () => {
    const local = createLocalService();
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

    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.id).toBe(SERVER_DRAFT_ID);
    expect(drafts[0]?.createdAt).toBe('2098-01-01T00:00:00.654Z');
  });
});
