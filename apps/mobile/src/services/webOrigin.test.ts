import { beforeEach, describe, expect, it, vi } from 'vitest';

// `expo-constants` cannot load outside a native runtime, so the app config is
// stubbed here — this suite is the one place the real origin resolution
// (schema check, trailing-slash trim, fallback) is proven. The screen suites
// stub these builders and rely on this file for the URL itself.
const state = vi.hoisted(() => ({
  config: null as { readonly extra?: Record<string, unknown> } | null,
}));

vi.mock('expo-constants', () => ({
  default: {
    get expoConfig() {
      return state.config;
    },
  },
}));

import { buildConsentUrl, buildInboxUrl, buildRoomsUrl, getWebOrigin } from './webOrigin';

const TOKEN = 'b0b1c2d3-e4f5-4607-8899-aabbccddeeff';

beforeEach(() => {
  state.config = null;
});

describe('web origin resolution', () => {
  it('builds the account URLs from the configured origin', () => {
    state.config = { extra: { webOrigin: 'https://friendword.app' } };

    expect(getWebOrigin()).toBe('https://friendword.app');
    expect(buildInboxUrl()).toBe('https://friendword.app/inbox');
    expect(buildRoomsUrl()).toBe('https://friendword.app/rooms');
    expect(buildConsentUrl(TOKEN)).toBe(`https://friendword.app/consent/${TOKEN}`);
  });

  it('trims a trailing slash so the path is never doubled', () => {
    state.config = { extra: { webOrigin: 'https://friendword.app/' } };

    // A doubled slash is not merely ugly: `//inbox` is a protocol-relative
    // path, so a link built from it can leave the app's own origin.
    expect(buildInboxUrl()).toBe('https://friendword.app/inbox');
    expect(buildRoomsUrl()).toBe('https://friendword.app/rooms');
  });

  it('falls back to the local dev server when nothing is configured', () => {
    state.config = { extra: {} };

    expect(getWebOrigin()).toBe('http://localhost:3000');
    expect(buildInboxUrl()).toBe('http://localhost:3000/inbox');
    expect(buildRoomsUrl()).toBe('http://localhost:3000/rooms');
  });

  it('falls back when there is no app config at all', () => {
    state.config = null;

    expect(buildInboxUrl()).toBe('http://localhost:3000/inbox');
  });

  it('refuses a configured value that is not a URL', () => {
    // A half-configured build must not produce `friendword.app/inbox` as a
    // relative path handed to Linking.openURL.
    state.config = { extra: { webOrigin: 'friendword.app' } };

    expect(getWebOrigin()).toBe('http://localhost:3000');
  });
});
