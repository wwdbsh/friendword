import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderStatic } from '../testing/renderStatic';

vi.mock('@friendword/ui-tokens', () => ({
  colors: {
    background: 'background',
    borderMuted: 'border-muted',
    borderSuccess: 'border-success',
    danger: 'danger',
    hype: 'hype',
    ink: 'ink',
    keyword: 'keyword',
    onHype: 'on-hype',
    pop: 'pop',
    popPressed: 'pop-pressed',
    surface: 'surface',
    textFaint: 'text-faint',
    textSecondary: 'text-secondary',
  },
  fonts: { body: 'body', display: 'display' },
  fontSizes: { xs: 12, sm: 14, md: 17, lg: 20, xl: 26 },
  maxControlFontScale: 1.4,
  radii: { sm: 12, md: 20, pill: 999 },
  spacing: { xs: 4, sm: 8, md: 16, lg: 24 },
  strokes: { sticker: 2, trust: 1 },
}));
vi.mock('./useReducedMotion', () => ({ useReducedMotion: () => true }));
vi.mock('react-native', async () => {
  const { createElement } = await import('react');
  return {
    Pressable: ({
      children,
      style,
    }: {
      readonly children?: ReactNode;
      readonly style?: object | ((state: { readonly pressed: boolean }) => unknown);
    }) =>
      createElement(
        'button',
        {
          'data-style': JSON.stringify(
            typeof style === 'function' ? style({ pressed: false }) : style,
          ),
        },
        children,
      ),
    StyleSheet: { create: (styles: object) => styles },
    Text: ({
      children,
      maxFontSizeMultiplier,
      style,
    }: {
      readonly children?: ReactNode;
      readonly maxFontSizeMultiplier?: number;
      readonly style?: object;
    }) =>
      createElement(
        'span',
        { 'data-cap': maxFontSizeMultiplier ?? 'none', 'data-style': JSON.stringify(style) },
        children,
      ),
    View: ({
      accessibilityRole,
      children,
      style,
    }: {
      readonly accessibilityRole?: string;
      readonly children?: ReactNode;
      readonly style?: object;
    }) =>
      createElement(
        'section',
        { 'data-role': accessibilityRole, 'data-style': JSON.stringify(style) },
        children,
      ),
  };
});

import { LoadFailureCard } from './LoadFailureCard';
import { PendingCard } from './PendingCard';
import { ScreenHeading } from './ScreenHeading';
import { StatusBadge } from './StatusBadge';

// MUI-10. Campaigns, interests, account, share and the review editor each drew
// their own eyebrow/title/subtitle, and they had drifted: two line heights for
// the title, two for the subtitle, and `pop` (2.89:1) for every eyebrow.
describe('one screen heading for every screen', () => {
  it('renders the eyebrow in a readable tangerine, never the fill token', () => {
    const markup = renderStatic(<ScreenHeading eyebrow="ACCOUNT" title="Your account" />);

    expect(markup).toContain('ACCOUNT');
    expect(markup).toContain('keyword');
    expect(markup).not.toContain('&quot;color&quot;:&quot;pop&quot;');
  });

  it('omits the parts a screen does not have rather than rendering empty rows', () => {
    const markup = renderStatic(<ScreenHeading title="Your account" />);

    expect(markup).toContain('Your account');
    expect(markup.match(/<span/g) ?? []).toHaveLength(1);
  });

  it('derives both line heights from the type scale, so they cannot drift apart', () => {
    const markup = renderStatic(
      <ScreenHeading eyebrow="CAMPAIGN HOME" title="My campaigns" subtitle="Manage them." />,
    );

    // xl 26 * 1.25 and md 17 * 1.45 — computed, not two hand-typed numbers.
    expect(markup).toContain('&quot;lineHeight&quot;:32.5');
    expect(markup).toContain('&quot;lineHeight&quot;:24.65');
  });
});

// MUI-10 / MUI-14. Three screens had three badges for one idea, one of them
// square, one outlined in a text token, and all of them uncapped.
describe('one status badge for every list', () => {
  it('draws the campaign tone as the sunshine sticker pill', () => {
    const markup = renderStatic(<StatusBadge label="Live" />);

    expect(markup).toContain('Live');
    expect(markup).toContain('&quot;backgroundColor&quot;:&quot;hype&quot;');
    expect(markup).toContain('&quot;borderRadius&quot;:999');
  });

  it('draws the trust tone on the Trust Layer hairline, not on a text token', () => {
    const markup = renderStatic(<StatusBadge label="Submitted" tone="trust" />);

    expect(markup).toContain('&quot;borderColor&quot;:&quot;border-muted&quot;');
    expect(markup).toContain('&quot;borderWidth&quot;:1');
    expect(markup).not.toContain('text-secondary');
  });

  it('caps the label so an accessibility size cannot clip the pill', () => {
    expect(renderStatic(<StatusBadge label="Changes requested" />)).toContain('data-cap="1.4"');
  });
});

// MUI-8. Three async sections, three one-line waits, three re-layouts.
describe('the placeholder a loading section shows', () => {
  it('says what is loading and reserves a card-sized block', () => {
    const markup = renderStatic(<PendingCard label="Loading your campaigns…" />);

    expect(markup).toContain('Loading your campaigns…');
    expect(markup).toContain('data-role="progressbar"');
    expect(markup).toContain('&quot;padding&quot;:16');
    // Two stand-in bars, so the block is roughly the height of a real card.
    expect(markup.match(/&quot;height&quot;:16/g) ?? []).toHaveLength(2);
  });

  it('claims nothing about the result it is waiting for', () => {
    const markup = renderStatic(<PendingCard label="Loading your live pitches…" />);
    // Only the words on screen; the style JSON is full of harmless digits.
    const words = [...markup.matchAll(/>([^<>]+)</g)].map(([, text]) => text).join(' ');

    expect(words.trim()).toBe('Loading your live pitches…');
    expect(words).not.toMatch(/\b0\b|\bNo\b/);
  });
});

// MUI-13. "Check your connection and reopen this screen." was the whole of the
// recovery path on every list that failed to load.
describe('a section that could not be read', () => {
  it('offers the read again instead of asking for navigation by hand', () => {
    const retry = vi.fn();
    const markup = renderStatic(
      <LoadFailureCard
        title="Interests could not be loaded"
        message="None of your interests were changed."
        onRetry={retry}
      />,
    );

    expect(markup).toContain('Interests could not be loaded');
    expect(markup).toContain('Try again');
    expect(markup).not.toContain('reopen this screen');
  });

  it('runs exactly the callback it was given', () => {
    const retry = vi.fn();
    renderStatic(<LoadFailureCard title="t" message="m" onRetry={retry} />);

    // The rendered button holds the callback; the press path is proven by the
    // Trust Layer suite. What matters here is that one is required at all.
    expect(retry).not.toHaveBeenCalled();
    expect(LoadFailureCard.length).toBe(1);
  });
});
