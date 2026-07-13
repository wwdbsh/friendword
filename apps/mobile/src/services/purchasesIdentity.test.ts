import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: {} } } }));

import { createPurchasesIdentityService, type PurchasesIdentityClient } from './purchasesIdentity';

const USER_A = '10000000-0000-4000-8000-000000000001';
const USER_B = '20000000-0000-4000-8000-000000000002';

function createFakePurchases(options: { readonly preserveIdentityOnLogin?: boolean } = {}) {
  let appUserId = '$RCAnonymousID:initial';
  let anonymous = true;
  const configure = vi.fn((configuration: Parameters<PurchasesIdentityClient['configure']>[0]) => {
    appUserId = configuration.appUserID ?? '$RCAnonymousID:configured';
    anonymous = configuration.appUserID === null;
  });
  const getAppUserID = vi.fn(async () => appUserId);
  const isAnonymous = vi.fn(async () => anonymous);
  const logIn = vi.fn(async (userId: string) => {
    if (!options.preserveIdentityOnLogin) {
      appUserId = userId;
      anonymous = false;
    }
  });
  const logOut = vi.fn(async () => {
    appUserId = '$RCAnonymousID:logged-out';
    anonymous = true;
  });
  const client: PurchasesIdentityClient = {
    configure,
    getAppUserID,
    isAnonymous,
    logIn,
    logOut,
  };
  const service = createPurchasesIdentityService({
    getApiKey: () => 'revenuecat-test-key',
    loadPurchases: () => client,
  });

  return { service, configure, logIn, logOut };
}

describe('RevenueCat identity sync', () => {
  it('configures an anonymous identity on a signed-out cold start', async () => {
    const { service, configure, logIn, logOut } = createFakePurchases();

    await expect(service.sync(null)).resolves.toMatchObject({ state: 'synced' });

    expect(configure).toHaveBeenCalledWith({ apiKey: 'revenuecat-test-key', appUserID: null });
    expect(configure).toHaveBeenCalledOnce();
    expect(logIn).not.toHaveBeenCalled();
    expect(logOut).not.toHaveBeenCalled();
  });

  it('logs in once when auth appears after anonymous configuration', async () => {
    const { service, logIn } = createFakePurchases();
    await service.sync(null);

    await expect(service.sync({ userId: USER_A })).resolves.toEqual({
      state: 'synced',
      appUserId: USER_A,
    });

    expect(logIn).toHaveBeenCalledOnce();
    expect(logIn).toHaveBeenCalledWith(USER_A);
  });

  it('logs in as B when the auth account changes from A to B', async () => {
    const { service, configure, logIn } = createFakePurchases();
    await service.sync({ userId: USER_A });

    await expect(service.sync({ userId: USER_B })).resolves.toEqual({
      state: 'synced',
      appUserId: USER_B,
    });

    expect(configure).toHaveBeenCalledOnce();
    expect(logIn).toHaveBeenCalledOnce();
    expect(logIn).toHaveBeenCalledWith(USER_B);
  });

  it('logs out only when a named identity needs to become anonymous', async () => {
    const { service, logOut } = createFakePurchases();
    await service.sync({ userId: USER_A });

    await service.sync(null);
    await service.sync(null);

    expect(logOut).toHaveBeenCalledOnce();
  });

  it('does not log in again when the same user is synchronized', async () => {
    const { service, logIn } = createFakePurchases();

    await service.sync({ userId: USER_A });
    await service.sync({ userId: USER_A });

    expect(logIn).not.toHaveBeenCalled();
  });

  it('rejects a pre-purchase check when login does not resolve the identity mismatch', async () => {
    const { service } = createFakePurchases({ preserveIdentityOnLogin: true });
    await service.sync(null);

    await expect(service.ensureUser(USER_A)).rejects.toThrow(
      'RevenueCat identity does not match the signed-in user. Purchase was not started.',
    );
  });
});
