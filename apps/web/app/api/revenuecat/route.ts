import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getSupabaseServiceClient } from '@/lib/supabaseServer';

export const dynamic = 'force-dynamic';

const PRODUCTS = {
  creatorLaunchCredit: 'creator_launch_credit_499',
  campaignPass30d: 'campaign_30d_1999',
} as const;

const attributeSchema = z.object({ value: z.string().nullable() }).partial({ value: true });

const eventSchema = z.object({
  event: z.object({
    id: z.string().min(1),
    type: z.string(),
    app_user_id: z.string().min(1),
    product_id: z.string().min(1),
    purchased_at_ms: z.number().optional(),
    expiration_at_ms: z.number().nullable().optional(),
    subscriber_attributes: z.record(z.string(), attributeSchema).optional().default({}),
  }),
});

/**
 * RevenueCat server webhook. Verifies the shared Authorization token, then
 * records purchases idempotently: purchase_events (unique provider_event_id),
 * a credit-ledger row for the Creator Launch consumable, and a 30-day
 * campaign entitlement for the Campaign Pass (deactivated on expiration).
 * Responds 200 with `recorded:false` for events it cannot attribute so
 * RevenueCat does not retry forever; those land in the logs for ops.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const expectedToken = process.env.REVENUECAT_WEBHOOK_AUTH_TOKEN;
  if (expectedToken === undefined || expectedToken === '') {
    return NextResponse.json({ error: 'webhook not configured' }, { status: 501 });
  }

  const authorization = request.headers.get('authorization') ?? '';
  if (authorization !== expectedToken && authorization !== `Bearer ${expectedToken}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const serviceClient = getSupabaseServiceClient();
  if (serviceClient === null) {
    return NextResponse.json({ error: 'not configured' }, { status: 501 });
  }

  const parsed = eventSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'malformed event' }, { status: 400 });
  }
  const event = parsed.data.event;

  const userId = z.string().uuid().safeParse(event.app_user_id);
  if (!userId.success) {
    console.warn('revenuecat: anonymous app_user_id, cannot attribute', event.id);
    return NextResponse.json({ recorded: false, reason: 'anonymous app_user_id' });
  }

  const attributes = event.subscriber_attributes;
  const pitchDraftId = attributes['pitch_draft_id']?.value ?? null;
  const campaignId = attributes['campaign_id']?.value ?? null;
  const purchasedAt = new Date(event.purchased_at_ms ?? Date.now()).toISOString();

  if (event.type === 'EXPIRATION' || event.type === 'CANCELLATION') {
    if (event.product_id === PRODUCTS.campaignPass30d && campaignId !== null) {
      await serviceClient
        .from('campaign_entitlements')
        .update({ active: false })
        .eq('campaign_id', campaignId)
        .eq('product_id', PRODUCTS.campaignPass30d);
    }
    return NextResponse.json({ recorded: true });
  }

  if (!['INITIAL_PURCHASE', 'NON_RENEWING_PURCHASE', 'RENEWAL'].includes(event.type)) {
    return NextResponse.json({ recorded: false, reason: `unhandled type ${event.type}` });
  }

  const scope =
    event.product_id === PRODUCTS.creatorLaunchCredit
      ? { scope_type: 'PITCH_DRAFT' as const, scope_id: pitchDraftId }
      : { scope_type: 'CAMPAIGN' as const, scope_id: campaignId };
  if (scope.scope_id === null) {
    console.warn('revenuecat: missing scope attribute for', event.product_id, event.id);
    return NextResponse.json({ recorded: false, reason: 'missing scope attribute' });
  }

  const { error: purchaseError } = await serviceClient.from('purchase_events').insert({
    purchaser_user_id: userId.data,
    product_id: event.product_id,
    scope_type: scope.scope_type,
    scope_id: scope.scope_id,
    provider_event_id: event.id,
    purchased_at: purchasedAt,
  });
  if (purchaseError !== null) {
    // Unique violation on provider_event_id means the retry already landed.
    if (purchaseError.code === '23505') {
      return NextResponse.json({ recorded: true, deduplicated: true });
    }
    console.warn('revenuecat: purchase_events insert failed', purchaseError.message);
    return NextResponse.json({ error: 'record failed' }, { status: 500 });
  }

  if (event.product_id === PRODUCTS.creatorLaunchCredit) {
    await serviceClient.from('purchase_credit_ledger').insert({
      user_id: userId.data,
      credit_state: 'available',
      product_id: event.product_id,
      pitch_draft_id: scope.scope_id,
      idempotency_key: event.id,
    });
  }

  if (event.product_id === PRODUCTS.campaignPass30d) {
    await serviceClient.from('campaign_entitlements').upsert(
      {
        campaign_id: scope.scope_id,
        product_id: event.product_id,
        active: true,
        expires_at:
          event.expiration_at_ms != null
            ? new Date(event.expiration_at_ms).toISOString()
            : new Date(Date.parse(purchasedAt) + 30 * 24 * 3600 * 1000).toISOString(),
      },
      { onConflict: 'campaign_id,product_id' },
    );
  }

  await serviceClient.from('analytics_events').insert({
    user_id: userId.data,
    event_name:
      event.product_id === PRODUCTS.creatorLaunchCredit
        ? 'creator_launch_purchased'
        : 'campaign_pass_purchased',
    properties: { product_id: event.product_id, scope_type: scope.scope_type },
  });

  return NextResponse.json({ recorded: true });
}
