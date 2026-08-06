import 'server-only';

import { renderRunSecret } from './secret';

/**
 * How long the kick waits for /api/media/render-run to ANSWER, not to finish.
 * Delivering the request takes well under a second; the worker's response only
 * arrives once the whole pass is over (up to WORKER_HARD_BUDGET_MS — 760s
 * since the Pro ceiling raise, and the reason this wait is capped at all), so
 * awaiting it the way
 * the ingest trigger does would pin every kick invocation for the render's
 * duration — and the kick route's own default maxDuration would kill it
 * mid-await. The abort cancels our wait for the response, nothing else.
 */
const KICK_RESPONSE_TIMEOUT_MS = 5_000;

/**
 * Kicks the render worker for the deployment that served this request
 * (the clipIngest/trigger.ts pattern, hardened for minutes-long passes).
 * There is no cron (pg_cron cannot exec ffmpeg; GitHub Actions retired
 * 2026-07-25; Hobby cron is daily-only): the standard run path is
 * opportunistic — the kit page kicks once per export request and once per
 * status-poll tick while a render is in flight. A stalled queue can always be
 * pushed by hand:
 *
 *   curl -X POST "$ORIGIN/api/media/render-run" \
 *     -H "authorization: Bearer $FRIENDWORD_MEDIA_RENDER_SECRET"
 *
 * Honestly stated limit: a job that is queued but never claimed raises NO
 * ops_alert — alerts fire on terminal failure only — so if every kick is
 * missed (page closed, secret unset), the job just sits there. The curl above
 * is the documented backstop for exactly that state.
 *
 * When the secret is unset this returns silently: the queue waits for an
 * operator; it never processes unauthenticated.
 */
export async function triggerRenderRun(origin: string): Promise<void> {
  const secret = renderRunSecret();
  if (secret === null) {
    return;
  }
  try {
    await fetch(`${origin}/api/media/render-run`, {
      method: 'POST',
      headers: { authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(KICK_RESPONSE_TIMEOUT_MS),
    });
  } catch {
    // Expected whenever a pass actually starts (it answers only at the end,
    // long after the 5s window) — and harmless when delivery truly failed:
    // the queue survives a missed push, the next kick pushes again.
    console.warn('pitch render: trigger request was not acknowledged within 5s or failed');
  }
}
