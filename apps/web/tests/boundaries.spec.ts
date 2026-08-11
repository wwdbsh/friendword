import { expect, test } from '@playwright/test';

// BRANDED DEAD ENDS, IN A REAL BROWSER — T013 / WUI-4 (Issue #50).
//
// tests-ui/boundary-screens.ui.test.tsx mounts the boundary components; this
// spec proves the routing half, which is the part that cannot be unit tested:
// that Next.js actually resolves these files for a bad URL, and — the finding
// that nearly slipped through — that it still answers 404 while doing it.
//
// The status code is not incidental. A `loading.tsx` anywhere ABOVE
// `/p/[campaignSlug]` makes Next flush the response before the page resolves,
// after which `notFound()` can no longer set the status: with a root
// `app/loading.tsx` in place, `/p/<unknown>` measurably answered 200 with 404
// content. Boundaries were moved to the segments that never call `notFound()`
// so the public pitch URL keeps an honest status, and this test is what holds
// that line.

test('an unknown URL gets the product’s own 404, not the framework’s', async ({ page }) => {
  const response = await page.goto('/no-such-page');

  expect(response?.status()).toBe(404);
  await expect(page.getByRole('heading', { name: 'This page isn’t here.' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Go to Friendword' })).toHaveAttribute('href', '/');
  // The framework's default screen, which this replaces.
  await expect(page.getByText('This page could not be found.')).toHaveCount(0);
});

test('an unknown campaign slug gets the campaign 404 and a real 404 status', async ({ page }) => {
  const response = await page.goto('/p/t013-no-such-campaign');

  expect(response?.status()).toBe(404);
  await expect(page.getByRole('heading', { name: 'This pitch isn’t here.' })).toBeVisible();
  // A stranger who arrived from a reel is given somewhere to go.
  await expect(page.getByRole('link', { name: 'See a demo pitch' })).toHaveAttribute(
    'href',
    '/p/demo-blair',
  );
  await expect(page.getByRole('link', { name: 'Go to Friendword' })).toBeVisible();
});

test('the interest step of an unknown campaign lands on the same boundary', async ({ page }) => {
  const response = await page.goto('/p/t013-no-such-campaign/interest');

  expect(response?.status()).toBe(404);
  await expect(page.getByRole('heading', { name: 'This pitch isn’t here.' })).toBeVisible();
});
