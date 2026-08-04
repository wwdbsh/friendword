// /api/media/render-kick — the browser-facing bridge to the render worker.
// Browsers never hold FRIENDWORD_MEDIA_RENDER_SECRET, and the render status
// poll goes browser → PostgREST directly (no server route to piggyback the
// push on, unlike clip-ingest-state), so this route is where a signed-in
// member's poll turns into a worker push. Pinned here:
//   (a) no bearer token → 401 before any auth or account read
//   (b) a token the auth server rejects → 401
//   (c) an inactive account → 403 and NO push (clip-ingest-state discipline)
//   (d) success → 202 with an EMPTY body (no job data, no config state) and
//       the trigger scheduled via after() with the request's origin
//   (e) after() throwing outside a request scope must not break the response
//       — the push is best-effort by design.
/* global beforeEach, describe, expect, it, vi */

const CALLER_ID = '11111111-1111-4111-8111-111111111111';

const mocks = vi.hoisted(() => {
  const getUserResult: { data: { user: { id: string } | null }; error: unknown } = {
    data: { user: { id: '11111111-1111-4111-8111-111111111111' } },
    error: null,
  };
  return {
    getSupabaseServiceClient: vi.fn<() => unknown>(),
    triggerRenderRun: vi.fn(async () => undefined),
    getUserResult,
    after: vi.fn((callback: () => unknown) => {
      callback();
    }),
  };
});

vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, after: (callback: () => unknown) => mocks.after(callback) };
});

vi.mock('@/lib/pitchRender/trigger', () => ({
  triggerRenderRun: mocks.triggerRenderRun,
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
        getUser: async () => mocks.getUserResult,
      },
    }),
  };
});

import { POST } from '../app/api/media/render-kick/route';

function fakeServiceClient(accountStatus: string): { client: unknown; queried: string[] } {
  const queried: string[] = [];
  const client = {
    from: (table: string) => {
      queried.push(table);
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: () =>
          Promise.resolve(
            table === 'users'
              ? { data: { account_status: accountStatus }, error: null }
              : { data: null, error: null },
          ),
      };
      return builder;
    },
  };
  return { client, queried };
}

function kickRequest(withAuth = true): Request {
  return new Request('http://localhost/api/media/render-kick', {
    method: 'POST',
    headers: withAuth ? { authorization: 'Bearer token' } : {},
  });
}

describe('media/render-kick — auth gate and best-effort push', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.test';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
    mocks.getSupabaseServiceClient.mockReset();
    mocks.triggerRenderRun.mockClear();
    mocks.getUserResult = { data: { user: { id: CALLER_ID } }, error: null };
    mocks.after.mockReset();
    mocks.after.mockImplementation((callback: () => unknown) => {
      callback();
    });
  });

  it('[a] 401 without a bearer token, before any account read', async () => {
    const fake = fakeServiceClient('active');
    mocks.getSupabaseServiceClient.mockReturnValue(fake.client);

    const response = await POST(kickRequest(false));

    expect(response.status).toBe(401);
    expect(fake.queried).not.toContain('users');
    expect(mocks.triggerRenderRun).not.toHaveBeenCalled();
  });

  it('[b] 401 when the auth server rejects the token', async () => {
    const fake = fakeServiceClient('active');
    mocks.getSupabaseServiceClient.mockReturnValue(fake.client);
    mocks.getUserResult = { data: { user: null }, error: { message: 'invalid JWT' } };

    const response = await POST(kickRequest());

    expect(response.status).toBe(401);
    expect(mocks.triggerRenderRun).not.toHaveBeenCalled();
  });

  it('[c] 403 for an inactive account, and no push', async () => {
    const fake = fakeServiceClient('suspended');
    mocks.getSupabaseServiceClient.mockReturnValue(fake.client);

    const response = await POST(kickRequest());

    expect(response.status).toBe(403);
    expect(mocks.triggerRenderRun).not.toHaveBeenCalled();
  });

  it('[d] 202 with an empty body, and the push scheduled with the request origin', async () => {
    const fake = fakeServiceClient('active');
    mocks.getSupabaseServiceClient.mockReturnValue(fake.client);

    const response = await POST(kickRequest());

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({});
    expect(mocks.after).toHaveBeenCalledTimes(1);
    expect(mocks.triggerRenderRun).toHaveBeenCalledTimes(1);
    expect(mocks.triggerRenderRun).toHaveBeenCalledWith('http://localhost');
  });

  it('[e] after() throwing outside a request scope still answers 202', async () => {
    const fake = fakeServiceClient('active');
    mocks.getSupabaseServiceClient.mockReturnValue(fake.client);
    mocks.after.mockImplementation(() => {
      throw new Error('after was called outside a request scope');
    });

    const response = await POST(kickRequest());

    expect(response.status).toBe(202);
    expect(mocks.triggerRenderRun).not.toHaveBeenCalled();
  });

  it('501 when the service side is not configured', async () => {
    mocks.getSupabaseServiceClient.mockReturnValue(null);

    const response = await POST(kickRequest());

    expect(response.status).toBe(501);
    expect(mocks.triggerRenderRun).not.toHaveBeenCalled();
  });
});
