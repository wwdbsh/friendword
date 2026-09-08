import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderStatic } from '../testing/renderStatic';

vi.mock('@friendword/ui-tokens', () => ({
  colors: { background: 'background' },
  spacing: { lg: 24 },
}));
vi.mock('react-native', async () => {
  const { createElement } = await import('react');
  return {
    StyleSheet: { create: (styles: object) => styles },
    View: ({ children }: { readonly children?: ReactNode }) =>
      createElement('section', null, children),
  };
});
// The card this wraps is proven where it lives; here only the wiring matters.
vi.mock('./LoadFailureCard', async () => {
  const { createElement } = await import('react');
  return {
    LoadFailureCard: ({
      title,
      message,
      retryLabel,
      onRetry,
    }: {
      readonly title: string;
      readonly message: string;
      readonly retryLabel?: string;
      readonly onRetry: () => void;
    }) =>
      createElement(
        'article',
        { 'data-retry-label': retryLabel, 'data-has-retry': String(typeof onRetry === 'function') },
        `${title}|${message}`,
      ),
  };
});

import { RouteErrorCard } from './RouteErrorCard';

// T001 follow-up (issue #70): device QA watched a screen render correctly and
// then go blank white. A route whose tree throws with no boundary unmounts, and
// a released build shows no red box — so the failure arrived as an empty screen
// and no information at all.
describe('what a route shows instead of a blank white screen', () => {
  it('names the failure and offers the retry that re-renders the route', () => {
    const markup = renderStatic(
      <RouteErrorCard error={new TypeError('e.rest')} onRetry={vi.fn()} />,
    );

    expect(markup).toContain('This screen stopped');
    // The class is the half that identifies a device-only failure; the message
    // alone does not.
    expect(markup).toContain('TypeError');
    expect(markup).toContain('e.rest');
    expect(markup).toContain('data-has-retry="true"');
    expect(markup).toContain('Try this screen again');
  });
});
