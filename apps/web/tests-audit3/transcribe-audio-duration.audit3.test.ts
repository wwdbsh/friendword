// T003 / issue #72 — /api/transcribe must persist the recording's real length.
//
// The scene the dater approves is timed by `transcript->'durationMs'` from
// migration 0062 on, and this route is the only writer of it. Production: a
// 54.543s take whose last transcript segment ended at 37.66s published a
// 37660ms scene, so the picture froze while fifteen seconds of the friend's
// voice played on.
//
// The value is the PROVIDER's reported audio length for the object it decoded —
// never a client measurement — and it is whole milliseconds, because
// `private.pitch_scene_integer` (the DB's reader, which the contracts builder
// mirrors) accepts nothing else.
/* global beforeEach, describe, expect, it, vi */

import { createServiceFake } from './serviceClientFake';

const CALLER_ID = '11111111-1111-4111-8111-111111111111';
const DRAFT_ID = '33333333-3333-4333-8333-333333333333';

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

function storedTranscript(fake: ReturnType<typeof serviceFake>): Record<string, unknown> {
  const update = fake.updates.find((entry) => entry.table === 'pitch_drafts');
  return (update?.row as { transcript?: Record<string, unknown> } | undefined)?.transcript ?? {};
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

describe('/api/transcribe persists the recording length (T003)', () => {
  it('writes the provider-reported length as whole milliseconds', async () => {
    const fake = serviceFake();
    mocks.getSupabaseServiceClient.mockReturnValue(fake.client);
    transcribe.mockResolvedValue({ ...REAL_TRANSCRIPT, durationSeconds: 54.543 });

    const response = await POST(transcribeRequest());

    expect(response.status).toBe(200);
    expect(storedTranscript(fake).durationMs).toBe(54_543);
  });

  it('omits the key entirely when the provider reports no length', async () => {
    const fake = serviceFake();
    mocks.getSupabaseServiceClient.mockReturnValue(fake.client);
    const noDuration: Record<string, unknown> = { ...REAL_TRANSCRIPT };
    delete noDuration.durationSeconds;
    transcribe.mockResolvedValue(noDuration);

    await POST(transcribeRequest());

    // Absent, not zero and not null: the row then reads exactly as a pre-T003
    // row, and both the builder and the database time it by its segments.
    expect(Object.keys(storedTranscript(fake))).not.toContain('durationMs');
  });

  it('drops a reported length its own transcript contradicts', async () => {
    const fake = serviceFake();
    mocks.getSupabaseServiceClient.mockReturnValue(fake.client);
    // The provider's last segment ends at 42s, so a 30s audio length cannot be
    // true. The database takes the greater of the two anyway; the transcript
    // still must not carry a number its own words disprove.
    transcribe.mockResolvedValue({ ...REAL_TRANSCRIPT, durationSeconds: 30 });

    await POST(transcribeRequest());

    expect(Object.keys(storedTranscript(fake))).not.toContain('durationMs');
  });

  it('drops a length that is not a length at all', async () => {
    for (const durationSeconds of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 86_401]) {
      const fake = serviceFake();
      mocks.getSupabaseServiceClient.mockReturnValue(fake.client);
      transcribe.mockResolvedValue({ ...REAL_TRANSCRIPT, durationSeconds });

      await POST(transcribeRequest());

      expect(Object.keys(storedTranscript(fake))).not.toContain('durationMs');
    }
  });

  // The segments are what the scene hangs its shots on; the length only extends
  // the last one. Writing the length must not disturb anything else on the row.
  it('leaves the rest of the stored transcript alone', async () => {
    const fake = serviceFake();
    mocks.getSupabaseServiceClient.mockReturnValue(fake.client);
    transcribe.mockResolvedValue({ ...REAL_TRANSCRIPT, durationSeconds: 54.543 });

    await POST(transcribeRequest());

    expect(storedTranscript(fake)).toEqual(
      expect.objectContaining({
        text: REAL_TRANSCRIPT.text,
        language: 'en',
        segments: REAL_TRANSCRIPT.segments,
      }),
    );
  });
});
