import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import ffprobeStatic from 'ffprobe-static';
import { buildHighlightPlan, buildPitchSceneV2 } from '@friendword/contracts';
import { createServiceClient } from '@friendword/data';
import { beforeAll, describe, expect, it } from 'vitest';

import { FIXTURE_TEXT, audioM4a, photoAsset } from './fixtures';

// The whole Phase 4 worker loop against REAL infrastructure: jobs seeded into
// a local Supabase stack (DB + storage), the production route running under
// `next start`, real Chromium, real ffmpeg. Gated because it needs psql, the
// local stack, and a server started with the local service env:
//
//   supabase start && supabase migration up
//   pnpm --filter @friendword/web build
//   SUPABASE_URL=http://127.0.0.1:54321 \
//   SUPABASE_SERVICE_ROLE_KEY=<local service key> \
//   FRIENDWORD_MEDIA_RENDER_SECRET=<secret> \
//   PITCH_RENDER_BASE_URL=http://127.0.0.1:3120 \
//     pnpm --filter @friendword/web exec next start -p 3120
//   RENDER_QUEUE_E2E=1 SUPABASE_SERVICE_ROLE_KEY=... FRIENDWORD_MEDIA_RENDER_SECRET=... \
//     pnpm --filter @friendword/web exec vitest run --config vitest.render.config.ts renderQueue
//
// RENDER_HIGHLIGHT_ENABLED must carry the SAME value in the server's env and in
// this run's: campaign D asserts the highlight path when it is 'true' and the
// legacy path otherwise, and it cannot read the server's environment.
//
// Three campaigns pin the three verdicts:
//   A - success: MP4 in storage at the nested 0054 path, job done with real
//       output_bytes / output_duration_ms, free render consumed AT success.
//   B - D1: job frozen with a wrong scene_hash; the worker refuses to render.
//   C - failure honesty: a v1 scene the engine refuses; terminal failure,
//       ops alert, and NO pitch_render_unlocks row (no consumption).
//   D - 0063: a job seeded variant='highlight' with music. Every job here now
//       states its variant, because 0063's column DEFAULT is 'highlight' — a
//       job seeded without one renders a CUT with a 3s end card, and A/B/C's
//       duration assertions would fail for a reason unrelated to the queue.

const E2E = process.env.RENDER_QUEUE_E2E === '1';
const DB_URL =
  process.env.RENDER_QUEUE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const API_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const SECRET = process.env.FRIENDWORD_MEDIA_RENDER_SECRET ?? '';
const ROUTE_URL = `${process.env.PITCH_RENDER_BASE_URL ?? 'http://127.0.0.1:3120'}/api/media/render-run`;
const OUT_DIR = path.join(os.tmpdir(), 'friendword-render-out');

const IDS = {
  introducer: 'ee3a0000-0000-4000-8000-000000000001',
  dater: 'ee3a0000-0000-4000-8000-000000000002',
  daterB: 'ee3a0000-0000-4000-8000-000000000003',
  daterC: 'ee3a0000-0000-4000-8000-000000000004',
  daterD: 'ee3a0000-0000-4000-8000-000000000005',
  draftA: 'ee3a1000-0000-4000-8000-000000000001',
  draftB: 'ee3a1000-0000-4000-8000-000000000002',
  draftC: 'ee3a1000-0000-4000-8000-000000000003',
  draftD: 'ee3a1000-0000-4000-8000-000000000004',
  revA: 'ee3a2000-0000-4000-8000-000000000001',
  revB: 'ee3a2000-0000-4000-8000-000000000002',
  revC: 'ee3a2000-0000-4000-8000-000000000003',
  revD: 'ee3a2000-0000-4000-8000-000000000004',
  campaignA: 'ee3a3000-0000-4000-8000-000000000001',
  campaignB: 'ee3a3000-0000-4000-8000-000000000002',
  campaignC: 'ee3a3000-0000-4000-8000-000000000003',
  campaignD: 'ee3a3000-0000-4000-8000-000000000004',
  jobA: 'ee3a4000-0000-4000-8000-000000000001',
  jobB: 'ee3a4000-0000-4000-8000-000000000002',
  jobC: 'ee3a4000-0000-4000-8000-000000000003',
  jobD: 'ee3a4000-0000-4000-8000-000000000004',
  photo1: 'ee3a5000-0000-4000-8000-000000000001',
  photo2: 'ee3a5000-0000-4000-8000-000000000002',
  photo3: 'ee3a5000-0000-4000-8000-000000000003',
  photo4: 'ee3a5000-0000-4000-8000-000000000004',
} as const;

const SCENE_DURATION_MS = 6_000;
const END_CARD_MS = 1_500;
/** §2.5: the highlight's card is longer, and campaign D asserts that too. */
const HIGHLIGHT_END_CARD_MS = 3_000;

/**
 * The rollout flag as the WORKER sees it. The server under test must be started
 * with the same value (see the header): with the flag off, job D renders full
 * like every other job, and this file asserts that instead — both states are a
 * correct product, and neither may be asserted blind.
 */
const HIGHLIGHT_ON =
  process.env.RENDER_HIGHLIGHT_ENABLED !== 'false' && process.env.RENDER_HIGHLIGHT_ENABLED !== '0';

function psql(sql: string): string {
  return execFileSync('psql', [DB_URL, '-v', 'ON_ERROR_STOP=1', '-Atc', sql], {
    encoding: 'utf8',
  }).trim();
}

function psqlFile(sql: string): void {
  const file = path.join(os.tmpdir(), `friendword-render-queue-e2e-${process.pid}.sql`);
  writeFileSync(file, sql);
  execFileSync('psql', [DB_URL, '-v', 'ON_ERROR_STOP=1', '-f', file], { encoding: 'utf8' });
}

/** Dollar-quote-free literal embedding; the fixture JSON carries no quotes. */
function sqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function successScene(photoAssetIds: readonly string[] = [IDS.photo1, IDS.photo2]) {
  const scene = buildPitchSceneV2({
    template: 'warm',
    photoAssetIds: [...photoAssetIds],
    segments: [
      { startMs: 0, endMs: 3_000 },
      { startMs: 3_000, endMs: SCENE_DURATION_MS },
    ],
    words: [
      { segmentIndex: 0, wordIndex: 0, startMs: 400, endMs: 900 },
      { segmentIndex: 1, wordIndex: 0, startMs: 3_400, endMs: 3_900 },
    ],
    structure: FIXTURE_TEXT,
  });
  if (scene === null) {
    throw new Error('builder refused the e2e scene input');
  }
  return scene;
}

/** Word timings consistent with the scene segments above (view.ts rounding). */
const TRANSCRIPT = {
  text: 'Honestly the best friend I know. Loyal beyond anything I can say.',
  segments: [
    { start: 0, end: 3, text: 'Honestly the best friend I know.' },
    { start: 3, end: 6, text: 'Loyal beyond anything I can say.' },
  ],
  words: [
    { start: 0.4, end: 0.9, word: 'Honestly' },
    { start: 3.4, end: 3.9, word: 'Loyal' },
  ],
};

async function postRenderRun(authorization?: string): Promise<Response> {
  return fetch(ROUTE_URL, {
    method: 'POST',
    headers: authorization === undefined ? {} : { authorization },
  });
}

describe.runIf(E2E)('render queue end to end (local Supabase + next start)', () => {
  const passSummaries: unknown[] = [];

  beforeAll(async () => {
    if (SERVICE_KEY === '' || SECRET === '') {
      throw new Error(
        'RENDER_QUEUE_E2E needs SUPABASE_SERVICE_ROLE_KEY and FRIENDWORD_MEDIA_RENDER_SECRET',
      );
    }
    const service = createServiceClient(API_URL, SERVICE_KEY);
    const sceneJson = JSON.stringify(successScene());
    const highlightSceneJson = JSON.stringify(successScene([IDS.photo3, IDS.photo4]));
    const badSceneJson = JSON.stringify({ schemaVersion: 1, scenes: [] });
    const structureJson = JSON.stringify({
      ...FIXTURE_TEXT,
      hard_claims_requiring_confirmation: [],
    });
    const transcriptJson = JSON.stringify(TRANSCRIPT);

    // ── Clean any previous run, then seed the graph ──────────────────────
    const allIds = Object.values(IDS);
    const idList = (ids: readonly string[]) => ids.map((id) => `'${id}'`).join(', ');
    psqlFile(`
BEGIN;
DELETE FROM ops_alerts WHERE campaign_id IN (${idList([IDS.campaignA, IDS.campaignB, IDS.campaignC, IDS.campaignD])});
DELETE FROM campaigns WHERE id IN (${idList([IDS.campaignA, IDS.campaignB, IDS.campaignC, IDS.campaignD])});
-- Consent revisions are immutable except on the erasure path (0016/0018):
-- deleting the seeded drafts takes the same transaction-scoped erasure flag
-- the production deletion job sets.
SET LOCAL friendword.erasure = 'on';
DELETE FROM pitch_drafts WHERE id IN (${idList([IDS.draftA, IDS.draftB, IDS.draftC, IDS.draftD])});
DELETE FROM users WHERE id IN (${idList([IDS.introducer, IDS.dater, IDS.daterB, IDS.daterC, IDS.daterD])});
DELETE FROM auth.users WHERE id IN (${idList(allIds)});

INSERT INTO auth.users (id, email)
VALUES ('${IDS.introducer}', 'render-e2e-introducer@example.test'),
       ('${IDS.dater}', 'render-e2e-dater-a@example.test'),
       ('${IDS.daterB}', 'render-e2e-dater-b@example.test'),
       ('${IDS.daterC}', 'render-e2e-dater-c@example.test'),
       ('${IDS.daterD}', 'render-e2e-dater-d@example.test')
ON CONFLICT (id) DO NOTHING;
-- One active campaign per owner (enforce_one_active_campaign): each probe
-- campaign gets its own dater.
INSERT INTO users (id, account_status, phone_verified_at)
VALUES ('${IDS.introducer}', 'active', now() - INTERVAL '10 days'),
       ('${IDS.dater}', 'active', now() - INTERVAL '10 days'),
       ('${IDS.daterB}', 'active', now() - INTERVAL '10 days'),
       ('${IDS.daterC}', 'active', now() - INTERVAL '10 days'),
       ('${IDS.daterD}', 'active', now() - INTERVAL '10 days')
ON CONFLICT (id) DO NOTHING;

INSERT INTO pitch_drafts (id, created_by_user_id, subject_user_id, status, headline, body)
VALUES ('${IDS.draftA}', '${IDS.introducer}', '${IDS.dater}', 'published', 'E2E render A', 'Success path probe.'),
       ('${IDS.draftB}', '${IDS.introducer}', '${IDS.daterB}', 'published', 'E2E render B', 'Scene hash mismatch probe.'),
       ('${IDS.draftC}', '${IDS.introducer}', '${IDS.daterC}', 'published', 'E2E render C', 'Engine refusal probe.'),
       ('${IDS.draftD}', '${IDS.introducer}', '${IDS.daterD}', 'published', 'E2E render D', 'Highlight variant probe.');

INSERT INTO pitch_assets (id, pitch_draft_id, uploaded_by_user_id, asset_type, storage_path, sort_order)
VALUES ('${IDS.photo1}', '${IDS.draftA}', '${IDS.introducer}', 'photo', 'pitch-media/${IDS.draftA}/photo-0.jpg', 0),
       ('${IDS.photo2}', '${IDS.draftA}', '${IDS.introducer}', 'photo', 'pitch-media/${IDS.draftA}/photo-1.jpg', 1),
       ('${IDS.photo3}', '${IDS.draftD}', '${IDS.introducer}', 'photo', 'pitch-media/${IDS.draftD}/photo-0.jpg', 0),
       ('${IDS.photo4}', '${IDS.draftD}', '${IDS.introducer}', 'photo', 'pitch-media/${IDS.draftD}/photo-1.jpg', 1);

-- scene_hash is computed by the DATABASE over its own jsonb serialization,
-- exactly as 0048/0049 do at revision cut — the D1 comparison target.
INSERT INTO consent_revisions (
  id, pitch_draft_id, revision_number, headline, body, structure, asset_ids,
  voice_asset_path, content_hash, scene_definition, scene_hash, transcript
)
VALUES
  ('${IDS.revA}', '${IDS.draftA}', 1, 'E2E render A', 'Success path probe.',
   ${sqlLiteral(structureJson)}::jsonb,
   ARRAY['${IDS.photo1}', '${IDS.photo2}']::uuid[],
   'pitch-media/${IDS.draftA}/voice.m4a', 'e2e-render-content-a',
   ${sqlLiteral(sceneJson)}::jsonb,
   encode(digest((${sqlLiteral(sceneJson)}::jsonb)::text, 'sha256'), 'hex'),
   ${sqlLiteral(transcriptJson)}::jsonb),
  ('${IDS.revB}', '${IDS.draftB}', 1, 'E2E render B', 'Scene hash mismatch probe.',
   ${sqlLiteral(structureJson)}::jsonb, '{}',
   'pitch-media/${IDS.draftB}/voice.m4a', 'e2e-render-content-b',
   ${sqlLiteral(sceneJson)}::jsonb,
   encode(digest((${sqlLiteral(sceneJson)}::jsonb)::text, 'sha256'), 'hex'),
   ${sqlLiteral(transcriptJson)}::jsonb),
  ('${IDS.revC}', '${IDS.draftC}', 1, 'E2E render C', 'Engine refusal probe.',
   ${sqlLiteral(structureJson)}::jsonb, '{}',
   'pitch-media/${IDS.draftC}/voice.m4a', 'e2e-render-content-c',
   ${sqlLiteral(badSceneJson)}::jsonb,
   encode(digest((${sqlLiteral(badSceneJson)}::jsonb)::text, 'sha256'), 'hex'),
   ${sqlLiteral(transcriptJson)}::jsonb),
  ('${IDS.revD}', '${IDS.draftD}', 1, 'E2E render D', 'Highlight variant probe.',
   ${sqlLiteral(structureJson)}::jsonb,
   ARRAY['${IDS.photo3}', '${IDS.photo4}']::uuid[],
   'pitch-media/${IDS.draftD}/voice.m4a', 'e2e-render-content-d',
   ${sqlLiteral(highlightSceneJson)}::jsonb,
   encode(digest((${sqlLiteral(highlightSceneJson)}::jsonb)::text, 'sha256'), 'hex'),
   ${sqlLiteral(transcriptJson)}::jsonb);

-- validate_campaign_publication (0001) requires an approved, responded
-- consent request from the campaign owner before a campaign may publish.
INSERT INTO consent_requests (id, pitch_draft_id, subject_user_id, token_hash, status, responded_at, revision_id)
VALUES ('ee3a6000-0000-4000-8000-000000000001', '${IDS.draftA}', '${IDS.dater}', 'e2e-render-consent-a', 'approved', now() - INTERVAL '1 day', '${IDS.revA}'),
       ('ee3a6000-0000-4000-8000-000000000002', '${IDS.draftB}', '${IDS.daterB}', 'e2e-render-consent-b', 'approved', now() - INTERVAL '1 day', '${IDS.revB}'),
       ('ee3a6000-0000-4000-8000-000000000003', '${IDS.draftC}', '${IDS.daterC}', 'e2e-render-consent-c', 'approved', now() - INTERVAL '1 day', '${IDS.revC}'),
       ('ee3a6000-0000-4000-8000-000000000004', '${IDS.draftD}', '${IDS.daterD}', 'e2e-render-consent-d', 'approved', now() - INTERVAL '1 day', '${IDS.revD}');

INSERT INTO campaigns (id, pitch_draft_id, owner_user_id, status, published_at, slug, ends_at)
VALUES ('${IDS.campaignA}', '${IDS.draftA}', '${IDS.dater}', 'published', now(), 'e2e-render-a', now() + INTERVAL '30 days'),
       ('${IDS.campaignB}', '${IDS.draftB}', '${IDS.daterB}', 'published', now(), 'e2e-render-b', now() + INTERVAL '30 days'),
       ('${IDS.campaignC}', '${IDS.draftC}', '${IDS.daterC}', 'published', now(), 'e2e-render-c', now() + INTERVAL '30 days'),
       ('${IDS.campaignD}', '${IDS.draftD}', '${IDS.daterD}', 'published', now(), 'e2e-render-d', now() + INTERVAL '30 days');

-- The deferred owner constraint: a published campaign's owner must hold the
-- active DATER_OWNER membership.
INSERT INTO campaign_memberships (campaign_id, user_id, role)
VALUES ('${IDS.campaignA}', '${IDS.dater}', 'DATER_OWNER'),
       ('${IDS.campaignA}', '${IDS.introducer}', 'INTRODUCER'),
       ('${IDS.campaignB}', '${IDS.daterB}', 'DATER_OWNER'),
       ('${IDS.campaignB}', '${IDS.introducer}', 'INTRODUCER'),
       ('${IDS.campaignC}', '${IDS.daterC}', 'DATER_OWNER'),
       ('${IDS.campaignC}', '${IDS.introducer}', 'INTRODUCER'),
       ('${IDS.campaignD}', '${IDS.daterD}', 'DATER_OWNER'),
       ('${IDS.campaignD}', '${IDS.introducer}', 'INTRODUCER');

-- Jobs, FIFO-ordered A -> B -> C. A freezes the DB-computed hash (D1 match).
-- B freezes a WRONG hash (D1 mismatch). C freezes the correct hash of a scene
-- the engine refuses. B and C start at attempts=2 so their single worker
-- attempt is the terminal third one (evidence of the terminal path + alert).
-- variant is stated, never defaulted: 0063's column DEFAULT is 'highlight', so
-- a job seeded without it renders a CUT with a 3s end card and these duration
-- assertions become wrong for a reason that has nothing to do with the queue.
-- A, B and C are the legacy path; D below is the highlight one.
INSERT INTO media_render_jobs (id, revision_id, campaign_id, pitch_draft_id, scene_hash, attempts, created_at, variant, options)
SELECT 'ee3a4000-0000-4000-8000-000000000001', rev.id, '${IDS.campaignA}', rev.pitch_draft_id, rev.scene_hash, 0, now() - INTERVAL '3 minutes', 'full', '{}'::jsonb
  FROM consent_revisions rev WHERE rev.id = '${IDS.revA}';
INSERT INTO media_render_jobs (id, revision_id, campaign_id, pitch_draft_id, scene_hash, attempts, created_at, variant, options)
SELECT 'ee3a4000-0000-4000-8000-000000000002', rev.id, '${IDS.campaignB}', rev.pitch_draft_id, repeat('0', 64), 2, now() - INTERVAL '2 minutes', 'full', '{}'::jsonb
  FROM consent_revisions rev WHERE rev.id = '${IDS.revB}';
INSERT INTO media_render_jobs (id, revision_id, campaign_id, pitch_draft_id, scene_hash, attempts, created_at, variant, options)
SELECT 'ee3a4000-0000-4000-8000-000000000003', rev.id, '${IDS.campaignC}', rev.pitch_draft_id, rev.scene_hash, 2, now() - INTERVAL '1 minute', 'full', '{}'::jsonb
  FROM consent_revisions rev WHERE rev.id = '${IDS.revC}';
INSERT INTO media_render_jobs (id, revision_id, campaign_id, pitch_draft_id, scene_hash, attempts, created_at, variant, options)
SELECT 'ee3a4000-0000-4000-8000-000000000004', rev.id, '${IDS.campaignD}', rev.pitch_draft_id, rev.scene_hash, 0, now(), 'highlight', '{"music": true}'::jsonb
  FROM consent_revisions rev WHERE rev.id = '${IDS.revD}';
COMMIT;
`);

    // ── Real input media into local storage ──────────────────────────────
    const uploads: { objectName: string; bytes: Uint8Array; contentType: string }[] = [
      {
        objectName: `${IDS.draftA}/photo-0.jpg`,
        bytes: photoAsset(IDS.photo1, 0).bytes,
        contentType: 'image/jpeg',
      },
      {
        objectName: `${IDS.draftA}/photo-1.jpg`,
        bytes: photoAsset(IDS.photo2, 1).bytes,
        contentType: 'image/jpeg',
      },
      {
        objectName: `${IDS.draftA}/voice.m4a`,
        bytes: audioM4a(SCENE_DURATION_MS / 1000).bytes,
        contentType: 'audio/mp4',
      },
      // Campaign D: the same media under its own draft, for the highlight job.
      {
        objectName: `${IDS.draftD}/photo-0.jpg`,
        bytes: photoAsset(IDS.photo3, 0).bytes,
        contentType: 'image/jpeg',
      },
      {
        objectName: `${IDS.draftD}/photo-1.jpg`,
        bytes: photoAsset(IDS.photo4, 1).bytes,
        contentType: 'image/jpeg',
      },
      {
        objectName: `${IDS.draftD}/voice.m4a`,
        bytes: audioM4a(SCENE_DURATION_MS / 1000).bytes,
        contentType: 'audio/mp4',
      },
    ];
    for (const upload of uploads) {
      const { error } = await service.storage
        .from('pitch-media')
        .upload(upload.objectName, Buffer.from(upload.bytes), {
          contentType: upload.contentType,
          upsert: true,
        });
      if (error !== null) {
        throw new Error(`seed upload failed for ${upload.objectName}: ${error.message}`);
      }
    }

    // ── Drive the worker until the three seeded jobs are settled ─────────
    for (let pass = 0; pass < 5; pass += 1) {
      const response = await postRenderRun(`Bearer ${SECRET}`);
      expect(response.status).toBe(200);
      const summary: unknown = await response.json();
      passSummaries.push(summary);
      console.log(`[render-queue e2e] pass ${pass + 1}: ${JSON.stringify(summary)}`);
      const remaining = psql(
        `SELECT count(*) FROM media_render_jobs
          WHERE id IN ('${IDS.jobA}', '${IDS.jobB}', '${IDS.jobC}', '${IDS.jobD}')
            AND status IN ('queued', 'leased')`,
      );
      if (remaining === '0') {
        break;
      }
    }
  }, 600_000);

  it('completion 0 — the highlight job records what it rendered, and its duration matches', async () => {
    const row = psql(
      `SELECT status || '|' || coalesce(effective_variant, 'NULL') || '|' ||
              output_duration_ms || '|' || coalesce(cut_hash, 'NULL') || '|' ||
              coalesce(cut_plan::text, 'NULL')
         FROM media_render_jobs WHERE id = '${IDS.jobD}'`,
    );
    console.log(`[render-queue e2e] job D row: ${row}`);
    const [status, effectiveVariant, durationMs, cutHash] = row.split('|');
    expect(status).toBe('done');

    if (!HIGHLIGHT_ON) {
      // Rollout state: the flag is off, so the worker renders every job the
      // legacy way whatever the export card recorded on the row.
      expect(effectiveVariant).toBe('full');
      expect(Number(durationMs)).toBe(SCENE_DURATION_MS + END_CARD_MS);
      expect(cutHash).toBe('NULL');
      return;
    }

    // Flag on: the plan on the row must be the plan the CONTRACT produces for
    // this transcript — the worker may not invent a different cut — and the
    // duration must be that cut plus the longer end card.
    const plan = buildHighlightPlan({
      segments: TRANSCRIPT.segments,
      structure: FIXTURE_TEXT,
      daterDisplayName: 'A friend',
      shotBoundariesMs: successScene([IDS.photo3, IDS.photo4]).shots.map((shot) => shot.startMs),
    });
    expect(plan).not.toBeNull();
    expect(effectiveVariant).toBe('highlight');
    expect(cutHash).toBe(plan?.hash);
    // Frames round up per window, so the video is the cut plus the card, never
    // less (§2.2-6); one frame of slack at 30fps is 34ms.
    const expected = (plan?.totalMs ?? 0) + HIGHLIGHT_END_CARD_MS;
    expect(Number(durationMs)).toBeGreaterThanOrEqual(expected);
    expect(Number(durationMs)).toBeLessThanOrEqual(expected + 100);
  });

  it('completion 1 — the success job is done with the MP4 stored at the nested 0054 path', async () => {
    const row = psql(
      `SELECT status || '|' || output_storage_path || '|' || output_bytes || '|' || output_duration_ms
         FROM media_render_jobs WHERE id = '${IDS.jobA}'`,
    );
    console.log(`[render-queue e2e] job A row: ${row}`);
    const [status, storagePath, bytes, durationMs] = row.split('|');
    expect(status).toBe('done');
    expect(storagePath).toBe(`pitch-media/${IDS.draftA}/renders/${IDS.revA}.mp4`);
    expect(Number(bytes)).toBeGreaterThan(0);
    expect(Number(durationMs)).toBe(SCENE_DURATION_MS + END_CARD_MS);

    // The object really exists in storage, byte count matching the job row.
    const service = createServiceClient(API_URL, SERVICE_KEY);
    const { data, error } = await service.storage
      .from('pitch-media')
      .download(`${IDS.draftA}/renders/${IDS.revA}.mp4`);
    expect(error).toBeNull();
    const mp4 = Buffer.from(await (data as Blob).arrayBuffer());
    expect(mp4.byteLength).toBe(Number(bytes));

    // And it is a playable 1080x1920 h264+aac file of the approved timeline.
    mkdirSync(OUT_DIR, { recursive: true });
    const outFile = path.join(OUT_DIR, 'queue-e2e.mp4');
    writeFileSync(outFile, mp4);
    const probed = JSON.parse(
      execFileSync(ffprobeStatic.path, [
        '-v',
        'error',
        '-print_format',
        'json',
        '-show_streams',
        '-show_format',
        outFile,
      ]).toString('utf8'),
    ) as {
      streams: { codec_type: string; codec_name: string; width?: number; height?: number }[];
      format: { duration: string };
    };
    const video = probed.streams.find((stream) => stream.codec_type === 'video');
    const audio = probed.streams.find((stream) => stream.codec_type === 'audio');
    expect(video).toMatchObject({ codec_name: 'h264', width: 1080, height: 1920 });
    expect(audio).toMatchObject({ codec_name: 'aac' });
    expect(Number(probed.format.duration)).toBeGreaterThan(7.2);
    expect(Number(probed.format.duration)).toBeLessThan(7.8);
    console.log(
      `[render-queue e2e] MP4 at ${outFile} (${mp4.byteLength}B, ${probed.format.duration}s)`,
    );
  });

  it('success consumed the free render exactly once — at success, not enqueue', () => {
    const unlocks = psql(
      `SELECT count(*) FROM pitch_render_unlocks WHERE campaign_id = '${IDS.campaignA}'`,
    );
    expect(unlocks).toBe('1');
  });

  it('completion 3 (D1) — a frozen-hash mismatch is refused without rendering', () => {
    const row = psql(
      `SELECT status || '|' || last_error FROM media_render_jobs WHERE id = '${IDS.jobB}'`,
    );
    console.log(`[render-queue e2e] job B row: ${row}`);
    expect(row.split('|')[0]).toBe('failed');
    expect(row).toContain('scene hash mismatch');
    // No output object was ever created for the refused job.
    expect(
      psql(
        `SELECT count(*) FROM storage.objects
          WHERE bucket_id = 'pitch-media' AND name LIKE '${IDS.draftB}/renders/%'`,
      ),
    ).toBe('0');
  });

  it('completion 2 — failures consume NO free render and raise the terminal alert', () => {
    const cRow = psql(
      `SELECT status || '|' || last_error FROM media_render_jobs WHERE id = '${IDS.jobC}'`,
    );
    console.log(`[render-queue e2e] job C row: ${cRow}`);
    expect(cRow.split('|')[0]).toBe('failed');
    expect(cRow).toContain('schemaVersion 2 only');

    const unlockCounts = psql(
      `SELECT count(*) FROM pitch_render_unlocks
        WHERE campaign_id IN ('${IDS.campaignB}', '${IDS.campaignC}')`,
    );
    console.log(`[render-queue e2e] unlocks for failed campaigns B+C: ${unlockCounts} rows`);
    expect(unlockCounts).toBe('0');

    const alerts = psql(
      `SELECT count(*) FROM ops_alerts
        WHERE alert_type = 'pitch_render_failed'
          AND campaign_id IN ('${IDS.campaignB}', '${IDS.campaignC}')`,
    );
    expect(Number(alerts)).toBeGreaterThanOrEqual(2);
  });

  it('completion 4 (D5) — the route refuses public access', async () => {
    const noAuth = await postRenderRun();
    expect(noAuth.status).toBe(401);
    const wrongSecret = await postRenderRun('Bearer definitely-not-the-render-secret');
    expect(wrongSecret.status).toBe(401);
    console.log(
      `[render-queue e2e] D5: no-secret => ${noAuth.status}, wrong-secret => ${wrongSecret.status}`,
    );
  });
});
