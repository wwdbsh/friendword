// MOTION PHASE 1 — "the Dater sees their page actually move, and approves that".
//
// Three things have to be true on a real browser, and each is a separate way the
// feature can quietly become a lie:
//   1. the preview plays the scene the SERVER stored, not one the client built;
//   2. saving freezes a scene built from the revision's own segments;
//   3. a row with no scene still renders (legacy fallback, A4).
import { expect, test, type Page } from '@playwright/test';

const CONSENT_TOKEN = 'consenttesttoken12345678';
const DRAFT_ID = '10000000-0000-0000-0000-000000000001';
const DATER_ID = '00000000-0000-0000-0000-000000000002';
const REVISION_ID = '30000000-0000-0000-0000-000000000001';
const NEXT_REVISION_ID = '30000000-0000-0000-0000-000000000002';
const FIRST_PHOTO_ID = '40000000-0000-0000-0000-000000000001';
const SECOND_PHOTO_ID = '40000000-0000-0000-0000-000000000002';
const VOICE_ASSET_ID = '40000000-0000-0000-0000-000000000003';

const TRANSCRIPT_SEGMENTS = [
  { start: 0, end: 4, text: 'Okay so, Blair.' },
  { start: 4, end: 11, text: 'Blair turns an ordinary Tuesday into the story you tell all year.' },
  { start: 11, end: 18, text: 'The door is always open.' },
  { start: 18, end: 24, text: 'You should meet Blair.' },
];

/**
 * The scene as the SERVER stored it. Its boundary (9000ms) is deliberately NOT
 * what the client builder would produce from the segments above (11000ms): if the
 * preview ever rendered a locally built scene instead of the stored one, this
 * fixture makes it visible.
 */
const STORED_SCENE = {
  schemaVersion: 1,
  canvas: { width: 1080, height: 1920, fps: 30 },
  durationMs: 24_000,
  scenes: [
    { assetId: FIRST_PHOTO_ID, startMs: 0, endMs: 9_000 },
    { assetId: SECOND_PHOTO_ID, startMs: 9_000, endMs: 24_000 },
  ],
};

const baseRevision = {
  id: REVISION_ID,
  pitch_draft_id: DRAFT_ID,
  revision_number: 2,
  headline: 'Blair turns ordinary Tuesdays into stories.',
  body: 'A thoughtful friend with a gift for making people feel included.',
  structure: { hard_claims_requiring_confirmation: [] },
  asset_ids: [FIRST_PHOTO_ID, SECOND_PHOTO_ID, VOICE_ASSET_ID],
  voice_asset_path: `${DRAFT_ID}/voice.m4a`,
  content_hash: 'revision-content-hash',
  transcript: {
    text: TRANSCRIPT_SEGMENTS.map((segment) => segment.text).join(' '),
    segments: TRANSCRIPT_SEGMENTS,
  },
  structure_reviewed: false,
  scene_definition: STORED_SCENE,
  scene_hash: 'a'.repeat(64),
  created_at: '2026-07-13T00:00:00Z',
};

const assetRows = [
  {
    id: FIRST_PHOTO_ID,
    pitch_draft_id: DRAFT_ID,
    uploaded_by_user_id: '00000000-0000-0000-0000-000000000001',
    asset_type: 'photo',
    storage_path: `${DRAFT_ID}/one.jpg`,
    sort_order: 0,
    created_at: '2026-07-13T00:00:00Z',
    updated_at: '2026-07-13T00:00:00Z',
  },
  {
    id: SECOND_PHOTO_ID,
    pitch_draft_id: DRAFT_ID,
    uploaded_by_user_id: '00000000-0000-0000-0000-000000000001',
    asset_type: 'photo',
    storage_path: `${DRAFT_ID}/two.jpg`,
    sort_order: 1,
    created_at: '2026-07-13T00:00:00Z',
    updated_at: '2026-07-13T00:00:00Z',
  },
  {
    id: VOICE_ASSET_ID,
    pitch_draft_id: DRAFT_ID,
    uploaded_by_user_id: '00000000-0000-0000-0000-000000000001',
    asset_type: 'voice',
    storage_path: `${DRAFT_ID}/voice.m4a`,
    sort_order: 0,
    created_at: '2026-07-13T00:00:00Z',
    updated_at: '2026-07-13T00:00:00Z',
  },
];

type ReviewState = { revision: Record<string, unknown> };

async function mockMotionReview(
  page: Page,
  state: ReviewState,
): Promise<{ readonly revisionBodies: unknown[] }> {
  const revisionBodies: unknown[] = [];

  await page.addInitScript(
    (value) => window.localStorage.setItem('friendword-web-auth', value),
    JSON.stringify({
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
    }),
  );
  await page.route('**/rest/v1/rpc/get_consent_preview*', (route) =>
    route.fulfill({
      json: [
        {
          introducer_display_name: 'Maya',
          relationship_type: 'friend',
          relationship_duration: 'y3to10',
          request_status: 'pending',
        },
      ],
    }),
  );
  await page.route('**/rest/v1/users*', (route) => route.fulfill({ status: 201, json: [] }));
  await page.route('**/rest/v1/profiles*', (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({ json: { display_name: 'Blair', display_name_confirmed: true } })
      : route.fulfill({ status: 201, json: [] }),
  );
  await page.route('**/rest/v1/rpc/claim_consent_request*', (route) =>
    route.fulfill({ json: [{ pitch_draft_id: DRAFT_ID }] }),
  );
  await page.route('**/rest/v1/rpc/get_ai_disclosure_revision*', (route) =>
    route.fulfill({ json: 'ai-2026-07' }),
  );
  await page.route('**/rest/v1/rpc/record_ai_processing_consent*', (route) =>
    route.fulfill({ json: 'consent-id' }),
  );
  await page.route('**/api/moderate-text', (route) =>
    route.fulfill({ json: { ok: true, moderationStatus: 'passed' } }),
  );
  await page.route('**/rest/v1/consent_requests*', (route) =>
    route.fulfill({ json: { revision_id: state.revision.id } }),
  );
  await page.route('**/rest/v1/consent_revisions*', (route) =>
    route.fulfill({ json: state.revision }),
  );
  await page.route('**/rest/v1/pitch_assets*', (route) =>
    route.fulfill({
      json: assetRows.filter((asset) =>
        (state.revision.asset_ids as readonly string[]).includes(asset.id),
      ),
    }),
  );
  await page.route('**/storage/v1/object/sign/pitch-media/**', (route) => {
    const url = route.request().url();
    const objectPath = url.includes('voice.m4a')
      ? `${DRAFT_ID}/voice.m4a`
      : url.includes('one.jpg')
        ? `${DRAFT_ID}/one.jpg`
        : `${DRAFT_ID}/two.jpg`;
    return route.fulfill({
      json: { signedURL: `/object/sign/pitch-media/${objectPath}?token=playwright` },
    });
  });
  await page.route('**/object/sign/pitch-media/**voice.m4a?token=playwright*', (route) =>
    route.fulfill({ status: 200, contentType: 'audio/mp4', body: '' }),
  );
  await page.route('**/object/sign/pitch-media/**.jpg?token=playwright*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320"><rect width="320" height="320" fill="#ffc63f"/></svg>',
    }),
  );
  await page.route('**/rest/v1/rpc/create_dater_revision*', (route) => {
    revisionBodies.push(route.request().postDataJSON());
    // What the server would then serve: the next revision, carrying the scene it
    // just stored for the photos that are still included.
    state.revision = {
      ...baseRevision,
      id: NEXT_REVISION_ID,
      revision_number: 3,
      asset_ids: [SECOND_PHOTO_ID, VOICE_ASSET_ID],
      scene_definition: {
        ...STORED_SCENE,
        scenes: [{ assetId: SECOND_PHOTO_ID, startMs: 0, endMs: 24_000 }],
      },
    };
    return route.fulfill({ json: [{ revision_id: NEXT_REVISION_ID, revision_number: 3 }] });
  });

  return { revisionBodies };
}

test('previews the server-stored scene, then saves a scene rebuilt for the kept photos', async ({
  page,
}) => {
  const state: ReviewState = { revision: { ...baseRevision } };
  const { revisionBodies } = await mockMotionReview(page, state);

  await page.goto(`/consent/${CONSENT_TOKEN}`);

  const player = page.locator('[data-consent-motion-preview] [data-motion-player]');

  await test.step('Then the preview plays the scene the server stored', async () => {
    await expect(player).toBeVisible();
    await expect(player).toHaveAttribute('data-motion-source', 'scene');
    // The stored boundary (9000ms), NOT the 11000ms the client builder derives
    // from the same segments. A locally built scene fails here.
    await expect(player).toHaveAttribute('data-motion-windows', '0:0-9000,1:9000-24000');
    await expect(player.locator('[data-motion-photo]').first()).toHaveAttribute(
      'data-motion-photo',
      FIRST_PHOTO_ID,
    );
  });

  await test.step('And the timeline actually moves the photos', async () => {
    await expect(player).toHaveAttribute('data-motion-active-photo', '0');
    // Drive the shared player's own <audio> clock rather than trusting a real
    // codec: the assertion is about the window boundary, not media decoding.
    await player.locator('audio').evaluate((element) => {
      const audio = element as HTMLAudioElement;
      Object.defineProperty(audio, 'currentTime', { value: 12, configurable: true });
      audio.dispatchEvent(new Event('timeupdate'));
    });
    await expect(player).toHaveAttribute('data-motion-active-photo', '1');
  });

  await test.step('When a photo is excluded the motion waits for the save', async () => {
    await page.getByRole('button', { name: 'Exclude suggested photo 1' }).click();
    await expect(page.locator('[data-consent-motion-stale]')).toBeVisible();
    await expect(page.locator('[data-consent-motion-preview]')).toHaveCount(0);
  });

  await test.step('Then saving sends a scene built from the revision segments', async () => {
    await page.getByRole('button', { name: 'Agree to the AI safety review' }).click();
    await page.getByRole('button', { name: 'Save my edits' }).click();
    await expect(page.getByText('Your edits are saved in a new review version.')).toBeVisible();

    const body = revisionBodies.at(-1) as Record<string, unknown>;
    expect(body.new_scene).toEqual({
      schemaVersion: 1,
      canvas: { width: 1080, height: 1920, fps: 30 },
      durationMs: 24_000,
      // One photo left, so it holds the whole recording.
      scenes: [{ assetId: SECOND_PHOTO_ID, startMs: 0, endMs: 24_000 }],
    });
  });

  await test.step('And the reloaded preview plays the newly stored scene', async () => {
    const reloaded = page.locator('[data-consent-motion-preview] [data-motion-player]');
    await expect(reloaded).toHaveAttribute('data-motion-windows', '0:0-24000');
  });
});

test('falls back to the still preview when the revision has no scene', async ({ page }) => {
  const state: ReviewState = {
    revision: { ...baseRevision, scene_definition: null, scene_hash: null },
  };
  await mockMotionReview(page, state);

  await page.goto(`/consent/${CONSENT_TOKEN}`);

  await expect(page.getByRole('button', { name: 'Exclude suggested photo 1' })).toBeVisible();
  await expect(page.locator('[data-consent-motion-preview]')).toHaveCount(0);
  // A legacy revision is not "broken" — the Dater still gets the still cover and
  // the honest sentence about what the live page does.
  await expect(page.getByText('A still preview built from what you approved')).toBeVisible();
  await expect(page.locator('[data-consent-motion-stale]')).toHaveCount(0);
});
