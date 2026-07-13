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
import { getPublishedPitchBySlug } from './publishedPitchRepo';

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
  signedUpload: vi.fn(),
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
      return {
        insert: mocks.draftInsert,
        update: mocks.draftUpdate,
        select: mocks.draftSelect,
      };
    },
    storage: {
      from: () => ({
        createSignedUploadUrl: mocks.signedUpload,
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

  it('reads the claimed draft row for review', async () => {
    signedInSession();
    const row = { id: draftId, status: 'consent_pending' };
    mocks.draftSelect.mockReturnValue({
      eq: () => ({ single: async () => ({ data: row, error: null }) }),
    });
    const repo = new ConsentRepo(createBrowserClient('https://project.example', 'anon-key'));

    await expect(repo.getDraftForReview(draftId)).resolves.toEqual(row);
  });

  it('creates a scoped signed playback URL for the voice note', async () => {
    signedInSession();
    mocks.signedUrl.mockResolvedValue({
      data: { signedUrl: 'https://storage.example/signed-read' },
      error: null,
    });
    const repo = new ConsentRepo(createBrowserClient('https://project.example', 'anon-key'));

    const url = await repo.createVoicePlaybackUrl(draftId);

    expect(mocks.signedUrl).toHaveBeenCalledWith(`${draftId}/voice.m4a`, 3600);
    expect(url).toBe('https://storage.example/signed-read');
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

    const published = await repo.approveAndPublish(draftId);

    expect(mocks.rpc).toHaveBeenCalledWith('approve_and_publish_pitch', {
      draft_id: draftId,
      campaign_days: 30,
    });
    expect(published).toEqual({
      campaignId: '20000000-0000-0000-0000-000000000001',
      campaignSlug: 'blair-abc123',
    });
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
  };
  const profileRows = [
    { user_id: '00000000-0000-0000-0000-000000000001', display_name: 'Maya' },
    { user_id: '00000000-0000-0000-0000-000000000002', display_name: 'Blair' },
  ];

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

  function configurePublishedPitchClient(campaign: unknown): void {
    tableMock.mockImplementation((table: string) => {
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
          select: () => ({ eq: () => ({ single: async () => ({ data: draftRow, error: null }) }) }),
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
        select: () => ({ in: async () => ({ data: profileRows, error: null }) }),
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

  it('maps the campaign, draft, profiles, and signed voice URL', async () => {
    configurePublishedPitchClient(campaignRow);
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
      voiceUrl: `https://storage.example/${draftRow.id}/voice.m4a`,
      photos: [
        {
          url: `https://storage.example/${draftRow.id}/photo-1.jpg`,
          sortOrder: 0,
        },
      ],
    });
  });
});
