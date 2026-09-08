import { z } from 'zod';

import { PurchasesRepo, type PurchaseBenefitScope } from '@friendword/data';

import { diagnosticsEnabled, formatErrorForDisplay } from './errorDiagnostics';
import {
  ensurePurchasesIdentity,
  getRevenueCatApiKey,
  loadPurchasesModule,
  syncPurchasesIdentity,
} from './purchasesIdentity';
import { getSupabaseClient } from './supabaseClient';

export const PRODUCT_IDS = {
  creatorLaunchCredit: 'creator_launch_credit_499',
  campaignPass30d: 'campaign_pass_30d_1999',
} as const;

export type PaywallPackage = {
  readonly identifier: string;
  readonly productId: string;
  readonly title: string;
  readonly priceString: string;
};

export type ProductIntent =
  | { readonly intent: 'creator_launch'; readonly draftId: string }
  | { readonly intent: 'campaign_pass'; readonly campaignId: string };

/**
 * Why the store cannot be used right now, in the only shapes a buyer can act on.
 *
 * M-9 (T004, Issue #73): the paywall printed whatever RevenueCat's SDK threw,
 * so a misconfigured build showed the buyer "OfferingsManager.Error … configure
 * your offerings at https://app.rev.cat/…". That text is ours to read, not
 * theirs: it names our dashboard, it cannot be acted on from a phone, and it
 * reads like the app is broken in a way the buyer caused. The class is what the
 * screen needs — there is nothing to buy vs. it did not work just now vs. sign
 * in first — and the raw text stays in the diagnostics channel.
 */
export type PurchaseFailureReason =
  'not_configured' | 'unavailable' | 'no_products' | 'signed_out' | 'cancelled';

/**
 * One sentence per class, and each says whether money moved. "Nothing was
 * charged" is the sentence a person actually wants after a payment screen
 * fails, and every branch here reaches this point before any purchase is made
 * or after one that threw, so it is true in all of them.
 */
export const PURCHASE_FAILURE_MESSAGES: Readonly<Record<PurchaseFailureReason, string>> = {
  not_configured: 'Purchases are not switched on in this build yet. Nothing was charged.',
  unavailable:
    'The store could not be reached just now. Nothing was charged — try again in a moment.',
  no_products: 'There is nothing to buy for this pitch yet. Nothing was charged.',
  signed_out: 'Sign in first so the purchase lands on your account. Nothing was charged.',
  cancelled: 'You cancelled the payment, so nothing was charged.',
};

export const PURCHASE_FAILURE_TITLES: Readonly<Record<PurchaseFailureReason, string>> = {
  not_configured: 'Purchases aren’t live yet',
  unavailable: 'The store didn’t answer',
  no_products: 'Nothing to buy here yet',
  signed_out: 'Sign in to buy this',
  cancelled: 'Payment cancelled',
};

/**
 * A failure this app raised itself, carrying the class the screen should show.
 *
 * Everything the SDK throws is classified as `unavailable` (or `cancelled`),
 * because guessing a class out of a vendor's error text is how a
 * "not configured" message ends up in front of a buyer with a working store.
 */
export class PurchasesUnavailableError extends Error {
  readonly reason: PurchaseFailureReason;

  constructor(reason: PurchaseFailureReason, diagnostic: string) {
    super(diagnostic);
    this.name = 'PurchasesUnavailableError';
    this.reason = reason;
  }
}

/** True for a RevenueCat rejection the buyer caused by tapping Cancel. */
function isUserCancellation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('userCancelled' in error)) {
    return false;
  }
  return error.userCancelled === true;
}

export function classifyPurchaseFailure(error: unknown): PurchaseFailureReason {
  if (error instanceof PurchasesUnavailableError) {
    return error.reason;
  }
  return isUserCancellation(error) ? 'cancelled' : 'unavailable';
}

/**
 * What the paywall prints for a failed purchase or restore.
 *
 * The raw text is appended only on a dev build, through the same gate as every
 * other on-screen diagnostic (`formatErrorForDisplay`), so a released build
 * shows the sentence and nothing else.
 */
export function describePurchaseFailure(error: unknown): string {
  const message = PURCHASE_FAILURE_MESSAGES[classifyPurchaseFailure(error)];
  if (!diagnosticsEnabled() || !(error instanceof Error)) {
    return message;
  }
  return `${message} · ${formatErrorForDisplay(error)}`;
}

export type PurchasesStatus =
  | { readonly state: 'ready'; readonly package: PaywallPackage | null }
  | {
      readonly state: 'unavailable';
      readonly reason: PurchaseFailureReason;
      /** Raw vendor text. Diagnostics only — never printed on a release build. */
      readonly diagnostic: string;
    };

export type PurchaseFlowResult = 'confirmed' | 'timed_out';

type RouteParams = {
  readonly intent?: unknown;
  readonly draftId?: unknown;
  readonly campaignId?: unknown;
};

export type PurchaseFlowDependencies = {
  ensureIdentity(): Promise<void>;
  issueIntent(productId: ProductId, scopeId: string): Promise<string>;
  setAttributes(attributes: Readonly<Record<string, string | null>>): Promise<void>;
  purchase(packageIdentifier: string, productId: ProductId): Promise<void>;
  restore(): Promise<void>;
  hasConfirmedBenefit(scope: PurchaseBenefitScope): Promise<boolean>;
  wait(milliseconds: number, signal: AbortSignal): Promise<void>;
  now(): number;
};

export type PurchaseFlowOptions = {
  readonly signal: AbortSignal;
  readonly onAwaitingConfirmation: () => void;
  readonly intervalMs?: number;
  readonly timeoutMs?: number;
  readonly dependencies?: PurchaseFlowDependencies;
};

type ProductId = (typeof PRODUCT_IDS)[keyof typeof PRODUCT_IDS];

const productIntentParamsSchema = z.discriminatedUnion('intent', [
  z.object({
    intent: z.literal('creator_launch'),
    draftId: z.uuid(),
    campaignId: z.undefined().optional(),
  }),
  z.object({
    intent: z.literal('campaign_pass'),
    campaignId: z.uuid(),
    draftId: z.undefined().optional(),
  }),
]);

export function parseProductIntentParams(params: RouteParams): ProductIntent | null {
  const parsed = productIntentParamsSchema.safeParse(params);
  return parsed.success ? parsed.data : null;
}

export function getProductId(intent: ProductIntent): ProductId {
  return intent.intent === 'creator_launch'
    ? PRODUCT_IDS.creatorLaunchCredit
    : PRODUCT_IDS.campaignPass30d;
}

export async function getPaywallStatus(intent: ProductIntent): Promise<PurchasesStatus> {
  if (getRevenueCatApiKey() === null) {
    return {
      state: 'unavailable',
      reason: 'not_configured',
      diagnostic: 'RevenueCat API key is not set (EXPO_PUBLIC_REVENUECAT_IOS_API_KEY).',
    };
  }

  const purchases = loadPurchasesModule();
  if (purchases === null) {
    return {
      state: 'unavailable',
      reason: 'not_configured',
      diagnostic: 'Purchases need the development build — Expo Go cannot load the native module.',
    };
  }

  try {
    const client = getSupabaseClient();
    const session = client === null ? null : (await client.auth.getSession()).data.session;
    const identityResult = await syncPurchasesIdentity(
      session === null ? null : { userId: session.user.id },
    );
    if (identityResult.state === 'unconfigured') {
      return { state: 'unavailable', reason: 'not_configured', diagnostic: identityResult.reason };
    }
    if (identityResult.state === 'error') {
      // Identity failed against a store that IS configured, so this is the
      // "not right now" class, not the "not set up" one.
      return {
        state: 'unavailable',
        reason: 'unavailable',
        diagnostic: identityResult.error.message,
      };
    }
    const offerings = await purchases.getOfferings();
    const expectedProductId = getProductId(intent);
    const pkg = offerings.current?.availablePackages.find(
      (candidate) => candidate.product.identifier === expectedProductId,
    );
    return {
      state: 'ready',
      package:
        pkg === undefined
          ? null
          : {
              identifier: pkg.identifier,
              productId: pkg.product.identifier,
              title: pkg.product.title,
              priceString: pkg.product.priceString,
            },
    };
  } catch (error: unknown) {
    // The vendor text (OfferingsManager errors carry rev.cat dashboard URLs)
    // goes to the log, which is where it has always been useful.
    console.warn('[paywall] offerings could not be loaded', error);
    return {
      state: 'unavailable',
      reason: 'unavailable',
      diagnostic:
        error instanceof Error ? error.message : 'RevenueCat offerings could not be loaded.',
    };
  }
}

export async function runPurchaseFlow(
  intent: ProductIntent,
  packageIdentifier: string,
  options: PurchaseFlowOptions,
): Promise<PurchaseFlowResult> {
  return runFlow('purchase', intent, packageIdentifier, options);
}

export async function runRestoreFlow(
  intent: ProductIntent,
  options: PurchaseFlowOptions,
): Promise<PurchaseFlowResult> {
  return runFlow('restore', intent, null, options);
}

async function runFlow(
  operation: 'purchase' | 'restore',
  intent: ProductIntent,
  packageIdentifier: string | null,
  options: PurchaseFlowOptions,
): Promise<PurchaseFlowResult> {
  const dependencies = options.dependencies ?? createProductionDependencies();
  const productId = getProductId(intent);
  const scopeId = intent.intent === 'creator_launch' ? intent.draftId : intent.campaignId;
  const scopedContext = {
    pitch_draft_id: intent.intent === 'creator_launch' ? intent.draftId : null,
    campaign_id: intent.intent === 'campaign_pass' ? intent.campaignId : null,
  } as const;

  await dependencies.ensureIdentity();
  throwIfAborted(options.signal);

  if (operation === 'purchase') {
    // A purchase mints a fresh purchase intent and stamps it so the webhook
    // can attribute the transaction back to this buyer, scope, and draft.
    const purchaseIntentId = await dependencies.issueIntent(productId, scopeId);
    throwIfAborted(options.signal);
    await dependencies.setAttributes({ purchase_intent_id: purchaseIntentId, ...scopedContext });
    throwIfAborted(options.signal);
    if (packageIdentifier === null) {
      throw new Error('package identifier is required for purchase');
    }
    await dependencies.purchase(packageIdentifier, productId);
  } else {
    // Restore recovers an already-owned purchase, so it must NOT issue a new
    // intent (that step blocks restore whenever an active benefit already
    // exists — audit P0-6 / DECISIONS 2026-07-14 point 3). Identity is still
    // guaranteed and scoped context may be sent, but never purchase_intent_id.
    await dependencies.setAttributes({ ...scopedContext });
    throwIfAborted(options.signal);
    await dependencies.restore();
  }
  throwIfAborted(options.signal);

  options.onAwaitingConfirmation();
  return pollForBenefit(intent, options, dependencies);
}

async function pollForBenefit(
  intent: ProductIntent,
  options: PurchaseFlowOptions,
  dependencies: PurchaseFlowDependencies,
): Promise<PurchaseFlowResult> {
  const intervalMs = options.intervalMs ?? 2_000;
  const timeoutMs = options.timeoutMs ?? 60_000;
  const deadline = dependencies.now() + timeoutMs;
  const scope = toBenefitScope(intent);

  while (true) {
    throwIfAborted(options.signal);
    let confirmed = false;
    try {
      confirmed = await dependencies.hasConfirmedBenefit(scope);
    } catch {
      // A transient read failure must not turn RevenueCat success into a failed-purchase UI.
      // Keep polling and fall back to the honest delayed-confirmation message at the deadline.
    }
    if (confirmed) {
      return 'confirmed';
    }
    const remainingMs = deadline - dependencies.now();
    if (remainingMs <= 0) {
      return 'timed_out';
    }
    await dependencies.wait(Math.min(intervalMs, remainingMs), options.signal);
  }
}

function toBenefitScope(intent: ProductIntent): PurchaseBenefitScope {
  return intent.intent === 'creator_launch'
    ? { productId: PRODUCT_IDS.creatorLaunchCredit, pitchDraftId: intent.draftId }
    : { productId: PRODUCT_IDS.campaignPass30d, campaignId: intent.campaignId };
}

function createProductionDependencies(): PurchaseFlowDependencies {
  const client = getSupabaseClient();
  if (client === null) {
    throw new PurchasesUnavailableError(
      'not_configured',
      'Sign in and configure Supabase before purchasing.',
    );
  }
  const purchases = loadPurchasesModule();
  if (purchases === null) {
    throw new PurchasesUnavailableError(
      'not_configured',
      'Purchases need the development build — Expo Go cannot load the native module.',
    );
  }
  if (getRevenueCatApiKey() === null) {
    throw new PurchasesUnavailableError(
      'not_configured',
      'RevenueCat API key is not set (EXPO_PUBLIC_REVENUECAT_IOS_API_KEY).',
    );
  }
  const repo = new PurchasesRepo(client);

  return {
    ensureIdentity: async () => {
      const session = (await client.auth.getSession()).data.session;
      if (session === null) {
        throw new PurchasesUnavailableError('signed_out', 'Sign in before purchasing.');
      }
      await ensurePurchasesIdentity(session.user.id);
    },
    issueIntent: async (productId, scopeId) =>
      (await repo.issuePurchaseIntent(productId, scopeId)).id,
    setAttributes: async (attributes) => {
      await purchases.setAttributes(attributes);
    },
    purchase: async (packageIdentifier, productId) => {
      const offerings = await purchases.getOfferings();
      const pkg = offerings.current?.availablePackages.find(
        (candidate) =>
          candidate.identifier === packageIdentifier && candidate.product.identifier === productId,
      );
      if (pkg === undefined) {
        throw new PurchasesUnavailableError(
          'no_products',
          'package not found for this paywall context',
        );
      }
      await purchases.purchasePackage(pkg);
    },
    restore: async () => {
      await purchases.restorePurchases();
    },
    hasConfirmedBenefit: async (scope) => repo.hasConfirmedBenefit(scope),
    wait: waitForDelay,
    now: () => Date.now(),
  };
}

function waitForDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timeout);
      reject(signal.reason instanceof Error ? signal.reason : new Error('purchase flow aborted'));
    };
    const timeout = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new Error('purchase flow aborted');
  }
}
