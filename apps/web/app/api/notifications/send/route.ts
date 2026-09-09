import { after, NextResponse } from 'next/server';

import { notificationSecretMatches, notificationSendSecret } from '@/lib/notifications/secret';
import { runNotificationPass } from '@/lib/notifications/sender';
import {
  NOTIFICATION_BATCH_SIZE,
  NOTIFICATION_LEASE_SECONDS,
} from '@/lib/notifications/timeBudget';
import { triggerNotificationSend } from '@/lib/notifications/trigger';
import { resolveShareOrigin } from '@/lib/pitchRender/shareOrigin';
import { getSupabaseServiceClient } from '@/lib/supabaseServer';

export const dynamic = 'force-dynamic';

/**
 * The invocation ceiling for the deployed function. A bounded pass is 4 entries
 * x a 25s per-entry cap = 100s worst case, and its own wall-clock deadline is
 * 245s (timeBudget.ts) — this has to sit above BOTH, or a platform kill would
 * land before the pass's own deadline and leave leases dangling with no
 * summary and no log.
 *
 * A literal because Next.js statically analyses route segment config and
 * rejects an imported constant, so notification-timebudget.audit3.test.ts
 * asserts this equals NOTIFICATION_MAX_DURATION_SECONDS — and that vercel.json
 * carries the same number, which is what the platform actually reads
 * (render-run precedent: that third copy was stranded at an old ceiling once).
 */
export const maxDuration = 300;

/**
 * The notification sender (0058). Claims leased entries from
 * notification_outbox, resolves each recipient's mailbox from auth.users with
 * the service key, mails through Resend and reports the result under the held
 * lease. Service-secret only, like ingest-run and render-run: operators, the
 * kick relay and the scheduled backstop call it; browsers never do. The
 * request body is ignored — the queue is the input.
 *
 * 501 rather than 500 when unconfigured, and configuration is checked BEFORE
 * anything is claimed: a pass that claims work it cannot deliver would burn an
 * attempt from every entry's retry budget for nothing.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const secret = notificationSendSecret();
  const serviceClient = getSupabaseServiceClient();
  if (secret === null || serviceClient === null) {
    return NextResponse.json({ error: 'not configured' }, { status: 501 });
  }
  const provided = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!notificationSecretMatches(provided, secret)) {
    return NextResponse.json({ error: 'authentication required' }, { status: 401 });
  }

  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.FRIENDWORD_NOTIFY_FROM;
  if (apiKey === undefined || apiKey === '' || from === undefined || from === '') {
    return NextResponse.json({ error: 'mail provider not configured' }, { status: 501 });
  }
  // The links in the mail are the product's canonical origin, never this
  // deployment's preview host (endCard precedent — nothing is hardcoded).
  const shareOrigin = resolveShareOrigin(new URL(request.url).origin);
  if (shareOrigin === null) {
    return NextResponse.json({ error: 'share origin not configured' }, { status: 501 });
  }

  const summary = await runNotificationPass(serviceClient, {
    shareOrigin,
    apiKey,
    from,
    batchSize: NOTIFICATION_BATCH_SIZE,
    leaseSeconds: NOTIFICATION_LEASE_SECONDS,
  });

  // Pass-end self-kick, same reasoning as the render worker: the browser that
  // kicked us may already be gone, so the pass that made progress is the only
  // reliable thing left to drain the rest.
  //
  // The condition is `sent > 0`, NOT "the batch was full". A full batch of
  // FAILURES re-kicks a pass that will claim the same rows and fail them
  // again, three deep, in the time it takes to make four HTTP calls — the
  // fastest possible way to burn every retry budget in the queue against one
  // provider outage and alert an operator who could not have acted. Progress
  // is what earns another pass. (0058's 5-minute retry backoff is the second
  // layer: even a kick from elsewhere cannot re-claim a just-failed row.)
  if (summary.sent > 0) {
    try {
      after(() => triggerNotificationSend(new URL(request.url).origin));
    } catch {
      // Not in a request scope (unit tests); a kick or the backstop pushes.
    }
  }

  // Counts and reason codes only — never an address, never a recipient id.
  return NextResponse.json(summary);
}
