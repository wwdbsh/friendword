import { afterEach, describe, expect, it } from 'vitest';

import {
  END_CARD_APPROVED_PREFIX,
  END_CARD_BRAND,
  END_CARD_CTA,
  END_CARD_MS,
  HIGHLIGHT_END_CARD_MS,
  buildEndCard,
  endCardMsForVariant,
  endCardQrDataUri,
  endCardUrl,
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

  it('leaves the legacy card exactly as it was when the variant is full', () => {
    // The rollback path (RENDER_HIGHLIGHT_ENABLED=false) renders this card, so
    // it must not acquire a QR, a badge or a CTA by accident.
    const card = buildEndCard('https://friendword.example', 'demo-blair', {
      variant: 'full',
      daterName: 'Blair',
    });
    expect(Object.keys(card)).toEqual(['brand', 'urlText']);
    expect(endCardMsForVariant('full')).toBe(END_CARD_MS);
  });

  it('throws on a malformed origin instead of rendering garbage', () => {
    expect(() => endCardUrlText('not a url', 'demo')).toThrowError();
  });
});

describe('§2.5: the highlight end card is the call to action', () => {
  it('runs for three seconds — long enough to read and scan', () => {
    expect(HIGHLIGHT_END_CARD_MS).toBe(3_000);
    expect(endCardMsForVariant('highlight')).toBe(3_000);
  });

  it('carries a QR of the campaign URL, the URL, a badge and one fixed CTA', () => {
    const card = buildEndCard('https://friendword.example', 'demo-blair', {
      variant: 'highlight',
      daterName: 'Blair',
    });
    expect(card.urlText).toBe('friendword.example/p/demo-blair');
    expect(card.approvedBy).toBe(`${END_CARD_APPROVED_PREFIX} Blair`);
    expect(card.cta).toBe(END_CARD_CTA);
    expect(card.qrDataUri?.startsWith('data:image/svg+xml')).toBe(true);
    // Every field is a platform constant, the canonical URL, or the Dater's
    // CONFIRMED display name. There is still no slot free text could ride in.
    expect(Object.keys(card).sort()).toEqual([
      'approvedBy',
      'brand',
      'cta',
      'qrDataUri',
      'urlText',
    ]);
  });

  it('omits the badge rather than printing a blank one', () => {
    const card = buildEndCard('https://friendword.example', 'demo-blair', {
      variant: 'highlight',
      daterName: '   ',
    });
    expect(card.approvedBy).toBeNull();
    expect(card.qrDataUri).toBeDefined();
  });

  it('encodes the page URL deterministically, and a different page differently', () => {
    const url = endCardUrl('https://friendword.example', 'demo-blair');
    expect(url).toBe('https://friendword.example/p/demo-blair');
    expect(endCardQrDataUri(url)).toBe(endCardQrDataUri(url));
    expect(endCardQrDataUri(url)).not.toBe(
      endCardQrDataUri(endCardUrl('https://friendword.example', 'demo-other')),
    );
    // A QR is modules, not text: the SVG is one path of unit squares and has
    // no <text>, so nothing readable can be smuggled into the card.
    const svg = decodeURIComponent(endCardQrDataUri(url));
    expect(svg).toContain('<path d="M');
    expect(svg).not.toContain('<text');
    expect(svg).not.toContain('demo-blair');
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
