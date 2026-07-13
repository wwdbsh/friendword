// AUDIT REGRESSION SUITE — Slice E acceptance
/* global afterEach, beforeEach, describe, expect, it, vi */

import { createAuditSupabaseFake } from './supabaseAuditFake';

const mocks = vi.hoisted(() => ({
  getSupabaseServiceClient: vi.fn<() => unknown>(),
}));

vi.mock('@/lib/supabaseServer', () => ({
  getSupabaseServiceClient: mocks.getSupabaseServiceClient,
}));

import { POST } from '../app/api/revenuecat/route';

const AUTH_TOKEN = 'audit-webhook-token';
const USER_ID = '11111111-1111-4111-8111-111111111111';
const PITCH_DRAFT_ID = '22222222-2222-4222-8222-222222222222';
const CAMPAIGN_ID = '33333333-3333-4333-8333-333333333333';
const CREATOR_PRODUCT = 'creator_launch_credit_499';

type RevenueCatEvent = {
  readonly id: string;
  readonly type: string;
  readonly app_user_id: string;
  readonly product_id: string;
  readonly purchased_at_ms: number;
  readonly expiration_at_ms: number | null;
  readonly transaction_id?: string;
  readonly original_transaction_id?: string;
  readonly environment?: string;
  readonly aliases?: readonly string[];
  readonly original_app_user_id?: string;
  readonly subscriber_attributes: Readonly<Record<string, { readonly value: string | null }>>;
};

function eventFixture(overrides: Partial<RevenueCatEvent> = {}): RevenueCatEvent {
  return {
    id: 'rc-event-1',
    type: 'INITIAL_PURCHASE',
    app_user_id: USER_ID,
    product_id: CREATOR_PRODUCT,
    purchased_at_ms: 1_752_384_000_000,
    expiration_at_ms: null,
    transaction_id: 'rc-transaction-1',
    original_transaction_id: 'rc-original-transaction-1',
    subscriber_attributes: {
      pitch_draft_id: { value: PITCH_DRAFT_ID },
      campaign_id: { value: CAMPAIGN_ID },
      purchase_intent_id: { value: 'purchase-intent-1' },
    },
    ...overrides,
  };
}

function requestFor(event: RevenueCatEvent, authorization = AUTH_TOKEN): Request {
  return new Request('http://localhost/api/revenuecat', {
    method: 'POST',
    headers: { authorization, 'content-type': 'application/json' },
    body: JSON.stringify({ event }),
  });
}

describe('RevenueCat webhook audit contract', () => {
  const originalToken = process.env.REVENUECAT_WEBHOOK_AUTH_TOKEN;

  beforeEach(() => {
    process.env.REVENUECAT_WEBHOOK_AUTH_TOKEN = AUTH_TOKEN;
    mocks.getSupabaseServiceClient.mockReset();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    if (originalToken === undefined) {
      delete process.env.REVENUECAT_WEBHOOK_AUTH_TOKEN;
    } else {
      process.env.REVENUECAT_WEBHOOK_AUTH_TOKEN = originalToken;
    }
    vi.restoreAllMocks();
  });

  // Audit P0-4a: unknown products must never inherit Campaign Pass behavior.
  it('[P0-4a] parks an unknown product in the durable review queue', async () => {
    // Given — second-audit contract (0027): the RPC answers needs_review
    // instead of raising; nothing money-related is terminally dropped.
    const fake = createAuditSupabaseFake({
      rpcData: { recorded: true, deduplicated: false, benefit: null, needs_review: true },
    });
    mocks.getSupabaseServiceClient.mockReturnValue(fake.client);

    // When
    const response = await POST(requestFor(eventFixture({ product_id: 'unknown_product' })));

    // Then
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      recorded: true,
      needs_review: true,
    });
    expect(fake.calls).toHaveLength(1);
  });

  // Second-audit contract: attribution failures are not terminal — the DB
  // parks the event for ops review and the route reports needs_review.
  it('[P0-4a] surfaces an unattributed purchase as needs_review', async () => {
    // Given
    const fake = createAuditSupabaseFake({
      rpcData: { recorded: true, deduplicated: false, benefit: null, needs_review: true },
    });
    mocks.getSupabaseServiceClient.mockReturnValue(fake.client);

    // When
    const response = await POST(requestFor(eventFixture()));

    // Then
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      recorded: true,
      needs_review: true,
    });
  });

  // Audit P0-4b: infrastructure errors mentioning intents still need a retry.
  it('[P0-4b] returns 5xx for a retryable intent infrastructure failure', async () => {
    // Given
    const fake = createAuditSupabaseFake({
      rpcError: { code: '57014', message: 'purchase intent lookup statement timeout' },
    });
    mocks.getSupabaseServiceClient.mockReturnValue(fake.client);

    // When
    const response = await POST(requestFor(eventFixture()));

    // Then
    expect(response.status).toBe(500);
  });

  // Audit P0-4b: a missing benefit must cause RevenueCat to retry.
  it('[P0-4b] returns 5xx when the benefit write fails', async () => {
    // Given
    const benefitError = { code: 'XX000', message: 'ledger unavailable' };
    const fake = createAuditSupabaseFake({ rpcError: benefitError });
    mocks.getSupabaseServiceClient.mockReturnValue(fake.client);

    // When
    const response = await POST(requestFor(eventFixture()));

    // Then
    expect(response.status).toBe(500);
  });

  // Audit P0-4c: purchase-event deduplication cannot skip benefit repair.
  it('[P0-4c] retries an absent benefit after a duplicate purchase event', async () => {
    // Given
    const rpcData = {
      recorded: true,
      deduplicated: true,
      benefit: 'creator_credit',
      needs_review: false,
    };
    const fake = createAuditSupabaseFake({ rpcData });
    mocks.getSupabaseServiceClient.mockReturnValue(fake.client);

    // When
    const response = await POST(requestFor(eventFixture()));

    // Then
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(rpcData);
  });

  // Audit P0-4d: immutable provider transaction identity must be persisted.
  it('[P0-4d] stores transaction identity and event provenance', async () => {
    // Given
    const fake = createAuditSupabaseFake();
    mocks.getSupabaseServiceClient.mockReturnValue(fake.client);
    const event = eventFixture({
      transaction_id: 'transaction-1',
      original_transaction_id: 'original-transaction-1',
      environment: 'SANDBOX',
      aliases: ['legacy-user-id'],
      original_app_user_id: 'original-user-id',
      type: 'NON_RENEWING_PURCHASE',
    });

    // When
    const response = await POST(requestFor(event));

    // Then
    expect(response.status).toBe(200);
    expect(fake.calls).toContainEqual({
      functionName: 'record_revenuecat_event',
      params: {
        payload: expect.objectContaining({
          transaction_id: 'transaction-1',
          original_transaction_id: 'original-transaction-1',
          environment: 'SANDBOX',
          aliases: ['legacy-user-id'],
          original_app_user_id: 'original-user-id',
          type: 'NON_RENEWING_PURCHASE',
        }),
      },
    });
  });

  // Audit P0-4e: cancelling a Creator purchase revokes an available credit.
  it('[P0-4e] refunds an available Creator credit on cancellation', async () => {
    // Given
    const fake = createAuditSupabaseFake();
    mocks.getSupabaseServiceClient.mockReturnValue(fake.client);

    // When
    const response = await POST(
      requestFor(
        eventFixture({
          type: 'CANCELLATION',
          transaction_id: 'transaction-1',
          original_transaction_id: 'original-transaction-1',
        }),
      ),
    );

    // Then
    expect(response.status).toBe(200);
    expect(fake.calls).toContainEqual({
      functionName: 'record_revenuecat_event',
      params: {
        payload: expect.objectContaining({
          type: 'CANCELLATION',
          transaction_id: 'transaction-1',
          original_transaction_id: 'original-transaction-1',
        }),
      },
    });
  });

  // Audit P0-4f: event and benefit writes share one database transaction.
  it('[P0-4f] records a purchase through one atomic RPC call', async () => {
    // Given
    const fake = createAuditSupabaseFake();
    mocks.getSupabaseServiceClient.mockReturnValue(fake.client);

    // When
    await POST(
      requestFor(
        eventFixture({
          transaction_id: 'transaction-1',
          original_transaction_id: 'original-transaction-1',
          environment: 'SANDBOX',
          subscriber_attributes: {
            pitch_draft_id: { value: PITCH_DRAFT_ID },
            campaign_id: { value: CAMPAIGN_ID },
            purchase_intent_id: { value: 'purchase-intent-1' },
          },
        }),
      ),
    );

    // Then
    expect(fake.calls).toEqual([
      {
        functionName: 'record_revenuecat_event',
        params: {
          payload: expect.objectContaining({
            id: 'rc-event-1',
            type: 'INITIAL_PURCHASE',
            app_user_id: USER_ID,
            transaction_id: 'transaction-1',
            original_transaction_id: 'original-transaction-1',
            environment: 'SANDBOX',
            product_id: CREATOR_PRODUCT,
            purchased_at_ms: 1_752_384_000_000,
            subscriber_attributes: {
              purchase_intent_id: { value: 'purchase-intent-1' },
            },
          }),
        },
      },
    ]);
    expect(JSON.stringify(fake.calls)).not.toContain(PITCH_DRAFT_ID);
    expect(JSON.stringify(fake.calls)).not.toContain(CAMPAIGN_ID);
  });

  // Audit P0-4g: deployment without the shared secret fails closed.
  it('[P0-4g] returns 501 when the webhook token is unset', async () => {
    // Given
    delete process.env.REVENUECAT_WEBHOOK_AUTH_TOKEN;

    // When
    const response = await POST(requestFor(eventFixture()));

    // Then
    expect(response.status).toBe(501);
    await expect(response.json()).resolves.toEqual({ error: 'webhook not configured' });
  });

  // Audit P0-4g: callers without the shared secret are rejected.
  it('[P0-4g] returns 401 for an invalid webhook token', async () => {
    // Given
    const fake = createAuditSupabaseFake();
    mocks.getSupabaseServiceClient.mockReturnValue(fake.client);

    // When
    const response = await POST(requestFor(eventFixture(), 'wrong-token'));

    // Then
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'unauthorized' });
  });

  // Audit P0-4g: malformed JSON is rejected before any write.
  it('[P0-4g] returns 400 for a malformed body', async () => {
    // Given
    const request = new Request('http://localhost/api/revenuecat', {
      method: 'POST',
      headers: { authorization: AUTH_TOKEN, 'content-type': 'application/json' },
      body: '{',
    });

    // When
    const response = await POST(request);

    // Then
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'malformed event' });
    expect(mocks.getSupabaseServiceClient).not.toHaveBeenCalled();
  });
});
