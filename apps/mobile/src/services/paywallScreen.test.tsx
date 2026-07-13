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

const mocks = vi.hoisted(() => ({
  getPaywallStatus: vi.fn(),
  params: {},
}));

vi.mock('@friendword/data', () => ({ trackEvent: vi.fn() }));
vi.mock('@friendword/ui-tokens', () => ({
  colors: {
    background: '#fff',
    danger: '#f00',
    fresh: '#0f0',
    hype: '#00f',
    ink: '#000',
    onHype: '#fff',
    pop: '#f0f',
    textSecondary: '#555',
  },
  fonts: { body: 'body', display: 'display' },
  fontSizes: { xs: 10, sm: 12, md: 16, lg: 20, xl: 28 },
  spacing: { xs: 4, sm: 8, md: 12, lg: 20, xxl: 40 },
}));
vi.mock('expo-router', () => ({
  useLocalSearchParams: () => mocks.params,
  useRouter: () => ({ back: vi.fn() }),
}));
vi.mock('react-native', () => ({
  ScrollView: 'main',
  StyleSheet: { create: (styles: object) => styles },
  Text: 'span',
  View: 'div',
}));
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'section' }));
vi.mock('../components', async () => {
  const { createElement } = await import('react');
  return {
    HypeButton: ({ label }: { readonly label: string }) => createElement('button', null, label),
    StickerCard: ({ children }: { readonly children: React.ReactNode }) =>
      createElement('article', null, children),
  };
});
vi.mock('./purchases', () => ({
  getPaywallStatus: mocks.getPaywallStatus,
  parseProductIntentParams: () => null,
  runPurchaseFlow: vi.fn(),
  runRestoreFlow: vi.fn(),
}));
vi.mock('./supabaseClient', () => ({ getSupabaseClient: () => null }));

import PaywallScreen from '../../app/paywall';

describe('PaywallScreen', () => {
  it('shows an error and no catalog when product intent is missing', () => {
    const markup = renderToStaticMarkup(<PaywallScreen />);

    expect(markup).toContain('This paywall link isn’t valid');
    expect(markup).toContain('No products are shown without that context.');
    expect(markup).not.toContain('Restore purchases');
    expect(markup).not.toContain('Get Creator Launch');
    expect(mocks.getPaywallStatus).not.toHaveBeenCalled();
  });
});
