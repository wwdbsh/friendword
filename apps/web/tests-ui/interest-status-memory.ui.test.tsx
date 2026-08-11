// INTEREST STATUS MEMORY — T006 / Issue #43 (FUN-5, FUN-4).
//
// FUN-5: `promote_interest_intent` DELETES the intent row when the interest is
// delivered (0053), and the S1 stage check read only that table. A sender who
// came back to /p/[slug]/interest was therefore shown "Step 1 of 2" again and
// walked the entire profile form — re-uploading photos, re-consenting — before
// the RPC refused them at the last call ('this interest was already answered')
// when the dater had answered. These tests mount the flow with an EMPTY intent
// (exactly the post-promotion state) and a sent interest, so the pre-T006
// structure fails them at the first assertion.
//
// FUN-4: the web had no screen for a sent-but-undecided or a declined
// interest. /interests is asserted here for each status, including that both
// surfaces state the SAME sentence for the same row — two hand-written
// variants can only agree by accident, and only one of them can be true.
/* global afterEach, beforeEach, describe, expect, it */

import { act, cleanup, render, screen } from '@testing-library/react';
import { vi } from 'vitest';

const CAMPAIGN_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_CAMPAIGN_ID = '11111111-1111-4111-8111-999999999999';

type InterestRow = {
  readonly interestId: string;
  readonly interestStatus: string;
  readonly submittedAt: string | null;
  readonly decidedAt: string | null;
  readonly campaignId: string;
  readonly campaignSlug: string | null;
  readonly campaignStatus: string;
  readonly daterDisplayName: string | null;
  readonly campaignHeadline: string | null;
};

const harness = vi.hoisted(() => ({
  interests: [] as unknown[],
  listCalls: 0,
  listFails: false,
  intent: null as unknown,
  signedIn: true,
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
  class InterestIntentRepo {
    getMyIntent(): Promise<unknown> {
      return Promise.resolve(harness.intent);
    }
  }
  class InterestRepo {
    listMyInterests(): Promise<readonly unknown[]> {
      harness.listCalls += 1;
      return harness.listFails
        ? Promise.reject(new Error('list_my_interests is unavailable'))
        : Promise.resolve(harness.interests);
    }
    getMyDatingProfile(): Promise<null> {
      return Promise.resolve(null);
    }
  }
  return {
    DataLayerError,
    InterestIntentRepo,
    InterestRepo,
    ensureUserRow: () => Promise.resolve(),
    trackEvent: () => {},
    confirmDisplayName: () => Promise.resolve(),
    getDisplayNameStatus: () => Promise.resolve({ displayName: '', confirmed: false }),
    signInWithOtp: () => Promise.resolve(),
    verifyOtp: () => Promise.resolve(),
  };
});

const FAKE_SESSION = {
  user: { id: '99999999-9999-4999-8999-999999999999' },
} as const;

vi.mock('@/lib/useSession', () => ({
  useSession: () =>
    harness.signedIn
      ? { session: FAKE_SESSION, loading: false }
      : { session: null, loading: false },
}));

vi.mock('@/lib/supabaseClient', () => ({
  getSupabaseBrowserClient: () => ({
    auth: {
      getSession: () => Promise.resolve({ data: { session: FAKE_SESSION }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
  }),
}));

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children?: unknown;
    [key: string]: unknown;
  }) => (
    <a href={href} {...rest}>
      {children as never}
    </a>
  ),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  useSearchParams: () => new URLSearchParams(''),
}));

import { MyInterestsView } from '../app/interests/MyInterestsView';
import { InterestFlow } from '../app/p/[campaignSlug]/interest/InterestFlow';
import { senderStatusBody, senderStatusLabel } from '../src/lib/interestStatusCopy';

function interestRow(overrides: Partial<InterestRow> = {}): InterestRow {
  return {
    interestId: '40000000-0000-4000-8000-000000000001',
    interestStatus: 'submitted',
    submittedAt: '2026-08-01T10:00:00.000Z',
    decidedAt: null,
    campaignId: CAMPAIGN_ID,
    campaignSlug: 'blair-mix123',
    campaignStatus: 'published',
    daterDisplayName: 'Blair',
    campaignHeadline: 'Blair actually reads the plaques',
    ...overrides,
  };
}

/** Mounts the interest flow and lets both S1 reads settle. */
async function mountFlow(): Promise<void> {
  render(<InterestFlow campaignId={CAMPAIGN_ID} campaignSlug="blair-mix123" daterName="Blair" />);
  await act(async () => {});
  await act(async () => {});
}

async function mountMyInterests(): Promise<void> {
  render(<MyInterestsView />);
  await act(async () => {});
  await act(async () => {});
}

function anchorHrefs(): readonly string[] {
  return Array.from(document.querySelectorAll('a')).map(
    (anchor) => anchor.getAttribute('href') ?? '',
  );
}

beforeEach(() => {
  harness.interests = [];
  harness.listCalls = 0;
  harness.listFails = false;
  // The post-promotion truth: the intent row is gone once the interest landed.
  harness.intent = null;
  harness.signedIn = true;
  window.sessionStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe('a returning sender is not walked through the form again (FUN-5)', () => {
  it('states a sent interest instead of offering step 1 of 2', async () => {
    harness.interests = [interestRow()];

    await mountFlow();

    expect(screen.getByText('Your interest is already with Blair.')).toBeTruthy();
    expect(screen.getByText(senderStatusBody('submitted'))).toBeTruthy();
    // The three doors into the dead-end form, all shut.
    expect(screen.queryByText('Save my interest')).toBeNull();
    expect(screen.queryByText('Complete my profile')).toBeNull();
    expect(screen.queryByLabelText('Short bio')).toBeNull();
  });

  it('links an accepted interest to the room it actually opened', async () => {
    harness.interests = [
      interestRow({ interestStatus: 'accepted', decidedAt: '2026-08-02T09:00:00.000Z' }),
    ];

    await mountFlow();

    expect(screen.getByText('Blair accepted your interest.')).toBeTruthy();
    expect(anchorHrefs()).toContain('/rooms');
    expect(screen.queryByText('Save my interest')).toBeNull();
  });

  it('states a declined interest as answered, with no way back into the form', async () => {
    harness.interests = [
      interestRow({ interestStatus: 'declined', decidedAt: '2026-08-02T09:00:00.000Z' }),
    ];

    await mountFlow();

    expect(screen.getByText('Blair decided not to continue.')).toBeTruthy();
    expect(screen.getByText(senderStatusBody('declined'))).toBeTruthy();
    expect(screen.queryByText('Save my interest')).toBeNull();
    // /rooms is the accepted-only destination: an answered-no interest opened
    // no room, and linking one would invite the sender to look for it.
    expect(anchorHrefs()).not.toContain('/rooms');
  });

  it('offers both the pitch and the full list as the way on', async () => {
    harness.interests = [interestRow()];

    await mountFlow();

    const hrefs = anchorHrefs();
    expect(hrefs).toContain('/p/blair-mix123');
    expect(hrefs).toContain('/interests');
  });

  it('keeps the staged flow for an interest that never reached the dater', async () => {
    // 'started', 'verification_pending' and 'withdrawn' are exactly the rows
    // submit_interest still accepts — blocking them would strand a sender who
    // has nothing in the dater's inbox.
    for (const status of ['started', 'verification_pending', 'withdrawn'] as const) {
      cleanup();
      harness.interests = [interestRow({ interestStatus: status, submittedAt: null })];

      await mountFlow();

      expect(screen.getByText('Save my interest')).toBeTruthy();
    }
  });

  it('ignores an interest sent to a different campaign', async () => {
    harness.interests = [interestRow({ campaignId: OTHER_CAMPAIGN_ID })];

    await mountFlow();

    expect(screen.getByText('Save my interest')).toBeTruthy();
  });

  it('falls back to the staged flow when the status read fails', async () => {
    // A failing read must not invent a state. The pre-T006 behaviour is the
    // honest degradation: the flow runs and the RPC states its own refusal.
    harness.listFails = true;
    harness.intent = { intentId: '22222222-2222-4222-8222-222222222222', createdAt: null };

    await mountFlow();

    expect(harness.listCalls).toBe(1);
    expect(screen.getByText('Saved — not delivered to Blair yet.')).toBeTruthy();
  });
});

describe('/interests is the sender-side screen the web was missing (FUN-4)', () => {
  it('renders every status with the same sentence the flow card uses', async () => {
    harness.interests = [
      interestRow({ interestId: '40000000-0000-4000-8000-00000000000a' }),
      interestRow({
        interestId: '40000000-0000-4000-8000-00000000000b',
        interestStatus: 'accepted',
        daterDisplayName: 'Sam',
        campaignSlug: 'sam-mix456',
      }),
      interestRow({
        interestId: '40000000-0000-4000-8000-00000000000c',
        interestStatus: 'declined',
        daterDisplayName: 'Rae',
        campaignSlug: 'rae-mix789',
      }),
    ];

    await mountMyInterests();

    expect(screen.getByText('Interest you sent.')).toBeTruthy();
    for (const status of ['submitted', 'accepted', 'declined'] as const) {
      expect(screen.getByText(senderStatusBody(status))).toBeTruthy();
      expect(screen.getAllByText(senderStatusLabel(status)).length).toBeGreaterThan(0);
    }
    expect(screen.getByText('Blair')).toBeTruthy();
    expect(screen.getByText('Sam')).toBeTruthy();
    expect(screen.getByText('Rae')).toBeTruthy();
    expect(screen.getAllByText('Sent Aug 1, 2026')).toHaveLength(3);
  });

  it('links an accepted row to the rooms list and each live campaign to its pitch', async () => {
    harness.interests = [interestRow({ interestStatus: 'accepted', campaignSlug: 'sam-mix456' })];

    await mountMyInterests();

    const hrefs = anchorHrefs();
    expect(hrefs).toContain('/rooms');
    expect(hrefs).toContain('/p/sam-mix456');
  });

  it('does not link a pitch page that is no longer public', async () => {
    // /p/[slug] 404s for a paused, expired or archived campaign: a link there
    // would be an offer the URL cannot keep.
    harness.interests = [interestRow({ campaignStatus: 'expired' })];

    await mountMyInterests();

    expect(anchorHrefs()).not.toContain('/p/blair-mix123');
    expect(
      screen.getByText('This campaign’s window has ended, so its public page is closed.'),
    ).toBeTruthy();
  });

  it('separates "nothing sent" from "could not read what you sent"', async () => {
    harness.interests = [];
    await mountMyInterests();
    expect(screen.getByText('You haven’t sent any interest yet.')).toBeTruthy();
    expect(anchorHrefs()).toContain('/p/demo-blair');

    cleanup();
    harness.listFails = true;
    await mountMyInterests();
    expect(screen.getByText('We hit a snag.')).toBeTruthy();
    expect(screen.queryByText('You haven’t sent any interest yet.')).toBeNull();
  });

  it('asks a signed-out visitor to sign in rather than showing an empty list', async () => {
    harness.signedIn = false;

    await mountMyInterests();

    expect(screen.getByText('The interest you sent lives here.')).toBeTruthy();
    expect(screen.queryByText('You haven’t sent any interest yet.')).toBeNull();
    expect(harness.listCalls).toBe(0);
  });

  it('carries the account tabs, including its own', async () => {
    await mountMyInterests();

    const hrefs = anchorHrefs();
    expect(hrefs).toContain('/');
    expect(hrefs).toContain('/inbox');
    expect(hrefs).toContain('/rooms');
    const own = screen
      .getAllByRole('link')
      .find((link) => link.getAttribute('href') === '/interests');
    expect(own?.getAttribute('aria-current')).toBe('page');
  });
});

// §12: the copy may state what the row proves and nothing else. A promise of a
// reply, a review, or any elapsed-time expectation is what this project has
// repeatedly had to strip back out of shipped screens.
describe('sender status copy promises nothing the code cannot keep', () => {
  const STATUSES = [
    'started',
    'verification_pending',
    'submitted',
    'accepted',
    'declined',
    'withdrawn',
  ] as const;

  const FORBIDDEN =
    /\b(soon|shortly|usually|typically|within|awaiting a reply|will (reply|respond|review|get back|hear)|guaranteed|check back|in a few|business day|\d+\s*(hour|day|week)s?)\b/i;

  it('states no timeline and no promised answer', () => {
    for (const status of STATUSES) {
      expect(senderStatusBody(status)).not.toMatch(FORBIDDEN);
      expect(senderStatusLabel(status)).not.toMatch(FORBIDDEN);
    }
  });

  it('says outright that a reply is not promised while an interest waits', () => {
    expect(senderStatusBody('submitted')).toContain('a reply is not promised');
    expect(senderStatusBody('submitted')).toContain('there is no timeline');
  });

  it('never attributes a reason to a dater who declined', () => {
    expect(senderStatusBody('declined')).toContain('No reason was shared with you');
    expect(senderStatusBody('declined')).not.toMatch(/because|reason (was|is) that/i);
  });
});
