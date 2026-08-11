// T003 / 0058 — the two notification routes.
//
// /api/notifications/send is the worker: service-secret only, and — the part
// that matters for the retry budget — it refuses BEFORE claiming anything when
// the provider is unconfigured, so a misconfigured deploy cannot burn an
// attempt off every queued entry.
//
// /api/notifications/kick is the browser-facing relay: a signed-in active
// account may push, nobody else, and it never reveals queue state.
/* global beforeEach, describe, expect, it, vi */

const CALLER_ID = '11111111-1111-4111-8111-111111111111';
const SECRET = 'unit-notify-secret-0123456789';

const mocks = vi.hoisted(() => {
  const getUserResult: { data: { user: { id: string } | null }; error: unknown } = {
    data: { user: { id: '11111111-1111-4111-8111-111111111111' } },
    error: null,
  };
  return {
    getSupabaseServiceClient: vi.fn<() => unknown>(() => ({})),
    runNotificationPass: vi.fn(async () => ({
      claimed: 0,
      sent: 0,
      failed: 0,
      failureCodes: [] as string[],
    })),
    triggerNotificationSend: vi.fn(async () => undefined),
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

vi.mock('@/lib/supabaseServer', () => ({
  getSupabaseServiceClient: mocks.getSupabaseServiceClient,
}));

vi.mock('@/lib/notifications/sender', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, runNotificationPass: mocks.runNotificationPass };
});

vi.mock('@/lib/notifications/trigger', () => ({
  triggerNotificationSend: mocks.triggerNotificationSend,
}));

vi.mock('@friendword/data', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    createBrowserClient: () => ({
      auth: { getUser: async () => mocks.getUserResult },
    }),
  };
});

import { POST as kick } from '../app/api/notifications/kick/route';
import { POST as send } from '../app/api/notifications/send/route';
import {
  NOTIFICATION_BATCH_SIZE,
  NOTIFICATION_LEASE_SECONDS,
} from '@/lib/notifications/timeBudget';

function sendRequest(authorization?: string): Request {
  return new Request('https://deploy.example/api/notifications/send', {
    method: 'POST',
    headers: authorization === undefined ? {} : { authorization },
  });
}

function kickRequest(withAuth = true): Request {
  return new Request('https://deploy.example/api/notifications/kick', {
    method: 'POST',
    headers: withAuth ? { authorization: 'Bearer token' } : {},
  });
}

function fakeAccountClient(accountStatus: string): { client: unknown; queried: string[] } {
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

describe('notifications/send — secret and configuration gate', () => {
  beforeEach(() => {
    process.env.FRIENDWORD_NOTIFY_SECRET = SECRET;
    process.env.RESEND_API_KEY = 'test-provider-key';
    process.env.FRIENDWORD_NOTIFY_FROM = 'Friendword <notify@share.example>';
    process.env.FRIENDWORD_SHARE_ORIGIN = 'https://share.example';
    mocks.getSupabaseServiceClient.mockReturnValue({});
    mocks.runNotificationPass.mockClear();
    mocks.runNotificationPass.mockResolvedValue({
      claimed: 0,
      sent: 0,
      failed: 0,
      failureCodes: [],
    });
    mocks.triggerNotificationSend.mockClear();
    mocks.after.mockReset();
    mocks.after.mockImplementation((callback: () => unknown) => {
      callback();
    });
  });

  it('501 when the worker secret is unset; nothing is claimed', async () => {
    delete process.env.FRIENDWORD_NOTIFY_SECRET;
    const response = await send(sendRequest(`Bearer ${SECRET}`));
    expect(response.status).toBe(501);
    expect(mocks.runNotificationPass).not.toHaveBeenCalled();
  });

  it('401 without a bearer token, and on a wrong secret', async () => {
    expect((await send(sendRequest())).status).toBe(401);
    expect((await send(sendRequest('Bearer not-the-secret-but-long'))).status).toBe(401);
    expect(mocks.runNotificationPass).not.toHaveBeenCalled();
  });

  it('501 — and NO claim — when the mail provider is unconfigured', async () => {
    delete process.env.RESEND_API_KEY;
    const response = await send(sendRequest(`Bearer ${SECRET}`));
    expect(response.status).toBe(501);
    // The point of the ordering: claiming here would spend one attempt from
    // every queued entry's budget and deliver none of them.
    expect(mocks.runNotificationPass).not.toHaveBeenCalled();
  });

  it('501 when the From identity is unconfigured', async () => {
    delete process.env.FRIENDWORD_NOTIFY_FROM;
    expect((await send(sendRequest(`Bearer ${SECRET}`))).status).toBe(501);
    expect(mocks.runNotificationPass).not.toHaveBeenCalled();
  });

  it('runs one pass with the configured share origin and returns its summary', async () => {
    const response = await send(sendRequest(`Bearer ${SECRET}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      claimed: 0,
      sent: 0,
      failed: 0,
      failureCodes: [],
    });
    expect(mocks.runNotificationPass).toHaveBeenCalledTimes(1);
    const config = mocks.runNotificationPass.mock.calls[0]?.[1] as { shareOrigin: string };
    expect(config.shareOrigin).toBe('https://share.example');
  });

  it('progress re-kicks the chain; an idle pass ends it', async () => {
    await send(sendRequest(`Bearer ${SECRET}`));
    expect(mocks.triggerNotificationSend).not.toHaveBeenCalled();

    mocks.runNotificationPass.mockResolvedValue({
      claimed: 1,
      sent: 1,
      failed: 0,
      failureCodes: [],
    });
    await send(sendRequest(`Bearer ${SECRET}`));
    expect(mocks.triggerNotificationSend).toHaveBeenCalledWith('https://deploy.example');
  });

  it('a FULL BATCH OF FAILURES does not re-kick', async () => {
    // The condition used to be "the batch was full", which meant a provider
    // outage re-kicked itself: four failures, another pass, four more, until
    // every queued entry's 3-attempt budget was spent and the ops channel held
    // one alert per entry — all inside a few seconds, before an operator could
    // have done anything. Progress is what earns another pass.
    mocks.runNotificationPass.mockResolvedValue({
      claimed: 4,
      sent: 0,
      failed: 4,
      failureCodes: ['resend_http_429', 'resend_http_429', 'resend_http_429', 'resend_http_429'],
    });

    const response = await send(sendRequest(`Bearer ${SECRET}`));

    expect(response.status).toBe(200);
    expect(mocks.triggerNotificationSend).not.toHaveBeenCalled();
  });

  it('claims with the batch and lease the time budget derives', async () => {
    // The route is the only place these two travel together, and 0058's clamp
    // silently rewrites anything outside its range — so a pass that asked for
    // a lease it did not get would look fine here and race itself in prod.
    await send(sendRequest(`Bearer ${SECRET}`));
    const config = mocks.runNotificationPass.mock.calls[0]?.[1] as {
      batchSize: number;
      leaseSeconds: number;
    };
    expect(config.batchSize).toBe(NOTIFICATION_BATCH_SIZE);
    expect(config.leaseSeconds).toBe(NOTIFICATION_LEASE_SECONDS);
  });
});

describe('notifications/kick — auth gate and best-effort push', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.test';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
    mocks.getSupabaseServiceClient.mockReset();
    mocks.triggerNotificationSend.mockClear();
    mocks.getUserResult = { data: { user: { id: CALLER_ID } }, error: null };
    mocks.after.mockReset();
    mocks.after.mockImplementation((callback: () => unknown) => {
      callback();
    });
  });

  it('401 without a bearer token, before any account read', async () => {
    const fake = fakeAccountClient('active');
    mocks.getSupabaseServiceClient.mockReturnValue(fake.client);

    const response = await kick(kickRequest(false));

    expect(response.status).toBe(401);
    expect(fake.queried).not.toContain('users');
    expect(mocks.triggerNotificationSend).not.toHaveBeenCalled();
  });

  it('401 when the auth server rejects the token', async () => {
    mocks.getSupabaseServiceClient.mockReturnValue(fakeAccountClient('active').client);
    mocks.getUserResult = { data: { user: null }, error: { message: 'invalid JWT' } };

    expect((await kick(kickRequest())).status).toBe(401);
    expect(mocks.triggerNotificationSend).not.toHaveBeenCalled();
  });

  it('403 for an inactive account, and no push', async () => {
    mocks.getSupabaseServiceClient.mockReturnValue(fakeAccountClient('suspended').client);

    expect((await kick(kickRequest())).status).toBe(403);
    expect(mocks.triggerNotificationSend).not.toHaveBeenCalled();
  });

  it('202 with an empty body — no queue state leaks to the browser', async () => {
    mocks.getSupabaseServiceClient.mockReturnValue(fakeAccountClient('active').client);

    const response = await kick(kickRequest());

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({});
    expect(mocks.triggerNotificationSend).toHaveBeenCalledWith('https://deploy.example');
  });

  it('after() throwing outside a request scope still answers 202', async () => {
    mocks.getSupabaseServiceClient.mockReturnValue(fakeAccountClient('active').client);
    mocks.after.mockImplementation(() => {
      throw new Error('after was called outside a request scope');
    });

    expect((await kick(kickRequest())).status).toBe(202);
    expect(mocks.triggerNotificationSend).not.toHaveBeenCalled();
  });

  it('501 when the service side is not configured', async () => {
    mocks.getSupabaseServiceClient.mockReturnValue(null);
    expect((await kick(kickRequest())).status).toBe(501);
    expect(mocks.triggerNotificationSend).not.toHaveBeenCalled();
  });
});
