/**
 * The origin this deployment is actually being served from.
 *
 * Extracted from app/p/[campaignSlug]/page.tsx unchanged (L-1): robots.txt and
 * sitemap.xml have to emit absolute URLs, and a second copy of this resolution
 * would be the kind of duplicate that quietly drifts — a sitemap advertising a
 * different host than the OG tags is worse than no sitemap.
 *
 * Order matters. The Vercel-provided host wins because on a preview deployment
 * the forwarded host is the preview alias, and `VERCEL_PROJECT_PRODUCTION_URL`
 * is the only value that names the canonical site. Falling back through
 * x-forwarded-host/host keeps local dev and self-hosted runs honest, and an
 * unparseable result degrades to localhost rather than throwing inside
 * metadata generation.
 */
export type HeaderReader = Pick<Headers, 'get'>;

export function siteOrigin(requestHeaders: HeaderReader): URL {
  const deploymentHost =
    process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL ?? null;
  if (deploymentHost !== null && deploymentHost.length > 0) {
    return new URL(`https://${deploymentHost}`);
  }

  const forwardedHost = requestHeaders.get('x-forwarded-host')?.split(',')[0]?.trim();
  const host = forwardedHost ?? requestHeaders.get('host') ?? 'localhost:3000';
  const forwardedProtocol = requestHeaders.get('x-forwarded-proto')?.split(',')[0]?.trim();
  const protocol =
    forwardedProtocol === 'http' || forwardedProtocol === 'https'
      ? forwardedProtocol
      : host.startsWith('localhost')
        ? 'http'
        : 'https';
  const origin = `${protocol}://${host}`;
  return URL.canParse(origin) ? new URL(origin) : new URL('http://localhost:3000');
}
