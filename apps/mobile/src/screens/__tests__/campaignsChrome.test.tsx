import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderStatic } from '../../testing/renderStatic';

const push = vi.hoisted(() => vi.fn());
const introduced = vi.hoisted(() => vi.fn());

vi.mock('@friendword/data', () => ({
  BenefitsRepo: class {
    listMyOwnedCampaigns() {
      return new Promise(() => {});
    }
  },
  InterestRepo: class {
    listCampaignInterests() {
      return new Promise(() => {});
    }
  },
  trackEvent: vi.fn(),
  UnauthenticatedError: class extends Error {},
}));
vi.mock('@friendword/ui-tokens', () => ({
  colors: {
    background: '',
    borderMuted: '',
    borderSuccess: '',
    danger: '',
    hype: '',
    ink: '',
    keyword: '',
    onHype: '',
    surface: '',
    textFaint: '',
    textSecondary: '',
    verified: '',
  },
  fonts: { body: '', display: '' },
  fontSizes: { xs: 1, sm: 1, md: 1, lg: 1, xl: 1 },
  maxControlFontScale: 1.4,
  radii: { sm: 1, md: 1, pill: 999 },
  spacing: { xs: 1, sm: 1, md: 1, lg: 1, xxl: 1 },
  strokes: { sticker: 2, trust: 1 },
}));
// The focus effect is what kicks the three reads; a static render never
// focuses, so the screen stays in the initial all-pending state these tests are
// about. Running it inline here would loop (it setStates during render).
vi.mock('expo-router', () => ({ useFocusEffect: vi.fn(), useRouter: () => ({ push }) }));
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
vi.mock('expo-clipboard', () => ({ setStringAsync: vi.fn() }));
vi.mock('react-native-safe-area-context', async () => {
  const { createElement } = await import('react');
  return {
    SafeAreaView: ({ children }: { readonly children?: ReactNode }) =>
      createElement('section', null, children),
  };
});
vi.mock('../../components', async () => {
  const { createElement } = await import('react');
  const named =
    (tag: string) =>
    ({ children }: { readonly children?: ReactNode }) =>
      createElement(tag, null, children);
  return {
    HypeButton: ({ label }: { readonly label: string }) => createElement('button', null, label),
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
        'aside',
        { 'data-failure': title, 'data-has-retry': typeof onRetry === 'function' },
        message,
      ),
    PendingCard: ({ label }: { readonly label: string }) =>
      createElement('output', { 'data-pending': label }),
    QuietNavAction: ({
      label,
      onPress,
    }: {
      readonly label: string;
      readonly onPress: () => void;
    }) => {
      navActions.push({ label, onPress });
      return createElement('button', null, label);
    },
    ScreenHeading: ({ title }: { readonly title: string }) => createElement('header', null, title),
    SignInPromptCard: named('article'),
    StatusBadge: ({ label, tone }: { readonly label: string; readonly tone?: string }) =>
      createElement('mark', { 'data-tone': tone ?? 'campaign' }, label),
    StickerCard: named('article'),
    TrustCard: named('article'),
  };
});
vi.mock('../../features/auth/SignInSheet', () => ({ SignInSheet: () => null }));
vi.mock('../../services/draftServiceInstance', () => ({
  pitchDraftService: { listMyDrafts: () => new Promise(() => {}) },
}));
vi.mock('../../services/pitchDrafts', () => ({ PitchDraftDeletionError: class extends Error {} }));
vi.mock('../../services/pitchDraftsSupabase', () => ({
  DELETE_FAILED_MESSAGE: 'delete failed',
  isRecoveredServerDraft: () => false,
}));
vi.mock('../../services/supabaseClient', () => ({ getSupabaseClient: () => ({}) }));
vi.mock('../../services/webOrigin', () => ({
  buildInboxUrl: () => 'https://friendword.example/inbox',
}));
vi.mock('../../services/introducedCampaigns', () => ({
  buildIntroducerShareUrl: (slug: string) => `https://friendword.example/p/${slug}`,
  canShareIntroducedCampaign: (campaign: { status: string; slug: string | null }) =>
    campaign.status === 'published' && campaign.slug !== null,
  formatIntroducedCampaignStatus: (status: string) => status,
  getIntroducerLiveHeadline: (name: string | null) => `${name ?? 'Your friend'} live`,
  listMyIntroducedCampaigns: introduced,
}));

const navActions: { label: string; onPress: () => void }[] = [];

import CampaignsScreen from '../../../app/campaigns/index';

function renderCampaigns(): string {
  navActions.length = 0;
  push.mockClear();
  introduced.mockReturnValue(new Promise(() => {}));
  return renderStatic(<CampaignsScreen />);
}

// MUI-8. Three independent reads, each announced by one line of text, so every
// section that resolved re-laid out everything under it.
describe('the campaigns screen while its three sections load', () => {
  it('reserves a card for each pending section instead of a single line', () => {
    const markup = renderCampaigns();
    const pending = [...markup.matchAll(/data-pending="([^"]+)"/g)].map(([, label]) => label);

    expect(pending).toEqual([
      'Loading your campaigns…',
      'Loading your live pitches…',
      'Loading your mixes…',
    ]);
  });

  it('says what each section is fetching, in that section’s own words', () => {
    const markup = renderCampaigns();

    expect(markup).toContain('Campaigns about me');
    expect(markup).toContain('Pitches you got live');
    expect(markup).toContain('Pitches I’m making');
  });
});

// MUI-3. `/pitch/share` builds its free-public-share card from a `slug`
// navigation param, and nothing in the app passed one — the card could not be
// reached from anywhere, on any path. The live-pitch card is the only place the
// app holds a slug (the server masks it for every non-public campaign).
describe('reaching the launch kit from a live pitch', () => {
  it('offers the entry only on a live campaign whose slug the server released', async () => {
    const { getIntroducedShareActions } = await import('../../../app/campaigns/index');

    // The nav row sits inside the same branch as the share/copy actions, so the
    // slug it forwards is the one the server was willing to release.
    expect(getIntroducedShareActions({ status: 'published', slug: 'blair-and-friends' })).toEqual({
      canShare: true,
      shareUrl: 'https://friendword.example/p/blair-and-friends',
    });
    expect(getIntroducedShareActions({ status: 'published', slug: null }).canShare).toBe(false);
    expect(getIntroducedShareActions({ status: 'paused', slug: 'x' }).canShare).toBe(false);
  });

  it('passes the slug as the share screen’s own param name', () => {
    // The share screen reads `slug` off useLocalSearchParams; a different key
    // would leave the card just as unreachable as no key at all.
    const source = readSource('app/campaigns/index.tsx');

    expect(source).toContain("pathname: '/pitch/share'");
    expect(source).toContain("params: { slug: campaign.slug ?? '' }");
    expect(source).toContain('Open the launch kit');
  });
});

// MUI-13. Both list failures ended at "Check your connection and reopen this
// screen." — an instruction to navigate by hand around a callback the screen
// already holds.
describe('a campaigns section that could not be read', () => {
  it('hands both failure cards a retry rather than an instruction', () => {
    const source = readSource('app/campaigns/index.tsx');

    expect(source).not.toContain('reopen this screen');
    expect(source.match(/<LoadFailureCard/g) ?? []).toHaveLength(2);
  });
});

function readSource(relativePath: string): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { readFileSync } = require('node:fs') as typeof import('node:fs');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { join } = require('node:path') as typeof import('node:path');
  return readFileSync(join(process.cwd(), relativePath), 'utf8');
}
