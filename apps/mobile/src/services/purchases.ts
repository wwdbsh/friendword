import Constants from 'expo-constants';
import { z } from 'zod';

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

export type PurchasesStatus =
  | { readonly state: 'ready'; readonly packages: readonly PaywallPackage[] }
  | { readonly state: 'unconfigured'; readonly reason: string };

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

export async function getPaywallStatus(): Promise<PurchasesStatus> {
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
    const packages = (offerings.current?.availablePackages ?? []).map((pkg) => ({
      identifier: pkg.identifier,
      productId: pkg.product.identifier,
      title: pkg.product.title,
      priceString: pkg.product.priceString,
    }));
    return { state: 'ready', packages };
  } catch (error: unknown) {
    return {
      state: 'unconfigured',
      reason: error instanceof Error ? error.message : 'RevenueCat offerings could not be loaded.',
    };
  }
}

/**
 * Purchases a package; scope attributes let the server webhook attach the
 * purchase to the right resource. Throws on failure or user cancel.
 */
export async function purchasePackage(
  packageIdentifier: string,
  scope: { readonly pitchDraftId?: string; readonly campaignId?: string },
): Promise<void> {
  const purchases = loadPurchases();
  if (purchases === null) {
    throw new Error('purchases unavailable in this build');
  }

  await purchases.setAttributes({
    pitch_draft_id: scope.pitchDraftId ?? null,
    campaign_id: scope.campaignId ?? null,
  });

  const offerings = await purchases.getOfferings();
  const pkg = offerings.current?.availablePackages.find(
    (candidate) => candidate.identifier === packageIdentifier,
  );
  if (pkg === undefined) {
    throw new Error('package not found in the current offering');
  }

  await purchases.purchasePackage(pkg);
}

export async function restorePurchases(): Promise<void> {
  const purchases = loadPurchases();
  if (purchases === null) {
    throw new Error('purchases unavailable in this build');
  }
  await purchases.restorePurchases();
}
