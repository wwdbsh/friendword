import { expect, test, type Page } from '@playwright/test';

// UNIVERSAL SIGN-OUT — T008 / Issue #45.
//
// The UI suite pins the component behaviour; this pins the thing a person
// actually does: click the control on a real page and end up somewhere that no
// longer knows who they are. It is asserted end to end because the stored
// session is a browser fact — the `friendword-web-auth` localStorage key is
// what the next visitor to this browser would inherit, and no jsdom test can
// speak to that.

const DATER_ID = '00000000-0000-0000-0000-000000000002';
const CAMPAIGN_ID = '20000000-0000-0000-0000-000000000001';
const AUTH_STORAGE_KEY = 'friendword-web-auth';

async function seedSignedInSession(page: Page): Promise<void> {
  const session = {
    access_token: 'playwright-access-token',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 315_360_000,
    refresh_token: 'playwright-refresh-token',
    user: {
      id: DATER_ID,
      aud: 'authenticated',
      role: 'authenticated',
      email: 'dater@example.com',
      app_metadata: {},
      user_metadata: {},
      created_at: '2026-07-13T00:00:00Z',
    },
  };
  // Seeded ONCE per browser context, not on every navigation: this suite signs
  // out and then walks back in by URL, and an init script that re-seeded would
  // hand the session straight back and hide the very regression under test.
  await page.addInitScript(
    ([key, value, guard]) => {
      if (window.sessionStorage.getItem(guard) !== null) {
        return;
      }
      window.sessionStorage.setItem(guard, '1');
      window.localStorage.setItem(key, value);
    },
    [AUTH_STORAGE_KEY, JSON.stringify(session), 'playwright-session-seeded'] as const,
  );
}

async function mockDaterBackend(page: Page): Promise<void> {
  await page.route('**/rest/v1/campaigns*', (route) =>
    route.fulfill({
      json: [
        {
          id: CAMPAIGN_ID,
          slug: 'blair-mix123',
          status: 'published',
          owner_user_id: DATER_ID,
          pitch_draft_id: '10000000-0000-0000-0000-000000000001',
          published_at: '2026-07-13T00:00:00Z',
          ends_at: null,
          created_at: '2026-07-13T00:00:00Z',
          updated_at: '2026-07-13T00:00:00Z',
        },
      ],
    }),
  );
  await page.route('**/rest/v1/rpc/get_campaign_pass_state*', (route) =>
    route.fulfill({ json: [{ pass_active: false, pass_expires_at: null }] }),
  );
  await page.route('**/rest/v1/rpc/list_campaign_interests*', (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route('**/rest/v1/rpc/list_my_intro_rooms*', (route) => route.fulfill({ json: [] }));
  // Supabase's global sign-out. Answering it is what proves the click reached
  // the network and did not merely clear storage locally.
  await page.route('**/auth/v1/logout*', (route) => route.fulfill({ status: 204, body: '' }));
}

function storedSession(page: Page): Promise<string | null> {
  return page.evaluate((key) => window.localStorage.getItem(key), AUTH_STORAGE_KEY);
}

test('signing out from the inbox lands on a landing page that no longer knows you', async ({
  page,
}) => {
  await seedSignedInSession(page);
  await mockDaterBackend(page);

  await page.goto('/inbox');
  await expect(page.getByRole('heading', { name: 'People who want to meet you.' })).toBeVisible();
  expect(await storedSession(page)).not.toBeNull();

  await page.getByRole('button', { name: 'Sign out' }).click();

  await page.waitForURL((url) => url.pathname === '/');
  // The landing's account door is session-aware; after signing out it must not
  // advertise an inbox this browser can no longer open (§12).
  await expect(page.getByRole('link', { name: 'My inbox' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'See the demo' })).toBeVisible();
  // The stored session is the thing the next person on this browser inherits.
  expect(await storedSession(page)).toBeNull();
});

test('the signed-out inbox is a sign-in gate, not the previous account’s inbox', async ({
  page,
}) => {
  await seedSignedInSession(page);
  await mockDaterBackend(page);

  await page.goto('/inbox');
  await expect(page.getByRole('heading', { name: 'People who want to meet you.' })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.waitForURL((url) => url.pathname === '/');

  // Walking back in by URL — the case a shared browser actually produces.
  await page.goto('/inbox');

  await expect(page.getByRole('heading', { name: 'See who wants to meet you.' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'People who want to meet you.' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Sign out' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Email me a sign-in link' })).toBeVisible();
});

// The kit is the introducer's surface and carries no account tabs, so before
// this it was the screen with the fewest ways out of all.
test('the introducer can sign out of the launch kit', async ({ page }) => {
  await seedSignedInSession(page);
  await mockDaterBackend(page);
  await page.route('**/rest/v1/pitch_drafts*', (route) =>
    route.fulfill({ status: 500, json: { message: 'unavailable' } }),
  );

  await page.goto('/kit/10000000-0000-0000-0000-000000000001');

  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.waitForURL((url) => url.pathname === '/');
  expect(await storedSession(page)).toBeNull();
});

// /auth/confirm is a person in the act of signing IN.
test('the sign-in confirmation screen offers no sign-out', async ({ page }) => {
  await seedSignedInSession(page);
  await mockDaterBackend(page);

  await page.goto('/auth/confirm?token_hash=abc123');

  await expect(page.getByRole('button', { name: 'Sign me in' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign out' })).toHaveCount(0);
});

// A signed-out visitor is never told about a control that would do nothing.
test('a signed-out visitor sees no sign-out control', async ({ page }) => {
  await mockDaterBackend(page);

  await page.goto('/inbox');

  await expect(page.getByRole('heading', { name: 'See who wants to meet you.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign out' })).toHaveCount(0);
});
