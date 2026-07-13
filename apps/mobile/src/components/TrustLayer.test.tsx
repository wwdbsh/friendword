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

const mocks = vi.hoisted(() => ({ reducedMotion: false }));

vi.mock('@friendword/ui-tokens', () => ({
  colors: {
    background: 'background',
    danger: 'danger',
    fresh: 'fresh',
    ink: 'ink',
    pop: 'pop',
    popPressed: 'pop-pressed',
    surface: 'surface',
    textFaint: 'text-faint',
    textSecondary: 'text-secondary',
  },
  fonts: { body: 'body' },
  fontSizes: { sm: 12, md: 16, lg: 20 },
  radii: { md: 20 },
  spacing: { xs: 4, sm: 8, md: 16, lg: 24 },
  strokes: { sticker: 2 },
}));
vi.mock('./useReducedMotion', () => ({
  useReducedMotion: () => mocks.reducedMotion,
}));
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
            typeof style === 'function' ? style({ pressed: true }) : style,
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

import { HypeButton } from './HypeButton';
import { QuietNavAction } from './QuietNavAction';
import { SafetyAction } from './SafetyAction';
import { TrustCard } from './TrustCard';

describe('Trust Layer primitives', () => {
  it('renders a zero-tilt card with a one-pixel border and soft shadow', () => {
    const markup = renderToStaticMarkup(
      <TrustCard>
        <span>Payment state</span>
      </TrustCard>,
    );

    expect(markup).toContain('Payment state');
    expect(markup).toContain('&quot;borderWidth&quot;:1');
    expect(markup).toContain('&quot;shadowOpacity&quot;:0.08');
    expect(markup).not.toContain('rotate');
  });

  it('keeps quiet and safety actions accessible and visually restrained', () => {
    const quiet = renderToStaticMarkup(<QuietNavAction label="Back" onPress={vi.fn()} />);
    const safety = renderToStaticMarkup(<SafetyAction label="Delete account" onPress={vi.fn()} />);

    expect(quiet).toContain('data-role="button"');
    expect(quiet).toContain('Back');
    expect(safety).toContain('data-role="button"');
    expect(safety).toContain('Delete account');
    expect(safety).toContain('&quot;borderWidth&quot;:1');
    expect(safety).not.toContain('shadowOpacity');
  });

  it('removes press motion when reduced motion is enabled', () => {
    mocks.reducedMotion = false;
    const animated = renderToStaticMarkup(<QuietNavAction label="Campaigns" onPress={vi.fn()} />);
    expect(animated).toContain('transform');

    mocks.reducedMotion = true;
    const reduced = renderToStaticMarkup(<QuietNavAction label="Campaigns" onPress={vi.fn()} />);
    expect(reduced).not.toContain('transform');
  });

  it('provides a trust variant without the campaign sticker shadow', () => {
    mocks.reducedMotion = true;
    const markup = renderToStaticMarkup(
      <HypeButton label="Purchase" onPress={vi.fn()} variant="trust" />,
    );

    expect(markup).toContain('&quot;shadowOpacity&quot;:0');
    expect(markup).toContain('&quot;borderWidth&quot;:1');
    expect(markup).not.toContain('transform');
  });
});
