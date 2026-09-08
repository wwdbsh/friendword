import { expect, test, type Page } from '@playwright/test';

import { isTranscriptionEditableStatus } from '@friendword/data';

const CONSENT_TOKEN = 'consenttesttoken12345678';
const DRAFT_ID = '10000000-0000-0000-0000-000000000001';
const DATER_ID = '00000000-0000-0000-0000-000000000002';
const REVISION_ID = '30000000-0000-0000-0000-000000000001';
const DATER_REVISION_ID = '30000000-0000-0000-0000-000000000002';
const FIRST_PHOTO_ID = '40000000-0000-0000-0000-000000000001';
const SECOND_PHOTO_ID = '40000000-0000-0000-0000-000000000002';
const VOICE_ASSET_ID = '40000000-0000-0000-0000-000000000003';
const DATER_PHOTO_ID = '40000000-0000-0000-0000-000000000004';

const pendingPreviewRow = {
  introducer_display_name: 'Maya',
  relationship_type: 'friend',
  relationship_duration: 'y3to10',
  request_status: 'pending',
};

const TRANSCRIPT_TEXT =
  'Okay so, Blair. Blair is the person who turns an ordinary Tuesday into the story you tell all year. She owns a place off Pike and the door is always open.';

const revisionRow = {
  id: REVISION_ID,
  pitch_draft_id: DRAFT_ID,
  revision_number: 2,
  headline: 'Blair turns ordinary Tuesdays into stories.',
  body: 'A thoughtful friend with a gift for making people feel included.',
  structure: { hard_claims_requiring_confirmation: ['Blair owns a home.'] },
  asset_ids: [FIRST_PHOTO_ID, SECOND_PHOTO_ID, VOICE_ASSET_ID],
  voice_asset_path: `${DRAFT_ID}/voice.m4a`,
  content_hash: 'revision-content-hash',
  // Frozen at revision time (migration 0032) and copied verbatim onto the
  // published draft at approval, so this is the exact text the public page
  // prints and the captions are cut from.
  transcript: { text: TRANSCRIPT_TEXT, segments: [] },
  structure_reviewed: false,
  created_at: '2026-07-13T00:00:00Z',
};

type ConsentAssetFixture = {
  readonly id: string;
  readonly pitch_draft_id: string;
  readonly uploaded_by_user_id: string;
  readonly asset_type: string;
  readonly storage_path: string;
  readonly sort_order: number;
  readonly created_at: string;
  readonly updated_at: string;
};

const assetRows: readonly ConsentAssetFixture[] = [
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

async function mockConsentReview(page: Page): Promise<void> {
  await page.route('**/rest/v1/consent_requests*', (route) =>
    route.fulfill({ json: { revision_id: REVISION_ID } }),
  );
  await page.route('**/rest/v1/consent_revisions*', (route) =>
    route.fulfill({ json: revisionRow }),
  );
  await page.route('**/rest/v1/pitch_assets*', (route) => route.fulfill({ json: assetRows }));
  await page.route('**/storage/v1/object/sign/pitch-media/**', (route) => {
    const objectPath = route.request().url().includes('voice.m4a')
      ? `${DRAFT_ID}/voice.m4a`
      : route.request().url().includes('one.jpg')
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
}

async function mockClaimedReview(
  page: Page,
  profile: { readonly displayName: string; readonly confirmed: boolean } = {
    displayName: 'Blair',
    confirmed: true,
  },
): Promise<void> {
  await mockPreview(page, [pendingPreviewRow]);
  await seedSignedInSession(page);
  await mockUserBootstrap(page, profile);
  await page.route('**/rest/v1/rpc/claim_consent_request*', (route) =>
    route.fulfill({ json: [{ pitch_draft_id: DRAFT_ID }] }),
  );
  await page.route('**/rest/v1/rpc/set_publish_preferences*', (route) =>
    route.fulfill({ json: null }),
  );
  // CP-1 (Slice 6): the dater confirms their own age/location/intent before
  // the page can publish.
  await page.route('**/rest/v1/rpc/set_dater_profile*', (route) => route.fulfill({ json: null }));
  // Dater AI-processing disclosure + consent (third audit P0-NEW-3): every
  // claimed review fetches the current disclosure revision, and agreeing records
  // draft-scoped consent before any photo/text reaches the AI review.
  await page.route('**/rest/v1/rpc/get_ai_disclosure_revision*', (route) =>
    route.fulfill({ json: 'ai-2026-07' }),
  );
  await page.route('**/rest/v1/rpc/record_ai_processing_consent*', (route) =>
    route.fulfill({ json: 'consent-id' }),
  );
  await mockConsentReview(page);
}

/** CP-1: fill the dater's own profile inputs so approval can proceed. */
async function fillDaterProfile(
  page: Page,
  options: { readonly birthDate?: string; readonly region?: string; readonly city?: string } = {},
): Promise<void> {
  const { birthDate = '1994-05-20', region = 'Puget Sound', city = 'Seattle' } = options;
  await page.getByLabel('Date of birth').fill(birthDate);
  await page.getByLabel('Region').fill(region);
  if (city !== '') {
    await page.getByLabel('City (optional)').fill(city);
  }
  await page.getByLabel('What you’re looking for').selectOption('long-term');
}

test('allows transcription only while a draft is editable', () => {
  expect(isTranscriptionEditableStatus('draft')).toBe(true);
  expect(isTranscriptionEditableStatus('changes_requested')).toBe(true);
  expect(isTranscriptionEditableStatus('consent_pending')).toBe(false);
  expect(isTranscriptionEditableStatus('published')).toBe(false);
});

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
  await mockClaimedReview(page);
  let approveBody: unknown;
  let profileBody: unknown;
  await page.route('**/rest/v1/rpc/set_dater_profile*', (route) => {
    profileBody = route.request().postDataJSON();
    return route.fulfill({ json: null });
  });
  await page.route('**/rest/v1/rpc/approve_and_publish_pitch*', (route) => {
    approveBody = route.request().postDataJSON();
    return route.fulfill({
      json: [
        { campaign_id: '20000000-0000-0000-0000-000000000001', campaign_slug: 'blair-mix123' },
      ],
    });
  });

  await page.goto(`/consent/${CONSENT_TOKEN}`);

  await test.step('Then the claimed dater reviews the original voice note', async () => {
    await expect(
      page.getByRole('heading', { name: 'Hear what Maya says about you.' }),
    ).toBeVisible();
    await expect(page.locator('audio')).toBeVisible();
    await expect(page.getByLabel('Headline')).toHaveValue(revisionRow.headline);
    await expect(page.getByLabel('Introduction')).toHaveValue(revisionRow.body);
    await expect(page.getByText('Blair owns a home.')).toBeVisible();
    await expect(page.getByLabel('14 days')).toBeChecked();
    await expect(page.getByLabel('Location visibility')).toHaveValue('city');
    await expect(page.getByLabel('Minimum age')).toHaveValue('18');
    await expect(page.getByLabel('Upload my photo')).toBeVisible();
    await expect(page.getByText('You stay in control', { exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Approve & publish my page' })).toBeDisabled();
    for (const viewport of [
      { name: 'mobile', width: 375, height: 812 },
      { name: 'tablet', width: 768, height: 1024 },
      { name: 'desktop', width: 1280, height: 900 },
    ] as const) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      const hasHorizontalOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      );
      expect(hasHorizontalOverflow).toBe(false);
      await page.screenshot({
        path: `/tmp/friendword-consent-review-${viewport.name}.png`,
        fullPage: true,
      });
    }
  });

  await test.step('The dater must confirm their own age, location, and intent (CP-1)', async () => {
    await page.getByLabel('I confirm the claims above are true.').check();
    // Missing profile inputs keep approval disabled.
    await expect(page.getByRole('button', { name: 'Approve & publish my page' })).toBeDisabled();
    await fillDaterProfile(page);
    // The real output preview reflects the confirmed inputs (region+city).
    await expect(page.getByText('Blair, 32')).toBeVisible();
    await expect(page.getByText('Seattle, Puget Sound').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Approve & publish my page' })).toBeEnabled();
  });

  await test.step('A minimum age below 18 blocks approval on the client', async () => {
    await page.getByLabel('Minimum age').fill('17');
    await expect(page.getByText('Minimum age must be 18 or older.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Approve & publish my page' })).toBeDisabled();
    await page.getByLabel('Minimum age').fill('18');
  });

  await test.step('When the dater confirms claims and approves with the defaults', async () => {
    await page.getByLabel('I confirm the claims above are true.').check();
    await page.getByRole('button', { name: 'Approve & publish my page' }).click();
    // GAP-4: approval lands on a hand-off screen that names the owner's inbox
    // before the public page — the page itself has no owner controls.
    await expect(page.getByRole('heading', { name: 'Your page is live.' })).toBeVisible();
    // The URL no longer changes on approval, so focus moves to the new heading
    // in place of the announcement a route change used to give.
    await expect(page.getByRole('heading', { name: 'Your page is live.' })).toBeFocused();
    await expect(page.getByRole('link', { name: 'Manage my page' })).toHaveAttribute(
      'href',
      '/inbox',
    );
    await page.getByRole('link', { name: 'See my public page' }).click();
    await page.waitForURL('**/p/blair-mix123');
    expect(profileBody).toEqual({
      target_birth_date: '1994-05-20',
      target_region: 'Puget Sound',
      target_city: 'Seattle',
      target_intent: 'long-term',
    });
    expect(approveBody).toEqual({
      draft_id: DRAFT_ID,
      campaign_days: 14,
      revision_id: REVISION_ID,
      included_asset_ids: [FIRST_PHOTO_ID, SECOND_PHOTO_ID],
      hard_claims_confirmed: true,
    });
  });
});

test('saves dater edits with voice retained, reloads the revision, and publishes for 7 days', async ({
  page,
}) => {
  await mockClaimedReview(page);
  let activeRevision = revisionRow;
  let revisionBody: unknown;
  let preferencesBody: unknown;
  let approveBody: unknown;

  await page.route('**/rest/v1/consent_requests*', (route) =>
    route.fulfill({ json: { revision_id: activeRevision.id } }),
  );
  await page.route('**/rest/v1/consent_revisions*', (route) =>
    route.fulfill({ json: activeRevision }),
  );
  await page.route('**/rest/v1/pitch_assets*', (route) =>
    route.fulfill({
      json: assetRows.filter((asset) => activeRevision.asset_ids.includes(asset.id)),
    }),
  );
  await page.route('**/rest/v1/rpc/create_dater_revision*', (route) => {
    revisionBody = route.request().postDataJSON();
    activeRevision = {
      ...revisionRow,
      id: DATER_REVISION_ID,
      revision_number: 3,
      headline: 'The headline I chose myself.',
      body: 'The introduction I reviewed and rewrote myself.',
      asset_ids: [SECOND_PHOTO_ID, VOICE_ASSET_ID],
    };
    return route.fulfill({
      json: [{ revision_id: DATER_REVISION_ID, revision_number: 3 }],
    });
  });
  await page.route('**/rest/v1/rpc/set_publish_preferences*', (route) => {
    preferencesBody = route.request().postDataJSON();
    return route.fulfill({ json: null });
  });
  await page.route('**/rest/v1/rpc/approve_and_publish_pitch*', (route) => {
    approveBody = route.request().postDataJSON();
    return route.fulfill({
      json: [
        { campaign_id: '20000000-0000-0000-0000-000000000001', campaign_slug: 'blair-edited' },
      ],
    });
  });
  let moderateBody: unknown;
  await page.route('**/api/moderate-text', (route) => {
    moderateBody = route.request().postDataJSON();
    return route.fulfill({ json: { ok: true, moderationStatus: 'passed' } });
  });

  await page.goto(`/consent/${CONSENT_TOKEN}`);
  await page.getByRole('button', { name: 'Agree to the AI safety review' }).click();
  await page.getByLabel('Headline').fill('The headline I chose myself.');
  await page.getByLabel('Introduction').fill('The introduction I reviewed and rewrote myself.');
  await page.getByRole('button', { name: 'Exclude suggested photo 1' }).click();
  await page.getByRole('button', { name: 'Save my edits' }).click();

  await expect(page.getByText('Your edits are saved in a new review version.')).toBeVisible();
  await expect(page.getByLabel('Headline')).toHaveValue('The headline I chose myself.');
  expect(moderateBody).toEqual({
    kind: 'dater_pitch_content',
    draftId: DRAFT_ID,
    headline: 'The headline I chose myself.',
    body: 'The introduction I reviewed and rewrote myself.',
  });
  expect(revisionBody).toEqual({
    draft_id: DRAFT_ID,
    new_headline: 'The headline I chose myself.',
    new_body: 'The introduction I reviewed and rewrote myself.',
    included_asset_ids: [SECOND_PHOTO_ID, VOICE_ASSET_ID],
  });

  await fillDaterProfile(page);
  await page.getByLabel('7 days').check();
  await page.getByLabel('Location visibility').selectOption('hidden');
  await page.getByLabel('Minimum age').fill('21');
  await page.getByLabel('Maximum age (optional)').fill('35');
  await page.getByLabel('Long-term').check();
  // Hidden precision keeps the location out of the real preview snapshot.
  await expect(page.locator('dd', { hasText: 'Hidden' })).toBeVisible();
  await expect(page.getByText('Blair, 32')).toBeVisible();
  await page.getByLabel('I confirm the claims above are true.').check();
  await page.getByRole('button', { name: 'Approve & publish my page' }).click();
  await page.getByRole('link', { name: 'See my public page' }).click();
  await page.waitForURL('**/p/blair-edited');

  expect(preferencesBody).toEqual({
    draft_id: DRAFT_ID,
    audience: { min_age: 21, max_age: 35, intents: ['long-term'] },
    target_location_precision: 'hidden',
    target_publish_days: 7,
  });
  expect(approveBody).toEqual({
    draft_id: DRAFT_ID,
    campaign_days: 7,
    revision_id: DATER_REVISION_ID,
    included_asset_ids: [SECOND_PHOTO_ID],
    hard_claims_confirmed: true,
  });
});

test('uploads and validates a dater photo before saving it in the full revision snapshot', async ({
  page,
}) => {
  await mockClaimedReview(page);
  let activeRevision = revisionRow;
  let activeAssets: readonly ConsentAssetFixture[] = assetRows;
  let revisionBody: unknown;
  let assetInsertBody: unknown;
  let uploadedObjectName = '';
  const moderatedTexts: Record<string, unknown>[] = [];

  await page.route('**/rest/v1/consent_requests*', (route) =>
    route.fulfill({ json: { revision_id: activeRevision.id } }),
  );
  await page.route('**/rest/v1/consent_revisions*', (route) =>
    route.fulfill({ json: activeRevision }),
  );
  await page.route('**/rest/v1/pitch_assets*', (route) => {
    const request = route.request();
    if (request.method() === 'POST') {
      assetInsertBody = request.postDataJSON();
      const registered = {
        id: DATER_PHOTO_ID,
        pitch_draft_id: DRAFT_ID,
        uploaded_by_user_id: DATER_ID,
        asset_type: 'photo',
        storage_path: `pitch-media/${DRAFT_ID}/${uploadedObjectName.split('/').at(-1)}`,
        sort_order: 2,
        created_at: '2026-07-13T00:00:00Z',
        updated_at: '2026-07-13T00:00:00Z',
      };
      activeAssets = [...activeAssets, registered];
      return route.fulfill({ json: registered });
    }
    if (request.url().includes('select=sort_order')) {
      return route.fulfill({ json: [{ sort_order: 1 }] });
    }
    return route.fulfill({
      json: activeAssets.filter((asset) => activeRevision.asset_ids.includes(asset.id)),
    });
  });
  await page.route('**/storage/v1/object/upload/sign/pitch-media/**', (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const marker = '/object/upload/sign/pitch-media/';
    uploadedObjectName = decodeURIComponent(url.pathname.split(marker)[1] ?? '');
    if (request.method() === 'POST') {
      return route.fulfill({
        json: {
          url: `${marker}${uploadedObjectName}?token=playwright-upload`,
        },
      });
    }
    return route.fulfill({ json: { Key: `pitch-media/${uploadedObjectName}` } });
  });
  await page.route('**/api/media/validate', (route) =>
    route.fulfill({ json: { ok: true, moderationStatus: 'passed' } }),
  );
  // Every save registers a verdict for the exact words it is about to freeze,
  // photo-only included: create_dater_revision checks the ledger on every call
  // (0047), so skipping the call when the text is unchanged locked the Dater
  // out as soon as media_validation_enforcement was switched on.
  await page.route('**/api/moderate-text', (route) => {
    moderatedTexts.push(route.request().postDataJSON() as Record<string, unknown>);
    return route.fulfill({ json: { ok: true, moderationStatus: 'passed' } });
  });
  await page.route('**/storage/v1/object/sign/pitch-media/**dater-*.*', (route) =>
    route.fulfill({
      json: {
        signedURL: `/object/sign/pitch-media/${DRAFT_ID}/${uploadedObjectName.split('/').at(-1)}?token=playwright`,
      },
    }),
  );
  await page.route('**/rest/v1/rpc/create_dater_revision*', (route) => {
    revisionBody = route.request().postDataJSON();
    activeRevision = {
      ...revisionRow,
      id: DATER_REVISION_ID,
      revision_number: 3,
      asset_ids: [FIRST_PHOTO_ID, SECOND_PHOTO_ID, VOICE_ASSET_ID, DATER_PHOTO_ID],
    };
    return route.fulfill({
      json: [{ revision_id: DATER_REVISION_ID, revision_number: 3 }],
    });
  });

  await page.goto(`/consent/${CONSENT_TOKEN}`);
  await page.getByRole('button', { name: 'Agree to the AI safety review' }).click();
  await expect(page.getByLabel('Upload my photo')).toBeEnabled();
  await page.getByLabel('Upload my photo').setInputFiles({
    name: 'my-photo.png',
    mimeType: 'image/png',
    buffer: Buffer.from('playwright-image-fixture'),
  });

  await expect(
    page.getByText('Photo uploaded. Save your edits to add it to this review version.'),
  ).toBeVisible();
  expect(assetInsertBody).toEqual({
    pitch_draft_id: DRAFT_ID,
    uploaded_by_user_id: DATER_ID,
    asset_type: 'photo',
    storage_path: `pitch-media/${DRAFT_ID}/${uploadedObjectName.split('/').at(-1)}`,
    sort_order: 2,
    // Migration 0048: the browser records the source pixel size for the renderer.
    // This fixture is not a decodable image, so the size is honestly NULL and the
    // upload still succeeds — /api/media/validate owns rejecting a bad file.
    width: null,
    height: null,
  });
  await page.getByRole('button', { name: 'Save my edits' }).click();
  await expect(page.getByText('Your edits are saved in a new review version.')).toBeVisible();
  expect(revisionBody).toEqual({
    draft_id: DRAFT_ID,
    new_headline: revisionRow.headline,
    new_body: revisionRow.body,
    included_asset_ids: [FIRST_PHOTO_ID, SECOND_PHOTO_ID, VOICE_ASSET_ID, DATER_PHOTO_ID],
  });
  // The photo-only save still registers the verdict for the words it freezes.
  expect(moderatedTexts).toContainEqual({
    kind: 'dater_pitch_content',
    draftId: DRAFT_ID,
    headline: revisionRow.headline,
    body: revisionRow.body,
  });
});

// FIFTH-AUDIT REGRESSION — P0 (the Dater approves the words that publish).
// The public page renders the five `structure` fields and ignores the approved
// body, so editing headline/body alone published the AI's original sentences.
// The Dater now edits the structure itself, under the same labels the public
// page prints.
//
// Reach: this spec mocks Supabase at the browser boundary, and /p/[slug] is
// server-rendered from the service client, so the final "the sentence is on the
// public page" hop is covered by tests-audit3/dater-structure-edit.audit3.test.ts
// (fromPublishedPitch) and supabase/tests/23_dater_structure_edit.sql instead.
const structuredRevisionRow = {
  ...revisionRow,
  structure: {
    hook: 'Blair turns ordinary Tuesdays into stories.',
    relationship_context: 'We shared a wall in a Capitol Hill apartment for four years.',
    three_specific_qualities: ['Remembers every birthday', 'Cooks for a crowd', 'Never gossips'],
    evidence_or_anecdote: 'Blair drove three hours to sit with me after my surgery.',
    good_match_for: 'Someone who likes long walks and longer conversations.',
    hard_claims_requiring_confirmation: ['Blair owns a home.'],
  },
};

const EDITED_QUALITY = 'Turns a bad week into a dinner party';
// No hard_claims_requiring_confirmation: the client must never send the AI's
// safety flag back, so it cannot be edited away.
const EDITED_STRUCTURE = {
  hook: structuredRevisionRow.structure.hook,
  relationship_context: structuredRevisionRow.structure.relationship_context,
  three_specific_qualities: ['Remembers every birthday', EDITED_QUALITY, 'Never gossips'],
  evidence_or_anecdote: structuredRevisionRow.structure.evidence_or_anecdote,
  good_match_for: structuredRevisionRow.structure.good_match_for,
};
const DERIVED_HEADLINE = EDITED_STRUCTURE.hook;
const DERIVED_BODY = `${EDITED_STRUCTURE.relationship_context}\n\n${EDITED_STRUCTURE.evidence_or_anecdote}\n\nA good match: ${EDITED_STRUCTURE.good_match_for}`;

test('lets the dater edit the five published fields and publishes those exact words', async ({
  page,
}) => {
  await mockClaimedReview(page);
  let activeRevision = structuredRevisionRow;
  let revisionBody: unknown;
  let moderateBody: unknown;
  let approveBody: unknown;

  await page.route('**/rest/v1/consent_requests*', (route) =>
    route.fulfill({ json: { revision_id: activeRevision.id } }),
  );
  await page.route('**/rest/v1/consent_revisions*', (route) =>
    route.fulfill({ json: activeRevision }),
  );
  await page.route('**/api/moderate-text', (route) => {
    moderateBody = route.request().postDataJSON();
    return route.fulfill({ json: { ok: true, moderationStatus: 'passed' } });
  });
  await page.route('**/rest/v1/rpc/create_dater_revision*', (route) => {
    revisionBody = route.request().postDataJSON();
    activeRevision = {
      ...structuredRevisionRow,
      id: DATER_REVISION_ID,
      revision_number: 3,
      headline: DERIVED_HEADLINE,
      body: DERIVED_BODY,
      structure: {
        ...EDITED_STRUCTURE,
        // The RPC preserves the AI's hard claims; the client never sends them.
        hard_claims_requiring_confirmation: ['Blair owns a home.'],
      },
    };
    return route.fulfill({ json: [{ revision_id: DATER_REVISION_ID, revision_number: 3 }] });
  });
  await page.route('**/rest/v1/rpc/approve_and_publish_pitch*', (route) => {
    approveBody = route.request().postDataJSON();
    return route.fulfill({
      json: [
        { campaign_id: '20000000-0000-0000-0000-000000000001', campaign_slug: 'blair-structure' },
      ],
    });
  });

  await page.goto(`/consent/${CONSENT_TOKEN}`);

  await test.step('Then every published field is editable under the public page’s own labels', async () => {
    await expect(page.getByLabel('The hook')).toHaveValue(structuredRevisionRow.structure.hook);
    await expect(page.getByLabel('How they know each other')).toHaveValue(
      structuredRevisionRow.structure.relationship_context,
    );
    await expect(page.getByLabel('Thing 1')).toHaveValue('Remembers every birthday');
    await expect(page.getByLabel('Thing 2')).toHaveValue('Cooks for a crowd');
    await expect(page.getByLabel('Thing 3')).toHaveValue('Never gossips');
    await expect(page.getByLabel('A moment that shows it')).toHaveValue(
      structuredRevisionRow.structure.evidence_or_anecdote,
    );
    await expect(page.getByLabel('A good match for')).toHaveValue(
      structuredRevisionRow.structure.good_match_for,
    );
    // The claims flow is untouched: hard claims stay AI-owned and confirmable.
    await expect(page.getByText('Blair owns a home.')).toBeVisible();
    // The extra fields must not push the review sideways on a small phone.
    await page.setViewportSize({ width: 320, height: 720 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
    ).toBe(false);
    await page.setViewportSize({ width: 390, height: 844 });
  });

  await test.step('When the dater rewrites one of the three specific things', async () => {
    await page.getByRole('button', { name: 'Agree to the AI safety review' }).click();
    await page.getByLabel('Thing 2').fill(EDITED_QUALITY);
    await page.getByRole('button', { name: 'Save my edits' }).click();
    await expect(page.getByText('Your edits are saved in a new review version.')).toBeVisible();
  });

  await test.step('Then the edited sentence — not the AI’s — is what gets frozen', async () => {
    expect(revisionBody).toEqual({
      draft_id: DRAFT_ID,
      new_headline: DERIVED_HEADLINE,
      new_body: DERIVED_BODY,
      included_asset_ids: [FIRST_PHOTO_ID, SECOND_PHOTO_ID, VOICE_ASSET_ID],
      new_structure: EDITED_STRUCTURE,
    });
    // hard_claims_requiring_confirmation is never client-editable.
    expect(revisionBody).not.toHaveProperty('new_structure.hard_claims_requiring_confirmation');
    // The published qualities are inside the moderated text.
    expect(moderateBody).toEqual({
      kind: 'dater_pitch_content',
      draftId: DRAFT_ID,
      headline: DERIVED_HEADLINE,
      body: DERIVED_BODY,
      qualities: EDITED_STRUCTURE.three_specific_qualities,
    });
  });

  await test.step('And the page preview shows the edited line while untouched lines stay', async () => {
    await expect(page.getByLabel('Thing 2')).toHaveValue(EDITED_QUALITY);
    const previewList = page.locator('ul li');
    await expect(previewList.filter({ hasText: EDITED_QUALITY })).toBeVisible();
    await expect(previewList.filter({ hasText: 'Cooks for a crowd' })).toHaveCount(0);
    await expect(previewList.filter({ hasText: 'Never gossips' })).toBeVisible();
    await expect(page.getByText('Three specific things').first()).toBeVisible();
  });

  await test.step('And approval publishes that revision', async () => {
    await fillDaterProfile(page);
    await page.getByLabel('I confirm the claims above are true.').check();
    await page.getByRole('button', { name: 'Approve & publish my page' }).click();
    await page.getByRole('link', { name: 'See my public page' }).click();
    await page.waitForURL('**/p/blair-structure');
    expect(approveBody).toMatchObject({
      draft_id: DRAFT_ID,
      revision_id: DATER_REVISION_ID,
      hard_claims_confirmed: true,
    });
  });
});

test('keeps the AI wording when the dater changes nothing', async ({ page }) => {
  await mockClaimedReview(page);
  let revisionCalls = 0;
  await page.route('**/rest/v1/consent_revisions*', (route) =>
    route.fulfill({ json: structuredRevisionRow }),
  );
  await page.route('**/rest/v1/rpc/create_dater_revision*', (route) => {
    revisionCalls += 1;
    return route.fulfill({ json: [{ revision_id: DATER_REVISION_ID, revision_number: 3 }] });
  });

  await page.goto(`/consent/${CONSENT_TOKEN}`);

  await expect(page.getByLabel('Thing 2')).toHaveValue('Cooks for a crowd');
  await expect(page.locator('ul li').filter({ hasText: 'Cooks for a crowd' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save my edits' })).toBeDisabled();
  expect(revisionCalls).toBe(0);
});

// FIFTH-AUDIT REGRESSION — the save lockout (verdicts 4 and 6, decision D3).
// create_dater_revision derives headline/body from the published structure on
// every path and checks the verdict for THAT string on every save, so a save
// that moderated `headline\n\nbody` — or moderated nothing at all — left the
// Dater permanently unable to save again once enforcement was switched on.
// This pins the exact bytes: the second save re-registers the same five-part
// string as the first, from the structure alone.
test('a photo-only save after a structure edit still saves, and re-registers the same words', async ({
  page,
}) => {
  await mockClaimedReview(page);
  let activeRevision = structuredRevisionRow;
  const moderatedTexts: Record<string, unknown>[] = [];
  const revisionBodies: Record<string, unknown>[] = [];

  await page.route('**/rest/v1/consent_requests*', (route) =>
    route.fulfill({ json: { revision_id: activeRevision.id } }),
  );
  await page.route('**/rest/v1/consent_revisions*', (route) =>
    route.fulfill({ json: activeRevision }),
  );
  await page.route('**/api/moderate-text', (route) => {
    moderatedTexts.push(route.request().postDataJSON() as Record<string, unknown>);
    return route.fulfill({ json: { ok: true, moderationStatus: 'passed' } });
  });
  await page.route('**/rest/v1/rpc/create_dater_revision*', (route) => {
    revisionBodies.push(route.request().postDataJSON() as Record<string, unknown>);
    activeRevision = {
      ...structuredRevisionRow,
      id: DATER_REVISION_ID,
      revision_number: 3,
      headline: DERIVED_HEADLINE,
      body: DERIVED_BODY,
      structure: {
        ...EDITED_STRUCTURE,
        hard_claims_requiring_confirmation: ['Blair owns a home.'],
      },
      // The server sets this once the Dater submits the five fields, and keeps
      // it set for the rest of the review.
      structure_reviewed: true,
    };
    return route.fulfill({ json: [{ revision_id: DATER_REVISION_ID, revision_number: 3 }] });
  });

  await page.goto(`/consent/${CONSENT_TOKEN}`);

  await test.step('Given a structure edit that was saved', async () => {
    await page.getByRole('button', { name: 'Agree to the AI safety review' }).click();
    await page.getByLabel('Thing 2').fill(EDITED_QUALITY);
    await page.getByRole('button', { name: 'Save my edits' }).click();
    await expect(page.getByText('Your edits are saved in a new review version.')).toBeVisible();
  });

  await test.step('When the dater then changes only which photos are included', async () => {
    await page.getByRole('button', { name: 'Exclude suggested photo 2' }).click();
    await page.getByRole('button', { name: 'Save my edits' }).click();
    await expect(page.getByText('Your edits are saved in a new review version.')).toBeVisible();
  });

  await test.step('Then it saved, and both saves registered the identical string', async () => {
    expect(revisionBodies).toHaveLength(2);
    // The structure travels with the photo-only save too: without it the RPC
    // would still hash the five-part string but the client would have vouched
    // for something else.
    expect(revisionBodies[1]).toMatchObject({ new_structure: EDITED_STRUCTURE });
    expect(moderatedTexts).toHaveLength(2);
    expect(moderatedTexts[1]).toEqual(moderatedTexts[0]);
    // Byte-for-byte: private.dater_revision_moderation_text's structure form is
    // hook \n\n derived body \n\n q1 \n\n q2 \n\n q3.
    expect(moderatedTexts[1]).toEqual({
      kind: 'dater_pitch_content',
      draftId: DRAFT_ID,
      headline: DERIVED_HEADLINE,
      body: DERIVED_BODY,
      qualities: EDITED_STRUCTURE.three_specific_qualities,
    });
  });
});

// FIFTH-AUDIT REGRESSION — P0, decision D1 (the transcript is published text
// the Dater could neither see nor reject). It is printed in full under the
// pitch AND runs as the captions over the photos, yet the word "transcript"
// did not appear once in this flow. It stays read-only on purpose — it is what
// the Introducer actually said — so the escape hatch is "Request changes".
test('shows the Dater the transcript that will publish, read-only', async ({ page }) => {
  await mockClaimedReview(page);

  await page.goto(`/consent/${CONSENT_TOKEN}`);

  await test.step('The exact published text is on screen inside the Listen step', async () => {
    const transcript = page.locator('[data-consent-transcript-text]');
    await expect(transcript).toHaveText(TRANSCRIPT_TEXT);
    await expect(
      page.locator('[data-consent-step="listen"] [data-consent-transcript]'),
    ).toHaveCount(1);
  });

  await test.step('It says where it publishes, and that it cannot be edited', async () => {
    const block = page.locator('[data-consent-transcript]');
    await expect(block).toContainText('runs as the captions over your photos');
    await expect(block).toContainText('printed in full underneath');
    await expect(block).toContainText('You can’t edit it');
    await expect(block).toContainText('Request changes');
    // Read-only means read-only: no input of any kind inside the block.
    await expect(block.locator('input, textarea, [contenteditable="true"]')).toHaveCount(0);
  });

  await test.step('And the request-changes escape hatch it points at is really there', async () => {
    await expect(page.getByRole('button', { name: 'Request changes' })).toBeVisible();
  });
});

test('says so honestly when the recording has no transcript', async ({ page }) => {
  await mockClaimedReview(page);
  await page.route('**/rest/v1/consent_revisions*', (route) =>
    route.fulfill({ json: { ...revisionRow, transcript: null } }),
  );

  await page.goto(`/consent/${CONSENT_TOKEN}`);

  const block = page.locator('[data-consent-transcript]');
  await expect(block).toContainText('We don’t have a written transcript');
  await expect(block).toContainText('no transcript and no captions');
  await expect(page.locator('[data-consent-transcript-text]')).toHaveCount(0);
});

// FIFTH-AUDIT REGRESSION — P0, decision D2 (verdicts 2 and 4). The old screen
// listed the flagged claims and demanded "I confirm all of these claims are
// true" — for a claim the Dater may have deleted from their page precisely
// because it was false. Each claim now gets its own disposition, the removed
// ones leave the published structure, and the attestation covers only the rest.
test('lets the dater remove a flagged claim instead of attesting to it', async ({ page }) => {
  await mockClaimedReview(page);
  let revisionBody: Record<string, unknown> | undefined;
  await page.route('**/api/moderate-text', (route) =>
    route.fulfill({ json: { ok: true, moderationStatus: 'passed' } }),
  );
  await page.route('**/rest/v1/rpc/create_dater_revision*', (route) => {
    revisionBody = route.request().postDataJSON() as Record<string, unknown>;
    return route.fulfill({ json: [{ revision_id: DATER_REVISION_ID, revision_number: 3 }] });
  });

  await page.goto(`/consent/${CONSENT_TOKEN}`);

  await test.step('Given a flagged claim, both answers are offered', async () => {
    const claim = page.locator('[data-hard-claim]').filter({ hasText: 'Blair owns a home.' });
    await expect(claim).toHaveCount(1);
    await expect(claim.getByLabel('Still true — keep it on my page')).toBeChecked();
    await expect(claim.getByLabel('I took that out of my page')).not.toBeChecked();
    // The old blanket wording must be gone.
    await expect(page.getByText('I confirm all of these claims are true.')).toHaveCount(0);
  });

  await test.step('When the dater says they took it out, approval is blocked until saved', async () => {
    await page.getByLabel('I took that out of my page').check();
    await expect(page.getByText('Save your edits before approving this page.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Approve & publish my page' })).toBeDisabled();
    // The attestation no longer covers a claim that is leaving the page.
    await expect(
      page.getByLabel('I confirm the introduction on my page is truthful and accurate.'),
    ).toBeVisible();
  });

  await test.step('Then saving sends the retained list, not the flagged one', async () => {
    await page.getByRole('button', { name: 'Save my choices' }).click();
    await expect(page.getByText('The claims you took off your page are gone from it.')).toBeVisible(
      { timeout: 10_000 },
    );
    // An empty array is the whole point: NULL would keep every flagged claim.
    expect(revisionBody?.retained_hard_claims).toEqual([]);
  });
});

test('falls back to headline and body when the snapshot has no editable structure', async ({
  page,
}) => {
  await mockClaimedReview(page);

  await page.goto(`/consent/${CONSENT_TOKEN}`);

  // revisionRow carries hard claims only — an honest fallback, not blank fields.
  await expect(page.getByLabel('Headline')).toHaveValue(revisionRow.headline);
  await expect(page.getByLabel('Introduction')).toHaveValue(revisionRow.body);
  await expect(page.getByText('drafted before the section-by-section editor')).toBeVisible();
  await expect(page.getByLabel('The hook')).toHaveCount(0);
});

test('gates photo upload behind the dater AI-processing consent', async ({ page }) => {
  await mockClaimedReview(page);
  let validateCalls = 0;
  await page.route('**/api/media/validate', (route) => {
    validateCalls += 1;
    return route.fulfill({ json: { ok: true, moderationStatus: 'passed' } });
  });

  await page.goto(`/consent/${CONSENT_TOKEN}`);

  await test.step('Before agreeing, the disclosure shows and upload is disabled', async () => {
    await expect(
      page.getByText('runs it through an external AI safety review', { exact: false }),
    ).toBeVisible();
    await expect(page.getByLabel('Upload my photo')).toBeDisabled();
  });

  await test.step('After agreeing, upload is enabled and the disclosure is gone', async () => {
    await page.getByRole('button', { name: 'Agree to the AI safety review' }).click();
    await expect(page.getByLabel('Upload my photo')).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Agree to the AI safety review' })).toHaveCount(
      0,
    );
    expect(validateCalls).toBe(0);
  });
});

test('blocks review when a snapshotted photo cannot be loaded', async ({ page }) => {
  await mockClaimedReview(page);
  await page.route('**/storage/v1/object/sign/pitch-media/**one.jpg*', (route) =>
    route.fulfill({ status: 500, json: { message: 'storage unavailable' } }),
  );

  await page.goto(`/consent/${CONSENT_TOKEN}`);

  await expect(page.getByRole('heading', { name: 'We hit a snag.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve & publish my page' })).toHaveCount(0);
});

test('blocks review when the snapshotted voice note cannot be loaded', async ({ page }) => {
  await mockClaimedReview(page);
  await page.route('**/storage/v1/object/sign/pitch-media/**voice.m4a*', (route) =>
    route.fulfill({ status: 500, json: { message: 'storage unavailable' } }),
  );

  await page.goto(`/consent/${CONSENT_TOKEN}`);

  await expect(page.getByRole('heading', { name: 'We hit a snag.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve & publish my page' })).toHaveCount(0);
});

test('requires a note and completes a request for changes', async ({ page }) => {
  await mockClaimedReview(page);
  let responseBody: unknown;
  await page.route('**/rest/v1/rpc/respond_consent_request*', (route) => {
    responseBody = route.request().postDataJSON();
    return route.fulfill({ json: null });
  });

  await page.goto(`/consent/${CONSENT_TOKEN}`);
  await page.getByRole('button', { name: 'Request changes' }).click();
  const note = page.getByLabel('What should your friend change?');
  await expect(page.getByRole('button', { name: 'Request changes' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await expect(note).toHaveAttribute('required', '');
  await expect(note).toBeFocused();
  await page.screenshot({ path: '/tmp/friendword-consent-change-request.png', fullPage: true });
  await page.getByRole('button', { name: 'Send change request' }).click();
  expect(responseBody).toBeUndefined();

  await note.fill('Please remove the home ownership claim.');
  await page.getByRole('button', { name: 'Send change request' }).click();

  await expect(page.getByRole('heading', { name: 'Changes requested.' })).toBeVisible();
  expect(responseBody).toEqual({
    draft_id: DRAFT_ID,
    action: 'request_changes',
    note: 'Please remove the home ownership claim.',
  });
});

test('explains the irreversible impact before declining', async ({ page }) => {
  await mockClaimedReview(page);
  let dialogMessage = '';
  let responseBody: unknown;
  page.on('dialog', async (dialog) => {
    dialogMessage = dialog.message();
    await dialog.accept();
  });
  await page.route('**/rest/v1/rpc/respond_consent_request*', (route) => {
    responseBody = route.request().postDataJSON();
    return route.fulfill({ json: null });
  });

  await page.goto(`/consent/${CONSENT_TOKEN}`);
  await page.getByRole('button', { name: 'Politely decline' }).click();

  await expect(page.getByRole('heading', { name: 'Pitch declined.' })).toBeVisible();
  expect(dialogMessage).toContain('This cannot be undone.');
  expect(dialogMessage).toContain('archives the pitch');
  expect(responseBody).toEqual({
    draft_id: DRAFT_ID,
    action: 'decline',
    note: 'I do not consent to publication.',
  });
});

test('requires the dater to reload when approval targets a stale revision', async ({ page }) => {
  await mockClaimedReview(page);
  await page.route('**/rest/v1/rpc/approve_and_publish_pitch*', (route) =>
    route.fulfill({
      status: 400,
      json: {
        code: 'P0001',
        message: 'approval requires the latest consent revision',
        details: null,
        hint: null,
      },
    }),
  );

  await page.goto(`/consent/${CONSENT_TOKEN}`);
  await page.getByLabel('I confirm the claims above are true.').check();
  await fillDaterProfile(page);
  await page.getByRole('button', { name: 'Approve & publish my page' }).click();

  await expect(page.getByRole('heading', { name: 'The introduction was updated.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reload the latest version' })).toBeVisible();
});

// T002 (Issue #71). The stored value at this point is the email local-part
// `handle_new_auth_user` (0011) invented. Prefilling it turns the question into
// a default — and the default is what gets printed on this dater's public page,
// so the field starts EMPTY and the dater types their own name.
test('asks for a display name without proposing the email-derived one', async ({ page }) => {
  await mockClaimedReview(page, { displayName: 'blair.kim92', confirmed: false });

  await page.goto(`/consent/${CONSENT_TOKEN}`);

  await test.step('Then the field is empty rather than prefilled', async () => {
    await expect(page.getByRole('heading', { name: 'What should we call you?' })).toBeVisible();
    await expect(page.getByLabel('Your name')).toHaveValue('');
    await expect(page.getByText('blair.kim92')).toHaveCount(0);
  });

  await test.step('When the dater types their name, the review begins', async () => {
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

test('explains a contact mismatch and lets the dater retry with another email', async ({
  page,
}) => {
  await mockPreview(page, [pendingPreviewRow]);
  await seedSignedInSession(page);
  await mockUserBootstrap(page, { displayName: 'Blair', confirmed: true });
  await page.route('**/rest/v1/rpc/claim_consent_request*', (route) =>
    route.fulfill({
      status: 400,
      json: {
        code: 'P0001',
        message: 'consent invite was sent to a different contact',
        details: null,
        hint: null,
      },
    }),
  );
  let logoutCalls = 0;
  await page.route('**/auth/v1/logout*', (route) => {
    logoutCalls += 1;
    return route.fulfill({ status: 204 });
  });

  await page.goto(`/consent/${CONSENT_TOKEN}`);

  await test.step('Then the mismatch names the cause and required account', async () => {
    await expect(
      page.getByRole('heading', { name: 'Use the email that received this invite.' }),
    ).toBeVisible();
    await expect(
      page.getByText(
        'This invite was sent to a different email address. Sign in with the email that received it.',
      ),
    ).toBeVisible();

    for (const viewport of [
      { name: 'mobile', width: 375, height: 812 },
      { name: 'tablet', width: 768, height: 1024 },
      { name: 'desktop', width: 1280, height: 900 },
    ] as const) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      const hasHorizontalOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      );
      expect(hasHorizontalOverflow).toBe(false);
      await page.screenshot({
        path: `/tmp/friendword-consent-contact-mismatch-${viewport.name}.png`,
        fullPage: true,
      });
    }
  });

  await test.step('When the dater chooses another email, the current session is signed out', async () => {
    const retryButton = page.getByRole('button', { name: 'Sign out and use another email' });
    await retryButton.focus();
    await expect(retryButton).toBeFocused();
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await page.screenshot({
      path: '/tmp/friendword-consent-contact-mismatch-focus.png',
      fullPage: false,
    });
    await retryButton.click();
    await expect(page.getByLabel('Your email')).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => window.localStorage.getItem('friendword-web-auth')))
      .toBeNull();
    await page.screenshot({
      path: '/tmp/friendword-consent-contact-mismatch-retry.png',
      fullPage: true,
    });
    expect(logoutCalls).toBe(1);
  });
});

test('closes politely when the request was already approved', async ({ page }) => {
  await mockPreview(page, [{ ...pendingPreviewRow, request_status: 'approved' }]);

  await page.goto(`/consent/${CONSENT_TOKEN}`);

  await expect(page.getByRole('heading', { name: 'This invite is wrapped up.' })).toBeVisible();
  await expect(page.getByText('You already approved this pitch — it’s live.')).toBeVisible();
});

// --- Third audit §8/§11: staged review, sticky progress, keyboard + SR, and
// horizontal-overflow regression. The review keeps every input mounted, so
// these assert the presentation/navigation layer, not the RPC flow. ---

test('breaks the review into a sticky, keyboard-operable progress rail (§8 acceptance 1)', async ({
  page,
}) => {
  await mockClaimedReview(page);
  await page.goto(`/consent/${CONSENT_TOKEN}`);

  const nav = page.getByRole('navigation', { name: 'Review progress' });
  await expect(nav).toBeVisible();
  // The fixture carries a hard claim, so all six steps are present.
  await expect(nav.getByRole('link')).toHaveCount(6);
  const listenLink = nav.getByRole('link', { name: 'Listen' });
  await expect(listenLink).toHaveAttribute('aria-current', 'step');

  await test.step('A keyboard user can jump to a step and land on its heading', async () => {
    const aboutLink = nav.getByRole('link', { name: 'About you' });
    await aboutLink.focus();
    await expect(aboutLink).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#consent-step-about-heading')).toBeFocused();
  });
});

test('exposes each review step as a labelled region for assistive tech (§8 acceptance 3)', async ({
  page,
}) => {
  await mockClaimedReview(page);
  await page.goto(`/consent/${CONSENT_TOKEN}`);

  await expect(page.getByRole('heading', { name: 'Listen to the voice note' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Make it yours' })).toBeVisible();
  // Fieldsets surface as groups named by their legends.
  await expect(page.getByRole('group', { name: 'About you' })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Who can reach out & for how long' })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'This is your page — exactly what people will see' }),
  ).toBeVisible();

  await test.step('Every step advertises its position in the sequence', async () => {
    await expect(page.getByText('Step 1 of 6')).toBeVisible();
    await expect(page.getByText('Step 6 of 6')).toBeVisible();
  });
});

test('keeps the review free of horizontal overflow from 320 to 1440 (§11 browser)', async ({
  page,
}) => {
  await mockClaimedReview(page);
  await page.goto(`/consent/${CONSENT_TOKEN}`);
  await expect(page.getByRole('heading', { name: 'Hear what Maya says about you.' })).toBeVisible();

  for (const width of [320, 375, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const hasHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(hasHorizontalOverflow, `width ${width}`).toBe(false);
  }
});

test('honors reduced motion while the progress rail still navigates (§11 reduced motion)', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mockClaimedReview(page);
  await page.goto(`/consent/${CONSENT_TOKEN}`);

  const nav = page.getByRole('navigation', { name: 'Review progress' });
  const confirmLink = nav.getByRole('link', { name: 'Confirm' });
  await confirmLink.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#consent-step-claims-heading')).toBeFocused();
});

test('lets a keyboard user confirm claims and reach an enabled approval (§8 acceptance 3)', async ({
  page,
}) => {
  await mockClaimedReview(page);
  await page.route('**/rest/v1/rpc/approve_and_publish_pitch*', (route) =>
    route.fulfill({
      json: [
        { campaign_id: '20000000-0000-0000-0000-000000000001', campaign_slug: 'blair-mix123' },
      ],
    }),
  );

  await page.goto(`/consent/${CONSENT_TOKEN}`);

  const approve = page.getByRole('button', { name: 'Approve & publish my page' });
  await expect(approve).toBeDisabled();

  await fillDaterProfile(page);
  const confirmClaims = page.getByLabel('I confirm the claims above are true.');
  await confirmClaims.focus();
  await expect(confirmClaims).toBeFocused();
  await page.keyboard.press('Space');
  await expect(confirmClaims).toBeChecked();

  await expect(approve).toBeEnabled();
  // The approve control is itself keyboard-focusable.
  await approve.focus();
  await expect(approve).toBeFocused();
});

/**
 * Mail scanners consume magic links, so the signed-out consent surface has to
 * recover on its own: the returned #error fragment must be stated, and the
 * emailed 8-digit code must be a real way in.
 */
async function mockSignedOutClaimPath(page: Page): Promise<void> {
  await mockPreview(page, [pendingPreviewRow]);
  await mockUserBootstrap(page, { displayName: 'Blair', confirmed: true });
  await page.route('**/rest/v1/rpc/claim_consent_request*', (route) =>
    route.fulfill({ json: [{ pitch_draft_id: DRAFT_ID }] }),
  );
  await page.route('**/rest/v1/rpc/get_ai_disclosure_revision*', (route) =>
    route.fulfill({ json: 'ai-2026-07' }),
  );
  await mockConsentReview(page);
}

test('states an expired sign-in link and resends a fresh one', async ({ page }) => {
  await mockPreview(page, [pendingPreviewRow]);
  let otpUrl = '';
  await page.route('**/auth/v1/otp*', (route) => {
    otpUrl = route.request().url();
    return route.fulfill({ json: {} });
  });

  await page.goto(
    `/consent/${CONSENT_TOKEN}#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired`,
  );

  await test.step('Then the failure is surfaced instead of silently ignored', async () => {
    await expect(page.getByText('That sign-in link has expired or was already used')).toBeVisible();
    // The fragment is cleaned so a refresh does not re-show a stale failure.
    await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('');
    await page.screenshot({ path: '/tmp/friendword-consent-expired-link.png', fullPage: true });
  });

  await test.step('When the dater asks for a fresh link it returns to this consent page', async () => {
    await page.getByLabel('Your email').fill('dater@example.com');
    await page.getByRole('button', { name: 'Send me a fresh link' }).click();
    await expect(page.getByText('your sign-in link is on the way')).toBeVisible();
    expect(decodeURIComponent(otpUrl)).toContain(`/consent/${CONSENT_TOKEN}`);
  });
});

test('signs the dater in with the emailed code when the link is unusable', async ({ page }) => {
  await mockSignedOutClaimPath(page);
  await page.route('**/auth/v1/otp*', (route) => route.fulfill({ json: {} }));
  let verifyBody: unknown;
  await page.route('**/auth/v1/verify*', (route) => {
    verifyBody = route.request().postDataJSON();
    return route.fulfill({
      json: {
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
      },
    });
  });

  await page.goto(`/consent/${CONSENT_TOKEN}`);
  await page.getByLabel('Your email').fill('dater@example.com');
  await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
  await expect(page.getByText('your sign-in link is on the way')).toBeVisible();

  await page.getByRole('button', { name: 'Enter the 8-digit code instead' }).click();
  await page.getByLabel('8-digit code').fill('12345678');
  await page.screenshot({ path: '/tmp/friendword-consent-code-entry.png', fullPage: true });
  await page.getByRole('button', { name: 'Sign me in' }).click();

  await expect(page.getByRole('heading', { name: 'Hear what Maya says about you.' })).toBeVisible();
  expect(verifyBody).toMatchObject({
    email: 'dater@example.com',
    token: '12345678',
    type: 'email',
  });
});
