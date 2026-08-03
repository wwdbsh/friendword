import type { RenderEndCard } from './payload';

// The end card appended AFTER the approved timeline (P4). Everything here is a
// platform constant or derived from the configured share origin — no Dater or
// Introducer authored text can enter, and nothing overlays or replaces an
// approved frame. It is short (well under 2s) so it reads as an outro, not a
// persistent watermark.

export const END_CARD_MS = 1_500;

export const END_CARD_BRAND = 'Friendword';

/**
 * The canonical origin the end card's URL is printed against. An explicit env
 * override first (friendword.com is not registered yet, so nothing is ever
 * hardcoded), then the production deployment host — the same precedence the
 * public page's metadata uses.
 */
export function resolveShareOrigin(fallbackOrigin: string | null): string | null {
  const configured = process.env.FRIENDWORD_SHARE_ORIGIN;
  if (configured !== undefined && configured.length > 0) {
    return configured;
  }
  const deploymentHost = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? null;
  if (deploymentHost !== null && deploymentHost.length > 0) {
    return `https://${deploymentHost}`;
  }
  return fallbackOrigin;
}

/**
 * The display text for the canonical campaign URL: `host/p/slug`, no protocol.
 * Built through `new URL` so a malformed origin throws here rather than
 * rendering garbage into a downloaded file nobody can recall.
 */
export function endCardUrlText(shareOrigin: string, campaignSlug: string): string {
  const url = new URL(`/p/${campaignSlug}`, shareOrigin);
  return `${url.host}${url.pathname}`;
}

export function buildEndCard(shareOrigin: string, campaignSlug: string): RenderEndCard {
  return { brand: END_CARD_BRAND, urlText: endCardUrlText(shareOrigin, campaignSlug) };
}
