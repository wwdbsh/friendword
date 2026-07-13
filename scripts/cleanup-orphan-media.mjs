import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(repoRoot, 'packages/data/package.json'));
const { createClient } = require('@supabase/supabase-js');
const orphanAgeMs = 48 * 60 * 60 * 1000;
const buckets = ['pitch-media', 'profile-media'];

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
    (arg) => arg !== '--help' && arg !== '--apply' && arg !== '--dry-run',
  );
  if (unknown.length > 0) throw new Error(`unknown argument: ${unknown[0]}`);
  if (args.includes('--apply') && args.includes('--dry-run')) {
    throw new Error('--apply and --dry-run cannot be used together');
  }

  return { help: args.includes('--help'), apply: args.includes('--apply') };
}

function requireConfig(env) {
  const url = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  }
  return { url, serviceKey };
}

async function expectResult(operation) {
  const result = await operation;
  if (result.error) throw new Error('Supabase operation failed');
  return result.data ?? [];
}

async function selectAll(buildQuery, orderColumn) {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const page = await expectResult(
      buildQuery()
        .order(orderColumn, { ascending: true })
        .range(offset, offset + 999),
    );
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

function objectName(storagePath, bucket) {
  if (typeof storagePath !== 'string') return null;
  const prefix = `${bucket}/`;
  const name = storagePath.startsWith(prefix) ? storagePath.slice(prefix.length) : storagePath;
  return name === '' ? null : name;
}

async function collectReferenceLedger(admin) {
  const [pitchAssets, datingProfiles, consentRevisions, campaigns] = await Promise.all([
    selectAll(() => admin.from('pitch_assets').select('id,pitch_draft_id,storage_path'), 'id'),
    selectAll(() => admin.from('dating_profiles').select('user_id,photos'), 'user_id'),
    selectAll(
      () => admin.from('consent_revisions').select('id,pitch_draft_id,asset_ids,voice_asset_path'),
      'id',
    ),
    selectAll(() => admin.from('campaigns').select('id,pitch_draft_id,status'), 'id'),
  ]);

  const pitchObjects = new Set();
  const profileObjects = new Set();
  const protectedPitchPrefixes = new Set();
  const pitchAssetById = new Map();

  for (const asset of pitchAssets) {
    const name = objectName(asset.storage_path, 'pitch-media');
    if (name !== null) {
      pitchObjects.add(name);
      pitchAssetById.set(asset.id, name);
    }
  }

  for (const profile of datingProfiles) {
    for (const storagePath of Array.isArray(profile.photos) ? profile.photos : []) {
      const name = objectName(storagePath, 'profile-media');
      if (name !== null) profileObjects.add(name);
    }
  }

  for (const revision of consentRevisions) {
    // consent_revisions stores photo asset ids, not immutable photo paths.
    // Preserve the whole draft prefix when any revision exists so a deleted
    // pitch_assets row cannot make approved/reviewed historical media look orphaned.
    protectedPitchPrefixes.add(revision.pitch_draft_id);
    const voiceName = objectName(revision.voice_asset_path, 'pitch-media');
    if (voiceName !== null) pitchObjects.add(voiceName);
    for (const assetId of Array.isArray(revision.asset_ids) ? revision.asset_ids : []) {
      const referencedName = pitchAssetById.get(assetId);
      if (referencedName !== undefined) pitchObjects.add(referencedName);
    }
  }

  for (const campaign of campaigns) {
    if (campaign.status === 'published' || campaign.status === 'paused') {
      // PublishedPitchRepo reads this conventional voice path directly.
      pitchObjects.add(`${campaign.pitch_draft_id}/voice.m4a`);
    }
  }

  return { pitchObjects, profileObjects, protectedPitchPrefixes };
}

async function listBucketObjects(admin, bucket) {
  const objects = [];
  const folders = [''];
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
        const name = folder === '' ? entry.name : `${folder}/${entry.name}`;
        if (entry.id === null) {
          folders.push(name);
        } else {
          objects.push({ name, createdAt: entry.created_at });
        }
      }
      if (entries.length < 1000) break;
    }
  }
  return objects;
}

function classifyObjects(bucket, objects, ledger, cutoffMs) {
  const candidates = [];
  const protectedPitchPrefixes = [...ledger.protectedPitchPrefixes];
  let referenced = 0;
  let recent = 0;
  let unknownAge = 0;

  for (const object of objects) {
    const isReferenced =
      bucket === 'pitch-media'
        ? ledger.pitchObjects.has(object.name) ||
          protectedPitchPrefixes.some((prefix) => object.name.startsWith(`${prefix}/`))
        : ledger.profileObjects.has(object.name);
    if (isReferenced) {
      referenced += 1;
      continue;
    }

    const createdAtMs = Date.parse(object.createdAt ?? '');
    if (!Number.isFinite(createdAtMs)) {
      unknownAge += 1;
      continue;
    }
    if (createdAtMs > cutoffMs) {
      recent += 1;
      continue;
    }
    candidates.push(object.name);
  }

  return { candidates, referenced, recent, unknownAge };
}

function chunks(values, size = 100) {
  return Array.from({ length: Math.ceil(values.length / size) }, (_, index) =>
    values.slice(index * size, (index + 1) * size),
  );
}

async function removeObjects(admin, bucket, objectNames) {
  for (const objectNameChunk of chunks(objectNames)) {
    const { error } = await admin.storage.from(bucket).remove(objectNameChunk);
    if (error) throw new Error('Storage deletion failed');
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log('Usage: node scripts/cleanup-orphan-media.mjs [--apply|--dry-run]');
    return;
  }

  const fileEnv = readEnvFile();
  const config = requireConfig({ ...fileEnv, ...process.env });
  const admin = createClient(config.url, config.serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const ledger = await collectReferenceLedger(admin);
  const cutoffMs = Date.now() - orphanAgeMs;

  for (const bucket of buckets) {
    const objects = await listBucketObjects(admin, bucket);
    const classification = classifyObjects(bucket, objects, ledger, cutoffMs);
    const mode = options.apply ? 'APPLY' : 'DRY RUN';
    console.log(
      `${mode} ${bucket}: scanned=${objects.length} referenced=${classification.referenced} ` +
        `recent_unreferenced=${classification.recent} unknown_age=${classification.unknownAge} ` +
        `orphan_candidates=${classification.candidates.length}`,
    );

    if (options.apply && classification.candidates.length > 0) {
      await removeObjects(admin, bucket, classification.candidates);
      console.log(`APPLY ${bucket}: deleted=${classification.candidates.length}`);
    }
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : 'unknown failure';
  console.error(`Orphan media cleanup failed: ${message}`);
  process.exitCode = 1;
});
