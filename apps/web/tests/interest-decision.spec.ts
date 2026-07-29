import { expect, test, type Page } from '@playwright/test';

const DATER_ID = '00000000-0000-0000-0000-000000000002';
const CAMPAIGN_ID = '20000000-0000-0000-0000-000000000001';
const INTEREST_ID = '40000000-0000-0000-0000-000000000001';
const ROOM_ID = '60000000-0000-0000-0000-000000000001';

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

/** The dater's inbox with exactly one interest waiting on a decision. */
async function mockInboxWithPendingInterest(page: Page): Promise<{
  readonly setDecided: () => void;
}> {
  let decided = false;

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
    route.fulfill({
      json: [
        {
          interest_id: INTEREST_ID,
          interest_status: decided ? 'accepted' : 'submitted',
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

  return {
    setDecided: () => {
      decided = true;
    },
  };
}

test('accepting an interest opens the intro room', async ({ page }) => {
  await seedSignedInSession(page);
  const inbox = await mockInboxWithPendingInterest(page);
  let decidePayload: unknown;
  await page.route('**/rest/v1/rpc/decide_interest*', (route) => {
    decidePayload = route.request().postDataJSON();
    inbox.setDecided();
    return route.fulfill({ json: [{ intro_room_id: ROOM_ID }] });
  });
  await page.route('**/rest/v1/rpc/list_my_intro_rooms*', (route) =>
    route.fulfill({
      json: [
        {
          room_id: ROOM_ID,
          campaign_id: CAMPAIGN_ID,
          campaign_slug: 'blair-mix123',
          other_user_id: '00000000-0000-0000-0000-000000000003',
          other_display_name: 'Jordan',
          created_at: '2026-07-29T00:00:00Z',
        },
      ],
    }),
  );
  await page.route('**/rest/v1/messages*', (route) => route.fulfill({ json: [] }));

  await page.goto('/inbox');
  await expect(page.getByRole('heading', { name: 'Jordan, 29' })).toBeVisible();

  await page.getByRole('button', { name: 'Accept & open intro room' }).click();

  await expect(
    page.getByText('Accepted — a private intro room is open for the two of you.'),
  ).toBeVisible();
  expect(decidePayload).toMatchObject({
    target_interest_id: INTEREST_ID,
    decision: 'accepted',
  });

  await page.getByRole('link', { name: 'Open the intro room' }).click();
  await page.waitForURL(`**/rooms/${ROOM_ID}`);
  await expect(page.getByRole('heading', { name: 'You & Jordan' })).toBeVisible();
});

// A refused decision must never look like it landed: the interest stays
// pending and the dater is told, rather than the button quietly resetting.
test('states a failed interest decision instead of swallowing it', async ({ page }) => {
  await seedSignedInSession(page);
  await mockInboxWithPendingInterest(page);
  await page.route('**/rest/v1/rpc/decide_interest*', (route) =>
    route.fulfill({
      status: 400,
      json: {
        code: 'P0001',
        message: 'interest already answered',
        details: null,
        hint: null,
      },
    }),
  );

  await page.goto('/inbox');
  await page.getByRole('button', { name: 'Accept & open intro room' }).click();

  await expect(
    page.getByText('That decision did not go through. Refresh and try again.'),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open the intro room' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Accept & open intro room' })).toBeEnabled();
});

test('declining an interest opens no room', async ({ page }) => {
  await seedSignedInSession(page);
  await mockInboxWithPendingInterest(page);
  let decidePayload: unknown;
  await page.route('**/rest/v1/rpc/decide_interest*', (route) => {
    decidePayload = route.request().postDataJSON();
    return route.fulfill({ json: [{ intro_room_id: null }] });
  });

  await page.goto('/inbox');
  await page.getByRole('button', { name: 'Decline' }).click();

  await expect(page.getByText('Declined. They will not be notified with details.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open the intro room' })).toHaveCount(0);
  expect(decidePayload).toMatchObject({
    target_interest_id: INTEREST_ID,
    decision: 'declined',
  });
});
