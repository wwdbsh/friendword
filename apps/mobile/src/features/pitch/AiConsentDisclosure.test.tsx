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
  colors: { ink: '#000', textSecondary: '#555' },
  fonts: { body: 'body' },
  fontSizes: { md: 16, lg: 20 },
}));
vi.mock('react-native', async () => {
  const { createElement } = await import('react');
  return {
    StyleSheet: { create: (styles: object) => styles },
    Text: ({ children }: { readonly children?: ReactNode }) =>
      createElement('span', null, children),
  };
});
vi.mock('../../components', async () => {
  const { createElement } = await import('react');
  return {
    HypeButton: ({ label }: { readonly label: string }) => createElement('button', null, label),
    QuietNavAction: ({ label }: { readonly label: string }) => createElement('button', null, label),
    TrustCard: ({ children }: { readonly children?: ReactNode }) =>
      createElement('article', null, children),
  };
});

import { AiConsentDisclosure } from './AiConsentDisclosure';

describe('AI processing disclosure', () => {
  it('names the provider work, friend control, permission, affirmative action, and refusal path', () => {
    const markup = renderToStaticMarkup(
      <AiConsentDisclosure
        busy={false}
        errorMessage={null}
        onCreateAiDraft={vi.fn()}
        onRetry={vi.fn()}
        onWriteManually={vi.fn()}
        state="required"
      />,
    );

    expect(markup).toContain('Before AI drafts this pitch');
    // Audit decision 2: the copy must separate "saved to private storage"
    // (no third party) from "sent to the external AI provider" (needs consent).
    expect(markup).toContain('saved to Friendword’s private storage first');
    expect(markup).toContain('never sends anything to an outside company');
    expect(markup).toContain('external AI provider, currently OpenAI');
    expect(markup).toContain('can delete everything before anything goes public');
    expect(markup).toContain('permission to share their photos and story');
    expect(markup).toContain('I agree — create the AI draft');
    expect(markup).toContain('Write it myself');
  });
});
