import { afterEach, describe, expect, it } from 'vitest';

import {
  END_CARD_BRAND,
  END_CARD_MS,
  buildEndCard,
  endCardUrlText,
  resolveShareOrigin,
} from '@/lib/pitchRender/endCard';

const ENV_KEYS = ['FRIENDWORD_SHARE_ORIGIN', 'VERCEL_PROJECT_PRODUCTION_URL'] as const;
const saved = ENV_KEYS.map((key) => [key, process.env[key]] as const);

afterEach(() => {
  for (const [key, value] of saved) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe('P4: the end card is platform constants plus the canonical URL', () => {
  it('is a short outro, not a persistent watermark', () => {
    expect(END_CARD_MS).toBeGreaterThanOrEqual(1_000);
    expect(END_CARD_MS).toBeLessThanOrEqual(2_000);
  });

  it('prints host + /p/slug from the configured origin, no protocol', () => {
    expect(endCardUrlText('https://friendword.example', 'demo-blair')).toBe(
      'friendword.example/p/demo-blair',
    );
    expect(endCardUrlText('http://localhost:3000', 'demo-blair')).toBe(
      'localhost:3000/p/demo-blair',
    );
  });

  it('builds only the two constant fields — no free-text slot exists', () => {
    const card = buildEndCard('https://friendword.example', 'demo-blair');
    expect(card).toEqual({
      brand: END_CARD_BRAND,
      urlText: 'friendword.example/p/demo-blair',
    });
    expect(Object.keys(card)).toEqual(['brand', 'urlText']);
  });

  it('throws on a malformed origin instead of rendering garbage', () => {
    expect(() => endCardUrlText('not a url', 'demo')).toThrowError();
  });
});

describe('the share origin is configuration, never a hardcoded domain', () => {
  it('prefers the explicit env override', () => {
    process.env.FRIENDWORD_SHARE_ORIGIN = 'https://fw.example';
    process.env.VERCEL_PROJECT_PRODUCTION_URL = 'prod.vercel.app';
    expect(resolveShareOrigin('http://localhost:3000')).toBe('https://fw.example');
  });

  it('falls back to the production deployment host, then the caller', () => {
    delete process.env.FRIENDWORD_SHARE_ORIGIN;
    process.env.VERCEL_PROJECT_PRODUCTION_URL = 'prod.vercel.app';
    expect(resolveShareOrigin('http://localhost:3000')).toBe('https://prod.vercel.app');
    delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
    expect(resolveShareOrigin('http://localhost:3000')).toBe('http://localhost:3000');
    expect(resolveShareOrigin(null)).toBeNull();
  });
});
