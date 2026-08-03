// VIRAL-LOOP REGRESSION — attribution claim coverage (correction F2).
// Sign-in completes on whatever page the emailed link/code returns to — for
// the canonical funnel that is /p/[slug]/interest, where EmailSignIn defaults
// emailRedirectTo to the current URL. ReferralTracker was only mounted on the
// landing and pitch pages, so the canonical reel → pitch → interest → sign-in
// path never called `claim_referral` and attribution was silently lost.
// Pinned here:
//  1. the root layout arms the claim on EVERY page,
//  2. the interest page seeds its campaign slug WITHOUT counting a funnel
//     entry (recordVisit=false), and
//  3. ReferralTracker claims the stored referral once a session exists, and
//     recordVisit=false really suppresses the reel_visit event.
/* global describe, expect, it */

import { act, cleanup, render, screen } from '@testing-library/react';
import { vi } from 'vitest';

const harness = vi.hoisted(() => ({
  rpcCalls: [] as { fn: string; params: Record<string, unknown> | undefined }[],
  trackedEvents: [] as string[],
  session: null as { user: { id: string } } | null,
}));

vi.mock('next/font/google', () => ({
  Unbounded: () => ({ variable: 'font-display' }),
  Bricolage_Grotesque: () => ({ variable: 'font-body' }),
}));

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children?: unknown }) => (
    <a href={href}>{children as never}</a>
  ),
}));

vi.mock('@friendword/data', () => {
  class DataLayerError extends Error {
    constructor(
      scope: string,
      public override readonly cause: unknown,
    ) {
      super(scope);
    }
  }
  // The interest page renders the real (signed-out) InterestFlow around the
  // tracker, so every named export that flow and EmailSignIn import must
  // exist; only trackEvent and getPublishedPitchBySlug carry behavior here.
  return {
    DataLayerError,
    InterestIntentRepo: class {},
    InterestRepo: class {},
    ensureUserRow: () => Promise.resolve(),
    confirmDisplayName: () => Promise.resolve(),
    getDisplayNameStatus: () => Promise.resolve({ displayName: '', confirmed: false }),
    signInWithOtp: () => Promise.resolve(),
    verifyOtp: () => Promise.resolve(null),
    trackEvent: (_client: unknown, eventName: string) => {
      harness.trackedEvents.push(eventName);
    },
    getPublishedPitchBySlug: () =>
      Promise.resolve({
        campaignId: '11111111-1111-4111-8111-111111111111',
        campaignSlug: 'demo-real',
        daterDisplayName: 'Blair',
      }),
  };
});

vi.mock('@/lib/supabaseClient', () => ({
  getSupabaseBrowserClient: () => ({
    rpc: (fn: string, params?: Record<string, unknown>) => {
      harness.rpcCalls.push({ fn, params });
      return Promise.resolve({ data: null, error: null });
    },
  }),
}));

vi.mock('@/lib/useSession', () => ({
  useSession: () => ({ session: harness.session, loading: false }),
}));

vi.mock('@/lib/supabaseServer', () => ({
  getSupabaseServiceClient: () => ({}),
}));

describe('referral claim is armed on every login-return surface (F2)', () => {
  beforeEach(() => {
    harness.rpcCalls = [];
    harness.trackedEvents = [];
    harness.session = null;
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.history.replaceState(null, '', '/');
    cleanup();
  });

  it('the root layout mounts ReferralTracker on every page', async () => {
    // The tracker renders null, so presence is proven by behavior: a stored
    // referral plus a signed-in session must produce a claim_referral call
    // from the layout alone (no page-level tracker in the tree).
    window.localStorage.setItem(
      'fw_referral',
      JSON.stringify({ slug: 'demo-real', ch: 'ig_reel_test', ts: Date.now() }),
    );
    harness.session = { user: { id: '99999999-9999-4999-8999-999999999999' } };

    const { default: RootLayout } = await import('../app/layout');
    render(<RootLayout>{<p>page body</p>}</RootLayout>);
    await act(async () => {});

    expect(harness.rpcCalls).toContainEqual({
      fn: 'claim_referral',
      params: { source_campaign_slug: 'demo-real', channel: 'ig_reel_test' },
    });
  });

  it('the interest page seeds its campaign slug without counting a funnel entry', async () => {
    const { default: InterestPage } = await import('../app/p/[campaignSlug]/interest/page');
    const ui = await InterestPage({
      params: Promise.resolve({ campaignSlug: 'demo-real' }),
    });
    render(ui);
    await act(async () => {});

    // Attribution seeded from the page's own slug (a direct landing on the
    // interest URL still attributes the campaign)…
    const stored = JSON.parse(window.localStorage.getItem('fw_referral') ?? 'null') as {
      slug?: string;
    } | null;
    expect(stored?.slug).toBe('demo-real');
    // …but the interest page is NOT a funnel entry: no reel_visit.
    expect(harness.trackedEvents).not.toContain('reel_visit');
    // The signed-out interest flow itself rendered around the tracker.
    expect(screen.getByText('Want to meet Blair?')).toBeTruthy();
  });

  it('recordVisit=true still reports the funnel entry on pitch pages', async () => {
    const { ReferralTracker } = await import('@/components/ReferralTracker');
    render(<ReferralTracker seedSlug="demo-real" />);
    await act(async () => {});

    expect(harness.trackedEvents).toContain('reel_visit');
  });
});
