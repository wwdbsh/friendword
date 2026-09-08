// LEGAL, SUPPORT AND CRAWLER SURFACE — T006 (App Store blocker B1, L-1).
//
// App Store Connect will not accept a submission without a reachable privacy
// policy URL and a support URL, and a 5.1.2 rejection is what a missing
// privacy page earns. So these are not decorative pages: the assertions below
// are the submission checklist expressed as a test — the three routes answer
// 200, they are named, and the App Store reviewer can find them from the
// landing page without being told where to look.
//
// robots.txt is here for the opposite reason. Every signed-in surface on this
// app renders a real person's private material — an interest inbox, an intro
// room, a pitch its subject has not approved yet. Their absence from a crawler
// allowlist is a privacy property, so it is pinned rather than assumed.

import { expect, test } from '@playwright/test';

const LEGAL_ROUTES = [
  {
    path: '/privacy',
    title: 'Privacy Policy — Friendword',
    heading: 'What we hold, and what we do with it',
  },
  { path: '/terms', title: 'Terms of Service — Friendword', heading: 'The deal between us' },
  { path: '/support', title: 'Support — Friendword', heading: 'Getting help, and getting out' },
] as const;

/** Every route that must stay out of the index. Kept in sync with app/robots.ts. */
const PRIVATE_PREFIXES = [
  '/inbox',
  '/interests',
  '/rooms',
  '/me',
  '/kit',
  '/consent',
  '/internal',
  '/api',
  '/auth',
] as const;

for (const route of LEGAL_ROUTES) {
  test(`${route.path} answers 200, is titled, and says it is a draft`, async ({ page }) => {
    const response = await page.goto(route.path);

    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle(route.title);
    await expect(page.getByRole('heading', { level: 1, name: route.heading })).toBeVisible();
    // The draft banner is the honesty gate: this text has not been through
    // legal review, and the page must not pretend otherwise.
    await expect(page.getByText(/Draft — last reviewed/)).toBeVisible();
  });
}

test('the landing footer reaches all three, and they reach each other', async ({ page }) => {
  await page.goto('/');

  const footer = page.getByRole('navigation', { name: 'Legal and support' });
  await expect(footer.getByRole('link', { name: 'Privacy' })).toHaveAttribute('href', '/privacy');
  await expect(footer.getByRole('link', { name: 'Terms' })).toHaveAttribute('href', '/terms');
  await expect(footer.getByRole('link', { name: 'Support' })).toHaveAttribute('href', '/support');

  await footer.getByRole('link', { name: 'Privacy' }).click();
  await page.waitForURL('**/privacy');
  await page
    .getByRole('navigation', { name: 'Legal and support' })
    .getByRole('link', { name: 'Support' })
    .click();
  await page.waitForURL('**/support');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Getting help, and getting out' }),
  ).toBeVisible();
});

test('the support page names no invented contact address', async ({ page }) => {
  await page.goto('/support');

  // Until the owner decides one, the placeholder is the honest answer. A test
  // that only checked "an email is shown" would happily pass on a fabricated
  // address, which is the failure mode worth preventing.
  await expect(page.getByText('[TO CONFIRM: support email]').first()).toBeVisible();
});

// The audit that produced web-polish-layout.spec.ts found a 20px touch target
// and a 238px text column that every role-and-text assertion had walked past.
// These pages are new surface, so they get the same measured treatment rather
// than inheriting the assumption that a shared stylesheet is enough.
test('the legal pages fit a phone and keep their links tappable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });

  for (const route of LEGAL_ROUTES) {
    await page.goto(route.path);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `${route.path} scrolls sideways on a phone`).toBeLessThanOrEqual(0);

    const nav = page.getByRole('navigation', { name: 'Legal and support' });
    for (const label of ['Privacy', 'Terms', 'Support']) {
      const height = await nav
        .getByRole('link', { name: label })
        .evaluate((element) => element.getBoundingClientRect().height);
      expect(height, `${route.path} → ${label}`).toBeGreaterThanOrEqual(44);
    }
  }
});

test('robots.txt allows the public pages and keeps the private ones out', async ({ request }) => {
  const response = await request.get('/robots.txt');

  expect(response.status()).toBe(200);
  const body = await response.text();

  for (const allowed of ['/privacy', '/terms', '/support', '/p/demo-blair']) {
    expect(body).toContain(`Allow: ${allowed}`);
  }
  for (const prefix of PRIVATE_PREFIXES) {
    expect(body).toContain(`Disallow: ${prefix}`);
  }
  expect(body).toContain('Sitemap:');
  expect(body).toMatch(/Sitemap: https?:\/\/[^\s]+\/sitemap\.xml/);
});

test('sitemap.xml lists the durable pages and no live campaign', async ({ request }) => {
  const response = await request.get('/sitemap.xml');

  expect(response.status()).toBe(200);
  const body = await response.text();

  for (const path of ['/privacy', '/terms', '/support', '/p/demo-blair']) {
    expect(body).toContain(path);
  }
  // Exactly five entries: landing, demo, and the three legal pages. A real
  // campaign expires in 7 or 14 days, and enumerating live ones would turn a
  // link shared with a few friends into a directory of datable people.
  expect(body.match(/<loc>/g) ?? []).toHaveLength(5);
});
