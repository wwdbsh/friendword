// THIRD-AUDIT REGRESSION — P0-NEW-1 / P0-NEW-2 (web media validation)
// (a) consent absent  → OpenAI adapter called 0 times + 'skipped' recorded
// (b) succeeded replay → adapter 0 times + stored verdict reused
// (c) provider failure → reconcile('failed') with the lease, conservative cost
/* global afterEach, beforeEach, describe, expect, it, vi */

import { createServiceFake, validPngBytes } from './serviceClientFake';

const CALLER_ID = '11111111-1111-4111-8111-111111111111';

const checkImage = vi.fn();
const checkText = vi.fn();

const mocks = vi.hoisted(() => ({
  getSupabaseServiceClient: vi.fn<() => unknown>(),
}));

vi.mock('@/lib/supabaseServer', () => ({
  getSupabaseServiceClient: mocks.getSupabaseServiceClient,
}));

vi.mock('@friendword/data', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    createBrowserClient: () => ({
      auth: {
        getUser: async () => ({ data: { user: { id: CALLER_ID } }, error: null }),
      },
    }),
  };
});

vi.mock('@friendword/adapters', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    createProviders: () => ({
      moderation: { checkImage, checkText },
      transcription: {},
      pitchStructure: {},
      identityVerification: {},
    }),
  };
});

import { POST } from '../app/api/media/validate/route';

function requestFor(objectName: string, bucket = 'profile-media'): Request {
  return new Request('http://localhost/api/media/validate', {
    method: 'POST',
    headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
    body: JSON.stringify({ bucket, objectName }),
  });
}

const OBJECT = `${CALLER_ID}/photo.png`;

describe('media/validate — third audit consent + replay + failure accounting', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.test';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
    process.env.OPENAI_API_KEY = 'sk-test';
    checkImage.mockReset();
    checkText.mockReset();
    mocks.getSupabaseServiceClient.mockReset();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('[a] consent absent: never calls OpenAI and records moderation skipped', async () => {
    const fake = createServiceFake({
      downloadBytes: validPngBytes(),
      reserveError: { message: 'external AI processing consent is required' },
    });
    mocks.getSupabaseServiceClient.mockReturnValue(fake.client);

    const response = await POST(requestFor(OBJECT));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ moderationStatus: 'skipped' });
    expect(checkImage).toHaveBeenCalledTimes(0);
    const written = fake.upserts.find((u) => u.table === 'media_validations');
    expect(written?.row.moderation_status).toBe('skipped');
    // Reservation was attempted (gate ran) but no reconcile happened.
    expect(fake.rpcCalls.map((c) => c.fn)).toContain('reserve_provider_usage');
    expect(fake.rpcCalls.some((c) => c.fn === 'reconcile_provider_usage')).toBe(false);
  });

  it('[b] succeeded replay: reuses the stored verdict, never re-calls OpenAI', async () => {
    const fake = createServiceFake({
      downloadBytes: validPngBytes(),
      reserveRow: {
        reservation_id: 'res-old',
        prior_status: 'succeeded',
        granted: false,
        lease_token: null,
      },
      storedModeration: { moderation_status: 'passed', moderation_ref: null },
    });
    mocks.getSupabaseServiceClient.mockReturnValue(fake.client);

    const response = await POST(requestFor(OBJECT));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ moderationStatus: 'passed' });
    expect(checkImage).toHaveBeenCalledTimes(0);
    // The re-written row must not revert moderation to 'skipped'.
    const written = fake.upserts.find((u) => u.table === 'media_validations');
    expect(written?.row.moderation_status).toBe('passed');
  });

  it('[c] provider failure: reconciles failed with the lease and returns 502', async () => {
    const fake = createServiceFake({
      downloadBytes: validPngBytes(),
      reserveRow: {
        reservation_id: 'res-1',
        prior_status: 'new',
        granted: true,
        lease_token: 'lease-1',
      },
    });
    mocks.getSupabaseServiceClient.mockReturnValue(fake.client);
    checkImage.mockRejectedValue(new Error('provider timeout'));

    const response = await POST(requestFor(OBJECT));

    expect(response.status).toBe(502);
    expect(checkImage).toHaveBeenCalledTimes(1);
    const reconcile = fake.rpcCalls.find((c) => c.fn === 'reconcile_provider_usage');
    expect(reconcile?.params).toMatchObject({
      target_reservation_id: 'res-1',
      target_lease_token: 'lease-1',
      actual_cents: 0,
      final_status: 'failed',
    });
  });

  it('[d] reserved-in-progress: refuses without calling OpenAI', async () => {
    const fake = createServiceFake({
      downloadBytes: validPngBytes(),
      reserveRow: {
        reservation_id: 'res-2',
        prior_status: 'reserved',
        granted: false,
        lease_token: null,
      },
    });
    mocks.getSupabaseServiceClient.mockReturnValue(fake.client);

    const response = await POST(requestFor(OBJECT));

    expect(response.status).toBe(409);
    expect(checkImage).toHaveBeenCalledTimes(0);
  });

  it('granted happy path: calls OpenAI once and reconciles succeeded=1', async () => {
    const fake = createServiceFake({
      downloadBytes: validPngBytes(),
      reserveRow: {
        reservation_id: 'res-3',
        prior_status: 'new',
        granted: true,
        lease_token: 'lease-3',
      },
    });
    mocks.getSupabaseServiceClient.mockReturnValue(fake.client);
    checkImage.mockResolvedValue({ allowed: true, categories: [] });

    const response = await POST(requestFor(OBJECT));

    expect(response.status).toBe(200);
    expect(checkImage).toHaveBeenCalledTimes(1);
    const reconcile = fake.rpcCalls.find((c) => c.fn === 'reconcile_provider_usage');
    expect(reconcile?.params).toMatchObject({
      target_reservation_id: 'res-3',
      target_lease_token: 'lease-3',
      actual_cents: 1,
      final_status: 'succeeded',
    });
  });
});
