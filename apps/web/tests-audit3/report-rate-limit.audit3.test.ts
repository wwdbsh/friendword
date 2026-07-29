// E2E-RUN REGRESSION — N-J (public /api/report rate limit)
// (a) count-then-insert raced: concurrent requests each read a count under the
//     cap and all inserted, so the cap did not hold under the only condition it
//     exists for
// (b) a failing count was read as "zero reports so far" and opened the limiter
// Both are answered by moving the caps into a BEFORE INSERT trigger on
// public.reports (0045), which evaluates them inside the inserting transaction.
// What is left to test here is the route's half of that contract: it must not
// count, it must not serialize, and it must map the trigger's refusal to 429
// and every other insert failure to 500. The fake below models the PostgREST
// boundary: each round trip yields to the event loop, so concurrent handlers
// interleave the way two requests in one process do, and every call is recorded
// so a test can assert which queries the route did and did not make.
/* global afterEach, beforeEach, describe, expect, it, vi */

import { createHash } from 'node:crypto';

const REPORTER_IP = '203.0.113.7';
const CAMPAIGN_ID = '20000000-0000-0000-0000-000000000001';
const OWNER_ID = '00000000-0000-0000-0000-000000000002';

/** One per reason, so 0024's anon dedupe never masks what a prober would see. */
const REASONS = ['impersonation', 'safety_risk', 'minor', 'harassment', 'spam', 'other'] as const;

/** The exact string 0045's trigger raises. Changing it here changes the contract. */
const REPORTER_CAP_ERROR = {
  code: 'P0001',
  message: 'report rate limit exceeded for this reporter',
  details: null,
  hint: null,
};

type ReportRow = Record<string, unknown>;
type PostgrestError = { message: string; details?: unknown; hint?: unknown; code?: string };

type FakeConfig = {
  readonly campaign?: { id: string; owner_user_id: string; status: string } | null;
  readonly campaignError?: { message: string } | null;
  /** Returned by the nth insert (1-based); later inserts reuse the last entry. */
  readonly insertErrors?: readonly (PostgrestError | null)[];
};

type Fake = {
  readonly client: unknown;
  readonly inserted: ReportRow[];
  /** Every `from(table)` the route opened, in order. */
  readonly queried: string[];
  /** Highest number of round trips in flight at once: 1 means something serializes. */
  readonly peakConcurrency: () => number;
};

function createReportFake(config: FakeConfig = {}): Fake {
  const inserted: ReportRow[] = [];
  const queried: string[] = [];
  const insertErrors = config.insertErrors ?? [];
  let inFlight = 0;
  let peak = 0;

  async function roundTrip(): Promise<void> {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 1));
    inFlight -= 1;
  }

  function from(table: string): unknown {
    queried.push(table);
    let pendingInsert: ReportRow | null = null;

    const builder: Record<string, unknown> = {
      select() {
        return builder;
      },
      eq() {
        return builder;
      },
      gte() {
        return builder;
      },
      insert(row: ReportRow) {
        pendingInsert = row;
        return builder;
      },
      async maybeSingle() {
        await roundTrip();
        if (table !== 'campaigns') {
          return { data: null, error: null };
        }
        if (config.campaignError != null) {
          return { data: null, error: config.campaignError };
        }
        return { data: config.campaign ?? null, error: null };
      },
      then(onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) {
        const settled = (async () => {
          await roundTrip();
          const attempt = inserted.length;
          const error = insertErrors[Math.min(attempt, insertErrors.length - 1)] ?? null;
          if (error !== null) {
            return { data: null, error };
          }
          inserted.push(pendingInsert as ReportRow);
          return { data: null, error: null };
        })();
        return settled.then(onFulfilled, onRejected);
      },
    };
    return builder;
  }

  return { client: { from }, inserted, queried, peakConcurrency: () => peak };
}

const mocks = vi.hoisted(() => ({
  getSupabaseServiceClient: vi.fn<() => unknown>(),
}));

vi.mock('@/lib/supabaseServer', () => ({
  getSupabaseServiceClient: mocks.getSupabaseServiceClient,
}));

import { POST } from '../app/api/report/route';

const PUBLISHED_CAMPAIGN = { id: CAMPAIGN_ID, owner_user_id: OWNER_ID, status: 'published' };

function reportRequest(
  body: unknown = { campaignSlug: 'demo-blair', reason: 'impersonation' },
  ip: string = REPORTER_IP,
): Request {
  return new Request('http://localhost/api/report', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  });
}

/** The route salts the hash with the service key, so derive it the same way. */
function hashFor(ip: string): string {
  const salt = process.env.SUPABASE_SERVICE_ROLE_KEY ?? 'friendword-report';
  return createHash('sha256').update(`${salt}:${ip}`).digest('hex');
}

describe('POST /api/report — anonymous report rate limit', () => {
  beforeEach(() => {
    mocks.getSupabaseServiceClient.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('accepts a report from a real reporter and writes the anonymous row', async () => {
    const fake = createReportFake({ campaign: PUBLISHED_CAMPAIGN });
    mocks.getSupabaseServiceClient.mockReturnValue(fake.client);

    const response = await POST(
      reportRequest({ campaignSlug: 'demo-blair', reason: 'safety_risk', detail: 'not them' }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ received: true });
    expect(fake.inserted).toHaveLength(1);
    expect(fake.inserted[0]).toMatchObject({
      reporter_user_id: null,
      reported_user_id: OWNER_ID,
      campaign_id: CAMPAIGN_ID,
      target_type: 'campaign',
      target_id: CAMPAIGN_ID,
      reason: 'safety_risk',
      detail: 'not them',
      anon_report: true,
      reporter_ip_hash: hashFor(REPORTER_IP),
    });
  });

  it('answers 429 when the trigger refuses the reporter over the hourly cap', async () => {
    const fake = createReportFake({
      campaign: PUBLISHED_CAMPAIGN,
      insertErrors: [REPORTER_CAP_ERROR],
    });
    mocks.getSupabaseServiceClient.mockReturnValue(fake.client);

    const response = await POST(reportRequest());

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({ error: 'too many reports' });
    expect(fake.inserted).toHaveLength(0);
  });

  it('answers the same for a heavily reported campaign as for one never reported', async () => {
    // The endpoint must be no oracle for the target's state. 0045 caps the
    // reporter only, so the answers a prober sees are a function of their own
    // budget alone — identical across targets at every point in it. A cap keyed
    // on the campaign would diverge here on its first request, which is exactly
    // how the reverted per-campaign cap leaked "has this page been reported?".
    const budget = [null, null, null, null, null, REPORTER_CAP_ERROR];

    async function statusesAgainst(campaignId: string): Promise<number[]> {
      const fake = createReportFake({
        campaign: { ...PUBLISHED_CAMPAIGN, id: campaignId },
        insertErrors: budget,
      });
      mocks.getSupabaseServiceClient.mockReturnValue(fake.client);
      const statuses: number[] = [];
      for (const reason of REASONS) {
        statuses.push((await POST(reportRequest({ campaignSlug: 'demo-blair', reason }))).status);
      }
      return statuses;
    }

    const quiet = await statusesAgainst(CAMPAIGN_ID);
    const flooded = await statusesAgainst('20000000-0000-0000-0000-0000000000ff');

    expect(quiet).toEqual([200, 200, 200, 200, 200, 429]);
    expect(flooded).toEqual(quiet);
  });

  it('reads the trigger message out of a PostgREST error that carries it in details', async () => {
    const fake = createReportFake({
      campaign: PUBLISHED_CAMPAIGN,
      insertErrors: [
        {
          code: 'P0001',
          message: 'new row violates check',
          details: 'report rate limit exceeded for this reporter',
        },
      ],
    });
    mocks.getSupabaseServiceClient.mockReturnValue(fake.client);

    expect((await POST(reportRequest())).status).toBe(429);
  });

  it('reports an insert failure that is not the cap honestly instead of as a cap', async () => {
    const fake = createReportFake({
      campaign: PUBLISHED_CAMPAIGN,
      insertErrors: [{ code: '42501', message: 'permission denied for table reports' }],
    });
    mocks.getSupabaseServiceClient.mockReturnValue(fake.client);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const response = await POST(reportRequest());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'report failed' });
  });

  it('leaves the caps to the database instead of counting rows itself', async () => {
    const fake = createReportFake({ campaign: PUBLISHED_CAMPAIGN });
    mocks.getSupabaseServiceClient.mockReturnValue(fake.client);

    await POST(reportRequest());

    // Only the campaign lookup and the insert. A count here could not hold —
    // it commits in a different transaction than the insert it guards — and a
    // count that disagreed with 0045 would silently refuse valid reports.
    expect(fake.queried).toEqual(['campaigns', 'reports']);
  });

  it('does not serialize concurrent reports or shed them under a burst', async () => {
    const fake = createReportFake({ campaign: PUBLISHED_CAMPAIGN });
    mocks.getSupabaseServiceClient.mockReturnValue(fake.client);

    const statuses = await Promise.all(
      Array.from({ length: 80 }, (_unused, index) =>
        POST(reportRequest(undefined, `203.0.113.${index % 250}`)).then(
          (response) => response.status,
        ),
      ),
    );

    // A process-wide queue in front of the write turned this endpoint into a
    // throughput ceiling and refused real reports with 503 past its bound.
    expect(statuses.filter((status) => status === 503)).toHaveLength(0);
    expect(statuses.every((status) => status === 200)).toBe(true);
    expect(fake.inserted).toHaveLength(80);
    expect(fake.peakConcurrency()).toBeGreaterThan(1);
  });

  it('refuses when the campaign lookup itself fails', async () => {
    const fake = createReportFake({ campaignError: { message: 'connection reset' } });
    mocks.getSupabaseServiceClient.mockReturnValue(fake.client);

    const response = await POST(reportRequest());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: 'report unavailable' });
    expect(fake.inserted).toHaveLength(0);
  });

  it('answers alike for an unknown campaign and an unpublished one', async () => {
    const missing = createReportFake({ campaign: null });
    mocks.getSupabaseServiceClient.mockReturnValue(missing.client);
    const missingResponse = await POST(reportRequest());

    const draft = createReportFake({ campaign: { ...PUBLISHED_CAMPAIGN, status: 'draft' } });
    mocks.getSupabaseServiceClient.mockReturnValue(draft.client);
    const draftResponse = await POST(reportRequest());

    expect(missingResponse.status).toBe(404);
    expect(draftResponse.status).toBe(404);
    await expect(missingResponse.json()).resolves.toEqual({ error: 'campaign not found' });
    await expect(draftResponse.json()).resolves.toEqual({ error: 'campaign not found' });
    expect(missing.inserted).toHaveLength(0);
    expect(draft.inserted).toHaveLength(0);
  });

  it('rejects malformed bodies before touching the database', async () => {
    const fake = createReportFake({ campaign: PUBLISHED_CAMPAIGN });
    mocks.getSupabaseServiceClient.mockReturnValue(fake.client);

    const response = await POST(reportRequest({ campaignSlug: 'Bad Slug', reason: 'spam' }));

    expect(response.status).toBe(400);
    expect(fake.queried).toEqual([]);
  });

  it('answers 501 when the service client is not configured', async () => {
    mocks.getSupabaseServiceClient.mockReturnValue(null);

    const response = await POST(reportRequest());

    expect(response.status).toBe(501);
  });
});
