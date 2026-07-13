import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: {} } } }));
vi.mock('@friendword/data/src/purchasesRepo', () => ({
  PurchasesRepo: class {},
}));
vi.mock('./supabaseClient', () => ({ getSupabaseClient: () => null }));

import {
  parseProductIntentParams,
  runPurchaseFlow,
  runRestoreFlow,
  type PurchaseFlowDependencies,
} from './purchases';

const DRAFT_ID = '10000000-0000-4000-8000-000000000001';
const CAMPAIGN_ID = '20000000-0000-4000-8000-000000000002';

describe('paywall product intent', () => {
  it('rejects missing and mismatched route context', () => {
    expect(parseProductIntentParams({})).toBeNull();
    expect(
      parseProductIntentParams({
        intent: 'creator_launch',
        draftId: DRAFT_ID,
        campaignId: CAMPAIGN_ID,
      }),
    ).toBeNull();
    expect(parseProductIntentParams({ intent: 'campaign_pass', draftId: DRAFT_ID })).toBeNull();
  });

  it('parses each complete context as a discriminated union', () => {
    expect(parseProductIntentParams({ intent: 'creator_launch', draftId: DRAFT_ID })).toEqual({
      intent: 'creator_launch',
      draftId: DRAFT_ID,
    });
    expect(parseProductIntentParams({ intent: 'campaign_pass', campaignId: CAMPAIGN_ID })).toEqual({
      intent: 'campaign_pass',
      campaignId: CAMPAIGN_ID,
    });
  });
});

describe('purchase confirmation sequence', () => {
  it('issues intent, sets scoped attributes, purchases, then polls until confirmed', async () => {
    const events: string[] = [];
    let now = 0;
    const hasConfirmedBenefit = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const dependencies: PurchaseFlowDependencies = {
      issueIntent: async (productId, scopeId) => {
        events.push(`intent:${productId}:${scopeId}`);
        return 'purchase-intent-id';
      },
      setAttributes: async (attributes) => {
        events.push(`attributes:${JSON.stringify(attributes)}`);
      },
      purchase: async (packageIdentifier, productId) => {
        events.push(`purchase:${packageIdentifier}:${productId}`);
      },
      restore: async () => {
        events.push('restore');
      },
      hasConfirmedBenefit: async (scope) => {
        events.push(`benefit:${JSON.stringify(scope)}`);
        return hasConfirmedBenefit();
      },
      wait: async (milliseconds) => {
        events.push(`wait:${milliseconds}`);
        now += milliseconds;
      },
      now: () => now,
    };

    await expect(
      runPurchaseFlow({ intent: 'creator_launch', draftId: DRAFT_ID }, 'creator-package', {
        signal: new AbortController().signal,
        onAwaitingConfirmation: () => events.push('pending'),
        dependencies,
      }),
    ).resolves.toBe('confirmed');

    expect(events).toEqual([
      `intent:creator_launch_credit_499:${DRAFT_ID}`,
      `attributes:${JSON.stringify({
        purchase_intent_id: 'purchase-intent-id',
        pitch_draft_id: DRAFT_ID,
        campaign_id: null,
      })}`,
      'purchase:creator-package:creator_launch_credit_499',
      'pending',
      `benefit:${JSON.stringify({
        productId: 'creator_launch_credit_499',
        pitchDraftId: DRAFT_ID,
      })}`,
      'wait:2000',
      `benefit:${JSON.stringify({
        productId: 'creator_launch_credit_499',
        pitchDraftId: DRAFT_ID,
      })}`,
    ]);
  });

  it('returns timed_out only after the configured polling window', async () => {
    let now = 0;
    const hasConfirmedBenefit = vi.fn().mockResolvedValue(false);
    const dependencies: PurchaseFlowDependencies = {
      issueIntent: vi.fn().mockResolvedValue('purchase-intent-id'),
      setAttributes: vi.fn().mockResolvedValue(undefined),
      purchase: vi.fn().mockResolvedValue(undefined),
      restore: vi.fn().mockResolvedValue(undefined),
      hasConfirmedBenefit,
      wait: async (milliseconds) => {
        now += milliseconds;
      },
      now: () => now,
    };

    await expect(
      runPurchaseFlow({ intent: 'campaign_pass', campaignId: CAMPAIGN_ID }, 'pass-package', {
        signal: new AbortController().signal,
        onAwaitingConfirmation: vi.fn(),
        intervalMs: 2_000,
        timeoutMs: 4_000,
        dependencies,
      }),
    ).resolves.toBe('timed_out');
    expect(now).toBe(4_000);
    expect(hasConfirmedBenefit).toHaveBeenCalledTimes(3);
  });

  it('keeps polling through a transient benefit read failure', async () => {
    let now = 0;
    const dependencies: PurchaseFlowDependencies = {
      issueIntent: vi.fn().mockResolvedValue('purchase-intent-id'),
      setAttributes: vi.fn().mockResolvedValue(undefined),
      purchase: vi.fn().mockResolvedValue(undefined),
      restore: vi.fn().mockResolvedValue(undefined),
      hasConfirmedBenefit: vi
        .fn()
        .mockRejectedValueOnce(new Error('temporary read failure'))
        .mockResolvedValueOnce(true),
      wait: async (milliseconds) => {
        now += milliseconds;
      },
      now: () => now,
    };

    await expect(
      runPurchaseFlow({ intent: 'creator_launch', draftId: DRAFT_ID }, 'creator-package', {
        signal: new AbortController().signal,
        onAwaitingConfirmation: vi.fn(),
        dependencies,
      }),
    ).resolves.toBe('confirmed');
    expect(now).toBe(2_000);
  });

  it('uses the same intent and benefit confirmation path after restore', async () => {
    const issueIntent = vi.fn().mockResolvedValue('restore-intent-id');
    const setAttributes = vi.fn().mockResolvedValue(undefined);
    const restore = vi.fn().mockResolvedValue(undefined);
    const onAwaitingConfirmation = vi.fn();
    const dependencies: PurchaseFlowDependencies = {
      issueIntent,
      setAttributes,
      purchase: vi.fn().mockResolvedValue(undefined),
      restore,
      hasConfirmedBenefit: vi.fn().mockResolvedValue(true),
      wait: vi.fn().mockResolvedValue(undefined),
      now: () => 0,
    };

    await expect(
      runRestoreFlow(
        { intent: 'campaign_pass', campaignId: CAMPAIGN_ID },
        {
          signal: new AbortController().signal,
          onAwaitingConfirmation,
          dependencies,
        },
      ),
    ).resolves.toBe('confirmed');
    expect(issueIntent).toHaveBeenCalledWith('campaign_30d_1999', CAMPAIGN_ID);
    expect(setAttributes).toHaveBeenCalledWith({
      purchase_intent_id: 'restore-intent-id',
      pitch_draft_id: null,
      campaign_id: CAMPAIGN_ID,
    });
    expect(restore).toHaveBeenCalledOnce();
    expect(onAwaitingConfirmation).toHaveBeenCalledOnce();
  });
});
