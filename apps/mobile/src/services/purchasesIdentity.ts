import Constants from 'expo-constants';

type PurchasesModule = typeof import('react-native-purchases').default;

export type PurchasesIdentityClient = {
  configure(configuration: { readonly apiKey: string; readonly appUserID: string | null }): void;
  getAppUserID(): Promise<string>;
  isAnonymous(): Promise<boolean>;
  logIn(appUserId: string): Promise<unknown>;
  logOut(): Promise<unknown>;
};

export type PurchasesIdentitySession = { readonly userId: string } | null;

export type PurchasesIdentitySyncResult =
  | { readonly state: 'synced'; readonly appUserId: string }
  | { readonly state: 'unconfigured'; readonly reason: string }
  | { readonly state: 'error'; readonly error: Error };

type PurchasesIdentityDependencies = {
  readonly getApiKey: () => string | null;
  readonly loadPurchases: () => PurchasesIdentityClient | null;
};

export type PurchasesIdentityService = {
  sync(session: PurchasesIdentitySession): Promise<PurchasesIdentitySyncResult>;
  ensureUser(userId: string): Promise<void>;
};

const MISSING_KEY_REASON = 'RevenueCat API key is not set (EXPO_PUBLIC_REVENUECAT_IOS_API_KEY).';
const MISSING_MODULE_REASON =
  'Purchases need the development build — Expo Go cannot load the native module.';
const IDENTITY_MISMATCH_REASON =
  'RevenueCat identity does not match the signed-in user. Purchase was not started.';

export function getRevenueCatApiKey(): string | null {
  const value = Constants.expoConfig?.extra?.['revenueCatIosApiKey'];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Dynamic loading keeps Expo Go from crashing when the native module is absent. */
export function loadPurchasesModule(): PurchasesModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const module = require('react-native-purchases') as {
      readonly default: PurchasesModule;
    };
    return module.default;
  } catch {
    return null;
  }
}

export function createPurchasesIdentityService(
  dependencies: PurchasesIdentityDependencies,
): PurchasesIdentityService {
  let configuredPurchases: PurchasesIdentityClient | null = null;
  let lastSyncedAppUserId: string | null | undefined;
  let syncQueue: Promise<void> = Promise.resolve();

  const sync = (session: PurchasesIdentitySession): Promise<PurchasesIdentitySyncResult> => {
    const operation = syncQueue.then(async () => {
      const apiKey = dependencies.getApiKey();
      if (apiKey === null) {
        return { state: 'unconfigured', reason: MISSING_KEY_REASON } as const;
      }

      const purchases = configuredPurchases ?? dependencies.loadPurchases();
      if (purchases === null) {
        return { state: 'unconfigured', reason: MISSING_MODULE_REASON } as const;
      }

      try {
        if (configuredPurchases === null) {
          purchases.configure({ apiKey, appUserID: session?.userId ?? null });
          configuredPurchases = purchases;
        }

        const desiredAppUserId = session?.userId ?? null;
        let currentAppUserId = await purchases.getAppUserID();

        if (
          desiredAppUserId !== null &&
          (lastSyncedAppUserId !== desiredAppUserId || currentAppUserId !== desiredAppUserId)
        ) {
          if (currentAppUserId !== desiredAppUserId) {
            await purchases.logIn(desiredAppUserId);
            currentAppUserId = await purchases.getAppUserID();
          }
        } else if (desiredAppUserId === null && !(await purchases.isAnonymous())) {
          await purchases.logOut();
          currentAppUserId = await purchases.getAppUserID();
        }

        if (desiredAppUserId !== null && currentAppUserId !== desiredAppUserId) {
          throw new Error(IDENTITY_MISMATCH_REASON);
        }
        if (desiredAppUserId === null && !(await purchases.isAnonymous())) {
          throw new Error('RevenueCat identity did not become anonymous after sign-out.');
        }

        lastSyncedAppUserId = desiredAppUserId;
        return { state: 'synced', appUserId: currentAppUserId } as const;
      } catch (error: unknown) {
        return {
          state: 'error',
          error: toError(error, 'RevenueCat identity sync failed.'),
        } as const;
      }
    });

    syncQueue = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  };

  return {
    sync,
    ensureUser: async (userId) => {
      const result = await sync({ userId });
      if (result.state === 'unconfigured') {
        throw new Error(result.reason);
      }
      if (result.state === 'error') {
        throw result.error;
      }

      const purchases = configuredPurchases;
      if (purchases === null || (await purchases.getAppUserID()) !== userId) {
        throw new Error(IDENTITY_MISMATCH_REASON);
      }
      lastSyncedAppUserId = userId;
    },
  };
}

function toError(error: unknown, fallbackMessage: string): Error {
  return error instanceof Error ? error : new Error(fallbackMessage);
}

const purchasesIdentity = createPurchasesIdentityService({
  getApiKey: getRevenueCatApiKey,
  loadPurchases: loadPurchasesModule,
});

export function syncPurchasesIdentity(
  session: PurchasesIdentitySession,
): Promise<PurchasesIdentitySyncResult> {
  return purchasesIdentity.sync(session);
}

export function ensurePurchasesIdentity(userId: string): Promise<void> {
  return purchasesIdentity.ensureUser(userId);
}
