'use client';

import { useEffect, useRef } from 'react';

import type { BrowserSupabaseClient } from '@friendword/data';

import { getSupabaseBrowserClient } from '@/lib/supabaseClient';
import { useSession } from '@/lib/useSession';
import {
  claimReferral,
  FW_REFERRAL_CLAIMED_KEY,
  readStoredReferral,
  storeReferral,
} from '@/lib/waitlist';

type ReferralTrackerProps = {
  /**
   * On a public pitch page, the page seeds its own campaign slug so a later hop
   * to the landing waitlist inherits the attribution. On the landing page this
   * is omitted and the `?ref` query param is used instead.
   */
  readonly seedSlug?: string;
};

/**
 * Preserves referral attribution across the funnel (Slice 5, H-8):
 *  - stores the first referring slug (`?ref` or the pitch's own slug) once, and
 *  - claims it for the visitor the moment a signed-in session is available.
 * Renders nothing.
 */
export function ReferralTracker({ seedSlug }: ReferralTrackerProps) {
  const clientRef = useRef<BrowserSupabaseClient | null | undefined>(undefined);
  if (clientRef.current === undefined) {
    clientRef.current = getSupabaseBrowserClient();
  }
  const client = clientRef.current;
  const { session } = useSession(client);

  useEffect(() => {
    const urlRef = new URLSearchParams(window.location.search).get('ref');
    storeReferral(urlRef ?? seedSlug ?? null);
  }, [seedSlug]);

  useEffect(() => {
    if (session === null) {
      return;
    }
    const slug = readStoredReferral();
    if (slug === null) {
      return;
    }
    // Claim at most once per session per slug; the RPC is a no-op on re-call
    // anyway, but this avoids redundant network chatter on auth changes.
    if (window.sessionStorage.getItem(FW_REFERRAL_CLAIMED_KEY) === slug) {
      return;
    }
    window.sessionStorage.setItem(FW_REFERRAL_CLAIMED_KEY, slug);
    void claimReferral(client, slug);
  }, [session, client]);

  return null;
}
