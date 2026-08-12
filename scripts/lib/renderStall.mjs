// Render-queue stall detection, extracted from
// scripts/check-safety-escalations.mjs so the threshold arithmetic and the
// log-hygiene rules can be tested without a hosted project (the
// scripts/lib/accountErasure.mjs precedent; types in renderStall.d.mts).
//
// WHY THIS EXISTS (fcp Issue #52, GAP-8). The MP4 render queue has no cron.
// Work only advances when something calls the worker: the kit page's poll
// (`/api/media/render-kick`), the worker's own self-kick at the end of a pass,
// or an operator with curl. Every one of those can stop — the requester closes
// the tab, the pass dies mid-flight, the platform drops the invocation — and a
// job then sits `queued` (or `leased` with a lapsed lease) with NOBODY left to
// pick it up. Nothing else notices: `ops_alerts` gets `pitch_render_failed`
// only when a job reaches its retry budget, which requires a claim, which is
// the very thing that is not happening. The person waiting for the file sees
// "Rendering your MP4…" forever.
//
// So the hourly safety-escalation pass reads this queue too, and an aged
// unfinished job counts as "an operator is needed" exactly like an unread
// report does.
//
// PRIVACY: same rules as the queues this joins. Job id, status label and age
// only. Never `last_error` (free TEXT written by the worker), never the
// campaign id or slug, never the requester, never the output path.

/**
 * Minutes a queued/leased render may age before it is called stalled.
 *
 * 30 is derived from the measured worst case of this pipeline, not picked:
 *
 *   - claim latency on a live queue was 1.2s (T009, production round trip);
 *   - the slowest render measured on the deployed machine was 364s ≈ 6.1min
 *     (60s worst-case bench WITH captions, docs/SESSION_HANDOFF.md §1);
 *   - `claim_media_render_job` hands out a 900s = 15min lease by default, and
 *     a dead worker's job is only reclaimable AFTER that lease lapses;
 *   - `media_render_concurrency_cap` is 1, so a second job may legitimately
 *     wait behind the first.
 *
 * The worst HEALTHY life of a job is therefore about one full lapsed lease
 * plus one worst-case render — 15 + 6.1 ≈ 21min — and 30 leaves ~40% slack on
 * top of that. Past 30 minutes there is no benign story left: either nothing
 * is kicking the queue or every attempt is dying before it can finish, and
 * both need a person. Lowering it below ~25 would page on healthy retries;
 * raising it much past an hour means a stuck export outlives the attention of
 * the person who asked for it.
 */
export const RENDER_STALL_DEFAULT_MINUTES = 30;

/** Bounds for the override. Below 5 every normal render pages; a day is the
 *  point at which the check has stopped being an alert. */
const MIN_STALL_MINUTES = 5;
const MAX_STALL_MINUTES = 1440;

/** Statuses that mean "this export has not reached a result yet". */
export const UNFINISHED_RENDER_STATUSES = ['queued', 'leased'];

/**
 * Reads FRIENDWORD_RENDER_STALL_MINUTES. A malformed or out-of-range value
 * DEGRADES to the default rather than failing the check — the same posture
 * `notification_max_age_hours` takes (docs/OPS.md): a typo in an operational
 * knob must not turn the alarm off, and must not turn the alarm into an
 * outage either.
 */
export function resolveStallMinutes(raw) {
  const parsed = Number.parseInt(String(raw ?? '').trim(), 10);
  if (!Number.isFinite(parsed) || parsed < MIN_STALL_MINUTES || parsed > MAX_STALL_MINUTES) {
    return RENDER_STALL_DEFAULT_MINUTES;
  }
  return parsed;
}

/** The `created_at` boundary: anything older than this is stalled. */
export function stallCutoffIso(nowMs, minutes) {
  return new Date(nowMs - minutes * 60_000).toISOString();
}

/**
 * PostgREST query for the stalled rows.
 *
 * `campaigns!inner(status)` + `campaigns.status=eq.published` is load-bearing,
 * not decoration. `claim_media_render_job` deliberately leaves a PAUSED
 * campaign's jobs alone — they wait, unclaimable, for a resume — so counting
 * them would produce a red run every hour for a state the product intends and
 * an operator cannot clear except by un-pausing someone else's campaign. The
 * jobs this asks for are exactly the ones a worker WOULD claim right now and
 * has not finished. (Expired/archived campaigns are excluded by the same
 * filter; their jobs are terminalized on the next claim.)
 *
 * `created_at`, not `updated_at`, is the age: a job reclaimed after a lapsed
 * lease bumps `updated_at`, and measuring from there would let a job that
 * fails-and-retries forever look permanently fresh. The question this asks is
 * the one the person waiting has — "how long since I asked for this file".
 */
export function renderStallQuery({ cutoffIso, limit }) {
  return (
    `select=id,status,created_at,campaigns!inner(status)` +
    `&campaigns.status=eq.published` +
    `&status=in.(${UNFINISHED_RENDER_STATUSES.join(',')})` +
    `&created_at=lt.${encodeURIComponent(cutoffIso)}` +
    `&order=created_at.asc&limit=${limit}`
  );
}

/** True when this row's age crosses the threshold. Boundary is exclusive: a
 *  job exactly at the threshold is not yet late (matches `lt.` above). */
export function isStalledRender(createdAt, nowMs, minutes) {
  const created = Date.parse(createdAt ?? '');
  if (Number.isNaN(created)) {
    return false;
  }
  return nowMs - created > minutes * 60_000;
}

function formatMinutes(createdAt, nowMs) {
  const created = Date.parse(createdAt ?? '');
  if (Number.isNaN(created)) {
    return 'age?';
  }
  const minutes = Math.max(0, Math.floor((nowMs - created) / 60_000));
  return minutes < 120 ? `${minutes}m` : `${Math.floor(minutes / 60)}h`;
}

/**
 * Log lines for the pass. Everything printed here is a job id (an opaque
 * UUID), a status from the closed CHECK set, or an age. Anything the row
 * carries beyond that — `last_error`, `campaign_id`, `requested_by_user_id`,
 * `output_storage_path` — is not selected and is not printed, because this
 * output is mailed.
 */
export function renderStallLines({ rows, total, minutes, nowMs }) {
  if (total === 0) {
    return [`render queue: 0 stalled (> ${minutes}m)`];
  }
  const lines = [
    `render queue: ${total} stalled (> ${minutes}m)`,
    `  oldest: ${formatMinutes(rows[0]?.created_at, nowMs)}`,
  ];
  for (const row of rows) {
    const status = UNFINISHED_RENDER_STATUSES.includes(row.status) ? row.status : 'unlisted';
    lines.push(`  - ${row.id} ${status} ${formatMinutes(row.created_at, nowMs)}`);
  }
  if (total > rows.length) {
    lines.push(`  … ${total - rows.length} more not listed`);
  }
  return lines;
}
