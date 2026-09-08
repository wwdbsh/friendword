// T001 / issue #70 — /api/transcribe must refuse to draft from silence.
// Production returned `".     .  .  "` for a 54s recording and the structuring
// model invented a complete pitch from it, which reached the dater's review,
// the public page and the MP4. The route must:
//   (a) stop after transcription: no structuring call, no draft write, no
//       transcript persisted, and a 422 carrying `insufficient_speech`;
//   (b) close the reservation as succeeded (the transcription was paid for);
//   (c) leave the real-speech happy path exactly as it was.
/* global beforeEach, describe, expect, it, vi */

import { EmptyTranscriptionError } from '@friendword/adapters';

import { createServiceFake } from './serviceClientFake';

const CALLER_ID = '11111111-1111-4111-8111-111111111111';
const DRAFT_ID = '33333333-3333-4333-8333-333333333333';

/** Verbatim production transcript from the incident. */
const SILENT_TRANSCRIPT = {
  text: '.     .  .  ',
  language: 'en',
  segments: [
    { start: 28.58, end: 29.98, text: '.' },
    { start: 36.24, end: 37.64, text: '.' },
    { start: 37.64, end: 37.66, text: '.' },
  ],
  words: [],
  durationSeconds: 54.543,
};

const REAL_TRANSCRIPT = {
  text:
    'This is my friend Jordan and we met in our first year of university about eight ' +
    'years ago. He drove four hours in the rain to help me move and refused gas money. ' +
    'He would be great with someone curious who likes being outside.',
  language: 'en',
  segments: [{ start: 0.2, end: 42.0, text: 'This is my friend Jordan' }],
  words: [],
  durationSeconds: 45.1,
};

const structure = vi.fn();
const transcribe = vi.fn();
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
      auth: { getUser: async () => ({ data: { user: { id: CALLER_ID } }, error: null }) },
    }),
  };
});

vi.mock('@friendword/adapters', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    createProviders: () => ({
      moderation: { checkText, checkImage: vi.fn() },
      transcription: { transcribe },
      pitchStructure: { structure },
      identityVerification: {},
    }),
  };
});

import { POST } from '../app/api/transcribe/route';

function transcribeRequest(): Request {
  return new Request('http://localhost/api/transcribe', {
    method: 'POST',
    headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
    body: JSON.stringify({ draftId: DRAFT_ID }),
  });
}

function serviceFake() {
  return createServiceFake({
    draftOwnerId: CALLER_ID,
    draftStatus: 'draft',
    reserveRow: {
      reservation_id: 'res-1',
      prior_status: null,
      granted: true,
      lease_token: 'lease-1',
    },
    updateReturnsRow: { id: DRAFT_ID },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
  process.env.OPENAI_API_KEY = 'sk-test';
  checkText.mockResolvedValue({ allowed: true, categories: [] });
  structure.mockResolvedValue({
    hook: 'Meet Jordan.',
    relationship_context: 'University friends.',
    three_specific_qualities: ['kind', 'funny', 'generous'],
    evidence_or_anecdote: 'Drove four hours in the rain.',
    good_match_for: 'Someone curious.',
    hard_claims_requiring_confirmation: [],
  });
});

describe('/api/transcribe insufficient speech guard (T001)', () => {
  it('refuses the silent production transcript without structuring or writing', async () => {
    const fake = serviceFake();
    mocks.getSupabaseServiceClient.mockReturnValue(fake.client);
    transcribe.mockResolvedValue(SILENT_TRANSCRIPT);

    const response = await POST(transcribeRequest());
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(422);
    expect(body.code).toBe('insufficient_speech');
    expect(body.reason).toBe('no_words');
    expect(body.wordCount).toBe(0);
    // Nothing was invented and nothing was persisted.
    expect(structure).not.toHaveBeenCalled();
    expect(checkText).not.toHaveBeenCalled();
    expect(fake.updates.filter((update) => update.table === 'pitch_drafts')).toEqual([]);
    expect(fake.upserts.filter((upsert) => upsert.table === 'analytics_events')).toEqual([]);
  });

  // B1: without this the advice to re-record is unfollowable — signed uploads
  // are upsert:false and creators hold INSERT only, so the silent object would
  // sit there forever and every retry would answer "already transcribed".
  it('deletes the unusable voice object so the next take can replace it', async () => {
    const fake = serviceFake();
    mocks.getSupabaseServiceClient.mockReturnValue(fake.client);
    transcribe.mockResolvedValue(SILENT_TRANSCRIPT);

    await POST(transcribeRequest());

    expect(fake.removedObjects).toEqual([`${DRAFT_ID}/voice.m4a`]);
    // The stored verdict described bytes that no longer exist.
    expect(fake.deletes).toContain('media_validations');
  });

  // The status gate runs before a provider call that takes seconds. Another
  // session can send a changes_requested draft for consent in that window, and
  // a consent revision must never point at bytes this request deleted.
  it('leaves the object alone when the draft left the editable states mid-flight', async () => {
    const fake = createServiceFake({
      draftOwnerId: CALLER_ID,
      draftStatuses: ['changes_requested', 'awaiting_consent'],
      reserveRow: {
        reservation_id: 'res-1',
        prior_status: null,
        granted: true,
        lease_token: 'lease-1',
      },
    });
    mocks.getSupabaseServiceClient.mockReturnValue(fake.client);
    transcribe.mockResolvedValue(SILENT_TRANSCRIPT);

    const response = await POST(transcribeRequest());

    expect(response.status).toBe(422);
    expect(fake.removedObjects).toEqual([]);
    expect(fake.deletes).not.toContain('media_validations');
  });

  it('still refuses, and stays a 422, when the object cannot be deleted', async () => {
    const fake = createServiceFake({
      draftOwnerId: CALLER_ID,
      draftStatus: 'draft',
      reserveRow: {
        reservation_id: 'res-1',
        prior_status: null,
        granted: true,
        lease_token: 'lease-1',
      },
      removeError: { message: 'storage unavailable' },
    });
    mocks.getSupabaseServiceClient.mockReturnValue(fake.client);
    transcribe.mockResolvedValue(SILENT_TRANSCRIPT);

    const response = await POST(transcribeRequest());

    expect(response.status).toBe(422);
    // The verdict row is left alone when its object survived.
    expect(fake.deletes).not.toContain('media_validations');
  });

  it('refuses a whisper silence hallucination the same way', async () => {
    const fake = serviceFake();
    mocks.getSupabaseServiceClient.mockReturnValue(fake.client);
    transcribe.mockResolvedValue({ ...SILENT_TRANSCRIPT, text: 'Thank you.', segments: [] });

    const response = await POST(transcribeRequest());
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(422);
    expect(body.reason).toBe('too_few_words');
    expect(structure).not.toHaveBeenCalled();
  });

  it('closes the paid reservation as succeeded when it refuses', async () => {
    const fake = serviceFake();
    mocks.getSupabaseServiceClient.mockReturnValue(fake.client);
    transcribe.mockResolvedValue(SILENT_TRANSCRIPT);

    const response = await POST(transcribeRequest());

    expect(response.status).toBe(422);
    const reconcile = fake.rpcCalls.filter((call) => call.fn === 'reconcile_provider_usage');
    expect(reconcile).toHaveLength(1);
    expect(reconcile[0]?.params).toEqual(
      expect.objectContaining({ final_status: 'succeeded', actual_cents: 3 }),
    );
  });

  // Reproduced in the simulator against production with a 37s silent take:
  // whisper returned no text at all, the adapter threw, and the route answered
  // 502 — so the app showed "check your connection" for a recording that simply
  // had nothing in it. That outcome belongs to the same contract.
  it('maps a provider that returned no text at all onto the same refusal', async () => {
    const fake = serviceFake();
    mocks.getSupabaseServiceClient.mockReturnValue(fake.client);
    transcribe.mockRejectedValue(new EmptyTranscriptionError());

    const response = await POST(transcribeRequest());
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(422);
    expect(body.code).toBe('insufficient_speech');
    expect(body.reason).toBe('no_words');
    expect(body.wordCount).toBe(0);
    expect(structure).not.toHaveBeenCalled();
    expect(fake.updates.filter((update) => update.table === 'pitch_drafts')).toEqual([]);
    const reconcile = fake.rpcCalls.filter((call) => call.fn === 'reconcile_provider_usage');
    expect(reconcile[0]?.params).toEqual(
      expect.objectContaining({ final_status: 'succeeded', actual_cents: 3 }),
    );
  });

  it('still reports a genuine provider failure as a retryable 502', async () => {
    const fake = serviceFake();
    mocks.getSupabaseServiceClient.mockReturnValue(fake.client);
    transcribe.mockRejectedValue(new Error('transcription failed (503)'));

    const response = await POST(transcribeRequest());

    expect(response.status).toBe(502);
    expect(fake.removedObjects).toEqual([]);
    const reconcile = fake.rpcCalls.filter((call) => call.fn === 'reconcile_provider_usage');
    expect(reconcile[0]?.params).toEqual(
      expect.objectContaining({ final_status: 'failed', actual_cents: 0 }),
    );
  });

  // S1: three different situations answer 409 here, and the app used to read
  // every one of them as "confirm AI consent again".
  it('tags its 409s so the app can tell them apart', async () => {
    const alreadyDone = createServiceFake({
      draftOwnerId: CALLER_ID,
      draftStatus: 'draft',
      reserveRow: {
        reservation_id: 'res-1',
        prior_status: 'succeeded',
        granted: false,
        lease_token: null,
      },
    });
    mocks.getSupabaseServiceClient.mockReturnValue(alreadyDone.client);
    const done = await POST(transcribeRequest());
    expect(done.status).toBe(409);
    expect(((await done.json()) as Record<string, unknown>).code).toBe('already_transcribed');

    const inFlight = createServiceFake({
      draftOwnerId: CALLER_ID,
      draftStatus: 'draft',
      reserveRow: {
        reservation_id: 'res-2',
        prior_status: 'reserved',
        granted: false,
        lease_token: null,
      },
    });
    mocks.getSupabaseServiceClient.mockReturnValue(inFlight.client);
    const busy = await POST(transcribeRequest());
    expect(busy.status).toBe(409);
    expect(((await busy.json()) as Record<string, unknown>).code).toBe('transcription_in_progress');

    const consent = createServiceFake({
      draftOwnerId: CALLER_ID,
      draftStatus: 'draft',
      reserveError: { message: 'external AI processing consent is required' },
    });
    mocks.getSupabaseServiceClient.mockReturnValue(consent.client);
    const refused = await POST(transcribeRequest());
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as Record<string, unknown>).code).toBe('ai_consent_required');

    expect(transcribe).not.toHaveBeenCalled();
  });

  it('still drafts from a real recording', async () => {
    const fake = serviceFake();
    mocks.getSupabaseServiceClient.mockReturnValue(fake.client);
    transcribe.mockResolvedValue(REAL_TRANSCRIPT);

    const response = await POST(transcribeRequest());
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body.headline).toBe('Meet Jordan.');
    expect(structure).toHaveBeenCalledOnce();
    // A usable take is never deleted.
    expect(fake.removedObjects).toEqual([]);
    const draftUpdate = fake.updates.find((update) => update.table === 'pitch_drafts');
    expect(draftUpdate?.row).toEqual(
      expect.objectContaining({ headline: 'Meet Jordan.', transcript: expect.anything() }),
    );
  });
});
