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

vi.mock('@friendword/ui-tokens', () => ({
  colors: {
    background: 'background',
    borderMuted: 'border-muted',
    borderSuccess: 'border-success',
    danger: 'danger',
    ink: 'ink',
    onPop: 'on-pop',
    pop: 'pop',
    popPressed: 'pop-pressed',
    surface: 'surface',
    textFaint: 'text-faint',
    textSecondary: 'text-secondary',
  },
  fonts: { body: 'body' },
  fontSizes: { xs: 10, sm: 12, md: 16, lg: 20 },
  radii: { md: 20 },
  spacing: { xs: 4, sm: 8, md: 16, lg: 24 },
  strokes: { sticker: 2, trust: 1 },
}));
vi.mock('./useReducedMotion', () => ({ useReducedMotion: () => true }));
vi.mock('react-native', async () => {
  const { createElement } = await import('react');
  return {
    Pressable: ({
      accessibilityRole,
      children,
      disabled,
      style,
    }: {
      readonly accessibilityRole?: string;
      readonly children?: ReactNode;
      readonly disabled?: boolean;
      readonly style?:
        object | ((state: { readonly pressed: boolean }) => object | readonly unknown[]);
    }) =>
      createElement(
        'button',
        {
          'data-role': accessibilityRole,
          'data-style': JSON.stringify(
            typeof style === 'function' ? style({ pressed: false }) : style,
          ),
          disabled,
        },
        children,
      ),
    StyleSheet: { create: (styles: object) => styles },
    Text: ({ children }: { readonly children?: ReactNode }) =>
      createElement('span', null, children),
    View: ({ children, style }: { readonly children?: ReactNode; readonly style?: object }) =>
      createElement('section', { 'data-style': JSON.stringify(style) }, children),
  };
});

import { SignInPromptCard } from './SignInPromptCard';

describe('SignInPromptCard', () => {
  it('renders the title, message, and a >=44pt sign-in button inside a trust card', () => {
    const markup = renderToStaticMarkup(
      <SignInPromptCard
        title="Sign in to see your interests"
        message="Interests are private and only appear for the account that sent them."
        onSignIn={vi.fn()}
      />,
    );

    // The signed-out copy stays intact so no regression on existing card text.
    expect(markup).toContain('Sign in to see your interests');
    expect(markup).toContain(
      'Interests are private and only appear for the account that sent them.',
    );
    // The fix: a real, reachable sign-in control (was previously a dead-end card).
    expect(markup).toContain('data-role="button"');
    expect(markup).toContain('<span>Sign in</span>');
    // WCAG 2.5.5 / iOS HIG: trust action is at least 44pt tall (HypeButton is 52).
    expect(markup).toContain('&quot;minHeight&quot;:52');
  });
});
