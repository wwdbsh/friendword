// Full-funnel production E2E against hosted Supabase + the local web server.
// Walks Flow A (submit with media), Flow B (revision consent, photo selection,
// fixed visibility window, publish), commerce, the public page, Flow C (interest,
// inbox, accept), intro rooms (chat/report/block/leave), campaign lifecycle,
// and analytics ingestion — then cleans up everything it created.
// Run: node scripts/e2e-production.mjs (repo root; needs .env + dev server).
import { Buffer } from 'node:buffer';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(repoRoot, 'packages/data/package.json'));
const { createClient } = require('@supabase/supabase-js');

const envFile = readFileSync(path.join(repoRoot, '.env'), 'utf8');
const env = Object.fromEntries(
  envFile
    .split('\n')
    .filter((line) => line.includes('=') && !line.trim().startsWith('#'))
    .map((line) => [
      line.slice(0, line.indexOf('=')).trim(),
      line.slice(line.indexOf('=') + 1).trim(),
    ]),
);

const url = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !serviceKey || !anonKey) {
  console.error('missing env');
  process.exit(1);
}

const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
const anonAuthOpts = { auth: { persistSession: false, detectSessionInUrl: false } };

const stamp = Date.now();
const introducerEmail = `e2e-introducer-${stamp}@friendword.test`;
const daterEmail = `e2e-dater-${stamp}@friendword.test`;
const strangerEmail = `e2e-stranger-${stamp}@friendword.test`;
const password = `E2e-${randomBytes(24).toString('base64url')}!`;
const analyticsSource = `e2e-${stamp}`;

const created = {
  users: [],
  draftId: null,
  campaignId: null,
  voicePath: null,
  purchaseEventIds: [],
  purchaseOriginalTransactionId: null,
};
let failures = 0;

const initialHeadline = 'E2E Blair makes ordinary plans memorable.';
const revisedHeadline = 'E2E Blair makes every gathering feel welcoming.';
const pitchStructure = {
  hook: initialHeadline,
  relationship_context: 'Maya and Blair have been friends for years.',
  three_specific_qualities: ['thoughtful', 'curious', 'reliable'],
  evidence_or_anecdote: 'Blair once organized a last-minute dinner for a friend in need.',
  good_match_for: 'Someone kind who enjoys building a steady relationship.',
  hard_claims_requiring_confirmation: ['Blair owns a home.'],
};

function check(label, ok, extra = '') {
  const mark = ok ? 'PASS' : 'FAIL';
  if (!ok) failures += 1;
  console.log(`${mark} ${label}${extra ? ` — ${extra}` : ''}`);
}

async function cleanup(label, operation) {
  try {
    const { error } = await operation;
    if (error) {
      failures += 1;
      console.error(`CLEANUP FAIL ${label}`);
    }
  } catch {
    failures += 1;
    console.error(`CLEANUP FAIL ${label}`);
  }
}

async function makeUser(email, displayName) {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: displayName },
  });
  if (error) throw new Error(`createUser ${email}: ${error.message}`);
  created.users.push(data.user.id);
  const { data: publicUser, error: publicUserError } = await admin
    .from('users')
    .select('id')
    .eq('id', data.user.id)
    .single();
  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('display_name, display_name_confirmed')
    .eq('user_id', data.user.id)
    .single();
  check(
    `fresh user public row auto-provisioned (${displayName})`,
    !publicUserError &&
      !profileError &&
      publicUser.id === data.user.id &&
      profile.display_name === displayName &&
      profile.display_name_confirmed === true,
    publicUserError?.message ?? profileError?.message,
  );
  const client = createClient(url, anonKey, anonAuthOpts);
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`signIn ${email}: ${signInError.message}`);
  return { id: data.user.id, client };
}

try {
  // 1. Users
  const introducer = await makeUser(introducerEmail, 'E2E Maya');
  const dater = await makeUser(daterEmail, 'E2E Blair');
  const stranger = await makeUser(strangerEmail, 'E2E Stranger');
  check('1. created introducer/dater/stranger with profiles', true);

  // 2. Introducer: draft + voice upload + submit (Flow A, mobile path)
  const { data: draft, error: draftError } = await introducer.client
    .from('pitch_drafts')
    .insert({
      created_by_user_id: introducer.id,
      relationship_type: 'friend',
      relationship_duration: 'y3to10',
    })
    .select()
    .single();
  if (draftError) throw new Error(`draft insert: ${draftError.message}`);
  created.draftId = draft.id;

  async function uploadObject(objectPath, contentType, bytes) {
    const { data: ticket, error: ticketError } = await introducer.client.storage
      .from('pitch-media')
      .createSignedUploadUrl(objectPath, { upsert: false });
    if (ticketError) throw new Error(`upload ticket ${objectPath}: ${ticketError.message}`);
    const putResponse = await fetch(ticket.signedUrl, {
      method: 'PUT',
      headers: { 'Content-Type': contentType, 'x-upsert': 'false' },
      body: Buffer.from(bytes),
    });
    if (!putResponse.ok) throw new Error(`PUT ${objectPath} ${putResponse.status}`);
  }

  async function registerAsset(assetType, fileName, sortOrder) {
    const { data, error } = await introducer.client
      .from('pitch_assets')
      .insert({
        pitch_draft_id: draft.id,
        uploaded_by_user_id: introducer.id,
        asset_type: assetType,
        storage_path: `pitch-media/${draft.id}/${fileName}`,
        sort_order: sortOrder,
      })
      .select('id, asset_type, storage_path')
      .single();
    if (error) throw new Error(`registerAsset ${fileName}: ${error.message}`);
    return data;
  }

  const voiceObject = `${draft.id}/voice.m4a`;
  created.voicePath = voiceObject;
  created.photoPaths = [`${draft.id}/photo-1.jpg`, `${draft.id}/photo-2.jpg`];
  await uploadObject(voiceObject, 'audio/mp4', 'e2e-fake-voice-bytes');
  const voiceAsset = await registerAsset('voice', 'voice.m4a', 0);
  await uploadObject(created.photoPaths[0], 'image/jpeg', 'e2e-fake-photo-1');
  const photo1Asset = await registerAsset('photo', 'photo-1.jpg', 0);
  await uploadObject(created.photoPaths[1], 'image/jpeg', 'e2e-fake-photo-2');
  const photo2Asset = await registerAsset('photo', 'photo-2.jpg', 1);

  const { error: contentError } = await introducer.client
    .from('pitch_drafts')
    .update({
      headline: initialHeadline,
      body: 'Blair brings warmth, follow-through, and genuine curiosity to every friendship.',
      structure: pitchStructure,
    })
    .eq('id', draft.id);
  if (contentError) throw new Error(`draft content update: ${contentError.message}`);

  const { data: submission, error: submitError } = await introducer.client.rpc(
    'submit_pitch_for_consent',
    {
      draft_id: draft.id,
      invite_channel: 'email',
      invite_contact: daterEmail.toUpperCase(),
      invite_friend_name: 'E2E Blair',
    },
  );
  if (submitError) throw new Error(`submit: ${submitError.message}`);
  const rawToken = submission[0].consent_token;
  check(
    '2. introducer finalized complete draft + media with an email-bound invite',
    typeof rawToken === 'string' && rawToken.length >= 24,
  );

  // 3. Anonymous preview (web landing state)
  const anonClient = createClient(url, anonKey, anonAuthOpts);
  const { data: previewRows, error: previewError } = await anonClient.rpc('get_consent_preview', {
    raw_token: rawToken,
  });
  check(
    '3. anon preview shows introducer name + relationship only',
    !previewError &&
      previewRows.length === 1 &&
      previewRows[0].introducer_display_name === 'E2E Maya' &&
      previewRows[0].relationship_type === 'friend' &&
      previewRows[0].request_status === 'pending',
    previewError?.message,
  );

  // 4. Negative claims
  const { error: selfClaimError } = await introducer.client.rpc('claim_consent_request', {
    raw_token: rawToken,
  });
  check('4a. introducer cannot claim own pitch', Boolean(selfClaimError), selfClaimError?.message);

  const { error: strangerClaimError } = await stranger.client.rpc('claim_consent_request', {
    raw_token: rawToken,
  });
  check(
    '4b. email-bound invite rejects a different contact before claim',
    Boolean(strangerClaimError) && strangerClaimError.message.includes('different contact'),
    strangerClaimError?.message,
  );

  // 5. Dater claims (web claim state)
  const { data: claimRows, error: claimError } = await dater.client.rpc('claim_consent_request', {
    raw_token: rawToken,
  });
  check(
    '5. dater claimed the consent request',
    !claimError && claimRows[0].pitch_draft_id === draft.id,
    claimError?.message,
  );

  // 5b. The claimed participant reads the exact immutable revision.
  const { data: initialRequest, error: initialRequestError } = await dater.client
    .from('consent_requests')
    .select('revision_id, status')
    .eq('pitch_draft_id', draft.id)
    .single();
  if (initialRequestError || !initialRequest?.revision_id) {
    throw new Error(
      `initial consent request: ${initialRequestError?.message ?? 'missing revision'}`,
    );
  }
  const { data: initialRevision, error: initialRevisionError } = await dater.client
    .from('consent_revisions')
    .select('id, revision_number, headline, asset_ids')
    .eq('id', initialRequest.revision_id)
    .single();
  if (initialRevisionError || !initialRevision) {
    throw new Error(`initial revision: ${initialRevisionError?.message ?? 'missing row'}`);
  }
  const expectedAssetIds = [voiceAsset.id, photo1Asset.id, photo2Asset.id].sort().join(',');
  const snapshottedAssetIds = [...initialRevision.asset_ids].sort().join(',');
  check(
    '5b. claimed dater reads matching revision headline and asset snapshot',
    !initialRequestError &&
      !initialRevisionError &&
      initialRequest.status === 'claimed' &&
      initialRevision.id === initialRequest.revision_id &&
      initialRevision.headline === initialHeadline &&
      expectedAssetIds === snapshottedAssetIds,
    initialRequestError?.message ?? initialRevisionError?.message,
  );

  // 6. Dater review reads (draft row + voice signed URL)
  const { data: reviewDraft, error: reviewError } = await dater.client
    .from('pitch_drafts')
    .select()
    .eq('id', draft.id)
    .single();
  check(
    '6a. dater reads draft under RLS for review',
    !reviewError &&
      reviewDraft.status === 'consent_pending' &&
      reviewDraft.subject_user_id === dater.id,
    reviewError?.message,
  );

  const { data: signed, error: signError } = await dater.client.storage
    .from('pitch-media')
    .createSignedUrl(voiceObject, 3600);
  let audioOk = false;
  if (!signError) {
    const audioResponse = await fetch(signed.signedUrl);
    const bytes = await audioResponse.text();
    audioOk = audioResponse.ok && bytes === 'e2e-fake-voice-bytes';
  }
  check('6b. dater plays the voice via signed URL', audioOk, signError?.message);

  const { error: strangerSignError } = await stranger.client.storage
    .from('pitch-media')
    .createSignedUrl(voiceObject, 3600);
  check(
    '6c. stranger cannot sign the voice object',
    Boolean(strangerSignError),
    strangerSignError?.message,
  );

  const { data: reviewAssets, error: assetsError } = await dater.client
    .from('pitch_assets')
    .select()
    .eq('pitch_draft_id', draft.id)
    .order('sort_order', { ascending: true });
  const photoAssets = (reviewAssets ?? []).filter((asset) => asset.asset_type === 'photo');
  let photoViewOk = false;
  if (photoAssets.length === 2) {
    const { data: photoSigned } = await dater.client.storage
      .from('pitch-media')
      .createSignedUrl(photoAssets[0].storage_path.replace('pitch-media/', ''), 3600);
    if (photoSigned) {
      const photoResponse = await fetch(photoSigned.signedUrl);
      photoViewOk = photoResponse.ok && (await photoResponse.text()) === 'e2e-fake-photo-1';
    }
  }
  check(
    '6d. dater lists registered assets and views photos under RLS',
    !assetsError && (reviewAssets ?? []).length === 3 && photoViewOk,
    assetsError?.message ?? `assets=${reviewAssets?.length}`,
  );

  // 6e. Request changes, revise the draft, and finalize a new immutable revision.
  const { error: requestChangesError } = await dater.client.rpc('respond_consent_request', {
    draft_id: draft.id,
    action: 'request_changes',
    note: '사진 바꿔줘',
  });
  const { data: changesRequestedDraft, error: changesRequestedError } = await introducer.client
    .from('pitch_drafts')
    .select('status')
    .eq('id', draft.id)
    .single();
  check(
    '6e. dater requests changes and the draft becomes editable again',
    !requestChangesError &&
      !changesRequestedError &&
      changesRequestedDraft.status === 'changes_requested',
    requestChangesError?.message ?? changesRequestedError?.message,
  );

  const { error: revisionUpdateError } = await introducer.client
    .from('pitch_drafts')
    .update({
      headline: revisedHeadline,
      structure: { ...pitchStructure, hook: revisedHeadline },
    })
    .eq('id', draft.id);
  if (revisionUpdateError) throw new Error(`revision update: ${revisionUpdateError.message}`);

  const { data: resubmission, error: resubmitError } = await introducer.client.rpc(
    'submit_pitch_for_consent',
    {
      draft_id: draft.id,
      invite_channel: 'email',
      invite_contact: daterEmail,
      invite_friend_name: 'E2E Blair',
    },
  );
  if (resubmitError) throw new Error(`resubmit: ${resubmitError.message}`);
  const { data: latestRequest, error: latestRequestError } = await dater.client
    .from('consent_requests')
    .select('revision_id, status')
    .eq('pitch_draft_id', draft.id)
    .single();
  if (latestRequestError || !latestRequest?.revision_id) {
    throw new Error(`latest consent request: ${latestRequestError?.message ?? 'missing revision'}`);
  }
  const { data: latestRevision, error: latestRevisionError } = await dater.client
    .from('consent_revisions')
    .select('id, revision_number, headline, asset_ids')
    .eq('id', latestRequest.revision_id)
    .single();
  if (latestRevisionError || !latestRevision) {
    throw new Error(`latest revision: ${latestRevisionError?.message ?? 'missing row'}`);
  }
  const replacementToken = resubmission?.[0]?.consent_token;
  check(
    '6f. introducer finalizes revision 2 and the claimed dater keeps access',
    !latestRequestError &&
      !latestRevisionError &&
      replacementToken === null &&
      latestRequest.status === 'claimed' &&
      latestRevision.id !== initialRevision.id &&
      latestRevision.revision_number === initialRevision.revision_number + 1 &&
      latestRevision.headline === revisedHeadline &&
      [...latestRevision.asset_ids].sort().join(',') === expectedAssetIds,
    latestRequestError?.message ?? latestRevisionError?.message,
  );

  // 6g. Finalized drafts are locked against transcription while ownership stays private.
  const introducerToken = (await introducer.client.auth.getSession()).data.session?.access_token;
  const transcribeOwn = await fetch('http://localhost:3000/api/transcribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${introducerToken}` },
    body: JSON.stringify({ draftId: draft.id }),
  });
  const strangerToken = (await stranger.client.auth.getSession()).data.session?.access_token;
  const transcribeStranger = await fetch('http://localhost:3000/api/transcribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${strangerToken}` },
    body: JSON.stringify({ draftId: draft.id }),
  });
  check(
    '6g. transcribe API: consent_pending owner gets 409 and stranger gets 404',
    transcribeOwn.status === 409 && transcribeStranger.status === 404,
    `own=${transcribeOwn.status} stranger=${transcribeStranger.status}`,
  );

  // 7. Creator purchase intent and RevenueCat lifecycle are idempotent.
  const { data: intentRows, error: intentError } = await introducer.client.rpc(
    'issue_purchase_intent',
    {
      product_id: 'creator_launch_credit_499',
      scope_id: draft.id,
    },
  );
  const purchaseIntentId = intentRows?.[0]?.purchase_intent_id;
  check(
    '7a. introducer issues a creator credit purchase intent for the draft',
    !intentError && typeof purchaseIntentId === 'string',
    intentError?.message,
  );
  if (intentError || typeof purchaseIntentId !== 'string') {
    throw new Error(`purchase intent: ${intentError?.message ?? 'missing id'}`);
  }

  const purchaseEventId = `e2e-creator-purchase-${stamp}`;
  const cancellationEventId = `e2e-creator-cancellation-${stamp}`;
  const transactionId = `e2e-creator-tx-${stamp}`;
  const originalTransactionId = `e2e-creator-original-${stamp}`;
  created.purchaseEventIds.push(purchaseEventId, cancellationEventId);
  created.purchaseOriginalTransactionId = originalTransactionId;
  const purchasePayload = {
    id: purchaseEventId,
    type: 'INITIAL_PURCHASE',
    app_user_id: introducer.id,
    product_id: 'creator_launch_credit_499',
    purchased_at_ms: Date.now(),
    expiration_at_ms: null,
    transaction_id: transactionId,
    original_transaction_id: originalTransactionId,
    environment: 'SANDBOX',
    aliases: [],
    original_app_user_id: introducer.id,
    subscriber_attributes: {
      purchase_intent_id: { value: purchaseIntentId },
    },
  };
  const { data: purchaseResult, error: purchaseError } = await admin.rpc(
    'record_revenuecat_event',
    { payload: purchasePayload },
  );
  const { data: firstPurchaseEvents, error: firstPurchaseEventsError } = await admin
    .from('purchase_events')
    .select('id, provider_event_id')
    .eq('provider_event_id', purchaseEventId);
  const { data: availableCredits, error: availableCreditsError } = await admin
    .from('purchase_credit_ledger')
    .select('id, credit_state')
    .eq('idempotency_key', originalTransactionId);
  check(
    '7b. service role records one purchase event and one available creator credit',
    !purchaseError &&
      !firstPurchaseEventsError &&
      !availableCreditsError &&
      purchaseResult?.recorded === true &&
      purchaseResult?.deduplicated === false &&
      firstPurchaseEvents.length === 1 &&
      availableCredits.length === 1 &&
      availableCredits[0].credit_state === 'available',
    purchaseError?.message ?? firstPurchaseEventsError?.message ?? availableCreditsError?.message,
  );

  const { data: duplicateResult, error: duplicateError } = await admin.rpc(
    'record_revenuecat_event',
    { payload: purchasePayload },
  );
  const { data: deduplicatedEvents, error: deduplicatedEventsError } = await admin
    .from('purchase_events')
    .select('id')
    .eq('provider_event_id', purchaseEventId);
  const { data: deduplicatedCredits, error: deduplicatedCreditsError } = await admin
    .from('purchase_credit_ledger')
    .select('id')
    .eq('idempotency_key', originalTransactionId);
  check(
    '7c. replaying the same RevenueCat event deduplicates to one row',
    !duplicateError &&
      !deduplicatedEventsError &&
      !deduplicatedCreditsError &&
      duplicateResult?.deduplicated === true &&
      deduplicatedEvents.length === 1 &&
      deduplicatedCredits.length === 1,
    duplicateError?.message ??
      deduplicatedEventsError?.message ??
      deduplicatedCreditsError?.message,
  );

  const cancellationPayload = {
    ...purchasePayload,
    id: cancellationEventId,
    type: 'CANCELLATION',
    transaction_id: `e2e-creator-cancellation-tx-${stamp}`,
  };
  const { error: cancellationError } = await admin.rpc('record_revenuecat_event', {
    payload: cancellationPayload,
  });
  const { data: revokedCredits, error: revokedCreditsError } = await admin
    .from('purchase_credit_ledger')
    .select('id, credit_state')
    .eq('idempotency_key', originalTransactionId);
  check(
    '7d. RevenueCat cancellation revokes the creator credit',
    !cancellationError &&
      !revokedCreditsError &&
      revokedCredits.length === 1 &&
      revokedCredits[0].credit_state === 'revoked',
    cancellationError?.message ?? revokedCreditsError?.message,
  );

  // 8. Approval rejects unconfirmed claims, then publishes one selected photo for 14 days.
  const approvalArgs = {
    draft_id: draft.id,
    campaign_days: 14,
    revision_id: latestRevision.id,
    included_asset_ids: [photo1Asset.id],
    hard_claims_confirmed: false,
  };
  const { error: unconfirmedClaimsError } = await dater.client.rpc(
    'approve_and_publish_pitch',
    approvalArgs,
  );
  check(
    '8a. approve rejects an unconfirmed hard claim',
    Boolean(unconfirmedClaimsError) && unconfirmedClaimsError.message.includes('hard claims'),
    unconfirmedClaimsError?.message,
  );

  const { data: publishRows, error: publishError } = await dater.client.rpc(
    'approve_and_publish_pitch',
    {
      ...approvalArgs,
      hard_claims_confirmed: true,
    },
  );
  const slug = publishRows?.[0]?.campaign_slug;
  created.campaignId = publishRows?.[0]?.campaign_id ?? null;
  check(
    '8b. approve_and_publish atomically publishes the latest revision and selected photo',
    !publishError && typeof slug === 'string' && slug.length > 0,
    publishError?.message ?? `slug=${slug}`,
  );

  // 9. Post-publish visibility: dater is a member and sees the campaign.
  const { data: campaignRows, error: campaignError } = await dater.client
    .from('campaigns')
    .select('id, status, slug')
    .eq('id', created.campaignId);
  check(
    '9a. dater sees the published campaign via membership RLS',
    !campaignError &&
      campaignRows.length === 1 &&
      campaignRows[0].status === 'published' &&
      campaignRows[0].slug === slug,
    campaignError?.message,
  );

  // 9b. Idempotence guard: approving again fails cleanly.
  const { error: reApproveError } = await dater.client.rpc('approve_and_publish_pitch', {
    ...approvalArgs,
    hard_claims_confirmed: true,
  });
  check(
    '9b. second approve is rejected because the draft is no longer consent_pending',
    Boolean(reApproveError),
    reApproveError?.message,
  );

  // 10. The public pitch page renders the real campaign (Slice 5B-2)
  try {
    const pageResponse = await fetch(`http://localhost:3000/p/${slug}`);
    const html = await pageResponse.text();
    check(
      '10. /p/[slug] renders real data, honoring the photo exclusion',
      pageResponse.ok &&
        html.includes('E2E Blair') &&
        html.includes('E2E Maya') &&
        html.includes('/storage/v1/object/sign/pitch-media/') &&
        html.includes('photo-1.jpg') &&
        !html.includes('photo-2.jpg'),
      `status=${pageResponse.status}`,
    );
    const { data: windowRow } = await admin
      .from('campaigns')
      .select('ends_at')
      .eq('id', created.campaignId)
      .single();
    const endsAt = windowRow?.ends_at ? new Date(windowRow.ends_at).getTime() : 0;
    const inFourteenDays = Date.now() + 14 * 24 * 3600 * 1000;
    check(
      '10c. approve stamped the fixed 14-day visibility window',
      Math.abs(endsAt - inFourteenDays) < 3600 * 1000,
      windowRow?.ends_at,
    );
    const missResponse = await fetch('http://localhost:3000/p/not-a-real-slug');
    check(
      '10b. unknown slug still 404s',
      missResponse.status === 404,
      `status=${missResponse.status}`,
    );
  } catch (error) {
    check('10. /p/[slug] renders real data (names + signed audio)', false, error.message);
  }

  // ── Flow C: verified interest ──────────────────────────────────────────
  const campaignId = created.campaignId;

  // 11. Profile gate: stranger without a dating profile cannot submit.
  const { error: gateError } = await stranger.client.rpc('submit_interest', {
    target_campaign_id: campaignId,
  });
  check('11. interest is profile-gated', Boolean(gateError), gateError?.message);

  // 12. Stranger completes profile: birth date + bio/intent + 2 photos.
  await stranger.client
    .from('profiles')
    .update({ birth_date: '1994-05-05' })
    .eq('user_id', stranger.id);
  created.profilePhotos = [`${stranger.id}/photo-a.jpg`, `${stranger.id}/photo-b.jpg`];
  for (const path of created.profilePhotos) {
    const { error: uploadError } = await stranger.client.storage
      .from('profile-media')
      .upload(path, Buffer.from(`bytes-${path}`), { contentType: 'image/jpeg', upsert: true });
    if (uploadError) throw new Error(`profile photo upload: ${uploadError.message}`);
  }
  await stranger.client.from('dating_profiles').upsert(
    {
      user_id: stranger.id,
      bio: 'Museum fan, serious about pasta.',
      dating_intent: 'long-term',
      approximate_location: 'Seoul',
      photos: created.profilePhotos.map((p) => `profile-media/${p}`),
    },
    { onConflict: 'user_id' },
  );
  const { data: interestRows, error: interestError } = await stranger.client.rpc(
    'submit_interest',
    {
      target_campaign_id: campaignId,
      interest_note: 'We keep almost meeting!',
    },
  );
  check(
    '12. stranger submitted verified interest',
    !interestError && interestRows[0].interest_status === 'submitted',
    interestError?.message,
  );
  const interestId = interestRows?.[0]?.interest_id;

  // 12b. The dater cannot send interest to their own campaign.
  const { error: selfInterestError } = await dater.client.rpc('submit_interest', {
    target_campaign_id: campaignId,
  });
  check(
    '12b. owner self-interest rejected',
    Boolean(selfInterestError),
    selfInterestError?.message,
  );

  // 13. Dater inbox shows the sanitized sender and can view their photos.
  const { data: inbox, error: inboxError } = await dater.client.rpc('list_campaign_interests', {
    target_campaign_id: campaignId,
  });
  const inboxRow = (inbox ?? []).find((row) => row.interest_id === interestId);
  let senderPhotoOk = false;
  if (inboxRow) {
    const photoPath = (inboxRow.sender_photos ?? [])[0]?.replace('profile-media/', '');
    if (photoPath) {
      const { data: signedPhoto } = await dater.client.storage
        .from('profile-media')
        .createSignedUrl(photoPath, 3600);
      if (signedPhoto) {
        const photoResponse = await fetch(signedPhoto.signedUrl);
        senderPhotoOk = photoResponse.ok;
      }
    }
  }
  check(
    '13. dater inbox shows sanitized sender + photo access',
    !inboxError &&
      inboxRow !== undefined &&
      inboxRow.sender_display_name === 'E2E Stranger' &&
      inboxRow.sender_age >= 18 &&
      senderPhotoOk &&
      !('email' in (inboxRow ?? {})),
    inboxError?.message,
  );

  // 13b. The introducer cannot read the inbox.
  const { error: introducerInboxError } = await introducer.client.rpc('list_campaign_interests', {
    target_campaign_id: campaignId,
  });
  check(
    '13b. non-owner cannot read the inbox',
    Boolean(introducerInboxError),
    introducerInboxError?.message,
  );

  // 14. Accept opens the intro room; both parties can see it, others cannot.
  const { data: decisionRows, error: decideError } = await dater.client.rpc('decide_interest', {
    target_interest_id: interestId,
    decision: 'accepted',
  });
  const roomId = decisionRows?.[0]?.intro_room_id;
  check('14. accept opened an intro room', !decideError && Boolean(roomId), decideError?.message);

  const { data: strangerRoom } = await stranger.client
    .from('intro_rooms')
    .select()
    .eq('id', roomId);
  const { data: introducerRoom } = await introducer.client
    .from('intro_rooms')
    .select()
    .eq('id', roomId);
  check(
    '14b. room visible to parties only (RLS)',
    (strangerRoom ?? []).length === 1 && (introducerRoom ?? []).length === 0,
  );

  // 14c. Deciding twice fails.
  const { error: reDecideError } = await dater.client.rpc('decide_interest', {
    target_interest_id: interestId,
    decision: 'declined',
  });
  check('14c. second decision rejected', Boolean(reDecideError), reDecideError?.message);

  // ── Intro Room chat, report, block, leave ──────────────────────────────
  // 15. Both parties list the room via RPC and exchange messages.
  const { data: daterRooms } = await dater.client.rpc('list_my_intro_rooms', {});
  const { data: strangerRooms } = await stranger.client.rpc('list_my_intro_rooms', {});
  check(
    '15. both parties list the room with display names',
    (daterRooms ?? []).some(
      (r) => r.room_id === roomId && r.other_display_name === 'E2E Stranger',
    ) &&
      (strangerRooms ?? []).some(
        (r) => r.room_id === roomId && r.other_display_name === 'E2E Blair',
      ),
  );

  const { error: msg1Error } = await dater.client.from('messages').insert({
    intro_room_id: roomId,
    sender_user_id: dater.id,
    body: 'Hi! Thanks for the note.',
  });
  const { error: msg2Error } = await stranger.client.from('messages').insert({
    intro_room_id: roomId,
    sender_user_id: stranger.id,
    body: 'Hi! Excited to be introduced.',
  });
  const { data: chat } = await stranger.client
    .from('messages')
    .select()
    .eq('intro_room_id', roomId)
    .order('created_at', { ascending: true });
  check(
    '15b. participants exchange messages under RLS',
    !msg1Error && !msg2Error && (chat ?? []).length === 2,
    msg1Error?.message ?? msg2Error?.message,
  );

  const { data: introducerChat } = await introducer.client
    .from('messages')
    .select()
    .eq('intro_room_id', roomId);
  check('15c. outsider reads no messages', (introducerChat ?? []).length === 0);

  // 16. Report lands in the queue.
  const { error: reportError } = await stranger.client.from('reports').insert({
    reporter_user_id: stranger.id,
    reported_user_id: dater.id,
    campaign_id: campaignId,
    reason: 'e2e test report — please ignore',
  });
  check('16. report accepted into the queue', !reportError, reportError?.message);

  // 17. Block kills the room both ways, immediately.
  const { error: blockError } = await dater.client.from('blocks').insert({
    blocker_user_id: dater.id,
    blocked_user_id: stranger.id,
  });
  const { error: blockedMsgError } = await stranger.client.from('messages').insert({
    intro_room_id: roomId,
    sender_user_id: stranger.id,
    body: 'this must not send',
  });
  const { data: strangerRoomsAfterBlock } = await stranger.client.rpc('list_my_intro_rooms', {});
  check(
    '17. block stops messages and hides the room',
    !blockError && Boolean(blockedMsgError) && (strangerRoomsAfterBlock ?? []).length === 0,
    blockError?.message,
  );

  // 18. With the block lifted, leaving closes the room for good.
  await admin
    .from('blocks')
    .delete()
    .eq('blocker_user_id', dater.id)
    .eq('blocked_user_id', stranger.id);
  const { error: leaveError } = await stranger.client.rpc('leave_intro_room', {
    target_room_id: roomId,
  });
  const { error: reLeaveError } = await stranger.client.rpc('leave_intro_room', {
    target_room_id: roomId,
  });
  const { error: leftMsgError } = await dater.client.from('messages').insert({
    intro_room_id: roomId,
    sender_user_id: dater.id,
    body: 'room is closed',
  });
  check(
    '18. leave closes the room and stops messaging',
    !leaveError && Boolean(reLeaveError) && Boolean(leftMsgError),
    leaveError?.message,
  );

  // ── Campaign lifecycle: pause / resume / archive ───────────────────────
  // 19. Pause takes the public page down; resume brings it back.
  await dater.client.rpc('set_campaign_status', {
    target_campaign_id: campaignId,
    next_status: 'paused',
  });
  const pausedPage = await fetch(`http://localhost:3000/p/${slug}`);
  await dater.client.rpc('set_campaign_status', {
    target_campaign_id: campaignId,
    next_status: 'published',
  });
  const resumedPage = await fetch(`http://localhost:3000/p/${slug}`);
  check(
    '19. pause 404s the public page, resume restores it',
    pausedPage.status === 404 && resumedPage.status === 200,
    `paused=${pausedPage.status} resumed=${resumedPage.status}`,
  );

  // 19b. A non-owner cannot drive the lifecycle.
  const { error: strangerLifecycleError } = await stranger.client.rpc('set_campaign_status', {
    target_campaign_id: campaignId,
    next_status: 'paused',
  });
  check(
    '19b. non-owner lifecycle rejected',
    Boolean(strangerLifecycleError),
    strangerLifecycleError?.message,
  );

  // 20. Archive is terminal: page stays down and interest is refused.
  await dater.client.rpc('set_campaign_status', {
    target_campaign_id: campaignId,
    next_status: 'archived',
  });
  const archivedPage = await fetch(`http://localhost:3000/p/${slug}`);
  const { error: republishError } = await dater.client.rpc('set_campaign_status', {
    target_campaign_id: campaignId,
    next_status: 'published',
  });
  const { error: archivedInterestError } = await stranger.client.rpc('submit_interest', {
    target_campaign_id: campaignId,
  });
  check(
    '20. archive is terminal (404 + no republish + no interest)',
    archivedPage.status === 404 && Boolean(republishError) && Boolean(archivedInterestError),
    `page=${archivedPage.status}`,
  );

  // ── Analytics ingestion ────────────────────────────────────────────────
  // 21. Anonymous + signed-in events land; junk names are rejected.
  const { error: anonTrackError } = await anonClient.rpc('track_event', {
    event_name: 'pitch_viewed_unique',
    properties: { campaign_slug: slug, source: analyticsSource },
  });
  const { error: userTrackError } = await dater.client.rpc('track_event', {
    event_name: 'campaign_paused',
    properties: { campaign_id: campaignId, source: analyticsSource },
  });
  const { error: junkTrackError } = await anonClient.rpc('track_event', {
    event_name: 'not_a_real_event',
  });
  const { data: trackedRows } = await admin
    .from('analytics_events')
    .select()
    .contains('properties', { source: analyticsSource });
  created.analyticsSeeded = true;
  check(
    '21. analytics events ingest (anon + user) and reject junk names',
    !anonTrackError &&
      !userTrackError &&
      Boolean(junkTrackError) &&
      (trackedRows ?? []).length === 2 &&
      trackedRows.some((row) => row.user_id === dater.id) &&
      trackedRows.some((row) => row.user_id === null),
    anonTrackError?.message ?? userTrackError?.message,
  );
} catch (error) {
  failures += 1;
  console.error('FATAL', error.message);
} finally {
  if (process.env.KEEP_CAMPAIGN === '1' && failures === 0) {
    console.log('KEEP_CAMPAIGN=1: leaving data in place for manual QA');
    console.log(JSON.stringify(created));
    process.exit(0);
  }
  if (created.voicePath) {
    await cleanup(
      'pitch media',
      admin.storage.from('pitch-media').remove([created.voicePath, ...(created.photoPaths ?? [])]),
    );
  }
  if (created.profilePhotos) {
    await cleanup(
      'profile media',
      admin.storage.from('profile-media').remove(created.profilePhotos),
    );
  }
  if (created.analyticsSeeded) {
    await cleanup(
      'analytics events',
      admin.from('analytics_events').delete().contains('properties', { source: analyticsSource }),
    );
  }
  if (created.campaignId) {
    for (const userId of created.users) {
      await cleanup('dating profile', admin.from('dating_profiles').delete().eq('user_id', userId));
      await cleanup('report', admin.from('reports').delete().eq('reporter_user_id', userId));
    }
    const { data: roomsToClean, error: roomsError } = await admin
      .from('intro_rooms')
      .select('id')
      .eq('campaign_id', created.campaignId);
    if (roomsError) {
      failures += 1;
      console.error('CLEANUP FAIL room lookup');
    }
    for (const row of roomsToClean ?? []) {
      await cleanup('messages', admin.from('messages').delete().eq('intro_room_id', row.id));
    }
    await cleanup(
      'intro rooms',
      admin.from('intro_rooms').delete().eq('campaign_id', created.campaignId),
    );
    await cleanup(
      'interests',
      admin.from('interests').delete().eq('campaign_id', created.campaignId),
    );
    await cleanup(
      'campaign memberships',
      admin.from('campaign_memberships').delete().eq('campaign_id', created.campaignId),
    );
    await cleanup('campaign', admin.from('campaigns').delete().eq('id', created.campaignId));
  }
  if (created.draftId) {
    await cleanup(
      'purchase analytics',
      admin.from('analytics_events').delete().contains('properties', {
        scope_id: created.draftId,
        product_id: 'creator_launch_credit_499',
      }),
    );
    if (created.purchaseEventIds.length > 0) {
      await cleanup(
        'purchase events',
        admin.from('purchase_events').delete().in('provider_event_id', created.purchaseEventIds),
      );
    }
    if (created.purchaseOriginalTransactionId) {
      await cleanup(
        'purchase credit ledger',
        admin
          .from('purchase_credit_ledger')
          .delete()
          .eq('idempotency_key', created.purchaseOriginalTransactionId),
      );
    }
    await cleanup(
      'purchase intents',
      admin.from('purchase_intents').delete().eq('scope_id', created.draftId),
    );
    await cleanup(
      'pitch draft erasure (requests + revisions cascade)',
      admin.rpc('erase_pitch_draft', { target_draft_id: created.draftId }),
    );
  }
  for (const userId of created.users) {
    await cleanup('auth user', admin.auth.admin.deleteUser(userId));
  }
  console.log(`cleanup done; failures=${failures}`);
  process.exit(failures === 0 ? 0 : 1);
}
