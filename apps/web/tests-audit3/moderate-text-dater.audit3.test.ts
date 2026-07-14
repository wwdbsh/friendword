// THIRD-AUDIT REGRESSION — P0-NEW-3 (dater revision text moderation)
// /api/moderate-text gains a `dater_pitch_content` kind so the subject can
// moderate the copy they are about to freeze into a revision. It must:
//   (a) authorize only the subject while consent_pending, record scope
//       'pitch_content' with the hash the DB gate checks (trim + formula), and
//       reserve against the draft with the Dater as the authoritative user;
//   (b) 404 for a non-subject caller without touching the provider;
//   (c) 404 once the draft has left consent_pending.
/* global afterEach, beforeEach, describe, expect, it, vi */

import { createHash } from 'node:crypto';

import { createServiceFake } from './serviceClientFake';

const CALLER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ID = '22222222-2222-4222-8222-222222222222';
const DRAFT_ID = '33333333-3333-4333-8333-333333333333';

// Raw (untrimmed) input proves the route trims before hashing, exactly as
// ConsentRepo does before calling create_dater_revision.
const RAW_HEADLINE = '  Blair, in Blair’s own words.  ';
const RAW_BODY = '  I rewrote this myself: warm and honest.  ';
const EXPECTED_CONTENT = `${RAW_HEADLINE.trim()}\n\n${RAW_BODY.trim()}`;
const EXPECTED_HASH = createHash('sha256').update(EXPECTED_CONTENT, 'utf8').digest('hex');

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

import { POST } from '../app/api/moderate-text/route';

function daterRequest(): Request {
  return new Request('http://localhost/api/moderate-text', {
    method: 'POST',
    headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
    body: JSON.stringify({
      kind: 'dater_pitch_content',
      draftId: DRAFT_ID,
      headline: RAW_HEADLINE,
      body: RAW_BODY,
    }),
  });
}

const grantedReservation = {
  reservation_id: 'res-1',
  prior_status: 'new',
  granted: true,
  lease_token: 'lease-1',
};

describe('moderate-text — dater_pitch_content authorization + content-addressed hash', () => {
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

  it('[a] subject + consent_pending: records scope pitch_content with the gate hash', async () => {
    const fake = createServiceFake({
      draftSubjectId: CALLER_ID,
      draftStatus: 'consent_pending',
      reserveRow: grantedReservation,
    });
    mocks.getSupabaseServiceClient.mockReturnValue(fake.client);
    checkText.mockResolvedValue({ allowed: true, categories: [] });

    const response = await POST(daterRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, moderationStatus: 'passed' });
    expect(checkText).toHaveBeenCalledWith(EXPECTED_CONTENT);

    const reserve = fake.rpcCalls.find((c) => c.fn === 'reserve_provider_usage');
    expect(reserve?.params).toMatchObject({
      target_user_id: CALLER_ID,
      usage_kind: 'moderate_text',
      scope_draft_id: DRAFT_ID,
      request_ref: `moderate-text:pitch_content:${EXPECTED_HASH}`,
    });

    const written = fake.upserts.find((u) => u.table === 'text_moderations');
    expect(written?.row).toMatchObject({
      scope: 'pitch_content',
      content_hash: EXPECTED_HASH,
      moderation_status: 'passed',
      subject_user_id: CALLER_ID,
      pitch_draft_id: DRAFT_ID,
    });
  });

  it('[b] non-subject caller: 404 without calling the provider or reserving', async () => {
    const fake = createServiceFake({
      draftSubjectId: OTHER_ID,
      draftStatus: 'consent_pending',
      reserveRow: grantedReservation,
    });
    mocks.getSupabaseServiceClient.mockReturnValue(fake.client);

    const response = await POST(daterRequest());

    expect(response.status).toBe(404);
    expect(checkText).toHaveBeenCalledTimes(0);
    expect(fake.rpcCalls.some((c) => c.fn === 'reserve_provider_usage')).toBe(false);
  });

  it('[c] subject but draft no longer consent_pending: 404', async () => {
    const fake = createServiceFake({
      draftSubjectId: CALLER_ID,
      draftStatus: 'published',
      reserveRow: grantedReservation,
    });
    mocks.getSupabaseServiceClient.mockReturnValue(fake.client);

    const response = await POST(daterRequest());

    expect(response.status).toBe(404);
    expect(checkText).toHaveBeenCalledTimes(0);
  });

  it('[d] flagged copy comes back flagged so it never freezes into a revision', async () => {
    const fake = createServiceFake({
      draftSubjectId: CALLER_ID,
      draftStatus: 'consent_pending',
      reserveRow: grantedReservation,
    });
    mocks.getSupabaseServiceClient.mockReturnValue(fake.client);
    checkText.mockResolvedValue({ allowed: false, categories: ['harassment'] });

    const response = await POST(daterRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      moderationStatus: 'flagged',
    });
  });
});
