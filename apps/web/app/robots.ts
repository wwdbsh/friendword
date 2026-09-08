import { headers } from 'next/headers';
import type { MetadataRoute } from 'next';

import { siteOrigin } from '@/lib/siteOrigin';

// The host is read per request, so this cannot be a build-time static file.
export const dynamic = 'force-dynamic';

/**
 * Everything a crawler is allowed to see (L-1).
 *
 * The site is open by default (`Allow: /`) and the DISALLOW list is what does
 * the work here — a crawler that ignores it is not stopped by anything on this
 * page. Every entry on it is a signed-in surface holding a real person's
 * private material: the interest inbox, the intro rooms, the consent review of
 * a pitch nobody has approved yet, the paid launch kit. None of it is a page
 * anyone would want indexed, and several render content the subject has not
 * agreed to publish. The named allows are redundant against `Allow: /` and are
 * kept as documentation — they are the four pages we positively want crawled,
 * and the three legal ones are what an App Store reviewer follows.
 *
 * None of this is an access control. These routes are protected by auth and
 * RLS; robots.txt only keeps them out of a search index.
 *
 * `/p/*` is NOT disallowed. A published pitch is public by the subject's own
 * decision and being shareable is the product; a crawler reaching one is the
 * same event as a friend opening the link. They are simply absent from the
 * sitemap (see app/sitemap.ts for why).
 *
 * `/api` and `/auth` are listed even though neither serves indexable HTML:
 * `/auth/confirm` carries single-use sign-in tokens in the URL, and a
 * prefetching crawler that follows one BURNS it before the person clicks.
 */
export default async function robots(): Promise<MetadataRoute.Robots> {
  const origin = siteOrigin(await headers());

  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/', '/privacy', '/terms', '/support', '/p/demo-blair'],
        disallow: [
          '/inbox',
          '/interests',
          '/rooms',
          '/me',
          '/kit',
          '/consent',
          '/internal',
          '/api',
          '/auth',
        ],
      },
    ],
    sitemap: new URL('/sitemap.xml', origin).toString(),
  };
}
