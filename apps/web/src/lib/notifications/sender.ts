import 'server-only';

import {
  claimNotifications,
  completeNotification,
  type ClaimedNotification,
  type ServiceSupabaseClient,
} from '@friendword/data';

import { sendEmailViaResend, type ResendResult } from './resend';
import { buildNotificationMail } from './templates';
import {
  NOTIFICATION_BATCH_SIZE,
  NOTIFICATION_LEASE_SECONDS,
  NOTIFICATION_PASS_DEADLINE_MS,
} from './timeBudget';

/**
 * One drain pass over the notification outbox (0058).
 *
 * The shape mirrors the render worker: claim under a lease, do the slow
 * external thing, report the result under the lease held. Two passes running
 * at once (an opportunistic kick and the scheduled backstop) are safe because
 * the claim is FOR UPDATE SKIP LOCKED — the second pass simply sees nothing.
 *
 * WHERE THE ADDRESS COMES FROM, AND WHERE IT DOES NOT GO. Email lives only in
 * auth.users: `public.users` has no email column and no client role can read
 * the auth schema, which is exactly why this runs service-side. The address is
 * resolved here, handed to Resend, and dropped. It is never written to the
 * outbox, never returned in the summary, and never logged — the summary this
 * function returns is counts and reason CODES only, because the route answers
 * with it.
 */
export type NotificationPassSummary = {
  readonly claimed: number;
  readonly sent: number;
  readonly failed: number;
  /** Reason codes for the failures in this pass, for the operator. No ids. */
  readonly failureCodes: readonly string[];
};

export type NotificationPassConfig = {
  readonly shareOrigin: string;
  readonly apiKey: string;
  readonly from: string;
  readonly batchSize?: number;
  readonly leaseSeconds?: number;
  /** Injected only by tests, to prove the deadline actually binds. */
  readonly passDeadlineMs?: number;
  /** Injected only by tests; the pass otherwise reads the real clock. */
  readonly now?: () => number;
};

async function resolveRecipientEmail(
  client: ServiceSupabaseClient,
  userId: string,
): Promise<string | null> {
  const { data, error } = await client.auth.admin.getUserById(userId);
  if (error !== null || data.user === null) {
    return null;
  }
  const email = data.user.email ?? null;
  return email !== null && email.length > 0 ? email : null;
}

async function resolveRecipientName(
  client: ServiceSupabaseClient,
  userId: string,
): Promise<string | null> {
  const { data, error } = await client
    .from('profiles')
    .select('display_name')
    .eq('user_id', userId)
    .maybeSingle();
  if (error !== null || data === null) {
    return null;
  }
  return data.display_name;
}

async function deliverOne(
  client: ServiceSupabaseClient,
  entry: ClaimedNotification,
  config: NotificationPassConfig,
): Promise<ResendResult> {
  const email = await resolveRecipientEmail(client, entry.recipientUserId);
  if (email === null) {
    // No mailbox to deliver to. Retried like any other failure and then
    // surfaced as an ops alert, because an account with no address is a state
    // an operator should see rather than a row that disappears.
    return { ok: false, code: 'no_mailbox' };
  }
  const mail = buildNotificationMail({
    eventType: entry.eventType,
    recipientName: await resolveRecipientName(client, entry.recipientUserId),
    pitchDraftId: entry.pitchDraftId,
    shareOrigin: config.shareOrigin,
  });
  if (mail === null) {
    return { ok: false, code: 'unroutable_event' };
  }
  return sendEmailViaResend({
    apiKey: config.apiKey,
    from: config.from,
    to: email,
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
  });
}

export async function runNotificationPass(
  client: ServiceSupabaseClient,
  config: NotificationPassConfig,
): Promise<NotificationPassSummary> {
  const batchSize = config.batchSize ?? NOTIFICATION_BATCH_SIZE;
  const leaseSeconds = config.leaseSeconds ?? NOTIFICATION_LEASE_SECONDS;
  const now = config.now ?? Date.now;

  // THE LEASE IS A DEADLINE, SO THE PASS CARRIES ONE (jobRunner precedent).
  // Every entry below is being delivered under a lease this pass was granted
  // `leaseSeconds` ago. Once that lease lapses the row is claimable again — so
  // a pass that keeps sending past it is not "slow", it is racing a second
  // sender toward the same mailbox, and a double send is the one failure this
  // whole table exists to prevent. timeBudget.ts derives the deadline as
  // lease − one entry's cap − clock skew, so anything STARTED before it also
  // FINISHES before the lease does.
  //
  // The deadline is deliberately not enforced by aborting work in flight: an
  // entry not started keeps its lease, returns to the queue when that lease
  // expires and is delivered by a later pass. Late is a cost; twice is a bug.
  const startedAt = now();
  const deadline = startedAt + (config.passDeadlineMs ?? NOTIFICATION_PASS_DEADLINE_MS);

  // Claiming is itself gated: a pass that somehow started with no budget left
  // must not take out leases it cannot honour.
  if (now() >= deadline) {
    return { claimed: 0, sent: 0, failed: 0, failureCodes: [] };
  }

  const claimed = await claimNotifications(client, { batchSize, leaseSeconds });
  let sent = 0;
  let failed = 0;
  const failureCodes: string[] = [];

  // Serial on purpose: a burst of parallel provider calls from one invocation
  // is how a rate limit turns one slow send into a batch of failures, and the
  // batch is small by design (the kick chain drains the rest).
  for (const entry of claimed) {
    if (now() >= deadline) {
      // No identifiers: the count gap between `claimed` and sent+failed is the
      // operator's signal, and the entries come back on the next pass.
      console.warn(
        'notification sender: pass deadline reached; the rest of the batch stays leased',
      );
      break;
    }
    let result: ResendResult;
    try {
      result = await deliverOne(client, entry, config);
    } catch (cause: unknown) {
      const name = cause instanceof Error ? cause.name : 'Error';
      result = { ok: false, code: `sender_${name}` };
    }
    try {
      await completeNotification(
        client,
        entry.entryId,
        entry.leaseToken,
        result.ok ? { outcome: 'sent' } : { outcome: 'failed', reason: result.code },
      );
    } catch {
      // The lease lapsed mid-send, or the row moved under us. Nothing to do
      // and nothing to log with an identifier in it: the entry stays claimable
      // once the lease expires, and the retry budget bounds the loop.
      console.warn('notification sender: a completion was rejected (lease no longer held)');
      continue;
    }
    if (result.ok) {
      sent += 1;
    } else {
      failed += 1;
      failureCodes.push(result.code);
    }
  }

  return { claimed: claimed.length, sent, failed, failureCodes };
}
