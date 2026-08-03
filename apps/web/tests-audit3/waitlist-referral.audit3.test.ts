// FIFTH-AUDIT REGRESSION — GP-P0-2 / H-8 (web acquisition + referral preservation)
// + VIRAL-LOOP SLICE (D1): the referral store is promoted to localStorage as
// `{ slug, ch, ts }` with a 30-day read-side TTL, first-touch no-overwrite is
// preserved, and the acquisition channel (`?ch`) rides along into
// `claim_referral` — degrading to slug-only against the deployed one-argument
// function, never to a lost claim. The waitlist submit contract is unchanged.
/* global describe, expect, it */

import {
  claimReferral,
  FW_REFERRAL_KEY,
  isLikelyEmail,
  isValidReferralSlug,
  normalizeChannel,
  readStoredReferral,
  REFERRAL_TTL_MS,
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

function storedRecord(store: Storage): Record<string, unknown> | null {
  const raw = store.getItem(FW_REFERRAL_KEY);
  return raw === null ? null : (JSON.parse(raw) as Record<string, unknown>);
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

  it('lowercases channel tags and drops malformed ones to null', () => {
    expect(normalizeChannel('ig_reel')).toBe('ig_reel');
    expect(normalizeChannel('  IG_Reel ')).toBe('ig_reel');
    expect(normalizeChannel('tik-tok')).toBe('tik-tok');
    expect(normalizeChannel('bad channel')).toBeNull();
    expect(normalizeChannel('a'.repeat(65))).toBeNull();
    expect(normalizeChannel('')).toBeNull();
    expect(normalizeChannel(null)).toBeNull();
    expect(normalizeChannel(undefined)).toBeNull();
  });
});

describe('referral preservation (first-touch, {slug, ch, ts})', () => {
  it('stores the first slug with its channel and timestamp and never overwrites it', () => {
    const store = fakeStorage();
    const before = Date.now();
    storeReferral('demo-blair', 'ig_reel', store);
    storeReferral('someone-else', 'tiktok', store);

    const record = storedRecord(store);
    expect(record).toMatchObject({ slug: 'demo-blair', ch: 'ig_reel' });
    expect(record?.ts).toBeGreaterThanOrEqual(before);

    const read = readStoredReferral(store);
    expect(read?.slug).toBe('demo-blair');
    expect(read?.channel).toBe('ig_reel');
  });

  it('keeps first-touch even when the later visit carries a channel and the first did not', () => {
    const store = fakeStorage();
    storeReferral('demo-blair', null, store);
    storeReferral('demo-blair', 'ig_reel', store);

    expect(readStoredReferral(store)).toMatchObject({ slug: 'demo-blair', channel: null });
  });

  it('drops an invalid channel to null without blocking the slug', () => {
    const store = fakeStorage();
    storeReferral('demo-blair', 'not a channel!!', store);

    expect(readStoredReferral(store)).toMatchObject({ slug: 'demo-blair', channel: null });
  });

  it('ignores invalid slugs and absent storage', () => {
    const store = fakeStorage();
    storeReferral('Bad Slug', null, store);
    storeReferral(null, 'ig_reel', store);
    expect(readStoredReferral(store)).toBeNull();
  });

  it('expires a stored referral after 30 days on read and clears the record', () => {
    const store = fakeStorage();
    store.setItem(
      FW_REFERRAL_KEY,
      JSON.stringify({ slug: 'demo-blair', ch: 'ig_reel', ts: Date.now() - REFERRAL_TTL_MS - 1 }),
    );

    expect(readStoredReferral(store)).toBeNull();
    expect(store.getItem(FW_REFERRAL_KEY)).toBeNull();
  });

  it('still serves a referral just inside the 30-day window', () => {
    const store = fakeStorage();
    const ts = Date.now() - REFERRAL_TTL_MS + 60_000;
    store.setItem(FW_REFERRAL_KEY, JSON.stringify({ slug: 'demo-blair', ch: null, ts }));

    expect(readStoredReferral(store)).toEqual({ slug: 'demo-blair', channel: null, storedAt: ts });
  });

  it('lets a new visit replace an expired record (first LIVE touch wins)', () => {
    const store = fakeStorage();
    store.setItem(
      FW_REFERRAL_KEY,
      JSON.stringify({ slug: 'old-campaign', ch: null, ts: Date.now() - REFERRAL_TTL_MS - 1 }),
    );

    storeReferral('demo-blair', 'ig_reel', store);

    expect(readStoredReferral(store)).toMatchObject({ slug: 'demo-blair', channel: 'ig_reel' });
  });

  it('treats malformed or legacy raw values as absent (and allows re-storing)', () => {
    const store = fakeStorage();
    store.setItem(FW_REFERRAL_KEY, 'demo-blair');
    expect(readStoredReferral(store)).toBeNull();

    store.setItem(FW_REFERRAL_KEY, '{"broken json');
    expect(readStoredReferral(store)).toBeNull();

    storeReferral('demo-blair', null, store);
    expect(readStoredReferral(store)).toMatchObject({ slug: 'demo-blair' });
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
  it('claims the stored slug without a channel key when no channel is known', async () => {
    const { client, calls } = fakeClient();
    await claimReferral(client as never, 'demo-blair');
    expect(calls).toEqual([
      { fn: 'claim_referral', params: { source_campaign_slug: 'demo-blair' } },
    ]);
  });

  it('sends the channel as the second argument when one is stored', async () => {
    const { client, calls } = fakeClient();
    await claimReferral(client as never, 'demo-blair', 'ig_reel');
    expect(calls).toEqual([
      { fn: 'claim_referral', params: { source_campaign_slug: 'demo-blair', channel: 'ig_reel' } },
    ]);
  });

  it('drops an invalid channel and claims slug-only (junk tags never block attribution)', async () => {
    const { client, calls } = fakeClient();
    await claimReferral(client as never, 'demo-blair', 'bad channel');
    expect(calls).toEqual([
      { fn: 'claim_referral', params: { source_campaign_slug: 'demo-blair' } },
    ]);
  });

  it('retries slug-only when the channel-carrying call fails (pre-migration server)', async () => {
    const { client, calls } = fakeClient({
      claim_referral: { message: 'function claim_referral(text, text) does not exist' },
    });
    await claimReferral(client as never, 'demo-blair', 'ig_reel');
    expect(calls.map((c) => c.params)).toEqual([
      { source_campaign_slug: 'demo-blair', channel: 'ig_reel' },
      { source_campaign_slug: 'demo-blair' },
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
