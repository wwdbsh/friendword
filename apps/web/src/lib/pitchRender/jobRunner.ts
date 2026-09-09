import { createHash } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import ffmpegPath from 'ffmpeg-static';

import { z } from 'zod';

import {
  buildHighlightPlan,
  buildTimedCaptionWords,
  type HighlightPlan,
  type TimedCaptionWord,
} from '@friendword/contracts';
import {
  claimMediaRenderJob,
  completeMediaRenderJob,
  fetchRenderJobChoice,
  indexTranscriptWords,
  publicDisplayName,
  recordRenderJobCut,
  type ClaimedRenderJob,
  type Json,
  type PitchRenderVariant,
  type ServiceSupabaseClient,
} from '@friendword/data';

import type { CaptionSegment } from '@/pitch/captionChrome';
import { relationshipChipLabel } from '@/pitch/view';
import { sceneV2ReferencesText, type SceneTextFields, type SceneWord } from '@/pitch/sceneV2';

import { extractOpeningFrames } from './openingFrames';
import type { RenderOverlayStage } from './overlay';
import { stageIntroducerLabel } from './overlay';

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

/**
 * The name printed when a display name is not publicly showable — the same
 * fallback the published page and the OG card already use, so the MP4 never
 * says something about a person their own page does not.
 */
const NAME_FALLBACK = 'A friend';

/**
 * §0 rollback, and the rollout switch.
 *
 * Default OFF: until the kit UI ships (T005) nobody can CHOOSE a variant, so a
 * worker that defaulted to on would start shipping cut MP4s for jobs whose
 * requesters were never offered the choice. Deploy order is therefore
 * migration -> this code (inert) -> kit UI -> flip the flag. Off, every job
 * takes the pre-2026-09-09 path: the full approved timeline, the original
 * audio copied bit for bit, no overlay, the 1.5s end card.
 *
 * Only the exact string 'true' (or '1') enables it — a typo must fail closed.
 */
export function highlightRenderEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.RENDER_HIGHLIGHT_ENABLED === 'true' || env.RENDER_HIGHLIGHT_ENABLED === '1';
}

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
      captions: inputs.captions,
      timeBudgetMs,
      variant: inputs.variant,
      cutWindows: inputs.plan?.windows ?? null,
      music: inputs.music,
      overlayStage: inputs.overlayStage,
      timedWords: inputs.timedWords,
      daterName: inputs.daterName,
      // §2.6: the cut identifies the bed; without a cut the scene does.
      musicSeed: inputs.plan?.hash ?? job.sceneHash,
      // §2.2-4: the selfie opening, or nothing at all.
      openingFrames: inputs.openingFrames,
    });

    const outputStoragePath = renderOutputStoragePath(job.pitchDraftId, job.revisionId);
    await uploadRenderOutput(client, outputStoragePath, mp4);

    // §2.1 note 5: what the worker actually rendered, recorded on the job row
    // before the completion that publishes it. Written on EVERY success — a
    // NULL effective_variant may only ever mean "completed before 0063", which
    // stays true only because this line never skips.
    try {
      await recordRenderJobCut(client, job.jobId, job.leaseToken, {
        effectiveVariant: stats.effectiveVariant,
        cutPlan: stats.effectiveVariant === 'highlight' ? highlightPlanJson(inputs.plan) : null,
        cutHash: stats.effectiveVariant === 'highlight' ? (inputs.plan?.hash ?? null) : null,
      });
    } catch {
      // Most often a lapsed lease: another worker owns this job now. Reporting
      // success here would publish an MP4 whose effective_variant was never
      // written, and the product reads a NULL there as "rendered before 0063".
      throw new RenderJobError(
        'the render job lease no longer holds; the cut record was not written',
      );
    }

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
  readonly captions: readonly CaptionSegment[];
  readonly variant: PitchRenderVariant;
  readonly music: boolean;
  /** Null when the transcript could not support a cut (§1 rule 5). */
  readonly plan: HighlightPlan | null;
  readonly overlayStage: RenderOverlayStage | null;
  readonly timedWords: readonly TimedCaptionWord[] | null;
  readonly daterName: string;
  /**
   * §2.2-4: the stills of the approved selfie clip, or empty. Empty is every
   * pitch without one, and the render is then byte-identical to today's.
   */
  readonly openingFrames: readonly Uint8Array[];
};

/** The plan as JSONB — a plain object, so PostgREST stores it as written. */
function highlightPlanJson(plan: HighlightPlan | null): Json | null {
  if (plan === null) {
    return null;
  }
  return {
    version: plan.version,
    windows: plan.windows.map((window) => ({
      startMs: window.startMs,
      endMs: window.endMs,
      reason: window.reason,
    })),
    totalMs: plan.totalMs,
    hash: plan.hash,
  };
}

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

  // The five reviewed sentences still travel only when the approved scene
  // actually names one (same gating as the public player, toPitchPlayerView).
  const text = sceneV2ReferencesText(scene) ? sceneTextFromStructure(revision.structure) : null;
  // Words are no longer gated on the scene: since T017 the caption chrome reads
  // them too, to pick the one highlighted word per segment. They come from the
  // same frozen transcript the caption text itself comes from, so gating them
  // would only make the MP4's highlight disagree with the web player's.
  const words = sceneWordsFromTranscript(revision.transcript);
  const captions = captionsFromTranscript(revision.transcript);

  // ── §2.1/§2.2: which MP4 this job asked for, and what it can actually be ──
  //
  // The rollback flag wins over the row: with RENDER_HIGHLIGHT_ENABLED=false
  // every job is the render this pipeline shipped before, whatever the export
  // card recorded (§0 rollback, §6).
  const enabled = highlightRenderEnabled();
  const choice = enabled
    ? await fetchRenderJobChoice(client, job.jobId)
    : { variant: 'full' as const, options: {} };
  const variant: PitchRenderVariant = enabled ? choice.variant : 'full';
  const music = enabled && choice.options.music === true;

  const people = await fetchRenderPeople(client, job.campaignId, job.pitchDraftId);

  // §1: the cut plan, from the FROZEN transcript and the reviewed structure —
  // the same two documents the captions come from. Null (fewer than two
  // segments, or no transcript) means the highlight is impossible and the
  // engine renders full; §2.2-1.
  const plan =
    variant === 'highlight'
      ? buildHighlightPlan({
          segments: transcriptSegmentsForPlan(revision.transcript),
          structure: text,
          daterDisplayName: people.daterName,
          // Rule 4: prefer cutting where the scene already cuts, so a window
          // edge never lands mid-Ken-Burns.
          shotBoundariesMs: scene.shots.map((shot) => shot.startMs),
        })
      : null;

  // §2.4: word captions when the transcript carries timings (production has
  // them on everything recorded since 2026-08-09), segment captions otherwise.
  const timedWords = buildTimedCaptionWords(indexedWordsFromTranscript(revision.transcript));

  // ── §2.2-4: the selfie opening ────────────────────────────────────────
  //
  // Four gates, all of which must hold, and every one of them is somebody's
  // decision rather than a heuristic:
  //   - RENDER_HIGHLIGHT_ENABLED, the rollback switch (`enabled`);
  //   - the job asked for a highlight AND a cut plan exists, i.e. the render
  //     will actually BE a highlight (§2.2-1 would otherwise fall back to full,
  //     which draws no chrome for the opening to sit under);
  //   - the clip is in the APPROVED SNAPSHOT — the Dater ticked it on the
  //     consent screen, which is the only way an asset id gets into
  //     `consent_revisions.asset_ids` (§0 verdict 4a);
  //   - its ingest SUCCEEDED, which is what makes a proxy exist at all and
  //     what carries the frame-by-frame moderation verdict.
  const openingFrames =
    enabled && variant === 'highlight' && plan !== null
      ? await extractSelfieOpening(client, {
          pitchDraftId: job.pitchDraftId,
          snapshotAssetIds: revision.assetIds,
          renderKey: job.revisionId,
          fps: scene.canvas.fps,
        })
      : [];

  const overlayStage: RenderOverlayStage | null =
    variant === 'highlight' || music
      ? {
          introducerLabel: stageIntroducerLabel(people.introducerName),
          daterName: people.daterName,
          relationshipChip: people.relationshipChip,
        }
      : null;

  return {
    sceneJson,
    assets: { photos, audio: { mimeType: voiceMimeType, bytes: voiceBytes } },
    campaignSlug,
    words,
    text,
    captions,
    variant,
    music,
    plan,
    overlayStage,
    timedWords,
    daterName: people.daterName,
    openingFrames,
  };
}

// ── Reads ────────────────────────────────────────────────────────────────

const revisionRowSchema = z.object({
  id: z.string().uuid(),
  pitch_draft_id: z.string().uuid(),
  asset_ids: z.array(z.string().uuid()),
  voice_asset_path: z.string().nullable(),
  structure: z.unknown(),
  transcript: z.unknown(),
  // scene_definition::text — the exact serialization the DB hashed (D1).
  scene_canonical: z.string().nullable(),
});

type RevisionForRender = {
  readonly pitchDraftId: string;
  /** The APPROVED snapshot. Nothing outside it may enter the MP4. */
  readonly assetIds: readonly string[];
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
      'id,pitch_draft_id,asset_ids,voice_asset_path,structure,transcript,scene_canonical:scene_definition::text',
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
    assetIds: parsed.data.asset_ids,
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

/** The two names and the relationship chip the stage chrome prints (§2.3). */
type RenderPeople = {
  readonly daterName: string;
  readonly introducerName: string;
  readonly relationshipChip: string | null;
};

const campaignOwnerSchema = z.object({ owner_user_id: z.string().uuid() });
const draftPeopleSchema = z.object({
  created_by_user_id: z.string().uuid(),
  relationship_type: z.string().nullable(),
  relationship_duration: z.string().nullable(),
});
const profileRowsSchema = z.array(
  z.object({
    user_id: z.string().uuid(),
    display_name: z.string(),
    display_name_confirmed: z.boolean(),
  }),
);

/**
 * Names for the burned-in stage chrome.
 *
 * Both go through `publicDisplayName`, the same gate the published page and the
 * OG card use: a display name the bootstrap invented from an email local part
 * is NOT a name to burn into a file that will be posted publicly, and an
 * unconfirmed one becomes the page's own 'A friend'. A downloaded MP4 cannot be
 * recalled, so this is the one place a fallback matters most.
 */
async function fetchRenderPeople(
  client: ServiceSupabaseClient,
  campaignId: string,
  pitchDraftId: string,
): Promise<RenderPeople> {
  const [{ data: campaign }, { data: draft }] = await Promise.all([
    client.from('campaigns').select('owner_user_id').eq('id', campaignId).maybeSingle(),
    client
      .from('pitch_drafts')
      .select('created_by_user_id,relationship_type,relationship_duration')
      .eq('id', pitchDraftId)
      .maybeSingle(),
  ]);
  const owner = campaignOwnerSchema.safeParse(campaign);
  const people = draftPeopleSchema.safeParse(draft);
  if (!owner.success || !people.success) {
    // Not fatal: the reel is still the approved scene, it just gets no names.
    return { daterName: NAME_FALLBACK, introducerName: NAME_FALLBACK, relationshipChip: null };
  }
  const { data: profiles } = await client
    .from('profiles')
    .select('user_id,display_name,display_name_confirmed')
    .in('user_id', [owner.data.owner_user_id, people.data.created_by_user_id]);
  const parsed = profileRowsSchema.safeParse(profiles ?? []);
  const find = (userId: string): string =>
    (parsed.success
      ? publicDisplayName(parsed.data.find((row) => row.user_id === userId))
      : null) ?? NAME_FALLBACK;
  return {
    daterName: find(owner.data.owner_user_id),
    introducerName: find(people.data.created_by_user_id),
    relationshipChip: relationshipChipLabel(
      people.data.relationship_type,
      people.data.relationship_duration,
    ),
  };
}

/**
 * §2.2-4 — the approved selfie clip's opening stills, or nothing.
 *
 * Service role only, by construction: `pitch_video_ingests` is unreadable by
 * every client role (0050), so the proxy path and the verdict that guards it can
 * only be seen from here. The bytes are pulled with the SAME storage helper the
 * voice and the photos use, and the extraction never touches the original —
 * success deleted it (`original_deleted_at`); the proxy is all there is.
 *
 * Any missing piece is an ABSENT opening, never a partial one, and never a
 * failed render: no selfie asset in the snapshot, no succeeded ingest, no proxy
 * path, a proxy that will not download, and a proxy ffmpeg cannot decode all
 * mean "render exactly what this pipeline rendered yesterday". The opening is a
 * decoration on a derivative; losing it must never cost the Dater the MP4 their
 * approval paid for. The reason is logged so a systematically broken proxy
 * pipeline is visible rather than silent.
 */
const selfieAssetRowsSchema = z.array(
  z.object({ id: z.string().uuid(), storage_path: z.string(), sort_order: z.number() }),
);
const selfieIngestRowSchema = z.object({ proxy_path: z.string() });

async function extractSelfieOpening(
  client: ServiceSupabaseClient,
  input: {
    readonly pitchDraftId: string;
    readonly snapshotAssetIds: readonly string[];
    readonly renderKey: string;
    readonly fps: number;
  },
): Promise<readonly Uint8Array[]> {
  if (input.snapshotAssetIds.length === 0) {
    return [];
  }
  const { data, error } = await client
    .from('pitch_assets')
    .select('id,storage_path,sort_order')
    .eq('pitch_draft_id', input.pitchDraftId)
    .eq('asset_type', 'video')
    .eq('asset_role', 'selfie')
    .in('id', [...input.snapshotAssetIds])
    .order('sort_order', { ascending: true })
    .order('id', { ascending: true });
  if (error !== null) {
    throw new RenderJobError('could not read the selfie clip for the opening');
  }
  const assets = selfieAssetRowsSchema.safeParse(data ?? []);
  if (!assets.success) {
    throw new RenderJobError('selfie asset rows have an unexpected shape');
  }
  // One opening, deterministically the first by (sort_order, id). A second
  // selfie is simply not the opening — never a coin flip between two.
  const asset = assets.data[0];
  if (asset === undefined) {
    return [];
  }

  const { data: ingestData, error: ingestError } = await client
    .from('pitch_video_ingests')
    .select('proxy_path')
    .eq('asset_id', asset.id)
    .eq('ingest_status', 'succeeded')
    .maybeSingle();
  if (ingestError !== null) {
    throw new RenderJobError('could not read the selfie clip ingest verdict');
  }
  const ingest = selfieIngestRowSchema.safeParse(ingestData);
  if (!ingest.success) {
    // Pending, flagged, failed, or a succeeded row without a proxy: no opening.
    return [];
  }

  if (ffmpegPath === null) {
    console.warn('pitch render: no ffmpeg binary for the selfie opening; rendering without it');
    return [];
  }
  const workDir = path.join(os.tmpdir(), 'friendword-pitch-render');
  const proxyPath = path.join(workDir, `${input.renderKey}.selfie-proxy`);
  try {
    await mkdir(workDir, { recursive: true });
    await writeFile(proxyPath, await downloadPitchMediaObject(client, ingest.data.proxy_path));
    return await extractOpeningFrames({
      ffmpegPath,
      videoPath: proxyPath,
      fps: input.fps,
      workDir,
      prefix: `${input.renderKey}.selfie`,
    });
  } catch (error) {
    // Named, not swallowed: the storage path is safe to print (it is an object
    // name, not content), and nothing about the person in the clip is.
    console.warn(
      `pitch render: the selfie opening could not be prepared, rendering without it: ${
        error instanceof Error ? error.message : 'unknown error'
      }`,
    );
    return [];
  } finally {
    await rm(proxyPath, { force: true });
  }
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

/**
 * The segments the cut plan selects over: whole sentences, in provider order,
 * with the provider's own seconds. Same list the caption band reads, so a
 * window boundary is always a boundary the Dater saw.
 */
function transcriptSegmentsForPlan(
  transcript: unknown,
): readonly { readonly start: number; readonly end: number; readonly text: string }[] {
  const parsed = transcriptCaptionsSchema.safeParse(transcript);
  if (!parsed.success) {
    return [];
  }
  const segments: { start: number; end: number; text: string }[] = [];
  for (const segment of parsed.data.segments) {
    if (segment === null) {
      continue;
    }
    segments.push({ start: segment.start, end: segment.end, text: segment.text });
  }
  return segments;
}

/** Structurally `IndexedTranscriptWord`, and what buildTimedCaptionWords eats. */
type IndexedWordForCaptions = {
  readonly segmentIndex: number;
  readonly wordIndex: number;
  readonly startMs: number;
  readonly endMs: number;
  readonly text: string;
};

/**
 * Word timings through the SINGLE mapping (`indexTranscriptWords`, T002
 * decision): the MP4's word captions must light up the same words the approved
 * wordPop effects reference, so a second numbering rule is not allowed to exist.
 */
function indexedWordsFromTranscript(transcript: unknown): readonly IndexedWordForCaptions[] {
  const parsed = transcriptSegmentsSchema.safeParse(transcript);
  if (!parsed.success) {
    return [];
  }
  return indexTranscriptWords(
    transcript,
    parsed.data.segments.map((segment) => ({
      startMs: Math.max(0, Math.round(segment.start * 1000)),
    })),
  );
}

const transcriptCaptionsSchema = z
  .object({
    segments: z
      .array(
        z
          .object({ start: z.number(), end: z.number(), text: z.string() })
          .passthrough()
          .nullable()
          .catch(null),
      )
      .catch([]),
  })
  .passthrough();

/**
 * The MP4's subtitle band (T017), from the SAME frozen transcript segments the
 * published page prints and the Dater read at consent — never a re-transcribe
 * and never generated copy.
 *
 * `segmentIndex` is the position in the FULL segment list, kept even when an
 * unreadable entry is dropped: a keyword highlight is a (segmentIndex,
 * wordIndex) pair, so renumbering would move the accent to another sentence.
 * Timestamp rounding matches view.ts exactly, so both surfaces cut at the same
 * millisecond.
 */
function captionsFromTranscript(transcript: unknown): readonly CaptionSegment[] {
  const parsed = transcriptCaptionsSchema.safeParse(transcript);
  if (!parsed.success) {
    return [];
  }
  const captions: CaptionSegment[] = [];
  parsed.data.segments.forEach((segment, segmentIndex) => {
    if (segment === null || segment.text.trim().length === 0) {
      return;
    }
    captions.push({
      segmentIndex,
      startMs: Math.max(0, Math.round(segment.start * 1000)),
      endMs: Math.max(1, Math.round(segment.end * 1000)),
      text: segment.text.trim(),
    });
  });
  return captions;
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
