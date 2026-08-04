import { after, NextResponse } from 'next/server';

import { createBrowserClient } from '@friendword/data';

import { isActiveAccount } from '@/lib/accountStatus';
import { triggerRenderRun } from '@/lib/pitchRender/trigger';
import { getSupabaseServiceClient } from '@/lib/supabaseServer';

export const dynamic = 'force-dynamic';

/**
 * The browser-facing bridge to the render worker. Browsers must never hold
 * FRIENDWORD_MEDIA_RENDER_SECRET, and the render status poll goes browser →
 * PostgREST directly (get_pitch_render_state), so — unlike ingest, whose
 * clip-ingest-state server route piggybacks the worker push onto every poll —
 * the render queue needs this dedicated kick route.
 *
 * Any active signed-in account may kick: the kick carries no job data and
 * chooses no job — the worker claims from the queue under its own gates — so
 * the only thing to protect is the compute, which the active-account check
 * (clip-ingest-state discipline) and the DB-side concurrency cap already
 * bound. Best-effort by design: 202 means "the push was scheduled", never
 * "a worker started"; the response reports no job data and no config state.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const serviceClient = getSupabaseServiceClient();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (serviceClient === null || url === undefined || anonKey === undefined) {
    return NextResponse.json({ error: 'not configured' }, { status: 501 });
  }

  const accessToken = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (accessToken === '') {
    return NextResponse.json({ error: 'authentication required' }, { status: 401 });
  }
  const authClient = createBrowserClient(url, anonKey);
  const { data: userData, error: userError } = await authClient.auth.getUser(accessToken);
  if (userError !== null || userData.user === null) {
    return NextResponse.json({ error: 'authentication required' }, { status: 401 });
  }
  if (!(await isActiveAccount(serviceClient, userData.user.id))) {
    return NextResponse.json({ error: 'account is not active' }, { status: 403 });
  }

  // Push the worker after the response is sent. `after` throws outside a real
  // request scope (unit tests); losing the push there is exactly the fallback
  // the queue tolerates — the next poll tick (or an operator) pushes again.
  const origin = new URL(request.url).origin;
  try {
    after(() => triggerRenderRun(origin));
  } catch {
    // Not in a request scope; the next kick (or the operator curl) pushes.
  }

  return NextResponse.json({}, { status: 202 });
}
