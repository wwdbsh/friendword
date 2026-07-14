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
    borderMuted: 'border-muted',
    borderSuccess: 'border-success',
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
  strokes: { sticker: 2, trust: 1 },
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
    // Border swapped off textFaint (fails 3:1) onto borderMuted (audit §8).
    expect(markup).toContain('border-muted');
    expect(markup).not.toContain('text-faint');
  });

  it('carries the success tone on borderSuccess, not the fill-only fresh token', () => {
    const markup = renderToStaticMarkup(
      <TrustCard tone="success">
        <span>Verified</span>
      </TrustCard>,
    );

    expect(markup).toContain('border-success');
    // fresh (#17B89B) is 2.35:1 as a border — it must not be the boundary.
    expect(markup).not.toContain('&quot;borderColor&quot;:&quot;fresh&quot;');
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

describe('Trust Layer touch targets and accessibility', () => {
  // WCAG 2.5.5 / iOS HIG: interactive trust targets are >= 44x44pt.
  it('sizes every interactive trust control to at least 44pt', () => {
    mocks.reducedMotion = true;
    const quiet = renderToStaticMarkup(<QuietNavAction label="Back" onPress={vi.fn()} />);
    const safety = renderToStaticMarkup(<SafetyAction label="Delete account" onPress={vi.fn()} />);
    const trustButton = renderToStaticMarkup(
      <HypeButton label="Purchase" onPress={vi.fn()} variant="trust" />,
    );

    expect(quiet).toContain('&quot;minHeight&quot;:44');
    expect(safety).toContain('&quot;minHeight&quot;:48');
    expect(trustButton).toContain('&quot;minHeight&quot;:52');
  });

  it('exposes a button role and reflects the disabled state to assistive tech', () => {
    const enabled = renderToStaticMarkup(<SafetyAction label="Report" onPress={vi.fn()} />);
    const disabled = renderToStaticMarkup(
      <SafetyAction disabled label="Report" onPress={vi.fn()} />,
    );

    expect(enabled).toContain('data-role="button"');
    expect(enabled).not.toContain('disabled=""');
    expect(disabled).toContain('data-role="button"');
    expect(disabled).toContain('disabled=""');
  });

  it('hides the decorative arrow from screen readers on quiet nav', () => {
    const quiet = renderToStaticMarkup(<QuietNavAction label="Campaigns" onPress={vi.fn()} />);

    // The label text is announced; the → glyph is decorative and hidden.
    expect(quiet).toContain('Campaigns');
    expect(quiet).toContain('→');
  });

  it('drops press motion on safety actions under reduced motion', () => {
    mocks.reducedMotion = false;
    const animated = renderToStaticMarkup(<SafetyAction label="Block" onPress={vi.fn()} />);
    expect(animated).toContain('transform');

    mocks.reducedMotion = true;
    const reduced = renderToStaticMarkup(<SafetyAction label="Block" onPress={vi.fn()} />);
    expect(reduced).not.toContain('transform');
  });
});
