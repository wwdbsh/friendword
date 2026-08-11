// Account-erasure mechanics, extracted from scripts/process-deletions.mjs so a
// test harness can drive them with a stub admin client instead of only a real
// hosted project. `process-deletions.mjs` keeps the queue driver — argument
// parsing, credentials, the claim/lease and the request status — and calls
// exactly two things from here: {@link collectScope} and
// {@link deleteAccountData}.
//
// The decisions that matter for a data-destruction boundary live here:
//
//  1. WHICH drafts are erased and which are preserved for a *different*
//     owner's campaign. Getting this wrong either destroys a dater's live
//     campaign or leaves a deleted introducer's draft standing.
//  2. WHICH storage objects a preserved draft must still give up. Migration
//     0037 promises the introducer's voice is erased at deletion time, and a
//     preserved draft keeps its media prefix alive, so the voice bytes have to
//     be named explicitly — including every artifact that copies them.
//  3. IN WHICH ORDER the stages run. See {@link deleteAccountData}: the
//     ownership transfer is the one stage that makes a draft invisible to
//     {@link collectScope}, so everything derived from "this user authored
//     that draft" has to happen before it, or a retry silently skips it.
//
// The types are described in accountErasure.d.mts, which is what the TypeScript
// tests in packages/data consume.

/** The introducer's original recording, at the root of the draft prefix. */
export const VOICE_OBJECT_NAME = 'voice.m4a';

/**
 * Rendered MP4s live at pitch-media/<draftId>/renders/<revisionId>.mp4
 * (migration 0054 CHECK-enforces the shape).
 */
export const RENDER_PREFIX = 'renders';

export function voiceObjectPath(draftId) {
  return `${draftId}/${VOICE_OBJECT_NAME}`;
}

export function renderFolderPath(draftId) {
  return `${draftId}/${RENDER_PREFIX}`;
}

/** True when `objectPath` under `draftId`'s prefix carries the introducer's voice. */
export function isVoiceDerivedPath(draftId, objectPath) {
  return (
    objectPath === voiceObjectPath(draftId) ||
    objectPath.startsWith(`${renderFolderPath(draftId)}/`)
  );
}

/**
 * Partitions the deleted user's drafts into "erase" and "preserve for the
 * campaign owner", and derives the campaigns and rooms that go with them.
 *
 * A draft is preserved only when all four hold: this user authored it, they are
 * not its subject, it has a campaign, and that campaign belongs to someone
 * else. Anything else — including an authored draft that never became a
 * campaign — is erased with the account.
 */
export function planAccountErasure({ userId, drafts, campaigns, rooms }) {
  const campaignsByDraftId = new Map(
    campaigns.map((campaign) => [campaign.pitch_draft_id, campaign]),
  );
  const reassignments = [];
  const draftIds = [];
  for (const draft of drafts) {
    const campaign = campaignsByDraftId.get(draft.id);
    const preservesOtherOwnersCampaign =
      draft.created_by_user_id === userId &&
      draft.subject_user_id !== userId &&
      campaign !== undefined &&
      campaign.owner_user_id !== userId;
    if (preservesOtherOwnersCampaign) {
      reassignments.push({ draftId: draft.id, newOwnerId: campaign.owner_user_id });
    } else {
      draftIds.push(draft.id);
    }
  }
  const deletedDraftIds = new Set(draftIds);
  const campaignIds = campaigns
    .filter(
      (campaign) =>
        campaign.owner_user_id === userId || deletedDraftIds.has(campaign.pitch_draft_id),
    )
    .map((campaign) => campaign.id);
  return {
    draftIds,
    campaignIds,
    roomIds: rooms.map((room) => room.id),
    reassignments,
  };
}

/**
 * Every pitch-media object a *preserved* draft must still lose, because it
 * carries the deleted introducer's voice.
 *
 * The source recording is one object; the rendered MP4 is another. The encoder
 * copies the original AAC stream into the MP4 untouched (see
 * apps/web/src/lib/pitchRender/encode.ts, "the Introducer's original voice,
 * untouched"), so a render is a bit-identical second copy of the very recording
 * 0037 erases. Removing only `voice.m4a` would leave that copy — and its signed
 * download route — behind, which is not erasure.
 *
 * The dater's own uploads under the same prefix (photos, clips they supplied)
 * are deliberately untouched: the draft is being kept *for them*.
 *
 * `listPaths(folder)` must return the object paths directly under `folder`
 * (recursively), or an empty array when the folder does not exist.
 */
export async function collectVoiceDerivedPaths(preservedDraftIds, listPaths) {
  const paths = [];
  for (const draftId of preservedDraftIds) {
    paths.push(voiceObjectPath(draftId));
    paths.push(...(await listPaths(renderFolderPath(draftId))));
  }
  return paths;
}

/**
 * The post-condition of the voice-erasure stage, re-read from storage.
 *
 * `collectVoiceDerivedPaths` names what to delete; this names what is still
 * there afterwards. The two are deliberately not the same call: the removal
 * list includes `voice.m4a` whether or not it exists, and supabase-js reports a
 * bucket-level error only — a per-object failure inside `remove()` does not
 * surface as one. "No error" is therefore not "no object", so the stage
 * re-enumerates before it is allowed to pass.
 *
 * `listPrefix(draftId)` must return every object path under the draft's prefix.
 */
export async function findSurvivingVoiceDerivedPaths(preservedDraftIds, listPrefix) {
  const survivors = [];
  for (const draftId of preservedDraftIds) {
    for (const objectPath of await listPrefix(draftId)) {
      if (isVoiceDerivedPath(draftId, objectPath)) survivors.push(objectPath);
    }
  }
  return survivors;
}

// ---------------------------------------------------------------------------
// PostgREST/storage plumbing. Everything below takes the admin client as its
// first argument, which is the whole reason the erasure is testable: the tests
// pass a recording fake, the job passes a service-role supabase-js client.
// ---------------------------------------------------------------------------

function ids(rows) {
  return rows.map((row) => row.id);
}

export function chunks(values, size = 100) {
  return Array.from({ length: Math.ceil(values.length / size) }, (_, index) =>
    values.slice(index * size, (index + 1) * size),
  );
}

export async function expectResult(operation) {
  const result = await operation;
  if (result.error) throw new Error('Supabase operation failed');
  return result.data ?? [];
}

/** Runs `operation`, replacing any failure with an error naming the stage. */
export async function runStage(label, operation) {
  try {
    return await operation();
  } catch {
    throw new Error(label);
  }
}

async function selectAll(buildQuery) {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const page = await expectResult(
      buildQuery()
        .order('id', { ascending: true })
        .range(offset, offset + 999),
    );
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

async function listStoragePaths(admin, bucket, prefix) {
  const paths = [];
  const folders = [prefix];
  while (folders.length > 0) {
    const folder = folders.pop();
    if (folder === undefined) break;
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await admin.storage.from(bucket).list(folder, {
        limit: 1000,
        offset,
        sortBy: { column: 'name', order: 'asc' },
      });
      if (error) throw new Error('Storage listing failed');
      const entries = data ?? [];
      for (const entry of entries) {
        const objectPath = `${folder}/${entry.name}`;
        if (entry.id === null) folders.push(objectPath);
        else paths.push(objectPath);
      }
      if (entries.length < 1000) break;
    }
  }
  return paths;
}

/**
 * Reads everything the erasure touches for one user, in one pass.
 *
 * Re-derived on every attempt, including a retry: nothing here is persisted
 * between runs, so the scope a retry acts on is whatever the database says at
 * that moment. See {@link deleteAccountData} for why the stage order has to
 * keep that true.
 */
export async function collectScope(admin, userId) {
  const drafts = await selectAll(() =>
    admin
      .from('pitch_drafts')
      .select('id,created_by_user_id,subject_user_id')
      .or(`created_by_user_id.eq.${userId},subject_user_id.eq.${userId}`),
  );
  const campaignsById = new Map();
  const ownedCampaigns = await selectAll(() =>
    admin.from('campaigns').select('id,pitch_draft_id,owner_user_id').eq('owner_user_id', userId),
  );
  for (const campaign of ownedCampaigns) campaignsById.set(campaign.id, campaign);
  for (const draftIdChunk of chunks(ids(drafts))) {
    const linkedCampaigns = await selectAll(() =>
      admin
        .from('campaigns')
        .select('id,pitch_draft_id,owner_user_id')
        .in('pitch_draft_id', draftIdChunk),
    );
    for (const campaign of linkedCampaigns) campaignsById.set(campaign.id, campaign);
  }
  const campaigns = [...campaignsById.values()];
  const rooms = await selectAll(() =>
    admin
      .from('intro_rooms')
      .select('id')
      .or(`dater_user_id.eq.${userId},interested_user_id.eq.${userId}`),
  );

  const plan = planAccountErasure({ userId, drafts, campaigns, rooms });

  const pitchPaths = (
    await Promise.all(
      plan.draftIds.map((draftId) => listStoragePaths(admin, 'pitch-media', draftId)),
    )
  ).flat();
  const profilePaths = await listStoragePaths(admin, 'profile-media', userId);
  // A preserved draft keeps its prefix, so the voice — and every artifact that
  // copies it — has to be named one by one. This snapshot exists for the
  // dry-run object count; the stage that actually deletes re-enumerates.
  const voiceDerivedPaths = await collectVoiceDerivedPaths(
    plan.reassignments.map((reassignment) => reassignment.draftId),
    (folder) => listStoragePaths(admin, 'pitch-media', folder),
  );

  return {
    draftIds: plan.draftIds,
    campaignIds: plan.campaignIds,
    roomIds: plan.roomIds,
    pitchPaths,
    profilePaths,
    voiceDerivedPaths,
    reassignments: plan.reassignments,
  };
}

async function removeRows(admin, table, filter) {
  let query = admin.from(table).delete();
  query = filter(query);
  await expectResult(query);
}

async function removeRowsByIds(admin, table, column, values) {
  for (const valueChunk of chunks(values)) {
    await removeRows(admin, table, (query) => query.in(column, valueChunk));
  }
}

async function removeStorageObjects(admin, bucket, paths) {
  for (const pathChunk of chunks(paths, 1000)) {
    await expectResult(admin.storage.from(bucket).remove(pathChunk));
  }
}

async function removeMediaValidations(admin, bucket, prefixes) {
  for (const prefix of prefixes) {
    await removeRows(admin, 'media_validations', (query) =>
      query.eq('bucket_id', bucket).like('object_name', `${prefix}/%`),
    );
  }
}

async function eraseDrafts(admin, draftIds) {
  for (const draftId of draftIds) {
    const rpcResult = await admin.rpc('erase_pitch_draft', { target_draft_id: draftId });
    if (rpcResult.error?.code === 'PGRST202') {
      await removeRows(admin, 'consent_requests', (query) => query.eq('pitch_draft_id', draftId));
      await removeRows(admin, 'pitch_drafts', (query) => query.eq('id', draftId));
    } else {
      await expectResult(rpcResult);
    }
  }
}

/**
 * Erases every object that carries the deleted introducer's voice from the
 * drafts being kept for someone else.
 *
 * 0037 deletes the voice asset ROWS synchronously and archives the voiceless
 * campaigns, but a draft preserved for another owner keeps its storage prefix
 * alive, so the physical bytes — personal data — would survive both this job's
 * prefix removal and the orphan sweep's protected-prefix rules.
 *
 * T007 (Issue #44) widened this from `voice.m4a` alone to every object that
 * carries the same audio. The renderer copies the introducer's AAC stream into
 * the MP4 untouched, so `<draft>/renders/<revision>.mp4` was a bit-identical
 * second copy of the recording this job had just erased — still downloadable
 * through the kit's signed-URL route.
 *
 * The three steps are ordered, and the order is the contract:
 *
 *  1. `media_render_jobs` rows first. `output_storage_path` advertises the
 *     object about to be deleted, so a crash between the two steps must leave a
 *     row pointing at nothing, never a row that outlives a still-present MP4.
 *  2. Re-enumerate and delete. The scope snapshot was taken before the earlier
 *     stages ran; a render that landed since is still in the folder listing.
 *  3. Re-enumerate again and refuse to pass while anything voice-derived is
 *     still there — see {@link findSurvivingVoiceDerivedPaths} for why a
 *     successful `remove()` is not proof.
 */
async function eraseVoiceDerivedObjects(admin, preservedDraftIds) {
  if (preservedDraftIds.length === 0) return;

  await removeRowsByIds(admin, 'media_render_jobs', 'pitch_draft_id', preservedDraftIds);

  const voicePaths = await collectVoiceDerivedPaths(preservedDraftIds, (folder) =>
    listStoragePaths(admin, 'pitch-media', folder),
  );
  await removeStorageObjects(admin, 'pitch-media', voicePaths);
  for (const voicePath of voicePaths) {
    await removeRows(admin, 'media_validations', (query) =>
      query.eq('bucket_id', 'pitch-media').eq('object_name', voicePath),
    );
  }

  const survivors = await findSurvivingVoiceDerivedPaths(preservedDraftIds, (draftId) =>
    listStoragePaths(admin, 'pitch-media', draftId),
  );
  if (survivors.length > 0) {
    throw new Error('voice-derived objects survived the erasure');
  }
}

/**
 * Runs the physical erasure for one user, stage by stage.
 *
 * There is no transaction across these calls (they are REST round trips), so a
 * failure leaves the account half-erased and the request `failed`. What makes
 * that recoverable is that a retry rebuilds the scope from the database — and
 * that only holds if no earlier stage has already changed the rows
 * {@link collectScope} selects on.
 *
 * Exactly one stage does: `shared campaign ownership transfer` rewrites
 * `pitch_drafts.created_by_user_id`, and the draft query filters on
 * `created_by_user_id = userId OR subject_user_id = userId`. Once the transfer
 * lands, a preserved draft is invisible to every later attempt — it is no
 * longer this user's by any column. So everything derived from "this user
 * authored that draft" runs BEFORE the transfer, and the voice erasure is the
 * whole of that: it is safe there (the draft is still the deleted user's), and
 * a retry that fails ahead of the transfer rebuilds the same scope and does it
 * again. Running it after the transfer instead — as this job did until T007's
 * review — meant a failure in the window between the two stages left the voice
 * in storage permanently, with every retry converging on "nothing to do".
 */
export async function deleteAccountData(admin, userId, scope) {
  const preservedDraftIds = scope.reassignments.map((reassignment) => reassignment.draftId);
  await runStage('media validation cleanup', async () => {
    await removeMediaValidations(admin, 'pitch-media', scope.draftIds);
    await removeMediaValidations(admin, 'profile-media', [userId]);
  });
  await runStage('storage object removal', async () => {
    await removeStorageObjects(admin, 'pitch-media', scope.pitchPaths);
    await removeStorageObjects(admin, 'profile-media', scope.profilePaths);
  });
  await runStage('safety report anonymization', async () => {
    await expectResult(
      admin
        .from('reports')
        .update({ reporter_user_id: null, anon_report: true })
        .eq('reporter_user_id', userId),
    );
    await expectResult(
      admin.from('reports').update({ reported_user_id: null }).eq('reported_user_id', userId),
    );
  });
  await runStage('introducer voice erasure', () =>
    eraseVoiceDerivedObjects(admin, preservedDraftIds),
  );
  // Must stay after the voice erasure: this is the point of no return for the
  // scope, because it takes the preserved drafts out of `collectScope`'s reach.
  await runStage('shared campaign ownership transfer', async () => {
    for (const reassignment of scope.reassignments) {
      await expectResult(
        admin.rpc('reassign_pitch_storage_owner', {
          target_draft_id: reassignment.draftId,
          new_owner_id: reassignment.newOwnerId,
        }),
      );
      await expectResult(
        admin
          .from('pitch_assets')
          .update({ uploaded_by_user_id: reassignment.newOwnerId })
          .eq('pitch_draft_id', reassignment.draftId)
          .eq('uploaded_by_user_id', userId),
      );
      await expectResult(
        admin
          .from('pitch_drafts')
          .update({ created_by_user_id: reassignment.newOwnerId })
          .eq('id', reassignment.draftId)
          .eq('created_by_user_id', userId),
      );
    }
  });
  await runStage('purchase reference cleanup', async () => {
    // share_kits.credit_ledger_id is a RESTRICT FK (second audit H-2):
    // paid accounts with an unlocked kit must drop the kit rows before
    // any credit-ledger row can go.
    await removeRowsByIds(admin, 'share_kits', 'pitch_draft_id', scope.draftIds);
    await removeRows(admin, 'share_kits', (query) => query.eq('unlocked_by_user_id', userId));
    await removeRowsByIds(admin, 'purchase_credit_ledger', 'campaign_id', scope.campaignIds);
    await removeRowsByIds(admin, 'purchase_credit_ledger', 'pitch_draft_id', scope.draftIds);
  });
  await runStage('campaign and room removal', async () => {
    await removeRowsByIds(admin, 'campaigns', 'id', scope.campaignIds);
    await removeRowsByIds(admin, 'intro_rooms', 'id', scope.roomIds);
  });
  await runStage('pitch draft erasure', async () => {
    if (scope.draftIds.length > 0) await eraseDrafts(admin, scope.draftIds);
  });
  await runStage('user reference cleanup', async () => {
    await removeRows(admin, 'messages', (query) => query.eq('sender_user_id', userId));
    await removeRows(admin, 'interests', (query) => query.eq('sender_user_id', userId));
    await removeRows(admin, 'vouches', (query) => query.eq('author_user_id', userId));
    await removeRows(admin, 'campaign_memberships', (query) => query.eq('user_id', userId));
    await removeRows(admin, 'blocks', (query) =>
      query.or(`blocker_user_id.eq.${userId},blocked_user_id.eq.${userId}`),
    );
    await removeRows(admin, 'verification_checks', (query) => query.eq('user_id', userId));
    await removeRows(admin, 'purchase_credit_ledger', (query) => query.eq('user_id', userId));
    await removeRows(admin, 'purchase_intents', (query) => query.eq('user_id', userId));
    await removeRows(admin, 'purchase_events', (query) => query.eq('purchaser_user_id', userId));
    await removeRows(admin, 'pitch_assets', (query) => query.eq('uploaded_by_user_id', userId));
  });
  await runStage('auth user removal', async () => {
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error && error.status !== 404) throw new Error('Auth user deletion failed');
  });
}
