import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createClient } from '@supabase/supabase-js';

import { ensureUserRow, signInWithOtp, verifyOtp } from './auth';
import {
  createBrowserClient,
  createMobileClient,
  createServiceClient,
  type BrowserSupabaseClient,
  type ServiceSupabaseClient,
} from './client';
import { InvalidDraftUpdateError, InvalidStoragePathError, UnauthenticatedError } from './errors';
import { buildPitchMediaPath, PitchDraftRepo } from './pitchDraftRepo';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getSession: vi.fn(),
  signInWithOtp: vi.fn(),
  verifyOtp: vi.fn(),
  usersUpsert: vi.fn(),
  profilesUpsert: vi.fn(),
  draftInsert: vi.fn(),
  draftUpdate: vi.fn(),
  draftSelect: vi.fn(),
  signedUpload: vi.fn(),
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
        return { upsert: mocks.profilesUpsert };
      }
      return {
        insert: mocks.draftInsert,
        update: mocks.draftUpdate,
        select: mocks.draftSelect,
      };
    },
    storage: {
      from: () => ({ createSignedUploadUrl: mocks.signedUpload }),
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
