import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderStatic } from '../../testing/renderStatic';

vi.mock('@friendword/ui-tokens', () => ({
  colors: {
    background: 'background',
    danger: 'danger',
    hype: 'hype',
    ink: 'ink',
    onHype: 'on-hype',
    onPop: 'on-pop',
    pop: 'pop',
    popPressed: 'pop-pressed',
    surface: 'surface',
    textFaint: 'text-faint',
    textSecondary: 'text-secondary',
  },
  fonts: { body: 'body', display: 'display' },
  fontSizes: { xs: 12, sm: 14, md: 17, lg: 20, xl: 26 },
  maxControlFontScale: 1.4,
  radii: { md: 20, lg: 32, pill: 999 },
  spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 40 },
  strokes: { sticker: 2, trust: 1 },
}));
vi.mock('react-native', async () => {
  const { createElement } = await import('react');
  return {
    ActivityIndicator: () => createElement('progress'),
    Keyboard: { addListener: () => ({ remove: () => {} }) },
    Modal: ({ children, visible }: { readonly children?: ReactNode; readonly visible: boolean }) =>
      visible ? createElement('dialog', null, children) : null,
    Platform: { OS: 'ios' },
    Pressable: ({
      accessibilityLabel,
      children,
      style,
    }: {
      readonly accessibilityLabel?: string;
      readonly children?: ReactNode;
      readonly style?: object | ((state: { readonly pressed: boolean }) => unknown);
    }) =>
      createElement(
        'button',
        {
          'aria-label': accessibilityLabel,
          'data-style': JSON.stringify(
            typeof style === 'function' ? style({ pressed: false }) : style,
          ),
        },
        children,
      ),
    ScrollView: ({
      children,
      contentContainerStyle,
      keyboardShouldPersistTaps,
    }: {
      readonly children?: ReactNode;
      readonly contentContainerStyle?: object;
      readonly keyboardShouldPersistTaps?: string;
    }) =>
      createElement(
        'main',
        {
          'data-style': JSON.stringify(contentContainerStyle),
          'data-taps': keyboardShouldPersistTaps,
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
    TextInput: ({ accessibilityLabel }: { readonly accessibilityLabel?: string }) =>
      createElement('input', { 'aria-label': accessibilityLabel }),
    View: ({ children, style }: { readonly children?: ReactNode; readonly style?: unknown }) =>
      createElement('section', { 'data-style': JSON.stringify(style) }, children),
  };
});
vi.mock('../../services/authSession', () => ({ createAuthGateway: vi.fn() }));
vi.mock('../../services/supabaseClient', () => ({ getSupabaseClient: () => null }));

import { SignInSheet } from './SignInSheet';

const SOURCE = readFileSync(join(process.cwd(), 'src/features/auth/SignInSheet.tsx'), 'utf8');

function renderSheet(): string {
  return renderStatic(<SignInSheet visible onClose={vi.fn()} onSignedIn={vi.fn()} />);
}

// MUI-12. The sheet had no scroll view and no height cap, so on a small phone
// with the keyboard up the error text and the "Not now" escape were off-screen
// with no way to reach them — on the modal that gates sending a pitch.
describe('the sign-in sheet on a short screen', () => {
  it('caps its own height so the backdrop is always reachable', () => {
    expect(renderSheet()).toContain('&quot;maxHeight&quot;:&quot;88%&quot;');
  });

  it('scrolls its contents, with taps still landing while the keyboard is up', () => {
    const markup = renderSheet();

    expect(markup).toContain('<main');
    expect(markup).toContain('data-taps="handled"');
  });

  it('keeps every escape inside that scroll view', () => {
    const markup = renderSheet();

    expect(markup).toContain('Not now');
    expect(markup).toContain('aria-label="Close sign-in"');
  });
});

// MUI-11. The only screen in the app that styled itself outside the token
// system, and the only one whose bold text was not bold: a custom fontFamily
// has one weight per registered name, so `fontWeight: '700'` on
// 'BricolageGrotesque' rendered regular while claiming bold.
describe('the sign-in sheet inside the design system', () => {
  it('asks for the bold face by name instead of a weight that does nothing', () => {
    const stylesheet = SOURCE.slice(SOURCE.indexOf('StyleSheet.create'));

    expect(stylesheet).not.toContain('fontWeight');
    expect(stylesheet).toContain('BricolageGrotesqueBold');
  });

  it('takes every size, radius and stroke from the token package', () => {
    // No bare pixel values left in the stylesheet except the letter-spacing of
    // the OTP field and the press scale, which have no tokens.
    const stylesheet = SOURCE.slice(SOURCE.indexOf('StyleSheet.create'));
    const literals = [...stylesheet.matchAll(/\b(fontSize|borderWidth|borderRadius):\s*\d+/g)];

    expect(literals).toEqual([]);
    expect(stylesheet).toContain('fontSizes.md');
    expect(stylesheet).toContain('strokes.sticker');
    expect(stylesheet).toContain('radii.lg');
  });

  it('gives its two text-only escapes a 44pt target', () => {
    const stylesheet = SOURCE.slice(SOURCE.indexOf('StyleSheet.create'));

    expect(stylesheet).toContain('secondaryButton');
    expect(stylesheet).toContain('minHeight: 44');
  });

  it('caps the labels whose control has a fixed height (MUI-14)', () => {
    const markup = renderSheet();

    // The badge and the primary action are capped; the body copy is not.
    expect(markup).toContain('data-cap="1.4"');
    expect(markup).toContain('data-cap="none"');
  });
});
