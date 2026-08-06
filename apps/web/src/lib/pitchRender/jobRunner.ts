import { createHash } from 'node:crypto';

import { z } from 'zod';

import {
  claimMediaRenderJob,
  completeMediaRenderJob,
  indexTranscriptWords,
  type ClaimedRenderJob,
  type ServiceSupabaseClient,
} from '@friendword/data';

import {
  sceneV2ReferencesText,
  sceneV2ReferencesWords,
  type SceneTextFields,
  type SceneWord,
} from '@/pitch/sceneV2';

import { renderScene } from './renderScene';
import {
  downloadPitchMediaObject,
  mimeTypeForStoredMedia,
  renderOutputStoragePath,
  uploadRenderOutput,
} from './storage';
import {
  COMPLETION_MARGIN_MS,
  DEFAULT_CLAIM_WINDOW_MS,
  DEFAULT_LEASE_SECONDS,
  MIN_START_BUDGET_MS,
  WORKER_HARD_BUDGET_MS,
} from './timeBudget';
import { assertRenderableScene } from './validate';

// The render worker's job loop (Phase 4): claim a leased job from
// media_render_jobs (0054), re-verify the frozen scene hash against the
// revision as stored, pull the approved photos and the Introducer's ORIGINAL
// voice from storage, run the pure engine, store the MP4 under the draft's
// renders/ prefix, and report the outcome under the held lease. The engine
// (renderScene) stays DB-blind; everything queue- and storage-shaped lives
// here.
//
// Contract pins, each load-bearing:
//   - A job succeeds only with the complete output stored (the DB refuses
//     partial success, and success is the moment the campaign's free render
//     is consumed) — so nothing here ever reports 'succeeded' before the MP4
//     upload returned.
//   - Failures are reported honestly via complete_media_render_job; the DB
//     owns the 3-attempt budget and the ops alert. Reasons carry no personal
//     data and no signed URLs.
//   - The scene hash is computed over the revision's `scene_definition::text`
//     EXACTLY as PostgREST hands it over — never over a JS re-serialization,
//     which reorders keys and reformats numbers (0048's pinned comment; this
//     repo has already shipped four cross-language serialization incidents).

const DEFAULT_MAX_JOBS = 2;
const MAX_FAILURE_REASON_CHARS = 300;

// The pass clock — lease length, claim window, hard budget, completion margin
// and the refuse-to-start floor — now lives in ./timeBudget, where each value
// is defined relative to the route's maxDuration and the relations between
// them are asserted (timeBudget.test.ts). They were literals here while the
// ceiling was 300s; at 800s the lease is close enough to the budget that
// "which deadline binds" stopped being obvious, and a comment is not a proof.

/** sha256 hex over the canonical text, byte-compatible with pg's digest(). */
export function sceneHashOfCanonicalText(canonicalSceneText: string): string {
  return createHash('sha256').update(canonicalSceneText, 'utf8').digest('hex');
}

/** A failure whose message is already safe to report to the queue verbatim. */
class RenderJobError extends Error {}

export type RenderJobReport = {
  readonly jobId: string;
  readonly revisionId: string;
  readonly outcome: 'succeeded' | 'failed';
  readonly outputStoragePath?: string;
  readonly renderMs?: number;
  /** The reason reported to the queue — never personal data or signed URLs. */
  readonly reason?: string;
  /** Set when even the failure report could not be delivered (lease lapse). */
  readonly completionError?: string;
};

export type RenderPassSummary = {
  readonly processed: number;
  readonly jobs: readonly RenderJobReport[];
};

export type RenderPassOptions = {
  /** Origin serving this app's /internal/render capture page. */
  readonly baseUrl: string;
  /** Canonical origin for the end card URL. */
  readonly shareOrigin: string;
  readonly maxJobs?: number;
  readonly leaseSeconds?: number;
  readonly claimWindowMs?: number;
  readonly hardBudgetMs?: number;
  /** Injected only by tests; the route always renders with the real engine. */
  readonly render?: typeof renderScene;
};

/**
 * Claims and renders jobs until the queue yields nothing, the job cap is
 * reached, or the claim window closes. Mirrors runClipIngestPass: the window
 * keeps a claimed job from being abandoned mid-render by the platform kill.
 */
export async function runRenderPass(
  client: ServiceSupabaseClient,
  options: RenderPassOptions,
): Promise<RenderPassSummary> {
  const startedAt = Date.now();
  const claimDeadline = startedAt + (options.claimWindowMs ?? DEFAULT_CLAIM_WINDOW_MS);
  const hardDeadline = startedAt + (options.hardBudgetMs ?? WORKER_HARD_BUDGET_MS);
  const maxJobs = options.maxJobs ?? DEFAULT_MAX_JOBS;

  const jobs: RenderJobReport[] = [];
  while (jobs.length < maxJobs && Date.now() < claimDeadline) {
    const job = await claimMediaRenderJob(client, options.leaseSeconds ?? DEFAULT_LEASE_SECONDS);
    if (job === null) {
      break;
    }
    jobs.push(await processRenderJob(client, job, options, hardDeadline));
  }
  return { processed: jobs.length, jobs };
}

/**
 * One claimed job, end to end. Never throws: every failure — including a
 * refusal to start — is reported to the queue under the held lease, because a
 * swallowed exception here would leave the job to lease-expiry limbo and hide
 * the cause from ops_alerts.
 */
export async function processRenderJob(
  client: ServiceSupabaseClient,
  job: ClaimedRenderJob,
  options: RenderPassOptions,
  hardDeadline: number,
): Promise<RenderJobReport> {
  try {
    const inputs = await loadRenderInputs(client, job);

    // D6: the render must FINISH — plus upload and completion — before both
    // the route's hard budget and the lease deadline, or another worker may
    // claim the same job mid-flight. Refuse to start rather than start a
    // render that cannot land.
    const leaseDeadlineMs = Date.parse(job.leaseExpiresAt);
    const renderDeadline =
      Math.min(hardDeadline, Number.isNaN(leaseDeadlineMs) ? hardDeadline : leaseDeadlineMs) -
      COMPLETION_MARGIN_MS;
    const timeBudgetMs = renderDeadline - Date.now();
    if (timeBudgetMs < MIN_START_BUDGET_MS) {
      throw new RenderJobError(
        'not enough time left in the lease or worker budget to start this render safely',
      );
    }

    const render = options.render ?? renderScene;
    const { mp4, stats } = await render(inputs.sceneJson, inputs.assets, {
      baseUrl: options.baseUrl,
      // The revision id: deterministic per job (same temp paths on a retry),
      // and the same identity the output object is named after.
      renderKey: job.revisionId,
      campaignSlug: inputs.campaignSlug,
      shareOrigin: options.shareOrigin,
      words: inputs.words,
      text: inputs.text,
      timeBudgetMs,
    });

    const outputStoragePath = renderOutputStoragePath(job.pitchDraftId, job.revisionId);
    await uploadRenderOutput(client, outputStoragePath, mp4);

    // The container's real timeline: approved scene frames plus the appended
    // end card, at the encoder's frame rate.
    const outputDurationMs = Math.round(
      ((stats.sceneFrames + stats.endCardFrames) / stats.fps) * 1000,
    );
    await completeMediaRenderJob(client, job.jobId, job.leaseToken, {
      outcome: 'succeeded',
      outputStoragePath,
      outputBytes: mp4.byteLength,
      outputDurationMs,
    });
    return {
      jobId: job.jobId,
      revisionId: job.revisionId,
      outcome: 'succeeded',
      outputStoragePath,
      renderMs: stats.totalMs,
    };
  } catch (error) {
    const reason = failureReason(error);
    try {
      await completeMediaRenderJob(client, job.jobId, job.leaseToken, {
        outcome: 'failed',
        reason,
      });
    } catch (completionError) {
      // The lease may have lapsed mid-render and the job moved on without us;
      // surface the fact in the summary instead of pretending it was filed.
      return {
        jobId: job.jobId,
        revisionId: job.revisionId,
        outcome: 'failed',
        reason,
        completionError:
          completionError instanceof Error ? completionError.message : 'completion failed',
      };
    }
    return { jobId: job.jobId, revisionId: job.revisionId, outcome: 'failed', reason };
  }
}

type RenderInputs = {
  readonly sceneJson: unknown;
  readonly assets: Parameters<typeof renderScene>[1];
  readonly campaignSlug: string;
  readonly words: readonly SceneWord[];
  readonly text: SceneTextFields | null;
};

async function loadRenderInputs(
  client: ServiceSupabaseClient,
  job: ClaimedRenderJob,
): Promise<RenderInputs> {
  const revision = await fetchRevision(client, job.revisionId);
  if (revision === null) {
    throw new RenderJobError('approved revision no longer exists');
  }
  if (revision.sceneCanonical === null) {
    throw new RenderJobError('approved revision carries no motion scene');
  }

  // The hash gate: render only what the job froze at enqueue. The canonical
  // text is hashed exactly as the database serialized it (::text) — parsing
  // and re-stringifying in JS would never match (0048 comment).
  const recomputedHash = sceneHashOfCanonicalText(revision.sceneCanonical);
  if (recomputedHash !== job.sceneHash) {
    throw new RenderJobError(
      `scene hash mismatch: the stored revision hashes ${recomputedHash.slice(0, 12)} but the job froze ${job.sceneHash.slice(0, 12)}`,
    );
  }
  if (revision.pitchDraftId !== job.pitchDraftId) {
    throw new RenderJobError('revision does not belong to the job draft');
  }

  const sceneJson: unknown = JSON.parse(revision.sceneCanonical);
  const scene = assertRenderableScene(sceneJson);

  const campaignSlug = await fetchCampaignSlug(client, job.campaignId);
  if (campaignSlug === null) {
    throw new RenderJobError('campaign has no public slug for the end card');
  }

  // The Introducer's ORIGINAL voice (CLAUDE.md §8 boundary 1): downloaded as
  // stored and handed to the engine byte-for-byte. No transcode, no filter,
  // no normalization happens on this path; the engine itself only ever copies
  // AAC bit-for-bit or containers it losslessly for the mux.
  if (revision.voiceAssetPath === null) {
    throw new RenderJobError('approved revision carries no original voice recording');
  }
  const voiceMimeType = mimeTypeForStoredMedia(revision.voiceAssetPath);
  if (voiceMimeType === null || !voiceMimeType.startsWith('audio/')) {
    throw new RenderJobError('voice asset container is not a supported audio type');
  }
  const voiceBytes = await downloadPitchMediaObject(client, revision.voiceAssetPath);

  const assetRows = await fetchDraftAssets(client, job.pitchDraftId);
  const photos = [];
  for (const assetId of scene.assetIds) {
    const row = assetRows.get(assetId);
    if (row === undefined) {
      throw new RenderJobError(`scene references an asset the draft does not carry: ${assetId}`);
    }
    const mimeType = mimeTypeForStoredMedia(row.storagePath);
    if (mimeType === null || !mimeType.startsWith('image/')) {
      throw new RenderJobError(`scene asset is not a supported photo type: ${assetId}`);
    }
    photos.push({
      assetId,
      mimeType,
      bytes: await downloadPitchMediaObject(client, row.storagePath),
    });
  }

  // Same gating as the public player (toPitchPlayerView): words and sentences
  // travel only when the approved scene actually references them.
  const words = sceneV2ReferencesWords(scene) ? sceneWordsFromTranscript(revision.transcript) : [];
  const text = sceneV2ReferencesText(scene) ? sceneTextFromStructure(revision.structure) : null;

  return {
    sceneJson,
    assets: { photos, audio: { mimeType: voiceMimeType, bytes: voiceBytes } },
    campaignSlug,
    words,
    text,
  };
}

// ── Reads ────────────────────────────────────────────────────────────────

const revisionRowSchema = z.object({
  id: z.string().uuid(),
  pitch_draft_id: z.string().uuid(),
  voice_asset_path: z.string().nullable(),
  structure: z.unknown(),
  transcript: z.unknown(),
  // scene_definition::text — the exact serialization the DB hashed (D1).
  scene_canonical: z.string().nullable(),
});

type RevisionForRender = {
  readonly pitchDraftId: string;
  readonly voiceAssetPath: string | null;
  readonly structure: unknown;
  readonly transcript: unknown;
  readonly sceneCanonical: string | null;
};

async function fetchRevision(
  client: ServiceSupabaseClient,
  revisionId: string,
): Promise<RevisionForRender | null> {
  const { data, error } = await client
    .from('consent_revisions')
    .select(
      'id,pitch_draft_id,voice_asset_path,structure,transcript,scene_canonical:scene_definition::text',
    )
    .eq('id', revisionId)
    .maybeSingle();
  if (error !== null) {
    throw new RenderJobError('could not read the approved revision');
  }
  if (data === null) {
    return null;
  }
  const parsed = revisionRowSchema.safeParse(data);
  if (!parsed.success) {
    throw new RenderJobError('approved revision row has an unexpected shape');
  }
  return {
    pitchDraftId: parsed.data.pitch_draft_id,
    voiceAssetPath: parsed.data.voice_asset_path,
    structure: parsed.data.structure,
    transcript: parsed.data.transcript,
    sceneCanonical: parsed.data.scene_canonical,
  };
}

async function fetchCampaignSlug(
  client: ServiceSupabaseClient,
  campaignId: string,
): Promise<string | null> {
  const { data, error } = await client
    .from('campaigns')
    .select('slug')
    .eq('id', campaignId)
    .maybeSingle();
  if (error !== null) {
    throw new RenderJobError('could not read the campaign');
  }
  return data?.slug ?? null;
}

const assetRowsSchema = z.array(
  z.object({ id: z.string().uuid(), storage_path: z.string(), asset_type: z.string() }),
);

async function fetchDraftAssets(
  client: ServiceSupabaseClient,
  pitchDraftId: string,
): Promise<ReadonlyMap<string, { readonly storagePath: string }>> {
  const { data, error } = await client
    .from('pitch_assets')
    .select('id,storage_path,asset_type')
    .eq('pitch_draft_id', pitchDraftId);
  if (error !== null) {
    throw new RenderJobError('could not read the draft assets');
  }
  const parsed = assetRowsSchema.safeParse(data ?? []);
  if (!parsed.success) {
    throw new RenderJobError('draft asset rows have an unexpected shape');
  }
  return new Map(
    parsed.data
      .filter((row) => row.asset_type === 'photo')
      .map((row) => [row.id, { storagePath: row.storage_path }]),
  );
}

// ── Derivations (mirror the public player's read path) ───────────────────

const sceneTextSchema = z.object({
  hook: z.string(),
  relationship_context: z.string(),
  three_specific_qualities: z.array(z.string()),
  evidence_or_anecdote: z.string(),
  good_match_for: z.string(),
});

/**
 * The five reviewed sentences and nothing else. zod strips unknown keys, so
 * `hard_claims_requiring_confirmation` — dropped at every public read
 * boundary (view.ts publicStructure) — cannot ride into a rendered frame.
 */
function sceneTextFromStructure(structure: unknown): SceneTextFields | null {
  const parsed = sceneTextSchema.safeParse(structure);
  if (!parsed.success) {
    return null;
  }
  return {
    hook: parsed.data.hook,
    relationship_context: parsed.data.relationship_context,
    three_specific_qualities: parsed.data.three_specific_qualities,
    evidence_or_anecdote: parsed.data.evidence_or_anecdote,
    good_match_for: parsed.data.good_match_for,
  };
}

const transcriptSegmentsSchema = z
  .object({ segments: z.array(z.object({ start: z.number() }).passthrough()).catch([]) })
  .passthrough();

/**
 * Word references from the revision's frozen transcript, through the SAME
 * indexer the builder and player use (indexTranscriptWords) and the same
 * segment-window rounding as view.ts — a wordPop must land on the word the
 * Dater watched light up.
 */
function sceneWordsFromTranscript(transcript: unknown): readonly SceneWord[] {
  const parsed = transcriptSegmentsSchema.safeParse(transcript);
  if (!parsed.success) {
    return [];
  }
  const segments = parsed.data.segments.map((segment) => ({
    startMs: Math.max(0, Math.round(segment.start * 1000)),
  }));
  return indexTranscriptWords(transcript, segments).map((word) => ({
    segmentIndex: word.segmentIndex,
    wordIndex: word.wordIndex,
    text: word.text,
  }));
}

/** Queue-safe failure text: bounded, and never a signed URL or personal data. */
function failureReason(error: unknown): string {
  if (error instanceof RenderJobError) {
    return error.message.slice(0, MAX_FAILURE_REASON_CHARS);
  }
  if (error instanceof Error) {
    return `render pipeline error: ${error.message}`.slice(0, MAX_FAILURE_REASON_CHARS);
  }
  return 'render pipeline error';
}
