import { expect, test, type Page } from '@playwright/test';

const INTRODUCER_ID = '00000000-0000-0000-0000-000000000001';
const DRAFT_ID = '10000000-0000-0000-0000-000000000001';

async function seedSignedInSession(page: Page): Promise<void> {
  const session = {
    access_token: 'playwright-access-token',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 315_360_000,
    refresh_token: 'playwright-refresh-token',
    user: {
      id: INTRODUCER_ID,
      aud: 'authenticated',
      role: 'authenticated',
      email: 'introducer@example.com',
      app_metadata: {},
      user_metadata: {},
      created_at: '2026-07-13T00:00:00Z',
    },
  };
  await page.addInitScript((value) => {
    window.localStorage.setItem('friendword-web-auth', value);
  }, JSON.stringify(session));
}

async function mockKitData(page: Page, { unlocked }: { readonly unlocked: boolean }) {
  await page.route('**/rest/v1/pitch_drafts*', (route) =>
    route.fulfill({
      json: {
        id: DRAFT_ID,
        created_by_user_id: INTRODUCER_ID,
        subject_user_id: '00000000-0000-0000-0000-000000000002',
        status: 'published',
        headline: 'Blair makes every Tuesday a story.',
        body: 'Body',
        created_at: '2026-07-13T00:00:00Z',
        updated_at: '2026-07-13T00:00:00Z',
      },
    }),
  );
  await page.route('**/rest/v1/campaigns*', (route) =>
    route.fulfill({ json: { slug: 'blair-mix123' } }),
  );
  await page.route('**/rest/v1/share_kits*', (route) =>
    route.fulfill({
      json: unlocked ? { id: '60000000-0000-0000-0000-000000000001' } : null,
      status: 200,
    }),
  );
}

test('offers the unlock and reflects a consumed credit', async ({ page }) => {
  await seedSignedInSession(page);
  await mockKitData(page, { unlocked: false });
  let unlockCalls = 0;
  await page.route('**/rest/v1/rpc/unlock_share_kit*', (route) => {
    unlockCalls += 1;
    return route.fulfill({
      json: [{ share_kit_id: '60000000-0000-0000-0000-000000000001', already_unlocked: false }],
    });
  });
  await page.route('**/api/kit-image*', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from([0x89, 0x50]) }),
  );

  await page.goto(`/kit/${DRAFT_ID}`);
  await expect(page.getByRole('heading', { name: 'Turn the pitch into a launch.' })).toBeVisible();

  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await seedSignedInSession(page);
  await mockKitData(page, { unlocked: true });
  await page.route('**/api/kit-image*', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from([0x89, 0x50]) }),
  );
  await page.route('**/rest/v1/rpc/unlock_share_kit*', (route) => {
    unlockCalls += 1;
    return route.fulfill({
      json: [{ share_kit_id: '60000000-0000-0000-0000-000000000001', already_unlocked: true }],
    });
  });

  await page.getByRole('button', { name: 'Unlock with my credit' }).click();
  await expect(page.getByRole('heading', { name: 'Your launch kit.' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Download the share card' })).toBeVisible();
  await expect(
    page.getByText('Blair makes every Tuesday a story.', { exact: false }),
  ).toBeVisible();
  expect(unlockCalls).toBe(1);
});

test('explains the purchase path when no credit exists', async ({ page }) => {
  await seedSignedInSession(page);
  await mockKitData(page, { unlocked: false });
  await page.route('**/rest/v1/rpc/unlock_share_kit*', (route) =>
    route.fulfill({
      status: 400,
      json: { code: 'P0001', message: 'creator launch credit required', details: null, hint: null },
    }),
  );

  await page.goto(`/kit/${DRAFT_ID}`);
  await page.getByRole('button', { name: 'Unlock with my credit' }).click();

  await expect(page.getByRole('heading', { name: 'Unlock the launch kit.' })).toBeVisible();
  await expect(page.getByText('Buy it in the Friendword app', { exact: false })).toBeVisible();
});
