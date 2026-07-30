// MOTION PHASE 1/2 — "the Dater sees their page actually move, and approves that".
//
// Five things have to be true on a real browser, and each is a separate way the
// feature can quietly become a lie:
//   1. the preview plays the scene the SERVER stored, not one the client built;
//   2. saving freezes a scene built from the revision's own segments — now a v2
//      shot list, with the template the Dater picked;
//   3. a row with no scene still renders (legacy fallback, A4), and a stored v1
//      scene still plays as v1 (nothing is backfilled);
//   4. switching the look is an unsaved edit, so approve waits for the save;
//   5. prefers-reduced-motion plays the same shot list without camera travel.
import { expect, test, type Page } from '@playwright/test';

import { buildPitchSceneV2, parsePitchScene, type PitchSceneV2 } from '@friendword/contracts';

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

const SEGMENT_WINDOWS = TRANSCRIPT_SEGMENTS.map((segment) => ({
  startMs: Math.round(segment.start * 1000),
  endMs: Math.round(segment.end * 1000),
}));

/**
 * A v2 scene for the same two photos, as the server would have stored it. Built
 * with the shared builder on purpose: the point of this fixture is that a stored
 * v2 row PLAYS, not that a hand-written shot list parses.
 */
function storedSceneV2(template: 'warm' | 'hype' = 'warm'): PitchSceneV2 {
  const built = buildPitchSceneV2({
    template,
    photoAssetIds: [FIRST_PHOTO_ID, SECOND_PHOTO_ID],
    segments: SEGMENT_WINDOWS,
  });
  if (built === null) {
    throw new Error('the v2 fixture must build');
  }
  return built;
}

/**
 * The same scene with one light leak added, for the photosensitivity assertions.
 * The templates do not currently emit any overlay, so asserting "no leak is
 * mounted" against a built scene would pass for the wrong reason; this puts a real
 * leak on the timeline in a quiet millisecond (the warm shot list punches at 4000
 * and 18000) and refuses to run if the flash budget rejects it, so the pair of
 * tests below can never go vacuous silently.
 */
const LEAK_START_MS = 10_000;
const LEAK_END_MS = 10_240;

function storedSceneV2WithLeak(): PitchSceneV2 {
  const withLeak: PitchSceneV2 = {
    ...storedSceneV2(),
    overlays: [
      {
        type: 'lightLeak',
        startMs: LEAK_START_MS,
        endMs: LEAK_END_MS,
        peakIntensity: 0.38,
        pulseHz: 2,
        angleDeg: 35,
      },
    ],
  };
  if (parsePitchScene(JSON.parse(JSON.stringify(withLeak)) as unknown) === null) {
    throw new Error(
      'the light-leak fixture must satisfy the flash budget — retime it, do not weaken the test',
    );
  }
  return withLeak;
}

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

/**
 * Drives the player's own <audio> clock. Defining `currentTime` rather than
 * seeking real media keeps the assertion about the timeline instead of about
 * codec support in whichever Chrome is installed.
 */
async function seekTo(player: ReturnType<Page['locator']>, seconds: number): Promise<void> {
  await player.locator('audio').evaluate((element, value) => {
    const audio = element as HTMLAudioElement;
    Object.defineProperty(audio, 'currentTime', { value, configurable: true });
    audio.dispatchEvent(new Event('timeupdate'));
  }, seconds);
}

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
    const body = route.request().postDataJSON() as {
      readonly new_scene?: unknown;
      readonly included_asset_ids?: readonly string[];
    };
    revisionBodies.push(body);
    // What the server would then serve: the next revision, carrying the scene the
    // client just handed it for the photos that are still included. Echoing the
    // submitted scene rather than a fixture is the point — the reload below then
    // proves the built scene actually plays.
    state.revision = {
      ...baseRevision,
      id: NEXT_REVISION_ID,
      revision_number: 3,
      // The asset snapshot the client asked for, echoed like the RPC's own write:
      // hardcoding it here would hide a scene that no longer matches its photos.
      asset_ids: body.included_asset_ids ?? [SECOND_PHOTO_ID, VOICE_ASSET_ID],
      scene_definition: body.new_scene ?? null,
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

  await test.step('Then saving sends a v2 shot list built from the revision segments', async () => {
    await page.getByRole('button', { name: 'Agree to the AI safety review' }).click();
    await page.getByRole('button', { name: 'Save my edits' }).click();
    await expect(page.getByText('Your edits are saved in a new review version.')).toBeVisible();

    const body = revisionBodies.at(-1) as Record<string, unknown>;
    const sentScene = body.new_scene as PitchSceneV2;
    expect(sentScene.schemaVersion).toBe(2);
    expect(sentScene.template).toBe('warm');
    // One photo left, so the shot list only names that one.
    expect(sentScene.assetIds).toEqual([SECOND_PHOTO_ID]);
    expect(sentScene.durationMs).toBe(24_000);
    // Many shots out of one photo — that is what v2 is for — covering exactly
    // [0, durationMs] with no gap.
    expect(sentScene.shots.length).toBeGreaterThan(1);
    expect(sentScene.shots[0]?.startMs).toBe(0);
    expect(sentScene.shots.at(-1)?.endMs).toBe(24_000);
    // This transcript snapshot has no word timings and this revision has no
    // reviewed structure, so neither a word accent nor a text card may appear.
    const effects = sentScene.shots.flatMap((shot) =>
      shot.level === 'typographic' ? [] : shot.effects.map((effect) => effect.type),
    );
    expect(effects).not.toContain('wordPop');
    expect(sentScene.shots.some((shot) => shot.level === 'typographic')).toBe(false);
  });

  await test.step('And the reloaded preview plays the newly stored v2 scene', async () => {
    const reloaded = page.locator('[data-consent-motion-preview] [data-motion-player]');
    await expect(reloaded).toHaveAttribute('data-motion-source', 'scene-v2');
    await expect(reloaded.locator('[data-scene-v2]')).toHaveAttribute(
      'data-motion-template',
      'warm',
    );
    // The one photo left, framed by the shot's own crop rather than shown flat.
    const shot = reloaded.locator('[data-scene-v2] img').first();
    await expect(shot).toHaveAttribute('data-motion-photo', SECOND_PHOTO_ID);
    expect(await shot.evaluate((element) => getComputedStyle(element).transform)).not.toBe('none');
  });
});

test('plays a stored v2 shot list, and moves through it on the media clock', async ({ page }) => {
  const state: ReviewState = {
    revision: { ...baseRevision, scene_definition: storedSceneV2() },
  };
  await mockMotionReview(page, state);

  await page.goto(`/consent/${CONSENT_TOKEN}`);

  const player = page.locator('[data-consent-motion-preview] [data-motion-player]');
  const stage = player.locator('[data-scene-v2]');

  await expect(player).toHaveAttribute('data-motion-source', 'scene-v2');
  await expect(player).toHaveAttribute('data-motion-reduced-motion', 'false');
  await expect(stage).toHaveAttribute('data-motion-shot', '0');
  // The progress bar is scene chrome, so it comes from the approved scene too.
  await expect(stage.locator('[data-scene-progress]')).toBeVisible();

  await player.locator('audio').evaluate((element) => {
    const audio = element as HTMLAudioElement;
    Object.defineProperty(audio, 'currentTime', { value: 20, configurable: true });
    audio.dispatchEvent(new Event('timeupdate'));
  });

  // A shot list, not a slideshow: 20s into a 24s recording is several shots in.
  await expect(stage).not.toHaveAttribute('data-motion-shot', '0');
});

test('switching the look is an unsaved edit that gates approval', async ({ page }) => {
  const state: ReviewState = {
    revision: { ...baseRevision, scene_definition: storedSceneV2() },
  };
  const { revisionBodies } = await mockMotionReview(page, state);

  await page.goto(`/consent/${CONSENT_TOKEN}`);

  const template = page.locator('[data-consent-template]');
  const approve = page.getByRole('button', { name: 'Approve & publish my page' });

  await expect(template).toHaveAttribute('data-consent-template', 'warm');

  await page.getByRole('radio', { name: /Hype/ }).check();
  await expect(template).toHaveAttribute('data-consent-template', 'hype');
  // The stored scene still holds the old look, so approving now would publish a
  // page that does not match the switcher.
  await expect(page.locator('[data-consent-motion-stale]')).toBeVisible();
  await expect(approve).toBeDisabled();

  // No text changed, so this needs no AI review consent — the moderation ledger
  // answers the unchanged wording.
  await page.getByRole('button', { name: 'Save my edits' }).click();
  await expect(page.getByText('Your edits are saved in a new review version.')).toBeVisible();

  const sentScene = (revisionBodies.at(-1) as { readonly new_scene: PitchSceneV2 }).new_scene;
  expect(sentScene.schemaVersion).toBe(2);
  expect(sentScene.template).toBe('hype');
  await expect(page.locator('[data-scene-v2]')).toHaveAttribute('data-motion-template', 'hype');
  await expect(page.locator('[data-consent-motion-stale]')).toHaveCount(0);
});

test.describe('with prefers-reduced-motion', () => {
  // This Playwright build exposes the media emulation through contextOptions.
  test.use({ contextOptions: { reducedMotion: 'reduce' } });

  test('plays the same shot list without camera travel', async ({ page }) => {
    const state: ReviewState = {
      revision: { ...baseRevision, scene_definition: storedSceneV2() },
    };
    await mockMotionReview(page, state);

    await page.goto(`/consent/${CONSENT_TOKEN}`);

    const player = page.locator('[data-consent-motion-preview] [data-motion-player]');
    await expect(player).toHaveAttribute('data-motion-reduced-motion', 'true');

    const stage = player.locator('[data-scene-v2]');
    const activeTransform = async () =>
      stage
        .locator('img')
        .first()
        .evaluate((element) => getComputedStyle(element).transform);

    const seek = async (seconds: number) =>
      player.locator('audio').evaluate((element, value) => {
        const audio = element as HTMLAudioElement;
        Object.defineProperty(audio, 'currentTime', { value, configurable: true });
        audio.dispatchEvent(new Event('timeupdate'));
      }, seconds);

    // Two moments inside the first shot. With travel on, a kenBurns would have
    // moved between them; held still, the framing is identical.
    await seek(0.1);
    const opening = await activeTransform();
    await seek(1.1);
    expect(await activeTransform()).toBe(opening);
    // …and no flash layer is ever mounted. This scene carries no overlay at all,
    // so the real proof is the paired test below; this only guards the shot list.
    await seek(11);
    await expect(stage.locator('[data-scene-light-leak]')).toHaveCount(0);
  });

  test('never mounts the light leak that motion mode does', async ({ page }) => {
    const state: ReviewState = {
      revision: { ...baseRevision, scene_definition: storedSceneV2WithLeak() },
    };
    await mockMotionReview(page, state);

    await page.goto(`/consent/${CONSENT_TOKEN}`);

    const player = page.locator('[data-consent-motion-preview] [data-motion-player]');
    await expect(player).toHaveAttribute('data-motion-source', 'scene-v2');
    await expect(player).toHaveAttribute('data-motion-reduced-motion', 'true');

    await seekTo(player, (LEAK_START_MS + LEAK_END_MS) / 2000);
    // Suppressed, not dimmed or frozen: with reduce-motion on there is no leak
    // element on the page at the exact millisecond it would otherwise peak.
    await expect(player.locator('[data-scene-light-leak]')).toHaveCount(0);
  });
});

/** The control for the test above: with motion on, the same leak IS drawn. */
test('draws the approved light leak when motion is allowed', async ({ page }) => {
  const state: ReviewState = {
    revision: { ...baseRevision, scene_definition: storedSceneV2WithLeak() },
  };
  await mockMotionReview(page, state);

  await page.goto(`/consent/${CONSENT_TOKEN}`);

  const player = page.locator('[data-consent-motion-preview] [data-motion-player]');
  await expect(player).toHaveAttribute('data-motion-reduced-motion', 'false');

  await seekTo(player, (LEAK_START_MS + LEAK_END_MS) / 2000);
  await expect(player.locator('[data-scene-light-leak]')).toHaveCount(1);
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
