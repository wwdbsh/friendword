import { expect, test } from '@playwright/test';

import type { PublishedPitch } from '@friendword/data';

import { fromPublishedPitch } from '../src/pitch/view';

test('keeps demo metadata on the static fixture and serves an OG image response', async ({
  page,
  request,
}) => {
  await page.goto('/p/demo-blair');
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
    'content',
    /\/fixtures\/blair-og\.svg$/,
  );

  const demo = await request.get('/api/og?slug=demo-blair');
  expect(demo.status()).toBe(200);
  expect(demo.headers()['content-type']).toContain('image/png');
  expect(demo.headers()['cache-control']).toContain('s-maxage=3600');
});

test('rejects an unknown OG campaign without caching the miss', async ({ request }) => {
  const missing = await request.get('/api/og?slug=not-a-campaign');
  expect(missing.status()).toBe(404);
  expect(missing.headers()['cache-control']).toContain('no-store');
});

test('keeps the real campaign fallback branded and isolated from Blair fixtures', () => {
  const publishedPitch: PublishedPitch = {
    campaignId: '20000000-0000-0000-0000-000000000001',
    campaignSlug: 'alex-real-campaign',
    publishedAt: '2026-07-13T00:00:00Z',
    daterDisplayName: 'Alex',
    introducerDisplayName: 'Jamie',
    relationshipType: 'friend',
    relationshipDuration: 'y3to10',
    headline: 'Alex makes ordinary plans memorable.',
    body: 'A warm introduction approved for publication.',
    transcript: null,
    structure: null,
    daterReviewedStructure: false,
    approximateLocation: null,
    age: null,
    datingIntent: null,
    voiceUrl: null,
    photos: [],
  };

  const view = fromPublishedPitch(publishedPitch);
  expect(view.photos[0].src).toContain('data:image/svg+xml');
  expect(view.photos[0].src).not.toContain('blair');
});
