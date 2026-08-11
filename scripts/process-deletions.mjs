import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { collectScope, deleteAccountData, expectResult, runStage } from './lib/accountErasure.mjs';

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

function claimableRequestFilter(staleBefore) {
  return `status.eq.queued,and(status.eq.processing,processed_at.lt.${staleBefore})`;
}

async function processRequest(admin, request, dryRun, ordinal, staleBefore) {
  if (dryRun) {
    const scope = await collectScope(admin, request.user_id);
    const objectCount =
      scope.pitchPaths.length + scope.profilePaths.length + scope.voiceDerivedPaths.length;
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
