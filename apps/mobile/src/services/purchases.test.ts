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
      ensureIdentity: async () => {
        events.push('identity');
      },
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
      'identity',
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
      ensureIdentity: vi.fn().mockResolvedValue(undefined),
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
      ensureIdentity: vi.fn().mockResolvedValue(undefined),
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

  it('restores without issuing a new intent, then confirms the existing benefit', async () => {
    // Restore is the recovery of an already-owned purchase. Issuing a fresh
    // purchase intent here blocks restore whenever an active benefit already
    // exists (audit P0-6 / DECISIONS 2026-07-14 point 3), so the restore path
    // must skip issueIntent entirely and never stamp purchase_intent_id.
    const events: string[] = [];
    const issueIntent = vi.fn(async () => {
      events.push('intent');
      return 'must-not-be-issued';
    });
    const setAttributes = vi.fn(async (attributes: Readonly<Record<string, string | null>>) => {
      events.push(`attributes:${JSON.stringify(attributes)}`);
    });
    const restore = vi.fn(async () => {
      events.push('restore');
    });
    const onAwaitingConfirmation = vi.fn(() => events.push('pending'));
    const dependencies: PurchaseFlowDependencies = {
      ensureIdentity: vi.fn(async () => {
        events.push('identity');
      }),
      issueIntent,
      setAttributes,
      purchase: vi.fn().mockResolvedValue(undefined),
      restore,
      hasConfirmedBenefit: vi.fn(async () => {
        events.push('benefit');
        return true;
      }),
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

    // Identity is still guaranteed, but no intent is issued and no
    // purchase_intent_id attribute is set; scoped context may still be sent.
    expect(events).toEqual([
      'identity',
      `attributes:${JSON.stringify({ pitch_draft_id: null, campaign_id: CAMPAIGN_ID })}`,
      'restore',
      'pending',
      'benefit',
    ]);
    expect(issueIntent).not.toHaveBeenCalled();
    expect(setAttributes).toHaveBeenCalledOnce();
    expect(setAttributes.mock.calls[0]?.[0]).not.toHaveProperty('purchase_intent_id');
    expect(restore).toHaveBeenCalledOnce();
    expect(onAwaitingConfirmation).toHaveBeenCalledOnce();
  });

  it('does not issue an intent when the pre-purchase identity check fails', async () => {
    const issueIntent = vi.fn().mockResolvedValue('purchase-intent-id');
    const dependencies: PurchaseFlowDependencies = {
      ensureIdentity: vi.fn().mockRejectedValue(new Error('RevenueCat identity mismatch')),
      issueIntent,
      setAttributes: vi.fn().mockResolvedValue(undefined),
      purchase: vi.fn().mockResolvedValue(undefined),
      restore: vi.fn().mockResolvedValue(undefined),
      hasConfirmedBenefit: vi.fn().mockResolvedValue(false),
      wait: vi.fn().mockResolvedValue(undefined),
      now: () => 0,
    };

    await expect(
      runPurchaseFlow({ intent: 'creator_launch', draftId: DRAFT_ID }, 'creator-package', {
        signal: new AbortController().signal,
        onAwaitingConfirmation: vi.fn(),
        dependencies,
      }),
    ).rejects.toThrow('RevenueCat identity mismatch');
    expect(issueIntent).not.toHaveBeenCalled();
  });
});
