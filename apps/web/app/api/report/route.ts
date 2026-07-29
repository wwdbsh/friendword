import { createHash } from 'node:crypto';

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { reporterIpFromForwardedHeader } from '@/lib/reporterIdentity';
import { getSupabaseServiceClient } from '@/lib/supabaseServer';

export const dynamic = 'force-dynamic';

const requestSchema = z.object({
  campaignSlug: z
    .string()
    .min(3)
    .max(120)
    .regex(/^[a-z0-9-]+$/),
  reason: z.enum(['impersonation', 'safety_risk', 'minor', 'harassment', 'spam', 'other']),
  detail: z.string().max(2000).optional(),
});

/**
 * Stable substring of the SQLERRM raised by the BEFORE INSERT rate-limit
 * trigger on public.reports (0045, `reports_rate_limit_anon`).
 *
 * The one hourly cap — five anonymous reports per reporter IP hash — lives in
 * that trigger and nowhere else. Counting here and inserting afterwards are two
 * transactions, so any cap this route evaluates can be exceeded by requests
 * that interleave between the two: within one process and, worse, across
 * instances. The trigger evaluates it inside the inserting transaction, which
 * is the only place it can hold; this route does not count, it only turns the
 * trigger's refusal into a status code.
 *
 * The dependency runs the other way too: with that migration absent, anonymous
 * reports are not capped at all. This route is not a fallback for it.
 */
const REPORTER_RATE_LIMIT_MESSAGE = 'report rate limit exceeded for this reporter';

function hashIp(request: Request): string {
  const clientIp = reporterIpFromForwardedHeader(request.headers.get('x-forwarded-for'));
  const salt = process.env.SUPABASE_SERVICE_ROLE_KEY ?? 'friendword-report';
  return createHash('sha256').update(`${salt}:${clientIp}`).digest('hex');
}

/**
 * True for the rate-limit trigger's rejection, as opposed to a constraint
 * violation, a permission error or an outage. PostgREST spreads a RAISE
 * EXCEPTION across message/details/hint depending on how it was raised, so all
 * three are searched.
 */
function isRateLimitRejection(error: unknown): boolean {
  if (error === null || typeof error !== 'object') {
    return false;
  }
  const { message, details, hint } = error as Record<string, unknown>;
  const text = [message, details, hint].filter((part) => typeof part === 'string').join('\n');
  return text.includes(REPORTER_RATE_LIMIT_MESSAGE);
}

/**
 * No-signup report path for public pitches (audit P0-5): viewing requires
 * no account, so reporting must not either. Reports land in the same ops
 * queue as authenticated ones (anon_report=true) and feed the high-severity
 * auto-pause trigger. Only published or paused campaigns are reportable, and
 * the hourly per-reporter cap is enforced by the DB trigger this route reads
 * refusals from.
 *
 * Every answer depends only on the requester's own state, never on the target's.
 * There is no per-campaign cap: one existed, and because a refused request never
 * advanced the prober's own bucket, the endpoint told a prober whether a page
 * had already taken its fill of anonymous reports. Dropping the target-based
 * limit (0045, decision 2026-07-29) is what closed that, so a heavily reported
 * campaign and one never reported answer identically at every point in the
 * prober's budget. Reintroducing any limit keyed on the target reopens it.
 *
 * Two things this route does not do, stated so they are not read as guarantees.
 * It enforces no limit of its own: without 0045 deployed, anonymous reports are
 * uncapped. And 0024's `reports_dedupe_repeat` still cancels a repeat anonymous
 * report (same IP hash, target and reason within 24h) by returning NULL, which
 * PostgREST reports as success — so that reporter is told 200 for a row that
 * was never written. Pre-existing behaviour, unchanged here.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const serviceClient = getSupabaseServiceClient();
  if (serviceClient === null) {
    return NextResponse.json({ error: 'not configured' }, { status: 501 });
  }

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid report' }, { status: 400 });
  }
  const { campaignSlug, reason, detail } = parsed.data;

  const { data: campaign, error: campaignError } = await serviceClient
    .from('campaigns')
    .select('id, owner_user_id, status')
    .eq('slug', campaignSlug)
    .maybeSingle();
  // A lookup that failed is not a campaign that does not exist. Both refusals
  // are target-independent, so separating them leaks nothing and stops an
  // outage from reading as "no such page".
  if (campaignError !== null) {
    return NextResponse.json({ error: 'report unavailable' }, { status: 503 });
  }
  if (campaign === null || !['published', 'paused'].includes(campaign.status)) {
    return NextResponse.json({ error: 'campaign not found' }, { status: 404 });
  }

  const { error: insertError } = await serviceClient.from('reports').insert({
    reporter_user_id: null,
    reported_user_id: campaign.owner_user_id,
    campaign_id: campaign.id,
    target_type: 'campaign',
    target_id: campaign.id,
    reason,
    detail: detail ?? null,
    anon_report: true,
    reporter_ip_hash: hashIp(request),
  });
  if (insertError !== null) {
    // The reporter has spent their hourly budget. Nothing about the target is
    // in this answer, and nothing may be added to it.
    if (isRateLimitRejection(insertError)) {
      return NextResponse.json({ error: 'too many reports' }, { status: 429 });
    }
    console.warn('anon report: insert failed');
    return NextResponse.json({ error: 'report failed' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
