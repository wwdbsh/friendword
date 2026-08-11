import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderStatic } from '../../testing/renderStatic';

vi.mock('@friendword/ui-tokens', () => ({
  colors: { background: '', ink: '', textSecondary: '' },
  fonts: { body: '' },
  fontSizes: { md: 16, lg: 20 },
  spacing: { lg: 24, xxl: 64 },
}));
vi.mock('react-native', async () => {
  const { createElement } = await import('react');
  return {
    ScrollView: ({
      children,
      contentContainerStyle,
    }: {
      readonly children?: ReactNode;
      readonly contentContainerStyle?: object;
    }) => createElement('main', { 'data-style': JSON.stringify(contentContainerStyle) }, children),
    StyleSheet: { create: (styles: object) => styles },
    Text: ({ children }: { readonly children?: ReactNode }) =>
      createElement('span', null, children),
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
    HypeButton: ({ label, onPress }: { readonly label: string; readonly onPress: () => void }) =>
      createElement('button', { 'data-action': label, onClick: onPress }, label),
    QuietNavAction: ({
      label,
      onPress,
    }: {
      readonly label: string;
      readonly onPress: () => void;
    }) => createElement('button', { 'data-action': label, onClick: onPress }, label),
    TrustCard: ({ children, tone }: { readonly children?: ReactNode; readonly tone?: string }) =>
      createElement('article', { 'data-tone': tone ?? 'neutral' }, children),
  };
});

import { PitchReviewLoadState } from './PitchReviewLoadState';

// MUI-5 / MUI-13. Before this component the whole state was a single <Text>
// inside a padded SafeAreaView: no scroll view, no card, no spacing, and — for
// "This draft could not be found." — no way onwards but the back gesture.
describe('the review screen before it has a draft', () => {
  it('scrolls and centres its content instead of pinning it to the corner', () => {
    const markup = renderStatic(
      <PitchReviewLoadState
        message="Loading your draft…"
        pending
        onRetry={vi.fn()}
        onBackToCampaigns={vi.fn()}
      />,
    );

    expect(markup).toContain('<main');
    expect(markup).toContain('&quot;flexGrow&quot;:1');
    expect(markup).toContain('&quot;justifyContent&quot;:&quot;center&quot;');
    expect(markup).toContain('&quot;padding&quot;:24');
  });

  it('keeps a pending read plain — no error tone and no retry for a live read', () => {
    const markup = renderStatic(
      <PitchReviewLoadState
        message="Preparing your draft…"
        pending
        onRetry={vi.fn()}
        onBackToCampaigns={vi.fn()}
      />,
    );

    expect(markup).toContain('Preparing your draft…');
    expect(markup).not.toContain('data-tone="danger"');
    expect(markup).not.toContain('Try again');
  });

  it('gives a failed read the failure tone, a retry and a way back', () => {
    const markup = renderStatic(
      <PitchReviewLoadState
        message="This draft could not be found."
        pending={false}
        onRetry={vi.fn()}
        onBackToCampaigns={vi.fn()}
      />,
    );

    expect(markup).toContain('data-tone="danger"');
    expect(markup).toContain('This draft could not be opened');
    expect(markup).toContain('This draft could not be found.');
    expect(markup).toContain('data-action="Try again"');
    expect(markup).toContain('data-action="Back to my campaigns"');
  });

  it('is what the review route actually renders for that state', () => {
    // The component is only a fix if the screen uses it. Before this change the
    // route printed a bare <Text> in a padded SafeAreaView right here.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { readFileSync } = require('node:fs') as typeof import('node:fs');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { join } = require('node:path') as typeof import('node:path');
    const route = readFileSync(join(process.cwd(), 'app/pitch/review.tsx'), 'utf8');

    expect(route).toContain('<PitchReviewLoadState');
    expect(route).toContain('onBackToCampaigns=');
    expect(route).not.toContain('<Text style={styles.message}>');
  });
});
