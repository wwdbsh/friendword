'use client';

import { useCallback, useEffect, useState } from 'react';

import {
  DataLayerError,
  RenderJobRepo,
  trackEvent,
  type BrowserSupabaseClient,
  type PitchRenderState,
  type PitchRenderVariant,
} from '@friendword/data';

import { EmailSignIn } from '@/components/EmailSignIn';
import { renderDownloadFilename } from '@/lib/renderDownload';

import styles from '@/styles/flowCard.module.css';

// Poll only while a render is queued or leased, with backoff and unmount
// cleanup — a finished or failed job stops the chain via the effect deps.
const POLL_INITIAL_MS = 4_000;
const POLL_BACKOFF = 1.5;
const POLL_MAX_MS = 30_000;

// Copy audit (§12): every sentence here states something the 0054 contract
// makes true. No render-time estimates (queue wait is unbounded), no reach or
// performance claims, and the two refusal shapes stay separate: "already in
// progress" consumed NOTHING and must never read as a payment prompt, while
// "campaign pass required" means the free render is genuinely spent.
const EXPLAINER_COPY =
  'Export the approved pitch as a 1080×1920 MP4 — the same motion and voice as the public page, ending with a short Friendword card that shows this page’s address.';
const FREE_AVAILABLE_COPY =
  'The first export this campaign finishes is free. A failed attempt doesn’t use it.';
const PASS_COVERS_COPY =
  'This campaign’s free export is used — your active Campaign Pass covers exporting again.';
const FREE_USED_COPY =
  'This campaign’s free export is used. Exporting a new version needs an active Campaign Pass.';
// T005 §4. The choice is made BEFORE the render because 0054 keeps ONE job per
// approved revision: the request is idempotent and a second one hands back the
// stored job rather than re-pointing it, so "pick before you export" is the
// literal truth of the server contract, not a UI preference.
const CHOICE_TITLE = 'Pick the cut before you export.';
function choiceIntro(daterName: string | null): string {
  // The Dater's public display name is not readable from this page (profiles
  // are select-own under RLS), so the sentence keeps its shape with the same
  // neutral stand-in the rest of the kit uses when a name is not showable.
  return `One MP4 per approved version — pick before you export. Highlight uses only what ${daterName ?? 'your friend'} approved: same words, shorter cut.`;
}
const HIGHLIGHT_LABEL = 'Highlight (15–30s)';
const FULL_LABEL = 'Full';
const MUSIC_LABEL = 'Add a music bed';
const RECORDED_CHOICE_PREFIX = 'This export was requested as';
const MUSIC_ON_COPY = 'music on';
const MUSIC_OFF_COPY = 'no music';
const RENDERING_COPY = 'Rendering your MP4…';
const RENDERING_DETAIL_COPY =
  'The export runs on our side. You can leave this page; it keeps running and its result shows here.';
const READY_COPY = 'Your MP4 is ready.';
const READY_DETAIL_COPY =
  'A vertical 1080×1920 video. It ends with a short Friendword card showing this page’s address.';
const STALE_COPY =
  'This finished MP4 is from an earlier approved version of the page — the page has changed since.';
const FAILED_COPY = 'The export failed.';
const FAILED_DETAIL_COPY = 'A failed export doesn’t use the free export. You can try again.';
const IN_PROGRESS_COPY =
  'A render for this campaign is already running. Nothing was used — wait for it to finish and check back here.';
const PASS_REQUIRED_COPY =
  'This campaign’s free export is used, so this export needs an active Campaign Pass. Purchase it in the Friendword app, then come back here.';
const RETRY_LIMIT_COPY = 'Too many export retries in the last hour. Wait a while and try again.';
const CAMPAIGN_CLOSED_COPY =
  'Exports are available while the page is published and open. This page isn’t open right now.';
const NOTHING_TO_EXPORT_COPY = 'There’s no approved motion pitch to export yet.';
const REQUEST_ERROR_COPY = 'We couldn’t start the export. Please try again.';
// Covers both halves of the repaired path (GAP-9): the request never
// answered, or it answered with fewer bytes than it promised. "Didn't
// complete" is true of both and never claims a file was saved.
const DOWNLOAD_ERROR_COPY = 'The download didn’t complete. Please try again.';
// M-16: a 401 from render-download is NOT the failure above. The route
// answers 401 only when it has no bearer token or `auth.getUser` rejects the
// one it was given — the session is gone, server-side, even though this tab
// still holds a token object. "Try again" is a lie there: every retry sends
// the same dead token. Say what actually has to happen, and put the form
// that does it directly under the sentence.
const DOWNLOAD_SIGNED_OUT_COPY =
  'Your session expired, so we couldn’t fetch the file. Sign in again and the download will work — your export is safe.';
const STATE_ERROR_COPY = 'The export status could not load. Refresh to try again.';

/**
 * Which cut this campaign's job is on record as (0063).
 *
 * `effective_variant` is what the worker actually rendered and therefore wins
 * whenever it exists. When it is null the row has not been through a
 * 0063-aware worker: a FINISHED job like that predates the highlight pipeline
 * entirely and its MP4 is the full timeline, whatever `variant` says — the
 * column was added with DEFAULT 'highlight', so every pre-0063 row reads
 * 'highlight' and believing it would mislabel files that already exist.
 * A job still in flight (or reset to failed) has no rendered file yet, so its
 * requested `variant` is the honest answer.
 */
export function recordedRenderVariant(state: PitchRenderState): PitchRenderVariant {
  if (state.effectiveVariant !== null) {
    return state.effectiveVariant;
  }
  if (state.jobStatus === 'done') {
    return 'full';
  }
  return state.variant ?? 'full';
}

/** Marks the one download failure that retrying cannot fix (M-16). */
class DownloadSignedOutError extends Error {
  override readonly name = 'DownloadSignedOutError';
}

type ExportView = {
  readonly renderState: PitchRenderState;
  readonly approvedRevisionId: string | null;
};

/**
 * The revision the campaign would render NOW — the same pick
 * request_pitch_render makes (0054: latest approved consent_request by
 * responded_at DESC NULLS LAST, id). getRenderState returns the latest JOB,
 * which after a re-approval can still be the previous revision's finished
 * file; comparing against this id is what lets the card say so instead of
 * serving an outdated video as current.
 */
async function fetchApprovedRevisionId(
  client: BrowserSupabaseClient,
  draftId: string,
): Promise<string | null> {
  const { data, error } = await client
    .from('consent_requests')
    .select('revision_id')
    .eq('pitch_draft_id', draftId)
    .eq('status', 'approved')
    .order('responded_at', { ascending: false, nullsFirst: false })
    .order('id', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error !== null) {
    throw new DataLayerError('render.approvedRevision', error);
  }
  return data?.revision_id ?? null;
}

/** PostgREST errors can be plain objects; read .message structurally. */
function errorDetail(error: unknown): string {
  const cause = error instanceof DataLayerError ? error.cause : error;
  return typeof cause === 'object' &&
    cause !== null &&
    'message' in cause &&
    typeof cause.message === 'string'
    ? cause.message
    : typeof cause === 'string'
      ? cause
      : String(cause);
}

/**
 * The entitlement facts, verbatim from the server state (E4): consumption
 * happens at render SUCCESS, so "requesting spends the free export" would be
 * false and is never said.
 */
function entitlementLine(renderState: PitchRenderState): string {
  if (!renderState.freeRenderUsed) {
    return FREE_AVAILABLE_COPY;
  }
  return renderState.passActive ? PASS_COVERS_COPY : FREE_USED_COPY;
}

/**
 * MP4 export of the approved motion pitch (Phase 4). Renders on the kit page
 * for any campaign the introducer can see there; the server RPCs own every
 * gate (membership, campaign openness, free-vs-pass), so this card only
 * reports their answers.
 */
export function PitchExportCard({
  client,
  draftId,
  campaignId,
  campaignSlug,
  daterName = null,
}: {
  readonly client: BrowserSupabaseClient;
  readonly draftId: string;
  readonly campaignId: string;
  readonly campaignSlug: string | null;
  /** The Dater's public display name when the page has one (publicDisplayName). */
  readonly daterName?: string | null;
}) {
  const [view, setView] = useState<ExportView | 'loading' | 'error'>('loading');
  const [requesting, setRequesting] = useState(false);
  // The pre-render choice (T005 §4). Defaults are the contract's: highlight,
  // music on. Both are inert once a job exists — the recorded choice is then
  // read back from the server state instead.
  const [variant, setVariant] = useState<PitchRenderVariant>('highlight');
  const [music, setMusic] = useState(true);
  const [downloading, setDownloading] = useState(false);
  // "In progress" is information, not an error, and NEVER a payment prompt
  // (E2): nothing was consumed, waiting is free, so it renders as a status
  // line while passNeeded gets its own separate, deliberately unmergeable
  // rendering path.
  const [waitNotice, setWaitNotice] = useState<string | null>(null);
  const [passNeeded, setPassNeeded] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  // Kept apart from actionError (M-16): this state renders a sign-in form, not
  // a retry line, and must not be cleared by a subsequent retryable failure.
  const [downloadSignedOut, setDownloadSignedOut] = useState(false);

  const load = useCallback(async () => {
    try {
      const repo = new RenderJobRepo(client);
      const [renderState, approvedRevisionId] = await Promise.all([
        repo.getRenderState(campaignId),
        fetchApprovedRevisionId(client, draftId),
      ]);
      setView({ renderState, approvedRevisionId });
    } catch {
      setView('error');
    }
  }, [client, campaignId, draftId]);

  // Best-effort push of the render worker (the queue has no cron): the kick
  // route relays to the secret-gated worker on our behalf, because a browser
  // must never hold that secret. Fired once per successful export request and
  // once per poll tick while a render is in flight. Strictly fire-and-forget —
  // a kick failure changes nothing here (the next tick kicks again), and the
  // 202 never says whether a worker actually started.
  const kickRenderWorker = useCallback(async () => {
    try {
      const { data, error } = await client.auth.getSession();
      const accessToken = data.session?.access_token;
      if (error !== null || accessToken === undefined) {
        return;
      }
      await fetch('/api/media/render-kick', {
        method: 'POST',
        headers: { authorization: `Bearer ${accessToken}` },
      });
    } catch {
      // Best-effort by design; the poll (or an operator) pushes again.
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  const ready = typeof view === 'object' ? view : null;
  const renderState = ready?.renderState ?? null;
  const jobStatus = renderState?.jobStatus ?? null;
  const rendering = jobStatus === 'queued' || jobStatus === 'leased';

  // Poll while a render is in flight. The deps are the derived boolean, not
  // the state object the tick writes, so a poll that returns "still queued"
  // cannot re-run (and thereby cancel) its own effect — the failure mode the
  // tests-ui suite exists to catch.
  useEffect(() => {
    if (!rendering) {
      return;
    }
    let cancelled = false;
    let timer: number | undefined;
    let delay = POLL_INITIAL_MS;
    const schedule = () => {
      timer = window.setTimeout(() => {
        // Each tick that still sees a render in flight also pushes the worker
        // once — the same opportunistic pattern the ingest poll uses.
        void kickRenderWorker();
        void load().finally(() => {
          if (!cancelled) {
            delay = Math.min(Math.round(delay * POLL_BACKOFF), POLL_MAX_MS);
            schedule();
          }
        });
      }, delay);
    };
    schedule();
    return () => {
      cancelled = true;
      if (timer !== undefined) {
        window.clearTimeout(timer);
      }
    };
  }, [rendering, load, kickRenderWorker]);

  async function handleExport(choice: {
    readonly variant: PitchRenderVariant;
    readonly options: { readonly music: boolean };
  }) {
    setRequesting(true);
    setActionError(null);
    setWaitNotice(null);
    setPassNeeded(false);
    try {
      await new RenderJobRepo(client).requestRender(campaignId, choice);
      // The job is durable in the queue; now give the worker its first push.
      void kickRenderWorker();
      await load();
    } catch (error: unknown) {
      const detail = errorDetail(error);
      if (detail.includes('already in progress')) {
        // Nothing was consumed; the running sibling job is the state to show.
        setWaitNotice(IN_PROGRESS_COPY);
        await load();
      } else if (detail.includes('campaign pass required')) {
        setPassNeeded(true);
        trackEvent(client, 'campaign_pass_paywall_viewed', { campaign_id: campaignId });
      } else if (detail.includes('retry rate limit')) {
        setActionError(RETRY_LIMIT_COPY);
      } else if (detail.includes('must be open')) {
        setActionError(CAMPAIGN_CLOSED_COPY);
      } else if (
        detail.includes('no approved consent revision') ||
        detail.includes('no approved motion scene')
      ) {
        setActionError(NOTHING_TO_EXPORT_COPY);
      } else {
        setActionError(REQUEST_ERROR_COPY);
      }
    } finally {
      setRequesting(false);
    }
  }

  async function handleDownload(revisionId: string, downloadVariant: PitchRenderVariant) {
    setDownloading(true);
    setActionError(null);
    setDownloadSignedOut(false);
    let objectUrl: string | null = null;
    try {
      const { data, error } = await client.auth.getSession();
      const accessToken = data.session?.access_token;
      if (error !== null || accessToken === undefined) {
        // Same condition the route would answer 401 to, caught one hop early.
        throw new DownloadSignedOutError('download requires a session');
      }
      // The MP4 lives under pitch-media/<draft>/renders/, a nested prefix the
      // member storage policy cannot see (deliberately, 0054), so the bytes
      // come from the draft-scoped route beside this page (E5). That route
      // STREAMS them from our own origin rather than handing back a signed
      // Supabase URL, and the difference is the whole reason this function
      // reads the way it does (GAP-9):
      //
      //   - `download` on an anchor is inert cross-origin. Pointed at a
      //     foreign URL it could neither guarantee a save nor name the file;
      //     pointed at a same-origin blob, both are ours.
      //   - a browser that renders video/mp4 inline used to NAVIGATE THIS PAGE
      //     AWAY into a player — the person lost the kit and got no file.
      //   - a failure arrived as a storage error document replacing the app.
      //     Now it is a status code, and the card says so in place.
      const response = await fetch(
        `/kit/${draftId}/render-download?revisionId=${encodeURIComponent(revisionId)}`,
        { headers: { authorization: `Bearer ${accessToken}` } },
      );
      if (response.status === 401) {
        throw new DownloadSignedOutError('download session revoked');
      }
      if (!response.ok) {
        throw new Error('download unavailable');
      }
      const declaredLength = Number.parseInt(response.headers.get('content-length') ?? '', 10);
      const blob = await response.blob();
      // A truncated video is worse than a failed download: it saves, it plays
      // for a few seconds, and the person posts it. Refuse it instead.
      if (Number.isFinite(declaredLength) && declaredLength > 0 && blob.size !== declaredLength) {
        throw new Error('download incomplete');
      }
      if (blob.size === 0) {
        throw new Error('download empty');
      }
      objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.rel = 'noopener';
      anchor.download = renderDownloadFilename(downloadVariant);
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      trackEvent(client, 'campaign_shared', {
        campaign_slug: campaignSlug,
        channel: 'kit_mp4_download',
      });
    } catch (error: unknown) {
      if (error instanceof DownloadSignedOutError) {
        setActionError(null);
        setDownloadSignedOut(true);
      } else {
        setActionError(DOWNLOAD_ERROR_COPY);
      }
    } finally {
      if (objectUrl !== null) {
        // The click has already handed the blob to the download manager; the
        // handle is only revoked on the next tick so the navigation it starts
        // is not cancelled underneath it.
        const revoked = objectUrl;
        window.setTimeout(() => URL.revokeObjectURL(revoked), 0);
      }
      setDownloading(false);
    }
  }

  // E3: getRenderState returns the campaign's LATEST job, so right after the
  // Dater approves a new revision the finished file on record can belong to
  // the previous one. Say so instead of serving it as current.
  const doneRevisionId =
    jobStatus === 'done' && renderState !== null ? renderState.revisionId : null;
  const stale =
    doneRevisionId !== null &&
    ready !== null &&
    ready.approvedRevisionId !== null &&
    doneRevisionId !== ready.approvedRevisionId;

  // Which job the state row is actually about. getRenderState returns the
  // campaign's LATEST job, which after a re-approval belongs to the PREVIOUS
  // revision — so "a job exists" is not the same question as "this export is
  // already decided". Only a job whose revision is the one the server would
  // render now (0063 §3: request_pitch_render derives it the same way
  // fetchApprovedRevisionId does) has a choice that binds.
  const jobIsForApprovedRevision =
    ready !== null &&
    renderState !== null &&
    renderState.revisionId !== null &&
    ready.approvedRevisionId !== null &&
    renderState.revisionId === ready.approvedRevisionId;

  // The choice belongs to a job for its life (§0 verdict 2) — but only that
  // job's. The chooser comes back when there is nothing recorded for the
  // approved revision (a new revision, incl. the paid Campaign-Pass export) and
  // when the recorded job is `failed`, because the RPC's reset path explicitly
  // re-opens variant and options for a terminal failure (0063 §3).
  const chooserOpen = !jobIsForApprovedRevision || jobStatus === 'failed';

  // What is on record for the approved revision, shown only while it is locked;
  // with the chooser open, stating a recorded choice beside a live one would
  // contradict it.
  const recorded =
    !chooserOpen && renderState !== null
      ? {
          variant: recordedRenderVariant(renderState),
          options: { music: renderState.options?.music === true },
        }
      : null;
  // The FILE's cut, which is a fact about the job that produced it whether or
  // not that job is the approved revision's — an earlier-version download must
  // still be named after the cut it actually contains.
  const fileVariant: PitchRenderVariant =
    renderState !== null && jobStatus !== null ? recordedRenderVariant(renderState) : 'full';
  // What an export button sends: with the chooser open that is the live choice,
  // never a previous job's recorded one.
  const pendingChoice = { variant, options: { music } };
  const exportLabel = requesting
    ? 'Requesting…'
    : stale
      ? 'Export the current version'
      : jobStatus === 'failed' && jobIsForApprovedRevision
        ? 'Try the export again'
        : 'Export the MP4';

  return (
    <section className={styles.card} data-pitch-export>
      <span className={styles.badge}>Reel export</span>
      <h2 className={styles.subTitle}>Post the pitch as a video.</h2>
      <p className={styles.muted}>{EXPLAINER_COPY}</p>

      {view === 'loading' && (
        <p className={styles.muted} aria-live="polite">
          Checking this campaign’s export…
        </p>
      )}
      {view === 'error' && <p className={styles.error}>{STATE_ERROR_COPY}</p>}

      {renderState !== null && (
        <>
          <p className={styles.finePrint}>{entitlementLine(renderState)}</p>

          {recorded !== null && (
            <p className={styles.finePrint} data-render-choice-recorded>
              {`${RECORDED_CHOICE_PREFIX} ${
                recorded.variant === 'highlight' ? HIGHLIGHT_LABEL : FULL_LABEL
              }, ${recorded.options.music ? MUSIC_ON_COPY : MUSIC_OFF_COPY}.`}
            </p>
          )}

          {rendering && (
            <div aria-live="polite">
              <p className={styles.muted}>{RENDERING_COPY}</p>
              <p className={styles.finePrint}>{RENDERING_DETAIL_COPY}</p>
            </div>
          )}

          {doneRevisionId !== null && !stale && (
            <>
              <p className={styles.muted}>{READY_COPY}</p>
              <p className={styles.finePrint}>{READY_DETAIL_COPY}</p>
              <button
                className={styles.primary}
                type="button"
                disabled={downloading}
                onClick={() => {
                  void handleDownload(doneRevisionId, fileVariant);
                }}
              >
                {downloading ? 'Preparing…' : 'Download the MP4'}
              </button>
            </>
          )}

          {doneRevisionId !== null && stale && (
            <>
              <p className={styles.muted} role="status" data-render-stale>
                {STALE_COPY}
              </p>
              <div className={styles.actionRow}>
                <button
                  className={styles.secondary}
                  type="button"
                  disabled={downloading}
                  onClick={() => {
                    void handleDownload(doneRevisionId, fileVariant);
                  }}
                >
                  {downloading ? 'Preparing…' : 'Download the earlier version'}
                </button>
              </div>
            </>
          )}

          {jobStatus === 'failed' && jobIsForApprovedRevision && (
            <>
              <p className={styles.muted}>{FAILED_COPY}</p>
              <p className={styles.finePrint}>{FAILED_DETAIL_COPY}</p>
            </>
          )}

          {chooserOpen && (
            <div data-render-choice>
              <h3 className={styles.subTitle}>{CHOICE_TITLE}</h3>
              <p className={styles.muted}>{choiceIntro(daterName)}</p>
              <div className={styles.chipRow} role="group" aria-label="Cut">
                {(
                  [
                    ['highlight', HIGHLIGHT_LABEL],
                    ['full', FULL_LABEL],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    className={`${styles.chip} ${variant === value ? styles.chipActive : ''}`}
                    type="button"
                    aria-pressed={variant === value}
                    data-render-variant={value}
                    disabled={requesting}
                    onClick={() => setVariant(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <label className={styles.confirmationRow}>
                <input
                  type="checkbox"
                  checked={music}
                  data-render-music
                  disabled={requesting}
                  onChange={(event) => setMusic(event.target.checked)}
                />
                {MUSIC_LABEL}
              </label>
              <button
                className={styles.primary}
                type="button"
                disabled={requesting}
                onClick={() => {
                  void handleExport(pendingChoice);
                }}
              >
                {exportLabel}
              </button>
            </div>
          )}

          {waitNotice !== null && (
            <p className={styles.muted} role="status" data-render-wait>
              {waitNotice}
            </p>
          )}
          {passNeeded && (
            <p className={styles.muted} role="status" data-render-pass-required>
              {PASS_REQUIRED_COPY}
            </p>
          )}
          {actionError !== null && <p className={styles.error}>{actionError}</p>}
          {downloadSignedOut && (
            <div data-render-signed-out>
              <p className={styles.error}>{DOWNLOAD_SIGNED_OUT_COPY}</p>
              <EmailSignIn client={client} reason="Sign in again to download your MP4." />
            </div>
          )}
        </>
      )}
    </section>
  );
}
