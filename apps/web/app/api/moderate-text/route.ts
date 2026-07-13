import { createHash } from 'node:crypto';

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { createProviders, ProviderNotImplementedError } from '@friendword/adapters';
import { createBrowserClient } from '@friendword/data';

import { isActiveAccount } from '@/lib/accountStatus';
import { reconcileProviderUsage, reserveProviderUsage } from '@/lib/providerBudget';
import { getSupabaseServiceClient } from '@/lib/supabaseServer';

export const dynamic = 'force-dynamic';

const requestSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('pitch_content'), draftId: z.string().uuid() }),
  z.object({ kind: z.literal('profile_bio'), text: z.string().min(1).max(500) }),
  z.object({ kind: z.literal('interest_note'), text: z.string().min(1).max(500) }),
]);

const MODERATIONS_PER_HOUR_PER_USER = 30;

/**
 * Server-authoritative text moderation (second audit Slice 2, H-3).
 * Verdicts are content-addressed: sha256 of the exact text, per scope.
 * The DB gates (0026) only accept content whose hash carries a passed
 * verdict while media_validation_enforcement is on. The formula here must
 * stay byte-identical to the SQL side: for pitch content that is
 * `${headline}\n\n${body}` hashed as UTF-8.
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

  const parsedBody = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsedBody.success) {
    return NextResponse.json({ error: 'invalid moderation request' }, { status: 400 });
  }
  const input = parsedBody.data;

  const authClient = createBrowserClient(url, anonKey);
  const { data: userData, error: userError } = await authClient.auth.getUser(accessToken);
  if (userError !== null || userData.user === null) {
    return NextResponse.json({ error: 'authentication required' }, { status: 401 });
  }
  const callerId = userData.user.id;
  if (!(await isActiveAccount(serviceClient, callerId))) {
    return NextResponse.json({ error: 'account is not active' }, { status: 403 });
  }

  let content: string;
  let draftId: string | null = null;
  if (input.kind === 'pitch_content') {
    const { data: draft } = await serviceClient
      .from('pitch_drafts')
      .select('created_by_user_id, headline, body, status')
      .eq('id', input.draftId)
      .maybeSingle();
    if (draft === null || draft.created_by_user_id !== callerId) {
      return NextResponse.json({ error: 'draft not found or not yours' }, { status: 404 });
    }
    const headline = draft.headline?.trim() ?? '';
    const body = draft.body?.trim() ?? '';
    if (headline === '' || body === '') {
      return NextResponse.json({ error: 'draft has no content to moderate' }, { status: 409 });
    }
    content = `${draft.headline ?? ''}\n\n${draft.body ?? ''}`;
    draftId = input.draftId;
  } else {
    content = input.text;
  }

  const contentHash = createHash('sha256').update(content, 'utf8').digest('hex');

  // Content-addressed dedupe: an existing verdict answers without another
  // provider call (and keeps replays free).
  const { data: existing } = await serviceClient
    .from('text_moderations')
    .select('moderation_status')
    .eq('scope', input.kind)
    .eq('content_hash', contentHash)
    .maybeSingle();
  if (existing !== null) {
    return NextResponse.json({
      ok: existing.moderation_status === 'passed',
      moderationStatus: existing.moderation_status,
    });
  }

  const oneHourAgo = new Date(Date.now() - 3600_000).toISOString();
  const { count: recentCount } = await serviceClient
    .from('text_moderations')
    .select('id', { count: 'exact', head: true })
    .eq('subject_user_id', callerId)
    .gte('created_at', oneHourAgo);
  if ((recentCount ?? 0) >= MODERATIONS_PER_HOUR_PER_USER) {
    return NextResponse.json({ error: 'too many moderation requests' }, { status: 429 });
  }

  let providers;
  try {
    providers = createProviders({
      FRIENDWORD_PROVIDER_MODE: 'real',
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    });
  } catch (error: unknown) {
    if (error instanceof ProviderNotImplementedError) {
      return NextResponse.json({ error: 'moderation not configured' }, { status: 501 });
    }
    throw error;
  }

  // Cost gate (P0-9): the verdict ledger above already deduplicated, so
  // every reservation here maps to a genuine provider call.
  const reservation = await reserveProviderUsage(
    serviceClient,
    accessToken,
    'moderate_text',
    `moderate-text:${input.kind}:${contentHash}`,
    1,
  );
  if (!reservation.ok) {
    return NextResponse.json({ error: reservation.message }, { status: reservation.httpStatus });
  }

  let verdictAllowed: boolean;
  let moderationRef: string | null = null;
  try {
    const verdict = await providers.moderation.checkText(content);
    verdictAllowed = verdict.allowed;
    moderationRef = verdict.allowed ? null : verdict.categories.join(',').slice(0, 200);
    await reconcileProviderUsage(serviceClient, reservation.reservationId, 1, 'succeeded');
  } catch (error: unknown) {
    if (error instanceof ProviderNotImplementedError) {
      await reconcileProviderUsage(serviceClient, reservation.reservationId, 0, 'released');
      return NextResponse.json({ error: 'moderation not configured' }, { status: 501 });
    }
    await reconcileProviderUsage(serviceClient, reservation.reservationId, 0, 'failed');
    console.warn('text moderation: provider call failed');
    return NextResponse.json({ error: 'moderation unavailable' }, { status: 502 });
  }

  const { error: upsertError } = await serviceClient.from('text_moderations').upsert(
    {
      scope: input.kind,
      content_hash: contentHash,
      moderation_status: verdictAllowed ? 'passed' : 'flagged',
      moderation_ref: moderationRef,
      subject_user_id: callerId,
      pitch_draft_id: draftId,
    },
    { onConflict: 'scope,content_hash' },
  );
  if (upsertError !== null) {
    console.warn('text moderation: verdict write failed');
    return NextResponse.json({ error: 'moderation write failed' }, { status: 500 });
  }

  return NextResponse.json({
    ok: verdictAllowed,
    moderationStatus: verdictAllowed ? 'passed' : 'flagged',
  });
}
