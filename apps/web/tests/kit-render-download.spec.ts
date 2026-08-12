// MP4 DOWNLOAD IN A REAL BROWSER (Issue #52, GAP-9).
//
// Every other test of this path asserts intent — that a fetch was made, that
// an anchor carried a filename. None of them can answer the only question the
// growth loop cares about: does a file actually land on the machine, whole?
// That is a browser behaviour, so it is asserted in Chromium: the download
// event fires, the saved bytes match the served bytes exactly, the file is
// named by us, and the kit page is still open afterwards.
//
// The last assertion is the regression. The previous shape answered with a
// signed Supabase URL and clicked an anchor at it; a cross-origin `download`
// attribute is inert, so whether anything saved depended on a header from
// another origin, and where video/mp4 renders inline the click NAVIGATED THE
// KIT PAGE AWAY into a player. Serving the bytes from this origin makes both
// the save and the name ours.
import { readFileSync } from 'node:fs';

import { expect, test, type Page } from '@playwright/test';

const INTRODUCER_ID = '00000000-0000-0000-0000-000000000001';
const DRAFT_ID = '10000000-0000-0000-0000-000000000001';
const CAMPAIGN_ID = '20000000-0000-0000-0000-000000000001';
const REVISION_ID = '30000000-0000-0000-0000-000000000001';

/**
 * A body big enough that a truncating transport would show up as a size
 * mismatch rather than a coincidence. The bytes are arbitrary; the LENGTH is
 * the assertion.
 */
const RENDER_BODY = Buffer.alloc(512 * 1024, 7);

async function seedSignedInSession(page: Page): Promise<void> {
  const session = {
    access_token: 'playwright-access-token',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 315_360_000,
    refresh_token: 'playwright-refresh-token',
    user: {
      id: INTRODUCER_ID,
      aud: 'authenticated',
      role: 'authenticated',
      email: 'introducer@example.com',
      app_metadata: {},
      user_metadata: {},
      created_at: '2026-07-13T00:00:00Z',
    },
  };
  await page.addInitScript((value) => {
    window.localStorage.setItem('friendword-web-auth', value);
  }, JSON.stringify(session));
}

async function mockFinishedRender(page: Page): Promise<void> {
  await page.route('**/rest/v1/pitch_drafts*', (route) =>
    route.fulfill({
      json: {
        id: DRAFT_ID,
        created_by_user_id: INTRODUCER_ID,
        subject_user_id: '00000000-0000-0000-0000-000000000002',
        status: 'published',
        headline: 'Blair makes every Tuesday a story.',
        body: 'Body',
        created_at: '2026-07-13T00:00:00Z',
        updated_at: '2026-07-13T00:00:00Z',
      },
    }),
  );
  await page.route('**/rest/v1/campaigns*', (route) =>
    route.fulfill({ json: { id: CAMPAIGN_ID, slug: 'blair-mix123' } }),
  );
  await page.route('**/rest/v1/share_kits*', (route) => route.fulfill({ json: null, status: 200 }));
  await page.route('**/rest/v1/consent_requests*', (route) =>
    route.fulfill({ json: { revision_id: REVISION_ID } }),
  );
  await page.route('**/rest/v1/rpc/get_pitch_render_state*', (route) =>
    route.fulfill({
      json: [
        {
          job_id: '40000000-0000-0000-0000-000000000001',
          job_status: 'done',
          revision_id: REVISION_ID,
          output_storage_path: `pitch-media/${DRAFT_ID}/renders/${REVISION_ID}.mp4`,
          last_error: null,
          free_render_used: true,
          pass_active: false,
          updated_at: '2026-08-12T00:00:00Z',
        },
      ],
    }),
  );
  await page.route('**/rest/v1/rpc/track_event*', (route) => route.fulfill({ json: null }));
}

test('saves the whole MP4 from this origin without leaving the kit page', async ({ page }) => {
  await seedSignedInSession(page);
  await mockFinishedRender(page);

  // Stands in for the streaming route: same origin, attachment, exact length.
  await page.route(`**/kit/${DRAFT_ID}/render-download*`, (route) =>
    route.fulfill({
      status: 200,
      headers: {
        'content-type': 'video/mp4',
        'content-disposition': 'attachment; filename="friendword-pitch.mp4"',
        'content-length': String(RENDER_BODY.byteLength),
        'cache-control': 'private, no-store',
      },
      body: RENDER_BODY,
    }),
  );

  await page.goto(`/kit/${DRAFT_ID}`);
  const downloadButton = page.getByRole('button', { name: 'Download the MP4' });
  await expect(downloadButton).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 20_000 }),
    downloadButton.click(),
  ]);

  expect(download.suggestedFilename()).toBe('friendword-pitch.mp4');

  const savedPath = await download.path();
  expect(savedPath).not.toBeNull();
  const saved = readFileSync(savedPath);
  // Byte-for-byte, not "roughly the right size".
  expect(saved.byteLength).toBe(RENDER_BODY.byteLength);
  expect(saved.equals(RENDER_BODY)).toBe(true);

  // Still on the kit page, with the card intact and no error shown.
  await expect(page).toHaveURL(new RegExp(`/kit/${DRAFT_ID}$`));
  await expect(downloadButton).toBeVisible();
  await expect(page.getByText('The download didn’t complete. Please try again.')).toHaveCount(0);
});

test('a failed download is reported on the page instead of replacing it', async ({ page }) => {
  await seedSignedInSession(page);
  await mockFinishedRender(page);
  await page.route(`**/kit/${DRAFT_ID}/render-download*`, (route) =>
    route.fulfill({ status: 502, json: { error: 'render unavailable' } }),
  );

  await page.goto(`/kit/${DRAFT_ID}`);
  const downloadButton = page.getByRole('button', { name: 'Download the MP4' });
  await expect(downloadButton).toBeVisible();
  await downloadButton.click();

  await expect(page.getByText('The download didn’t complete. Please try again.')).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/kit/${DRAFT_ID}$`));
});
