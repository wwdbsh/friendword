// T002 (Issue #71) — the "what should we call you?" sheet.
//
// The one behaviour worth pinning in the markup is what the field does NOT
// contain. `handle_new_auth_user` (0011) already put a name in the profile:
// the local part of the person's email address. Prefilling the field with it
// would turn a question into a default, and the default would then be printed
// on somebody else's public page. So the field starts empty, and the component
// is given no way to receive a name to start from.
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
    Modal: ({ children, visible }: { readonly children?: ReactNode; readonly visible: boolean }) =>
      visible ? createElement('dialog', null, children) : null,
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
      keyboardShouldPersistTaps,
    }: {
      readonly children?: ReactNode;
      readonly keyboardShouldPersistTaps?: string;
    }) => createElement('main', { 'data-taps': keyboardShouldPersistTaps }, children),
    StyleSheet: { create: (styles: object) => styles },
    Text: ({ children }: { readonly children?: ReactNode }) =>
      createElement('span', null, children),
    TextInput: ({
      accessibilityLabel,
      placeholder,
      value,
    }: {
      readonly accessibilityLabel?: string;
      readonly placeholder?: string;
      readonly value?: string;
    }) =>
      createElement('input', {
        'aria-label': accessibilityLabel,
        placeholder,
        // `readOnly` only silences React's controlled-input warning; the real
        // component is controlled by its own state.
        readOnly: true,
        value,
      }),
    View: ({ children, style }: { readonly children?: ReactNode; readonly style?: unknown }) =>
      createElement('section', { 'data-style': JSON.stringify(style) }, children),
  };
});

import { DisplayNameSheet } from './DisplayNameSheet';

const SOURCE = readFileSync(join(process.cwd(), 'src/features/auth/DisplayNameSheet.tsx'), 'utf8');

function renderSheet(overrides: { readonly busy?: boolean; readonly error?: string | null } = {}) {
  return renderStatic(
    <DisplayNameSheet
      visible
      busy={overrides.busy ?? false}
      errorMessage={overrides.error ?? null}
      onClose={vi.fn()}
      onConfirm={vi.fn()}
    />,
  );
}

describe('the name sheet asks rather than assumes', () => {
  it('opens with an empty field', () => {
    const markup = renderSheet();

    expect(markup).toContain('aria-label="Your name"');
    expect(markup).toContain('value=""');
  });

  // A prop carrying the stored name is the only way this field could ever be
  // prefilled with the email local-part, so the component does not have one.
  it('has no prop through which a stored name could be supplied', () => {
    const props = SOURCE.slice(
      SOURCE.indexOf('type DisplayNameSheetProps'),
      SOURCE.indexOf('};', SOURCE.indexOf('type DisplayNameSheetProps')),
    );

    expect(props).not.toContain('initial');
    expect(props).not.toContain('currentName');
    expect(props).not.toContain('displayName');
  });

  it('says whose eyes this name is for', () => {
    const markup = renderSheet();

    expect(markup).toContain('What should we call you?');
    expect(markup).toContain('This is the name on the pitch');
  });

  it('keeps a way out and lets taps land with the keyboard up', () => {
    const markup = renderSheet();

    expect(markup).toContain('Not now');
    expect(markup).toContain('aria-label="Close name entry"');
    expect(markup).toContain('data-taps="handled"');
  });

  it('shows a save failure in the sheet rather than closing over it', () => {
    expect(renderSheet({ error: 'We could not save that name.' })).toContain(
      'We could not save that name.',
    );
  });

  it('uses the token bold face rather than a weight a custom family ignores', () => {
    const stylesheet = SOURCE.slice(SOURCE.indexOf('StyleSheet.create'));

    expect(stylesheet).not.toContain('fontWeight');
    expect(stylesheet).toContain('BricolageGrotesqueBold');
  });
});
