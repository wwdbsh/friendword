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
vi.mock('@friendword/ui-tokens', () => ({
  colors: {
    background: '',
    danger: '',
    fresh: '',
    ink: '',
    pop: '',
    surface: '',
    textSecondary: '',
  },
  fonts: { body: '', display: '' },
  fontSizes: { xs: 1, sm: 1, md: 1, lg: 1, xl: 1 },
  spacing: { xs: 1, sm: 1, md: 1, lg: 1, xxl: 1 },
}));
vi.mock('expo-router', () => ({ useFocusEffect: vi.fn() }));
vi.mock('react-native', async () => {
  const { createElement } = await import('react');
  return {
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
    TrustCard: ({ children }: { readonly children?: ReactNode }) =>
      createElement('article', null, children),
  };
});
vi.mock('../../services/supabaseClient', () => ({ getSupabaseClient: () => null }));

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
    expect(markup).toContain('Open intro rooms on the Friendword web app');
    expect(markup).toContain('Submitted');
  });

  it('falls back to the headline when no dater display name is available', () => {
    const headlineOnly = { ...ACCEPTED_INTEREST, daterDisplayName: null };

    expect(getInterestTitle(headlineOnly)).toBe('A thoughtful person worth meeting');
    expect(getInterestStatusLabel(ACCEPTED_INTEREST)).toBe('Campaign expired');
  });
});
