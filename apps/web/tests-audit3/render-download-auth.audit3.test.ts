// MP4 RENDER DOWNLOAD — /kit/[draftId]/render-download authorization (E5).
// The render output lives under pitch-media/<draft>/renders/, a nested prefix
// the member storage SELECT policy cannot see (0003 parses flat paths only —
// 0054 relies on that to keep renders out of the object quota), so this route
// is the ONLY member path to the MP4 and must re-enforce the participant
// relationship itself:
//   (a) the introducer (created_by)          → signed URL for the exact path
//   (b) the dater (subject)                  → signed URL
//   (c) a stranger                           → 403, storage never touched
//   (d) missing object                       → 404, nothing signed
//   (e) malformed revisionId                 → 400 before auth-independent work
/* global beforeEach, describe, expect, it, vi */

const CALLER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ID = '22222222-2222-4222-8222-222222222222';
const DRAFT_ID = '33333333-3333-4333-8333-333333333333';
const REVISION_ID = '44444444-4444-4444-8444-444444444444';

type FakeConfig = {
  readonly draftOwnerId?: string | null;
  readonly draftSubjectId?: string | null;
  readonly draftExists?: boolean;
  readonly objectExists?: boolean;
};

type StorageCall = { readonly op: 'list' | 'sign'; readonly path: string };

function createFake(config: FakeConfig) {
  const storageCalls: StorageCall[] = [];
  const client = {
    from: (table: string) => {
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: () =>
          Promise.resolve(
            table === 'pitch_drafts' && (config.draftExists ?? true)
              ? {
                  data: {
                    created_by_user_id: config.draftOwnerId ?? null,
                    subject_user_id: config.draftSubjectId ?? null,
                  },
                  error: null,
                }
              : { data: null, error: null },
          ),
      };
      return builder;
    },
    storage: {
      from: () => ({
        list: (path: string) => {
          storageCalls.push({ op: 'list', path });
          if (config.objectExists ?? true) {
            return Promise.resolve({
              data: [{ name: `${REVISION_ID}.mp4`, id: 'obj-1' }],
              error: null,
            });
          }
          return Promise.resolve({ data: [], error: null });
        },
        createSignedUrl: (path: string) => {
          storageCalls.push({ op: 'sign', path });
          return Promise.resolve({
            data: { signedUrl: `https://signed.example/${path}` },
            error: null,
          });
        },
      }),
    },
  };
  return { client, storageCalls };
}

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

import { GET } from '../app/kit/[draftId]/render-download/route';

function downloadRequest(revisionId: string = REVISION_ID): Request {
  return new Request(`http://localhost/kit/${DRAFT_ID}/render-download?revisionId=${revisionId}`, {
    headers: { authorization: 'Bearer token' },
  });
}

function routeContext(): { params: Promise<{ draftId: string }> } {
  return { params: Promise.resolve({ draftId: DRAFT_ID }) };
}

describe('kit render-download — participant-only signed URLs', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.test';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
    mocks.getSupabaseServiceClient.mockReset();
  });

  it('[a] the introducer gets a signed URL for the exact render path', async () => {
    const fake = createFake({ draftOwnerId: CALLER_ID, draftSubjectId: OTHER_ID });
    mocks.getSupabaseServiceClient.mockReturnValue(fake.client);

    const response = await GET(downloadRequest(), routeContext());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      url: `https://signed.example/${DRAFT_ID}/renders/${REVISION_ID}.mp4`,
    });
    expect(fake.storageCalls).toContainEqual({
      op: 'sign',
      path: `${DRAFT_ID}/renders/${REVISION_ID}.mp4`,
    });
  });

  it('[b] the dater (subject) gets a signed URL too', async () => {
    const fake = createFake({ draftOwnerId: OTHER_ID, draftSubjectId: CALLER_ID });
    mocks.getSupabaseServiceClient.mockReturnValue(fake.client);

    const response = await GET(downloadRequest(), routeContext());

    expect(response.status).toBe(200);
  });

  it('[c] a stranger gets 403 and storage is never touched', async () => {
    const fake = createFake({ draftOwnerId: OTHER_ID, draftSubjectId: OTHER_ID });
    mocks.getSupabaseServiceClient.mockReturnValue(fake.client);

    const response = await GET(downloadRequest(), routeContext());

    expect(response.status).toBe(403);
    expect(fake.storageCalls).toEqual([]);
  });

  it('[d] a missing render object is a 404 and nothing is signed', async () => {
    const fake = createFake({
      draftOwnerId: CALLER_ID,
      draftSubjectId: OTHER_ID,
      objectExists: false,
    });
    mocks.getSupabaseServiceClient.mockReturnValue(fake.client);

    const response = await GET(downloadRequest(), routeContext());

    expect(response.status).toBe(404);
    expect(fake.storageCalls.some((call) => call.op === 'sign')).toBe(false);
  });

  it('[e] a malformed revisionId is a 400', async () => {
    const fake = createFake({ draftOwnerId: CALLER_ID, draftSubjectId: OTHER_ID });
    mocks.getSupabaseServiceClient.mockReturnValue(fake.client);

    const response = await GET(downloadRequest('not-a-uuid'), routeContext());

    expect(response.status).toBe(400);
    expect(fake.storageCalls).toEqual([]);
  });
});
