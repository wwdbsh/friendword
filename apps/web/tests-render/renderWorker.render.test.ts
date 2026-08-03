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
}): FakeWorld {
  const completions: FakeWorld['completions'] = [];
  const uploads: FakeWorld['uploads'] = [];
  const downloads: string[] = [];
  let claimed = false;

  const scene = qaScene();
  const revisionRow = {
    id: REVISION_ID,
    pitch_draft_id: DRAFT_ID,
    voice_asset_path: `pitch-media/${DRAFT_ID}/voice.m4a`,
    structure: null,
    transcript: null,
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
      return { slug: 'unit-fixture' };
    }
    if (table === 'pitch_assets') {
      return assetRows;
    }
    return null;
  }

  function makeBuilder(table: string): Record<string, unknown> {
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      maybeSingle: () => Promise.resolve({ data: tableResult(table), error: null }),
      then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
        Promise.resolve({ data: tableResult(table), error: null }).then(onF, onR),
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

  return { client, completions, uploads, downloads };
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
