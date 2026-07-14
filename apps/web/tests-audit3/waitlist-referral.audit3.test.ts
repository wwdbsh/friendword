// FIFTH-AUDIT REGRESSION — GP-P0-2 / H-8 (web acquisition + referral preservation)
// The waitlist submit must forward exactly (email, referral slug, source) to the
// anon `join_waitlist` RPC, treat duplicates/no-ops as success, and surface honest
// cap/format errors. Referral attribution must be first-touch and survive from a
// public pitch visit to the landing waitlist submit and the `claim_referral` call.
/* global describe, expect, it */

import {
  claimReferral,
  FW_REFERRAL_KEY,
  isLikelyEmail,
  isValidReferralSlug,
  readStoredReferral,
  storeReferral,
  submitWaitlist,
} from '../src/lib/waitlist';

type RpcCall = { fn: string; params: Record<string, unknown> | undefined };

function fakeClient(errors: Record<string, { message: string } | null> = {}) {
  const calls: RpcCall[] = [];
  const client = {
    rpc: (fn: string, params?: Record<string, unknown>) => {
      calls.push({ fn, params });
      return Promise.resolve({ data: null, error: errors[fn] ?? null });
    },
  };
  return { client, calls };
}

function fakeStorage(): Storage {
  const map = new Map<string, string>();
  const store: Storage = {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => (map.has(key) ? (map.get(key) as string) : null),
    key: (index: number) => Array.from(map.keys())[index] ?? null,
    removeItem: (key: string) => void map.delete(key),
    setItem: (key: string, value: string) => void map.set(key, String(value)),
  };
  return store;
}

describe('shape guards', () => {
  it('accepts campaign-style slugs and rejects malformed ones', () => {
    expect(isValidReferralSlug('demo-blair')).toBe(true);
    expect(isValidReferralSlug('abc123')).toBe(true);
    expect(isValidReferralSlug('')).toBe(false);
    expect(isValidReferralSlug('Bad Slug')).toBe(false);
    expect(isValidReferralSlug('-lead')).toBe(false);
    expect(isValidReferralSlug(null)).toBe(false);
  });

  it('does a light email sanity check only', () => {
    expect(isLikelyEmail('a@b.co')).toBe(true);
    expect(isLikelyEmail('  a@b.co  ')).toBe(true);
    expect(isLikelyEmail('nope')).toBe(false);
    expect(isLikelyEmail('a@b')).toBe(false);
  });
});

describe('referral preservation (first-touch)', () => {
  it('stores the first slug and never overwrites it', () => {
    const store = fakeStorage();
    storeReferral('demo-blair', store);
    storeReferral('someone-else', store);
    expect(store.getItem(FW_REFERRAL_KEY)).toBe('demo-blair');
    expect(readStoredReferral(store)).toBe('demo-blair');
  });

  it('ignores invalid slugs and absent storage', () => {
    const store = fakeStorage();
    storeReferral('Bad Slug', store);
    storeReferral(null, store);
    expect(readStoredReferral(store)).toBeNull();
  });
});

describe('waitlist submit forwards attribution to join_waitlist', () => {
  it('sends email, referral slug, and source, and reports joined on success', async () => {
    const { client, calls } = fakeClient();
    const result = await submitWaitlist(client as never, '  Fan@Example.com  ', {
      referralSlug: 'demo-blair',
      source: 'public-pitch',
    });
    expect(result).toEqual({ status: 'joined' });
    const call = calls.find((c) => c.fn === 'join_waitlist');
    expect(call?.params).toEqual({
      signup_email: 'Fan@Example.com',
      source_campaign_slug: 'demo-blair',
      signup_source: 'public-pitch',
    });
  });

  it('treats a server no-op (duplicate email) as joined', async () => {
    const { client } = fakeClient();
    const result = await submitWaitlist(client as never, 'again@example.com', {});
    expect(result).toEqual({ status: 'joined' });
  });

  it('nulls out an invalid referral slug rather than sending it', async () => {
    const { client, calls } = fakeClient();
    await submitWaitlist(client as never, 'x@y.co', { referralSlug: 'Not A Slug' });
    expect(calls[0]?.params).toMatchObject({ source_campaign_slug: null });
  });

  it('drops a malformed source slug to null (server rejects non-slug sources)', async () => {
    const { client, calls } = fakeClient();
    await submitWaitlist(client as never, 'x@y.co', { source: 'junk src with spaces' });
    expect(calls[0]?.params).toMatchObject({ signup_source: null });
  });

  it('rejects a malformed email locally without hitting the RPC', async () => {
    const { client, calls } = fakeClient();
    const result = await submitWaitlist(client as never, 'nope', {});
    expect(result).toEqual({ status: 'invalid_email' });
    expect(calls).toHaveLength(0);
  });

  it('maps an hourly-cap error to rate_limited', async () => {
    const { client } = fakeClient({ join_waitlist: { message: 'hourly cap exceeded' } });
    const result = await submitWaitlist(client as never, 'x@y.co', {});
    expect(result).toEqual({ status: 'rate_limited' });
  });

  it('maps a server format error to invalid_email', async () => {
    const { client } = fakeClient({ join_waitlist: { message: 'invalid email format' } });
    const result = await submitWaitlist(client as never, 'x@y.co', {});
    expect(result).toEqual({ status: 'invalid_email' });
  });

  it('returns error when the browser client is unavailable', async () => {
    const result = await submitWaitlist(null, 'x@y.co', {});
    expect(result).toEqual({ status: 'error' });
  });
});

describe('claim_referral is fire-and-forget', () => {
  it('claims the stored slug for a signed-in user', async () => {
    const { client, calls } = fakeClient();
    await claimReferral(client as never, 'demo-blair');
    expect(calls).toEqual([
      { fn: 'claim_referral', params: { source_campaign_slug: 'demo-blair' } },
    ]);
  });

  it('does nothing for an invalid slug or missing client', async () => {
    const { client, calls } = fakeClient();
    await claimReferral(client as never, 'Bad Slug');
    await claimReferral(null, 'demo-blair');
    expect(calls).toHaveLength(0);
  });

  it('swallows RPC errors so the page never breaks', async () => {
    const { client } = fakeClient({ claim_referral: { message: 'boom' } });
    await expect(claimReferral(client as never, 'demo-blair')).resolves.toBeUndefined();
  });
});
