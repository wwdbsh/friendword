import { after, NextResponse } from 'next/server';

import { createBrowserClient } from '@friendword/data';

import { isActiveAccount } from '@/lib/accountStatus';
import { triggerNotificationSend } from '@/lib/notifications/trigger';
import { getSupabaseServiceClient } from '@/lib/supabaseServer';

export const dynamic = 'force-dynamic';

/**
 * The browser-facing bridge to the notification sender, copied in shape from
 * /api/media/render-kick. Browsers must never hold FRIENDWORD_NOTIFY_SECRET,
 * and the two events a browser causes (an interest submitted, an inbox
 * decision) both happen through PostgREST with no server route to piggyback
 * the push on — so the queue needs this dedicated kick route.
 *
 * Any active signed-in account may kick: the kick carries no entry data and
 * chooses no entry — the sender claims from the queue under its own gates
 * (including the DB kill switch) — so the only thing to protect is the compute
 * and the provider quota. Best-effort by design: 202 means "the push was
 * scheduled", never "a mail was sent"; the response reports no queue state.
 *
 * NO RATE LIMIT HERE, AND WHY THAT IS ACCEPTED (recorded so the next reader
 * does not have to re-derive it). A signed-in account could loop this route.
 * What that loop can actually cause is bounded by three things that live in
 * the database, not in this route:
 *   1. 0058's retry backoff — an entry that has already burned an attempt is
 *      not claimable again for attempts x 5 minutes, so a flood of kicks
 *      cannot spend a retry budget or re-mail anything. This is the load-
 *      bearing one; before it existed, a kick loop WAS a way to burn the
 *      queue's budget against a provider outage.
 *   2. The lease — a claimed entry belongs to one pass; concurrent passes get
 *      nothing from SKIP LOCKED, so N kicks do not make N sends.
 *   3. `notification_email_enabled` — one UPDATE stops all of it.
 * What is left is wasted invocations, which Vercel's own platform limits
 * already bound and which cost nothing per-user-visible. A token bucket here
 * would need shared state (a table or KV) that does not exist yet, and adding
 * one to guard a surface whose worst case is "some empty passes ran" is the
 * wrong order of work. REVISIT IF: the kick ever chooses entries, or the
 * sender's batch stops being bounded by a lease.
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

  // Push after the response is sent. `after` throws outside a real request
  // scope (unit tests); losing the push there is exactly the fallback the
  // queue tolerates — the daily backstop (or an operator) pushes again.
  const origin = new URL(request.url).origin;
  try {
    after(() => triggerNotificationSend(origin));
  } catch {
    // Not in a request scope; the backstop pushes.
  }

  return NextResponse.json({}, { status: 202 });
}
