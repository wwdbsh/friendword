// UNIVERSAL SIGN-OUT — T008 / Issue #45.
//
// Before this suite the web product had exactly ONE `auth.signOut()` call, in
// the consent flow's contact-mismatch branch. A person signed in on a shared or
// borrowed browser could open their inbox, their intro rooms and their launch
// kit and had no way whatsoever to leave: the only exit was clearing the
// `friendword-web-auth` key by hand. These tests drive the real `useSession`
// against a session stub, so they pin the behaviour (the session ends, the
// account surface closes, the landing forgets it) and not the markup.
/* global afterEach, beforeEach, describe, expect, it */

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';

const ROOM_ID = '60000000-0000-4000-8000-000000000001';

const FAKE_SESSION = {
  access_token: 'ui-access-token',
  user: { id: '00000000-0000-4000-8000-000000000002' },
} as const;

/**
 * A Supabase auth double with the one property that matters here: signing out
 * notifies the listeners, exactly as supabase-js does. Every component in the
 * tree shares it, because the real `getSupabaseBrowserClient` is a singleton —
 * that sharing is what makes the landing link disappear.
 */
const auth = vi.hoisted(() => {
  const listeners = new Set<(event: string, session: unknown) => void>();
  const state: {
    session: unknown;
    signOutError: { message: string } | null;
    localSignOutError: { message: string } | null;
    scopes: string[];
  } = { session: null, signOutError: null, localSignOutError: null, scopes: [] };

  const emit = (event: string): void => {
    for (const listener of listeners) {
      listener(event, state.session);
    }
  };

  return {
    state,
    listeners,
    emit,
    reset(session: unknown) {
      listeners.clear();
      state.session = session;
      state.signOutError = null;
      state.localSignOutError = null;
      state.scopes = [];
    },
    client: {
      auth: {
        getSession: () => Promise.resolve({ data: { session: state.session }, error: null }),
        onAuthStateChange: (callback: (event: string, session: unknown) => void) => {
          listeners.add(callback);
          return {
            data: { subscription: { unsubscribe: () => listeners.delete(callback) } },
          };
        },
        signOut: (options?: { readonly scope?: string }) => {
          state.scopes.push(options?.scope ?? 'global');
          const error = options?.scope === 'local' ? state.localSignOutError : state.signOutError;
          if (error === null) {
            state.session = null;
            emit('SIGNED_OUT');
          }
          return Promise.resolve({ error });
        },
      },
      from: () => ({
        select: () => ({
          eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }),
        }),
      }),
    },
  };
});

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));

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
    listMyInterests() {
      return Promise.resolve([]);
    }
    createPhotoViewUrl() {
      return Promise.resolve(null);
    }
  }
  class SafetyRepo {}
  class IntroRoomRepo {
    listMyRooms() {
      return Promise.resolve([]);
    }
    listMessages() {
      return Promise.resolve([]);
    }
  }
  class PitchDraftRepo {
    getDraft() {
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

vi.mock('@/lib/supabaseClient', () => ({
  getSupabaseBrowserClient: () => auth.client,
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
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(''),
}));

import { AccountNavLink } from '../src/components/AccountNavLink';
import { SIGN_OUT_FAILED_COPY } from '../src/components/SignOutButton';
import { SIGNED_OUT_NOTICE } from '../src/components/SignedOutNotice';
import { InboxView } from '../app/inbox/InboxView';
import { KitView } from '../app/kit/[draftId]/KitView';
import { MyInterestsView } from '../app/interests/MyInterestsView';
import { RoomView } from '../app/rooms/[roomId]/RoomView';
import { RoomsList } from '../app/rooms/RoomsList';
import { ConfirmSignIn } from '../app/auth/confirm/ConfirmSignIn';

beforeEach(() => {
  auth.reset(FAKE_SESSION);
  router.push.mockClear();
  router.replace.mockClear();
  router.refresh.mockClear();
});

afterEach(() => {
  cleanup();
});

function signOutControl(): HTMLElement {
  return screen.getByRole('button', { name: 'Sign out' });
}

/** Every account surface the shell wraps — the whole point is that they agree. */
const SURFACES: readonly { readonly name: string; readonly mount: () => void }[] = [
  { name: 'inbox', mount: () => void render(<InboxView />) },
  { name: 'my interests', mount: () => void render(<MyInterestsView />) },
  { name: 'rooms', mount: () => void render(<RoomsList />) },
  { name: 'room', mount: () => void render(<RoomView roomId={ROOM_ID} />) },
  {
    name: 'kit',
    mount: () => void render(<KitView draftId="33333333-3333-4333-8333-333333333333" />),
  },
];

describe('the account surfaces all offer a way out', () => {
  for (const surface of SURFACES) {
    it(`${surface.name} shows a sign-out control to a signed-in person`, async () => {
      surface.mount();

      await waitFor(() => {
        expect(signOutControl()).toBeTruthy();
      });
    });
  }

  // A "Sign out" button on a screen with no session is a claim about the
  // visitor the code has not checked — and the kit is the surface where a
  // signed-out introducer lands most often.
  it('shows nothing to a visitor with no session', async () => {
    auth.reset(null);
    render(<InboxView />);

    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'See who wants to meet you.' })).toBeTruthy();
    });
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull();
  });

  // /auth/confirm is a person in the act of signing IN. The opposite control in
  // the same shell is not a choice, it is a trap.
  it('does not offer sign-out on the sign-in confirmation screen', async () => {
    render(<ConfirmSignIn />);

    await waitFor(() => {
      expect(screen.queryByRole('link', { name: 'Friendword home' })).toBeTruthy();
    });
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull();
  });
});

describe('signing out ends the session and closes the surface', () => {
  it('ends the session, sends the person home, and cannot be reached by Back', async () => {
    render(<InboxView />);
    await waitFor(() => {
      expect(signOutControl()).toBeTruthy();
    });

    await act(async () => {
      fireEvent.click(signOutControl());
    });

    expect(auth.state.session).toBeNull();
    // `replace`, not `push`: on a shared browser the signed-in screen must not
    // be one Back button away from the person who takes the laptop next.
    expect(router.replace).toHaveBeenCalledWith('/');
    expect(router.push).not.toHaveBeenCalled();
  });

  it('closes the inbox itself rather than leaving the rows on screen', async () => {
    render(<InboxView />);
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'People who want to meet you.' })).toBeTruthy();
    });

    await act(async () => {
      fireEvent.click(signOutControl());
    });

    expect(screen.queryByRole('heading', { name: 'People who want to meet you.' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'See who wants to meet you.' })).toBeTruthy();
  });

  // The landing's account door reads the same singleton client, so the two must
  // never disagree about whether there is an account to open.
  it('takes the landing account link with it', async () => {
    render(
      <>
        <AccountNavLink className="account-link" />
        <InboxView />
      </>,
    );
    // Scoped by the landing's own class: since T009 the account shell carries a
    // "My page" pill too, and this test is about the LANDING door — the one
    // that must not exist for a visitor with no session (§12).
    const landingDoor = (): Element | null => document.querySelector('a.account-link');
    await waitFor(() => {
      expect(landingDoor()).toBeTruthy();
    });

    await act(async () => {
      fireEvent.click(signOutControl());
    });

    expect(landingDoor()).toBeNull();
  });

  // An expired or already-revoked refresh token answers the global sign-out
  // with an error. Ending the session on THIS device must still happen, or the
  // one thing the person asked for is the one thing that did not occur.
  it('falls back to a local sign-out when the server refuses the global one', async () => {
    auth.state.signOutError = { message: 'session_not_found' };
    render(<InboxView />);
    await waitFor(() => {
      expect(signOutControl()).toBeTruthy();
    });

    await act(async () => {
      fireEvent.click(signOutControl());
    });

    expect(auth.state.scopes).toEqual(['global', 'local']);
    expect(auth.state.session).toBeNull();
    expect(router.replace).toHaveBeenCalledWith('/');
  });

  // §12: when even the local clear fails, the screen must not claim a state it
  // did not verify — it says what failed and where to look.
  it('says so, and stays put, when sign-out does not finish', async () => {
    auth.state.signOutError = { message: 'session_not_found' };
    auth.state.localSignOutError = { message: 'storage unavailable' };
    render(<InboxView />);
    await waitFor(() => {
      expect(signOutControl()).toBeTruthy();
    });

    await act(async () => {
      fireEvent.click(signOutControl());
    });

    expect(screen.getByRole('alert').textContent).toBe(SIGN_OUT_FAILED_COPY);
    expect(router.replace).not.toHaveBeenCalled();
    expect(SIGN_OUT_FAILED_COPY).not.toMatch(/still signed in|signed out/i);
  });
});

describe('a session that ends says so', () => {
  // The bug this pins: an inbox whose session expired swapped itself for the
  // same sign-in card a first-time visitor gets, with no word that anything had
  // changed — indistinguishable from having lost the account.
  it('explains the sign-in card to someone who WAS signed in', async () => {
    render(<InboxView />);
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'People who want to meet you.' })).toBeTruthy();
    });

    // Not the sign-out button: this is the session expiring underneath them.
    await act(async () => {
      auth.state.session = null;
      auth.emit('SIGNED_OUT');
    });

    expect(screen.getByRole('status').textContent).toBe(SIGNED_OUT_NOTICE);
  });

  it('says nothing of the kind to a visitor who was never signed in', async () => {
    auth.reset(null);
    render(<InboxView />);

    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'See who wants to meet you.' })).toBeTruthy();
    });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('promises nothing about what happens next', () => {
    // §12: no time, no "we saved your place", no claim about the inbox contents.
    expect(SIGNED_OUT_NOTICE).not.toMatch(/\b(minute|minutes|hour|hours|soon|shortly)\b/i);
    expect(SIGNED_OUT_NOTICE).not.toMatch(/expired|timed out/i);
    expect(SIGNED_OUT_NOTICE).toContain('sign in again');
  });
});
