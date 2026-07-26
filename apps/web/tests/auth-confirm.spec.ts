import { expect, test, type Page } from '@playwright/test';

import { resolveSameOriginPath } from '../app/auth/confirm/redirect';

const TOKEN_HASH = 'tokenhashfromtheemail';
const CONSENT_TOKEN = 'consenttesttoken12345678';
const DATER_ID = '00000000-0000-0000-0000-000000000002';

const verifiedSession = {
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

/** Counts the token exchanges so a scanner-style page load can be told apart. */
async function mockVerify(
  page: Page,
  outcome: 'success' | 'expired' = 'success',
): Promise<() => number> {
  let calls = 0;
  await page.route('**/auth/v1/verify*', (route) => {
    calls += 1;
    return outcome === 'success'
      ? route.fulfill({ json: verifiedSession })
      : route.fulfill({
          status: 401,
          json: {
            code: 401,
            error_code: 'otp_expired',
            msg: 'Email link is invalid or has expired',
          },
        });
  });

  return () => calls;
}

async function mockInvalidConsentPreview(page: Page): Promise<void> {
  await page.route('**/rest/v1/rpc/get_consent_preview*', (route) => route.fulfill({ json: [] }));
}

test('accepts only same-origin redirect targets', () => {
  const origin = 'https://friendword.example';

  expect(resolveSameOriginPath('https://friendword.example/consent/abc?x=1', origin)).toBe(
    '/consent/abc?x=1',
  );
  expect(resolveSameOriginPath('/p/blair-mix123', origin)).toBe('/p/blair-mix123');
  expect(resolveSameOriginPath('https://evil.example.com/steal', origin)).toBe('/');
  expect(resolveSameOriginPath('//evil.example.com/steal', origin)).toBe('/');
  expect(resolveSameOriginPath('javascript:alert(1)', origin)).toBe('/');
  expect(resolveSameOriginPath(null, origin)).toBe('/');
  expect(resolveSameOriginPath('   ', origin)).toBe('/');
});

test('never verifies the emailed token on page load', async ({ page }) => {
  const verifyCalls = await mockVerify(page);

  await page.goto(
    `/auth/confirm?token_hash=${TOKEN_HASH}&type=email&redirect_to=${encodeURIComponent(
      `http://localhost:3000/consent/${CONSENT_TOKEN}`,
    )}`,
  );

  await test.step('Then the page only offers the button — a mail scanner burns nothing', async () => {
    await expect(page.getByRole('heading', { name: 'Confirm it’s really you.' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign me in' })).toBeVisible();
    // A scanner would have loaded the page by now; the token must be untouched.
    await page.waitForTimeout(500);
    expect(verifyCalls()).toBe(0);
    await page.screenshot({ path: '/tmp/friendword-auth-confirm.png', fullPage: true });
  });
});

test('verifies once on click and returns to the same-origin destination', async ({ page }) => {
  const verifyCalls = await mockVerify(page);
  await mockInvalidConsentPreview(page);

  await page.goto(
    `/auth/confirm?token_hash=${TOKEN_HASH}&type=email&redirect_to=${encodeURIComponent(
      `http://localhost:3000/consent/${CONSENT_TOKEN}`,
    )}`,
  );
  await page.getByRole('button', { name: 'Sign me in' }).click();

  await page.waitForURL(`**/consent/${CONSENT_TOKEN}`);
  expect(verifyCalls()).toBe(1);
  await expect
    .poll(() => page.evaluate(() => window.localStorage.getItem('friendword-web-auth')))
    .not.toBeNull();
});

test('falls back to the home page when redirect_to points off-site', async ({ page }) => {
  await mockVerify(page);

  await page.goto(
    `/auth/confirm?token_hash=${TOKEN_HASH}&type=email&redirect_to=${encodeURIComponent(
      'https://evil.example.com/steal',
    )}`,
  );
  await page.getByRole('button', { name: 'Sign me in' }).click();

  await page.waitForURL('http://localhost:3000/');
  expect(new URL(page.url()).host).toBe('localhost:3000');
});

test('offers a fresh link when the emailed token was already consumed', async ({ page }) => {
  await mockVerify(page, 'expired');
  let otpUrl = '';
  await page.route('**/auth/v1/otp*', (route) => {
    otpUrl = route.request().url();
    return route.fulfill({ json: {} });
  });

  await page.goto(
    `/auth/confirm?token_hash=${TOKEN_HASH}&type=email&redirect_to=${encodeURIComponent(
      `http://localhost:3000/consent/${CONSENT_TOKEN}`,
    )}`,
  );
  await page.getByRole('button', { name: 'Sign me in' }).click();

  await test.step('Then the failure is stated instead of swallowed', async () => {
    await expect(page.getByRole('heading', { name: 'We couldn’t sign you in.' })).toBeVisible();
    await expect(page.getByText('That sign-in link has expired or was already used')).toBeVisible();
  });

  await test.step('And the resend returns to the surface the link came from', async () => {
    await page.getByLabel('Your email').fill('dater@example.com');
    await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
    await expect(page.getByText('your sign-in link is on the way')).toBeVisible();
    expect(decodeURIComponent(otpUrl)).toContain(`/consent/${CONSENT_TOKEN}`);
  });
});
