import { expect, test, type Page } from '@playwright/test';

const DATER_ID = '00000000-0000-0000-0000-000000000002';
const CAMPAIGN_ID = '20000000-0000-0000-0000-000000000001';
const INTEREST_ID = '40000000-0000-0000-0000-000000000001';

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
  await page.addInitScript((value) => {
    window.localStorage.setItem('friendword-web-auth', value);
  }, JSON.stringify(session));
}

async function mockInbox(page: Page): Promise<void> {
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
  await page.route('**/rest/v1/rpc/list_campaign_interests*', (route) =>
    route.fulfill({
      json: [
        {
          interest_id: INTEREST_ID,
          interest_status: 'submitted',
          note: 'Would love to meet.',
          submitted_at: '2026-07-13T01:00:00Z',
          sender_display_name: 'Jordan',
          sender_age: 29,
          sender_bio: 'Runner, cook, museum lurker.',
          sender_photos: [],
          sender_dating_intent: 'long-term',
          sender_location: 'Seoul',
        },
      ],
    }),
  );
}

test('reports an interest profile from the inbox', async ({ page }) => {
  await seedSignedInSession(page);
  await mockInbox(page);
  let reportPayload: unknown;
  await page.route('**/rest/v1/rpc/report_content*', (route) => {
    reportPayload = route.request().postDataJSON();
    return route.fulfill({ json: '50000000-0000-0000-0000-000000000001' });
  });
  await page.route('**/rest/v1/rpc/track_event*', (route) => route.fulfill({ json: null }));

  await page.goto('/inbox');
  await expect(page.getByRole('heading', { name: 'Jordan, 29' })).toBeVisible();

  await page.getByRole('button', { name: 'Report this profile' }).click();
  await page.getByLabel('Why are you reporting this profile?').selectOption('safety_risk');
  await page.getByRole('button', { name: 'Send report' }).click();

  await expect(page.getByText('Report received', { exact: false })).toBeVisible();
  expect(reportPayload).toMatchObject({
    target_type: 'interest',
    target_id: INTEREST_ID,
    reason: 'safety_risk',
  });
});

// T013 (T007 carry-over): the web gate is now the app's gate — the facts are
// on the page and the word has to be typed. These two tests are the before/after
// of that change: one proves the deletion still completes, the other proves the
// single click that used to be enough no longer is.
test('deletes the account after the confirmation word is typed', async ({ page }) => {
  await seedSignedInSession(page);
  await mockInbox(page);
  let deletionCalls = 0;
  await page.route('**/rest/v1/rpc/request_account_deletion*', (route) => {
    deletionCalls += 1;
    return route.fulfill({ json: null });
  });
  await page.route('**/auth/v1/logout*', (route) => route.fulfill({ status: 204 }));

  await page.goto('/inbox');
  await expect(page.getByRole('heading', { name: 'Your account' })).toBeVisible();

  await page.getByRole('button', { name: 'Delete my account' }).click();
  await page.getByLabel('Type DELETE to confirm.').fill('DELETE');
  await page.getByRole('button', { name: 'Permanently delete my account' }).click();

  await expect(page.getByRole('heading', { name: 'Your account is being deleted.' })).toBeVisible();
  expect(deletionCalls).toBe(1);
});

test('one click cannot delete the account, and the wrong word cannot either', async ({ page }) => {
  await seedSignedInSession(page);
  await mockInbox(page);
  let deletionCalls = 0;
  await page.route('**/rest/v1/rpc/request_account_deletion*', (route) => {
    deletionCalls += 1;
    return route.fulfill({ json: null });
  });

  await page.goto('/inbox');

  // Opening the confirmation is not confirming it.
  await page.getByRole('button', { name: 'Delete my account' }).click();
  const confirm = page.getByRole('button', { name: 'Permanently delete my account' });
  await expect(confirm).toBeDisabled();

  // Lower case is not the word.
  await page.getByLabel('Type DELETE to confirm.').fill('delete');
  await expect(confirm).toBeDisabled();

  await page.getByRole('button', { name: 'Keep my account' }).click();
  await expect(page.getByRole('button', { name: 'Delete my account' })).toBeVisible();
  expect(deletionCalls).toBe(0);
});

test('unlocks the campaign funnel only with an active pass', async ({ page }) => {
  await seedSignedInSession(page);
  await mockInbox(page);
  await page.route('**/rest/v1/rpc/get_campaign_pass_state*', (route) =>
    route.fulfill({ json: [{ pass_active: true, pass_expires_at: '2026-08-12T00:00:00Z' }] }),
  );
  await page.route('**/rest/v1/rpc/get_campaign_analytics*', (route) =>
    route.fulfill({
      json: [
        { event_name: 'pitch_viewed_unique', source: 'instagram', total: 12 },
        { event_name: 'interest_submitted', source: 'direct', total: 3 },
      ],
    }),
  );

  await page.goto('/inbox');
  await expect(page.getByRole('heading', { name: 'Campaign Pass' })).toBeVisible();
  await expect(page.getByText('Active until', { exact: false })).toBeVisible();

  await page.getByRole('button', { name: 'View my funnel' }).click();
  await expect(page.getByText('Unique views · instagram: 12')).toBeVisible();
  await expect(page.getByText('Interest submitted · direct: 3')).toBeVisible();
});

test('shows the locked pass state without an entitlement', async ({ page }) => {
  await seedSignedInSession(page);
  await mockInbox(page);
  await page.route('**/rest/v1/rpc/get_campaign_pass_state*', (route) =>
    route.fulfill({ json: [{ pass_active: false, pass_expires_at: null }] }),
  );

  await page.goto('/inbox');
  await expect(page.getByText('Not active.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'View my funnel' })).toHaveCount(0);
});

test('reports a public pitch without signing in', async ({ page }) => {
  let reportBody: unknown;
  await page.route('**/api/report', (route) => {
    reportBody = route.request().postDataJSON();
    return route.fulfill({ json: { received: true } });
  });

  await page.goto('/p/demo-blair');
  await page.getByRole('button', { name: 'Report this page' }).click();
  await page.getByLabel('Why are you reporting this page?').selectOption('impersonation');
  await page.getByRole('button', { name: 'Send report' }).click();

  await expect(page.getByText('Report received', { exact: false })).toBeVisible();
  expect(reportBody).toMatchObject({ campaignSlug: 'demo-blair', reason: 'impersonation' });
});
