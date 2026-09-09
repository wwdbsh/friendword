import { createHash } from 'node:crypto';

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
}): FakeWorld {
  const completions: FakeWorld['completions'] = [];
  const cutUpdates: FakeWorld['cutUpdates'] = [];
  const uploads: FakeWorld['uploads'] = [];
  const downloads: string[] = [];
  let claimed = false;

  const scene = qaScene();
  const revisionRow = {
    id: REVISION_ID,
    pitch_draft_id: DRAFT_ID,
    voice_asset_path: `pitch-media/${DRAFT_ID}/voice.m4a`,
    structure: input.structure ?? null,
    transcript: input.transcript ?? null,
    scene_canonical: input.sceneCanonical,
  };
  const assetRows = scene.assetIds.map((assetId, index) => ({
    id: assetId,
    storage_path: `pitch-media/${DRAFT_ID}/photo-${index}.jpg`,
    asset_type: 'photo',
  }));

  function tableResult(table: string): unknown {
    if (table === 'consent_revisions') {
      return revisionRow;
    }
    if (table === 'campaigns') {
      return { slug: 'unit-fixture', owner_user_id: OWNER_ID };
    }
    if (table === 'pitch_assets') {
      return assetRows;
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
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      in: () => builder,
      update: (values: Record<string, unknown>) => {
        cutUpdates.push(values);
        updating = true;
        return builder;
      },
      maybeSingle: () => Promise.resolve({ data: tableResult(table), error: null }),
      then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
        Promise.resolve({
          data: updating
            ? input.leaseLapsed === true
              ? []
              : [{ id: JOB_ID }]
            : tableResult(table),
          error: null,
        }).then(onF, onR),
    };
    return builder;
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
          const bytes = objectName.endsWith('voice.m4a')
            ? input.voiceBytes
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
