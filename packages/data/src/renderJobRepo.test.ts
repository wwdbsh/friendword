// MOTION PITCH PHASE 4 — MP4 render queue client (migration 0054).
// Pins the invariants the repo layer owns:
//  1. Every DB touch is one of the four pinned 0054 RPCs — never a table.
//     The render tables are service-role only, and this repo must not even
//     try.
//  2. The member surface requires a session BEFORE any RPC, and the repo
//     reports server refusals (pass required, campaign closed) honestly.
//  3. The worker completion call sends a WHOLE result: success carries path +
//     bytes + duration and no reason; failure carries a reason and no output.
// RPC name/argument REALITY (do the functions exist in the migrations with
// these names and arguments?) is owned by rpcContract.test.ts, not by the
// mocks here.
import { describe, expect, it } from 'vitest';

import type { BrowserSupabaseClient, ServiceSupabaseClient } from './client';
import { DataLayerError, UnauthenticatedError } from './errors';
import {
  PITCH_RENDER_RPCS,
  PITCH_RENDER_SERVICE_RPCS,
  RenderJobRepo,
  claimMediaRenderJob,
  completeMediaRenderJob,
} from './renderJobRepo';

const USER_ID = '00000000-0000-0000-0000-000000000001';
const CAMPAIGN_ID = '20000000-0000-0000-0000-000000000001';
const DRAFT_ID = '30000000-0000-0000-0000-000000000001';
const REVISION_ID = '40000000-0000-0000-0000-000000000001';
const JOB_ID = '50000000-0000-0000-0000-000000000001';
const LEASE_TOKEN = '60000000-0000-0000-0000-000000000001';
const OUTPUT_PATH = `pitch-media/${DRAFT_ID}/renders/${REVISION_ID}.mp4`;

type RpcCall = { readonly fn: string; readonly params: Record<string, unknown> };

type RpcResult = { data: unknown; error: { message: string } | null };

function fakeClient(
  options: {
    readonly signedIn?: boolean;
    readonly results?: Record<string, RpcResult>;
  } = {},
) {
  const rpcCalls: RpcCall[] = [];
  const tableAccesses: string[] = [];
  const signedIn = options.signedIn ?? true;
  const client = {
    auth: {
      getSession: async () => ({
        data: { session: signedIn ? { user: { id: USER_ID } } : null },
        error: null,
      }),
    },
    from: (table: string) => {
      tableAccesses.push(table);
      throw new Error(`unexpected direct table access: ${table}`);
    },
    rpc: async (fn: string, params: Record<string, unknown>) => {
      rpcCalls.push({ fn, params });
      return options.results?.[fn] ?? { data: [], error: null };
    },
  };
  return {
    client: client as unknown as BrowserSupabaseClient & ServiceSupabaseClient,
    rpcCalls,
    tableAccesses,
  };
}

describe('RenderJobRepo — member surface', () => {
  it('requests a render with exactly the campaign id and maps the queued job', async () => {
    const { client, rpcCalls } = fakeClient({
      results: {
        request_pitch_render: {
          data: [
            {
              job_id: JOB_ID,
              job_status: 'queued',
              revision_id: REVISION_ID,
              output_storage_path: null,
              already_requested: false,
            },
          ],
          error: null,
        },
      },
    });

    const requested = await new RenderJobRepo(client).requestRender(CAMPAIGN_ID);

    expect(rpcCalls).toEqual([
      { fn: 'request_pitch_render', params: { target_campaign_id: CAMPAIGN_ID } },
    ]);
    expect(requested).toEqual({
      jobId: JOB_ID,
      jobStatus: 'queued',
      revisionId: REVISION_ID,
      outputStoragePath: null,
      alreadyRequested: false,
    });
  });

  it('maps a cached done job (idempotent repeat request) with its output', async () => {
    const { client } = fakeClient({
      results: {
        request_pitch_render: {
          data: [
            {
              job_id: JOB_ID,
              job_status: 'done',
              revision_id: REVISION_ID,
              output_storage_path: OUTPUT_PATH,
              already_requested: true,
            },
          ],
          error: null,
        },
      },
    });

    await expect(new RenderJobRepo(client).requestRender(CAMPAIGN_ID)).resolves.toEqual({
      jobId: JOB_ID,
      jobStatus: 'done',
      revisionId: REVISION_ID,
      outputStoragePath: OUTPUT_PATH,
      alreadyRequested: true,
    });
  });

  it('rejects when signed out, before any RPC', async () => {
    const { client, rpcCalls } = fakeClient({ signedIn: false });

    await expect(new RenderJobRepo(client).requestRender(CAMPAIGN_ID)).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
    await expect(new RenderJobRepo(client).getRenderState(CAMPAIGN_ID)).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
    expect(rpcCalls).toHaveLength(0);
  });

  it('rejects a malformed campaign id before any RPC', async () => {
    const { client, rpcCalls } = fakeClient();

    await expect(new RenderJobRepo(client).requestRender('not-a-uuid')).rejects.toThrow();
    expect(rpcCalls).toHaveLength(0);
  });

  it('surfaces a server refusal (e.g. campaign pass required) — no fake success', async () => {
    const { client } = fakeClient({
      results: {
        request_pitch_render: { data: null, error: { message: 'campaign pass required' } },
      },
    });

    await expect(new RenderJobRepo(client).requestRender(CAMPAIGN_ID)).rejects.toBeInstanceOf(
      DataLayerError,
    );
  });

  it('maps the never-requested state (null job fields, ledger facts kept)', async () => {
    const { client, rpcCalls, tableAccesses } = fakeClient({
      results: {
        get_pitch_render_state: {
          data: [
            {
              job_id: null,
              job_status: null,
              revision_id: null,
              output_storage_path: null,
              last_error: null,
              free_render_used: false,
              pass_active: true,
              updated_at: null,
            },
          ],
          error: null,
        },
      },
    });

    await expect(new RenderJobRepo(client).getRenderState(CAMPAIGN_ID)).resolves.toEqual({
      jobId: null,
      jobStatus: null,
      revisionId: null,
      outputStoragePath: null,
      lastError: null,
      freeRenderUsed: false,
      passActive: true,
      updatedAt: null,
      // The response above is a PRE-0063 server: the variant columns simply
      // are not there, and this bundle must still read the state during the
      // deploy window rather than fail to parse it.
      variant: null,
      effectiveVariant: null,
      options: null,
    });
    expect(rpcCalls).toEqual([
      { fn: 'get_pitch_render_state', params: { target_campaign_id: CAMPAIGN_ID } },
    ]);
    expect(tableAccesses).toEqual([]);
  });

  it('maps the 0063 variant columns when the server sends them', async () => {
    const { client } = fakeClient({
      results: {
        get_pitch_render_state: {
          data: [
            {
              job_id: JOB_ID,
              job_status: 'done',
              revision_id: REVISION_ID,
              output_storage_path: 'pitch-media/draft/renders/out.mp4',
              last_error: null,
              free_render_used: true,
              pass_active: false,
              updated_at: '2026-09-09T00:00:00.000Z',
              variant: 'highlight',
              effective_variant: 'full',
              options: { music: true },
            },
          ],
          error: null,
        },
      },
    });

    const state = await new RenderJobRepo(client).getRenderState(CAMPAIGN_ID);
    // The requested variant and the rendered one are separate facts: this row
    // is a highlight request the worker had to fall back to full.
    expect(state.variant).toBe('highlight');
    expect(state.effectiveVariant).toBe('full');
    expect(state.options).toEqual({ music: true });
  });
});

describe('choosing a render variant', () => {
  const queuedRequest = {
    request_pitch_render: {
      data: [
        {
          job_id: JOB_ID,
          job_status: 'queued',
          revision_id: REVISION_ID,
          output_storage_path: null,
          already_requested: false,
        },
      ],
      error: null,
    },
  };

  it('sends the 1-argument call when the caller expressed no preference', async () => {
    const { client, rpcCalls } = fakeClient({ results: queuedRequest });
    await new RenderJobRepo(client).requestRender(CAMPAIGN_ID);
    expect(rpcCalls).toEqual([
      { fn: 'request_pitch_render', params: { target_campaign_id: CAMPAIGN_ID } },
    ]);
  });

  it('passes the chosen variant and options through', async () => {
    const { client, rpcCalls } = fakeClient({ results: queuedRequest });
    await new RenderJobRepo(client).requestRender(CAMPAIGN_ID, {
      variant: 'full',
      options: { music: false },
    });
    expect(rpcCalls).toEqual([
      {
        fn: 'request_pitch_render',
        params: {
          target_campaign_id: CAMPAIGN_ID,
          p_variant: 'full',
          p_options: { music: false },
        },
      },
    ]);
  });

  it('defaults a partial choice to the highlight variant with no options', async () => {
    const { client, rpcCalls } = fakeClient({ results: queuedRequest });
    await new RenderJobRepo(client).requestRender(CAMPAIGN_ID, { options: { music: true } });
    expect(rpcCalls).toEqual([
      {
        fn: 'request_pitch_render',
        params: {
          target_campaign_id: CAMPAIGN_ID,
          p_variant: 'highlight',
          p_options: { music: true },
        },
      },
    ]);
  });
});

describe('render worker surface', () => {
  it('claims a job and maps the lease, defaulting the lease length', async () => {
    const { client, rpcCalls } = fakeClient({
      results: {
        claim_media_render_job: {
          data: [
            {
              job_id: JOB_ID,
              lease_token: LEASE_TOKEN,
              campaign_id: CAMPAIGN_ID,
              pitch_draft_id: DRAFT_ID,
              revision_id: REVISION_ID,
              scene_hash: 'scene-hash',
              attempts: 1,
              lease_expires_at: '2026-08-03T00:15:00Z',
            },
          ],
          error: null,
        },
      },
    });

    const claimed = await claimMediaRenderJob(client);

    expect(rpcCalls).toEqual([{ fn: 'claim_media_render_job', params: { lease_seconds: 900 } }]);
    expect(claimed).toEqual({
      jobId: JOB_ID,
      leaseToken: LEASE_TOKEN,
      campaignId: CAMPAIGN_ID,
      pitchDraftId: DRAFT_ID,
      revisionId: REVISION_ID,
      sceneHash: 'scene-hash',
      attempts: 1,
      leaseExpiresAt: '2026-08-03T00:15:00Z',
    });
  });

  it('returns null when nothing is claimable (empty queue or cap reached)', async () => {
    const { client } = fakeClient({
      results: { claim_media_render_job: { data: [], error: null } },
    });

    await expect(claimMediaRenderJob(client, 120)).resolves.toBeNull();
  });

  it('sends a WHOLE success: output fields set, reason null', async () => {
    const { client, rpcCalls } = fakeClient();

    await completeMediaRenderJob(client, JOB_ID, LEASE_TOKEN, {
      outcome: 'succeeded',
      outputStoragePath: OUTPUT_PATH,
      outputBytes: 35_000_000,
      outputDurationMs: 30_000,
    });

    expect(rpcCalls).toEqual([
      {
        fn: 'complete_media_render_job',
        params: {
          job_id: JOB_ID,
          lease_token: LEASE_TOKEN,
          outcome: 'succeeded',
          output_storage_path: OUTPUT_PATH,
          output_bytes: 35_000_000,
          output_duration_ms: 30_000,
          reason: null,
        },
      },
    ]);
  });

  it('sends a failure with its reason and no output fields', async () => {
    const { client, rpcCalls } = fakeClient();

    await completeMediaRenderJob(client, JOB_ID, LEASE_TOKEN, {
      outcome: 'failed',
      reason: 'renderer crashed',
    });

    expect(rpcCalls[0]?.params).toEqual({
      job_id: JOB_ID,
      lease_token: LEASE_TOKEN,
      outcome: 'failed',
      output_storage_path: null,
      output_bytes: null,
      output_duration_ms: null,
      reason: 'renderer crashed',
    });
  });

  it('surfaces a lost lease honestly', async () => {
    const { client } = fakeClient({
      results: {
        complete_media_render_job: {
          data: null,
          error: { message: 'media render lease is not held' },
        },
      },
    });

    await expect(
      completeMediaRenderJob(client, JOB_ID, LEASE_TOKEN, {
        outcome: 'failed',
        reason: 'renderer crashed',
      }),
    ).rejects.toBeInstanceOf(DataLayerError);
  });
});

describe('the render repo touches only the pinned 0054 RPCs', () => {
  it('calls only pinned names and no table at all, across every method', async () => {
    const { client, rpcCalls, tableAccesses } = fakeClient({
      results: {
        request_pitch_render: {
          data: [
            {
              job_id: JOB_ID,
              job_status: 'queued',
              revision_id: REVISION_ID,
              output_storage_path: null,
              already_requested: false,
            },
          ],
          error: null,
        },
        get_pitch_render_state: {
          data: [
            {
              job_id: null,
              job_status: null,
              revision_id: null,
              output_storage_path: null,
              last_error: null,
              free_render_used: false,
              pass_active: false,
              updated_at: null,
            },
          ],
          error: null,
        },
        claim_media_render_job: { data: [], error: null },
      },
    });
    const repo = new RenderJobRepo(client);

    await repo.requestRender(CAMPAIGN_ID);
    await repo.getRenderState(CAMPAIGN_ID);
    await claimMediaRenderJob(client);
    await completeMediaRenderJob(client, JOB_ID, LEASE_TOKEN, {
      outcome: 'failed',
      reason: 'probe',
    });

    expect(tableAccesses).toEqual([]);
    const pinned: readonly string[] = [...PITCH_RENDER_RPCS, ...PITCH_RENDER_SERVICE_RPCS];
    for (const call of rpcCalls) {
      expect(pinned).toContain(call.fn);
    }
  });
});
