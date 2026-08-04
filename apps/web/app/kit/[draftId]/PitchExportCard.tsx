'use client';

import { useCallback, useEffect, useState } from 'react';

import {
  DataLayerError,
  RenderJobRepo,
  trackEvent,
  type BrowserSupabaseClient,
  type PitchRenderState,
} from '@friendword/data';

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
const DOWNLOAD_ERROR_COPY = 'The download couldn’t start. Please try again.';
const STATE_ERROR_COPY = 'The export status could not load. Refresh to try again.';

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
}: {
  readonly client: BrowserSupabaseClient;
  readonly draftId: string;
  readonly campaignId: string;
  readonly campaignSlug: string | null;
}) {
  const [view, setView] = useState<ExportView | 'loading' | 'error'>('loading');
  const [requesting, setRequesting] = useState(false);
  const [downloading, setDownloading] = useState(false);
  // "In progress" is information, not an error, and NEVER a payment prompt
  // (E2): nothing was consumed, waiting is free, so it renders as a status
  // line while passNeeded gets its own separate, deliberately unmergeable
  // rendering path.
  const [waitNotice, setWaitNotice] = useState<string | null>(null);
  const [passNeeded, setPassNeeded] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

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

  async function handleExport() {
    setRequesting(true);
    setActionError(null);
    setWaitNotice(null);
    setPassNeeded(false);
    try {
      await new RenderJobRepo(client).requestRender(campaignId);
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

  async function handleDownload(revisionId: string) {
    setDownloading(true);
    setActionError(null);
    try {
      const { data, error } = await client.auth.getSession();
      const accessToken = data.session?.access_token;
      if (error !== null || accessToken === undefined) {
        throw new Error('download requires a session');
      }
      // The MP4 lives under pitch-media/<draft>/renders/, a nested prefix the
      // member storage policy cannot see (deliberately, 0054), so the signed
      // URL comes from the draft-scoped route beside this page (E5).
      const response = await fetch(
        `/kit/${draftId}/render-download?revisionId=${encodeURIComponent(revisionId)}`,
        { headers: { authorization: `Bearer ${accessToken}` } },
      );
      const payload: unknown = await response.json().catch(() => null);
      const url =
        response.ok &&
        typeof payload === 'object' &&
        payload !== null &&
        'url' in payload &&
        typeof payload.url === 'string'
          ? payload.url
          : null;
      if (url === null) {
        throw new Error('download unavailable');
      }
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.rel = 'noopener';
      anchor.download = '';
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      trackEvent(client, 'campaign_shared', {
        campaign_slug: campaignSlug,
        channel: 'kit_mp4_download',
      });
    } catch {
      setActionError(DOWNLOAD_ERROR_COPY);
    } finally {
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

          {jobStatus === null && (
            <button
              className={styles.primary}
              type="button"
              disabled={requesting}
              onClick={() => {
                void handleExport();
              }}
            >
              {requesting ? 'Requesting…' : 'Export the MP4'}
            </button>
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
                  void handleDownload(doneRevisionId);
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
                    void handleDownload(doneRevisionId);
                  }}
                >
                  {downloading ? 'Preparing…' : 'Download the earlier version'}
                </button>
                <button
                  className={styles.primary}
                  type="button"
                  disabled={requesting}
                  onClick={() => {
                    void handleExport();
                  }}
                >
                  {requesting ? 'Requesting…' : 'Export the current version'}
                </button>
              </div>
            </>
          )}

          {jobStatus === 'failed' && (
            <>
              <p className={styles.muted}>{FAILED_COPY}</p>
              <p className={styles.finePrint}>{FAILED_DETAIL_COPY}</p>
              <button
                className={styles.primary}
                type="button"
                disabled={requesting}
                onClick={() => {
                  void handleExport();
                }}
              >
                {requesting ? 'Requesting…' : 'Try the export again'}
              </button>
            </>
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
        </>
      )}
    </section>
  );
}
