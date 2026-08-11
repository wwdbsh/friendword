import type { PitchStructure } from '@friendword/contracts';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderStatic } from '../../testing/renderStatic';

const platform = vi.hoisted(() => ({ os: 'ios' as 'ios' | 'android' }));

vi.mock('@friendword/ui-tokens', () => ({
  colors: {
    background: '',
    borderMuted: '',
    danger: '',
    hype: '',
    ink: '',
    keyword: '',
    textFaint: '',
    textSecondary: '',
    verified: '',
  },
  fonts: { body: '', display: '' },
  fontSizes: { xs: 1, sm: 1, md: 1, lg: 1, xl: 1 },
  radii: { sm: 1, md: 1 },
  spacing: { xs: 1, sm: 1, md: 1, lg: 1, xxl: 1 },
  strokes: { sticker: 2, trust: 1 },
}));
vi.mock('react-native', async () => {
  const { createElement } = await import('react');
  const passthrough =
    (tag: string) =>
    ({ children }: { readonly children?: ReactNode }) =>
      createElement(tag, null, children);
  return {
    KeyboardAvoidingView: ({
      behavior,
      children,
    }: {
      readonly behavior?: string;
      readonly children?: ReactNode;
    }) =>
      createElement('keyboard-avoiding-view', { 'data-behavior': behavior ?? 'none' }, children),
    get Platform() {
      return { OS: platform.os };
    },
    ScrollView: ({
      children,
      keyboardShouldPersistTaps,
    }: {
      readonly children?: ReactNode;
      readonly keyboardShouldPersistTaps?: string;
    }) => createElement('main', { 'data-taps': keyboardShouldPersistTaps }, children),
    StyleSheet: { create: (styles: object) => styles },
    Text: passthrough('span'),
    TextInput: ({ accessibilityLabel }: { readonly accessibilityLabel?: string }) =>
      createElement('input', { 'aria-label': accessibilityLabel }),
    View: passthrough('div'),
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
    HypeButton: ({ label }: { readonly label: string }) => createElement('button', null, label),
    ScreenHeading: ({
      eyebrow,
      title,
      subtitle,
    }: {
      readonly eyebrow?: string;
      readonly title: string;
      readonly subtitle?: string;
    }) => createElement('header', null, `${eyebrow ?? ''}|${title}|${subtitle ?? ''}`),
    StickerCard: ({ children }: { readonly children?: ReactNode }) =>
      createElement('article', null, children),
  };
});

import { PitchReviewEditor } from './PitchReviewEditor';
import type { PitchReview } from '../../services/types';

const structure: PitchStructure = {
  hook: 'Hook',
  relationship_context: 'Context',
  three_specific_qualities: ['One', 'Two', 'Three'],
  evidence_or_anecdote: 'Evidence',
  good_match_for: 'Someone kind',
  hard_claims_requiring_confirmation: [],
};

function review(overrides: Partial<PitchReview> = {}): PitchReview {
  return {
    headline: 'Headline',
    body: 'Body',
    structure,
    generationMode: 'generated',
    responseNote: null,
    ...overrides,
  };
}

function renderEditor(overrides: Partial<PitchReview> = {}): string {
  return renderStatic(
    <PitchReviewEditor
      busy={false}
      errorMessage={null}
      friendName="Jordan"
      onChange={vi.fn()}
      onSubmit={vi.fn()}
      review={review(overrides)}
    />,
  );
}

// MUI-2. Nine text inputs and a send button, and no keyboard handling at all:
// on iOS the keyboard covered the lower fields and the only way to submit.
describe('the review editor and the keyboard', () => {
  it('lifts its content on iOS, where the keyboard overlays the screen', () => {
    platform.os = 'ios';

    expect(renderEditor()).toContain('<keyboard-avoiding-view data-behavior="padding">');
  });

  it('leaves the behavior off on Android, which resizes the window itself', () => {
    platform.os = 'android';

    expect(renderEditor()).toContain('<keyboard-avoiding-view data-behavior="none">');
  });

  it('keeps taps working while the keyboard is up', () => {
    platform.os = 'ios';

    expect(renderEditor()).toContain('data-taps="handled"');
  });

  it('still renders every field it is responsible for', () => {
    platform.os = 'ios';
    const markup = renderEditor();

    for (const label of [
      'Headline',
      'Pitch body',
      'Hook',
      'Relationship context',
      'Specific quality 1',
      'Specific quality 2',
      'Specific quality 3',
      'Evidence or anecdote',
      'A good match for',
    ]) {
      expect(markup).toContain(`aria-label="${label}"`);
    }
    expect(markup).toContain('Send for approval');
  });
});

// MUI-9. A hand-placed \n split one sentence across two lines at exactly one
// width and mid-phrase at every other.
describe('the editor copy wraps rather than breaking by hand', () => {
  it('writes the manual-mode note as one flowing sentence', () => {
    const markup = renderEditor({ generationMode: 'manual' });

    expect(markup).toContain(
      'AI drafting unlocks once an OpenAI key is set. You can write it yourself.',
    );
    expect(markup).not.toContain('\n');
  });
});
