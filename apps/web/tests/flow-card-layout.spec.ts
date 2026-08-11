import { expect, test, type Page } from '@playwright/test';

// FLOW-CARD BOX MODEL — T005 / Issue #42.
// The 2026-08-11 screenshot audit measured four box-model defects in the shared
// sticker-card vocabulary, all of them invisible to the existing specs because
// those assert text and roles, never geometry. Every assertion here is a real
// measurement in a real browser at the phone width the funnel actually arrives
// on: a link that covers the sentence above it, a control pushed past the
// viewport, two groups welded together at 0px, and an underline that appears
// only because a pill happens to be an anchor.

const PHONE = { width: 390, height: 844 } as const;

const ME_ID = '00000000-0000-0000-0000-000000000002';
const PEER_ID = '00000000-0000-0000-0000-000000000003';
const CAMPAIGN_ID = '20000000-0000-0000-0000-000000000001';
const INTEREST_ID = '40000000-0000-0000-0000-000000000001';
const ROOM_ID = '60000000-0000-0000-0000-000000000001';

test.use({ viewport: { width: PHONE.width, height: PHONE.height } });

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

/** One room, one owned campaign, one waiting interest — enough for geometry. */
async function mockAccountBackend(page: Page): Promise<void> {
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
  await page.route('**/rest/v1/messages*', (route) =>
    route.fulfill({
      json: [
        {
          id: '70000000-0000-0000-0000-000000000001',
          intro_room_id: ROOM_ID,
          sender_user_id: PEER_ID,
          body: 'Your friend’s pitch made me laugh out loud.',
          created_at: '2026-07-29T01:00:00Z',
          updated_at: '2026-07-29T01:00:00Z',
        },
      ],
    }),
  );
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
  await page.route('**/rest/v1/rpc/track_event*', (route) => route.fulfill({ json: null }));
}

async function boxOf(page: Page, selector: string): Promise<DOMRect> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (el === null) {
      throw new Error(`no element for ${sel}`);
    }
    return el.getBoundingClientRect().toJSON() as DOMRect;
  }, selector);
}

// WUI-1: .primary/.secondary/.danger specified padding and margin but no
// display, so as a Next <Link> the pill stayed inline — vertical padding and
// margin paint but take no space, and the "Open the room" pill was drawn over
// the "Introduced through /p/…" line above it.
test('a pill link takes vertical space instead of covering the line above it', async ({ page }) => {
  await seedSignedInSession(page);
  await mockAccountBackend(page);
  await page.goto('/rooms');

  const openRoom = page.getByRole('link', { name: 'Open the room' });
  await expect(openRoom).toBeVisible();

  const introducedThrough = page.getByText('Introduced through /p/blair-mix123');
  const above = await introducedThrough.boundingBox();
  const pill = await openRoom.boundingBox();
  if (above === null || pill === null) {
    throw new Error('room card did not render both the caption and the pill');
  }

  expect(pill.y).toBeGreaterThanOrEqual(above.y + above.height);
});

// WUI-2: .composer input { flex: 1 } left the flex item's automatic minimum
// size at its min-content width, so at 390px the input refused to shrink and
// pushed Send past the card and the viewport (measured right = 392 > 390).
test('the room composer keeps Send inside the card at 390px', async ({ page }) => {
  await seedSignedInSession(page);
  await mockAccountBackend(page);
  await page.goto(`/rooms/${ROOM_ID}`);

  const send = page.getByRole('button', { name: 'Send' });
  await expect(send).toBeVisible();

  const sendBox = await send.boundingBox();
  const card = await boxOf(page, '[class*="roomCard"]');
  if (sendBox === null) {
    throw new Error('the composer did not render a Send button');
  }

  expect(sendBox.x + sendBox.width).toBeLessThanOrEqual(card.x + card.width);
  expect(sendBox.x + sendBox.width).toBeLessThanOrEqual(PHONE.width);
  // A document that does not scroll sideways is the reader-visible half of the
  // same fact; assert it so a future overflow anywhere in the card is caught.
  const scroll = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scroll.scrollWidth).toBeLessThanOrEqual(scroll.clientWidth);
});

// WUI-3: .actionRow carried no bottom margin and .subTitle no top margin, so
// on /inbox the destructive "Take it down for good" button ended exactly where
// the "Campaign Pass" heading began — 0px between two unrelated groups.
test('an action row is separated from the heading that opens the next group', async ({ page }) => {
  await seedSignedInSession(page);
  await mockAccountBackend(page);
  await page.goto('/inbox');

  const takeDown = page.getByRole('button', { name: 'Take it down for good' });
  await expect(takeDown).toBeVisible();
  const pass = page.getByRole('heading', { name: 'Campaign Pass' });
  await expect(pass).toBeVisible();

  const row = await boxOf(page, '[class*="actionRow"]');
  const heading = await pass.boundingBox();
  if (heading === null) {
    throw new Error('the campaign card did not render the Campaign Pass heading');
  }

  expect(heading.y - (row.y + row.height)).toBeGreaterThan(0);
});

// WUI-4: the pill classes never reset text-decoration, so the identical
// control was underlined as a <Link> and clean as a <button> — including the
// public pitch's "I'm interested", the one CTA the whole funnel depends on.
test('pill CTAs render without an underline whether they are links or buttons', async ({
  page,
}) => {
  await seedSignedInSession(page);
  await mockAccountBackend(page);

  const decorationOf = async (locatorText: string): Promise<string> =>
    page
      .getByRole('link', { name: locatorText })
      .first()
      .evaluate((el) => window.getComputedStyle(el).textDecorationLine);

  await page.goto('/rooms');
  await expect(page.getByRole('link', { name: 'Open the room' })).toBeVisible();
  expect(await decorationOf('Open the room')).toBe('none');

  await page.goto('/inbox');
  await expect(page.getByRole('link', { name: 'View my page' })).toBeVisible();
  expect(await decorationOf('View my page')).toBe('none');

  // At 390px the desktop pill is display:none, so the visible CTA is the fixed
  // mobile bar's — the same one a viewer arriving from a reel actually taps.
  await page.goto('/p/demo-blair');
  const interested = page.getByRole('link', { name: "I'm interested" }).last();
  await expect(interested).toBeVisible();
  expect(await interested.evaluate((el) => window.getComputedStyle(el).textDecorationLine)).toBe(
    'none',
  );
});
