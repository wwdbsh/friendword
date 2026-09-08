import { headers } from 'next/headers';
import type { MetadataRoute } from 'next';

import { siteOrigin } from '@/lib/siteOrigin';

export const dynamic = 'force-dynamic';

/**
 * The pages that are ours to advertise (L-1).
 *
 * Only durable, editorially-owned URLs are listed: the landing page, the
 * three legal/support pages the App Store submission requires, and the demo
 * pitch — which is a fixture we ship, not someone's campaign.
 *
 * REAL `/p/<slug>` CAMPAIGNS ARE DELIBERATELY ABSENT. A campaign is published
 * for a fixed window (7 or 14 days) and then ends, so any list of them is
 * stale within days and a sitemap full of expired pages is a quality signal
 * against the whole site. Worse, enumerating live campaigns here would turn a
 * link a person chose to share with a few friends into a directory of
 * datable people — the opposite of "share one link". They stay crawlable if
 * someone links to them (see app/robots.ts); we just never publish the index.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = siteOrigin(await headers());
  const url = (path: string): string => new URL(path, origin).toString();

  return [
    { url: url('/'), changeFrequency: 'weekly', priority: 1 },
    { url: url('/p/demo-blair'), changeFrequency: 'monthly', priority: 0.8 },
    { url: url('/privacy'), changeFrequency: 'yearly', priority: 0.5 },
    { url: url('/terms'), changeFrequency: 'yearly', priority: 0.5 },
    { url: url('/support'), changeFrequency: 'monthly', priority: 0.5 },
  ];
}
