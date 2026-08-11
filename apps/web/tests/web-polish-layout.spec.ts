import { expect, test, type Page } from '@playwright/test';

// WEB POLISH GEOMETRY — T013 / Issue #50 (WUI-5 · 6 · 7 · 8 · 9 · 11 · 12).
//
// The 2026-08-11 screenshot audit's remaining findings are all measurements:
// a 61px dead band, a 20px-tall touch target, three content widths on one page,
// a 238px text column, two states of one screen that disagree about where the
// header lives, decorative stickers on the phone frame, and a row of pills at
// four different widths. None of them is visible to a spec that asserts text
// and roles, which is why they survived every suite the product already had.
//
// Every assertion below is a real measurement in a real browser, at the two
// viewports the audit shot. Where a number is quoted in a comment it is the
// audit's own baseline reading, so a regression is comparable to it.
//
// Deliberately NOT here: anything inside the pitch stage. The crop is scene
// work (backlog B2) and this task only moved the page around it.

const PHONE = { width: 390, height: 844 } as const;
const TABLET = { width: 768, height: 1024 } as const;
const DESKTOP = { width: 1440, height: 900 } as const;

const ME_ID = '00000000-0000-0000-0000-000000000002';
const PEER_ID = '00000000-0000-0000-0000-000000000003';
const CAMPAIGN_ID = '20000000-0000-0000-0000-000000000001';
const INTEREST_ID = '40000000-0000-0000-0000-000000000001';
const ROOM_ID = '60000000-0000-0000-0000-000000000001';

type Box = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

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

async function mockAccountBackend(page: Page, options: { readonly rooms: boolean }): Promise<void> {
  await page.route('**/rest/v1/rpc/list_my_intro_rooms*', (route) =>
    route.fulfill({
      json: options.rooms
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

/**
 * Measure only once the page has stopped moving. The pitch page reveals its
 * sections with a staggered `scale(0.97) → none`, and a rect sampled mid-flight
 * is a fraction under its real size — enough to read a 44px target as 43.93px
 * and a 704px column as 705px. Infinite animations (the waveform) are excluded
 * because they never finish by design.
 */
async function settle(page: Page): Promise<void> {
  await page.waitForFunction(
    () =>
      document
        .getAnimations()
        .every(
          (animation) =>
            animation.playState !== 'running' ||
            animation.effect?.getComputedTiming().iterations === Infinity,
        ),
    null,
    { timeout: 10_000 },
  );
}

async function boxOf(page: Page, selector: string): Promise<Box> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (el === null) {
      throw new Error(`no element for ${sel}`);
    }
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  }, selector);
}

// WUI-5: at 390x844 the stage ended at y=693 and the fixed interest bar began
// at y=754, and the story card's top edge landed at y=757 — three pixels UNDER
// the bar. The first screen was 61px of empty background with the next thing on
// the page hidden behind the CTA.
test('the mobile pitch page has no dead band under the player', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.goto('/p/demo-blair');
  await settle(page);

  const stage = await boxOf(page, '[class*="PitchPlayer_stage"]');
  const bar = await boxOf(page, '[class*="mobileInterest"]');
  const story = await boxOf(page, '[class*="storyCard"]');

  // The card starts before the bar does, so a reader can see the page continues.
  expect(story.y).toBeLessThan(bar.y);
  // And at least a strip of it is actually visible above the bar.
  expect(bar.y - story.y).toBeGreaterThan(24);
  // The gap between the player and the next thing is a gap, not a void.
  expect(story.y - (stage.y + stage.height)).toBeLessThanOrEqual(32);
});

// T005 carry-over: the no-audio note is only rendered when there is no
// recording, but it sat at the transport's height (6.75rem) with nothing
// underneath it, printing its three wrapped lines from y=522 to y=583 straight
// through a caption card that ends at y=581.
test('the demo pitch never prints the caption and the no-audio note on top of each other', async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await page.goto('/p/demo-blair');
  await settle(page);

  const caption = await boxOf(page, '[class*="PitchCaption_card"]');
  const note = await boxOf(page, '[class*="noAudioNote"]');

  expect(note.y).toBeGreaterThanOrEqual(caption.y + caption.height);
});

// WUI-6: the one no-signup safety affordance on the public page measured
// 106x20 — the hardest thing on the page to hit.
test('the report affordance is a real touch target', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.goto('/p/demo-blair');

  const report = page.getByRole('button', { name: 'Report this page' });
  await expect(report).toBeVisible();
  await settle(page);
  const box = await report.boundingBox();
  if (box === null) {
    throw new Error('the pitch page did not render the report affordance');
  }

  expect(box.height).toBeGreaterThanOrEqual(44);
  expect(box.width).toBeGreaterThanOrEqual(44);

  // The controls it opens are targets too — a report someone cannot finish is
  // not a report path.
  await report.click();
  for (const control of [
    page.getByRole('combobox'),
    page.getByRole('button', { name: 'Send report' }),
    page.getByRole('button', { name: 'Cancel' }),
  ]) {
    const controlBox = await control.boundingBox();
    if (controlBox === null) {
      throw new Error('the report form did not render all of its controls');
    }
    expect(controlBox.height).toBeGreaterThanOrEqual(44);
  }
});

// WUI-7: at 1440px this one page stacked a 456px stage, a 704px story card
// floating inside a 928px band, and a 928px trust note and footer.
test('the pitch page is one column below the stage', async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await page.goto('/p/demo-blair');
  await settle(page);

  const story = await boxOf(page, '[class*="storySection"]');
  const card = await boxOf(page, '[class*="storyCard"]');
  const trust = await boxOf(page, '[class*="trustNote"]');
  const footer = await boxOf(page, '[data-pitch-footer]');

  for (const box of [card, trust, footer]) {
    expect(Math.round(box.width)).toBe(Math.round(story.width));
    expect(Math.round(box.x)).toBe(Math.round(story.x));
  }
});

// WUI-8: side by side, the ✓ badge and its gap took 60 of the card's 302
// usable pixels and squeezed the body into a 238x410 column.
test('the trust card gives its sentence the whole phone card', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.goto('/p/demo-blair');
  await settle(page);

  const card = await boxOf(page, '[class*="trustNote"]');
  const body = await page
    .locator('[class*="trustNote"] p')
    .first()
    .evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { width: r.width };
    });

  // Card padding is 24px a side, so the usable width is card - 48. The body
  // used to get 79% of that; it now gets essentially all of it.
  expect(body.width).toBeGreaterThan((card.width - 48) * 0.95);
});

// WUI-11: placed at viewport percentages, all three decorative stickers landed
// ON the phone frame at ~768px (star 44x118, smile 27x100, squiggle 86x102).
// They are now pinned outside the stage's own edge, so the clearance holds at
// every viewport rather than at the widths someone happened to screenshot.
for (const viewport of [TABLET, DESKTOP, { width: 1000, height: 1600 }]) {
  test(`decorative stickers stay off the phone frame at ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto('/p/demo-blair');
    await settle(page);

    const overlaps = await page.evaluate(() => {
      const stage = document.querySelector('[class*="PitchPlayer_stage"]');
      if (stage === null) {
        throw new Error('no stage');
      }
      const s = stage.getBoundingClientRect();
      const hits: string[] = [];
      for (const sticker of document.querySelectorAll('[class*="stickerField"] svg')) {
        if (window.getComputedStyle(sticker).display === 'none') {
          continue;
        }
        const b = sticker.getBoundingClientRect();
        const overlapX = Math.min(b.right, s.right) - Math.max(b.left, s.left);
        const overlapY = Math.min(b.bottom, s.bottom) - Math.max(b.top, s.top);
        if (overlapX > 0 && overlapY > 0) {
          hits.push(`${sticker.getAttribute('class') ?? '?'} ${Math.round(overlapX)}px`);
        }
      }
      return hits;
    });

    expect(overlaps).toEqual([]);
  });
}

// WUI-9: the empty room list put the badge and the page title INSIDE a card
// while the populated one put them outside it, so the two states of one URL
// disagreed about where the page header lives — the badge moved 42px and the
// heading changed both level and indent.
test('both states of the room list wear the same header', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await seedSignedInSession(page);

  async function headerGeometry(rooms: boolean): Promise<{ badge: Box; title: Box }> {
    await mockAccountBackend(page, { rooms });
    await page.goto('/rooms');
    await expect(page.getByRole('heading', { name: 'Your introductions.' })).toBeVisible();
    return {
      badge: await boxOf(page, '[class*="badge"]'),
      title: await boxOf(page, 'h1[class*="title"]'),
    };
  }

  const populated = await headerGeometry(true);
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  const empty = await headerGeometry(false);

  expect(Math.round(empty.badge.x)).toBe(Math.round(populated.badge.x));
  expect(Math.round(empty.title.x)).toBe(Math.round(populated.title.x));
  expect(Math.round(empty.title.width)).toBe(Math.round(populated.title.width));
});

// WUI-12: on /inbox the three controls in one row measured 225px, 179px and
// 232px at 1440, and 258px next to 114px at 390 — a different ragged edge on
// every row.
for (const viewport of [PHONE, DESKTOP]) {
  test(`inbox actions share one width at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await seedSignedInSession(page);
    await mockAccountBackend(page, { rooms: true });
    await page.goto('/inbox');
    await expect(page.getByRole('button', { name: 'Take it down for good' })).toBeVisible();

    const widths = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[class*="actionRow"]')).flatMap((row) =>
        Array.from(row.children).map((child) => Math.round(child.getBoundingClientRect().width)),
      ),
    );

    expect(widths.length).toBeGreaterThan(2);
    expect(new Set(widths).size).toBe(1);
  });
}

// WUI-12 (second half): a signed-out gate is one card, and on a 1440x900
// desktop it was pinned to the top with 278px of empty gradient under it.
test('a signed-out gate is centred rather than pinned to the top', async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await page.goto('/inbox');
  await expect(page.getByRole('heading', { name: 'See who wants to meet you.' })).toBeVisible();

  const shell = await boxOf(page, '[class*="shell"]');
  const below = DESKTOP.height - (shell.y + shell.height);

  // Not perfectly symmetric — the page keeps its 40/64 padding — but the space
  // above and below is now the same order of magnitude instead of 40 vs 278.
  expect(shell.y).toBeGreaterThan(100);
  expect(Math.abs(below - shell.y)).toBeLessThan(60);
});

// A long screen must NOT be centred: auto margins have to collapse, or the top
// of an inbox with real content would be scrolled off above the viewport.
test('a screenful of content still starts at the top', async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await seedSignedInSession(page);
  await mockAccountBackend(page, { rooms: true });
  await page.goto('/inbox');
  await expect(page.getByRole('button', { name: 'Take it down for good' })).toBeVisible();

  const shell = await boxOf(page, '[class*="shell"]');
  expect(shell.y).toBeLessThanOrEqual(40);
  expect(shell.y).toBeGreaterThanOrEqual(0);
});
