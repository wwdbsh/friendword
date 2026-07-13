import 'server-only';

import { createClient } from '@supabase/supabase-js';

import type { ServiceSupabaseClient } from '@friendword/data';

export type ProviderUsageKind = 'transcribe' | 'structure' | 'moderate_text' | 'media_validate';

export type ProviderReservation =
  | { readonly ok: true; readonly reservationId: string; readonly status: string }
  | { readonly ok: false; readonly httpStatus: number; readonly message: string };

/**
 * Second audit P0-9/P0-10: every provider call is preceded by an atomic
 * server-side reservation (quota, monthly hard cap, kill switch, AI
 * consent) and followed by a reconcile. The reservation runs AS THE
 * USER (their access token), so auth.uid() drives quota and consent.
 */
export async function reserveProviderUsage(
  serviceClient: ServiceSupabaseClient,
  accessToken: string,
  kind: ProviderUsageKind,
  requestRef: string,
  estimatedCents: number,
  scopeDraftId?: string,
): Promise<ProviderReservation> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (url === undefined || anonKey === undefined) {
    return { ok: false, httpStatus: 501, message: 'not configured' };
  }

  const userClient = createClient(url, anonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
  const { data, error } = await userClient.rpc('reserve_provider_usage', {
    usage_kind: kind,
    request_ref: requestRef,
    estimated_cents: estimatedCents,
    scope_draft_id: scopeDraftId ?? null,
  });
  if (error !== null) {
    const message = error.message ?? '';
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

  const reservationId = typeof data === 'string' ? data : null;
  if (reservationId === null) {
    return { ok: false, httpStatus: 500, message: 'provider budget reservation failed' };
  }

  const { data: row } = await serviceClient
    .from('provider_usage_events')
    .select('status')
    .eq('id', reservationId)
    .maybeSingle();
  return { ok: true, reservationId, status: row?.status ?? 'reserved' };
}

export async function reconcileProviderUsage(
  serviceClient: ServiceSupabaseClient,
  reservationId: string,
  actualCents: number,
  finalStatus: 'succeeded' | 'failed' | 'timeout' | 'released',
): Promise<void> {
  const { error } = await serviceClient.rpc('reconcile_provider_usage', {
    reservation_id: reservationId,
    actual_cents: actualCents,
    final_status: finalStatus,
  });
  if (error !== null) {
    console.warn('provider budget: reconcile failed');
  }
}
