// GLOBAL NAVIGATION REGRESSION — T004 / Issue #41 (FUN-1, ACC-1, WUI-6).
// Before this suite the signed-in web surfaces rendered the wordmark as plain
// text and carried no anchor at all: /inbox was linked from nowhere in the
// entire app, and /rooms/[id] and /kit/[id] could only be reached by typing a
// URL. These tests pin the anchors themselves — not their styling — so a
// refactor that drops the shell fails here rather than in production.
/* global afterEach, describe, expect, it */

import { cleanup, render, screen } from '@testing-library/react';
import { vi } from 'vitest';

const ROOM_ID = '60000000-0000-4000-8000-000000000001';

const FAKE_SESSION = {
  user: { id: '00000000-0000-4000-8000-000000000002' },
} as const;

vi.mock('@friendword/data', () => {
  class DataLayerError extends Error {}
  class CreatorCreditRequiredError extends Error {}
  class KitNotPublishedError extends Error {}
  class BenefitsRepo {
    getCampaignPassState() {
      return Promise.resolve({ active: false, expiresAt: null });
    }
    getCampaignAnalytics() {
      return Promise.resolve([]);
    }
  }
  class InterestRepo {
    listMyOwnedCampaigns() {
      return Promise.resolve([]);
    }
    listCampaignInterests() {
      return Promise.resolve([]);
    }
    createPhotoViewUrl() {
      return Promise.resolve(null);
    }
  }
  class SafetyRepo {}
  class IntroRoomRepo {
    listMyRooms() {
      return Promise.resolve([
        {
          roomId: ROOM_ID,
          campaignId: '20000000-0000-4000-8000-000000000001',
          campaignSlug: 'blair-mix123',
          otherUserId: '00000000-0000-4000-8000-000000000003',
          otherDisplayName: 'Jordan',
          createdAt: '2026-07-29T00:00:00Z',
        },
      ]);
    }
    listMessages() {
      return Promise.resolve([]);
    }
  }
  class PitchDraftRepo {
    getDraft() {
      // Any load outcome renders the shell; the failure path is the cheapest
      // to reach without standing up a whole PostgREST double.
      return Promise.reject(new Error('kit load is not under test'));
    }
  }
  class RenderJobRepo {
    getState() {
      return Promise.reject(new Error('render state is not under test'));
    }
  }
  return {
    BenefitsRepo,
    CreatorCreditRequiredError,
    DataLayerError,
    InterestRepo,
    IntroRoomRepo,
    KitNotPublishedError,
    PitchDraftRepo,
    RenderJobRepo,
    SafetyRepo,
    signInWithOtp: () => Promise.resolve(),
    trackEvent: () => {},
    verifyOtp: () => Promise.resolve(),
  };
});

vi.mock('@/lib/useSession', () => ({
  useSession: () => ({ session: FAKE_SESSION, loading: false }),
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

import { InboxView } from '../app/inbox/InboxView';
import { KitView } from '../app/kit/[draftId]/KitView';
import { RoomView } from '../app/rooms/[roomId]/RoomView';
import { RoomsList } from '../app/rooms/RoomsList';

/** Every anchor href currently on the screen. */
function anchorHrefs(): readonly string[] {
  return Array.from(document.querySelectorAll('a')).map(
    (anchor) => anchor.getAttribute('href') ?? '',
  );
}

afterEach(() => {
  cleanup();
});

/** The dater's own account surfaces — the two tabs belong to all of them. */
const DATER_SURFACES: readonly { readonly name: string; readonly mount: () => void }[] = [
  {
    name: 'inbox',
    mount: () => {
      render(<InboxView />);
    },
  },
  {
    name: 'rooms',
    mount: () => {
      render(<RoomsList />);
    },
  },
  {
    name: 'room',
    mount: () => {
      render(<RoomView roomId={ROOM_ID} />);
    },
  },
];

describe('every signed-in surface offers a way out', () => {
  // T009: the three sibling tabs became one hub link — four areas could not
  // share a 327px row, and the mobile app has a hub rather than a tab bar. What
  // every signed-in surface must still carry is home plus the account door.
  for (const surface of DATER_SURFACES) {
    it(`${surface.name} links home and to the account hub`, () => {
      surface.mount();

      const hrefs = anchorHrefs();
      expect(hrefs).toContain('/');
      expect(hrefs).toContain('/me');
    });
  }

  // The kit belongs to the introducer, who is not the dater: the areas behind
  // the hub are screens that are empty for them by definition. The way out is
  // the wordmark, and the pitch when the slug is known.
  it('offers the kit a way home without the dater-only account door', () => {
    render(<KitView draftId="33333333-3333-4333-8333-333333333333" />);

    const hrefs = anchorHrefs();
    expect(hrefs).toContain('/');
    expect(hrefs).not.toContain('/me');
    expect(hrefs).not.toContain('/inbox');
    expect(hrefs).not.toContain('/rooms');
  });

  it('names the home link for screen readers', () => {
    render(<RoomsList />);

    expect(screen.getByLabelText('Friendword home').getAttribute('href')).toBe('/');
  });

  // The hub pill is a destination on an area screen, not a claim about where
  // the person is: only the hub itself is `aria-current`.
  it('marks no shell link as the current page on an area screen', () => {
    render(<InboxView />);

    expect(
      screen.getAllByRole('link').find((link) => link.getAttribute('aria-current') === 'page'),
    ).toBeUndefined();
  });

  it('gives a single room an explicit return to the room list', () => {
    render(<RoomView roomId={ROOM_ID} />);

    // Not `aria-current`: this screen is one room, not the list. The explicit
    // back link is what a person reads as "out of here".
    const back = screen
      .getAllByRole('link')
      .filter((link) => link.getAttribute('href') === '/rooms');
    expect(back.some((link) => (link.textContent ?? '').includes('All my rooms'))).toBe(true);
    expect(
      screen.getAllByRole('link').find((link) => link.getAttribute('aria-current') === 'page'),
    ).toBeUndefined();
  });
});
