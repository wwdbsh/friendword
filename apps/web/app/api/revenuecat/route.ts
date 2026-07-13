import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getSupabaseServiceClient } from '@/lib/supabaseServer';

export const dynamic = 'force-dynamic';

const attributeSchema = z.object({ value: z.string().nullable() }).partial({ value: true });

const eventSchema = z
  .object({
    id: z.string().min(1),
    type: z.string().min(1),
    app_user_id: z.string().min(1),
    product_id: z.string().min(1),
    purchased_at_ms: z.number().optional(),
    expiration_at_ms: z.number().nullable().optional(),
    transaction_id: z.string().min(1).optional(),
    original_transaction_id: z.string().min(1).optional(),
    environment: z.string().min(1).optional(),
    aliases: z.array(z.string()).optional(),
    original_app_user_id: z.string().min(1).optional(),
    subscriber_attributes: z.record(z.string(), attributeSchema).optional().default({}),
  })
  .passthrough();

const webhookSchema = z.object({ event: eventSchema }).passthrough();

const rpcErrorSchema = z
  .object({
    code: z.string(),
    message: z.string().min(1),
  })
  .passthrough();

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
    subscriber_attributes:
      purchaseIntentAttribute === undefined ? {} : { purchase_intent_id: purchaseIntentAttribute },
  } satisfies Readonly<Record<string, unknown>>;

  const serviceClient: unknown = getSupabaseServiceClient();
  if (!hasRevenueCatRpc(serviceClient)) {
    return NextResponse.json({ error: 'not configured' }, { status: 501 });
  }

  const { data, error } = await serviceClient.rpc('record_revenuecat_event', { payload });
  if (error !== null) {
    const rpcError = rpcErrorSchema.safeParse(error);
    const terminalReason =
      rpcError.success && rpcError.data.code === 'P0001'
        ? /unknown product/i.test(rpcError.data.message)
          ? 'unknown product'
          : /intent/i.test(rpcError.data.message)
            ? 'invalid purchase intent'
            : null
        : null;

    // Product and intent failures are terminal attribution errors. Retrying cannot repair them.
    if (terminalReason !== null) {
      console.warn('revenuecat: terminal RPC rejection');
      return NextResponse.json({ recorded: false, reason: terminalReason });
    }

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
