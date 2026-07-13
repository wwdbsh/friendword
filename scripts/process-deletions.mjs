import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(repoRoot, 'packages/data/package.json'));
const { createClient } = require('@supabase/supabase-js');
const processingLeaseMs = 60 * 60 * 1000;

function readEnvFile() {
  const envPath = path.join(repoRoot, '.env');
  if (!existsSync(envPath)) return {};

  return Object.fromEntries(
    readFileSync(envPath, 'utf8')
      .split('\n')
      .filter((line) => line.includes('=') && !line.trim().startsWith('#'))
      .map((line) => {
        const separator = line.indexOf('=');
        return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
      }),
  );
}

function parseArgs(args) {
  const unknown = args.filter(
    (arg) => arg !== '--help' && arg !== '--dry-run' && !arg.startsWith('--limit='),
  );
  if (unknown.length > 0) throw new Error(`unknown argument: ${unknown[0]}`);

  const limitArgs = args.filter((arg) => arg.startsWith('--limit='));
  if (limitArgs.length > 1) throw new Error('--limit may only be provided once');
  const limitMatch = limitArgs[0]?.match(/^--limit=([1-9][0-9]*)$/);
  if (limitArgs.length === 1 && limitMatch === null) {
    throw new Error('--limit must be an integer from 1 to 100');
  }
  const limit = limitMatch === undefined ? 25 : Number(limitMatch[1]);
  if (limit > 100) throw new Error('--limit must be an integer from 1 to 100');

  return { help: args.includes('--help'), dryRun: args.includes('--dry-run'), limit };
}

function requireConfig(env) {
  const url = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  }
  return { url, serviceKey };
}

function ids(rows) {
  return rows.map((row) => row.id);
}

function chunks(values, size = 100) {
  return Array.from({ length: Math.ceil(values.length / size) }, (_, index) =>
    values.slice(index * size, (index + 1) * size),
  );
}

async function expectResult(operation) {
  const result = await operation;
  if (result.error) throw new Error('Supabase operation failed');
  return result.data ?? [];
}

async function runStage(label, operation) {
  try {
    return await operation();
  } catch {
    throw new Error(label);
  }
}

function claimableRequestFilter(staleBefore) {
  return `status.eq.queued,and(status.eq.processing,processed_at.lt.${staleBefore})`;
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

async function collectScope(admin, userId) {
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
  const rooms = await selectAll(() =>
    admin
      .from('intro_rooms')
      .select('id')
      .or(`dater_user_id.eq.${userId},interested_user_id.eq.${userId}`),
  );

  const pitchPaths = (
    await Promise.all(draftIds.map((draftId) => listStoragePaths(admin, 'pitch-media', draftId)))
  ).flat();
  const profilePaths = await listStoragePaths(admin, 'profile-media', userId);

  return {
    draftIds,
    campaignIds,
    roomIds: ids(rooms),
    pitchPaths,
    profilePaths,
    reassignments,
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

async function deleteAccountData(admin, userId, scope) {
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

async function processRequest(admin, request, dryRun, ordinal, staleBefore) {
  if (dryRun) {
    const scope = await collectScope(admin, request.user_id);
    const objectCount = scope.pitchPaths.length + scope.profilePaths.length;
    console.log(
      `DRY RUN request ${ordinal}: drafts=${scope.draftIds.length} campaigns=${scope.campaignIds.length} rooms=${scope.roomIds.length} storage_objects=${objectCount}`,
    );
    return;
  }

  let claimed;
  const leaseStartedAt = new Date().toISOString();
  try {
    claimed = await runStage('request claim', () =>
      expectResult(
        admin
          .from('deletion_requests')
          .update({ status: 'processing', processed_at: leaseStartedAt })
          .eq('id', request.id)
          .or(claimableRequestFilter(staleBefore))
          .select('id,processed_at'),
      ),
    );
  } catch (error) {
    const stage = error instanceof Error ? error.message : 'request claim';
    console.error(`FAILED request ${ordinal} at ${stage}`);
    process.exitCode = 1;
    return;
  }
  if (claimed.length === 0) return;
  const ownedLease = claimed[0].processed_at ?? leaseStartedAt;

  try {
    const scope = await runStage('scope collection', () => collectScope(admin, request.user_id));
    await deleteAccountData(admin, request.user_id, scope);
    const completed = await runStage('completion status update', () =>
      expectResult(
        admin
          .from('deletion_requests')
          .update({
            status: 'done',
            processed_at: new Date().toISOString(),
            note: 'Safety reports retained with user references anonymized.',
          })
          .eq('id', request.id)
          .eq('status', 'processing')
          .eq('processed_at', ownedLease)
          .select('id'),
      ),
    );
    if (completed.length === 0) throw new Error('lease ownership lost');
    console.log(`DONE request ${ordinal}`);
  } catch (error) {
    const stage = error instanceof Error ? error.message : 'unknown stage';
    try {
      const failed = await expectResult(
        admin
          .from('deletion_requests')
          .update({
            status: 'failed',
            processed_at: new Date().toISOString(),
            note: 'Processing failed; inspect restricted operator logs before retry.',
          })
          .eq('id', request.id)
          .eq('status', 'processing')
          .eq('processed_at', ownedLease)
          .select('id'),
      );
      if (failed.length === 0) {
        console.error(`STALE request ${ordinal} stopped at ${stage}`);
        return;
      }
    } catch {
      console.error(`FAILED request ${ordinal}: status update also failed`);
    }
    console.error(`FAILED request ${ordinal} at ${stage}`);
    process.exitCode = 1;
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log('Usage: node scripts/process-deletions.mjs [--dry-run] [--limit=25]');
    return;
  }

  const fileEnv = readEnvFile();
  const config = requireConfig({ ...fileEnv, ...process.env });
  const admin = createClient(config.url, config.serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const staleBefore = new Date(Date.now() - processingLeaseMs).toISOString();
  const requests = await expectResult(
    admin
      .from('deletion_requests')
      .select('id,user_id')
      .or(claimableRequestFilter(staleBefore))
      .order('requested_at', { ascending: true })
      .limit(options.limit),
  );

  if (requests.length === 0) {
    console.log(
      options.dryRun ? 'DRY RUN: no queued deletion requests' : 'No queued deletion requests',
    );
    return;
  }

  for (const [index, request] of requests.entries()) {
    await processRequest(admin, request, options.dryRun, index + 1, staleBefore);
  }
}

main().catch(() => {
  console.error('Deletion processor failed');
  process.exitCode = 1;
});
