// AUDIT2 REGRESSION: P0-3, RevenueCat event-specific webhook contract.
/* global afterEach, beforeEach, describe, expect, it, vi */

import { createAudit2SupabaseFake } from './supabaseAudit2Fake';

const mocks = vi.hoisted(() => ({
  getSupabaseServiceClient: vi.fn<() => unknown>(),
}));

vi.mock('@/lib/supabaseServer', () => ({
  getSupabaseServiceClient: mocks.getSupabaseServiceClient,
}));

import { POST } from '../app/api/revenuecat/route';

const AUTH_TOKEN = 'audit2-webhook-token';
const USER_ID = '11111111-1111-4111-8111-111111111111';
const CREATOR_PRODUCT = 'creator_launch_credit_499';
const PURCHASE_INTENT_ID = '22222222-2222-4222-8222-222222222222';

function requestFor(event: unknown): Request {
  return new Request('http://localhost/api/revenuecat', {
    method: 'POST',
    headers: { authorization: AUTH_TOKEN, 'content-type': 'application/json' },
    body: JSON.stringify({ event }),
  });
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

describe('RevenueCat realistic audit2 contract', () => {
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

  it('[P0-3.1] accepts a realistic TRANSFER without purchase-only fields', async () => {
    const fake = createAudit2SupabaseFake({
      rpcData: { recorded: true, needs_review: true },
    });
    mocks.getSupabaseServiceClient.mockReturnValue(fake.client);

    const response = await POST(
      requestFor({
        id: 'rc-transfer-1',
        type: 'TRANSFER',
        environment: 'SANDBOX',
        store: 'APP_STORE',
        transferred_from: ['legacy-revenuecat-user'],
        transferred_to: [USER_ID],
      }),
    );

    expect(response.status).toBeGreaterThanOrEqual(200);
    expect(response.status).toBeLessThan(300);
  });

  it('[P0-3.2] accepts a REFUND without subscriber attributes or invented intent', async () => {
    const fake = createAudit2SupabaseFake();
    mocks.getSupabaseServiceClient.mockReturnValue(fake.client);

    const response = await POST(
      requestFor({
        id: 'rc-refund-1',
        type: 'REFUND',
        environment: 'SANDBOX',
        store: 'APP_STORE',
        app_user_id: USER_ID,
        product_id: CREATOR_PRODUCT,
        transaction_id: 'transaction-1',
        original_transaction_id: 'original-transaction-1',
      }),
    );

    expect(response.status).not.toBe(400);
    expect(fake.calls).toContainEqual({
      functionName: 'record_revenuecat_event',
      params: {
        payload: expect.objectContaining({
          id: 'rc-refund-1',
          type: 'REFUND',
          original_transaction_id: 'original-transaction-1',
          subscriber_attributes: {},
        }),
      },
    });
    expect(JSON.stringify(fake.calls)).not.toContain('purchase_intent_id');
  });

  it('[P0-3.3] rejects payloads without an id or type', async () => {
    const fake = createAudit2SupabaseFake();
    mocks.getSupabaseServiceClient.mockReturnValue(fake.client);

    const missingIdResponse = await POST(
      requestFor({
        type: 'TRANSFER',
        environment: 'SANDBOX',
        store: 'APP_STORE',
        transferred_from: ['legacy-user'],
        transferred_to: [USER_ID],
      }),
    );
    const missingTypeResponse = await POST(
      requestFor({
        id: 'rc-malformed-2',
        environment: 'SANDBOX',
        store: 'APP_STORE',
        transferred_from: ['legacy-user'],
        transferred_to: [USER_ID],
      }),
    );

    expect(missingIdResponse.status).toBe(400);
    expect(missingTypeResponse.status).toBe(400);
    expect(fake.calls).toHaveLength(0);
  });

  it('[P0-3.4] does not terminally discard an intent-attribution mismatch', async () => {
    const fake = createAudit2SupabaseFake({
      rpcError: { code: 'P0001', message: 'purchase intent mismatch' },
    });
    mocks.getSupabaseServiceClient.mockReturnValue(fake.client);

    const response = await POST(
      requestFor({
        id: 'rc-intent-mismatch-1',
        type: 'NON_RENEWING_PURCHASE',
        environment: 'SANDBOX',
        store: 'APP_STORE',
        app_user_id: USER_ID,
        product_id: CREATOR_PRODUCT,
        transaction_id: 'transaction-mismatch',
        original_transaction_id: 'original-mismatch',
        subscriber_attributes: {
          purchase_intent_id: { value: PURCHASE_INTENT_ID },
        },
      }),
    );
    const body: unknown = await response.json();
    const terminalWithoutReview =
      response.status === 200 &&
      isRecord(body) &&
      body['recorded'] === false &&
      body['needs_review'] !== true;

    expect(terminalWithoutReview).toBe(false);
  });

  it('[P0-3.5] preserves the normal NON_RENEWING_PURCHASE path', async () => {
    const fake = createAudit2SupabaseFake({
      rpcData: { recorded: true, deduplicated: false, needs_review: false },
    });
    mocks.getSupabaseServiceClient.mockReturnValue(fake.client);

    const response = await POST(
      requestFor({
        id: 'rc-purchase-1',
        type: 'NON_RENEWING_PURCHASE',
        environment: 'SANDBOX',
        store: 'APP_STORE',
        app_user_id: USER_ID,
        product_id: CREATOR_PRODUCT,
        purchased_at_ms: 1_752_384_000_000,
        transaction_id: 'transaction-purchase-1',
        original_transaction_id: 'original-purchase-1',
        subscriber_attributes: {
          purchase_intent_id: { value: PURCHASE_INTENT_ID },
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(fake.calls).toEqual([
      {
        functionName: 'record_revenuecat_event',
        params: {
          payload: expect.objectContaining({
            id: 'rc-purchase-1',
            type: 'NON_RENEWING_PURCHASE',
            app_user_id: USER_ID,
            product_id: CREATOR_PRODUCT,
            transaction_id: 'transaction-purchase-1',
            original_transaction_id: 'original-purchase-1',
            subscriber_attributes: {
              purchase_intent_id: { value: PURCHASE_INTENT_ID },
            },
          }),
        },
      },
    ]);
  });
});
