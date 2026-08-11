import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const renderModule: unknown = require('react-dom/server');
const renderToStaticMarkup = getRenderToStaticMarkup(renderModule);

function getRenderToStaticMarkup(value: unknown): (node: ReactNode) => string {
  if (typeof value !== 'object' || value === null || !('renderToStaticMarkup' in value)) {
    throw new Error('react-dom/server renderer is unavailable');
  }
  const renderer = value.renderToStaticMarkup;
  if (typeof renderer !== 'function') {
    throw new Error('react-dom/server renderer is invalid');
  }
  return (node) => {
    const markup: unknown = renderer(node);
    if (typeof markup !== 'string') {
      throw new Error('react-dom/server returned non-string markup');
    }
    return markup;
  };
}

vi.mock('@friendword/data', () => ({
  InterestRepo: class {},
  UnauthenticatedError: class extends Error {},
}));
// The real module reads the web origin from expo-constants, which cannot load
// outside a native runtime. The URL itself is proven in
// src/services/webOrigin.test.ts.
vi.mock('../../services/webOrigin', () => ({
  buildRoomsUrl: () => 'https://friendword.example/rooms',
}));
vi.mock('@friendword/ui-tokens', () => ({
  colors: {
    background: '',
    danger: '',
    ink: '',
    keyword: '',
    surface: '',
    textSecondary: '',
    verified: '',
  },
  fonts: { body: '', display: '' },
  fontSizes: { xs: 1, sm: 1, md: 1, lg: 1, xl: 1 },
  spacing: { xs: 1, sm: 1, md: 1, lg: 1, xxl: 1 },
}));
vi.mock('expo-router', () => ({ useFocusEffect: vi.fn() }));
vi.mock('react-native', async () => {
  const { createElement } = await import('react');
  return {
    Linking: { openURL: vi.fn(() => Promise.resolve(true)) },
    ScrollView: ({ children }: { readonly children?: ReactNode }) =>
      createElement('main', null, children),
    StyleSheet: { create: (styles: object) => styles },
    Text: ({ children }: { readonly children?: ReactNode }) =>
      createElement('span', null, children),
    View: ({ children }: { readonly children?: ReactNode }) => createElement('div', null, children),
  };
});
vi.mock('react-native-safe-area-context', async () => {
  const { createElement } = await import('react');
  return {
    SafeAreaView: ({ children }: { readonly children?: ReactNode }) =>
      createElement('section', null, children),
  };
});
vi.mock('../../components', async () => {
  const { createElement } = await import('react');
  return {
    LoadFailureCard: ({
      title,
      message,
      onRetry,
    }: {
      readonly title: string;
      readonly message: string;
      readonly onRetry: () => void;
    }) =>
      createElement(
        'article',
        null,
        createElement('span', null, title),
        createElement('span', null, message),
        createElement('button', { onClick: onRetry }, 'Try again'),
      ),
    PendingCard: ({ label }: { readonly label: string }) =>
      createElement('output', { 'data-pending': label }, label),
    ScreenHeading: ({ title }: { readonly title: string }) => createElement('header', null, title),
    StatusBadge: ({ label }: { readonly label: string }) => createElement('mark', null, label),
    QuietNavAction: ({ label }: { readonly label: string; readonly onPress: () => void }) =>
      createElement('button', null, label),
    TrustCard: ({ children }: { readonly children?: ReactNode }) =>
      createElement('article', null, children),
    SignInPromptCard: ({
      title,
      message,
    }: {
      readonly title: string;
      readonly message: string;
      readonly onSignIn: () => void;
    }) =>
      createElement(
        'article',
        null,
        createElement('span', null, title),
        createElement('span', null, message),
        createElement('button', null, 'Sign in'),
      ),
  };
});
vi.mock('../../services/supabaseClient', () => ({ getSupabaseClient: () => null }));
// InterestsScreen mounts the sign-in sheet, but only the presentational
// InterestsContent is rendered here — stub the sheet so its react-native/token
// deps don't have to be mocked.
vi.mock('../../features/auth/SignInSheet', () => ({ SignInSheet: () => null }));

import type { MyInterest } from '@friendword/data';

import {
  InterestsContent,
  getInterestStatusLabel,
  getInterestTitle,
} from '../../../app/interests/index';

const ACCEPTED_INTEREST: MyInterest = {
  interestId: '50000000-0000-4000-8000-000000000001',
  interestStatus: 'accepted',
  submittedAt: '2026-07-13T10:00:00+00:00',
  decidedAt: '2026-07-13T11:00:00+00:00',
  campaignId: '20000000-0000-4000-8000-000000000001',
  campaignSlug: 'blair-summer',
  campaignStatus: 'expired',
  daterDisplayName: 'Blair',
  campaignHeadline: 'A thoughtful person worth meeting',
};

describe('My interests mobile states', () => {
  it.each([
    ['loading', 'Loading your interests…'],
    ['signed_out', 'Sign in to see your interests'],
    ['error', 'Interests could not be loaded'],
  ] as const)('renders the %s state', (state, copy) => {
    const markup = renderToStaticMarkup(<InterestsContent state={state} interests={[]} />);

    expect(markup).toContain(copy);
  });

  it('offers a reachable sign-in action in the signed-out state', () => {
    // Real-device QA (H-6): the signed-out card was a dead end with no way to
    // sign in. It must now surface a sign-in control wired to onSignIn.
    const markup = renderToStaticMarkup(
      <InterestsContent state="signed_out" interests={[]} onSignIn={vi.fn()} />,
    );

    expect(markup).toContain('<button>Sign in</button>');
  });

  it('renders the authenticated empty state', () => {
    const markup = renderToStaticMarkup(<InterestsContent state="ready" interests={[]} />);

    expect(markup).toContain('No interests sent yet');
  });

  it('shows the campaign, decision result, terminal state, and web room guidance', () => {
    const markup = renderToStaticMarkup(
      <InterestsContent state="ready" interests={[ACCEPTED_INTEREST]} />,
    );

    expect(markup).toContain('Blair');
    expect(markup).toContain('A thoughtful person worth meeting');
    expect(markup).toContain('Campaign expired');
    expect(markup).toContain('Your interest was accepted.');
    expect(markup).toContain('Your intro room is on the Friendword web app');
    expect(markup).toContain('Submitted');
  });

  // FUN-6: the accepted card used to name the web intro rooms in prose with no
  // URL and no control — the one screen where the introduction continues was
  // unreachable from the app. It must be a real press target now.
  it('offers a pressable way into the web intro rooms once accepted', () => {
    const onOpenRooms = vi.fn();
    const markup = renderToStaticMarkup(
      <InterestsContent state="ready" interests={[ACCEPTED_INTEREST]} onOpenRooms={onOpenRooms} />,
    );

    expect(markup).toContain('<button>Open my intro rooms on the web</button>');
  });

  it('offers no room action while the interest is still undecided', () => {
    const markup = renderToStaticMarkup(
      <InterestsContent
        state="ready"
        interests={[{ ...ACCEPTED_INTEREST, interestStatus: 'submitted' }]}
      />,
    );

    expect(markup).not.toContain('Open my intro rooms on the web');
  });

  it('opens the configured web origin rather than a hard-coded host', async () => {
    const { Linking } = await import('react-native');
    const { openIntroRoomsOnWeb } = await import('../../../app/interests/index');
    vi.mocked(Linking.openURL).mockResolvedValueOnce(true);

    await expect(openIntroRoomsOnWeb()).resolves.toBeNull();

    expect(Linking.openURL).toHaveBeenCalledWith('https://friendword.example/rooms');
  });

  // A swallowed openURL rejection left a pressed button looking like it worked.
  it('reports a refused open instead of failing silently', async () => {
    const { Linking } = await import('react-native');
    const { openIntroRoomsOnWeb } = await import('../../../app/interests/index');
    vi.mocked(Linking.openURL).mockRejectedValueOnce(new Error('no handler'));

    await expect(openIntroRoomsOnWeb()).resolves.toBe(
      'Your intro rooms could not open. Please try again.',
    );
  });

  it('falls back to the headline when no dater display name is available', () => {
    const headlineOnly = { ...ACCEPTED_INTEREST, daterDisplayName: null };

    expect(getInterestTitle(headlineOnly)).toBe('A thoughtful person worth meeting');
    expect(getInterestStatusLabel(ACCEPTED_INTEREST)).toBe('Campaign expired');
  });
});

// MUI-13 (T014). This card's entire recovery path was the sentence "Check your
// connection and reopen this screen." — an instruction to navigate by hand, on
// a screen whose read is one already-bound callback away.
describe('an interests read that failed', () => {
  it('offers the read again instead of telling someone to reopen the screen', () => {
    const onRetry = vi.fn();
    const markup = renderToStaticMarkup(
      <InterestsContent state="error" interests={[]} onRetry={onRetry} />,
    );

    expect(markup).toContain('Interests could not be loaded');
    expect(markup).toContain('Try again');
    expect(markup).not.toContain('reopen this screen');
  });

  it('says what was not changed, so a failed read is not read as a lost interest', () => {
    const markup = renderToStaticMarkup(
      <InterestsContent state="error" interests={[]} onRetry={vi.fn()} />,
    );

    expect(markup).toContain('None of your interests were changed');
  });

  // MUI-8: the loading state was a bare line of text, so the list jumped when
  // it resolved.
  it('reserves a card-shaped block while the read is in flight', () => {
    const markup = renderToStaticMarkup(<InterestsContent state="loading" interests={[]} />);

    expect(markup).toContain('data-pending="Loading your interests…"');
  });
});
