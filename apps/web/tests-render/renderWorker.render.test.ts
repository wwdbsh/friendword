import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import ffmpegPath from 'ffmpeg-static';
import { describe, expect, it } from 'vitest';

import type { ClaimedRenderJob, ServiceSupabaseClient } from '@friendword/data';

import {
  runRenderPass,
  sceneHashOfCanonicalText,
  type RenderPassOptions,
} from '@/lib/pitchRender/jobRunner';
import type { renderScene } from '@/lib/pitchRender/renderScene';

import { qaScene } from './fixtures';

// The render worker's queue loop against a scripted service client: claim →
// hash re-verification (D1) → storage inputs (D2) → engine → nested output
// path (D3) → honest completion (D4), without a browser or a database. The
// real wiring is exercised by the gated renderQueue e2e; these pin the
// contract decisions that must survive refactors.

const JOB_ID = '11111111-1111-4111-8111-111111111111';
const LEASE_TOKEN = '22222222-2222-4222-8222-222222222222';
const CAMPAIGN_ID = '33333333-3333-4333-8333-333333333333';
const DRAFT_ID = '44444444-4444-4444-8444-444444444444';
const REVISION_ID = '55555555-5555-4555-8555-555555555555';
const OWNER_ID = '66666666-6666-4666-8666-666666666666';
const INTRODUCER_ID = '77777777-7777-4777-8777-777777777777';

/**
 * The canonical text the DB would hand over via scene_definition::text. The
 * inserted space after the first colon keeps it VALID json that parses to the
 * identical document while guaranteeing JSON.stringify(JSON.parse(text))
 * differs — so a worker that re-serializes before hashing cannot pass D1.
 */
function canonicalSceneText(): string {
  const compact = JSON.stringify(qaScene());
  const spaced = compact.replace('{"schemaVersion":2', '{"schemaVersion": 2');
  if (spaced === compact || JSON.stringify(JSON.parse(spaced)) === spaced) {
    throw new Error('fixture no longer proves the re-serialization trap');
  }
  return spaced;
}

type FakeWorld = {
  readonly client: ServiceSupabaseClient;
  readonly completions: { jobId: string; leaseToken: string; params: Record<string, unknown> }[];
  /** Direct writes to media_render_jobs — the 0063 cut record (§2.1 note 5). */
  readonly cutUpdates: Record<string, unknown>[];
  readonly uploads: {
    objectName: string;
    contentType: string | undefined;
    upsert: boolean | undefined;
  }[];
  readonly downloads: string[];
};

function makeFakeClient(input: {
  readonly job: ClaimedRenderJob;
  readonly sceneCanonical: string | null;
  readonly voiceBytes: Uint8Array;
  readonly uploadError?: boolean;
  /** What request_pitch_render recorded on the job row (0063). */
  readonly variant?: 'full' | 'highlight';
  readonly music?: boolean;
  /** A transcript with enough sentences for a cut plan, when a test needs one. */
  readonly transcript?: unknown;
  readonly structure?: unknown;
  /** The cut-record UPDATE matches no row: another worker owns the job. */
  readonly leaseLapsed?: boolean;
  /**
   * §2.2-4: a clip the Dater ticked, carried in the approved snapshot and
   * labelled `asset_role='selfie'` (0063). Absent means "no selfie", which is
   * the pre-T004 render.
   */
  readonly selfie?: {
    readonly ingestStatus: string;
    readonly proxyPath: string | null;
    /** The bytes storage hands back for that proxy — a real, decodable clip. */
    readonly proxyBytes?: Uint8Array;
    /** Storage refuses the proxy download entirely. */
    readonly downloadFails?: boolean;
    /** False = the clip exists on the draft but the Dater never ticked it. */
    readonly inSnapshot?: boolean;
    /** `pitch_assets.asset_role` (0063). Null is an ordinary clip, not an opening. */
    readonly role?: 'selfie' | null;
  };
}): FakeWorld {
  const completions: FakeWorld['completions'] = [];
  const cutUpdates: FakeWorld['cutUpdates'] = [];
  const uploads: FakeWorld['uploads'] = [];
  const downloads: string[] = [];
  let claimed = false;

  const scene = qaScene();
  const SELFIE_ASSET_ID = '77777777-7777-4777-8777-777777777777';
  const revisionRow = {
    id: REVISION_ID,
    pitch_draft_id: DRAFT_ID,
    // The APPROVED snapshot: the scene's photos, plus the selfie clip when the
    // Dater ticked one.
    asset_ids: [
      ...scene.assetIds,
      ...(input.selfie !== undefined && input.selfie.inSnapshot !== false ? [SELFIE_ASSET_ID] : []),
    ],
    voice_asset_path: `pitch-media/${DRAFT_ID}/voice.m4a`,
    structure: input.structure ?? null,
    transcript: input.transcript ?? null,
    scene_canonical: input.sceneCanonical,
  };
  const assetRows: Record<string, unknown>[] = scene.assetIds.map((assetId, index) => ({
    id: assetId,
    storage_path: `pitch-media/${DRAFT_ID}/photo-${index}.jpg`,
    asset_type: 'photo',
    sort_order: index,
    asset_role: null,
  }));
  if (input.selfie !== undefined) {
    assetRows.push({
      id: SELFIE_ASSET_ID,
      storage_path: `pitch-media/${DRAFT_ID}/selfie.mp4`,
      asset_type: 'video',
      sort_order: 99,
      asset_role: input.selfie.role === undefined ? 'selfie' : input.selfie.role,
    });
  }

  function tableResult(
    table: string,
    filters: Record<string, unknown>,
    inFilters: Record<string, readonly unknown[]>,
  ): unknown {
    if (table === 'consent_revisions') {
      return revisionRow;
    }
    if (table === 'pitch_video_ingests') {
      // Service-role only (0050). A row exists here only for a SUCCEEDED
      // ingest with a proxy — every other state answers "no opening".
      if (input.selfie === undefined || input.selfie.proxyPath === null) {
        return null;
      }
      // The DB applies the worker's filters, not the fixture's opinion: drop
      // the `ingest_status` filter from the query and a flagged clip really
      // does come back here.
      if (
        filters.ingest_status !== undefined &&
        filters.ingest_status !== input.selfie.ingestStatus
      ) {
        return null;
      }
      return { proxy_path: input.selfie.proxyPath };
    }
    if (table === 'campaigns') {
      return { slug: 'unit-fixture', owner_user_id: OWNER_ID };
    }
    if (table === 'pitch_assets') {
      // The worker asks two different questions of this table; the fake honours
      // the filters rather than handing both the same rows.
      return assetRows.filter(
        (row) =>
          Object.entries(filters).every(([column, value]) =>
            column === 'pitch_draft_id' ? true : row[column] === value,
          ) && Object.entries(inFilters).every(([column, values]) => values.includes(row[column])),
      );
    }
    if (table === 'media_render_jobs') {
      return {
        variant: input.variant ?? 'full',
        options: input.music === true ? { music: true } : {},
      };
    }
    if (table === 'pitch_drafts') {
      return {
        created_by_user_id: INTRODUCER_ID,
        relationship_type: 'friend',
        relationship_duration: 'y3to10',
      };
    }
    if (table === 'profiles') {
      return [
        { user_id: OWNER_ID, display_name: 'Blair', display_name_confirmed: true },
        { user_id: INTRODUCER_ID, display_name: 'Maya', display_name_confirmed: true },
      ];
    }
    return null;
  }

  function makeBuilder(table: string): Record<string, unknown> {
    // An UPDATE ... RETURNING reports the rows it matched; the worker refuses
    // to continue when that is empty (a lapsed lease).
    let updating = false;
    const filters: Record<string, unknown> = {};
    const inFilters: Record<string, readonly unknown[]> = {};
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: (column: string, value: unknown) => {
        filters[column] = value;
        return builder;
      },
      in: (column: string, values: readonly unknown[]) => {
        inFilters[column] = [...values];
        return builder;
      },
      order: () => builder,
      update: (values: Record<string, unknown>) => {
        cutUpdates.push(values);
        updating = true;
        return builder;
      },
      maybeSingle: () =>
        Promise.resolve({ data: firstRow(tableResult(table, filters, inFilters)), error: null }),
      then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
        Promise.resolve({
          data: updating
            ? input.leaseLapsed === true
              ? []
              : [{ id: JOB_ID }]
            : tableResult(table, filters, inFilters),
          error: null,
        }).then(onF, onR),
    };
    return builder;
  }

  /** `maybeSingle()` returns a row, never the list a select would resolve to. */
  function firstRow(result: unknown): unknown {
    return Array.isArray(result) ? (result[0] ?? null) : result;
  }

  const client = {
    rpc: (name: string, params: Record<string, unknown>) => {
      if (name === 'claim_media_render_job') {
        if (claimed) {
          return Promise.resolve({ data: [], error: null });
        }
        claimed = true;
        return Promise.resolve({
          data: [
            {
              job_id: input.job.jobId,
              lease_token: input.job.leaseToken,
              campaign_id: input.job.campaignId,
              pitch_draft_id: input.job.pitchDraftId,
              revision_id: input.job.revisionId,
              scene_hash: input.job.sceneHash,
              attempts: input.job.attempts,
              lease_expires_at: input.job.leaseExpiresAt,
            },
          ],
          error: null,
        });
      }
      if (name === 'complete_media_render_job') {
        completions.push({
          jobId: String(params.job_id),
          leaseToken: String(params.lease_token),
          params,
        });
        return Promise.resolve({ data: null, error: null });
      }
      return Promise.resolve({ data: null, error: { message: `unexpected rpc ${name}` } });
    },
    from: (table: string) => makeBuilder(table),
    storage: {
      from: () => ({
        download: (objectName: string) => {
          downloads.push(objectName);
          if (input.selfie?.downloadFails === true && objectName.endsWith('selfie-proxy.mp4')) {
            return Promise.resolve({ data: null, error: { message: 'proxy is gone' } });
          }
          const bytes = objectName.endsWith('voice.m4a')
            ? input.voiceBytes
            : objectName.endsWith('selfie-proxy.mp4') && input.selfie?.proxyBytes !== undefined
              ? input.selfie.proxyBytes
              : new TextEncoder().encode(objectName);
          return Promise.resolve({ data: new Blob([Buffer.from(bytes)]), error: null });
        },
        upload: (objectName: string, _body: unknown, opts: Record<string, unknown>) => {
          uploads.push({
            objectName,
            contentType: opts.contentType as string | undefined,
            upsert: opts.upsert as boolean | undefined,
          });
          return Promise.resolve({
            data: null,
            error: input.uploadError === true ? { message: 'upload refused' } : null,
          });
        },
      }),
    },
  } as unknown as ServiceSupabaseClient;

  return { client, completions, uploads, downloads, cutUpdates };
}

function job(overrides: Partial<ClaimedRenderJob> = {}): ClaimedRenderJob {
  return {
    jobId: JOB_ID,
    leaseToken: LEASE_TOKEN,
    campaignId: CAMPAIGN_ID,
    pitchDraftId: DRAFT_ID,
    revisionId: REVISION_ID,
    sceneHash: sceneHashOfCanonicalText(canonicalSceneText()),
    attempts: 1,
    leaseExpiresAt: new Date(Date.now() + 900_000).toISOString(),
    ...overrides,
  };
}

const MP4_BYTES = new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]);

function fakeRender(calls: { args: Parameters<typeof renderScene> }[]): typeof renderScene {
  return async (...args: Parameters<typeof renderScene>) => {
    calls.push({ args });
    return {
      mp4: MP4_BYTES,
      stats: {
        openingFrames: 0,
        sceneFrames: 450,
        endCardFrames: 45,
        fps: 30,
        // The engine reports what it ACTUALLY rendered; the worker copies that
        // to the job row rather than echoing what was requested (§2.2-1).
        variant: args[2].variant ?? 'full',
        effectiveVariant:
          args[2].variant === 'highlight' && (args[2].cutWindows?.length ?? 0) > 0
            ? 'highlight'
            : 'full',
        cutTotalMs: 24_000,
        audioDurationMs: 24_000,
        endCardMs: 1_500,
        captureMs: 10,
        encodeTailMs: 5,
        totalMs: 20,
        bytesPiped: 100,
        outputBytes: MP4_BYTES.byteLength,
        outputPath: '/tmp/unit.mp4',
      },
    };
  };
}

function passOptions(render: typeof renderScene): RenderPassOptions {
  return {
    baseUrl: 'http://127.0.0.1:3120',
    shareOrigin: 'https://friendword-unit.example',
    render,
  };
}

describe('runRenderPass — contract pins', () => {
  it('renders, uploads to the nested 0054 path and completes with the full output (D1-match/D2/D3)', async () => {
    const canonical = canonicalSceneText();
    const voiceBytes = new Uint8Array([9, 9, 9, 1, 2, 3]);
    const world = makeFakeClient({ job: job(), sceneCanonical: canonical, voiceBytes });
    const renders: { args: Parameters<typeof renderScene> }[] = [];

    const summary = await runRenderPass(world.client, passOptions(fakeRender(renders)));

    expect(summary.processed).toBe(1);
    expect(summary.jobs[0]).toMatchObject({
      outcome: 'succeeded',
      outputStoragePath: `pitch-media/${DRAFT_ID}/renders/${REVISION_ID}.mp4`,
    });

    // D1: the hash matched over the DB's canonical text even though a JS
    // round-trip would have changed the bytes (canonicalSceneText proves it).
    expect(renders).toHaveLength(1);

    // D2: the engine received the Introducer's voice bytes untouched.
    const renderCall = renders[0];
    if (renderCall === undefined) {
      throw new Error('render was not invoked');
    }
    const [, assets, options] = renderCall.args;
    expect(assets.audio).not.toBeNull();
    expect(
      Buffer.from(assets.audio?.bytes ?? new Uint8Array()).equals(Buffer.from(voiceBytes)),
    ).toBe(true);
    expect(assets.audio?.mimeType).toBe('audio/mp4');
    expect(assets.photos.map((photo) => photo.assetId)).toEqual([...qaScene().assetIds]);
    expect(options.renderKey).toBe(REVISION_ID);
    expect(options.campaignSlug).toBe('unit-fixture');

    // D3: nested renders/ prefix, video/mp4, deterministic overwrite allowed.
    expect(world.uploads).toEqual([
      {
        objectName: `${DRAFT_ID}/renders/${REVISION_ID}.mp4`,
        contentType: 'video/mp4',
        upsert: true,
      },
    ]);

    // Success completion carries the complete output — bytes and timeline.
    expect(world.completions).toHaveLength(1);
    expect(world.completions[0]?.params).toMatchObject({
      outcome: 'succeeded',
      output_storage_path: `pitch-media/${DRAFT_ID}/renders/${REVISION_ID}.mp4`,
      output_bytes: MP4_BYTES.byteLength,
      output_duration_ms: 16_500,
    });
  });

  it('D1: a scene hash mismatch is refused before any render or upload', async () => {
    const world = makeFakeClient({
      job: job({ sceneHash: 'f'.repeat(64) }),
      sceneCanonical: canonicalSceneText(),
      voiceBytes: new Uint8Array([1]),
    });
    const renders: { args: Parameters<typeof renderScene> }[] = [];

    const summary = await runRenderPass(world.client, passOptions(fakeRender(renders)));

    expect(renders).toHaveLength(0);
    expect(world.uploads).toHaveLength(0);
    expect(world.downloads).toHaveLength(0);
    expect(summary.jobs[0]?.outcome).toBe('failed');
    expect(world.completions[0]?.params).toMatchObject({ outcome: 'failed' });
    expect(String(world.completions[0]?.params.reason)).toContain('scene hash mismatch');
  });

  it('D1: the hash covers the DB text verbatim, never a JS re-serialization', () => {
    const canonical = canonicalSceneText();
    expect(sceneHashOfCanonicalText(canonical)).toBe(
      createHash('sha256').update(canonical, 'utf8').digest('hex'),
    );
    expect(sceneHashOfCanonicalText(JSON.stringify(JSON.parse(canonical)))).not.toBe(
      sceneHashOfCanonicalText(canonical),
    );
  });

  it('D4: an engine crash is reported as failed with the reason, and nothing is uploaded', async () => {
    const world = makeFakeClient({
      job: job(),
      sceneCanonical: canonicalSceneText(),
      voiceBytes: new Uint8Array([1]),
    });
    const crashingRender: typeof renderScene = async () => {
      throw new Error('ffmpeg exited with code 1');
    };

    const summary = await runRenderPass(world.client, passOptions(crashingRender));

    expect(summary.jobs[0]?.outcome).toBe('failed');
    expect(world.uploads).toHaveLength(0);
    expect(world.completions[0]?.params).toMatchObject({ outcome: 'failed' });
    expect(String(world.completions[0]?.params.reason)).toContain('ffmpeg exited with code 1');
  });

  it('D4: a failed upload is never reported as success', async () => {
    const world = makeFakeClient({
      job: job(),
      sceneCanonical: canonicalSceneText(),
      voiceBytes: new Uint8Array([1]),
      uploadError: true,
    });
    const renders: { args: Parameters<typeof renderScene> }[] = [];

    const summary = await runRenderPass(world.client, passOptions(fakeRender(renders)));

    expect(renders).toHaveLength(1);
    expect(summary.jobs[0]?.outcome).toBe('failed');
    expect(world.completions).toHaveLength(1);
    expect(world.completions[0]?.params).toMatchObject({ outcome: 'failed' });
  });

  it('D6: a lease too close to expiry refuses to start instead of rendering past it', async () => {
    const world = makeFakeClient({
      job: job({ leaseExpiresAt: new Date(Date.now() + 20_000).toISOString() }),
      sceneCanonical: canonicalSceneText(),
      voiceBytes: new Uint8Array([1]),
    });
    const renders: { args: Parameters<typeof renderScene> }[] = [];

    const summary = await runRenderPass(world.client, passOptions(fakeRender(renders)));

    expect(renders).toHaveLength(0);
    expect(world.uploads).toHaveLength(0);
    expect(summary.jobs[0]?.outcome).toBe('failed');
    expect(String(world.completions[0]?.params.reason)).toContain('not enough time left');
  });

  it('a revision without a motion scene fails honestly', async () => {
    const world = makeFakeClient({
      job: job(),
      sceneCanonical: null,
      voiceBytes: new Uint8Array([1]),
    });
    const renders: { args: Parameters<typeof renderScene> }[] = [];

    const summary = await runRenderPass(world.client, passOptions(fakeRender(renders)));

    expect(renders).toHaveLength(0);
    expect(summary.jobs[0]?.outcome).toBe('failed');
    expect(String(world.completions[0]?.params.reason)).toContain('no motion scene');
  });
});

// ── §2.1/§2.2: the variant, the cut plan and the record of what was rendered ──

/** A 60s transcript with twelve sentences and word timings — enough for a cut. */
function richTranscript(): unknown {
  const segments = Array.from({ length: 12 }, (_unused, index) => ({
    start: index * 5,
    end: (index + 1) * 5,
    text:
      index === 2
        ? 'Blair drove four hours for a birthday dinner and never mentioned it.'
        : `Sentence ${index} about someone worth knowing, said plainly and warmly.`,
  }));
  const words = segments.flatMap((segment, segmentIndex) =>
    segment.text.split(' ').map((word, wordIndex) => ({
      word,
      start: segment.start + wordIndex * 0.3,
      end: segment.start + wordIndex * 0.3 + 0.25,
      // The indexer numbers words from their position in provider order.
      segmentIndex,
    })),
  );
  return { segments, words };
}

const RICH_STRUCTURE = {
  hook: 'The friend who never cancels',
  relationship_context: 'Roommates for three years',
  three_specific_qualities: ['Loyal', 'Curious', 'Funny'],
  evidence_or_anecdote: 'Blair drove four hours for a birthday dinner',
  good_match_for: 'Someone who loves slow mornings',
};

async function withEnvValue<T>(value: string | undefined, run: () => Promise<T>): Promise<T> {
  const saved = process.env.RENDER_HIGHLIGHT_ENABLED;
  if (value === undefined) {
    delete process.env.RENDER_HIGHLIGHT_ENABLED;
  } else {
    process.env.RENDER_HIGHLIGHT_ENABLED = value;
  }
  try {
    return await run();
  } finally {
    if (saved === undefined) {
      delete process.env.RENDER_HIGHLIGHT_ENABLED;
    } else {
      process.env.RENDER_HIGHLIGHT_ENABLED = saved;
    }
  }
}

function withEnv(value: string | undefined, run: () => Promise<void>): Promise<void> {
  const saved = process.env.RENDER_HIGHLIGHT_ENABLED;
  if (value === undefined) {
    delete process.env.RENDER_HIGHLIGHT_ENABLED;
  } else {
    process.env.RENDER_HIGHLIGHT_ENABLED = value;
  }
  return run().finally(() => {
    if (saved === undefined) {
      delete process.env.RENDER_HIGHLIGHT_ENABLED;
    } else {
      process.env.RENDER_HIGHLIGHT_ENABLED = saved;
    }
  });
}

describe('the render variant, end to end through the worker', () => {
  it('cuts a highlight from the frozen transcript and records the plan', async () => {
    const world = makeFakeClient({
      job: job(),
      sceneCanonical: canonicalSceneText(),
      voiceBytes: new Uint8Array([1]),
      variant: 'highlight',
      music: true,
      transcript: richTranscript(),
      structure: RICH_STRUCTURE,
    });
    const renders: { args: Parameters<typeof renderScene> }[] = [];

    await withEnv('true', async () => {
      await runRenderPass(world.client, passOptions(fakeRender(renders)));
    });

    const options = renders[0]?.args[2];
    expect(options?.variant).toBe('highlight');
    expect(options?.music).toBe(true);
    // §1: whole sentences, in order, 15-30s of them.
    const windows = options?.cutWindows ?? [];
    expect(windows.length).toBeGreaterThan(0);
    const total = windows.reduce((sum, w) => sum + (w.endMs - w.startMs), 0);
    expect(total).toBeGreaterThanOrEqual(15_000);
    expect(total).toBeLessThanOrEqual(30_000);
    // §2.3: the stage names both people through publicDisplayName.
    expect(options?.overlayStage).toEqual({
      introducerLabel: 'MAYA INTRODUCES',
      daterName: 'Blair',
      relationshipChip: 'Friends for 3–10 years',
    });
    // §2.4: word captions, from the single transcript word index.
    expect((options?.timedWords ?? []).length).toBeGreaterThan(0);
    // §2.6: the cut identifies the bed.
    expect(options?.musicSeed).toMatch(/^[0-9a-f]{64}$/);

    // §2.1 note 5: the job row records what was actually rendered.
    expect(world.cutUpdates).toHaveLength(1);
    expect(world.cutUpdates[0]?.effective_variant).toBe('highlight');
    expect(world.cutUpdates[0]?.cut_hash).toBe(options?.musicSeed);
    expect(world.cutUpdates[0]?.cut_plan).toMatchObject({ version: 1 });
  });

  it('falls back to full — and says so — when the transcript cannot be cut', async () => {
    const world = makeFakeClient({
      job: job(),
      sceneCanonical: canonicalSceneText(),
      voiceBytes: new Uint8Array([1]),
      variant: 'highlight',
      transcript: { segments: [{ start: 0, end: 5, text: 'One sentence only.' }] },
    });
    const renders: { args: Parameters<typeof renderScene> }[] = [];

    await withEnv('true', async () => {
      await runRenderPass(world.client, passOptions(fakeRender(renders)));
    });

    expect(renders[0]?.args[2].cutWindows).toBeNull();
    expect(world.cutUpdates[0]).toEqual({
      effective_variant: 'full',
      cut_plan: null,
      cut_hash: null,
    });
  });

  it('fails the job rather than leaving the cut record unwritten', async () => {
    // A lapsed lease means another worker owns this job; reporting success
    // would publish an MP4 whose effective_variant says nothing was recorded.
    const world = makeFakeClient({
      job: job(),
      sceneCanonical: canonicalSceneText(),
      voiceBytes: new Uint8Array([1]),
      variant: 'highlight',
      transcript: richTranscript(),
      structure: RICH_STRUCTURE,
      leaseLapsed: true,
    });
    const renders: { args: Parameters<typeof renderScene> }[] = [];

    const summary = await withEnvValue('true', () =>
      runRenderPass(world.client, passOptions(fakeRender(renders))),
    );

    expect(summary.jobs[0]?.outcome).toBe('failed');
    expect(String(world.completions[0]?.params.reason)).toContain('lease no longer holds');
  });

  it('§0 rollback: the flag is OFF unless it says true, and off is the old way', async () => {
    const world = makeFakeClient({
      job: job(),
      sceneCanonical: canonicalSceneText(),
      voiceBytes: new Uint8Array([1]),
      // The export card recorded a highlight WITH music; the flag overrules it.
      variant: 'highlight',
      music: true,
      transcript: richTranscript(),
      structure: RICH_STRUCTURE,
    });
    const renders: { args: Parameters<typeof renderScene> }[] = [];

    // Unset is off — the rollout state until T005 ships the export card — and
    // so is any value that is not exactly 'true'/'1'. Each pass needs its own
    // world: the fake queue hands out its one job exactly once.
    for (const value of [undefined, 'false', 'yes'] as const) {
      const attempt = makeFakeClient({
        job: job(),
        sceneCanonical: canonicalSceneText(),
        voiceBytes: new Uint8Array([1]),
        variant: 'highlight',
        music: true,
        transcript: richTranscript(),
        structure: RICH_STRUCTURE,
      });
      const attemptRenders: { args: Parameters<typeof renderScene> }[] = [];
      await withEnv(value, async () => {
        await runRenderPass(attempt.client, passOptions(fakeRender(attemptRenders)));
      });
      expect(attemptRenders[0]?.args[2].variant).toBe('full');
      expect(attemptRenders[0]?.args[2].music).toBe(false);
    }

    await withEnv('false', async () => {
      await runRenderPass(world.client, passOptions(fakeRender(renders)));
    });

    const options = renders[0]?.args[2];
    expect(options?.variant).toBe('full');
    expect(options?.music).toBe(false);
    expect(options?.cutWindows).toBeNull();
    // No overlay: the capture page then renders exactly the tree it always did.
    expect(options?.overlayStage).toBeNull();
    expect(world.cutUpdates[0]?.effective_variant).toBe('full');
  });
});

/**
 * §2.2-4 — the selfie opening, gate by gate.
 *
 * The opening exists only when FOUR independent decisions all say yes, and the
 * whole point of the design is that three of them are somebody's decision
 * rather than a heuristic: the rollback flag, the highlight the render will
 * actually be, the Dater's tick (the asset id being in the approved snapshot),
 * and the ingest's own SUCCEEDED verdict. Each test below removes exactly one.
 */
describe('the selfie opening', () => {
  const ffmpeg = ffmpegPath;
  if (ffmpeg === null) {
    it.skip('needs ffmpeg-static', () => undefined);
    return;
  }
  const work = path.join(os.tmpdir(), 'friendword-worker-selfie-test');
  mkdirSync(work, { recursive: true });
  const clipPath = path.join(work, 'selfie.mp4');
  execFileSync(ffmpeg, [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'testsrc=size=180x320:rate=30:duration=1',
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-pix_fmt',
    'yuv420p',
    clipPath,
  ]);
  const proxyBytes = new Uint8Array(readFileSync(clipPath));

  function selfieWorld(
    selfie:
      | {
          readonly ingestStatus: string;
          readonly proxyPath: string | null;
          readonly inSnapshot?: boolean;
          readonly role?: 'selfie' | null;
          readonly downloadFails?: boolean;
        }
      | undefined,
    variant: 'full' | 'highlight' = 'highlight',
  ): ReturnType<typeof makeFakeClient> {
    return makeFakeClient({
      job: job(),
      sceneCanonical: canonicalSceneText(),
      voiceBytes: new Uint8Array([1]),
      variant,
      transcript: richTranscript(),
      structure: RICH_STRUCTURE,
      ...(selfie === undefined ? {} : { selfie: { ...selfie, proxyBytes } }),
    });
  }

  async function openingFramesFor(
    world: ReturnType<typeof makeFakeClient>,
    flag: string | undefined = 'true',
  ): Promise<readonly Uint8Array[]> {
    const renders: { args: Parameters<typeof renderScene> }[] = [];
    await withEnv(flag, async () => {
      await runRenderPass(world.client, passOptions(fakeRender(renders)));
    });
    return renders[0]?.args[2].openingFrames ?? [];
  }

  it('extracts the opening for an approved, succeeded selfie clip', async () => {
    const frames = await openingFramesFor(
      selfieWorld({
        ingestStatus: 'succeeded',
        proxyPath: `pitch-media/${DRAFT_ID}/selfie-proxy.mp4`,
      }),
    );
    expect(frames.length).toBeGreaterThan(0);
    // The stills are PNG at the output frame size — the base layer the chrome
    // is composited onto, never the raw clip.
    expect([...(frames[0] ?? []).slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(Buffer.from(frames[0] ?? new Uint8Array()).readUInt32BE(16)).toBe(1080);
  });

  it("renders exactly today's file when the pitch has no selfie at all", async () => {
    expect(await openingFramesFor(selfieWorld(undefined))).toEqual([]);
  });

  it('refuses a clip whose ingest did not succeed', async () => {
    for (const ingestStatus of ['pending', 'processing', 'flagged', 'failed']) {
      expect(
        await openingFramesFor(
          selfieWorld({
            ingestStatus,
            proxyPath: `pitch-media/${DRAFT_ID}/selfie-proxy.mp4`,
          }),
        ),
      ).toEqual([]);
    }
  });

  it('opens on a SELFIE only — an ordinary clip is not the opening', async () => {
    // §2.2-4 reads the role, never "the first video on the draft". A clip of
    // someone else, approved and processed, is still not the friend's hello.
    expect(
      await openingFramesFor(
        selfieWorld({
          ingestStatus: 'succeeded',
          proxyPath: `pitch-media/${DRAFT_ID}/selfie-proxy.mp4`,
          role: null,
        }),
      ),
    ).toEqual([]);
  });

  it('refuses a clip the Dater never ticked, however healthy it is', async () => {
    // §0 verdict 4a: the ONLY way in is the approved snapshot. The asset is on
    // the draft and its ingest succeeded — and it still does not render.
    expect(
      await openingFramesFor(
        selfieWorld({
          ingestStatus: 'succeeded',
          proxyPath: `pitch-media/${DRAFT_ID}/selfie-proxy.mp4`,
          inSnapshot: false,
        }),
      ),
    ).toEqual([]);
  });

  // B3: the opening is a decoration on a derivative. Losing it must never cost
  // the Dater the MP4 their approval paid for — so a broken proxy renders the
  // pitch WITHOUT the opening rather than failing the job.
  it('renders without the opening when the proxy cannot be fetched', async () => {
    const world = selfieWorld({
      ingestStatus: 'succeeded',
      proxyPath: `pitch-media/${DRAFT_ID}/selfie-proxy.mp4`,
      downloadFails: true,
    });
    expect(await openingFramesFor(world)).toEqual([]);
    // The job still SUCCEEDED — that is the whole point.
    expect(world.completions).toHaveLength(1);
    expect(world.completions[0]?.params.outcome).toBe('succeeded');
  });

  it('renders without the opening when the proxy will not decode', async () => {
    const world = makeFakeClient({
      job: job(),
      sceneCanonical: canonicalSceneText(),
      voiceBytes: new Uint8Array([1]),
      variant: 'highlight',
      transcript: richTranscript(),
      structure: RICH_STRUCTURE,
      selfie: {
        ingestStatus: 'succeeded',
        proxyPath: `pitch-media/${DRAFT_ID}/selfie-proxy.mp4`,
        // Not a video at all: ffmpeg refuses it.
        proxyBytes: new TextEncoder().encode('this is not an mp4'),
      },
    });
    expect(await openingFramesFor(world)).toEqual([]);
    expect(world.completions[0]?.params.outcome).toBe('succeeded');
  });

  it('refuses a succeeded ingest that carries no proxy', async () => {
    expect(
      await openingFramesFor(selfieWorld({ ingestStatus: 'succeeded', proxyPath: null })),
    ).toEqual([]);
  });

  it('draws no opening on the full variant, or with the flag off', async () => {
    const succeeded = {
      ingestStatus: 'succeeded',
      proxyPath: `pitch-media/${DRAFT_ID}/selfie-proxy.mp4`,
    };
    expect(await openingFramesFor(selfieWorld(succeeded, 'full'))).toEqual([]);
    expect(await openingFramesFor(selfieWorld(succeeded), 'false')).toEqual([]);
  });
});
