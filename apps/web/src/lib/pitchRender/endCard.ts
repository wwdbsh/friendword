import QRCode from 'qrcode';

import type { RenderEndCard } from './payload';

// Re-exported so the render callers keep one import; the implementation lives
// in ./shareOrigin, which pulls in nothing (the routes that need it must not
// bundle `qrcode`).
export { resolveShareOrigin } from './shareOrigin';

// The end card appended AFTER the approved timeline (P4). Everything here is a
// platform constant or derived from the configured share origin plus the
// Dater's public display name — no Introducer- or Dater-AUTHORED text can
// enter, and nothing overlays or replaces an approved frame.
//
// §2.5 turned it from a 1.5s outro into the reel's call to action: three
// seconds, a QR of the campaign URL, the URL as text for someone watching on
// the device that is holding it, and one fixed CTA line. The 1.5s legacy card
// stays exactly as it was for the full-variant/no-music path, so a render made
// with RENDER_HIGHLIGHT_ENABLED=false is the file it always was.

/** The legacy card (full variant, music off). Unchanged since 2026-08-03. */
export const END_CARD_MS = 1_500;
/** §2.5: the highlight's card has to be readable and scannable. */
export const HIGHLIGHT_END_CARD_MS = 3_000;

export const END_CARD_BRAND = 'Friendword';
/** §2.5 CTA. A platform constant: it is the same line on every reel. */
export const END_CARD_CTA = 'DM FRIEND for the page';
/** §2.5 badge prefix; the name that follows is the publicDisplayName rule. */
export const END_CARD_APPROVED_PREFIX = 'Approved by';

export type RenderVariant = 'full' | 'highlight';

export function endCardMsForVariant(variant: RenderVariant): number {
  return variant === 'highlight' ? HIGHLIGHT_END_CARD_MS : END_CARD_MS;
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

/** The absolute URL the QR encodes — the same page the text names. */
export function endCardUrl(shareOrigin: string, campaignSlug: string): string {
  return new URL(`/p/${campaignSlug}`, shareOrigin).toString();
}

/**
 * A QR of the campaign URL as an SVG data: URI.
 *
 * Drawn from the module matrix rather than through the library's own renderer:
 * the output is then a fixed string we control (one path of unit squares, no
 * generated ids, no timestamps), which is what makes two renders of the same
 * campaign byte-identical. Error correction M — enough to survive a phone
 * screen at reel size without inflating the module count.
 */
export function endCardQrDataUri(url: string): string {
  const qr = QRCode.create(url, { errorCorrectionLevel: 'M' });
  const size = qr.modules.size;
  const data = qr.modules.data;
  const quiet = 2;
  const side = size + quiet * 2;
  let path = '';
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      if (data[row * size + column] === 1) {
        path += `M${column + quiet} ${row + quiet}h1v1h-1z`;
      }
    }
  }
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${side} ${side}" shape-rendering="crispEdges">` +
    `<rect width="${side}" height="${side}" fill="#FFF6EA"/>` +
    `<path d="${path}" fill="#221B15"/></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export type EndCardInput = {
  readonly variant?: RenderVariant;
  /** The Dater's public display name (publicDisplayName), or null. */
  readonly daterName?: string | null;
};

export function buildEndCard(
  shareOrigin: string,
  campaignSlug: string,
  input: EndCardInput = {},
): RenderEndCard {
  const urlText = endCardUrlText(shareOrigin, campaignSlug);
  if ((input.variant ?? 'full') !== 'highlight') {
    // The legacy card: two constant fields and nothing else.
    return { brand: END_CARD_BRAND, urlText };
  }
  const name = input.daterName?.trim();
  return {
    brand: END_CARD_BRAND,
    urlText,
    // "Approved by Blair" — a confirmed display name, never free text.
    approvedBy: name === undefined || name === '' ? null : `${END_CARD_APPROVED_PREFIX} ${name}`,
    cta: END_CARD_CTA,
    qrDataUri: endCardQrDataUri(endCardUrl(shareOrigin, campaignSlug)),
  };
}
