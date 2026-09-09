import { z } from 'zod';

import type { Session } from '@supabase/supabase-js';

import type { BrowserSupabaseClient, ServiceSupabaseClient } from './client';
import type { Json } from './database.types';
import { DataLayerError, UnauthenticatedError } from './errors';

const uuidSchema = z.string().uuid();

/**
 * MP4 render of the approved motion pitch (migration 0054). Enqueue is LAZY:
 * nothing renders at approval — `request_pitch_render` at export time is the
 * only enqueue path, idempotent per approved consent revision (the job row is
 * the cache). The campaign's first successful render is free; the free unlock
 * is consumed at job SUCCESS server-side, and later revisions require the
 * Campaign Pass. This repo never touches the render tables directly: they are
 * service-role only, and the two member RPCs below are the whole client
 * surface.
 *
 * These names are the pinned 0054 server contract; rpcContract.test.ts checks
 * them (and their argument names) against the migration SQL itself. They are
 * not in the generated database types yet, so calls go through a narrow
 * untyped envelope.
 */
export const PITCH_RENDER_RPCS = ['request_pitch_render', 'get_pitch_render_state'] as const;

/**
 * Worker-side lifecycle RPCs, callable with the service key only. Exposed
 * here so the render worker's route shares one pinned contract with the
 * member surface instead of spelling raw strings.
 */
export const PITCH_RENDER_SERVICE_RPCS = [
  'claim_media_render_job',
  'complete_media_render_job',
] as const;

export type PitchRenderJobStatus = 'queued' | 'leased' | 'done' | 'failed';

/**
 * Which MP4 the requester asked for (migration 0063). 'highlight' is a 15-30s
 * cut of the approved sentences; 'full' is the whole approved recording. The
 * choice is made BEFORE the render and belongs to the job row for its life:
 * one revision gets one MP4.
 */
export type PitchRenderVariant = 'full' | 'highlight';

/** Render options, whitelisted server-side by private.render_options_are_valid. */
export type PitchRenderOptions = {
  // Explicitly `| undefined` for exactOptionalPropertyTypes: the value arrives
  // from a JSONB column where the key is genuinely optional.
  readonly music?: boolean | undefined;
};

/** What the caller chose in the export card, if it chose at all. */
export type PitchRenderChoice = {
  readonly variant?: PitchRenderVariant;
  readonly options?: PitchRenderOptions;
};

export type PitchRenderRequest = {
  readonly jobId: string;
  readonly jobStatus: PitchRenderJobStatus;
  readonly revisionId: string;
  readonly outputStoragePath: string | null;
  readonly alreadyRequested: boolean;
};

export type PitchRenderState = {
  readonly jobId: string | null;
  readonly jobStatus: PitchRenderJobStatus | null;
  readonly revisionId: string | null;
  readonly outputStoragePath: string | null;
  readonly lastError: string | null;
  readonly freeRenderUsed: boolean;
  readonly passActive: boolean;
  readonly updatedAt: string | null;
  /** 0063. Null while no job exists (or before 0063 reaches this database). */
  readonly variant: PitchRenderVariant | null;
  /** What the worker actually rendered; differs from `variant` on fallback. */
  readonly effectiveVariant: PitchRenderVariant | null;
  readonly options: PitchRenderOptions | null;
};

export type ClaimedRenderJob = {
  readonly jobId: string;
  readonly leaseToken: string;
  readonly campaignId: string;
  readonly pitchDraftId: string;
  readonly revisionId: string;
  readonly sceneHash: string;
  readonly attempts: number;
  readonly leaseExpiresAt: string;
};

/**
 * The choice frozen on the job row (0063), read by the WORKER.
 *
 * `claim_media_render_job` predates 0063 and still returns the lease fields
 * only. Rather than change a lease RPC's return shape — every claim path and
 * its tests depend on it — the worker reads the two columns it needs directly;
 * the table is service-role only, so this is not a new exposure.
 */
export type ClaimedRenderJobChoice = {
  readonly variant: PitchRenderVariant;
  readonly options: PitchRenderOptions;
};

/** What the worker decided once it saw the transcript (0063, §2.2-1). */
export type RenderJobCutRecord = {
  readonly effectiveVariant: PitchRenderVariant;
  /** The HighlightPlan as stored; null when the render fell back to full. */
  readonly cutPlan: Json | null;
  /** sha256 of the plan's windows; null on fallback. */
  readonly cutHash: string | null;
};

export type RenderCompletion =
  | {
      readonly outcome: 'succeeded';
      readonly outputStoragePath: string;
      readonly outputBytes: number;
      readonly outputDurationMs: number;
    }
  | { readonly outcome: 'failed'; readonly reason: string };

const jobStatusSchema = z.enum(['queued', 'leased', 'done', 'failed']);
const variantSchema = z.enum(['full', 'highlight']);
// Unknown keys are stripped rather than rejected: the server owns the
// whitelist (0063 CHECK), and a client that refuses to parse a newer option
// would break the export card for a value it does not need to understand.
const optionsSchema = z.object({ music: z.boolean().optional() });

// 0054: request_pitch_render returns TABLE (job_id, job_status, revision_id,
// output_storage_path, already_requested).
const requestRowsSchema = z.array(
  z.object({
    job_id: z.string().uuid(),
    job_status: jobStatusSchema,
    revision_id: z.string().uuid(),
    output_storage_path: z.string().nullish(),
    already_requested: z.boolean(),
  }),
);

// 0054: get_pitch_render_state always returns one row; the job fields are
// NULL while no render was ever requested.
const stateRowsSchema = z.array(
  z.object({
    job_id: z.string().uuid().nullish(),
    job_status: jobStatusSchema.nullish(),
    revision_id: z.string().uuid().nullish(),
    output_storage_path: z.string().nullish(),
    last_error: z.string().nullish(),
    free_render_used: z.boolean(),
    pass_active: z.boolean(),
    updated_at: z.string().nullish(),
    // 0063 appended these. `nullish` covers both "no job yet" and the deploy
    // window in which this bundle runs against a pre-0063 database.
    variant: variantSchema.nullish(),
    effective_variant: variantSchema.nullish(),
    options: optionsSchema.nullish(),
  }),
);

const claimRowsSchema = z.array(
  z.object({
    job_id: z.string().uuid(),
    lease_token: z.string().uuid(),
    campaign_id: z.string().uuid(),
    pitch_draft_id: z.string().uuid(),
    revision_id: z.string().uuid(),
    scene_hash: z.string(),
    attempts: z.number().int(),
    lease_expires_at: z.string(),
  }),
);

export class RenderJobRepo {
  constructor(private readonly client: BrowserSupabaseClient) {}

  /**
   * Asks the server to render (or hand back) the MP4 of the campaign's
   * current approved revision, optionally naming the variant and options
   * (0063). Idempotent: a repeat request returns the stored job, consumes
   * nothing and does NOT re-point it at another variant — one revision, one
   * MP4. Only the reset of a terminally failed job may choose again. Server-side gates decide everything —
   * membership, campaign openness, and whether the Campaign Pass is required
   * — so a refusal here is the product answer, not an error to retry around.
   */
  async requestRender(campaignId: string, choice?: PitchRenderChoice): Promise<PitchRenderRequest> {
    await this.getRequiredSession();
    const target_campaign_id = uuidSchema.parse(campaignId);
    // Two literal call shapes rather than one spread: a caller that expressed
    // no preference sends the 1-argument call the server has always accepted
    // (so this bundle keeps working against a database that has not taken 0063
    // yet), and rpcContract.test.ts can still read both argument lists
    // statically — a spread would make it skip the check.
    const { data, error } =
      choice === undefined
        ? await callRenderRpc(this.client, 'request_pitch_render', { target_campaign_id })
        : await callRenderRpc(this.client, 'request_pitch_render', {
            target_campaign_id,
            p_variant: choice.variant ?? 'highlight',
            p_options: choice.options ?? {},
          });
    if (error !== null) {
      throw new DataLayerError('render.request', error);
    }
    const parsed = requestRowsSchema.safeParse(data);
    if (!parsed.success) {
      throw new DataLayerError('render.request', parsed.error);
    }
    const row = parsed.data.at(0);
    if (row === undefined) {
      throw new DataLayerError('render.request', new Error('RPC returned no render job'));
    }
    return {
      jobId: row.job_id,
      jobStatus: row.job_status,
      revisionId: row.revision_id,
      outputStoragePath: row.output_storage_path ?? null,
      alreadyRequested: row.already_requested,
    };
  }

  /**
   * The member view of the campaign's render: the latest job (all fields null
   * when none was requested yet), whether the free render is spent, and
   * whether the Campaign Pass is live. The only client-reachable read of the
   * render tables.
   */
  async getRenderState(campaignId: string): Promise<PitchRenderState> {
    await this.getRequiredSession();
    const { data, error } = await callRenderRpc(this.client, 'get_pitch_render_state', {
      target_campaign_id: uuidSchema.parse(campaignId),
    });
    if (error !== null) {
      throw new DataLayerError('render.getState', error);
    }
    const parsed = stateRowsSchema.safeParse(data);
    if (!parsed.success) {
      throw new DataLayerError('render.getState', parsed.error);
    }
    const row = parsed.data.at(0);
    if (row === undefined) {
      throw new DataLayerError('render.getState', new Error('RPC returned no state row'));
    }
    return {
      jobId: row.job_id ?? null,
      jobStatus: row.job_status ?? null,
      revisionId: row.revision_id ?? null,
      outputStoragePath: row.output_storage_path ?? null,
      lastError: row.last_error ?? null,
      freeRenderUsed: row.free_render_used,
      passActive: row.pass_active,
      updatedAt: row.updated_at ?? null,
      variant: row.variant ?? null,
      effectiveVariant: row.effective_variant ?? null,
      options: row.options ?? null,
    };
  }

  private async getRequiredSession(): Promise<Session> {
    const { data, error } = await this.client.auth.getSession();
    if (error !== null) {
      throw new DataLayerError('render.getSession', error);
    }
    if (data.session === null) {
      throw new UnauthenticatedError();
    }
    return data.session;
  }
}

/**
 * Leases one render job for the worker, or null when nothing is claimable
 * (empty queue, concurrency cap reached, or every campaign paused). Service
 * key only — the RPC refuses every other role.
 */
export async function claimMediaRenderJob(
  client: ServiceSupabaseClient,
  leaseSeconds?: number,
): Promise<ClaimedRenderJob | null> {
  const { data, error } = await callRenderRpc(client, 'claim_media_render_job', {
    lease_seconds: leaseSeconds ?? 900,
  });
  if (error !== null) {
    throw new DataLayerError('render.claim', error);
  }
  const parsed = claimRowsSchema.safeParse(data);
  if (!parsed.success) {
    throw new DataLayerError('render.claim', parsed.error);
  }
  const row = parsed.data.at(0);
  if (row === undefined) {
    return null;
  }
  return {
    jobId: row.job_id,
    leaseToken: row.lease_token,
    campaignId: row.campaign_id,
    pitchDraftId: row.pitch_draft_id,
    revisionId: row.revision_id,
    sceneHash: row.scene_hash,
    attempts: row.attempts,
    leaseExpiresAt: row.lease_expires_at,
  };
}

const jobChoiceRowSchema = z.object({
  variant: variantSchema.nullish(),
  options: optionsSchema.nullish(),
});

/**
 * The variant and options the requester chose for this job.
 *
 * 0063 is deployed, so the columns are there; a database without them would
 * raise 42703 here rather than fall through to a default, and that is the
 * correct outcome — a worker cannot honour a choice it cannot read. The
 * `full` fallback below is only for a row that carries NULLs (nothing can
 * write one today: the column is NOT NULL DEFAULT), and it points at the
 * render this pipeline has always produced rather than at a cut nobody asked
 * for.
 */
export async function fetchRenderJobChoice(
  client: ServiceSupabaseClient,
  jobId: string,
): Promise<ClaimedRenderJobChoice> {
  const { data, error } = await client
    .from('media_render_jobs')
    .select('variant,options')
    .eq('id', uuidSchema.parse(jobId))
    .maybeSingle();
  if (error !== null) {
    throw new DataLayerError('render.jobChoice', error);
  }
  const parsed = jobChoiceRowSchema.safeParse(data ?? {});
  if (!parsed.success) {
    return { variant: 'full', options: {} };
  }
  return {
    variant: parsed.data.variant ?? 'full',
    options: parsed.data.options ?? {},
  };
}

/**
 * Records what the worker actually rendered, under the held lease.
 *
 * `effective_variant` is written on EVERY completion, success or fallback: rows
 * that completed before 0063 carry the column NULL while having been full
 * renders, so "NULL means full, for old rows only" stays true precisely because
 * this worker never leaves it NULL again (§2.1 note 5).
 *
 * The lease token is part of the predicate: a worker whose lease lapsed must
 * not overwrite the plan of whoever picked the job up next.
 */
export async function recordRenderJobCut(
  client: ServiceSupabaseClient,
  jobId: string,
  leaseToken: string,
  record: RenderJobCutRecord,
): Promise<void> {
  // Both identifiers are validated BEFORE the query is built: a malformed one
  // must not reach the builder at all, so the failure is a refusal here rather
  // than a half-constructed statement.
  const id = uuidSchema.parse(jobId);
  const lease = uuidSchema.parse(leaseToken);
  const { data, error } = await client
    .from('media_render_jobs')
    .update({
      effective_variant: record.effectiveVariant,
      cut_plan: record.cutPlan,
      cut_hash: record.cutHash,
    })
    .eq('id', id)
    .eq('lease_token', lease)
    // …and the lease must still be LIVE. A lease token matches until it is
    // handed to another worker, so the token alone lets a worker whose lease
    // merely EXPIRED — the case the reclaim path exists for — write its cut
    // over a job someone else is already re-rendering. Expiry is the same
    // predicate claim_media_render_job reclaims on, so the two agree.
    .gt('lease_expires_at', new Date().toISOString())
    // The updated rows come back so a no-op is detectable: matching zero rows
    // means the lease lapsed and another worker owns the job, and silently
    // succeeding there would leave effective_variant reading as whatever the
    // other worker wrote — or NULL, which the product reads as "rendered
    // before 0063".
    .select('id');
  if (error !== null) {
    throw new DataLayerError('render.recordCut', error);
  }
  if (!Array.isArray(data) || data.length === 0) {
    throw new DataLayerError(
      'render.recordCut',
      new Error('render job lease no longer holds; the cut record was not written'),
    );
  }
}

/**
 * Reports a render result under the held lease. A succeeded completion must
 * carry the full output (the server refuses partial success and consumes the
 * campaign's free render exactly once); a failed one must carry the reason.
 */
export async function completeMediaRenderJob(
  client: ServiceSupabaseClient,
  jobId: string,
  leaseToken: string,
  completion: RenderCompletion,
): Promise<void> {
  const { error } = await callRenderRpc(client, 'complete_media_render_job', {
    job_id: uuidSchema.parse(jobId),
    lease_token: uuidSchema.parse(leaseToken),
    outcome: completion.outcome,
    output_storage_path: completion.outcome === 'succeeded' ? completion.outputStoragePath : null,
    output_bytes: completion.outcome === 'succeeded' ? completion.outputBytes : null,
    output_duration_ms: completion.outcome === 'succeeded' ? completion.outputDurationMs : null,
    reason: completion.outcome === 'failed' ? completion.reason : null,
  });
  if (error !== null) {
    throw new DataLayerError('render.complete', error);
  }
}

type RenderRpcName =
  (typeof PITCH_RENDER_RPCS)[number] | (typeof PITCH_RENDER_SERVICE_RPCS)[number];

// The 0054 RPCs are not in the generated database types yet, so the calls go
// through this narrow untyped envelope (interestIntentRepo precedent).
// rpcContract.test.ts recognizes this wrapper's call shape and verifies every
// name and argument key against the migration SQL.
async function callRenderRpc(
  client: BrowserSupabaseClient | ServiceSupabaseClient,
  functionName: RenderRpcName,
  params: Record<string, unknown>,
): Promise<{ readonly data: unknown; readonly error: unknown | null }> {
  const rpc: unknown = Reflect.get(client, 'rpc');
  if (typeof rpc !== 'function') {
    throw new DataLayerError('render.rpc', new Error('Supabase RPC client is unavailable'));
  }
  const result: unknown = await Reflect.apply(rpc, client, [functionName, params]);
  if (
    typeof result !== 'object' ||
    result === null ||
    !('data' in result) ||
    !('error' in result)
  ) {
    throw new DataLayerError('render.rpc', new Error('Supabase returned an invalid result'));
  }
  return { data: Reflect.get(result, 'data'), error: Reflect.get(result, 'error') };
}
