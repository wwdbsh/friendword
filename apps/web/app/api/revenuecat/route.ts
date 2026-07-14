import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getSupabaseServiceClient } from '@/lib/supabaseServer';

export const dynamic = 'force-dynamic';

const attributeSchema = z.object({ value: z.string().nullable() }).partial({ value: true });

/**
 * Event-type-aware webhook contract (second audit P0-3). RevenueCat's
 * real payloads differ per type: TRANSFER carries transferred_from/to
 * and no product or app_user_id; lifecycle events may omit subscriber
 * attributes entirely. The route only rejects shapes that are actually
 * malformed — everything authenticated and well-formed is forwarded so
 * the DB state machine can attribute it or park it in the durable
 * review queue. Nothing money-related is terminally dropped here.
 */
const baseEventSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  environment: z.string().min(1).optional(),
  app_user_id: z.string().min(1).optional(),
  product_id: z.string().min(1).optional(),
  purchased_at_ms: z.number().optional(),
  expiration_at_ms: z.number().nullable().optional(),
  transaction_id: z.string().min(1).optional(),
  original_transaction_id: z.string().min(1).optional(),
  aliases: z.array(z.string()).optional(),
  original_app_user_id: z.string().min(1).optional(),
  transferred_from: z.array(z.string()).optional(),
  transferred_to: z.array(z.string()).optional(),
  subscriber_attributes: z.record(z.string(), attributeSchema).optional().default({}),
});

const PURCHASE_TYPES = new Set(['INITIAL_PURCHASE', 'NON_RENEWING_PURCHASE', 'RENEWAL']);
const LIFECYCLE_TYPES = new Set(['CANCELLATION', 'REFUND', 'EXPIRATION']);

type ParsedEvent = z.infer<typeof baseEventSchema>;

function eventShapeError(event: ParsedEvent): string | null {
  const type = event.type.toUpperCase();
  if (PURCHASE_TYPES.has(type)) {
    if (event.app_user_id === undefined) return 'purchase events require app_user_id';
    if (event.product_id === undefined) return 'purchase events require product_id';
    if (event.transaction_id === undefined || event.original_transaction_id === undefined) {
      return 'purchase events require transaction identifiers';
    }
  }
  if (LIFECYCLE_TYPES.has(type)) {
    if (event.product_id === undefined) return 'lifecycle events require product_id';
    if (event.original_transaction_id === undefined) {
      return 'lifecycle events require original_transaction_id';
    }
  }
  return null;
}

const webhookSchema = z.object({ event: baseEventSchema }).passthrough();

const rpcResponseSchema = z
  .object({
    recorded: z.boolean(),
    deduplicated: z.boolean().optional(),
    benefit: z.unknown().optional(),
    needs_review: z.boolean().optional(),
  })
  .strip();

type RevenueCatRpcClient = {
  readonly rpc: (
    functionName: 'record_revenuecat_event',
    params: { readonly payload: Readonly<Record<string, unknown>> },
  ) => PromiseLike<{ readonly data: unknown; readonly error: unknown }>;
};

function hasRevenueCatRpc(client: unknown): client is RevenueCatRpcClient {
  return (
    typeof client === 'object' &&
    client !== null &&
    'rpc' in client &&
    typeof client.rpc === 'function'
  );
}

export async function POST(request: Request): Promise<NextResponse> {
  const expectedToken = process.env.REVENUECAT_WEBHOOK_AUTH_TOKEN;
  if (expectedToken === undefined || expectedToken === '') {
    return NextResponse.json({ error: 'webhook not configured' }, { status: 501 });
  }

  const authorization = request.headers.get('authorization') ?? '';
  if (authorization !== expectedToken && authorization !== `Bearer ${expectedToken}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const parsed = webhookSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'malformed event' }, { status: 400 });
  }

  const event = parsed.data.event;
  const shapeError = eventShapeError(event);
  if (shapeError !== null) {
    return NextResponse.json({ error: shapeError }, { status: 400 });
  }

  // Forward the purchase intent attribute only when RevenueCat actually
  // sent one — the DB refuses fabricated attribution.
  const purchaseIntentAttribute = event.subscriber_attributes['purchase_intent_id'];
  const payload = {
    id: event.id,
    type: event.type,
    app_user_id: event.app_user_id,
    product_id: event.product_id,
    purchased_at_ms: event.purchased_at_ms,
    expiration_at_ms: event.expiration_at_ms,
    transaction_id: event.transaction_id,
    original_transaction_id: event.original_transaction_id,
    environment: event.environment,
    aliases: event.aliases ?? [],
    original_app_user_id: event.original_app_user_id,
    transferred_from: event.transferred_from,
    transferred_to: event.transferred_to,
    subscriber_attributes:
      purchaseIntentAttribute === undefined ? {} : { purchase_intent_id: purchaseIntentAttribute },
  } satisfies Readonly<Record<string, unknown>>;

  const serviceClient: unknown = getSupabaseServiceClient();
  if (!hasRevenueCatRpc(serviceClient)) {
    return NextResponse.json({ error: 'not configured' }, { status: 501 });
  }

  // The record RPC takes a single jsonb `payload`; alias attribution is derived
  // DB-side from `payload.aliases` (0038), keeping the payload the one source of
  // truth so the route cannot pass a divergent alias set (audit P0-3).
  const { data, error } = await serviceClient.rpc('record_revenuecat_event', { payload });
  if (error !== null) {
    // Every RPC failure is retryable from RevenueCat's point of view:
    // attribution problems no longer raise (they land in the durable
    // review queue), so whatever remains is malformed-or-transient and
    // must not be swallowed with a terminal 200.
    console.warn('revenuecat: record RPC failed');
    return NextResponse.json({ error: 'record failed' }, { status: 500 });
  }

  const rpcResponse = rpcResponseSchema.safeParse(data);
  if (!rpcResponse.success) {
    console.warn('revenuecat: invalid RPC response');
    return NextResponse.json({ error: 'record failed' }, { status: 500 });
  }

  return NextResponse.json(rpcResponse.data);
}
