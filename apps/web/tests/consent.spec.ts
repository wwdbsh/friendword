import { expect, test, type Page } from '@playwright/test';

const CONSENT_TOKEN = 'consenttesttoken12345678';
const DRAFT_ID = '10000000-0000-0000-0000-000000000001';
const DATER_ID = '00000000-0000-0000-0000-000000000002';

const pendingPreviewRow = {
  introducer_display_name: 'Maya',
  relationship_type: 'friend',
  relationship_duration: 'y3to10',
  request_status: 'pending',
};

const draftRow = {
  id: DRAFT_ID,
  created_by_user_id: '00000000-0000-0000-0000-000000000001',
  subject_user_id: DATER_ID,
  status: 'consent_pending',
  headline: null,
  body: null,
  relationship_type: 'friend',
  relationship_duration: 'y3to10',
  created_at: '2026-07-13T00:00:00Z',
  updated_at: '2026-07-13T00:00:00Z',
};

async function mockPreview(page: Page, rows: readonly unknown[]): Promise<void> {
  await page.route('**/rest/v1/rpc/get_consent_preview*', (route) => route.fulfill({ json: rows }));
}

async function mockUserBootstrap(
  page: Page,
  profile: { readonly displayName: string; readonly confirmed: boolean },
): Promise<void> {
  await page.route('**/rest/v1/users*', (route) => route.fulfill({ status: 201, json: [] }));
  await page.route('**/rest/v1/profiles*', (route) => {
    const method = route.request().method();
    if (method === 'GET') {
      return route.fulfill({
        json: { display_name: profile.displayName, display_name_confirmed: profile.confirmed },
      });
    }
    if (method === 'PATCH') {
      return route.fulfill({ json: { user_id: DATER_ID } });
    }
    return route.fulfill({ status: 201, json: [] });
  });
}

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

test('rejects a malformed token without querying the backend', async ({ page }) => {
  let previewCalls = 0;
  await page.route('**/rest/v1/rpc/get_consent_preview*', (route) => {
    previewCalls += 1;
    return route.fulfill({ json: [] });
  });

  await page.goto('/consent/short');

  await expect(page.getByRole('heading', { name: 'This link doesn’t play.' })).toBeVisible();
  expect(previewCalls).toBe(0);
});

test('shows the invite preview and sends a magic link while signed out', async ({ page }) => {
  await mockPreview(page, [pendingPreviewRow]);
  let otpBody: unknown;
  let otpUrl = '';
  await page.route('**/auth/v1/otp*', (route) => {
    otpBody = route.request().postDataJSON();
    otpUrl = route.request().url();
    return route.fulfill({ json: {} });
  });

  await page.goto(`/consent/${CONSENT_TOKEN}`);

  await test.step('Then the anonymous-safe preview names the introducer only', async () => {
    await expect(
      page.getByRole('heading', { name: 'Maya recorded a pitch about you.' }),
    ).toBeVisible();
    await expect(page.getByText('Friend · 3–10 years')).toBeVisible();
  });

  await test.step('When the dater asks for a sign-in link', async () => {
    await page.getByLabel('Your email').fill('dater@example.com');
    await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
    await expect(page.getByText('your sign-in link is on the way')).toBeVisible();
  });

  await test.step('Then the magic link redirects back to this consent page', async () => {
    expect(otpBody).toMatchObject({ email: 'dater@example.com' });
    expect(decodeURIComponent(otpUrl)).toContain(`/consent/${CONSENT_TOKEN}`);
  });
});

test('claims, reviews the voice pitch, and publishes when signed in', async ({ page }) => {
  await mockPreview(page, [pendingPreviewRow]);
  await seedSignedInSession(page);
  await mockUserBootstrap(page, { displayName: 'Blair', confirmed: true });

  await page.route('**/rest/v1/rpc/claim_consent_request*', (route) =>
    route.fulfill({ json: [{ pitch_draft_id: DRAFT_ID }] }),
  );
  await page.route('**/rest/v1/pitch_drafts*', (route) => route.fulfill({ json: draftRow }));
  await page.route('**/storage/v1/object/sign/pitch-media/**', (route) =>
    route.fulfill({
      json: { signedURL: `/object/sign/pitch-media/${DRAFT_ID}/voice.m4a?token=playwright` },
    }),
  );
  await page.route('**/object/sign/pitch-media/**token=playwright*', (route) =>
    route.fulfill({ status: 200, contentType: 'audio/mp4', body: '' }),
  );
  await page.route('**/rest/v1/rpc/approve_and_publish_pitch*', (route) =>
    route.fulfill({
      json: [
        { campaign_id: '20000000-0000-0000-0000-000000000001', campaign_slug: 'blair-mix123' },
      ],
    }),
  );

  await page.goto(`/consent/${CONSENT_TOKEN}`);

  await test.step('Then the claimed dater reviews the original voice note', async () => {
    await expect(
      page.getByRole('heading', { name: 'Hear what Maya says about you.' }),
    ).toBeVisible();
    await expect(page.locator('audio')).toBeVisible();
    await expect(page.getByText('You stay in control', { exact: false })).toBeVisible();
    await page.screenshot({ path: '/tmp/friendword-consent-review.png', fullPage: true });
  });

  await test.step('When the dater approves, they land on their public page', async () => {
    await page.getByRole('button', { name: 'Approve & publish my page' }).click();
    await page.waitForURL('**/p/blair-mix123');
  });
});

test('confirms a fallback display name before the review step', async ({ page }) => {
  await mockPreview(page, [pendingPreviewRow]);
  await seedSignedInSession(page);
  await mockUserBootstrap(page, { displayName: 'dater', confirmed: false });

  await page.route('**/rest/v1/rpc/claim_consent_request*', (route) =>
    route.fulfill({ json: [{ pitch_draft_id: DRAFT_ID }] }),
  );
  await page.route('**/rest/v1/pitch_drafts*', (route) => route.fulfill({ json: draftRow }));
  await page.route('**/storage/v1/object/sign/pitch-media/**', (route) =>
    route.fulfill({
      json: { signedURL: `/object/sign/pitch-media/${DRAFT_ID}/voice.m4a?token=playwright` },
    }),
  );

  await page.goto(`/consent/${CONSENT_TOKEN}`);

  await test.step('Then the fallback name asks for explicit approval', async () => {
    await expect(page.getByRole('heading', { name: 'What should we call you?' })).toBeVisible();
    await expect(page.getByLabel('Your name')).toHaveValue('dater');
  });

  await test.step('When the dater fixes their name, the review begins', async () => {
    await page.getByLabel('Your name').fill('Blair');
    await page.getByRole('button', { name: 'Save & review the pitch' }).click();
    await expect(
      page.getByRole('heading', { name: 'Hear what Maya says about you.' }),
    ).toBeVisible();
  });
});

test('explains when the invite was claimed by a different account', async ({ page }) => {
  await mockPreview(page, [pendingPreviewRow]);
  await seedSignedInSession(page);
  await mockUserBootstrap(page, { displayName: 'Blair', confirmed: true });
  await page.route('**/rest/v1/rpc/claim_consent_request*', (route) =>
    route.fulfill({
      status: 400,
      json: {
        code: 'P0001',
        message: 'consent request is linked to another account',
        details: null,
        hint: null,
      },
    }),
  );

  await page.goto(`/consent/${CONSENT_TOKEN}`);

  await expect(page.getByRole('heading', { name: 'We hit a snag.' })).toBeVisible();
  await expect(
    page.getByText('This invite was already claimed with a different account.'),
  ).toBeVisible();
});

test('closes politely when the request was already approved', async ({ page }) => {
  await mockPreview(page, [{ ...pendingPreviewRow, request_status: 'approved' }]);

  await page.goto(`/consent/${CONSENT_TOKEN}`);

  await expect(page.getByRole('heading', { name: 'This invite is wrapped up.' })).toBeVisible();
  await expect(page.getByText('You already approved this pitch — it’s live.')).toBeVisible();
});
