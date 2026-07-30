import 'server-only';

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';

import { createProviders, ProviderNotImplementedError } from '@friendword/adapters';
import type { ServiceSupabaseClient } from '@friendword/data';

import { reconcileProviderUsage, reserveProviderUsage } from '@/lib/providerBudget';

import { detectFaceBoxes, type FaceBox } from './faces';
import { CLIP_MAX_SOURCE_DURATION_MS, probeClipFile, videoMaxBytes } from './probe';
import {
  assertSilentProxy,
  extractModerationFrames,
  extractPoster,
  transcodeToSilentProxy,
} from './transcode';

const PITCH_MEDIA_BUCKET = 'pitch-media';
const BUCKET_PREFIX = `${PITCH_MEDIA_BUCKET}/`;

/**
 * The 0050 queue RPCs land after the last database.types.ts generation, so this
 * module reaches them through the same deliberately loose adapter
 * providerBudget.ts documents: the argument shape is asserted by the audit3
 * tests, and the DB signature is the authority.
 */
type LooseRpc = (
  fn: string,
  params: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: { readonly message?: string | null } | null }>;

function looseRpc(serviceClient: ServiceSupabaseClient): LooseRpc {
  return serviceClient.rpc.bind(serviceClient) as unknown as LooseRpc;
}

export type ClaimedIngestJob = {
  readonly jobId: string;
  readonly leaseToken: string;
  readonly assetId: string;
  readonly pitchDraftId: string;
  /** Bucket-prefixed path of the ORIGINAL upload, e.g. pitch-media/<draft>/clip-x.mp4. */
  readonly storagePath: string;
  readonly attempts: number;
};

export type IngestOutcome = 'succeeded' | 'flagged' | 'failed';

/** Leases the next claimable job, or null when the queue has nothing to hand out. */
export async function claimNextIngestJob(
  serviceClient: ServiceSupabaseClient,
): Promise<ClaimedIngestJob | null> {
  const { data, error } = await looseRpc(serviceClient)('claim_media_ingest_job', {
    lease_seconds: 600,
  });
  if (error !== null) {
    throw new Error(`claim_media_ingest_job failed: ${error.message ?? 'unknown'}`);
  }
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null | undefined;
  if (
    row === null ||
    row === undefined ||
    typeof row.job_id !== 'string' ||
    typeof row.lease_token !== 'string' ||
    typeof row.asset_id !== 'string' ||
    typeof row.pitch_draft_id !== 'string' ||
    typeof row.storage_path !== 'string'
  ) {
    return null;
  }
  return {
    jobId: row.job_id,
    leaseToken: row.lease_token,
    assetId: row.asset_id,
    pitchDraftId: row.pitch_draft_id,
    storagePath: row.storage_path,
    attempts: typeof row.attempts === 'number' ? row.attempts : 1,
  };
}

type CompletionReport = {
  readonly outcome: IngestOutcome;
  readonly proxyPath?: string;
  readonly posterPath?: string;
  readonly durationMs?: number;
  readonly probeWidth?: number;
  readonly probeHeight?: number;
  readonly faceBoxes?: readonly FaceBox[];
  readonly originalDeleted?: boolean;
  readonly reason?: string;
};

async function completeIngestJob(
  serviceClient: ServiceSupabaseClient,
  job: ClaimedIngestJob,
  report: CompletionReport,
): Promise<void> {
  const { error } = await looseRpc(serviceClient)('complete_media_ingest_job', {
    job_id: job.jobId,
    lease_token: job.leaseToken,
    outcome: report.outcome,
    proxy_path: report.proxyPath ?? null,
    poster_path: report.posterPath ?? null,
    duration_ms: report.durationMs ?? null,
    probe_width: report.probeWidth ?? null,
    probe_height: report.probeHeight ?? null,
    face_boxes: report.faceBoxes ?? null,
    original_deleted: report.originalDeleted ?? false,
    reason: report.reason ?? null,
  });
  if (error !== null) {
    throw new Error(`complete_media_ingest_job failed: ${error.message ?? 'unknown'}`);
  }
}

type FrameModerationVerdict =
  | { readonly kind: 'passed' }
  | { readonly kind: 'flagged'; readonly reason: string }
  | { readonly kind: 'failed'; readonly reason: string };

/**
 * Frame moderation through the provider budget ledger (third audit P0-NEW-1
 * discipline): ONE reservation covers the whole sampled batch, taken BEFORE any
 * byte reaches the provider, reconciled with the real image count afterwards.
 * The reservation's authoritative user is the uploader, its scope the draft, so
 * the uploader's own draft-scoped external-AI consent is what admits the frames.
 *
 * The request ref carries the attempt number: a retried job is a new provider
 * run and must account as one, never replay a verdict this pipeline did not
 * store.
 */
async function moderateFrames(
  serviceClient: ServiceSupabaseClient,
  job: ClaimedIngestJob,
  uploaderUserId: string,
  imagePaths: readonly string[],
): Promise<FrameModerationVerdict> {
  const reservation = await reserveProviderUsage(
    serviceClient,
    uploaderUserId,
    'media_validate',
    `clip-ingest:${job.assetId}:${job.attempts}`,
    imagePaths.length,
    job.pitchDraftId,
  );
  if (!reservation.ok) {
    const reason =
      reservation.httpStatus === 409
        ? 'frame moderation needs the uploader’s external AI consent'
        : reservation.message;
    return { kind: 'failed', reason };
  }
  if (!reservation.granted) {
    // With an attempt-scoped ref this means a racing worker on the same
    // attempt; the lease system makes that an error worth retrying, never one
    // worth skipping moderation for.
    return { kind: 'failed', reason: 'frame moderation reservation was not granted' };
  }

  let providers;
  try {
    providers = createProviders({
      FRIENDWORD_PROVIDER_MODE: 'real',
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    });
  } catch (error: unknown) {
    if (!(error instanceof ProviderNotImplementedError)) {
      throw error;
    }
    // No provider key: nothing external was contacted, so release the
    // reservation — and the ingest FAILS. A clip is never publishable without
    // frame moderation actually having run (CLAUDE.md rule 9).
    await reconcileProviderUsage(
      serviceClient,
      reservation.reservationId,
      reservation.leaseToken,
      0,
      'released',
    );
    return { kind: 'failed', reason: 'frame moderation is not configured' };
  }

  try {
    const flaggedCategories = new Set<string>();
    for (const imagePath of imagePaths) {
      const bytes = await readFile(imagePath);
      const verdict = await providers.moderation.checkImage(
        `data:image/jpeg;base64,${bytes.toString('base64')}`,
      );
      if (!verdict.allowed) {
        for (const category of verdict.categories) {
          flaggedCategories.add(category);
        }
      }
    }
    await reconcileProviderUsage(
      serviceClient,
      reservation.reservationId,
      reservation.leaseToken,
      imagePaths.length,
      'succeeded',
    );
    if (flaggedCategories.size > 0) {
      return {
        kind: 'flagged',
        reason: `frame moderation: ${[...flaggedCategories].join(',')}`.slice(0, 300),
      };
    }
    return { kind: 'passed' };
  } catch {
    // Conservative accounting: actual 0, the DB keeps GREATEST(actual,
    // estimated) so spend that may have happened stays inside the cap.
    await reconcileProviderUsage(
      serviceClient,
      reservation.reservationId,
      reservation.leaseToken,
      0,
      'failed',
    );
    return { kind: 'failed', reason: 'frame moderation provider call failed' };
  }
}

/**
 * Runs one claimed job through the pinned pipeline order: probe (allowlist) →
 * silent proxy (hard-cut at 15s, asserted silent AND re-measured with ffprobe —
 * the artifact's measured duration is what gets recorded, because source
 * container metadata can lie about how much footage the moderation frames must
 * cover) → poster → face boxes → frame moderation → on success DELETE THE
 * ORIGINAL and only then report succeeded — complete_media_ingest_job refuses a
 * success that did not delete it. A flagged verdict uploads nothing and keeps
 * the original as review evidence.
 */
export async function processClipIngestJob(
  serviceClient: ServiceSupabaseClient,
  job: ClaimedIngestJob,
): Promise<IngestOutcome> {
  if (!job.storagePath.startsWith(BUCKET_PREFIX)) {
    await completeIngestJob(serviceClient, job, {
      outcome: 'failed',
      reason: `unexpected storage path: ${job.storagePath}`,
    });
    return 'failed';
  }
  const objectPath = job.storagePath.slice(BUCKET_PREFIX.length);

  const { data: assetRow } = await serviceClient
    .from('pitch_assets')
    .select('uploaded_by_user_id')
    .eq('id', job.assetId)
    .maybeSingle();
  const uploaderUserId = assetRow?.uploaded_by_user_id;
  if (typeof uploaderUserId !== 'string') {
    await completeIngestJob(serviceClient, job, {
      outcome: 'failed',
      reason: 'the clip asset row is gone or has no uploader',
    });
    return 'failed';
  }

  const workDir = await mkdtemp(join(tmpdir(), 'clip-ingest-'));
  try {
    const { data: originalBlob, error: downloadError } = await serviceClient.storage
      .from(PITCH_MEDIA_BUCKET)
      .download(objectPath);
    if (downloadError !== null || originalBlob === null) {
      await completeIngestJob(serviceClient, job, {
        outcome: 'failed',
        reason: 'the original upload could not be downloaded',
      });
      return 'failed';
    }
    const originalPath = join(workDir, `original${extname(objectPath) || '.mp4'}`);
    await writeFile(originalPath, new Uint8Array(await originalBlob.arrayBuffer()));

    const probe = await probeClipFile(originalPath, { maxBytes: videoMaxBytes() });
    if (!probe.ok) {
      await completeIngestJob(serviceClient, job, { outcome: 'failed', reason: probe.reason });
      return 'failed';
    }

    const proxyLocalPath = join(workDir, 'proxy.mp4');
    const posterLocalPath = join(workDir, 'poster.jpg');
    const framesDir = await mkdtemp(join(workDir, 'frames-'));
    await transcodeToSilentProxy(originalPath, proxyLocalPath);
    // Throws when the measured proxy outruns the cap; the measured duration —
    // clamped only to the DB CHECK's 15000 ceiling — is the recorded one.
    const proxyFacts = await assertSilentProxy(proxyLocalPath);
    const measuredDurationMs = Math.min(proxyFacts.durationMs, CLIP_MAX_SOURCE_DURATION_MS);
    await extractPoster(proxyLocalPath, posterLocalPath);
    const framePaths = await extractModerationFrames(proxyLocalPath, framesDir);

    const moderationImages = [posterLocalPath, ...framePaths];
    const faceBoxes = await detectFaceBoxes(moderationImages);
    const verdict = await moderateFrames(serviceClient, job, uploaderUserId, moderationImages);
    if (verdict.kind === 'flagged') {
      await completeIngestJob(serviceClient, job, {
        outcome: 'flagged',
        reason: verdict.reason,
        durationMs: measuredDurationMs,
        probeWidth: probe.width,
        probeHeight: probe.height,
      });
      return 'flagged';
    }
    if (verdict.kind === 'failed') {
      await completeIngestJob(serviceClient, job, { outcome: 'failed', reason: verdict.reason });
      return 'failed';
    }

    const proxyObject = `${job.pitchDraftId}/clip-${job.assetId}-proxy.mp4`;
    const posterObject = `${job.pitchDraftId}/clip-${job.assetId}-poster.jpg`;
    const proxyUpload = await serviceClient.storage
      .from(PITCH_MEDIA_BUCKET)
      .upload(proxyObject, await readFile(proxyLocalPath), {
        contentType: 'video/mp4',
        upsert: true,
      });
    const posterUpload = await serviceClient.storage
      .from(PITCH_MEDIA_BUCKET)
      .upload(posterObject, await readFile(posterLocalPath), {
        contentType: 'image/jpeg',
        upsert: true,
      });
    if (proxyUpload.error !== null || posterUpload.error !== null) {
      await completeIngestJob(serviceClient, job, {
        outcome: 'failed',
        reason: 'derivative upload failed',
      });
      return 'failed';
    }

    // U9, and the order the DB enforces: the original is deleted BEFORE the
    // row may say succeeded. complete_media_ingest_job raises unless the worker
    // asserts the deletion happened.
    const { error: removeError } = await serviceClient.storage
      .from(PITCH_MEDIA_BUCKET)
      .remove([objectPath]);
    if (removeError !== null) {
      await completeIngestJob(serviceClient, job, {
        outcome: 'failed',
        reason: 'the original upload could not be deleted',
      });
      return 'failed';
    }

    await completeIngestJob(serviceClient, job, {
      outcome: 'succeeded',
      proxyPath: `${BUCKET_PREFIX}${proxyObject}`,
      posterPath: `${BUCKET_PREFIX}${posterObject}`,
      durationMs: measuredDurationMs,
      probeWidth: probe.width,
      probeHeight: probe.height,
      faceBoxes,
      originalDeleted: true,
    });
    return 'succeeded';
  } catch (error: unknown) {
    const reason =
      error instanceof Error
        ? `ingest pipeline error: ${error.message}`.slice(0, 300)
        : 'ingest pipeline error';
    await completeIngestJob(serviceClient, job, { outcome: 'failed', reason });
    return 'failed';
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

export type IngestPassSummary = {
  readonly processed: number;
  readonly outcomes: readonly IngestOutcome[];
};

/**
 * Claims and processes jobs until the queue is empty, the job cap is reached,
 * or the time budget is spent. The budget stays well inside the route's
 * maxDuration so a claimed job is never abandoned mid-pipeline by the platform.
 */
export async function runClipIngestPass(
  serviceClient: ServiceSupabaseClient,
  options: { readonly timeBudgetMs?: number; readonly maxJobs?: number } = {},
): Promise<IngestPassSummary> {
  const timeBudgetMs = options.timeBudgetMs ?? 240_000;
  const maxJobs = options.maxJobs ?? 5;
  const startedAt = Date.now();
  const outcomes: IngestOutcome[] = [];

  while (outcomes.length < maxJobs && Date.now() - startedAt < timeBudgetMs) {
    const job = await claimNextIngestJob(serviceClient);
    if (job === null) {
      break;
    }
    outcomes.push(await processClipIngestJob(serviceClient, job));
  }

  return { processed: outcomes.length, outcomes };
}
