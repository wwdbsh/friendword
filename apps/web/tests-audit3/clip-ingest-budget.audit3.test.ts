// PHASE 3A — the ingest pipeline's provider-budget discipline and completion
// invariants, with the ffmpeg stages mocked (they are pinned against real
// binaries in clip-ingest-probe.audit3.test.ts).
//
// Red-first intent: delete the reserveProviderUsage call from moderateFrames —
// or ignore its refusal — and [1] fails on the reserve-before-provider order
// while [2] fails on "checkImage was never called". Skip the original delete
// and [4] fails on the remove-before-complete order.
/* global beforeEach, describe, expect, it, vi */

import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const UPLOADER_ID = '55555555-5555-4555-8555-555555555555';
const DRAFT_ID = '33333333-3333-4333-8333-333333333333';
const ASSET_ID = '44444444-4444-4444-8444-444444444444';

const events = vi.hoisted(() => [] as string[]);

const checkImage = vi.fn(async () => {
  events.push('checkImage');
  return { allowed: true, categories: [] as string[] };
});

const budget = vi.hoisted(() => ({
  reserveProviderUsage: vi.fn(),
  reconcileProviderUsage: vi.fn(async () => {
    events.push('reconcile');
  }),
}));

vi.mock('@/lib/providerBudget', () => budget);

vi.mock('@friendword/adapters', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    createProviders: () => ({ moderation: { checkImage } }),
  };
});

// The probe CLAIMS 4_800ms (a lying container would) while the proxy re-probe
// below MEASURES 9_000ms — the completion assertions pin that the measured
// value is the recorded one. The real constants stay exported because the
// pipeline clamps against CLIP_MAX_SOURCE_DURATION_MS.
vi.mock('../src/lib/clipIngest/probe', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    videoMaxBytes: () => 52_428_800,
    probeClipFile: async () => ({
      ok: true,
      durationMs: 4_800,
      width: 1080,
      height: 1920,
      videoCodec: 'h264',
      byteSize: 1_234,
    }),
  };
});

vi.mock('../src/lib/clipIngest/transcode', () => ({
  transcodeToSilentProxy: async (_input: string, output: string) => {
    await writeFile(output, 'proxy-bytes');
  },
  assertSilentProxy: async () => ({
    audioStreams: 0,
    width: 1080,
    height: 1920,
    durationMs: 9_000,
  }),
  extractPoster: async (_proxy: string, poster: string) => {
    await writeFile(poster, 'poster-bytes');
  },
  extractModerationFrames: async (_proxy: string, framesDir: string) => {
    const frames = [join(framesDir, 'frame_01.jpg'), join(framesDir, 'frame_02.jpg')];
    await Promise.all(frames.map((frame) => writeFile(frame, 'frame-bytes')));
    return frames;
  },
}));

vi.mock('../src/lib/clipIngest/faces', () => ({
  detectFaceBoxes: async () => [{ x: 0.1, y: 0.2, width: 0.3, height: 0.4 }],
}));

import { processClipIngestJob, type ClaimedIngestJob } from '../src/lib/clipIngest/pipeline';

type RpcCall = { readonly fn: string; readonly params: Record<string, unknown> };

function createServiceFake() {
  const rpcCalls: RpcCall[] = [];
  const uploads: string[] = [];
  const removals: string[][] = [];

  const client = {
    from: (table: string) => {
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: () =>
          Promise.resolve(
            table === 'pitch_assets'
              ? { data: { uploaded_by_user_id: UPLOADER_ID }, error: null }
              : { data: null, error: null },
          ),
      };
      return builder;
    },
    storage: {
      from: () => ({
        download: () =>
          Promise.resolve({ data: new Blob([new Uint8Array([1, 2, 3])]), error: null }),
        upload: (objectPath: string) => {
          events.push('upload');
          uploads.push(objectPath);
          return Promise.resolve({ data: { path: objectPath }, error: null });
        },
        remove: (paths: string[]) => {
          events.push('remove-original');
          removals.push(paths);
          return Promise.resolve({ data: [], error: null });
        },
      }),
    },
    rpc: (fn: string, params: Record<string, unknown>) => {
      events.push(`rpc:${fn}`);
      rpcCalls.push({ fn, params });
      return Promise.resolve({ data: null, error: null });
    },
  };

  return { client, rpcCalls, uploads, removals };
}

function job(): ClaimedIngestJob {
  return {
    jobId: '66666666-6666-4666-8666-666666666666',
    leaseToken: '77777777-7777-4777-8777-777777777777',
    assetId: ASSET_ID,
    pitchDraftId: DRAFT_ID,
    storagePath: `pitch-media/${DRAFT_ID}/clip-abc123.mp4`,
    attempts: 1,
  };
}

const grantedReservation = {
  ok: true,
  reservationId: 'res-1',
  priorStatus: null,
  granted: true,
  leaseToken: 'budget-lease-1',
};

describe('clip ingest pipeline — provider budget and completion invariants', () => {
  beforeEach(async () => {
    events.length = 0;
    checkImage.mockClear();
    budget.reserveProviderUsage.mockReset();
    budget.reconcileProviderUsage.mockClear();
    budget.reserveProviderUsage.mockImplementation(async () => {
      events.push('reserve');
      return grantedReservation;
    });
    process.env.OPENAI_API_KEY = 'sk-test';
    // The pipeline mkdtemps under os.tmpdir(); nothing to prepare, but keep the
    // suite honest about where it writes.
    await mkdtemp(join(tmpdir(), 'clip-budget-test-'));
  });

  it('[1] reserves the budget BEFORE any frame reaches the provider, then reconciles the real count', async () => {
    const fake = createServiceFake();

    const outcome = await processClipIngestJob(fake.client as never, job());

    expect(outcome).toBe('succeeded');
    // Reserve precedes every provider call.
    expect(events.indexOf('reserve')).toBeGreaterThan(-1);
    expect(events.indexOf('reserve')).toBeLessThan(events.indexOf('checkImage'));
    // Poster + two frames = three provider calls, reconciled as three.
    expect(checkImage).toHaveBeenCalledTimes(3);
    expect(budget.reserveProviderUsage).toHaveBeenCalledWith(
      fake.client,
      UPLOADER_ID,
      'media_validate',
      `clip-ingest:${ASSET_ID}:1`,
      3,
      DRAFT_ID,
    );
    expect(budget.reconcileProviderUsage).toHaveBeenCalledWith(
      fake.client,
      'res-1',
      'budget-lease-1',
      3,
      'succeeded',
    );
  });

  it('[2] a refused reservation means the provider is NEVER called and the job fails', async () => {
    budget.reserveProviderUsage.mockImplementation(async () => {
      events.push('reserve');
      return { ok: false, httpStatus: 429, message: 'AI usage limit reached — try again later' };
    });
    const fake = createServiceFake();

    const outcome = await processClipIngestJob(fake.client as never, job());

    expect(outcome).toBe('failed');
    expect(checkImage).toHaveBeenCalledTimes(0);
    const complete = fake.rpcCalls.find((call) => call.fn === 'complete_media_ingest_job');
    expect(complete?.params).toMatchObject({ outcome: 'failed' });
    expect(fake.uploads).toHaveLength(0);
    expect(fake.removals).toHaveLength(0);
  });

  it('[3] a flagged frame flags the ingest: no upload, the original is KEPT as evidence', async () => {
    checkImage.mockImplementationOnce(async () => {
      events.push('checkImage');
      return { allowed: false, categories: ['violence'] };
    });
    const fake = createServiceFake();

    const outcome = await processClipIngestJob(fake.client as never, job());

    expect(outcome).toBe('flagged');
    expect(fake.uploads).toHaveLength(0);
    expect(fake.removals).toHaveLength(0);
    const complete = fake.rpcCalls.find((call) => call.fn === 'complete_media_ingest_job');
    expect(complete?.params).toMatchObject({
      outcome: 'flagged',
      original_deleted: false,
      // The proxy's measured duration, not the probe's 4_800ms claim.
      duration_ms: 9_000,
    });
    expect(String(complete?.params.reason)).toContain('violence');
  });

  it('[4] success deletes the ORIGINAL before completing, and reports every derivative', async () => {
    const fake = createServiceFake();

    const outcome = await processClipIngestJob(fake.client as never, job());

    expect(outcome).toBe('succeeded');
    // Storage delete happens before the completion RPC — the DB refuses a
    // succeeded completion that did not assert the deletion.
    expect(events.indexOf('remove-original')).toBeGreaterThan(-1);
    expect(events.indexOf('remove-original')).toBeLessThan(
      events.indexOf('rpc:complete_media_ingest_job'),
    );
    expect(fake.removals).toEqual([[`${DRAFT_ID}/clip-abc123.mp4`]]);
    const complete = fake.rpcCalls.find((call) => call.fn === 'complete_media_ingest_job');
    expect(complete?.params).toMatchObject({
      outcome: 'succeeded',
      original_deleted: true,
      proxy_path: `pitch-media/${DRAFT_ID}/clip-${ASSET_ID}-proxy.mp4`,
      poster_path: `pitch-media/${DRAFT_ID}/clip-${ASSET_ID}-poster.jpg`,
      // Mutation red: record probe.durationMs again and this reads 4_800.
      duration_ms: 9_000,
      probe_width: 1080,
      probe_height: 1920,
      face_boxes: [{ x: 0.1, y: 0.2, width: 0.3, height: 0.4 }],
    });
  });
});
