'use client';

import { useEffect, useRef } from 'react';

import { trackEvent, type BrowserSupabaseClient } from '@friendword/data';

import { getSupabaseBrowserClient } from '@/lib/supabaseClient';
import { useSession } from '@/lib/useSession';
import {
  claimReferral,
  FW_REFERRAL_CLAIMED_KEY,
  normalizeChannel,
  readStoredReferral,
  storeReferral,
} from '@/lib/waitlist';

/** sessionStorage key prefix deduplicating reel_visit per campaign per tab. */
const FW_REEL_VISIT_KEY_PREFIX = 'fw_reel_visit_';

type ReferralTrackerProps = {
  /**
   * On a public pitch page, the page seeds its own campaign slug so a later hop
   * to the landing waitlist inherits the attribution. On the landing page this
   * is omitted and the `?ref` query param is used instead.
   */
  readonly seedSlug?: string;
  /**
   * Whether landing on this page counts as a funnel entry (`reel_visit`).
   * Deeper pages (e.g. the interest flow, where sign-in returns the visitor)
   * seed attribution but are not entries, so they pass false to keep the
   * funnel-entry metric honest. Only meaningful with a seedSlug; defaults on.
   */
  readonly recordVisit?: boolean;
};

/**
 * Preserves referral attribution across the funnel (Slice 5, H-8):
 *  - stores the first referring slug (`?ref` or the pitch's own slug) and the
 *    acquisition channel (`?ch`) once, first-touch, in localStorage,
 *  - records the funnel-entry `reel_visit` event on campaign pages so visits
 *    that never convert are still measurable, and
 *  - claims the stored referral (with its channel) the moment a signed-in
 *    session is available.
 * Renders nothing.
 */
export function ReferralTracker({ seedSlug, recordVisit = true }: ReferralTrackerProps) {
  const clientRef = useRef<BrowserSupabaseClient | null | undefined>(undefined);
  if (clientRef.current === undefined) {
    clientRef.current = getSupabaseBrowserClient();
  }
  const client = clientRef.current;
  const { session } = useSession(client);

  useEffect(() => {
    const search = new URLSearchParams(window.location.search);
    const urlRef = search.get('ref');
    const channel = normalizeChannel(search.get('ch'));
    storeReferral(urlRef ?? seedSlug ?? null, channel);

    if (seedSlug === undefined || !recordVisit) {
      return;
    }
    // Funnel entry (reel_visit): once per campaign per tab, anonymous by
    // design — the whole point is counting visitors who never sign in. The
    // server-side allowlist accepts this name from anonymous callers as of
    // migration 0057; the dedupe below is a client courtesy, not a guarantee.
    try {
      const visitKey = `${FW_REEL_VISIT_KEY_PREFIX}${seedSlug}`;
      if (window.sessionStorage.getItem(visitKey) !== null) {
        return;
      }
      window.sessionStorage.setItem(visitKey, '1');
    } catch {
      // Private-mode storage failure: fall through and record the visit anyway.
    }
    trackEvent(client, 'reel_visit', {
      campaign_slug: seedSlug,
      channel: channel ?? readStoredReferral()?.channel ?? null,
    });
  }, [seedSlug, recordVisit, client]);

  useEffect(() => {
    if (session === null) {
      return;
    }
    const stored = readStoredReferral();
    if (stored === null) {
      return;
    }
    // Claim at most once per session per slug; the RPC is a no-op on re-call
    // anyway, but this avoids redundant network chatter on auth changes.
    if (window.sessionStorage.getItem(FW_REFERRAL_CLAIMED_KEY) === stored.slug) {
      return;
    }
    window.sessionStorage.setItem(FW_REFERRAL_CLAIMED_KEY, stored.slug);
    void claimReferral(client, stored.slug, stored.channel);
  }, [session, client]);

  return null;
}
