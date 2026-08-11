// ACCOUNT HUB — T009 / Issue #46 (ACC-6).
// Interest received, interest sent, intro rooms and the campaigns about a
// person lived on three web routes and two mobile screens, and nothing in the
// product said what a person actually had. These tests pin the hub's two jobs:
// the four areas are all reachable from it, and every number it prints is a
// number it actually read — an unreadable area must never render as zero.
/* global afterEach, beforeEach, describe, expect, it */

import { cleanup, render, screen } from '@testing-library/react';
import { vi } from 'vitest';

const CAMPAIGN_ID = '20000000-0000-4000-8000-000000000001';

const FAKE_SESSION = {
  user: { id: '00000000-0000-4000-8000-000000000002' },
} as const;

type Behaviour = {
  ownedCampaigns: () => Promise<
    readonly { id: string; slug: string | null; status: string; endsAt: string | null }[]
  >;
  campaignInterests: () => Promise<readonly { interestStatus: string }[]>;
  myInterests: () => Promise<readonly unknown[]>;
  myRooms: () => Promise<readonly unknown[]>;
};

const behaviour: Behaviour = {
  ownedCampaigns: () => Promise.resolve([]),
  campaignInterests: () => Promise.resolve([]),
  myInterests: () => Promise.resolve([]),
  myRooms: () => Promise.resolve([]),
};

vi.mock('@friendword/data', () => {
  class DataLayerError extends Error {}
  class InterestRepo {
    listMyOwnedCampaigns() {
      return behaviour.ownedCampaigns();
    }
    listCampaignInterests() {
      return behaviour.campaignInterests();
    }
    listMyInterests() {
      return behaviour.myInterests();
    }
  }
  class IntroRoomRepo {
    listMyRooms() {
      return behaviour.myRooms();
    }
  }
  return {
    DataLayerError,
    InterestRepo,
    IntroRoomRepo,
    signInWithOtp: () => Promise.resolve(),
    trackEvent: () => {},
    verifyOtp: () => Promise.resolve(),
  };
});

vi.mock('@/lib/useSession', () => ({
  useSession: () => ({ session: FAKE_SESSION, loading: false, ended: false }),
}));

vi.mock('@/lib/supabaseClient', () => ({
  getSupabaseBrowserClient: () => ({
    auth: {
      getSession: () => Promise.resolve({ data: { session: FAKE_SESSION }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      signOut: () => Promise.resolve({ error: null }),
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

import { MyPageView, roomsCopy, sentCopy, waitingCopy } from '../app/me/MyPageView';

const LIVE_CAMPAIGN = {
  id: CAMPAIGN_ID,
  slug: 'blair-mix123',
  status: 'published',
  endsAt: null,
};

/** Lets the four reads and their `setState` settle before asserting. */
async function settle(): Promise<void> {
  for (let tick = 0; tick < 6; tick += 1) {
    await Promise.resolve();
  }
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function hrefs(): readonly string[] {
  return Array.from(document.querySelectorAll('a')).map((a) => a.getAttribute('href') ?? '');
}

beforeEach(() => {
  behaviour.ownedCampaigns = () => Promise.resolve([]);
  behaviour.campaignInterests = () => Promise.resolve([]);
  behaviour.myInterests = () => Promise.resolve([]);
  behaviour.myRooms = () => Promise.resolve([]);
});

afterEach(() => {
  cleanup();
});

describe('the account hub', () => {
  it('reaches all four areas, the account controls and home from one screen', async () => {
    behaviour.ownedCampaigns = () => Promise.resolve([LIVE_CAMPAIGN]);
    render(<MyPageView />);
    await settle();

    const links = hrefs();
    expect(links).toContain('/inbox');
    expect(links).toContain('/interests');
    expect(links).toContain('/rooms');
    expect(links).toContain('/inbox#account');
    expect(links).toContain('/');
  });

  it('marks itself as the current page in the shell', async () => {
    render(<MyPageView />);
    await settle();

    const current = screen
      .getAllByRole('link')
      .find((link) => link.getAttribute('aria-current') === 'page');
    expect(current?.getAttribute('href')).toBe('/me');
  });

  it('counts what each area holds', async () => {
    behaviour.ownedCampaigns = () => Promise.resolve([LIVE_CAMPAIGN]);
    behaviour.campaignInterests = () =>
      Promise.resolve([
        { interestStatus: 'submitted' },
        { interestStatus: 'submitted' },
        { interestStatus: 'declined' },
      ]);
    behaviour.myInterests = () => Promise.resolve([{}, {}, {}]);
    behaviour.myRooms = () => Promise.resolve([{}]);

    render(<MyPageView />);
    await settle();

    expect(screen.getByText('2 people are waiting for your answer.')).toBeTruthy();
    expect(screen.getByText('3 interests sent.')).toBeTruthy();
    expect(screen.getByText('1 intro room is open.')).toBeTruthy();
    // The campaign line reads its status the way the inbox does, not the raw row.
    expect(screen.getByText('Live')).toBeTruthy();
    expect(screen.getByText('· /p/blair-mix123')).toBeTruthy();
  });

  // An unreadable area is a different claim from an empty one. Rendering "0"
  // for a failed read tells a dater nobody is waiting when someone is.
  it('states an unreadable area instead of printing zero', async () => {
    behaviour.ownedCampaigns = () => Promise.resolve([LIVE_CAMPAIGN]);
    behaviour.campaignInterests = () => Promise.reject(new Error('unavailable'));
    behaviour.myInterests = () => Promise.reject(new Error('unavailable'));
    behaviour.myRooms = () => Promise.reject(new Error('unavailable'));

    render(<MyPageView />);
    await settle();

    expect(
      screen.getByText('The people waiting could not be counted. Your inbox has the real list.'),
    ).toBeTruthy();
    expect(screen.getByText('The interest you sent could not be counted.')).toBeTruthy();
    expect(screen.getByText('Your intro rooms could not be counted.')).toBeTruthy();
    expect(screen.queryByText('Nobody is waiting on your answer right now.')).toBeNull();
    // Every door still opens: a failed count must not remove the way in.
    expect(hrefs()).toContain('/inbox');
  });

  it('keeps the other three areas true when the campaign read fails', async () => {
    behaviour.ownedCampaigns = () => Promise.reject(new Error('unavailable'));
    behaviour.myInterests = () => Promise.resolve([{}]);
    behaviour.myRooms = () => Promise.resolve([]);

    render(<MyPageView />);
    await settle();

    expect(screen.getByText(/Your campaigns could not be read/)).toBeTruthy();
    expect(screen.getByText('1 interest sent.')).toBeTruthy();
    expect(screen.getByText('No rooms yet.')).toBeTruthy();
  });

  it('says an ended campaign has ended, whatever the row still says', async () => {
    behaviour.ownedCampaigns = () =>
      Promise.resolve([{ ...LIVE_CAMPAIGN, endsAt: '2020-01-01T00:00:00Z' }]);
    behaviour.campaignInterests = () => Promise.resolve([{ interestStatus: 'submitted' }]);

    render(<MyPageView />);
    await settle();

    expect(screen.getByText('Ended')).toBeTruthy();
    // §12: `decide_interest` refuses an accept outside the live window, so the
    // hub must not tell this person someone is waiting for an answer they
    // cannot give.
    expect(
      screen.getByText('1 person is waiting, but no page of yours is live right now.'),
    ).toBeTruthy();
  });
});

describe('hub copy boundaries', () => {
  it('never turns an unknown count into a number', () => {
    expect(waitingCopy(null, true)).not.toMatch(/\d/);
    expect(sentCopy(null)).not.toMatch(/\d/);
    expect(roomsCopy(null)).not.toMatch(/\d/);
  });

  it('speaks of one person and several people correctly', () => {
    expect(waitingCopy(1, true)).toBe('1 person is waiting for your answer.');
    expect(waitingCopy(4, true)).toBe('4 people are waiting for your answer.');
    expect(sentCopy(1)).toBe('1 interest sent.');
    expect(roomsCopy(2)).toBe('2 intro rooms are open.');
  });
});
