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

  await test.step('A minimum age below 18 blocks approval on the client', async () => {
    await page.getByLabel('I confirm all of these claims are true.').check();
    await page.getByLabel('Minimum age').fill('17');
    await expect(page.getByText('Minimum age must be 18 or older.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Approve & publish my page' })).toBeDisabled();
    await page.getByLabel('Minimum age').fill('18');
  });

  await test.step('When the dater confirms claims and approves with the defaults', async () => {
    await page.getByLabel('I confirm all of these claims are true.').check();
    await page.getByRole('button', { name: 'Approve & publish my page' }).click();
    await page.waitForURL('**/p/blair-mix123');
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

  await page.getByLabel('7 days').check();
  await page.getByLabel('Location visibility').selectOption('hidden');
  await page.getByLabel('Minimum age').fill('21');
  await page.getByLabel('Maximum age (optional)').fill('35');
  await page.getByLabel('Long-term').check();
  await expect(page.getByText('Location hidden')).toBeVisible();
  await expect(page.getByText('7 days', { exact: true }).last()).toBeVisible();
  await expect(page.getByText('Blair', { exact: true })).toBeVisible();
  await page.getByLabel('I confirm all of these claims are true.').check();
  await page.getByRole('button', { name: 'Approve & publish my page' }).click();
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
  });
  await page.getByRole('button', { name: 'Save my edits' }).click();
  await expect(page.getByText('Your edits are saved in a new review version.')).toBeVisible();
  expect(revisionBody).toEqual({
    draft_id: DRAFT_ID,
    new_headline: revisionRow.headline,
    new_body: revisionRow.body,
    included_asset_ids: [FIRST_PHOTO_ID, SECOND_PHOTO_ID, VOICE_ASSET_ID, DATER_PHOTO_ID],
  });
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
  await page.getByLabel('I confirm all of these claims are true.').check();
  await page.getByRole('button', { name: 'Approve & publish my page' }).click();

  await expect(page.getByRole('heading', { name: 'The introduction was updated.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reload the latest version' })).toBeVisible();
});

test('confirms a fallback display name before the review step', async ({ page }) => {
  await mockClaimedReview(page, { displayName: 'dater', confirmed: false });

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
