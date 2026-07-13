import Constants from 'expo-constants';
import { z } from 'zod';

import { PurchasesRepo, type PurchaseBenefitScope } from '@friendword/data';

import { getSupabaseClient } from './supabaseClient';

export const PRODUCT_IDS = {
  creatorLaunchCredit: 'creator_launch_credit_499',
  campaignPass30d: 'campaign_30d_1999',
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

export type PurchasesStatus =
  | { readonly state: 'ready'; readonly package: PaywallPackage | null }
  | { readonly state: 'unconfigured'; readonly reason: string };

export type PurchaseFlowResult = 'confirmed' | 'timed_out';

type RouteParams = {
  readonly intent?: unknown;
  readonly draftId?: unknown;
  readonly campaignId?: unknown;
};

export type PurchaseFlowDependencies = {
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

const apiKeySchema = z.string().min(1);

type PurchasesModule = typeof import('react-native-purchases').default;

let configured = false;

/**
 * RevenueCat is a hard Shipaton requirement, but the native module only
 * exists in a dev/EAS build and only works once the user has created the
 * products and pasted EXPO_PUBLIC_REVENUECAT_IOS_API_KEY. Every gap is
 * reported honestly — there is no mock purchase path anywhere.
 */
function loadPurchases(): PurchasesModule | null {
  try {
    // Dynamic require so Expo Go (no native module) never crashes at import.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const module = require('react-native-purchases') as {
      readonly default: PurchasesModule;
    };
    return module.default;
  } catch {
    return null;
  }
}

async function ensureConfigured(purchases: PurchasesModule, apiKey: string): Promise<void> {
  if (configured) {
    return;
  }

  const client = getSupabaseClient();
  const session = client === null ? null : (await client.auth.getSession()).data.session;
  purchases.configure({ apiKey, appUserID: session?.user.id ?? null });
  configured = true;
}

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
  const parsedKey = apiKeySchema.safeParse(
    Constants.expoConfig?.extra?.['revenueCatIosApiKey'] ?? '',
  );
  if (!parsedKey.success) {
    return {
      state: 'unconfigured',
      reason: 'RevenueCat API key is not set (EXPO_PUBLIC_REVENUECAT_IOS_API_KEY).',
    };
  }

  const purchases = loadPurchases();
  if (purchases === null) {
    return {
      state: 'unconfigured',
      reason: 'Purchases need the development build — Expo Go cannot load the native module.',
    };
  }

  try {
    await ensureConfigured(purchases, parsedKey.data);
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
    return {
      state: 'unconfigured',
      reason: error instanceof Error ? error.message : 'RevenueCat offerings could not be loaded.',
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
  const purchaseIntentId = await dependencies.issueIntent(productId, scopeId);
  throwIfAborted(options.signal);

  await dependencies.setAttributes({
    purchase_intent_id: purchaseIntentId,
    pitch_draft_id: intent.intent === 'creator_launch' ? intent.draftId : null,
    campaign_id: intent.intent === 'campaign_pass' ? intent.campaignId : null,
  });
  throwIfAborted(options.signal);

  if (operation === 'purchase') {
    if (packageIdentifier === null) {
      throw new Error('package identifier is required for purchase');
    }
    await dependencies.purchase(packageIdentifier, productId);
  } else {
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
    throw new Error('Sign in and configure Supabase before purchasing.');
  }
  const purchases = loadPurchases();
  if (purchases === null) {
    throw new Error(
      'Purchases need the development build — Expo Go cannot load the native module.',
    );
  }
  const parsedKey = apiKeySchema.safeParse(
    Constants.expoConfig?.extra?.['revenueCatIosApiKey'] ?? '',
  );
  if (!parsedKey.success) {
    throw new Error('RevenueCat API key is not set (EXPO_PUBLIC_REVENUECAT_IOS_API_KEY).');
  }
  const repo = new PurchasesRepo(client);

  return {
    issueIntent: async (productId, scopeId) =>
      (await repo.issuePurchaseIntent(productId, scopeId)).id,
    setAttributes: async (attributes) => {
      await ensureConfigured(purchases, parsedKey.data);
      await purchases.setAttributes(attributes);
    },
    purchase: async (packageIdentifier, productId) => {
      const offerings = await purchases.getOfferings();
      const pkg = offerings.current?.availablePackages.find(
        (candidate) =>
          candidate.identifier === packageIdentifier && candidate.product.identifier === productId,
      );
      if (pkg === undefined) {
        throw new Error('package not found for this paywall context');
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
