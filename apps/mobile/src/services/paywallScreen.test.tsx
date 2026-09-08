import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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
  Linking: { openURL: vi.fn() },
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
    QuietNavAction: ({ label }: { readonly label: string }) => createElement('button', null, label),
    StickerCard: ({ children }: { readonly children: React.ReactNode }) =>
      createElement('article', null, children),
    TrustCard: ({ children }: { readonly children: React.ReactNode }) =>
      createElement('article', null, children),
  };
});
vi.mock('./purchases', () => ({
  describePurchaseFailure: (error: unknown) => String(error),
  getPaywallStatus: mocks.getPaywallStatus,
  parseProductIntentParams: () => null,
  runPurchaseFlow: vi.fn(),
  runRestoreFlow: vi.fn(),
  // The real copy tables are pinned in purchases.test.ts; the screen only needs
  // something to index into.
  PURCHASE_FAILURE_MESSAGES: { unavailable: '', not_configured: '', no_products: '' },
  PURCHASE_FAILURE_TITLES: { unavailable: '', not_configured: '', no_products: '' },
}));
vi.mock('./errorDiagnostics', () => ({ diagnosticsEnabled: () => false }));
vi.mock('./supabaseClient', () => ({ getSupabaseClient: () => null }));
vi.mock('./webOrigin', () => ({ getWebOrigin: () => 'https://friendword.example' }));

import PaywallScreen, {
  getConfirmedBody,
  getExistingBenefitFromRejection,
} from '../../app/paywall';

const CAMPAIGN_ID = '20000000-0000-4000-8000-000000000002';
const DRAFT_ID = '10000000-0000-4000-8000-000000000001';

describe('PaywallScreen', () => {
  it('shows an error and no catalog when product intent is missing', () => {
    const markup = renderToStaticMarkup(<PaywallScreen />);

    expect(markup).toContain('This paywall link isn’t valid');
    expect(markup).toContain('Products are not shown without a verified context.');
    expect(markup).not.toContain('Restore purchases');
    expect(markup).not.toContain('Get Creator Launch');
    expect(mocks.getPaywallStatus).not.toHaveBeenCalled();
  });

  it('turns paid-benefit guard rejections into re-entry states', () => {
    const unusedCredit = new Error('Supabase operation failed', {
      cause: { message: 'unused Creator Launch credit' },
    });
    expect(
      getExistingBenefitFromRejection(
        { intent: 'creator_launch', draftId: '10000000-0000-4000-8000-000000000001' },
        unusedCredit,
      ),
    ).toBe('creator_kit');
    expect(
      getExistingBenefitFromRejection(
        { intent: 'campaign_pass', campaignId: CAMPAIGN_ID },
        new Error('already has an active Campaign Pass'),
      ),
    ).toBe('campaign_pass');
  });

  it('tells a reviving buyer the campaign is coming back instead of promising live analytics', () => {
    const revive = getConfirmedBody({ intent: 'campaign_pass', campaignId: CAMPAIGN_ID }, true);
    // Honest revival copy: entitlement recorded, campaign coming back, and the
    // private-beta pending caveat — never a flat "analytics are live" claim.
    expect(revive.toLowerCase()).toContain('revive');
    expect(revive.toLowerCase()).toMatch(/pending|shortly|beta|review/);
    expect(revive).not.toContain('unlocked campaign funnel analytics.');
  });

  it('keeps the direct confirmation copy for a normal (non-revival) purchase', () => {
    expect(getConfirmedBody({ intent: 'campaign_pass', campaignId: CAMPAIGN_ID }, false)).toContain(
      'unlocked campaign funnel analytics',
    );
    expect(getConfirmedBody({ intent: 'creator_launch', draftId: DRAFT_ID }, false)).toContain(
      'Creator Kit',
    );
  });
});

// M-9 (T004, Issue #73). The failure card is only reachable after an effect
// resolves, and this harness renders statically, so the wiring is pinned at the
// source: the vendor's text must not appear in the tree except behind the
// diagnostics gate, and the two escapes must stay outside the status branches.
describe('the paywall when the store does not answer', () => {
  const SOURCE = readFileSync(join(process.cwd(), 'app/paywall.tsx'), 'utf8');

  it('prints the mapped sentence rather than the SDK reason string', () => {
    expect(SOURCE).not.toContain('{status.reason}');
    expect(SOURCE).toContain('PURCHASE_FAILURE_TITLES[status.reason]');
    expect(SOURCE).toContain('PURCHASE_FAILURE_MESSAGES[status.reason]');
  });

  it('shows the raw diagnostic only behind the dev-build gate', () => {
    const diagnosticAt = SOURCE.indexOf('{status.diagnostic}');
    const gateAt = SOURCE.indexOf('diagnosticsEnabled() ? (');

    expect(diagnosticAt).toBeGreaterThan(-1);
    expect(gateAt).toBeGreaterThan(-1);
    expect(gateAt).toBeLessThan(diagnosticAt);
    // One occurrence, one gate: no second unguarded copy of it.
    expect(SOURCE.split('{status.diagnostic}')).toHaveLength(2);
  });

  it('leaves restore and back reachable whatever the status card says', () => {
    const afterCards = SOURCE.slice(SOURCE.indexOf('{note !== null ?'));

    expect(afterCards).toContain("'Restore purchases'");
    expect(afterCards).toContain('label="Back"');
    expect(afterCards).not.toContain('status?.state');
  });
});
