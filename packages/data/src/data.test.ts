import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createClient } from '@supabase/supabase-js';

import {
  confirmDisplayName,
  ensureUserRow,
  getDisplayNameStatus,
  signInWithOtp,
  verifyOtp,
} from './auth';
import {
  createBrowserClient,
  createMobileClient,
  createServiceClient,
  createWebClient,
  type BrowserSupabaseClient,
  type ServiceSupabaseClient,
} from './client';
import { ConsentRepo } from './consentRepo';
import {
  DataLayerError,
  InvalidDraftUpdateError,
  InvalidStoragePathError,
  UnauthenticatedError,
} from './errors';
import { buildPitchMediaPath, PitchDraftRepo } from './pitchDraftRepo';
import { InterestRepo } from './interestRepo';
import {
  ageFromBirthDate,
  canonicalApproximateLocation,
  getPublishedPitchBySlug,
} from './publishedPitchRepo';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getSession: vi.fn(),
  signInWithOtp: vi.fn(),
  verifyOtp: vi.fn(),
  usersUpsert: vi.fn(),
  profilesUpsert: vi.fn(),
  profilesSelect: vi.fn(),
  profilesSelectEq: vi.fn(),
  profilesSelectSingle: vi.fn(),
  profilesUpdate: vi.fn(),
  profilesUpdateEq: vi.fn(),
  profilesUpdateSelect: vi.fn(),
  profilesUpdateSingle: vi.fn(),
  draftInsert: vi.fn(),
  draftUpdate: vi.fn(),
  draftSelect: vi.fn(),
  consentRequestSelect: vi.fn(),
  consentRevisionSelect: vi.fn(),
  consentAssetSelect: vi.fn(),
  signedUpload: vi.fn(),
  uploadSigned: vi.fn(),
  signedUrl: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: mocks.createClient,
}));

function configureMockClient(): void {
  mocks.createClient.mockReturnValue({
    auth: {
      getSession: mocks.getSession,
      signInWithOtp: mocks.signInWithOtp,
      verifyOtp: mocks.verifyOtp,
    },
    from: (table: string) => {
      if (table === 'users') {
        return { upsert: mocks.usersUpsert };
      }
      if (table === 'profiles') {
        return {
          upsert: mocks.profilesUpsert,
          select: mocks.profilesSelect,
          update: mocks.profilesUpdate,
        };
      }
      if (table === 'consent_requests') {
        return { select: mocks.consentRequestSelect };
      }
      if (table === 'consent_revisions') {
        return { select: mocks.consentRevisionSelect };
      }
      if (table === 'pitch_assets') {
        return {
          insert: mocks.draftInsert,
          select: mocks.consentAssetSelect,
        };
      }
      return {
        insert: mocks.draftInsert,
        update: mocks.draftUpdate,
        select: mocks.draftSelect,
      };
    },
    storage: {
      from: () => ({
        createSignedUploadUrl: mocks.signedUpload,
        uploadToSignedUrl: mocks.uploadSigned,
        createSignedUrl: mocks.signedUrl,
      }),
    },
    rpc: mocks.rpc,
  });
}

describe('Supabase clients and auth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configureMockClient();
    mocks.signInWithOtp.mockResolvedValue({ data: {}, error: null });
    mocks.verifyOtp.mockResolvedValue({ data: { session: null }, error: null });
    mocks.usersUpsert.mockResolvedValue({ error: null });
    mocks.profilesUpsert.mockResolvedValue({ error: null });
    mocks.profilesSelect.mockReturnValue({ eq: mocks.profilesSelectEq });
    mocks.profilesSelectEq.mockReturnValue({ single: mocks.profilesSelectSingle });
    mocks.profilesUpdate.mockReturnValue({ eq: mocks.profilesUpdateEq });
    mocks.profilesUpdateEq.mockReturnValue({ select: mocks.profilesUpdateSelect });
    mocks.profilesUpdateSelect.mockReturnValue({ single: mocks.profilesUpdateSingle });
    mocks.profilesUpdateSingle.mockResolvedValue({
      data: { user_id: '00000000-0000-0000-0000-000000000001' },
      error: null,
    });
  });

  it('configures the browser client with the supplied anonymous key', () => {
    createBrowserClient('https://project.example', 'anon-key');

    expect(vi.mocked(createClient)).toHaveBeenCalledWith('https://project.example', 'anon-key');
  });

  it('persists mobile sessions in the provided async storage without URL detection', () => {
    const storage = {
      getItem: vi.fn().mockResolvedValue(null),
      setItem: vi.fn().mockResolvedValue(undefined),
      removeItem: vi.fn().mockResolvedValue(undefined),
    };

    createMobileClient('https://project.example', 'anon-key', storage);

    expect(vi.mocked(createClient)).toHaveBeenCalledWith('https://project.example', 'anon-key', {
      auth: {
        storage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    });
  });

  it('detects URL sessions under a stable storage key for the web client', () => {
    createWebClient('https://project.example', 'anon-key');

    expect(vi.mocked(createClient)).toHaveBeenCalledWith('https://project.example', 'anon-key', {
      auth: {
        storageKey: 'friendword-web-auth',
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
      },
    });
  });

  it('disables persisted auth when creating a service client', () => {
    createServiceClient('https://project.example', 'service-key');

    expect(vi.mocked(createClient)).toHaveBeenCalledWith('https://project.example', 'service-key', {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    });
  });

  it('keeps service clients outside the browser-client repository type', () => {
    type ServiceIsRejected = ServiceSupabaseClient extends BrowserSupabaseClient ? false : true;
    const serviceIsRejected: ServiceIsRejected = true;

    expect(serviceIsRejected).toBe(true);
  });

  it('triggers email OTP and verifies it with email type', async () => {
    const client = createBrowserClient('https://project.example', 'anon-key');

    await signInWithOtp(client, 'person@example.com');
    await verifyOtp(client, 'person@example.com', '123456');

    expect(mocks.signInWithOtp).toHaveBeenCalledWith({ email: 'person@example.com' });
    expect(mocks.verifyOtp).toHaveBeenCalledWith({
      email: 'person@example.com',
      token: '123456',
      type: 'email',
    });
  });

  it('passes the magic-link redirect through only when provided', async () => {
    const client = createBrowserClient('https://project.example', 'anon-key');

    await signInWithOtp(client, 'person@example.com', {
      emailRedirectTo: 'https://friendword.example/consent/abc',
    });

    expect(mocks.signInWithOtp).toHaveBeenCalledWith({
      email: 'person@example.com',
      options: { emailRedirectTo: 'https://friendword.example/consent/abc' },
    });
  });

  it('rejects user-row provisioning when no session exists', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: null }, error: null });
    const client = createBrowserClient('https://project.example', 'anon-key');

    await expect(ensureUserRow(client)).rejects.toBeInstanceOf(UnauthenticatedError);
    expect(mocks.usersUpsert).not.toHaveBeenCalled();
  });

  it('upserts only client-writable user and profile fields when signed in', async () => {
    mocks.getSession.mockResolvedValue({
      data: {
        session: {
          user: {
            id: '00000000-0000-0000-0000-000000000001',
            email: 'person@example.com',
            user_metadata: { display_name: 'Person' },
          },
        },
      },
      error: null,
    });
    const client = createBrowserClient('https://project.example', 'anon-key');

    const result = await ensureUserRow(client);

    expect(mocks.usersUpsert).toHaveBeenCalledWith(
      { id: '00000000-0000-0000-0000-000000000001' },
      { ignoreDuplicates: true, onConflict: 'id' },
    );
    expect(mocks.profilesUpsert).toHaveBeenCalledWith(
      {
        user_id: '00000000-0000-0000-0000-000000000001',
        display_name: 'Person',
      },
      { ignoreDuplicates: true, onConflict: 'user_id' },
    );
    expect(result.profileDisplayName).toBe('Person');
  });

  it('marks a display name confirmed only when the caller explicitly supplies it', async () => {
    mocks.getSession.mockResolvedValue({
      data: {
        session: {
          user: {
            id: '00000000-0000-0000-0000-000000000001',
            email: 'fallback@example.com',
            user_metadata: {},
          },
        },
      },
      error: null,
    });
    const client = createBrowserClient('https://project.example', 'anon-key');

    const result = await ensureUserRow(client, { confirmedDisplayName: '  Chosen Name  ' });

    expect(mocks.profilesUpsert).toHaveBeenCalledWith(
      {
        user_id: '00000000-0000-0000-0000-000000000001',
        display_name: 'Chosen Name',
        display_name_confirmed: true,
      },
      { onConflict: 'user_id' },
    );
    expect(result.profileDisplayName).toBe('Chosen Name');
  });

  it('reads the current display name confirmation state for the signed-in user', async () => {
    mocks.getSession.mockResolvedValue({
      data: {
        session: { user: { id: '00000000-0000-0000-0000-000000000001' } },
      },
      error: null,
    });
    mocks.profilesSelectSingle.mockResolvedValue({
      data: { display_name: 'Fallback', display_name_confirmed: false },
      error: null,
    });
    const client = createBrowserClient('https://project.example', 'anon-key');

    const status = await getDisplayNameStatus(client);

    expect(mocks.profilesSelect).toHaveBeenCalledWith('display_name, display_name_confirmed');
    expect(mocks.profilesSelectEq).toHaveBeenCalledWith(
      'user_id',
      '00000000-0000-0000-0000-000000000001',
    );
    expect(status).toEqual({ displayName: 'Fallback', confirmed: false });
  });

  it('confirms a trimmed display name on only the signed-in profile', async () => {
    mocks.getSession.mockResolvedValue({
      data: {
        session: { user: { id: '00000000-0000-0000-0000-000000000001' } },
      },
      error: null,
    });
    const client = createBrowserClient('https://project.example', 'anon-key');

    await confirmDisplayName(client, '  Approved Name  ');

    expect(mocks.profilesUpdate).toHaveBeenCalledWith({
      display_name: 'Approved Name',
      display_name_confirmed: true,
    });
    expect(mocks.profilesUpdateEq).toHaveBeenCalledWith(
      'user_id',
      '00000000-0000-0000-0000-000000000001',
    );
    expect(mocks.profilesUpdateSelect).toHaveBeenCalledWith('user_id');
  });

  it('rejects display name confirmation when no profile row is updated', async () => {
    mocks.getSession.mockResolvedValue({
      data: {
        session: { user: { id: '00000000-0000-0000-0000-000000000001' } },
      },
      error: null,
    });
    mocks.profilesUpdateSingle.mockResolvedValue({
      data: null,
      error: { message: 'JSON object requested, multiple (or no) rows returned' },
    });
    const client = createBrowserClient('https://project.example', 'anon-key');

    await expect(confirmDisplayName(client, 'Approved Name')).rejects.toBeInstanceOf(
      DataLayerError,
    );
  });
});

describe('PitchDraftRepo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configureMockClient();
    mocks.getSession.mockResolvedValue({
      data: {
        session: {
          user: { id: '00000000-0000-0000-0000-000000000001' },
        },
      },
      error: null,
    });
  });

  it('builds the required private bucket path and rejects traversal', () => {
    const draftId = '10000000-0000-0000-0000-000000000001';

    expect(buildPitchMediaPath(draftId, 'voice.m4a')).toBe(`${'pitch-media'}/${draftId}/voice.m4a`);
    expect(() => buildPitchMediaPath(draftId, '../voice.m4a')).toThrow();
    expect(() => buildPitchMediaPath(draftId, '.')).toThrow();
    expect(() => buildPitchMediaPath(draftId, '..')).toThrow();
    expect(() => buildPitchMediaPath(draftId, '%2e%2e')).toThrow();
    expect(() => buildPitchMediaPath(draftId, ' voice.m4a')).toThrow();
  });

  it('maps relationship context into a new draft row', async () => {
    const row = {
      id: '10000000-0000-0000-0000-000000000003',
      created_by_user_id: '00000000-0000-0000-0000-000000000001',
      subject_user_id: null,
      status: 'draft',
      headline: null,
      body: null,
      relationship_type: 'friend',
      relationship_duration: 'y3to10',
      created_at: '2026-07-12T00:00:00Z',
      updated_at: '2026-07-12T00:00:00Z',
    };
    mocks.draftInsert.mockReturnValue({
      select: () => ({ single: async () => ({ data: row, error: null }) }),
    });
    const client = createBrowserClient('https://project.example', 'anon-key');
    const repo = new PitchDraftRepo(client);

    const result = await repo.createDraft({
      relationshipType: 'friend',
      relationshipDuration: 'y3to10',
    });

    expect(mocks.draftInsert).toHaveBeenCalledWith({
      created_by_user_id: '00000000-0000-0000-0000-000000000001',
      relationship_type: 'friend',
      relationship_duration: 'y3to10',
    });
    expect(result).toEqual(row);
  });

  it('updates editable draft content without exposing server-owned status', async () => {
    const row = {
      id: '10000000-0000-0000-0000-000000000003',
      headline: 'A better introduction',
    };
    mocks.draftUpdate.mockReturnValue({
      eq: () => ({ select: () => ({ single: async () => ({ data: row, error: null }) }) }),
    });
    const client = createBrowserClient('https://project.example', 'anon-key');
    const repo = new PitchDraftRepo(client);

    const result = await repo.updateDraft('10000000-0000-0000-0000-000000000003', {
      headline: 'A better introduction',
    });

    expect(mocks.draftUpdate).toHaveBeenCalledWith({ headline: 'A better introduction' });
    expect(result).toEqual(row);
  });

  it('rejects an empty draft update before issuing a query', async () => {
    const client = createBrowserClient('https://project.example', 'anon-key');
    const repo = new PitchDraftRepo(client);

    await expect(
      repo.updateDraft('10000000-0000-0000-0000-000000000003', {}),
    ).rejects.toBeInstanceOf(InvalidDraftUpdateError);
    expect(mocks.draftUpdate).not.toHaveBeenCalled();
  });

  it('lists RLS-visible drafts in newest-first order', async () => {
    const rows = [{ id: '10000000-0000-0000-0000-000000000003' }];
    mocks.draftSelect.mockReturnValue({
      order: async () => ({ data: rows, error: null }),
    });
    const client = createBrowserClient('https://project.example', 'anon-key');
    const repo = new PitchDraftRepo(client);

    const result = await repo.listMyDrafts();

    expect(mocks.draftSelect).toHaveBeenCalledWith();
    expect(result).toEqual(rows);
  });

  it('requests a signed upload using the bucket-relative object path', async () => {
    const draftId = '10000000-0000-0000-0000-000000000001';
    mocks.signedUpload.mockResolvedValue({
      data: {
        path: `${draftId}/voice.m4a`,
        signedUrl: 'https://storage.example/signed',
        token: 'upload-token',
      },
      error: null,
    });
    const client = createBrowserClient('https://project.example', 'anon-key');
    const repo = new PitchDraftRepo(client);

    const result = await repo.requestAssetUpload(draftId, 'voice.m4a');

    expect(mocks.signedUpload).toHaveBeenCalledWith(`${draftId}/voice.m4a`, { upsert: false });
    expect(result.storagePath).toBe(`pitch-media/${draftId}/voice.m4a`);
  });

  it('rejects noncanonical filenames before requesting a signed upload', async () => {
    const draftId = '10000000-0000-0000-0000-000000000001';
    const client = createBrowserClient('https://project.example', 'anon-key');
    const repo = new PitchDraftRepo(client);

    await expect(repo.requestAssetUpload(draftId, '..')).rejects.toBeInstanceOf(
      InvalidStoragePathError,
    );
    await expect(repo.requestAssetUpload(draftId, '%2e%2e')).rejects.toBeInstanceOf(
      InvalidStoragePathError,
    );
    expect(mocks.signedUpload).not.toHaveBeenCalled();
  });

  it('registers an uploaded asset with its canonical storage path', async () => {
    const draftId = '10000000-0000-0000-0000-000000000001';
    const row = {
      id: '40000000-0000-0000-0000-000000000001',
      pitch_draft_id: draftId,
      asset_type: 'photo',
      storage_path: `pitch-media/${draftId}/photo-1.jpg`,
      sort_order: 0,
    };
    mocks.draftInsert.mockReturnValue({
      select: () => ({ single: async () => ({ data: row, error: null }) }),
    });
    const client = createBrowserClient('https://project.example', 'anon-key');
    const repo = new PitchDraftRepo(client);

    const result = await repo.registerAsset(draftId, 'photo', 'photo-1.jpg', 0);

    expect(mocks.draftInsert).toHaveBeenCalledWith({
      pitch_draft_id: draftId,
      uploaded_by_user_id: '00000000-0000-0000-0000-000000000001',
      asset_type: 'photo',
      storage_path: `pitch-media/${draftId}/photo-1.jpg`,
      sort_order: 0,
    });
    expect(result).toEqual(row);
    await expect(repo.registerAsset(draftId, 'photo', '../evil.jpg')).rejects.toBeInstanceOf(
      InvalidStoragePathError,
    );
  });

  it('submits a draft for consent through the server RPC and maps the token', async () => {
    const draftId = '10000000-0000-0000-0000-000000000001';
    mocks.rpc.mockResolvedValue({
      data: [
        {
          consent_request_id: '30000000-0000-0000-0000-000000000001',
          consent_token: 'a'.repeat(32),
        },
      ],
      error: null,
    });
    const client = createBrowserClient('https://project.example', 'anon-key');
    const repo = new PitchDraftRepo(client);

    const result = await repo.submitForConsent(draftId);

    expect(mocks.rpc).toHaveBeenCalledWith('submit_pitch_for_consent', { draft_id: draftId });
    expect(result.consentRequestId).toBe('30000000-0000-0000-0000-000000000001');
    expect(result.consentToken).toBe('a'.repeat(32));
  });

  it('rejects a consent submission when no session exists', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: null }, error: null });
    const client = createBrowserClient('https://project.example', 'anon-key');
    const repo = new PitchDraftRepo(client);

    await expect(
      repo.submitForConsent('10000000-0000-0000-0000-000000000001'),
    ).rejects.toBeInstanceOf(UnauthenticatedError);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe('ConsentRepo', () => {
  const rawToken = 'A-b_1'.repeat(6);
  const draftId = '10000000-0000-0000-0000-000000000001';
  const revisionId = '30000000-0000-0000-0000-000000000001';
  const firstPhotoId = '40000000-0000-0000-0000-000000000001';
  const secondPhotoId = '40000000-0000-0000-0000-000000000002';
  const voiceAssetId = '40000000-0000-0000-0000-000000000003';

  function signedInSession(): void {
    mocks.getSession.mockResolvedValue({
      data: {
        session: {
          user: { id: '00000000-0000-0000-0000-000000000002' },
        },
      },
      error: null,
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    configureMockClient();
  });

  it('previews anonymously and maps the RPC row', async () => {
    mocks.rpc.mockResolvedValue({
      data: [
        {
          introducer_display_name: 'Maya',
          relationship_type: 'friend',
          relationship_duration: 'y3to10',
          request_status: 'pending',
        },
      ],
      error: null,
    });
    const repo = new ConsentRepo(createBrowserClient('https://project.example', 'anon-key'));

    const preview = await repo.getPreview(rawToken);

    expect(mocks.rpc).toHaveBeenCalledWith('get_consent_preview', { raw_token: rawToken });
    expect(mocks.getSession).not.toHaveBeenCalled();
    expect(preview).toEqual({
      introducerDisplayName: 'Maya',
      relationshipType: 'friend',
      relationshipDuration: 'y3to10',
      requestStatus: 'pending',
    });
  });

  // 0061 returns NULL for `introducer_display_name` when the introducer has not
  // confirmed their name. The repo must carry that null through rather than
  // failing the parse — this page is the dater's only way to answer the invite.
  it('carries a withheld introducer name through as null', async () => {
    mocks.rpc.mockResolvedValue({
      data: [
        {
          introducer_display_name: null,
          relationship_type: 'friend',
          relationship_duration: 'y3to10',
          request_status: 'pending',
        },
      ],
      error: null,
    });
    const repo = new ConsentRepo(createBrowserClient('https://project.example', 'anon-key'));

    await expect(repo.getPreview(rawToken)).resolves.toEqual({
      introducerDisplayName: null,
      relationshipType: 'friend',
      relationshipDuration: 'y3to10',
      requestStatus: 'pending',
    });
  });

  it('returns null for unknown tokens and rejects malformed ones without a query', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    const repo = new ConsentRepo(createBrowserClient('https://project.example', 'anon-key'));

    await expect(repo.getPreview(rawToken)).resolves.toBeNull();
    await expect(repo.getPreview('short')).resolves.toBeNull();
    await expect(repo.getPreview('!'.repeat(32))).resolves.toBeNull();
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it('claims only with a session and maps the draft id', async () => {
    signedInSession();
    mocks.rpc.mockResolvedValue({ data: [{ pitch_draft_id: draftId }], error: null });
    const repo = new ConsentRepo(createBrowserClient('https://project.example', 'anon-key'));

    const claim = await repo.claim(rawToken);

    expect(mocks.rpc).toHaveBeenCalledWith('claim_consent_request', { raw_token: rawToken });
    expect(claim).toEqual({ pitchDraftId: draftId });
  });

  it('rejects a claim when signed out', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: null }, error: null });
    const repo = new ConsentRepo(createBrowserClient('https://project.example', 'anon-key'));

    await expect(repo.claim(rawToken)).rejects.toBeInstanceOf(UnauthenticatedError);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('reads the immutable consent revision and only its snapshotted assets', async () => {
    signedInSession();
    mocks.consentRequestSelect.mockReturnValue({
      eq: () => ({ single: async () => ({ data: { revision_id: revisionId }, error: null }) }),
    });
    const revision = {
      id: revisionId,
      pitch_draft_id: draftId,
      revision_number: 2,
      headline: 'Revision headline',
      body: 'Revision body',
      structure: { hard_claims_requiring_confirmation: ['Owns a home'] },
      asset_ids: [firstPhotoId, secondPhotoId],
      voice_asset_path: null,
      content_hash: 'hash',
      // Column names below are the ones migrations 0032/0036/0047 actually
      // create. A repo that reads a different key must go red here, not pass
      // because the fake echoed back whatever it was asked for.
      transcript: { text: 'Blair is the best. ', segments: [] },
      dater_edited: false,
      structure_reviewed: true,
      // Migration 0048 columns. NULL together: no approved motion timeline.
      scene_definition: null,
      scene_hash: null,
      created_at: '2026-07-13T00:00:00Z',
    };
    mocks.consentRevisionSelect.mockReturnValue({
      eq: () => ({
        eq: () => ({ single: async () => ({ data: revision, error: null }) }),
      }),
    });
    const assets = [
      {
        id: firstPhotoId,
        pitch_draft_id: draftId,
        uploaded_by_user_id: '00000000-0000-0000-0000-000000000003',
        asset_type: 'photo',
        storage_path: `pitch-media/${draftId}/one.jpg`,
        sort_order: 0,
        created_at: '2026-07-13T00:00:00Z',
        updated_at: '2026-07-13T00:00:00Z',
      },
      {
        id: secondPhotoId,
        pitch_draft_id: draftId,
        uploaded_by_user_id: '00000000-0000-0000-0000-000000000003',
        asset_type: 'photo',
        storage_path: `pitch-media/${draftId}/two.jpg`,
        sort_order: 1,
        created_at: '2026-07-13T00:00:00Z',
        updated_at: '2026-07-13T00:00:00Z',
      },
    ];
    const filterByAssetIds = vi.fn(() => ({
      order: async () => ({ data: assets, error: null }),
    }));
    const filterByDraftId = vi.fn(() => ({ in: filterByAssetIds }));
    mocks.consentAssetSelect.mockReturnValue({ eq: filterByDraftId });
    const repo = new ConsentRepo(createBrowserClient('https://project.example', 'anon-key'));

    await expect(repo.getConsentReview(draftId)).resolves.toEqual({
      revision,
      assets,
      hardClaims: ['Owns a home'],
      // Legacy snapshot: hard claims only, so there is nothing to edit.
      editableStructure: null,
      // Fifth audit D1: the transcript the Dater must be shown at consent is
      // the revision's own frozen snapshot, not the live draft's.
      transcriptText: 'Blair is the best. ',
      transcriptSegments: [],
      // No segments -> nothing for a word reference to point into (A7).
      transcriptWords: [],
      // This snapshot predates T003 and reports no audio length; the scene is
      // then timed by its segments exactly as it was before.
      transcriptAudioDurationMs: null,
      // No segments -> no legal scene; the preview falls back (A4).
      scene: null,
      daterEdited: false,
      structureReviewed: true,
    });
    expect(filterByDraftId).toHaveBeenCalledWith('pitch_draft_id', draftId);
    expect(filterByAssetIds).toHaveBeenCalledWith('id', [firstPhotoId, secondPhotoId]);
  });

  // MOTION PHASE 1: the Dater approves a scene, so the consent surface has to
  // read back the scene the SERVER stored, plus the segment timings the scene
  // and the captions are both derived from.
  describe('scene_definition / scene_hash (migration 0048)', () => {
    function revisionWith(overrides: Record<string, unknown>) {
      mocks.consentRequestSelect.mockReturnValue({
        eq: () => ({ single: async () => ({ data: { revision_id: revisionId }, error: null }) }),
      });
      mocks.consentRevisionSelect.mockReturnValue({
        eq: () => ({
          eq: () => ({
            single: async () => ({
              data: {
                id: revisionId,
                pitch_draft_id: draftId,
                revision_number: 4,
                headline: 'Headline',
                body: 'Body',
                structure: null,
                asset_ids: [],
                voice_asset_path: null,
                content_hash: 'hash',
                created_at: '2026-07-13T00:00:00Z',
                ...overrides,
              },
              error: null,
            }),
          }),
        }),
      });
      return new ConsentRepo(createBrowserClient('https://project.example', 'anon-key'));
    }

    const storedScene = {
      schemaVersion: 1,
      canvas: { width: 1080, height: 1920, fps: 30 },
      durationMs: 24_000,
      scenes: [
        { assetId: firstPhotoId, startMs: 0, endMs: 12_000 },
        { assetId: secondPhotoId, startMs: 12_000, endMs: 24_000 },
      ],
    };

    it('exposes the stored scene, its server hash and the segment timings', async () => {
      signedInSession();
      const repo = revisionWith({
        scene_definition: storedScene,
        scene_hash: 'a'.repeat(64),
        transcript: {
          text: 'Blair is the best.',
          segments: [
            { start: 0, end: 12, text: 'Blair is the best.' },
            { start: 12, end: 24, text: 'Truly.' },
          ],
        },
      });

      const review = await repo.getConsentReview(draftId);

      expect(review.scene).toEqual(storedScene);
      // The hash is the server's; the client only carries it.
      expect(review.revision.scene_hash).toBe('a'.repeat(64));
      expect(review.transcriptSegments).toEqual([
        { startMs: 0, endMs: 12_000, text: 'Blair is the best.' },
        { startMs: 12_000, endMs: 24_000, text: 'Truly.' },
      ]);
    });

    // T003 (issue #72): the recording's own length has to reach the builder, or
    // the rebuilt scene stops at the last transcribed word while the audio runs
    // on. It comes off the snapshot, never off an <audio> element.
    it('exposes the provider-reported audio length, and null when there is none', async () => {
      signedInSession();
      const withAudio = await revisionWith({
        transcript: {
          text: 'Blair is the best.',
          durationMs: 54_543,
          segments: [{ start: 0, end: 37.66, text: 'Blair is the best.' }],
        },
      }).getConsentReview(draftId);
      expect(withAudio.transcriptAudioDurationMs).toBe(54_543);

      const legacy = await revisionWith({
        transcript: {
          text: 'Blair is the best.',
          segments: [{ start: 0, end: 37.66, text: 'Blair is the best.' }],
        },
      }).getConsentReview(draftId);
      expect(legacy.transcriptAudioDurationMs).toBeNull();

      // Not a duration: dropped rather than coerced, exactly as
      // private.pitch_scene_integer drops it, so the client and the DB agree.
      const malformed = await revisionWith({
        transcript: {
          text: 'Blair is the best.',
          durationMs: '54543',
          segments: [{ start: 0, end: 37.66, text: 'Blair is the best.' }],
        },
      }).getConsentReview(draftId);
      expect(malformed.transcriptAudioDurationMs).toBeNull();
    });

    it('reads a legacy revision with no scene columns as scene: null', async () => {
      signedInSession();
      const repo = revisionWith({});

      await expect(repo.getConsentReview(draftId)).resolves.toMatchObject({ scene: null });
    });

    it('refuses a stored scene that breaks the 1000ms floor instead of playing a strobe', async () => {
      signedInSession();
      const repo = revisionWith({
        scene_definition: {
          ...storedScene,
          scenes: [
            { assetId: firstPhotoId, startMs: 0, endMs: 30 },
            { assetId: secondPhotoId, startMs: 30, endMs: 24_000 },
          ],
        },
        scene_hash: 'b'.repeat(64),
      });

      await expect(repo.getConsentReview(draftId)).resolves.toMatchObject({ scene: null });
    });

    it('refuses a stored scene with a gap in its coverage', async () => {
      signedInSession();
      const repo = revisionWith({
        scene_definition: {
          ...storedScene,
          scenes: [
            { assetId: firstPhotoId, startMs: 0, endMs: 10_000 },
            { assetId: secondPhotoId, startMs: 14_000, endMs: 24_000 },
          ],
        },
        scene_hash: 'c'.repeat(64),
      });

      await expect(repo.getConsentReview(draftId)).resolves.toMatchObject({ scene: null });
    });
  });

  it('flags a dater-edited revision so approval demands a confirmation', async () => {
    signedInSession();
    mocks.consentRequestSelect.mockReturnValue({
      eq: () => ({ single: async () => ({ data: { revision_id: revisionId }, error: null }) }),
    });
    mocks.consentRevisionSelect.mockReturnValue({
      eq: () => ({
        eq: () => ({
          single: async () => ({
            data: {
              id: revisionId,
              pitch_draft_id: draftId,
              revision_number: 3,
              headline: 'Edited headline',
              body: 'Edited body',
              structure: null,
              asset_ids: [],
              voice_asset_path: null,
              content_hash: 'hash',
              created_at: '2026-07-13T00:00:00Z',
              dater_edited: true,
            },
            error: null,
          }),
        }),
      }),
    });
    const repo = new ConsentRepo(createBrowserClient('https://project.example', 'anon-key'));

    const review = await repo.getConsentReview(draftId);
    expect(review.daterEdited).toBe(true);
    expect(review.hardClaims).toEqual([]);
  });

  // FIFTH-AUDIT REGRESSION — P0: the public page renders `structure`, so the
  // Dater must see and edit those five fields, not just headline/body.
  it('exposes the five editable structure fields the public page renders', async () => {
    signedInSession();
    mocks.consentRequestSelect.mockReturnValue({
      eq: () => ({ single: async () => ({ data: { revision_id: revisionId }, error: null }) }),
    });
    const structure = {
      hook: 'Blair turns ordinary Tuesdays into stories.',
      relationship_context: 'Roommates for four years.',
      three_specific_qualities: ['Remembers every birthday', 'Cooks for a crowd', 'Never gossips'],
      evidence_or_anecdote: 'Blair drove three hours to sit with me after surgery.',
      good_match_for: 'Someone who likes long walks.',
      hard_claims_requiring_confirmation: ['Owns a home'],
    };
    mocks.consentRevisionSelect.mockReturnValue({
      eq: () => ({
        eq: () => ({
          single: async () => ({
            data: {
              id: revisionId,
              pitch_draft_id: draftId,
              revision_number: 2,
              headline: 'Blair turns ordinary Tuesdays into stories.',
              body: 'Roommates for four years.',
              structure,
              asset_ids: [],
              voice_asset_path: null,
              content_hash: 'hash',
              created_at: '2026-07-13T00:00:00Z',
            },
            error: null,
          }),
        }),
      }),
    });
    const repo = new ConsentRepo(createBrowserClient('https://project.example', 'anon-key'));

    const review = await repo.getConsentReview(draftId);

    expect(review.editableStructure).toEqual({
      hook: structure.hook,
      relationship_context: structure.relationship_context,
      three_specific_qualities: structure.three_specific_qualities,
      evidence_or_anecdote: structure.evidence_or_anecdote,
      good_match_for: structure.good_match_for,
    });
    // The AI safety flag is never handed to the editor.
    expect(review.editableStructure).not.toHaveProperty('hard_claims_requiring_confirmation');
    expect(review.hardClaims).toEqual(['Owns a home']);
  });

  it('reports a structurally broken legacy snapshot as not editable', async () => {
    signedInSession();
    mocks.consentRequestSelect.mockReturnValue({
      eq: () => ({ single: async () => ({ data: { revision_id: revisionId }, error: null }) }),
    });
    mocks.consentRevisionSelect.mockReturnValue({
      eq: () => ({
        eq: () => ({
          single: async () => ({
            data: {
              id: revisionId,
              pitch_draft_id: draftId,
              revision_number: 2,
              headline: 'Legacy headline',
              body: 'Legacy body',
              // Only two qualities: the page contract needs three, so this is
              // not editable — the UI must fall back, never invent a blank.
              structure: {
                hook: 'A hook',
                relationship_context: 'Context',
                three_specific_qualities: ['one', 'two'],
                evidence_or_anecdote: 'Anecdote',
                good_match_for: 'Someone kind',
                hard_claims_requiring_confirmation: [],
              },
              asset_ids: [],
              voice_asset_path: null,
              content_hash: 'hash',
              created_at: '2026-07-13T00:00:00Z',
            },
            error: null,
          }),
        }),
      }),
    });
    const repo = new ConsentRepo(createBrowserClient('https://project.example', 'anon-key'));

    const review = await repo.getConsentReview(draftId);

    expect(review.editableStructure).toBeNull();
    expect(review.revision.headline).toBe('Legacy headline');
  });

  it('reads the AI disclosure revision through the C1 RPC', async () => {
    signedInSession();
    mocks.rpc.mockResolvedValue({ data: 'ai-2026-07', error: null });
    const repo = new ConsentRepo(createBrowserClient('https://project.example', 'anon-key'));

    await expect(repo.getAiDisclosureRevision()).resolves.toBe('ai-2026-07');
    expect(mocks.rpc).toHaveBeenCalledWith('get_ai_disclosure_revision');
  });

  it('records draft-scoped dater AI consent for the given revision', async () => {
    signedInSession();
    mocks.rpc.mockResolvedValue({ data: 'consent-id', error: null });
    const repo = new ConsentRepo(createBrowserClient('https://project.example', 'anon-key'));

    await repo.recordDaterAiConsent(draftId, 'ai-2026-07');

    expect(mocks.rpc).toHaveBeenCalledWith('record_ai_processing_consent', {
      target_draft_id: draftId,
      target_consent_revision: 'ai-2026-07',
    });
  });

  it('throws when dater AI consent cannot be recorded so the gate stays closed', async () => {
    signedInSession();
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'permission denied' } });
    const repo = new ConsentRepo(createBrowserClient('https://project.example', 'anon-key'));

    await expect(repo.recordDaterAiConsent(draftId, 'ai-2026-07')).rejects.toBeInstanceOf(
      DataLayerError,
    );
  });

  it('fails closed when a revision structure is malformed', async () => {
    signedInSession();
    mocks.consentRequestSelect.mockReturnValue({
      eq: () => ({ single: async () => ({ data: { revision_id: revisionId }, error: null }) }),
    });
    mocks.consentRevisionSelect.mockReturnValue({
      eq: () => ({
        eq: () => ({
          single: async () => ({
            data: {
              id: revisionId,
              pitch_draft_id: draftId,
              revision_number: 2,
              headline: 'Revision headline',
              body: 'Revision body',
              structure: { hard_claims_requiring_confirmation: 'not-an-array' },
              asset_ids: [],
              voice_asset_path: null,
              content_hash: 'hash',
              created_at: '2026-07-13T00:00:00Z',
            },
            error: null,
          }),
        }),
      }),
    });
    const repo = new ConsentRepo(createBrowserClient('https://project.example', 'anon-key'));

    await expect(repo.getConsentReview(draftId)).rejects.toBeInstanceOf(DataLayerError);
  });

  it('fails closed when a snapshotted asset row is unavailable', async () => {
    signedInSession();
    mocks.consentRequestSelect.mockReturnValue({
      eq: () => ({ single: async () => ({ data: { revision_id: revisionId }, error: null }) }),
    });
    mocks.consentRevisionSelect.mockReturnValue({
      eq: () => ({
        eq: () => ({
          single: async () => ({
            data: {
              id: revisionId,
              pitch_draft_id: draftId,
              revision_number: 2,
              headline: 'Revision headline',
              body: 'Revision body',
              structure: null,
              asset_ids: [firstPhotoId],
              voice_asset_path: null,
              content_hash: 'hash',
              created_at: '2026-07-13T00:00:00Z',
            },
            error: null,
          }),
        }),
      }),
    });
    mocks.consentAssetSelect.mockReturnValue({
      eq: () => ({
        in: () => ({ order: async () => ({ data: [], error: null }) }),
      }),
    });
    const repo = new ConsentRepo(createBrowserClient('https://project.example', 'anon-key'));

    await expect(repo.getConsentReview(draftId)).rejects.toBeInstanceOf(DataLayerError);
  });

  it('creates a scoped signed URL for a snapshotted asset path', async () => {
    signedInSession();
    mocks.signedUrl.mockResolvedValue({
      data: { signedUrl: 'https://storage.example/signed-read' },
      error: null,
    });
    const repo = new ConsentRepo(createBrowserClient('https://project.example', 'anon-key'));

    const bucketRelativeUrl = await repo.createAssetViewUrl(`${draftId}/voice.m4a`);
    const bucketPrefixedUrl = await repo.createAssetViewUrl(`pitch-media/${draftId}/voice.m4a`);

    expect(mocks.signedUrl).toHaveBeenNthCalledWith(1, `${draftId}/voice.m4a`, 3600);
    expect(mocks.signedUrl).toHaveBeenNthCalledWith(2, `${draftId}/voice.m4a`, 3600);
    expect(bucketRelativeUrl).toBe('https://storage.example/signed-read');
    expect(bucketPrefixedUrl).toBe('https://storage.example/signed-read');
  });

  it('approves through the publish RPC and returns the campaign slug', async () => {
    signedInSession();
    mocks.rpc.mockResolvedValue({
      data: [
        {
          campaign_id: '20000000-0000-0000-0000-000000000001',
          campaign_slug: 'blair-abc123',
        },
      ],
      error: null,
    });
    const repo = new ConsentRepo(createBrowserClient('https://project.example', 'anon-key'));

    const published = await repo.approveAndPublish({
      draftId,
      campaignDays: 14,
      revisionId,
      includedAssetIds: [secondPhotoId],
      hardClaimsConfirmed: true,
    });

    expect(mocks.rpc).toHaveBeenCalledWith('approve_and_publish_pitch', {
      draft_id: draftId,
      campaign_days: 14,
      revision_id: revisionId,
      included_asset_ids: [secondPhotoId],
      hard_claims_confirmed: true,
    });
    expect(published).toEqual({
      campaignId: '20000000-0000-0000-0000-000000000001',
      campaignSlug: 'blair-abc123',
    });
  });

  it('creates a dater revision with the complete asset snapshot including voice', async () => {
    signedInSession();
    mocks.rpc.mockResolvedValue({
      data: [{ revision_id: revisionId, revision_number: 3 }],
      error: null,
    });
    const repo = new ConsentRepo(createBrowserClient('https://project.example', 'anon-key'));

    const revision = await repo.createDaterRevision({
      draftId,
      headline: 'My edited headline',
      body: 'My edited body',
      includedAssetIds: [secondPhotoId, voiceAssetId],
    });

    expect(mocks.rpc).toHaveBeenCalledWith('create_dater_revision', {
      draft_id: draftId,
      new_headline: 'My edited headline',
      new_body: 'My edited body',
      included_asset_ids: [secondPhotoId, voiceAssetId],
    });
    expect(revision).toEqual({ revisionId, revisionNumber: 3 });
  });

  it('sends the edited structure and derives headline/body with the RPC formula', async () => {
    signedInSession();
    mocks.rpc.mockResolvedValue({
      data: [{ revision_id: revisionId, revision_number: 4 }],
      error: null,
    });
    const repo = new ConsentRepo(createBrowserClient('https://project.example', 'anon-key'));

    await repo.createDaterRevision({
      draftId,
      // Stale client-side copies: the repo must ignore them and re-derive.
      headline: 'Whatever the client had cached',
      body: 'Stale body',
      includedAssetIds: [secondPhotoId, voiceAssetId],
      structure: {
        hook: '  My own opening line.  ',
        relationship_context: 'We were roommates for four years.',
        three_specific_qualities: ['Remembers birthdays', 'Cooks for a crowd', 'Never gossips'],
        evidence_or_anecdote: 'They drove three hours to sit with me.',
        good_match_for: 'Someone who likes long walks.',
      },
    });

    expect(mocks.rpc).toHaveBeenCalledWith('create_dater_revision', {
      draft_id: draftId,
      new_headline: 'My own opening line.',
      new_body:
        'We were roommates for four years.\n\nThey drove three hours to sit with me.\n\nA good match: Someone who likes long walks.',
      included_asset_ids: [secondPhotoId, voiceAssetId],
      new_structure: {
        hook: 'My own opening line.',
        relationship_context: 'We were roommates for four years.',
        three_specific_qualities: ['Remembers birthdays', 'Cooks for a crowd', 'Never gossips'],
        evidence_or_anecdote: 'They drove three hours to sit with me.',
        good_match_for: 'Someone who likes long walks.',
      },
    });
  });

  // FIFTH-AUDIT REGRESSION (decision D2). NULL and [] are different answers to
  // the RPC: absent keeps every flagged claim, an empty array publishes none.
  // Collapsing them would silently re-publish a claim the Dater removed.
  it('distinguishes "no disposition" from "I removed every flagged claim"', async () => {
    signedInSession();
    mocks.rpc.mockResolvedValue({
      data: [{ revision_id: revisionId, revision_number: 5 }],
      error: null,
    });
    const repo = new ConsentRepo(createBrowserClient('https://project.example', 'anon-key'));

    await repo.createDaterRevision({
      draftId,
      headline: 'Headline',
      body: 'Body',
      includedAssetIds: [],
    });
    expect(mocks.rpc.mock.calls.at(-1)?.[1]).not.toHaveProperty('retained_hard_claims');

    await repo.createDaterRevision({
      draftId,
      headline: 'Headline',
      body: 'Body',
      includedAssetIds: [],
      retainedHardClaims: [],
    });
    expect(mocks.rpc.mock.calls.at(-1)?.[1]).toMatchObject({ retained_hard_claims: [] });

    await repo.createDaterRevision({
      draftId,
      headline: 'Headline',
      body: 'Body',
      includedAssetIds: [],
      retainedHardClaims: ['Owns a home'],
    });
    expect(mocks.rpc.mock.calls.at(-1)?.[1]).toMatchObject({
      retained_hard_claims: ['Owns a home'],
    });
  });

  // MOTION PHASE 1: a save either freezes a scene or says nothing about it.
  // Passing `new_scene: null` would be a third meaning the RPC does not have.
  describe('new_scene (migration 0048)', () => {
    const scene = {
      schemaVersion: 1 as const,
      canvas: { width: 1080, height: 1920, fps: 30 },
      durationMs: 24_000,
      scenes: [
        { assetId: firstPhotoId, startMs: 0, endMs: 12_000 },
        { assetId: secondPhotoId, startMs: 12_000, endMs: 24_000 },
      ],
    };

    beforeEach(() => {
      signedInSession();
      mocks.rpc.mockResolvedValue({
        data: [{ revision_id: revisionId, revision_number: 6 }],
        error: null,
      });
    });

    it('sends the scene as the seventh argument when the Dater saves one', async () => {
      const repo = new ConsentRepo(createBrowserClient('https://project.example', 'anon-key'));

      await repo.createDaterRevision({
        draftId,
        headline: 'Headline',
        body: 'Body',
        includedAssetIds: [firstPhotoId, secondPhotoId],
        newScene: scene,
      });

      expect(mocks.rpc).toHaveBeenCalledWith('create_dater_revision', {
        draft_id: draftId,
        new_headline: 'Headline',
        new_body: 'Body',
        included_asset_ids: [firstPhotoId, secondPhotoId],
        new_scene: scene,
      });
    });

    it('omits the key entirely when there is no scene, so the server forward-copies', async () => {
      const repo = new ConsentRepo(createBrowserClient('https://project.example', 'anon-key'));

      await repo.createDaterRevision({
        draftId,
        headline: 'Headline',
        body: 'Body',
        includedAssetIds: [firstPhotoId],
      });

      expect(mocks.rpc.mock.calls.at(-1)?.[1]).not.toHaveProperty('new_scene');
    });

    it('refuses to send a scene that breaks the safety floors', async () => {
      const repo = new ConsentRepo(createBrowserClient('https://project.example', 'anon-key'));

      await expect(
        repo.createDaterRevision({
          draftId,
          headline: 'Headline',
          body: 'Body',
          includedAssetIds: [firstPhotoId, secondPhotoId],
          newScene: {
            ...scene,
            scenes: [
              { assetId: firstPhotoId, startMs: 0, endMs: 30 },
              { assetId: secondPhotoId, startMs: 30, endMs: 24_000 },
            ],
          },
        }),
      ).rejects.toThrow();
      expect(mocks.rpc).not.toHaveBeenCalled();
    });
  });

  it('refuses to cut a revision when the edited structure is invalid', async () => {
    signedInSession();
    const repo = new ConsentRepo(createBrowserClient('https://project.example', 'anon-key'));

    await expect(
      repo.createDaterRevision({
        draftId,
        headline: 'Headline',
        body: 'Body',
        includedAssetIds: [],
        structure: {
          hook: 'My own opening line.',
          relationship_context: 'We were roommates for four years.',
          three_specific_qualities: ['Remembers birthdays', '   ', 'Never gossips'],
          evidence_or_anecdote: 'They drove three hours to sit with me.',
          good_match_for: 'Someone who likes long walks.',
        },
      }),
    ).rejects.toThrow('pitch structure requires all five fields');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('sets a 7-day publish preference and omits an empty intent filter', async () => {
    signedInSession();
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    const repo = new ConsentRepo(createBrowserClient('https://project.example', 'anon-key'));

    await repo.setPublishPreferences({
      draftId,
      audience: { minAge: 21, maxAge: 35, intents: [] },
      locationPrecision: 'region',
      publishDays: 7,
    });

    expect(mocks.rpc).toHaveBeenCalledWith('set_publish_preferences', {
      draft_id: draftId,
      audience: { min_age: 21, max_age: 35 },
      target_location_precision: 'region',
      target_publish_days: 7,
    });
  });

  it('confirms the dater profile and maps birth date, region, optional city, and intent', async () => {
    signedInSession();
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    const repo = new ConsentRepo(createBrowserClient('https://project.example', 'anon-key'));

    await repo.setDaterProfile({
      birthDate: '1994-05-20',
      region: 'Puget Sound',
      city: 'Seattle',
      intent: 'long-term',
    });

    expect(mocks.rpc).toHaveBeenCalledWith('set_dater_profile', {
      target_birth_date: '1994-05-20',
      target_region: 'Puget Sound',
      target_city: 'Seattle',
      target_intent: 'long-term',
    });
  });

  it('passes a null city to the profile RPC when the city is omitted', async () => {
    signedInSession();
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    const repo = new ConsentRepo(createBrowserClient('https://project.example', 'anon-key'));

    await repo.setDaterProfile({
      birthDate: '1990-01-01',
      region: 'Bay Area',
      intent: 'open-to-either',
    });

    expect(mocks.rpc).toHaveBeenCalledWith('set_dater_profile', {
      target_birth_date: '1990-01-01',
      target_region: 'Bay Area',
      target_city: null,
      target_intent: 'open-to-either',
    });
  });

  it('rejects a malformed birth date before calling the profile RPC', async () => {
    signedInSession();
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    const repo = new ConsentRepo(createBrowserClient('https://project.example', 'anon-key'));

    await expect(
      repo.setDaterProfile({ birthDate: '05/20/1994', region: 'Puget Sound', intent: 'long-term' }),
    ).rejects.toThrow();
    expect(mocks.rpc).not.toHaveBeenCalledWith('set_dater_profile', expect.anything());
  });

  it('uploads a dater photo before registering it at the next sort order', async () => {
    signedInSession();
    const fileBody = new ArrayBuffer(8);
    const registered = {
      id: firstPhotoId,
      pitch_draft_id: draftId,
      uploaded_by_user_id: '00000000-0000-0000-0000-000000000002',
      asset_type: 'photo',
      storage_path: `pitch-media/${draftId}/dater-123.jpg`,
      sort_order: 5,
      created_at: '2026-07-13T00:00:00Z',
      updated_at: '2026-07-13T00:00:00Z',
    };
    mocks.consentAssetSelect.mockReturnValue({
      eq: () => ({
        order: () => ({ limit: async () => ({ data: [{ sort_order: 4 }], error: null }) }),
      }),
    });
    mocks.signedUpload.mockResolvedValue({
      data: { token: 'signed-token', signedUrl: 'https://storage.example/upload' },
      error: null,
    });
    mocks.uploadSigned.mockResolvedValue({
      data: { path: `${draftId}/dater-123.jpg` },
      error: null,
    });
    mocks.draftInsert.mockReturnValue({
      select: () => ({ single: async () => ({ data: registered, error: null }) }),
    });
    const repo = new ConsentRepo(createBrowserClient('https://project.example', 'anon-key'));

    const result = await repo.uploadDaterPhoto(draftId, 'dater-123.jpg', fileBody, 'image/jpeg');

    expect(mocks.signedUpload).toHaveBeenCalledWith(`${draftId}/dater-123.jpg`, { upsert: false });
    expect(mocks.uploadSigned).toHaveBeenCalledWith(
      `${draftId}/dater-123.jpg`,
      'signed-token',
      fileBody,
      { contentType: 'image/jpeg' },
    );
    expect(mocks.draftInsert).toHaveBeenCalledWith({
      pitch_draft_id: draftId,
      uploaded_by_user_id: '00000000-0000-0000-0000-000000000002',
      asset_type: 'photo',
      storage_path: `pitch-media/${draftId}/dater-123.jpg`,
      sort_order: 5,
      // Migration 0048. No createImageBitmap in this environment, so the size is
      // unknown — recorded as NULL, never guessed, and never a blocked upload.
      width: null,
      height: null,
    });
    expect(result).toEqual(registered);
  });

  // MOTION PHASE 1: the render worker letterboxes each photo into the 1080x1920
  // canvas, so the Dater's own web upload has to record its source pixel size.
  it('records the decoded pixel size of a dater web upload', async () => {
    signedInSession();
    const fileBody = new ArrayBuffer(8);
    const close = vi.fn();
    const createImageBitmap = vi.fn(async () => ({ width: 1200, height: 1600, close }));
    const blobParts: unknown[] = [];
    class BlobStub {
      constructor(parts: readonly ArrayBuffer[], options?: { readonly type?: string }) {
        blobParts.push({ parts, options });
      }
    }
    vi.stubGlobal('createImageBitmap', createImageBitmap);
    vi.stubGlobal('Blob', BlobStub);
    try {
      mocks.consentAssetSelect.mockReturnValue({
        eq: () => ({
          order: () => ({ limit: async () => ({ data: [], error: null }) }),
        }),
      });
      mocks.signedUpload.mockResolvedValue({
        data: { token: 'signed-token', signedUrl: 'https://storage.example/upload' },
        error: null,
      });
      mocks.uploadSigned.mockResolvedValue({ data: { path: 'x' }, error: null });
      mocks.draftInsert.mockReturnValue({
        select: () => ({ single: async () => ({ data: { id: firstPhotoId }, error: null }) }),
      });
      const repo = new ConsentRepo(createBrowserClient('https://project.example', 'anon-key'));

      await repo.uploadDaterPhoto(draftId, 'dater-123.png', fileBody, 'image/png');

      expect(mocks.draftInsert).toHaveBeenCalledWith(
        expect.objectContaining({ width: 1200, height: 1600 }),
      );
      expect(blobParts).toEqual([{ parts: [fileBody], options: { type: 'image/png' } }]);
      // The bitmap is released even on the success path.
      expect(close).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('registers a dater photo with a null size when the decode fails', async () => {
    signedInSession();
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => {
        throw new Error('unsupported image');
      }),
    );
    vi.stubGlobal('Blob', class {});
    try {
      mocks.consentAssetSelect.mockReturnValue({
        eq: () => ({ order: () => ({ limit: async () => ({ data: [], error: null }) }) }),
      });
      mocks.signedUpload.mockResolvedValue({
        data: { token: 'signed-token', signedUrl: 'https://storage.example/upload' },
        error: null,
      });
      mocks.uploadSigned.mockResolvedValue({ data: { path: 'x' }, error: null });
      mocks.draftInsert.mockReturnValue({
        select: () => ({ single: async () => ({ data: { id: firstPhotoId }, error: null }) }),
      });
      const repo = new ConsentRepo(createBrowserClient('https://project.example', 'anon-key'));

      await expect(
        repo.uploadDaterPhoto(draftId, 'dater-123.jpg', new ArrayBuffer(8), 'image/jpeg'),
      ).resolves.toMatchObject({ id: firstPhotoId });
      expect(mocks.draftInsert).toHaveBeenCalledWith(
        expect.objectContaining({ width: null, height: null }),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('sends request-changes and decline responses through the consent response RPC', async () => {
    signedInSession();
    mocks.rpc.mockResolvedValue({ data: undefined, error: null });
    const repo = new ConsentRepo(createBrowserClient('https://project.example', 'anon-key'));

    await repo.respondToConsent(draftId, 'request_changes', 'Please remove the hard claim.');
    await repo.respondToConsent(draftId, 'decline', 'I do not consent to publication.');

    expect(mocks.rpc).toHaveBeenNthCalledWith(1, 'respond_consent_request', {
      draft_id: draftId,
      action: 'request_changes',
      note: 'Please remove the hard claim.',
    });
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, 'respond_consent_request', {
      draft_id: draftId,
      action: 'decline',
      note: 'I do not consent to publication.',
    });
  });
});

describe('InterestRepo.listMyInterests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configureMockClient();
    mocks.getSession.mockResolvedValue({
      data: { session: { user: { id: '00000000-0000-0000-0000-000000000002' } } },
      error: null,
    });
  });

  it('maps the authenticated sender RPC rows into mobile-friendly fields', async () => {
    mocks.rpc.mockResolvedValue({
      data: [
        {
          interest_id: '50000000-0000-4000-8000-000000000001',
          interest_status: 'accepted',
          submitted_at: '2026-07-13T10:00:00+00:00',
          decided_at: '2026-07-13T11:00:00+00:00',
          campaign_id: '20000000-0000-4000-8000-000000000001',
          campaign_slug: 'blair-summer',
          campaign_status: 'published',
          dater_display_name: 'Blair',
          campaign_headline: 'A thoughtful person worth meeting',
        },
      ],
      error: null,
    });
    const repo = new InterestRepo(createBrowserClient('https://project.example', 'anon-key'));

    await expect(repo.listMyInterests()).resolves.toEqual([
      {
        interestId: '50000000-0000-4000-8000-000000000001',
        interestStatus: 'accepted',
        submittedAt: '2026-07-13T10:00:00+00:00',
        decidedAt: '2026-07-13T11:00:00+00:00',
        campaignId: '20000000-0000-4000-8000-000000000001',
        campaignSlug: 'blair-summer',
        campaignStatus: 'published',
        daterDisplayName: 'Blair',
        campaignHeadline: 'A thoughtful person worth meeting',
      },
    ]);
    expect(mocks.rpc).toHaveBeenCalledWith('list_my_interests', {});
  });

  it('rejects malformed RPC rows instead of rendering ambiguous states', async () => {
    mocks.rpc.mockResolvedValue({
      data: [
        {
          interest_id: 'not-a-uuid',
          interest_status: 'mystery',
        },
      ],
      error: null,
    });
    const repo = new InterestRepo(createBrowserClient('https://project.example', 'anon-key'));

    await expect(repo.listMyInterests()).rejects.toBeInstanceOf(DataLayerError);
  });

  it('does not call the RPC while signed out', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: null }, error: null });
    const repo = new InterestRepo(createBrowserClient('https://project.example', 'anon-key'));

    await expect(repo.listMyInterests()).rejects.toBeInstanceOf(UnauthenticatedError);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe('getPublishedPitchBySlug', () => {
  const campaignRow = {
    id: '20000000-0000-0000-0000-000000000001',
    pitch_draft_id: '10000000-0000-0000-0000-000000000001',
    owner_user_id: '00000000-0000-0000-0000-000000000002',
    status: 'published',
    published_at: '2026-07-13T00:00:00Z',
    slug: 'blair-abc123',
    location_precision: 'city',
  };
  const draftRow = {
    id: '10000000-0000-0000-0000-000000000001',
    created_by_user_id: '00000000-0000-0000-0000-000000000001',
    subject_user_id: '00000000-0000-0000-0000-000000000002',
    status: 'published',
    headline: null,
    body: null,
    relationship_type: 'friend',
    relationship_duration: 'y3to10',
    structure: null,
  };
  // T002 (Issue #71): the public page prints a display name only once its owner
  // has confirmed it, so the flag is part of every profile fixture here.
  const profileRows = [
    {
      user_id: '00000000-0000-0000-0000-000000000001',
      display_name: 'Maya',
      display_name_confirmed: true,
      birth_date: null,
    },
    {
      user_id: '00000000-0000-0000-0000-000000000002',
      display_name: 'Blair',
      display_name_confirmed: true,
      birth_date: '1994-05-20',
    },
  ];
  const datingProfileRow = {
    approximate_location: 'Seattle',
    location_region: 'Puget Sound',
    location_city: 'Seattle',
    dating_intent: 'long-term',
  };

  const assetRows = [
    {
      id: '40000000-0000-0000-0000-000000000001',
      pitch_draft_id: '10000000-0000-0000-0000-000000000001',
      asset_type: 'photo',
      storage_path: 'pitch-media/10000000-0000-0000-0000-000000000001/photo-1.jpg',
      sort_order: 0,
    },
  ];

  const tableMock = vi.fn();

  function configurePublishedPitchClient(
    campaign: unknown,
    options: {
      readonly betaValue?: string | null;
      readonly allowlisted?: boolean;
      readonly datingProfile?: unknown;
      readonly draft?: unknown;
      readonly profiles?: unknown;
    } = {},
  ): void {
    const {
      betaValue = 'on',
      allowlisted = false,
      datingProfile = datingProfileRow,
      draft = draftRow,
      profiles = profileRows,
    } = options;
    tableMock.mockImplementation((table: string) => {
      if (table === 'app_config') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: betaValue === null ? null : { value: betaValue },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'qa_preview_allowlist') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: allowlisted
                  ? { pitch_draft_id: '10000000-0000-0000-0000-000000000001' }
                  : null,
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'campaigns') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                or: () => ({ maybeSingle: async () => ({ data: campaign, error: null }) }),
              }),
            }),
          }),
        };
      }
      if (table === 'pitch_drafts') {
        return {
          select: () => ({ eq: () => ({ single: async () => ({ data: draft, error: null }) }) }),
        };
      }
      if (table === 'dating_profiles') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: datingProfile,
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'pitch_assets') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({ order: async () => ({ data: assetRows, error: null }) }),
            }),
          }),
        };
      }
      return {
        select: () => ({ in: async () => ({ data: profiles, error: null }) }),
      };
    });
    mocks.createClient.mockReturnValue({
      auth: {},
      from: tableMock,
      storage: {
        from: () => ({
          createSignedUrl: async (path: string) => ({
            data: { signedUrl: `https://storage.example/${path}` },
            error: null,
          }),
        }),
      },
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects malformed slugs without querying', async () => {
    configurePublishedPitchClient(campaignRow);
    const client = createServiceClient('https://project.example', 'service-key');

    await expect(getPublishedPitchBySlug(client, 'Not A Slug!')).resolves.toBeNull();
    expect(tableMock).not.toHaveBeenCalled();
  });

  it('returns null when no published campaign matches', async () => {
    configurePublishedPitchClient(null);
    const client = createServiceClient('https://project.example', 'service-key');

    await expect(getPublishedPitchBySlug(client, 'blair-abc123')).resolves.toBeNull();
  });

  it('returns null when the public beta gate is off and the campaign is not allowlisted', async () => {
    configurePublishedPitchClient(campaignRow, { betaValue: 'off', allowlisted: false });
    const client = createServiceClient('https://project.example', 'service-key');

    await expect(getPublishedPitchBySlug(client, 'blair-abc123')).resolves.toBeNull();
  });

  it('returns the pitch when the gate is off but the campaign is QA-allowlisted', async () => {
    configurePublishedPitchClient(campaignRow, { betaValue: 'off', allowlisted: true });
    const client = createServiceClient('https://project.example', 'service-key');

    const pitch = await getPublishedPitchBySlug(client, 'blair-abc123');

    expect(pitch?.campaignId).toBe(campaignRow.id);
    expect(pitch?.daterDisplayName).toBe('Blair');
  });

  it('fails closed and returns null when the public beta config row is absent', async () => {
    configurePublishedPitchClient(campaignRow, { betaValue: null, allowlisted: false });
    const client = createServiceClient('https://project.example', 'service-key');

    await expect(getPublishedPitchBySlug(client, 'blair-abc123')).resolves.toBeNull();
  });

  // T002 (Issue #71). `handle_new_auth_user` (0011) seeds `display_name` from
  // the email local-part with `display_name_confirmed = false`. The published
  // page is the most public surface in the product, so an unconfirmed name
  // falls back to the same 'A friend' a missing profile row already produces —
  // and only for the person who has not confirmed it.
  it('hides an unconfirmed dater name without hiding the confirmed introducer', async () => {
    configurePublishedPitchClient(campaignRow, {
      profiles: [
        profileRows[0],
        { ...profileRows[1], display_name: 'blair.kim92', display_name_confirmed: false },
      ],
    });
    const client = createServiceClient('https://project.example', 'service-key');

    const pitch = await getPublishedPitchBySlug(client, 'blair-abc123');

    expect(pitch?.daterDisplayName).toBe('A friend');
    expect(pitch?.introducerDisplayName).toBe('Maya');
    // The gate withholds the name only; the derived age still comes from the
    // same profile row.
    expect(pitch?.age).toBe(32);
  });

  it('hides an unconfirmed introducer name without hiding the confirmed dater', async () => {
    configurePublishedPitchClient(campaignRow, {
      profiles: [
        { ...profileRows[0], display_name: 'maya.park', display_name_confirmed: false },
        profileRows[1],
      ],
    });
    const client = createServiceClient('https://project.example', 'service-key');

    const pitch = await getPublishedPitchBySlug(client, 'blair-abc123');

    expect(pitch?.introducerDisplayName).toBe('A friend');
    expect(pitch?.daterDisplayName).toBe('Blair');
  });

  it('maps the campaign, draft, profiles, and signed voice URL when the gate is on', async () => {
    configurePublishedPitchClient(campaignRow, { betaValue: 'on' });
    const client = createServiceClient('https://project.example', 'service-key');

    const pitch = await getPublishedPitchBySlug(client, 'blair-abc123');

    expect(pitch).toEqual({
      campaignId: campaignRow.id,
      campaignSlug: 'blair-abc123',
      publishedAt: '2026-07-13T00:00:00Z',
      daterDisplayName: 'Blair',
      introducerDisplayName: 'Maya',
      relationshipType: 'friend',
      relationshipDuration: 'y3to10',
      headline: null,
      body: null,
      transcript: null,
      structure: null,
      // draftRow carries no `structure_reviewed`, i.e. a row published before
      // migration 0047 added the column: fails closed.
      daterReviewedStructure: false,
      age: 32,
      datingIntent: 'long-term',
      approximateLocation: 'Seattle, Puget Sound',
      voiceUrl: `https://storage.example/${draftRow.id}/voice.m4a`,
      photos: [
        {
          assetId: '40000000-0000-0000-0000-000000000001',
          url: `https://storage.example/${draftRow.id}/photo-1.jpg`,
          sortOrder: 0,
        },
      ],
      // draftRow has no `scene_definition`: a row published before migration
      // 0048, so the player falls back to the legacy runtime distribution (A4).
      scene: null,
      transcriptWords: [],
    });
  });

  // MOTION PHASE 1: the public page replays the scene the Dater approved, so it
  // has to come off the published draft's projection — not be recomputed here.
  // `draftRow` is a fixed object, not an echo of the requested keys, so reading
  // a column migration 0048 never creates makes this fail.
  it('projects pitch_drafts.scene_definition onto the published pitch', async () => {
    const scene = {
      schemaVersion: 1,
      canvas: { width: 1080, height: 1920, fps: 30 },
      durationMs: 18_000,
      scenes: [{ assetId: '40000000-0000-0000-0000-000000000001', startMs: 0, endMs: 18_000 }],
    };
    configurePublishedPitchClient(campaignRow, {
      draft: { ...draftRow, scene_definition: scene, scene_hash: 'd'.repeat(64) },
    });
    const client = createServiceClient('https://project.example', 'service-key');

    const pitch = await getPublishedPitchBySlug(client, 'blair-abc123');

    expect(pitch?.scene).toEqual(scene);
    // The scene binds to an asset the page already renders.
    expect(pitch?.photos.map((photo) => photo.assetId)).toEqual([
      '40000000-0000-0000-0000-000000000001',
    ]);
  });

  it('reads a published scene that breaks the safety floors as no scene', async () => {
    configurePublishedPitchClient(campaignRow, {
      draft: {
        ...draftRow,
        scene_definition: {
          schemaVersion: 1,
          canvas: { width: 1080, height: 1920, fps: 30 },
          durationMs: 18_000,
          scenes: [
            { assetId: '40000000-0000-0000-0000-000000000001', startMs: 0, endMs: 40 },
            { assetId: '40000000-0000-0000-0000-000000000002', startMs: 40, endMs: 18_000 },
          ],
        },
      },
    });
    const client = createServiceClient('https://project.example', 'service-key');

    await expect(getPublishedPitchBySlug(client, 'blair-abc123')).resolves.toMatchObject({
      scene: null,
    });
  });

  // FIFTH-AUDIT REGRESSION (verdict 4 / decision D6). The public page's copy
  // branches on this flag, so reading the wrong column silently downgrades
  // every page to the weaker sentence. `draftRow` is a fixed object, not an
  // echo of the requested keys, so renaming the column the repo reads makes
  // the `true` case fail — which is exactly what did NOT happen when the repo
  // was briefly wired to a `dater_reviewed_structure` column that 0047 never
  // creates.
  it('carries pitch_drafts.structure_reviewed through as daterReviewedStructure', async () => {
    configurePublishedPitchClient(campaignRow, {
      draft: { ...draftRow, structure_reviewed: true },
    });
    const client = createServiceClient('https://project.example', 'service-key');

    const reviewed = await getPublishedPitchBySlug(client, 'blair-abc123');
    expect(reviewed?.daterReviewedStructure).toBe(true);

    configurePublishedPitchClient(campaignRow, {
      draft: { ...draftRow, structure_reviewed: false },
    });
    const notReviewed = await getPublishedPitchBySlug(client, 'blair-abc123');
    expect(notReviewed?.daterReviewedStructure).toBe(false);
  });

  it('canonicalizes region precision to the region without the city (CP-1)', async () => {
    configurePublishedPitchClient({ ...campaignRow, location_precision: 'region' });
    const client = createServiceClient('https://project.example', 'service-key');

    const regionPitch = await getPublishedPitchBySlug(client, 'blair-abc123');

    configurePublishedPitchClient({ ...campaignRow, location_precision: 'city' });
    const cityPitch = await getPublishedPitchBySlug(client, 'blair-abc123');

    // The third-audit CP-1 bug: region and city precision returned the same
    // raw string. They must now differ.
    expect(regionPitch?.approximateLocation).toBe('Puget Sound');
    expect(cityPitch?.approximateLocation).toBe('Seattle, Puget Sound');
    expect(regionPitch?.approximateLocation).not.toBe(cityPitch?.approximateLocation);
  });

  it('fails region precision closed for a legacy dating profile with no structured region (CP-1)', async () => {
    // A pre-0041 row only has the unstructured city-level string.
    configurePublishedPitchClient(
      { ...campaignRow, location_precision: 'region' },
      {
        datingProfile: {
          approximate_location: 'Seattle',
          location_region: null,
          location_city: null,
          dating_intent: 'long-term',
        },
      },
    );
    const client = createServiceClient('https://project.example', 'service-key');

    const pitch = await getPublishedPitchBySlug(client, 'blair-abc123');

    expect(pitch?.approximateLocation).toBeNull();
  });

  it('hides the location entirely when precision is hidden (CP-1)', async () => {
    configurePublishedPitchClient({ ...campaignRow, location_precision: 'hidden' });
    const client = createServiceClient('https://project.example', 'service-key');

    const pitch = await getPublishedPitchBySlug(client, 'blair-abc123');

    expect(pitch?.approximateLocation).toBeNull();
    // Intent still surfaces even when the location is hidden.
    expect(pitch?.datingIntent).toBe('long-term');
  });

  it('exposes the dater-approved structure snapshot when it matches the shape (CP-1/CP-2)', async () => {
    const structure = {
      hook: 'The friend who always shows up',
      relationship_context: 'college roommates',
      three_specific_qualities: ['loyal', 'funny', 'curious'],
      evidence_or_anecdote: 'drove six hours to help me move',
      good_match_for: 'someone who values showing up',
      hard_claims_requiring_confirmation: [],
    };
    configurePublishedPitchClient(campaignRow, { draft: { ...draftRow, structure } });
    const client = createServiceClient('https://project.example', 'service-key');

    const pitch = await getPublishedPitchBySlug(client, 'blair-abc123');

    expect(pitch?.structure).toEqual(structure);
  });

  it('reads a partial structure snapshot as null rather than leaking it (CP-2)', async () => {
    configurePublishedPitchClient(campaignRow, {
      draft: { ...draftRow, structure: { hook: 'partial only' } },
    });
    const client = createServiceClient('https://project.example', 'service-key');

    const pitch = await getPublishedPitchBySlug(client, 'blair-abc123');

    expect(pitch?.structure).toBeNull();
  });
});

describe('ageFromBirthDate', () => {
  it('returns whole years elapsed in UTC', () => {
    expect(ageFromBirthDate('1994-05-20', new Date('2026-07-14T00:00:00Z'))).toBe(32);
  });

  it('does not count a birthday that has not arrived this year', () => {
    expect(ageFromBirthDate('1994-12-31', new Date('2026-07-14T00:00:00Z'))).toBe(31);
  });

  it('returns null for a missing or unparseable date and for a future date', () => {
    expect(ageFromBirthDate(null, new Date('2026-07-14T00:00:00Z'))).toBeNull();
    expect(ageFromBirthDate('not-a-date', new Date('2026-07-14T00:00:00Z'))).toBeNull();
    expect(ageFromBirthDate('2030-01-01', new Date('2026-07-14T00:00:00Z'))).toBeNull();
  });
});

describe('canonicalApproximateLocation', () => {
  it('strips the city for region precision but keeps "City, Region" for city', () => {
    expect(canonicalApproximateLocation('region', 'Puget Sound', 'Seattle', null)).toBe(
      'Puget Sound',
    );
    expect(canonicalApproximateLocation('city', 'Puget Sound', 'Seattle', null)).toBe(
      'Seattle, Puget Sound',
    );
  });

  it('falls back to the region alone when the city is blank', () => {
    expect(canonicalApproximateLocation('city', 'Puget Sound', '  ', null)).toBe('Puget Sound');
  });

  it('fails region precision closed for legacy rows but lets city fall back', () => {
    // CP-1 invariant: region precision must never leak the city-level legacy
    // string, so it fails closed to null.
    expect(canonicalApproximateLocation('region', null, null, 'Seattle')).toBeNull();
    expect(canonicalApproximateLocation('city', null, null, 'Seattle')).toBe('Seattle');
    expect(canonicalApproximateLocation('region', null, null, null)).toBeNull();
    expect(canonicalApproximateLocation('city', null, null, null)).toBeNull();
  });
});
