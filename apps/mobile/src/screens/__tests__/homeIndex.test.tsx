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

/** Every quiet nav row the home screen rendered, in order, with its target. */
const navActions: { label: string; onPress: () => void }[] = [];
const push = vi.fn();

vi.mock('@friendword/ui-tokens', () => ({
  colors: { background: '', ink: '', pop: '', textFaint: '', textSecondary: '' },
  fonts: { body: '', display: '' },
  fontSizes: { xs: 1, sm: 1, md: 1, lg: 1, xl: 1, hero: 1 },
  spacing: { xs: 1, sm: 1, md: 1, lg: 1, xl: 1 },
}));
vi.mock('expo-router', () => ({ useRouter: () => ({ push }) }));
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
    HypeButton: ({ label }: { readonly label: string; readonly onPress: () => void }) =>
      createElement('button', null, label),
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
    StickerCard: ({ children }: { readonly children?: ReactNode }) =>
      createElement('article', null, children),
  };
});

import HomeScreen from '../../../app/index';

function renderHome(): string {
  navActions.length = 0;
  push.mockClear();
  return renderToStaticMarkup(<HomeScreen />);
}

// MY PAGE (mobile half) — T009 / Issue #46 (ACC-6).
// The home screen listed three destinations under "Your activity", named
// differently from the same areas on the web. The audit's finding was that a
// person's own things were scattered across five sources with no single door;
// the app's door is this group, and it only works as one if it is named for
// the person rather than for a log, and if an area has ONE name across the two
// surfaces.
describe('the mobile home is the app half of My page', () => {
  it('groups the account destinations under the same name the web hub uses', () => {
    const markup = renderHome();

    expect(markup).toContain('My page');
    expect(markup).not.toContain('Your activity');
  });

  it('names each area the way the web names it', () => {
    const markup = renderHome();

    // Web: /me lists "My campaigns", "My interests"; /account is "Account".
    expect(markup).toContain('My campaigns');
    expect(markup).toContain('My interests');
    expect(markup).toContain('Account');
    expect(markup).not.toContain('My dating campaigns');
  });

  it('reaches campaigns, interests and the account from this one screen', () => {
    renderHome();

    expect(navActions.map((action) => action.label)).toEqual([
      'My campaigns',
      'My interests',
      'Account',
    ]);

    for (const action of navActions) {
      action.onPress();
    }
    expect(push.mock.calls.map(([target]: readonly unknown[]) => target)).toEqual([
      '/campaigns',
      '/interests',
      '/account',
    ]);
  });

  it('still opens the creation flow as the screen’s primary action', () => {
    const markup = renderHome();

    expect(markup).toContain('Pitch a friend');
  });
});
