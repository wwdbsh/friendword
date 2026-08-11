// VIRAL-LOOP REGRESSION — S1 restore (correction F1).
// The stage-S1 check effect must not cancel itself: guarding the run-once with
// a STATE flag that is both in the dependency array and set synchronously
// inside the effect re-fires the effect, and the re-fire's cleanup sets
// `cancelled = true` while the intent lookup is still in flight — the resolved
// stage is then discarded and a returning visitor with a saved intent is stuck
// on the 'checking' card forever. These tests resolve the lookup only AFTER the
// mount has fully flushed, so any structure whose cleanup ran during that flush
// (i.e. the reverted state-guard structure) fails them.
/* global describe, expect, it */

import { act, render, screen } from '@testing-library/react';
import { vi } from 'vitest';

import { InterestFlow } from '../app/p/[campaignSlug]/interest/InterestFlow';

type IntentRow = { intentId: string; createdAt: string | null };

const harness = vi.hoisted(() => {
  const state = {
    getMyIntentCalls: 0,
    resolvers: [] as ((row: IntentRow | null) => void)[],
    trackedEvents: [] as string[],
  };
  return state;
});

vi.mock('@friendword/data', () => {
  class DataLayerError extends Error {
    constructor(
      scope: string,
      public override readonly cause: unknown,
    ) {
      super(scope);
    }
  }
  class InterestIntentRepo {
    getMyIntent(): Promise<IntentRow | null> {
      harness.getMyIntentCalls += 1;
      return new Promise((resolve) => {
        harness.resolvers.push(resolve);
      });
    }
  }
  // T006 added a second S1 read. It resolves empty here so these tests keep
  // asserting the INTENT branch: with a sent interest in the list the flow
  // would (correctly) render the delivered card instead of either stage.
  class InterestRepo {
    listMyInterests(): Promise<readonly unknown[]> {
      return Promise.resolve([]);
    }
  }
  return {
    DataLayerError,
    InterestIntentRepo,
    InterestRepo,
    ensureUserRow: () => Promise.resolve(),
    trackEvent: (_client: unknown, eventName: string) => {
      harness.trackedEvents.push(eventName);
    },
    confirmDisplayName: () => Promise.resolve(),
    getDisplayNameStatus: () => Promise.resolve({ displayName: '', confirmed: false }),
  };
});

const FAKE_SESSION = {
  user: { id: '99999999-9999-4999-8999-999999999999' },
} as const;

vi.mock('@/lib/useSession', () => ({
  useSession: () => ({ session: FAKE_SESSION, loading: false }),
}));

vi.mock('@/lib/supabaseClient', () => ({
  getSupabaseBrowserClient: () => ({
    auth: {
      getSession: () => Promise.resolve({ data: { session: FAKE_SESSION }, error: null }),
    },
  }),
}));

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children?: unknown }) => (
    <a href={href}>{children as never}</a>
  ),
}));

const CAMPAIGN_ID = '11111111-1111-4111-8111-111111111111';

function mountFlow() {
  return render(
    <InterestFlow campaignId={CAMPAIGN_ID} campaignSlug="demo-blair" daterName="Blair" />,
  );
}

/** Resolves the (single) pending intent lookup AFTER the mount has settled. */
async function settleIntentLookup(row: IntentRow | null): Promise<void> {
  // Flush the mount, every passive effect, and any effect-triggered re-render
  // (in the broken structure this is exactly where the cleanup cancels the
  // in-flight lookup) BEFORE the lookup resolves.
  await act(async () => {});
  expect(harness.resolvers.length).toBe(1);
  await act(async () => {
    harness.resolvers.at(0)?.(row);
  });
}

describe('interest flow — S1 stage check survives its own re-render (F1)', () => {
  beforeEach(() => {
    harness.getMyIntentCalls = 0;
    harness.resolvers = [];
    harness.trackedEvents = [];
    window.sessionStorage.clear();
  });

  it('restores the saved-intent card for a visitor whose intent is already stored', async () => {
    mountFlow();
    await settleIntentLookup({ intentId: '22222222-2222-4222-8222-222222222222', createdAt: null });

    expect(screen.getByText('Saved — not delivered to Blair yet.')).toBeTruthy();
    // The lookup ran exactly once — a re-fired effect would either re-query or
    // (guarded) silently drop the first result.
    expect(harness.getMyIntentCalls).toBe(1);
  });

  it('shows the save offer for a visitor with no stored intent', async () => {
    mountFlow();
    await settleIntentLookup(null);

    expect(screen.getByText('Save my interest')).toBeTruthy();
    expect(harness.getMyIntentCalls).toBe(1);
  });

  it('reports interest_started exactly once per mount', async () => {
    mountFlow();
    await settleIntentLookup(null);

    expect(harness.trackedEvents.filter((name) => name === 'interest_started')).toHaveLength(1);
  });
});
