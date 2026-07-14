import 'server-only';

import type { ServiceSupabaseClient } from '@friendword/data';

export type ProviderUsageKind = 'transcribe' | 'structure' | 'moderate_text' | 'media_validate';

export type ProviderReservation =
  | {
      readonly ok: true;
      readonly reservationId: string;
      readonly priorStatus: string;
      readonly granted: boolean;
      readonly leaseToken: string | null;
    }
  | { readonly ok: false; readonly httpStatus: number; readonly message: string };

type ReserveRow = {
  readonly reservation_id: string;
  readonly prior_status: string;
  readonly granted: boolean;
  readonly lease_token: string | null;
};

/**
 * The reserve/reconcile RPCs are contract C1 (service_role only, new
 * signature) landing in migration 0035, which is authored in `supabase/**`
 * and regenerated into `packages/data` at integration time. This route layer
 * owns only `apps/web/**`, so it cannot edit the generated `database.types.ts`
 * that still describes the pre-C1 signature. We therefore reach the RPC through
 * a deliberately loose adapter so the call compiles against either generation
 * of the types and the argument shape is asserted by the audit3 tests instead.
 */
type LooseRpc = (
  fn: string,
  params: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: { readonly message?: string | null } | null }>;

function looseRpc(serviceClient: ServiceSupabaseClient): LooseRpc {
  return serviceClient.rpc.bind(serviceClient) as unknown as LooseRpc;
}

function extractReserveRow(data: unknown): ReserveRow | null {
  // A RETURNS TABLE RPC comes back as an array of rows; a scalar RPC as the
  // value. Accept either so the single reserved row is read the same way.
  const raw = Array.isArray(data) ? data[0] : data;
  if (raw === null || typeof raw !== 'object') {
    return null;
  }
  const row = raw as Record<string, unknown>;
  if (
    typeof row.reservation_id !== 'string' ||
    typeof row.prior_status !== 'string' ||
    typeof row.granted !== 'boolean'
  ) {
    return null;
  }
  return {
    reservation_id: row.reservation_id,
    prior_status: row.prior_status,
    granted: row.granted,
    lease_token: typeof row.lease_token === 'string' ? row.lease_token : null,
  };
}

function mapReserveError(message: string): ProviderReservation {
  if (message.includes('consent is required')) {
    return { ok: false, httpStatus: 409, message: 'external AI processing consent is required' };
  }
  if (message.includes('kill switch')) {
    return { ok: false, httpStatus: 503, message: 'AI features are temporarily disabled' };
  }
  if (message.includes('cap reached') || message.includes('quota exceeded')) {
    return { ok: false, httpStatus: 429, message: 'AI usage limit reached — try again later' };
  }
  console.warn('provider budget: reservation failed');
  return { ok: false, httpStatus: 500, message: 'provider budget reservation failed' };
}

/**
 * Third audit P0-NEW-1: every provider call is preceded by an atomic
 * service-role reservation that resolves quota, monthly hard cap, kill switch
 * and (for every usage kind now) external-AI consent, and hands back a lease
 * so exactly one attempt may call the provider. The reservation runs with the
 * SERVICE client — the route, not the client, decides the authoritative user,
 * scope, kind and estimate, so an authenticated caller can no longer pick the
 * cents/status/user of a reservation or exhaust the cap by hand.
 *
 * Returns the full row so callers can branch on replay:
 *  - granted=true  → this attempt owns the lease and must call the provider.
 *  - granted=false, priorStatus='succeeded' → reuse the stored verdict; never
 *    re-call the provider.
 *  - granted=false, priorStatus='reserved'  → another attempt holds the lease.
 */
export async function reserveProviderUsage(
  serviceClient: ServiceSupabaseClient,
  targetUserId: string,
  kind: ProviderUsageKind,
  requestRef: string,
  estimatedCents: number,
  scopeDraftId?: string,
): Promise<ProviderReservation> {
  const { data, error } = await looseRpc(serviceClient)('reserve_provider_usage', {
    target_user_id: targetUserId,
    usage_kind: kind,
    request_ref: requestRef,
    estimated_cents: estimatedCents,
    scope_draft_id: scopeDraftId ?? null,
  });
  if (error !== null) {
    return mapReserveError(error.message ?? '');
  }

  const row = extractReserveRow(data);
  if (row === null) {
    return { ok: false, httpStatus: 500, message: 'provider budget reservation failed' };
  }
  return {
    ok: true,
    reservationId: row.reservation_id,
    priorStatus: row.prior_status,
    granted: row.granted,
    leaseToken: row.lease_token,
  };
}

/**
 * Close out a granted reservation. For failed/timeout the route passes
 * actualCents=0 on purpose: the reconcile signature cannot take null, and the
 * DB conservatively persists GREATEST(actual, estimated), so a provider that
 * already charged for a timeout/5xx keeps at least its estimate in the cap
 * (P0-NEW-1). succeeded passes the real cost.
 */
export async function reconcileProviderUsage(
  serviceClient: ServiceSupabaseClient,
  reservationId: string,
  leaseToken: string | null,
  actualCents: number,
  finalStatus: 'succeeded' | 'failed' | 'timeout' | 'released',
): Promise<void> {
  const { error } = await looseRpc(serviceClient)('reconcile_provider_usage', {
    target_reservation_id: reservationId,
    target_lease_token: leaseToken,
    actual_cents: actualCents,
    final_status: finalStatus,
  });
  if (error !== null) {
    console.warn('provider budget: reconcile failed');
  }
}
