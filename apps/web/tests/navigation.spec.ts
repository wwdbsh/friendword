import { expect, test, type Page } from '@playwright/test';

// GLOBAL NAVIGATION — T004 / Issue #41.
// The audit's finding was not that a screen was ugly: /inbox was linked from
// nowhere in the whole app, and the room, kit and interest screens rendered no
// anchor at all once signed in. The round trip below is therefore asserted
// with exactly ONE page.goto — every later screen has to be reachable by
// clicking something a person can see.

const DATER_ID = '00000000-0000-0000-0000-000000000002';
const PEER_ID = '00000000-0000-0000-0000-000000000003';
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

/** One owned campaign, one interest waiting, and the room the accept opens. */
async function mockDaterBackend(page: Page): Promise<void> {
  let accepted = false;

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
          interest_status: accepted ? 'accepted' : 'submitted',
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
  await page.route('**/rest/v1/rpc/decide_interest*', (route) => {
    accepted = true;
    return route.fulfill({ json: [{ intro_room_id: ROOM_ID }] });
  });
  await page.route('**/rest/v1/rpc/list_my_intro_rooms*', (route) =>
    route.fulfill({
      json: accepted
        ? [
            {
              room_id: ROOM_ID,
              campaign_id: CAMPAIGN_ID,
              campaign_slug: 'blair-mix123',
              other_user_id: PEER_ID,
              other_display_name: 'Jordan',
              created_at: '2026-07-29T00:00:00Z',
            },
          ]
        : [],
    }),
  );
  await page.route('**/rest/v1/messages*', (route) => route.fulfill({ json: [] }));
}

test('walks landing → inbox → accept → chat → back, without ever typing a URL', async ({
  page,
}) => {
  await seedSignedInSession(page);
  await mockDaterBackend(page);

  // The only navigation this test is allowed to perform by hand — and it is
  // the front door, not the inbox: /inbox used to be linked from nowhere.
  await page.goto('/');

  // T009: the landing door is the account hub, and the inbox is one click on
  // from it — the funnel is still walked without typing a URL, it now passes
  // through the screen that says what this person has.
  await test.step('The landing offers a signed-in visitor their own page', async () => {
    await page.getByRole('link', { name: 'My page', exact: true }).click();
    await page.waitForURL('**/me');
    await page.getByRole('link', { name: 'Open my inbox' }).click();
    await page.waitForURL('**/inbox');
    await expect(page.getByRole('heading', { name: 'People who want to meet you.' })).toBeVisible();
  });

  await test.step('The inbox says where else the account lives', async () => {
    await expect(page.getByRole('link', { name: 'Friendword home' })).toHaveAttribute('href', '/');
    await expect(page.getByRole('link', { name: 'My page', exact: true })).toHaveAttribute(
      'href',
      '/me',
    );
  });

  await test.step('Accepting offers the room as a link, not an instruction', async () => {
    await page.getByRole('button', { name: 'Accept & open intro room' }).click();
    await page.getByRole('link', { name: 'Open the intro room' }).click();
    await page.waitForURL(`**/rooms/${ROOM_ID}`);
    await expect(page.getByRole('heading', { name: 'You & Jordan' })).toBeVisible();
  });

  await test.step('The room returns to the room list by link', async () => {
    await page.getByRole('link', { name: '← All my rooms' }).click();
    await page.waitForURL('**/rooms');
    await expect(page.getByRole('heading', { name: 'Your introductions.' })).toBeVisible();
  });

  await test.step('And the room list returns to the inbox through the hub', async () => {
    await page.getByRole('link', { name: 'My page', exact: true }).click();
    await page.waitForURL('**/me');
    await page.getByRole('link', { name: 'Open my inbox' }).click();
    await page.waitForURL('**/inbox');
    await expect(page.getByRole('heading', { name: 'People who want to meet you.' })).toBeVisible();
  });
});

// One destination, one link: the campaign card already carries "View my public page",
// so the empty-inbox card must not offer a second anchor to the same screen.
test('an empty inbox offers each destination exactly once', async ({ page }) => {
  await seedSignedInSession(page);
  await mockDaterBackend(page);
  await page.route('**/rest/v1/rpc/list_campaign_interests*', (route) =>
    route.fulfill({ json: [] }),
  );

  await page.goto('/inbox');

  await expect(page.getByRole('heading', { name: 'No interest yet.' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'View my public page' })).toHaveCount(1);
  await expect(page.getByRole('link', { name: 'My intro rooms' })).toHaveCount(1);
});

// §12: the account door is not a signed-out advertisement. A visitor with no
// session is shown nothing about an inbox they cannot open.
test('the landing shows no account link to a signed-out visitor', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('link', { name: 'See the demo' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'My page', exact: true })).toHaveCount(0);
});

test('an empty room list points at the two screens that can change that', async ({ page }) => {
  await seedSignedInSession(page);
  await page.route('**/rest/v1/rpc/list_my_intro_rooms*', (route) => route.fulfill({ json: [] }));

  await page.goto('/rooms');

  await expect(page.getByRole('heading', { name: 'No rooms yet.' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'My interest inbox' })).toHaveAttribute(
    'href',
    '/inbox',
  );
  await page.getByRole('link', { name: 'See a demo pitch' }).click();
  await page.waitForURL('**/p/demo-blair');
});

test('the kit screen is not a dead end', async ({ page }) => {
  await seedSignedInSession(page);
  // Every read fails: even the error state must still carry the shell.
  await page.route('**/rest/v1/pitch_drafts*', (route) =>
    route.fulfill({ status: 500, json: { message: 'unavailable' } }),
  );

  await page.goto('/kit/10000000-0000-0000-0000-000000000001');

  // The kit belongs to the introducer, so it carries no dater tabs — the way
  // out is the wordmark (and the published pitch once the slug is known).
  await expect(page.getByRole('link', { name: 'Inbox', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Intro rooms' })).toHaveCount(0);
  await page.getByRole('link', { name: 'Friendword home' }).click();
  await page.waitForURL((url) => url.pathname === '/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});
