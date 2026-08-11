import { expect, test, type Page } from '@playwright/test';

// MY INTERESTS — T006 / Issue #43 (FUN-4).
// The sender's half of the funnel had no web screen: an accepted interest could
// only be inferred from a room appearing in /rooms, and a sent-but-undecided or
// declined interest was invisible on the web entirely. This spec drives the new
// /interests screen the way a person does — one goto, then links.

const SENDER_ID = '00000000-0000-0000-0000-000000000009';
const CAMPAIGN_ID = '20000000-0000-0000-0000-000000000001';
const ROOM_ID = '60000000-0000-0000-0000-000000000001';

async function seedSignedInSession(page: Page): Promise<void> {
  const session = {
    access_token: 'playwright-access-token',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 315_360_000,
    refresh_token: 'playwright-refresh-token',
    user: {
      id: SENDER_ID,
      aud: 'authenticated',
      role: 'authenticated',
      email: 'sender@example.com',
      app_metadata: {},
      user_metadata: {},
      created_at: '2026-07-13T00:00:00Z',
    },
  };
  await page.addInitScript((value) => {
    window.localStorage.setItem('friendword-web-auth', value);
  }, JSON.stringify(session));
}

type MyInterestRow = {
  interest_id: string;
  interest_status: string;
  submitted_at: string | null;
  decided_at: string | null;
  campaign_id: string;
  campaign_slug: string | null;
  campaign_status: string;
  dater_display_name: string | null;
  campaign_headline: string | null;
};

function row(overrides: Partial<MyInterestRow> = {}): MyInterestRow {
  return {
    interest_id: '40000000-0000-0000-0000-000000000001',
    interest_status: 'submitted',
    submitted_at: '2026-08-01T10:00:00+00:00',
    decided_at: null,
    campaign_id: CAMPAIGN_ID,
    campaign_slug: 'demo-blair',
    campaign_status: 'published',
    dater_display_name: 'Blair',
    campaign_headline: 'Blair actually reads the plaques',
    ...overrides,
  };
}

async function mockMyInterests(page: Page, rows: readonly MyInterestRow[]): Promise<void> {
  await page.route('**/rest/v1/rpc/list_my_interests*', (route) => route.fulfill({ json: rows }));
}

test('shows one card per sent interest, each stating what the dater decided', async ({ page }) => {
  await seedSignedInSession(page);
  await mockMyInterests(page, [
    row(),
    row({
      interest_id: '40000000-0000-0000-0000-000000000002',
      interest_status: 'accepted',
      decided_at: '2026-08-02T09:00:00+00:00',
      dater_display_name: 'Sam',
      campaign_slug: 'sam-mix456',
    }),
    row({
      interest_id: '40000000-0000-0000-0000-000000000003',
      interest_status: 'declined',
      decided_at: '2026-08-02T09:00:00+00:00',
      dater_display_name: 'Rae',
      campaign_slug: 'rae-mix789',
    }),
  ]);

  await page.goto('/interests');

  await expect(page.getByRole('heading', { name: 'Interest you sent.' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Blair', exact: true })).toBeVisible();
  await expect(page.getByText('It is in their inbox.')).toBeVisible();
  // §12: the waiting state promises nothing it cannot keep.
  await expect(page.getByText('a reply is not promised, and there is no timeline')).toBeVisible();

  await expect(page.getByRole('heading', { name: 'Sam' })).toBeVisible();
  await expect(page.getByText('A private intro room is open for the two of you.')).toBeVisible();

  await expect(page.getByRole('heading', { name: 'Rae' })).toBeVisible();
  await expect(
    page.getByText('No reason was shared with you, and this interest cannot be sent again.'),
  ).toBeVisible();
  await expect(page.getByText('Sent Aug 1, 2026').first()).toBeVisible();
});

test('walks from a sent interest to the rooms list and to the pitch, by link', async ({ page }) => {
  await seedSignedInSession(page);
  await mockMyInterests(page, [
    row({ interest_status: 'accepted', decided_at: '2026-08-02T09:00:00+00:00' }),
  ]);
  await page.route('**/rest/v1/rpc/list_my_intro_rooms*', (route) =>
    route.fulfill({
      json: [
        {
          room_id: ROOM_ID,
          campaign_id: CAMPAIGN_ID,
          campaign_slug: 'demo-blair',
          other_user_id: '00000000-0000-0000-0000-000000000002',
          other_display_name: 'Blair',
          created_at: '2026-08-02T09:00:00Z',
        },
      ],
    }),
  );

  await page.goto('/interests');

  await test.step('the accepted card opens the room list', async () => {
    await page.getByRole('link', { name: 'Open my intro rooms' }).click();
    await page.waitForURL('**/rooms');
    await expect(page.getByRole('heading', { name: 'Your introductions.' })).toBeVisible();
  });

  // T009: the shell's one account destination is the hub, and the hub is what
  // carries this screen — the return trip is two clicks and no typed URL.
  await test.step('and the hub comes back to this screen', async () => {
    await page.getByRole('link', { name: 'My page', exact: true }).click();
    await page.waitForURL('**/me');
    await page.getByRole('link', { name: 'Open my interests' }).click();
    await page.waitForURL('**/interests');
    await expect(page.getByRole('heading', { name: 'Interest you sent.' })).toBeVisible();
  });

  await test.step('the pitch link is the campaign page itself', async () => {
    await page.getByRole('link', { name: 'Back to the pitch' }).click();
    await page.waitForURL('**/p/demo-blair');
    await expect(page.getByRole('heading', { level: 1, name: 'Blair', exact: true })).toBeVisible();
  });
});

test('an empty list says nothing was sent, and offers somewhere to go', async ({ page }) => {
  await seedSignedInSession(page);
  await mockMyInterests(page, []);

  await page.goto('/interests');

  await expect(
    page.getByRole('heading', { name: 'You haven’t sent any interest yet.' }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'See a demo pitch' }).click();
  await page.waitForURL('**/p/demo-blair');
});

// A failed read and an empty list are different claims: rendering the empty
// state on failure would tell a sender their interest is gone.
test('states a failed read instead of an empty list', async ({ page }) => {
  await seedSignedInSession(page);
  await page.route('**/rest/v1/rpc/list_my_interests*', (route) =>
    route.fulfill({ status: 500, json: { message: 'unavailable' } }),
  );

  await page.goto('/interests');

  await expect(page.getByRole('heading', { name: 'We hit a snag.' })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'You haven’t sent any interest yet.' }),
  ).toHaveCount(0);
});

test('a signed-out visitor is asked to sign in, not shown an empty list', async ({ page }) => {
  await mockMyInterests(page, []);

  await page.goto('/interests');

  await expect(
    page.getByRole('heading', { name: 'The interest you sent lives here.' }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'You haven’t sent any interest yet.' }),
  ).toHaveCount(0);
});

// Only the campaign whose page is still public gets a link: /p/[slug] 404s for
// a paused, expired or archived campaign.
test('does not link a pitch page that is no longer public', async ({ page }) => {
  await seedSignedInSession(page);
  await mockMyInterests(page, [row({ campaign_status: 'expired' })]);

  await page.goto('/interests');

  await expect(
    page.getByText('This campaign’s window has ended, so its public page is closed.'),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Back to the pitch' })).toHaveCount(0);
});
