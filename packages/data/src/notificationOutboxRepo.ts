import { z } from 'zod';

import type { ServiceSupabaseClient } from './client';
import { DataLayerError } from './errors';

const uuidSchema = z.string().uuid();

/**
 * The notification outbox (migration 0058) — the queue that turns a product
 * event into a mail. There is NO client surface here at all: the table and
 * both RPCs are service-role only, because the sender resolves the
 * recipient's mailbox from auth.users, which no client role may read.
 *
 * These names are the pinned 0058 server contract; rpcContract.test.ts checks
 * them (and their argument names) against the migration SQL itself.
 *
 * What the claim deliberately does NOT return: an email address. It returns a
 * user id, and resolving that to a mailbox is the sender's job and the
 * sender's alone (0058 decision 2).
 */
export const NOTIFICATION_OUTBOX_SERVICE_RPCS = [
  'claim_notification_outbox',
  'complete_notification_outbox',
] as const;

export const NOTIFICATION_EVENT_TYPES = [
  'interest_received',
  'interest_accepted',
  'interest_declined',
  'pitch_render_completed',
] as const;

export type NotificationEventType = (typeof NOTIFICATION_EVENT_TYPES)[number];

export type ClaimedNotification = {
  readonly entryId: string;
  readonly leaseToken: string;
  readonly recipientUserId: string;
  readonly eventType: NotificationEventType;
  /** Set only for `pitch_render_completed` — the /kit/<draftId> landing. */
  readonly pitchDraftId: string | null;
  readonly attempts: number;
};

export type NotificationCompletion =
  | { readonly outcome: 'sent' }
  /** A short reason CODE, never provider prose: the server normalizes it to
   *  [a-z0-9_] and the column CHECK refuses anything containing '@'. */
  | { readonly outcome: 'failed'; readonly reason: string };

const claimRowsSchema = z.array(
  z.object({
    entry_id: z.string().uuid(),
    entry_lease_token: z.string().uuid(),
    entry_recipient_user_id: z.string().uuid(),
    entry_event_type: z.enum(NOTIFICATION_EVENT_TYPES),
    entry_pitch_draft_id: z.string().uuid().nullable(),
    entry_attempts: z.number().int(),
  }),
);

type OutboxRpcName = (typeof NOTIFICATION_OUTBOX_SERVICE_RPCS)[number];

// The 0058 RPCs are not in the generated database types yet, so calls go
// through this narrow untyped envelope (renderJobRepo precedent).
// rpcContract.test.ts recognizes this wrapper's call shape.
async function callOutboxRpc(
  client: ServiceSupabaseClient,
  functionName: OutboxRpcName,
  params: Record<string, unknown>,
): Promise<{ readonly data: unknown; readonly error: unknown | null }> {
  const rpc: unknown = Reflect.get(client, 'rpc');
  if (typeof rpc !== 'function') {
    throw new DataLayerError('notify.rpc', new Error('Supabase RPC client is unavailable'));
  }
  const result: unknown = await Reflect.apply(rpc, client, [functionName, params]);
  if (
    typeof result !== 'object' ||
    result === null ||
    !('data' in result) ||
    !('error' in result)
  ) {
    throw new DataLayerError('notify.rpc', new Error('Supabase returned an invalid result'));
  }
  return { data: Reflect.get(result, 'data'), error: Reflect.get(result, 'error') };
}

/**
 * Leases up to `batchSize` notifications for this sender pass. Returns an
 * empty array when there is nothing to send, when the ops kill switch is off,
 * when a previously failed entry is still inside its retry backoff, or when
 * every pending row is already leased by another pass — the caller cannot tell
 * those apart on purpose, because its answer is the same: stop.
 *
 * The defaults mirror 0058's own (`batch_size` 4, `lease_seconds` 300) so a
 * call that omits them behaves identically to a call that does not. The web
 * sender always passes both, from
 * apps/web/src/lib/notifications/timeBudget.ts, where the relation between
 * batch size, per-entry cost and lease length is asserted.
 */
export async function claimNotifications(
  client: ServiceSupabaseClient,
  options: { readonly batchSize?: number; readonly leaseSeconds?: number } = {},
): Promise<readonly ClaimedNotification[]> {
  const { data, error } = await callOutboxRpc(client, 'claim_notification_outbox', {
    batch_size: options.batchSize ?? 4,
    lease_seconds: options.leaseSeconds ?? 300,
  });
  if (error !== null) {
    throw new DataLayerError('notify.claim', error);
  }
  const parsed = claimRowsSchema.safeParse(data ?? []);
  if (!parsed.success) {
    throw new DataLayerError('notify.claim', parsed.error);
  }
  return parsed.data.map((row) => ({
    entryId: row.entry_id,
    leaseToken: row.entry_lease_token,
    recipientUserId: row.entry_recipient_user_id,
    eventType: row.entry_event_type,
    pitchDraftId: row.entry_pitch_draft_id,
    attempts: row.entry_attempts,
  }));
}

/**
 * Reports a delivery result under the held lease. `sent` is final; `failed`
 * re-queues while attempts remain — held back from the next claim for
 * attempts x 5 minutes — and terminalizes with an ops_alert once the budget is
 * spent.
 */
export async function completeNotification(
  client: ServiceSupabaseClient,
  entryId: string,
  leaseToken: string,
  completion: NotificationCompletion,
): Promise<void> {
  const { error } = await callOutboxRpc(client, 'complete_notification_outbox', {
    entry_id: uuidSchema.parse(entryId),
    entry_lease_token: uuidSchema.parse(leaseToken),
    outcome: completion.outcome,
    reason: completion.outcome === 'failed' ? completion.reason : null,
  });
  if (error !== null) {
    throw new DataLayerError('notify.complete', error);
  }
}
