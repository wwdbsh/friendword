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

const REPORTS_PER_HOUR_PER_IP = 5;
const REPORTS_PER_HOUR_PER_CAMPAIGN = 20;

function hashIp(request: Request): string {
  const clientIp = reporterIpFromForwardedHeader(request.headers.get('x-forwarded-for'));
  const salt = process.env.SUPABASE_SERVICE_ROLE_KEY ?? 'friendword-report';
  return createHash('sha256').update(`${salt}:${clientIp}`).digest('hex');
}

/**
 * No-signup report path for public pitches (audit P0-5): viewing requires
 * no account, so reporting must not either. Reports land in the same ops
 * queue as authenticated ones (anon_report=true) and feed the
 * high-severity auto-pause trigger. Only published or paused campaigns
 * are reportable, and both per-IP-hash and per-campaign hourly caps guard
 * the service-role write.
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

  const { data: campaign } = await serviceClient
    .from('campaigns')
    .select('id, owner_user_id, status')
    .eq('slug', campaignSlug)
    .maybeSingle();
  if (campaign === null || !['published', 'paused'].includes(campaign.status)) {
    return NextResponse.json({ error: 'campaign not found' }, { status: 404 });
  }

  const oneHourAgo = new Date(Date.now() - 3600_000).toISOString();
  const reporterHash = hashIp(request);

  const { count: ipCount } = await serviceClient
    .from('reports')
    .select('id', { count: 'exact', head: true })
    .eq('reporter_ip_hash', reporterHash)
    .gte('created_at', oneHourAgo);
  if ((ipCount ?? 0) >= REPORTS_PER_HOUR_PER_IP) {
    return NextResponse.json({ error: 'too many reports' }, { status: 429 });
  }

  const { count: campaignCount } = await serviceClient
    .from('reports')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', campaign.id)
    .eq('anon_report', true)
    .gte('created_at', oneHourAgo);
  if ((campaignCount ?? 0) >= REPORTS_PER_HOUR_PER_CAMPAIGN) {
    return NextResponse.json({ error: 'too many reports' }, { status: 429 });
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
    reporter_ip_hash: reporterHash,
  });
  if (insertError !== null) {
    console.warn('anon report: insert failed');
    return NextResponse.json({ error: 'report failed' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
