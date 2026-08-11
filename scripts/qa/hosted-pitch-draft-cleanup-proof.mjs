// T010 (Issue #47) — hosted proof for 0059 `public.delete_my_pitch_draft`.
//
//   node scripts/qa/hosted-pitch-draft-cleanup-proof.mjs
//
// RUN THIS ONLY AFTER `supabase db push --linked` HAS APPLIED 0059, and run it
// against the linked project — it writes to a live database. It is the second
// half of the deployment step in docs/SESSION_HANDOFF.md §3.1; docs/OPS.md
// ("피치 정리 삭제") carries the same command.
//
// ── WHY A HOSTED RUN AT ALL ───────────────────────────────────────────────
// `bash scripts/test-db.sh` already proves the RPC's behaviour on a database
// built from the migrations. Two things it CANNOT prove, because the local
// harness applies the migrations as the superuser into a database that never
// had Supabase's hosted default privileges installed:
//
//   * whether `anon` really ends up without EXECUTE. Hosted installs
//     `ALTER DEFAULT PRIVILEGES … GRANT EXECUTE … TO anon`, so every new public
//     function is born reachable by an anonymous request, and only an explicit
//     `REVOKE … FROM PUBLIC, anon` takes it back (0051's lesson; 0046 still
//     carries the un-revoked shape). Locally the grant was never made, so a
//     migration that forgot the revoke looks identical to one that has it. P0.
//
//   * whether the whole PostgREST path works: a real signed-in JWT, `auth.uid()`
//     resolving inside a SECURITY DEFINER body, the refusal sentences arriving
//     at the client intact rather than as a generic 500. P1–P4, P6.
//
// ── SAFETY ────────────────────────────────────────────────────────────────
//   * Everything this script creates lives in ONE namespace, declared as the
//     constants below: ids under SYNTHETIC_ID_PREFIX, accounts at
//     <SYNTHETIC_EMAIL_LOCALPART_PREFIX>-<run>-<role>@SYNTHETIC_EMAIL_DOMAIN,
//     storage under `<synthetic draft id>/`. Nothing outside that namespace is
//     ever written, updated or deleted.
//   * Fixture creation onward is wrapped in try/finally, so a throw at any step
//     still removes the synthetic rows, objects and accounts. Cleanup failures
//     are NOT swallowed: what could not be removed is listed by name and the
//     run exits non-zero.
//   * P5 does not compare whole-table totals. This is a live project — a real
//     signup between the two censuses would fail a total-count assertion that
//     has nothing to do with this RPC, and worse, a passing total can hide an
//     equal-sized swap. Instead it checks the two facts that actually matter:
//     the synthetic namespace is empty afterwards, and every id that existed
//     before still exists, one id at a time (UNTOUCHABLE_CAMPAIGN_SLUGS named
//     explicitly on top of that).
//   * No PII is printed. Ids and synthetic addresses only.
//
// ── WHAT IT PROVES, in order ──────────────────────────────────────────────
//   P0  the ACL: an anonymous client is refused by PostgREST BEFORE the
//       function body runs (hosted-only — see above)
//   P1  rule (1): a draft with a campaign is refused, with the exact message
//   P2  rule (2): a draft with a queued ingest job is refused
//   P3  rule (3): another account's draft is refused
//   P4  the happy path: an unpublished draft of the caller's own goes, with its
//       assets, consent request and revision and its media_validations rows,
//       and its storage objects are LEFT for the orphan sweep
//   P6  rule (4): a draft carrying a purchase credit is refused, and the same
//       call succeeds once the ledger row is off it
//   P5  (after cleanup) nothing synthetic is left, and nothing pre-existing went
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(path.join(repoRoot, 'packages/data/package.json'));
const { createClient } = require('@supabase/supabase-js');

/**
 * The id namespace. Every row this script writes has an id starting here, and
 * every deletion it performs is scoped to it. A valid v4 UUID prefix on purpose:
 * these ids go into UUID columns, and one that fails to parse would fail at
 * insert time rather than at review time.
 */
export const SYNTHETIC_ID_PREFIX = '59010000-0000-4000-8000-0000000000';

/**
 * The account namespace. `.invalid` is reserved by RFC 2606 and can never be
 * delivered to, so a synthetic account left behind by a crashed run cannot be
 * mistaken for a person or mailed by anything.
 */
export const SYNTHETIC_EMAIL_LOCALPART_PREFIX = 't010-cleanup';
export const SYNTHETIC_EMAIL_DOMAIN = 'friendword.invalid';

/**
 * Named because losing either would be the worst outcome of a bad run, and a
 * by-id sweep would report "an id went missing" without saying which one
 * mattered. These are checked by slug as well as by id.
 */
export const UNTOUCHABLE_CAMPAIGN_SLUGS = ['sumin-n2g2ma', 'jordan-ba9m1u'];

/**
 * The tables P5 walks id-by-id. Each entry is the table and the column whose
 * values are compared before and after. Every table 0059 can reach — directly,
 * by cascade, or by the prefix delete — is here; a table the RPC cannot touch
 * would only add noise.
 */
const WATCHED_TABLES = [
  { table: 'pitch_drafts', key: 'id' },
  { table: 'pitch_assets', key: 'id' },
  { table: 'consent_requests', key: 'id' },
  { table: 'consent_revisions', key: 'id' },
  { table: 'campaigns', key: 'id' },
  { table: 'media_render_jobs', key: 'id' },
  { table: 'media_ingest_jobs', key: 'id' },
  { table: 'media_validations', key: 'object_name' },
  { table: 'purchase_credit_ledger', key: 'id' },
  { table: 'video_moderation_reviews', key: 'id' },
];

const failures = [];

function check(label, condition, detail = '') {
  if (condition) {
    console.log(`  ok   ${label}`);
    return true;
  }
  console.log(`  FAIL ${label} ${detail}`);
  failures.push(label);
  return false;
}

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

async function expectResult(operation, label) {
  const result = await operation;
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
}

/** Reads every row of one column, paged, so a growing table cannot truncate. */
async function selectAllKeys(admin, table, key) {
  const keys = [];
  for (let offset = 0; ; offset += 1000) {
    const page = await expectResult(
      admin
        .from(table)
        .select(key)
        .order(key, { ascending: true })
        .range(offset, offset + 999),
      `snapshot ${table}`,
    );
    for (const row of page) keys.push(String(row[key]));
    if (page.length < 1000) return keys;
  }
}

function isSynthetic(value) {
  return String(value).startsWith(SYNTHETIC_ID_PREFIX);
}

/** The message a PostgREST refusal carries, or null when the call succeeded. */
function refusal(result) {
  return result.error === null ? null : result.error.message;
}

async function main() {
  const env = readEnvFile();
  const url = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey || !serviceKey) {
    throw new Error(
      'SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are required',
    );
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const runId = randomUUID().slice(0, 8);
  const P = SYNTHETIC_ID_PREFIX;
  const DRAFT_PLAIN = `${P}01`;
  const DRAFT_WITH_CAMPAIGN = `${P}02`;
  const DRAFT_WITH_JOB = `${P}03`;
  const DRAFT_OTHER = `${P}04`;
  const CAMPAIGN = `${P}05`;
  const DRAFT_PAID = `${P}06`;
  const ASSET_VOICE = `${P}11`;
  const ASSET_PHOTO = `${P}12`;
  const ASSET_CLIP = `${P}13`;
  const REVISION = `${P}21`;
  const REQUEST = `${P}31`;
  const CREDIT = `${P}41`;
  const SYNTHETIC_DRAFTS = [
    DRAFT_PLAIN,
    DRAFT_WITH_CAMPAIGN,
    DRAFT_WITH_JOB,
    DRAFT_OTHER,
    DRAFT_PAID,
  ];

  console.log(`project:   ${url}`);
  console.log(`run id:    ${runId}`);
  console.log(
    `namespace: ${P}xx / ${SYNTHETIC_EMAIL_LOCALPART_PREFIX}-${runId}-*@${SYNTHETIC_EMAIL_DOMAIN}\n`,
  );

  /** Creates a confirmed account and returns a client signed in as it. */
  const makeUser = async (suffix) => {
    const email = `${SYNTHETIC_EMAIL_LOCALPART_PREFIX}-${runId}-${suffix}@${SYNTHETIC_EMAIL_DOMAIN}`;
    const password = `${randomUUID()}Aa1!`;
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error) throw new Error(`createUser ${suffix}: ${created.error.message}`);
    const client = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const signedIn = await client.auth.signInWithPassword({ email, password });
    if (signedIn.error) throw new Error(`signIn ${suffix}: ${signedIn.error.message}`);
    return { id: created.data.user.id, email, client };
  };

  const rpc = (client, draftId) =>
    client.rpc('delete_my_pitch_draft', { target_draft_id: draftId });

  // ── P0: the ACL, before anything is created ─────────────────────────────
  // No fixture needed and none wanted: the point is that the request never
  // reaches the function body, so the id it names is irrelevant.
  console.log('-- P0: an anonymous client cannot execute the RPC (hosted ACL) --');
  const anonClient = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const p0 = await rpc(anonClient, `${P}00`);
  const p0Message = refusal(p0);
  check('the anonymous call was refused', p0Message !== null, JSON.stringify(p0.data));
  // The discriminator, and the whole reason this check is worth a hosted run:
  // if anon held EXECUTE (the 0051 bug — `REVOKE … FROM PUBLIC` alone), the body
  // WOULD run, find auth.uid() NULL and answer 'authentication required'. That
  // sentence is a pass-looking failure, so it is called out by name.
  check(
    'refused by privilege, not by the function body',
    p0Message !== null && !p0Message.includes('authentication required'),
    `anon holds EXECUTE — got "${p0Message}"`,
  );
  check(
    'the refusal is a permission error',
    p0.error !== null && (p0.error.code === '42501' || /permission denied/i.test(p0Message ?? '')),
    `code=${p0.error?.code} message=${p0Message}`,
  );

  // ── The before-snapshot, taken while the database is still untouched ────
  console.log('\n-- snapshot: every id that exists before this run --');
  const before = new Map();
  for (const { table, key } of WATCHED_TABLES) {
    const keys = (await selectAllKeys(admin, table, key)).filter((value) => !isSynthetic(value));
    before.set(table, keys);
    console.log(`  ${table}: ${keys.length}`);
  }
  const untouchableCampaigns = await expectResult(
    admin.from('campaigns').select('id,slug,status').in('slug', UNTOUCHABLE_CAMPAIGN_SLUGS),
    'snapshot untouchable campaigns',
  );
  console.log(
    `  named campaigns: ${untouchableCampaigns
      .map((row) => `${row.slug}=${row.id} (${row.status})`)
      .join(', ')}`,
  );

  const users = [];
  let thrown = null;

  // Everything from here is inside try/finally, INCLUDING fixture creation: a
  // throw halfway through building the fixture leaves synthetic rows behind just
  // as surely as a throw during a proof, and the cleanup is id-scoped, so
  // removing a row that was never created is a no-op.
  try {
    const introducer = await makeUser('introducer');
    const other = await makeUser('other');
    const dater = await makeUser('dater');
    users.push(introducer, other, dater);
    console.log(`\nsynthetic accounts: ${users.map((user) => user.id).join(' ')}`);

    await expectResult(
      admin.from('pitch_drafts').insert([
        {
          id: DRAFT_PLAIN,
          created_by_user_id: introducer.id,
          status: 'consent_pending',
          headline: 'T010 synthetic dead draft',
          body: 'Synthetic.',
        },
        {
          id: DRAFT_WITH_CAMPAIGN,
          created_by_user_id: introducer.id,
          subject_user_id: dater.id,
          status: 'published',
          headline: 'T010 synthetic published',
          body: 'Synthetic.',
        },
        {
          id: DRAFT_WITH_JOB,
          created_by_user_id: introducer.id,
          status: 'draft',
          headline: 'T010 synthetic with clip',
          body: 'Synthetic.',
        },
        {
          id: DRAFT_OTHER,
          created_by_user_id: other.id,
          status: 'draft',
          headline: 'T010 synthetic other account',
          body: 'Synthetic.',
        },
        {
          id: DRAFT_PAID,
          created_by_user_id: introducer.id,
          status: 'draft',
          headline: 'T010 synthetic paid draft',
          body: 'Synthetic.',
        },
      ]),
      'insert drafts',
    );

    await expectResult(
      admin.from('campaigns').insert({
        id: CAMPAIGN,
        pitch_draft_id: DRAFT_WITH_CAMPAIGN,
        owner_user_id: dater.id,
        status: 'archived',
      }),
      'insert campaign',
    );

    // Storage objects first: pitch_assets.storage_path must name real bytes for
    // P4's "the objects are left behind" check to mean anything.
    for (const [draftId, name] of [
      [DRAFT_PLAIN, 'voice.m4a'],
      [DRAFT_PLAIN, 'photo-1.jpg'],
      [DRAFT_WITH_JOB, 'clip-1.mp4'],
    ]) {
      await expectResult(
        admin.storage.from('pitch-media').upload(`${draftId}/${name}`, `t010-${runId}`, {
          upsert: true,
          contentType: 'application/octet-stream',
        }),
        `upload ${draftId}/${name}`,
      );
    }

    await expectResult(
      admin.from('pitch_assets').insert([
        {
          id: ASSET_VOICE,
          pitch_draft_id: DRAFT_PLAIN,
          uploaded_by_user_id: introducer.id,
          asset_type: 'voice',
          storage_path: `pitch-media/${DRAFT_PLAIN}/voice.m4a`,
        },
        {
          id: ASSET_PHOTO,
          pitch_draft_id: DRAFT_PLAIN,
          uploaded_by_user_id: introducer.id,
          asset_type: 'photo',
          storage_path: `pitch-media/${DRAFT_PLAIN}/photo-1.jpg`,
        },
        {
          id: ASSET_CLIP,
          pitch_draft_id: DRAFT_WITH_JOB,
          uploaded_by_user_id: introducer.id,
          asset_type: 'video',
          storage_path: `pitch-media/${DRAFT_WITH_JOB}/clip-1.mp4`,
        },
      ]),
      'insert assets',
    );

    await expectResult(
      admin.from('consent_revisions').insert({
        id: REVISION,
        pitch_draft_id: DRAFT_PLAIN,
        revision_number: 1,
        headline: 'T010 synthetic dead draft',
        body: 'Synthetic.',
        voice_asset_path: `pitch-media/${DRAFT_PLAIN}/voice.m4a`,
        content_hash: `t010-${runId}`,
      }),
      'insert revision',
    );
    await expectResult(
      admin.from('consent_requests').insert({
        id: REQUEST,
        pitch_draft_id: DRAFT_PLAIN,
        token_hash: `t010-${runId}-token-hash`,
        status: 'pending',
        revision_id: REVISION,
        invite_contact_hash: `t010-${runId}-contact`,
        invite_contact_channel: 'email',
      }),
      'insert consent request',
    );
    await expectResult(
      admin.from('media_validations').insert([
        {
          bucket_id: 'pitch-media',
          object_name: `${DRAFT_PLAIN}/voice.m4a`,
          validated_at: new Date().toISOString(),
          mime_ok: true,
          magic_ok: true,
          size_ok: true,
          decode_ok: true,
          moderation_status: 'passed',
        },
        {
          bucket_id: 'pitch-media',
          object_name: `${DRAFT_PLAIN}/photo-1.jpg`,
          validated_at: new Date().toISOString(),
          mime_ok: true,
          magic_ok: true,
          size_ok: true,
          decode_ok: true,
          moderation_status: 'passed',
        },
      ]),
      'insert validations',
    );

    // Registering the clip enqueued its ingest job (0050 trigger). Confirmed
    // rather than manufactured, so P2 tests the shape the product produces.
    const jobs = await expectResult(
      admin.from('media_ingest_jobs').select('id,status').eq('asset_id', ASSET_CLIP),
      'read ingest job',
    );
    check(
      'fixture: registering a clip enqueued a queued ingest job',
      jobs[0]?.status === 'queued',
      JSON.stringify(jobs),
    );

    console.log('\n-- P1: rule (1), a pitch with a campaign --');
    const p1 = refusal(await rpc(introducer.client, DRAFT_WITH_CAMPAIGN));
    check(
      'refused with the published message',
      p1 !== null && p1.includes('a published pitch is taken down by the person it is about'),
      String(p1),
    );
    check(
      'the campaign row survived',
      (await expectResult(admin.from('campaigns').select('id').eq('id', CAMPAIGN), 'p1 campaign'))
        .length === 1,
    );

    console.log('\n-- P2: rule (2), a queued media job --');
    const p2 = refusal(await rpc(introducer.client, DRAFT_WITH_JOB));
    check(
      'refused with the still-being-processed message',
      p2 !== null && p2.includes('this pitch is still being processed and cannot be deleted yet'),
      String(p2),
    );

    console.log('\n-- P3: rule (3), someone else’s draft --');
    const p3 = refusal(await rpc(introducer.client, DRAFT_OTHER));
    check(
      'refused with the not-yours message',
      p3 !== null && p3.includes('pitch not found or not yours to delete'),
      String(p3),
    );
    check(
      'the other account’s draft survived',
      (
        await expectResult(
          admin.from('pitch_drafts').select('id').eq('id', DRAFT_OTHER),
          'p3 draft',
        )
      ).length === 1,
    );

    console.log('\n-- P4: the happy path --');
    const p4 = refusal(await rpc(introducer.client, DRAFT_PLAIN));
    check('the caller deleted their own dead draft', p4 === null, String(p4));
    for (const [label, table, column, value] of [
      ['draft', 'pitch_drafts', 'id', DRAFT_PLAIN],
      ['assets', 'pitch_assets', 'pitch_draft_id', DRAFT_PLAIN],
      ['consent request', 'consent_requests', 'pitch_draft_id', DRAFT_PLAIN],
      ['consent revision', 'consent_revisions', 'pitch_draft_id', DRAFT_PLAIN],
    ]) {
      const rows = await expectResult(
        admin.from(table).select('*', { head: false }).eq(column, value),
        `p4 ${table}`,
      );
      check(`${label} gone`, rows.length === 0, `${rows.length} left`);
    }
    const leftoverValidations = await expectResult(
      admin.from('media_validations').select('object_name').like('object_name', `${DRAFT_PLAIN}/%`),
      'p4 validations',
    );
    check(
      'media_validations rows gone',
      leftoverValidations.length === 0,
      JSON.stringify(leftoverValidations),
    );
    const leftObjects = await expectResult(
      admin.storage.from('pitch-media').list(DRAFT_PLAIN, { limit: 100 }),
      'p4 storage',
    );
    check(
      'the storage objects are left for the orphan sweep, not deleted in SQL',
      leftObjects.length === 2,
      `${leftObjects.length} objects`,
    );

    // ── P6: rule (4), money ────────────────────────────────────────────────
    // Hosted for the same reason as P0: purchase_credit_ledger is written by the
    // RevenueCat webhook against the live schema, and pitch_draft_id is a NO
    // ACTION reference — the guard is the only thing between a tidy-up gesture
    // and either a raw 23503 or a deleted accounting record.
    console.log('\n-- P6: rule (4), a purchase attached to the draft --');
    await expectResult(
      admin.from('purchase_credit_ledger').insert({
        id: CREDIT,
        user_id: introducer.id,
        credit_state: 'available',
        product_id: 'creator_launch_credit_499',
        pitch_draft_id: DRAFT_PAID,
        idempotency_key: `${SYNTHETIC_EMAIL_LOCALPART_PREFIX}-${runId}-credit`,
      }),
      'insert credit',
    );
    const p6 = refusal(await rpc(introducer.client, DRAFT_PAID));
    check(
      'refused with the purchase message',
      p6 !== null && p6.includes('this pitch has a purchase attached and cannot be deleted here'),
      String(p6),
    );
    check(
      'the ledger row survived the refusal',
      (
        await expectResult(
          admin.from('purchase_credit_ledger').select('id').eq('id', CREDIT),
          'p6 ledger',
        )
      ).length === 1,
    );
    // Positive control: support takes the credit off the draft (the docs/OPS.md
    // path) and the identical call goes through. Without this, a guard that
    // refused everything would read as a pass.
    await expectResult(
      admin.from('purchase_credit_ledger').delete().eq('id', CREDIT),
      'p6 ledger delete',
    );
    const p6After = refusal(await rpc(introducer.client, DRAFT_PAID));
    check(
      'the same call succeeds once the credit is off the draft',
      p6After === null,
      String(p6After),
    );
  } catch (error) {
    thrown = error;
    console.log(`\n  FAIL the run threw: ${error instanceof Error ? error.message : error}`);
    failures.push('the run threw before finishing');
  } finally {
    console.log('\n-- cleanup: removing everything in the synthetic namespace --');
    const cleanupErrors = await removeSyntheticNamespace({
      admin,
      drafts: SYNTHETIC_DRAFTS,
      campaignIds: [CAMPAIGN],
      creditIds: [CREDIT],
      prefix: P,
      users,
    });
    for (const problem of cleanupErrors) console.log(`  LEFT ${problem}`);
    if (cleanupErrors.length === 0) console.log('  ok   nothing left to remove');
    else failures.push(`cleanup left ${cleanupErrors.length} item(s)`);
  }

  // ── P5, in two halves, neither of which is a total ──────────────────────
  console.log('\n-- P5a: the synthetic namespace is empty --');
  for (const { table, key } of WATCHED_TABLES) {
    const residue = (await selectAllKeys(admin, table, key)).filter(isSynthetic);
    check(`${table}: no synthetic rows left`, residue.length === 0, residue.join(', '));
  }
  // Only the synthetic prefixes are listed, never the bucket root: a root listing
  // on a live project reads other people's folder names for no reason.
  for (const draftId of SYNTHETIC_DRAFTS) {
    const objects = await admin.storage.from('pitch-media').list(draftId, { limit: 100 });
    const names = (objects.data ?? []).map((object) => `${draftId}/${object.name}`);
    check(
      `pitch-media/${draftId}/: no synthetic objects left`,
      names.length === 0,
      names.join(', '),
    );
  }
  for (const user of users) {
    const found = await admin.auth.admin.getUserById(user.id);
    check(
      `account ${user.email} removed`,
      found.error !== null || (found.data?.user ?? null) === null,
    );
  }

  console.log('\n-- P5b: every id that existed before still exists --');
  for (const { table, key } of WATCHED_TABLES) {
    const now = new Set(await selectAllKeys(admin, table, key));
    const missing = (before.get(table) ?? []).filter((value) => !now.has(value));
    check(
      `${table}: all ${(before.get(table) ?? []).length} pre-existing rows intact`,
      missing.length === 0,
      `missing: ${missing.join(', ')}`,
    );
  }
  const untouchableAfter = await expectResult(
    admin.from('campaigns').select('id,slug,status').in('slug', UNTOUCHABLE_CAMPAIGN_SLUGS),
    'verify untouchable campaigns',
  );
  for (const expected of untouchableCampaigns) {
    const found = untouchableAfter.find((row) => row.slug === expected.slug);
    check(
      `campaign ${expected.slug} unchanged`,
      found !== undefined && found.id === expected.id && found.status === expected.status,
      JSON.stringify(found ?? null),
    );
  }

  if (thrown !== null) {
    console.error('\nthe error that stopped the run:', thrown);
  }
  console.log(
    failures.length === 0
      ? '\nALL CHECKS PASSED'
      : `\n${failures.length} CHECK(S) FAILED: ${failures.join('; ')}`,
  );
  process.exitCode = failures.length === 0 ? 0 : 1;
}

/**
 * Removes everything in the synthetic namespace, in dependency order, and
 * returns a list of what it could not remove.
 *
 * Every step is attempted even when an earlier one fails, and no failure is
 * swallowed: a half-cleaned run has to say which rows, objects or accounts are
 * still sitting in a live project, by name, so the next person can finish the
 * job by hand. Order matters — purchase_credit_ledger and campaigns are NO
 * ACTION references to pitch_drafts, and the accounts cannot go until the rows
 * that name them are gone.
 */
async function removeSyntheticNamespace({ admin, drafts, campaignIds, creditIds, prefix, users }) {
  const problems = [];
  const attempt = async (label, operation) => {
    try {
      const result = await operation();
      if (result?.error) problems.push(`${label}: ${result.error.message}`);
    } catch (error) {
      problems.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  await attempt('media_validations', () =>
    admin.from('media_validations').delete().like('object_name', `${prefix}%`),
  );
  await attempt('purchase_credit_ledger', () =>
    admin.from('purchase_credit_ledger').delete().in('id', creditIds),
  );
  await attempt('campaigns', () => admin.from('campaigns').delete().in('id', campaignIds));

  for (const draftId of drafts) {
    // erase_pitch_draft (0018) is the service-role primitive that takes a draft
    // and its dependents. Used here rather than the RPC under test, so cleanup
    // never depends on the thing the run may have just proven broken.
    await attempt(`erase_pitch_draft(${draftId})`, () =>
      admin.rpc('erase_pitch_draft', { target_draft_id: draftId }),
    );
    await attempt(`storage ${draftId}`, async () => {
      const listed = await admin.storage.from('pitch-media').list(draftId, { limit: 100 });
      if (listed.error) return listed;
      const names = (listed.data ?? []).map((object) => `${draftId}/${object.name}`);
      if (names.length === 0) return { error: null };
      return admin.storage.from('pitch-media').remove(names);
    });
  }

  for (const user of users) {
    await attempt(`account ${user.email}`, () => admin.auth.admin.deleteUser(user.id));
  }

  return problems;
}

const entrypoint = process.argv[1];
if (entrypoint !== undefined && import.meta.url === pathToFileURL(entrypoint).href) {
  main().catch((error) => {
    console.error('hosted proof failed:', error instanceof Error ? error.message : error);
    console.error(
      `Leftovers may remain under ids starting ${SYNTHETIC_ID_PREFIX} and accounts ` +
        `${SYNTHETIC_EMAIL_LOCALPART_PREFIX}-*@${SYNTHETIC_EMAIL_DOMAIN}.`,
    );
    process.exitCode = 1;
  });
}
