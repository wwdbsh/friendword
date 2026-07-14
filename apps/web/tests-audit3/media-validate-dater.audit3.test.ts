// THIRD-AUDIT REGRESSION — P0-NEW-3 (dater authoritative validation)
// /api/media/validate on the pitch-media bucket must authorize:
//   (a) the Dater (subject) while the draft is consent_pending  → allowed
//   (b) a stranger (neither creator nor subject)                → 403
//   (c) the Introducer (creator)                                → allowed
//   (d) the Dater once the draft has left consent_pending       → 403
// The pre-fix route only accepted created_by_user_id, so the Dater always 403'd
// and the E2E hid it by mocking the route. No mock here: the real POST runs.
/* global afterEach, beforeEach, describe, expect, it, vi */

import { createServiceFake, validPngBytes } from './serviceClientFake';

const CALLER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ID = '22222222-2222-4222-8222-222222222222';
const DRAFT_ID = '33333333-3333-4333-8333-333333333333';
const OBJECT = `${DRAFT_ID}/photo.png`;

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

function pitchMediaRequest(): Request {
  return new Request('http://localhost/api/media/validate', {
    method: 'POST',
    headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
    body: JSON.stringify({ bucket: 'pitch-media', objectName: OBJECT }),
  });
}

const grantedReservation = {
  reservation_id: 'res-1',
  prior_status: 'new',
  granted: true,
  lease_token: 'lease-1',
};

describe('media/validate — dater (subject) authorization on pitch-media', () => {
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

  it('[a] dater subject + consent_pending: authorized, moderates, records verdict', async () => {
    const fake = createServiceFake({
      draftOwnerId: OTHER_ID,
      draftSubjectId: CALLER_ID,
      draftStatus: 'consent_pending',
      downloadBytes: validPngBytes(),
      reserveRow: grantedReservation,
    });
    mocks.getSupabaseServiceClient.mockReturnValue(fake.client);
    checkImage.mockResolvedValue({ allowed: true, categories: [] });

    const response = await POST(pitchMediaRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ moderationStatus: 'passed' });
    // Reservation runs with the Dater as the authoritative target and the draft
    // as scope — the Dater's own draft-scoped AI consent gates the provider.
    const reserve = fake.rpcCalls.find((c) => c.fn === 'reserve_provider_usage');
    expect(reserve?.params).toMatchObject({
      target_user_id: CALLER_ID,
      usage_kind: 'media_validate',
      scope_draft_id: DRAFT_ID,
    });
  });

  it('[b] stranger (neither creator nor subject): 403 before any download', async () => {
    const fake = createServiceFake({
      draftOwnerId: OTHER_ID,
      draftSubjectId: OTHER_ID,
      draftStatus: 'consent_pending',
      downloadBytes: validPngBytes(),
      reserveRow: grantedReservation,
    });
    mocks.getSupabaseServiceClient.mockReturnValue(fake.client);

    const response = await POST(pitchMediaRequest());

    expect(response.status).toBe(403);
    expect(checkImage).toHaveBeenCalledTimes(0);
    expect(fake.rpcCalls.some((c) => c.fn === 'reserve_provider_usage')).toBe(false);
  });

  it('[c] introducer (creator): still authorized', async () => {
    const fake = createServiceFake({
      draftOwnerId: CALLER_ID,
      draftSubjectId: OTHER_ID,
      draftStatus: 'consent_pending',
      downloadBytes: validPngBytes(),
      reserveRow: grantedReservation,
    });
    mocks.getSupabaseServiceClient.mockReturnValue(fake.client);
    checkImage.mockResolvedValue({ allowed: true, categories: [] });

    const response = await POST(pitchMediaRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ moderationStatus: 'passed' });
  });

  it('[d] dater subject but draft no longer consent_pending: 403', async () => {
    const fake = createServiceFake({
      draftOwnerId: OTHER_ID,
      draftSubjectId: CALLER_ID,
      draftStatus: 'published',
      downloadBytes: validPngBytes(),
      reserveRow: grantedReservation,
    });
    mocks.getSupabaseServiceClient.mockReturnValue(fake.client);

    const response = await POST(pitchMediaRequest());

    expect(response.status).toBe(403);
    expect(checkImage).toHaveBeenCalledTimes(0);
  });
});
