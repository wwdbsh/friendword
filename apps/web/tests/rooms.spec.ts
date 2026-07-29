import { expect, test, type Page, type Route } from '@playwright/test';

const ME_ID = '00000000-0000-0000-0000-000000000002';
const PEER_ID = '00000000-0000-0000-0000-000000000003';
const ROOM_ID = '60000000-0000-0000-0000-000000000001';
const CAMPAIGN_ID = '20000000-0000-0000-0000-000000000001';

/** The room poll runs every 4s, so a revocation must show up well inside this. */
const POLL_WINDOW_MS = 15_000;

type MessageRow = {
  readonly id: string;
  readonly intro_room_id: string;
  readonly sender_user_id: string;
  readonly body: string;
  readonly created_at: string;
  readonly updated_at: string;
};

type RoomBackend = {
  /** Models the other side blocking or leaving: RLS stops matching this room. */
  readonly revokeMembership: () => void;
  readonly pushPeerMessage: (body: string) => void;
  readonly sentBodies: () => readonly string[];
  readonly blockedUserIds: () => readonly string[];
  readonly reportedReasons: () => readonly string[];
  readonly leaveCalls: () => number;
  readonly membershipReads: () => number;
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

function peerMessage(index: number, body: string): MessageRow {
  return {
    id: `70000000-0000-0000-0000-00000000000${index}`,
    intro_room_id: ROOM_ID,
    sender_user_id: PEER_ID,
    body,
    created_at: `2026-07-29T0${index}:00:00Z`,
    updated_at: `2026-07-29T0${index}:00:00Z`,
  };
}

/** PostgREST accepts a bare object or an array of rows; supabase-js sends both. */
function readInsertedBody(route: Route): string {
  const payload: unknown = route.request().postDataJSON();
  const row = Array.isArray(payload) ? payload[0] : payload;
  if (typeof row === 'object' && row !== null && 'body' in row && typeof row.body === 'string') {
    return row.body;
  }
  return '';
}

function readInsertedField(route: Route, field: string): string {
  const payload: unknown = route.request().postDataJSON();
  const row = Array.isArray(payload) ? payload[0] : payload;
  if (typeof row === 'object' && row !== null && field in row) {
    const value: unknown = Reflect.get(row, field);
    return typeof value === 'string' ? value : '';
  }
  return '';
}

async function mockRoomBackend(page: Page, seed: readonly MessageRow[] = []): Promise<RoomBackend> {
  const roomRow = {
    room_id: ROOM_ID,
    campaign_id: CAMPAIGN_ID,
    campaign_slug: 'jordan-mix123',
    other_user_id: PEER_ID,
    other_display_name: 'Jordan',
    created_at: '2026-07-29T00:00:00Z',
  };

  let membershipRevoked = false;
  let membershipReads = 0;
  let leaveCalls = 0;
  let nextId = seed.length + 1;
  const messages: MessageRow[] = [...seed];
  const sentBodies: string[] = [];
  const blockedUserIds: string[] = [];
  const reportedReasons: string[] = [];

  await page.route('**/rest/v1/rpc/list_my_intro_rooms*', (route) => {
    membershipReads += 1;
    return route.fulfill({ json: membershipRevoked ? [] : [roomRow] });
  });

  await page.route('**/rest/v1/messages*', (route) => {
    if (route.request().method() === 'GET') {
      // Revoked membership is not an error server-side: the participant policy
      // simply matches no rows, which is why the room cannot rely on a read
      // failure to notice it was closed.
      return route.fulfill({ json: membershipRevoked ? [] : messages });
    }
    if (membershipRevoked) {
      return route.fulfill({
        status: 403,
        json: {
          code: '42501',
          message: 'new row violates row-level security policy for table "messages"',
        },
      });
    }
    const body = readInsertedBody(route);
    sentBodies.push(body);
    const row: MessageRow = {
      id: `70000000-0000-0000-0000-00000000010${nextId}`,
      intro_room_id: ROOM_ID,
      sender_user_id: ME_ID,
      body,
      created_at: `2026-07-29T1${nextId}:00:00Z`,
      updated_at: `2026-07-29T1${nextId}:00:00Z`,
    };
    nextId += 1;
    messages.push(row);
    return route.fulfill({ status: 201, json: row });
  });

  await page.route('**/rest/v1/blocks*', (route) => {
    blockedUserIds.push(readInsertedField(route, 'blocked_user_id'));
    // A block is two-way and immediate: the room stops resolving for both.
    membershipRevoked = true;
    return route.fulfill({ status: 201, json: [] });
  });

  await page.route('**/rest/v1/reports*', (route) => {
    reportedReasons.push(readInsertedField(route, 'reason'));
    return route.fulfill({ status: 201, json: [] });
  });

  await page.route('**/rest/v1/rpc/leave_intro_room*', (route) => {
    leaveCalls += 1;
    membershipRevoked = true;
    return route.fulfill({ json: null });
  });

  return {
    revokeMembership: () => {
      membershipRevoked = true;
    },
    pushPeerMessage: (body) => {
      messages.push(peerMessage(messages.length + 1, body));
    },
    sentBodies: () => sentBodies,
    blockedUserIds: () => blockedUserIds,
    reportedReasons: () => reportedReasons,
    leaveCalls: () => leaveCalls,
    membershipReads: () => membershipReads,
  };
}

test('lists my intro rooms and opens one', async ({ page }) => {
  await seedSignedInSession(page);
  await mockRoomBackend(page);

  await page.goto('/rooms');

  await expect(page.getByRole('heading', { name: 'Your introductions.' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Jordan' })).toBeVisible();
  await expect(page.getByText('/p/jordan-mix123')).toBeVisible();

  await page.getByRole('link', { name: 'Open the room' }).click();
  await page.waitForURL(`**/rooms/${ROOM_ID}`);
  await expect(page.getByRole('heading', { name: 'You & Jordan' })).toBeVisible();
});

test('carries a two-party message exchange in an intro room', async ({ page }) => {
  await seedSignedInSession(page);
  const backend = await mockRoomBackend(page, [
    peerMessage(1, 'Your friend’s pitch made me laugh out loud.'),
  ]);

  await page.goto(`/rooms/${ROOM_ID}`);

  await test.step('Given the other side has already written', async () => {
    await expect(page.getByRole('log', { name: 'Messages' })).toContainText(
      'Your friend’s pitch made me laugh out loud.',
    );
    await expect(page.locator('[class*="bubbleTheirs"]')).toHaveCount(1);
    await expect(page.locator('[class*="bubbleMine"]')).toHaveCount(0);
  });

  await test.step('When I reply', async () => {
    await page.getByLabel('Message Jordan').fill('It is all true, sadly.');
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.locator('[class*="bubbleMine"]')).toHaveText('It is all true, sadly.');
    expect(backend.sentBodies()).toEqual(['It is all true, sadly.']);
  });

  await test.step('Then their next message arrives on the poll', async () => {
    backend.pushPeerMessage('Then dinner Thursday?');
    await expect(page.getByText('Then dinner Thursday?')).toBeVisible({
      timeout: POLL_WINDOW_MS,
    });
    await expect(page.locator('[class*="bubbleTheirs"]')).toHaveCount(2);
    await expect(page.locator('[class*="bubbleMine"]')).toHaveCount(1);
  });
});

// Regression for the safety gap where the peer's already-open room kept
// rendering the conversation and composer after a block, contradicting the
// panel copy. Server access is revoked at once; this asserts the open screen
// follows within one poll instead of waiting for a manual reload.
test('closes an already-open room when the other side blocks', async ({ page }) => {
  await seedSignedInSession(page);
  const backend = await mockRoomBackend(page, [peerMessage(1, 'Hey there.')]);

  await page.goto(`/rooms/${ROOM_ID}`);
  await expect(page.getByRole('heading', { name: 'You & Jordan' })).toBeVisible();
  await expect(page.getByLabel('Message Jordan')).toBeVisible();

  backend.revokeMembership();

  await expect(page.getByRole('heading', { name: 'This room isn’t open for you.' })).toBeVisible({
    timeout: POLL_WINDOW_MS,
  });
  await expect(page.getByLabel('Message Jordan')).toHaveCount(0);
  await expect(page.getByText('Hey there.')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Back to my rooms' })).toBeVisible();
  // The poll budget is one membership read per 4s tick, not a request storm.
  expect(backend.membershipReads()).toBeLessThanOrEqual(6);
});

test('reports, blocks, and leaves from the room safety panel', async ({ page }) => {
  await seedSignedInSession(page);
  const backend = await mockRoomBackend(page, [peerMessage(1, 'Hey there.')]);

  await page.goto(`/rooms/${ROOM_ID}`);

  await test.step('When I report the other person', async () => {
    await page.getByRole('button', { name: 'Safety' }).click();
    await page.getByLabel('Report Jordan').fill('Kept pushing for my phone number.');
    await page.getByRole('button', { name: 'Send report' }).click();
    await expect(page.getByText('Report received', { exact: false })).toBeVisible();
    expect(backend.reportedReasons()).toEqual(['Kept pushing for my phone number.']);
  });

  await test.step('Then blocking closes the room and returns me to my rooms', async () => {
    await page.getByRole('button', { name: 'Safety' }).click();
    page.once('dialog', (dialog) => {
      void dialog.accept();
    });
    await page.getByRole('button', { name: 'Block' }).click();
    await page.waitForURL('**/rooms');
    expect(backend.blockedUserIds()).toEqual([PEER_ID]);
    await expect(page.getByRole('heading', { name: 'No rooms yet.' })).toBeVisible();
  });
});

test('leaves an intro room for good', async ({ page }) => {
  await seedSignedInSession(page);
  const backend = await mockRoomBackend(page, [peerMessage(1, 'Hey there.')]);

  await page.goto(`/rooms/${ROOM_ID}`);
  await page.getByRole('button', { name: 'Safety' }).click();
  page.once('dialog', (dialog) => {
    void dialog.accept();
  });
  await page.getByRole('button', { name: 'Leave room' }).click();

  await page.waitForURL('**/rooms');
  expect(backend.leaveCalls()).toBe(1);
  await expect(page.getByRole('heading', { name: 'No rooms yet.' })).toBeVisible();
});
