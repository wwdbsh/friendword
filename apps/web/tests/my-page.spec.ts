import { expect, test, type Page } from '@playwright/test';

// MY PAGE — T009 / Issue #46 (ACC-6).
// A person's own things were spread over five sources with no place that says
// what they have: /inbox (interest received + the controls for their own
// campaign), /interests (interest sent), /rooms (intro rooms) on the web, and
// two more screens in the app. This spec drives the hub the way a person does —
// ONE page.goto, then only things that are on the screen — and it ends on the
// account controls, because "where do I delete this account" was the question
// the scatter answered worst.

const ME_ID = '00000000-0000-0000-0000-000000000002';
const PEER_ID = '00000000-0000-0000-0000-000000000003';
const CAMPAIGN_ID = '20000000-0000-0000-0000-000000000001';
const INTEREST_ID = '40000000-0000-0000-0000-000000000001';
const SENT_INTEREST_ID = '40000000-0000-0000-0000-000000000009';
const ROOM_ID = '60000000-0000-0000-0000-000000000001';

async function seedSignedInSession(page: Page): Promise<void> {
  const session = {
    access_token: 'playwright-access-token',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 315_360_000,
    refresh_token: 'playwright-refresh-token',
    user: {
      id: ME_ID,
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

/**
 * One of everything, so each area has a number to state: a live campaign, one
 * interest waiting on this person, one interest they sent, one open room.
 */
async function mockEveryArea(page: Page): Promise<void> {
  await page.route('**/rest/v1/campaigns*', (route) =>
    route.fulfill({
      json: [
        {
          id: CAMPAIGN_ID,
          slug: 'blair-mix123',
          status: 'published',
          owner_user_id: ME_ID,
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
          interest_status: 'submitted',
          note: 'Would love to meet.',
          submitted_at: '2026-08-01T01:00:00+00:00',
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
  await page.route('**/rest/v1/rpc/list_my_interests*', (route) =>
    route.fulfill({
      json: [
        {
          interest_id: SENT_INTEREST_ID,
          interest_status: 'submitted',
          submitted_at: '2026-08-01T10:00:00+00:00',
          decided_at: null,
          campaign_id: '20000000-0000-0000-0000-000000000002',
          campaign_slug: 'demo-blair',
          campaign_status: 'published',
          dater_display_name: 'Blair',
          campaign_headline: 'Blair actually reads the plaques',
        },
      ],
    }),
  );
  await page.route('**/rest/v1/rpc/list_my_intro_rooms*', (route) =>
    route.fulfill({
      json: [
        {
          room_id: ROOM_ID,
          campaign_id: CAMPAIGN_ID,
          campaign_slug: 'blair-mix123',
          other_user_id: PEER_ID,
          other_display_name: 'Jordan',
          created_at: '2026-07-29T00:00:00Z',
        },
      ],
    }),
  );
  await page.route('**/rest/v1/messages*', (route) => route.fulfill({ json: [] }));
  await page.route('**/rest/v1/rpc/track_event*', (route) => route.fulfill({ json: null }));
}

test('reaches all four areas and the account controls from one hub, by clicking', async ({
  page,
}) => {
  await seedSignedInSession(page);
  await mockEveryArea(page);

  // The only navigation performed by hand, and it is the front door.
  await page.goto('/');

  await test.step('the landing door is the hub, not one of the areas', async () => {
    await page.getByRole('link', { name: 'My page', exact: true }).click();
    await page.waitForURL('**/me');
    await expect(
      page.getByRole('heading', { name: 'Everything you have, in one place.' }),
    ).toBeVisible();
  });

  await test.step('each area says what is in it', async () => {
    await expect(page.getByText('1 person is waiting for your answer.')).toBeVisible();
    await expect(page.getByText('1 interest sent.')).toBeVisible();
    await expect(page.getByText('1 intro room is open.')).toBeVisible();
    await expect(page.getByText('· /p/blair-mix123')).toBeVisible();
  });

  await test.step('the inbox opens and the hub comes back', async () => {
    await page.getByRole('link', { name: 'Open my inbox' }).click();
    await page.waitForURL('**/inbox');
    await expect(page.getByRole('heading', { name: 'People who want to meet you.' })).toBeVisible();
    await page.getByRole('link', { name: 'My page', exact: true }).click();
    await page.waitForURL('**/me');
  });

  await test.step('interest sent opens and the hub comes back', async () => {
    await page.getByRole('link', { name: 'Open my interests' }).click();
    await page.waitForURL('**/interests');
    await expect(page.getByRole('heading', { name: 'Interest you sent.' })).toBeVisible();
    await page.getByRole('link', { name: 'My page', exact: true }).click();
    await page.waitForURL('**/me');
  });

  await test.step('the intro rooms open and the hub comes back', async () => {
    await page.getByRole('link', { name: 'Open my intro rooms' }).click();
    await page.waitForURL('**/rooms');
    await expect(page.getByRole('heading', { name: 'Your introductions.' })).toBeVisible();
    await page.getByRole('link', { name: 'My page', exact: true }).click();
    await page.waitForURL('**/me');
  });

  await test.step('the campaign about me is managed where its controls live', async () => {
    await page.getByRole('link', { name: 'Manage my public page' }).click();
    await page.waitForURL('**/inbox');
    await expect(page.getByRole('button', { name: 'Pause my page' })).toBeVisible();
    await page.getByRole('link', { name: 'My page', exact: true }).click();
    await page.waitForURL('**/me');
  });

  await test.step('and the account controls are one click away', async () => {
    await page.getByRole('link', { name: 'Delete my account' }).click();
    await page.waitForURL('**/inbox#account');
    await expect(page.getByRole('heading', { name: 'Your account' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Delete my account' })).toBeVisible();
  });
});

// §12: an unreadable area is not an empty one. A hub that prints 0 for a failed
// read tells a dater nobody is waiting while someone waits.
test('states an area it could not read instead of counting it as zero', async ({ page }) => {
  await seedSignedInSession(page);
  await mockEveryArea(page);
  await page.route('**/rest/v1/rpc/list_my_interests*', (route) =>
    route.fulfill({ status: 500, json: { message: 'unavailable' } }),
  );

  await page.goto('/me');

  await expect(page.getByText('The interest you sent could not be counted.')).toBeVisible();
  await expect(page.getByText('You haven’t sent any interest yet.')).toHaveCount(0);
  // The door still opens — a failed count must not remove the way in.
  await page.getByRole('link', { name: 'Open my interests' }).click();
  await page.waitForURL('**/interests');
});

test('asks a signed-out visitor to sign in rather than showing an empty account', async ({
  page,
}) => {
  await page.goto('/me');

  await expect(
    page.getByRole('heading', { name: 'Everything you have on Friendword, in one place.' }),
  ).toBeVisible();
  await expect(page.getByText('Nobody is waiting on your answer right now.')).toHaveCount(0);
});

// T006 left one measured defect behind: at 375px the three sibling tabs came to
// 331.7px inside a 327px shell and wrapped to a second line. Four areas could
// never have fit, which is why the shell now carries one hub link — so the
// shell has to be provably one line at the width the funnel arrives on.
test.describe('the account shell fits the phone it is used on', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('keeps the wordmark, the hub link and sign-out on one line at 375px', async ({ page }) => {
    await seedSignedInSession(page);
    await mockEveryArea(page);

    await page.goto('/me');
    await expect(page.getByRole('link', { name: 'My page', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();

    const geometry = await page.evaluate(() => {
      const row = document.querySelector('nav [class*="navRow"]');
      if (row === null) {
        throw new Error('the shell rendered no nav row');
      }
      const children = Array.from(row.children).map(
        (child) => child.getBoundingClientRect().height,
      );
      return {
        rowHeight: row.getBoundingClientRect().height,
        tallestChild: Math.max(...children),
        childCount: children.length,
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      };
    });

    // Three items — wordmark, hub link, sign-out — and a row no taller than the
    // tallest of them is a row that did not wrap.
    expect(geometry.childCount).toBe(3);
    expect(geometry.rowHeight).toBeLessThanOrEqual(geometry.tallestChild + 1);
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth);
  });
});
