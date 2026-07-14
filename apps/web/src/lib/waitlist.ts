import type { BrowserSupabaseClient } from '@friendword/data';

/**
 * Waitlist + referral preservation (fifth audit Slice 5, GP-P0-2 / H-8).
 *
 * The iOS app is not on any store yet, so the only honest public acquisition
 * surface is a waitlist: a visitor leaves an email and gets invited at launch.
 * We never claim a K-factor and never store more than the email the server needs.
 *
 * These helpers wrap the anon-executable RPC `join_waitlist(signup_email,
 * source_campaign_slug, signup_source)` and the authenticated
 * `claim_referral(source_campaign_slug)` (migration 0039, `supabase/**`). This
 * layer owns only `apps/web/**` and cannot edit the generated `packages/data`
 * types, so the calls go through a deliberately loose adapter and are asserted
 * by the audit3 tests. The server is the authority on email format, duplicate
 * no-ops, hourly caps, first-source selection, and self-campaign rejection —
 * the client only does light shape checks so the UI can fail fast.
 */
type LooseRpc = (
  fn: string,
  params?: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: { readonly message?: string | null } | null }>;

function looseRpc(client: BrowserSupabaseClient): LooseRpc {
  return client.rpc.bind(client) as unknown as LooseRpc;
}

/** sessionStorage key holding the first campaign slug that referred this visit. */
export const FW_REFERRAL_KEY = 'fw_referral';

/** sessionStorage key marking a referral slug already claimed this session. */
export const FW_REFERRAL_CLAIMED_KEY = 'fw_referral_claimed';

// Campaign slugs are lowercase letters, digits, and single hyphens. This is a
// light guard only; the RPC is the final authority on whether a slug exists.
const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

// Deliberately permissive: the server validates format and rejects on failure.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// signup_source must be a short slug (mirrors join_waitlist's server check). The
// value derives from an arbitrary `?src`, so we drop anything malformed to null
// rather than let a junk channel tag block an otherwise valid signup.
const SOURCE_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export function isValidReferralSlug(slug: string | null | undefined): slug is string {
  return typeof slug === 'string' && SLUG_PATTERN.test(slug);
}

export function isLikelyEmail(email: string): boolean {
  return EMAIL_PATTERN.test(email.trim());
}

function sessionStore(store?: Storage): Storage | null {
  if (store !== undefined) {
    return store;
  }
  return typeof window === 'undefined' ? null : window.sessionStorage;
}

/**
 * First-touch attribution: records the referring campaign slug once and never
 * overwrites it, so the first pitch that sent the visitor keeps the credit even
 * as they browse other pitches. Invalid slugs and absent storage are no-ops.
 */
export function storeReferral(slug: string | null | undefined, store?: Storage): void {
  if (!isValidReferralSlug(slug)) {
    return;
  }
  const target = sessionStore(store);
  if (target === null) {
    return;
  }
  try {
    if (target.getItem(FW_REFERRAL_KEY) !== null) {
      return;
    }
    target.setItem(FW_REFERRAL_KEY, slug);
  } catch {
    // Storage can throw in private-mode browsers; attribution is best-effort.
  }
}

export function readStoredReferral(store?: Storage): string | null {
  const target = sessionStore(store);
  if (target === null) {
    return null;
  }
  try {
    const value = target.getItem(FW_REFERRAL_KEY);
    return isValidReferralSlug(value) ? value : null;
  } catch {
    return null;
  }
}

export type WaitlistResult =
  | { readonly status: 'joined' }
  | { readonly status: 'invalid_email' }
  | { readonly status: 'rate_limited' }
  | { readonly status: 'error' };

export type WaitlistOptions = {
  readonly referralSlug?: string | null;
  readonly source?: string | null;
};

/**
 * Submits an email to the waitlist. Duplicate emails are a server-side no-op and
 * still resolve to `joined` — from the visitor's point of view they are on the
 * list either way. The email is never logged or placed in analytics (PII).
 */
export async function submitWaitlist(
  client: BrowserSupabaseClient | null,
  email: string,
  options: WaitlistOptions = {},
): Promise<WaitlistResult> {
  const trimmed = email.trim();
  if (!isLikelyEmail(trimmed)) {
    return { status: 'invalid_email' };
  }
  if (client === null) {
    return { status: 'error' };
  }

  const referralSlug = isValidReferralSlug(options.referralSlug) ? options.referralSlug : null;
  const source =
    typeof options.source === 'string' && SOURCE_PATTERN.test(options.source)
      ? options.source
      : null;

  const { error } = await looseRpc(client)('join_waitlist', {
    signup_email: trimmed,
    source_campaign_slug: referralSlug,
    signup_source: source,
  });

  if (error === null) {
    return { status: 'joined' };
  }

  const message = (error.message ?? '').toLowerCase();
  if (message.includes('rate') || message.includes('too many') || message.includes('cap')) {
    return { status: 'rate_limited' };
  }
  if (message.includes('email') || message.includes('format') || message.includes('invalid')) {
    return { status: 'invalid_email' };
  }
  return { status: 'error' };
}

/**
 * Claims a referral for the signed-in user. Idempotent and self-campaign-safe on
 * the server (first source wins, re-calls and own-slug are no-ops), so this is
 * fire-and-forget: attribution must never break the page it rides on.
 */
export async function claimReferral(
  client: BrowserSupabaseClient | null,
  slug: string | null | undefined,
): Promise<void> {
  if (client === null || !isValidReferralSlug(slug)) {
    return;
  }
  try {
    await looseRpc(client)('claim_referral', { source_campaign_slug: slug });
  } catch {
    // Swallow: a failed attribution attempt must never surface to the visitor.
  }
}
