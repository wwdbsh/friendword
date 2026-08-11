import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderStatic } from '../../testing/renderStatic';

const params = vi.hoisted(() => {
  const state: { current: Record<string, string> } = { current: {} };
  return state;
});

vi.mock('@friendword/data', () => ({ PurchasesRepo: class {}, trackEvent: vi.fn() }));
vi.mock('@friendword/ui-tokens', () => ({
  colors: {
    background: '',
    danger: '',
    ink: '',
    keyword: '',
    textSecondary: '',
  },
  fonts: { body: '', display: '' },
  fontSizes: { xs: 1, sm: 1, md: 1, lg: 1, xl: 1 },
  radii: { sm: 1 },
  spacing: { xs: 1, sm: 1, md: 1, lg: 1, xxl: 1 },
  strokes: { sticker: 1 },
}));
vi.mock('expo-router', () => ({
  Stack: { Screen: ({ options }: { readonly options: { title: string } }) => options.title },
  useFocusEffect: vi.fn(),
  useLocalSearchParams: () => params.current,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock('react-native', async () => {
  const { createElement } = await import('react');
  return {
    Linking: { openURL: vi.fn() },
    ScrollView: ({ children }: { readonly children?: ReactNode }) =>
      createElement('main', null, children),
    Share: { share: vi.fn(), sharedAction: 'sharedAction' },
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
vi.mock('expo-clipboard', () => ({ setStringAsync: vi.fn() }));
vi.mock('../../components', async () => {
  const { createElement } = await import('react');
  return {
    HypeButton: ({ label }: { readonly label: string }) => createElement('button', null, label),
    LoadFailureCard: ({ title }: { readonly title: string }) => createElement('aside', null, title),
    QuietNavAction: ({ label }: { readonly label: string }) => createElement('button', null, label),
    ScreenHeading: ({
      eyebrow,
      title,
      subtitle,
    }: {
      readonly eyebrow?: string;
      readonly title: string;
      readonly subtitle?: string;
    }) => createElement('header', null, `${eyebrow ?? ''} | ${title} | ${subtitle ?? ''}`),
    TrustCard: ({ children }: { readonly children?: ReactNode }) =>
      createElement('article', null, children),
  };
});
vi.mock('../../services/draftServiceInstance', () => ({
  pitchDraftService: {
    listMyDrafts: () => new Promise(() => {}),
    purgeInvitationContact: () => new Promise(() => {}),
  },
}));
vi.mock('../../services/pitchDrafts', () => ({
  hasFinalizedConsent: () => false,
  settleWithin: () => new Promise(() => {}),
}));
vi.mock('../../services/supabaseClient', () => ({ getSupabaseClient: () => null }));
vi.mock('../../services/webOrigin', () => ({
  buildConsentUrl: (token: string) => `https://friendword.example/consent/${token}`,
  getWebOrigin: () => 'https://friendword.example',
}));
vi.mock('../../services/introducedCampaigns', () => ({
  buildIntroducerShareUrl: (slug: string) =>
    `https://friendword.example/p/${slug}?src=introducer-share&ref=${slug}`,
}));

import SharePitchScreen from '../../../app/pitch/share';

function renderShare(next: Record<string, string>): string {
  params.current = next;
  return renderStatic(<SharePitchScreen />);
}

/**
 * MUI-3. The free public share card was gated on `isPublished`, a fact read off
 * a DRAFT, while the only slug in the app lives on a campaign row with no draft
 * id attached to it. The two conditions could not both be true, so the card was
 * dead code on a screen that also told people sharing was free.
 *
 * The slug is the server's own release token — `list_my_introduced_campaigns`
 * returns NULL for any campaign that is not public — so its presence is what
 * the card is now gated on.
 */
describe('the launch kit reached with a slug and no draft', () => {
  it('renders the free public share card from the slug alone', () => {
    const markup = renderShare({ slug: 'blair-and-friends' });

    expect(markup).toContain('The free public pitch link');
    expect(markup).toContain(
      'https://friendword.example/p/blair-and-friends?src=introducer-share&amp;ref=blair-and-friends',
    );
    expect(markup).toContain('Share the pitch');
    expect(markup).toContain('Copy link');
  });

  it('titles the screen as the launch kit rather than an approval invite', () => {
    const markup = renderShare({ slug: 'blair-and-friends' });

    expect(markup).toContain('Social launch kit');
    expect(markup).toContain('Your approved pitch is live');
  });

  it('does not accuse a live pitch of having a missing invite', () => {
    // The "Invite not found" card is keyed off `!isPublished`; on the slug-only
    // path it would have fired under the very card that says the link is live.
    const markup = renderShare({ slug: 'blair-and-friends' });

    expect(markup).not.toContain('Invite not found');
  });

  it('promises no Creator Kit it cannot show without a draft', () => {
    const markup = renderShare({ slug: 'blair-and-friends' });

    expect(markup).toContain('Sharing this pitch is free and always will be.');
    expect(markup).not.toContain('The Creator Kit below');
  });

  it('leaves the invite path untouched when no slug is passed', () => {
    const markup = renderShare({ draftId: 'draft-1' });

    expect(markup).not.toContain('The free public pitch link');
    expect(markup).toContain('Share approval invite');
  });
});

// MUI-9: two hand-placed line breaks in one sentence.
describe('the revision notice wraps on its own', () => {
  it('has no literal newlines left in its copy', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { readFileSync } = require('node:fs') as typeof import('node:fs');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { join } = require('node:path') as typeof import('node:path');
    const source = readFileSync(join(process.cwd(), 'app/pitch/share.tsx'), 'utf8');

    expect(source).not.toContain('{`\\n`}');
    expect(source).toContain(
      'The existing link now opens the latest revision. No new link or re-share needed.',
    );
  });
});
