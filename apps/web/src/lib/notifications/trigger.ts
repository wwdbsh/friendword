import 'server-only';

import { notificationSendSecret } from './secret';

/**
 * How long the kick waits for /api/notifications/send to ANSWER, not to
 * finish. Delivering the request takes well under a second; the sender's own
 * response arrives only after its batch of provider calls, so awaiting it
 * would pin the kicking invocation for that whole time. The abort cancels our
 * wait for the response, nothing else (pitchRender/trigger.ts precedent).
 */
const KICK_RESPONSE_TIMEOUT_MS = 5_000;

/**
 * Pushes the notification sender for the deployment that served this request.
 *
 * There is no cron here either. The queue is drained opportunistically —
 * whichever web request CREATED the event kicks once (interest submit,
 * inbox decision, render worker pass end) — with the daily scheduled ops run
 * as the backstop (scripts/drain-notifications.mjs, docs/OPS.md).
 *
 * Honestly stated limit: if every kick is missed (the tab closed before the
 * fetch left, the secret unset) an entry waits for the daily backstop, and an
 * entry older than notification_max_age_hours is expired rather than sent
 * (0058 decision 5). The manual push is:
 *
 *   curl -X POST "$ORIGIN/api/notifications/send" \
 *     -H "authorization: Bearer $FRIENDWORD_NOTIFY_SECRET"
 *
 * When the secret is unset this returns silently: the queue waits for an
 * operator; it never sends unauthenticated.
 */
export async function triggerNotificationSend(origin: string): Promise<void> {
  const secret = notificationSendSecret();
  if (secret === null) {
    return;
  }
  try {
    await fetch(`${origin}/api/notifications/send`, {
      method: 'POST',
      headers: { authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(KICK_RESPONSE_TIMEOUT_MS),
    });
  } catch (cause: unknown) {
    // Two different events, deliberately two different lines. A timeout is the
    // NORMAL outcome — the pass answers only after its provider calls, and we
    // are not waiting for that — while anything else means the push may not
    // have landed at all. Reading one as the other is how a real delivery
    // outage hides inside routine noise. Neither is fatal: the queue survives
    // a missed push and the next kick or the daily backstop pushes again.
    const name = cause instanceof Error ? cause.name : 'Error';
    if (name === 'TimeoutError') {
      console.warn(
        'notifications: sender push delivered; not waiting for the pass to answer (expected)',
      );
    } else {
      console.warn(`notifications: sender push failed to leave this instance (${name})`);
    }
  }
}
