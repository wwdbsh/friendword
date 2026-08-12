// MP4 RENDER DOWNLOAD — /kit/[draftId]/render-download (E5, repaired by Issue
// #52 GAP-9).
//
// The render output lives under pitch-media/<draft>/renders/, a nested prefix
// the member storage SELECT policy cannot see (0003 parses flat paths only —
// 0054 relies on that to keep renders out of the object quota), so this route
// is the ONLY member path to the MP4 and must re-enforce the participant
// relationship itself:
//   (a) the introducer (created_by)          → the bytes, from this origin
//   (b) the dater (subject)                  → the bytes
//   (c) a stranger                           → 403, storage never touched
//   (d) missing object                       → 404, nothing signed
//   (e) malformed revisionId                 → 400 before auth-independent work
//
// It also owns the DELIVERY contract, which is the part GAP-9 was about. The
// route used to answer with a signed Supabase URL and let the page click an
// anchor at it; a cross-origin anchor cannot force a save or name a file, so
// the outcome depended on a header from another origin and, where video/mp4
// renders inline, the click navigated the kit page away into a player instead
// of downloading anything. Now the bytes come from here:
//   (f) attachment disposition with OUR filename
//   (g) content-length passed through, so the caller can reject a short file
//   (h) an unreadable upstream is a 502, never a redirect to storage
/* global beforeEach, describe, expect, it, vi */

const CALLER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ID = '22222222-2222-4222-8222-222222222222';
const DRAFT_ID = '33333333-3333-4333-8333-333333333333';
const REVISION_ID = '44444444-4444-4444-8444-444444444444';

const RENDER_BODY = 'ftypisom-render-bytes';

type FakeConfig = {
  readonly draftOwnerId?: string | null;
  readonly draftSubjectId?: string | null;
  readonly draftExists?: boolean;
  readonly objectExists?: boolean;
  readonly listedSize?: number | null;
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
            const size = config.listedSize === undefined ? RENDER_BODY.length : config.listedSize;
            return Promise.resolve({
              data: [
                {
                  name: `${REVISION_ID}.mp4`,
                  id: 'obj-1',
                  metadata: size === null ? {} : { size },
                },
              ],
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
import { RENDER_DOWNLOAD_FILENAME } from '../src/lib/renderDownload';

function downloadRequest(revisionId: string = REVISION_ID): Request {
  return new Request(`http://localhost/kit/${DRAFT_ID}/render-download?revisionId=${revisionId}`, {
    headers: { authorization: 'Bearer token' },
  });
}

function routeContext(): { params: Promise<{ draftId: string }> } {
  return { params: Promise.resolve({ draftId: DRAFT_ID }) };
}

/** Stands in for the storage host the route pipes from. */
function stubUpstream(
  init: { readonly ok?: boolean; readonly contentLength?: string | null } = {},
): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(() => {
    if (init.ok === false) {
      return Promise.resolve(new Response('nope', { status: 403 }));
    }
    const headers: Record<string, string> = {};
    if (init.contentLength !== null && init.contentLength !== undefined) {
      headers['content-length'] = init.contentLength;
    }
    return Promise.resolve(new Response(RENDER_BODY, { status: 200, headers }));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('kit render-download — participant-only bytes from our own origin', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.test';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
    mocks.getSupabaseServiceClient.mockReset();
    vi.unstubAllGlobals();
  });

  it('[a] the introducer gets the bytes, signed for the exact render path', async () => {
    const fake = createFake({ draftOwnerId: CALLER_ID, draftSubjectId: OTHER_ID });
    mocks.getSupabaseServiceClient.mockReturnValue(fake.client);
    const upstream = stubUpstream();

    const response = await GET(downloadRequest(), routeContext());

    expect(response.status).toBe(200);
    expect(fake.storageCalls).toContainEqual({
      op: 'sign',
      path: `${DRAFT_ID}/renders/${REVISION_ID}.mp4`,
    });
    expect(upstream).toHaveBeenCalledWith(
      `https://signed.example/${DRAFT_ID}/renders/${REVISION_ID}.mp4`,
    );
    await expect(response.text()).resolves.toBe(RENDER_BODY);
  });

  it('[a2] the signed URL never reaches the caller — the response is the file', async () => {
    // The regression this pins: answering with the storage URL put the
    // download's success on a cross-origin header and let a click navigate the
    // kit page away. Nothing in the response may name the storage host.
    const fake = createFake({ draftOwnerId: CALLER_ID, draftSubjectId: OTHER_ID });
    mocks.getSupabaseServiceClient.mockReturnValue(fake.client);
    stubUpstream();

    const response = await GET(downloadRequest(), routeContext());

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('video/mp4');
    expect(response.headers.get('location')).toBeNull();
    expect(await response.text()).not.toContain('signed.example');
  });

  it('[b] the dater (subject) gets the bytes too', async () => {
    const fake = createFake({ draftOwnerId: OTHER_ID, draftSubjectId: CALLER_ID });
    mocks.getSupabaseServiceClient.mockReturnValue(fake.client);
    stubUpstream();

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

  it('[f] serves an attachment under our own filename', async () => {
    const fake = createFake({ draftOwnerId: CALLER_ID, draftSubjectId: OTHER_ID });
    mocks.getSupabaseServiceClient.mockReturnValue(fake.client);
    stubUpstream();

    const response = await GET(downloadRequest(), routeContext());

    expect(response.headers.get('content-disposition')).toBe(
      `attachment; filename="${RENDER_DOWNLOAD_FILENAME}"`,
    );
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });

  it('[g] advertises the listed object size so a short read is detectable', async () => {
    const fake = createFake({ draftOwnerId: CALLER_ID, draftSubjectId: OTHER_ID });
    mocks.getSupabaseServiceClient.mockReturnValue(fake.client);
    stubUpstream({ contentLength: null });

    const response = await GET(downloadRequest(), routeContext());

    expect(response.headers.get('content-length')).toBe(String(RENDER_BODY.length));
  });

  it('[g2] omits content-length rather than guessing when neither side knows it', async () => {
    // A WRONG length is worse than none: the caller's integrity check would
    // reject a perfectly good file.
    const fake = createFake({
      draftOwnerId: CALLER_ID,
      draftSubjectId: OTHER_ID,
      listedSize: null,
    });
    mocks.getSupabaseServiceClient.mockReturnValue(fake.client);
    stubUpstream({ contentLength: null });

    const response = await GET(downloadRequest(), routeContext());

    expect(response.status).toBe(200);
    expect(response.headers.get('content-length')).toBeNull();
  });

  it('[h] an unreadable upstream is a 502 here, not a redirect into storage', async () => {
    const fake = createFake({ draftOwnerId: CALLER_ID, draftSubjectId: OTHER_ID });
    mocks.getSupabaseServiceClient.mockReturnValue(fake.client);
    stubUpstream({ ok: false });

    const response = await GET(downloadRequest(), routeContext());

    expect(response.status).toBe(502);
    expect(response.headers.get('location')).toBeNull();
    // The provider's body can quote the signed URL; it must not be echoed.
    await expect(response.json()).resolves.toEqual({ error: 'render unavailable' });
  });
});
