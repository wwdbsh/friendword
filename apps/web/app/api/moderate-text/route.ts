import { createHash } from 'node:crypto';

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { createProviders, ProviderNotImplementedError } from '@friendword/adapters';
import { DATER_PITCH_FIELD_LIMITS, DATER_PITCH_QUALITY_COUNT } from '@friendword/contracts';
import { createBrowserClient } from '@friendword/data';

import { isActiveAccount } from '@/lib/accountStatus';
import { reconcileProviderUsage, reserveProviderUsage } from '@/lib/providerBudget';
import { getSupabaseServiceClient } from '@/lib/supabaseServer';

export const dynamic = 'force-dynamic';

const requestSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('pitch_content'), draftId: z.string().uuid() }),
  // Dater revision text (P0-NEW-3): the subject moderates the copy they are
  // about to freeze into a new revision. headline/body are trimmed to match
  // exactly what create_dater_revision stores, so the content-addressed hash
  // recorded here (under scope 'pitch_content') is the one the DB gate checks.
  z.object({
    kind: z.literal('dater_pitch_content'),
    draftId: z.string().uuid(),
    headline: z.string().trim().min(1).max(120),
    body: z.string().trim().min(1).max(2000),
    // Fifth audit P0: on a structure edit the three qualities publish verbatim
    // but appear nowhere in the derived headline/body. They join the moderated
    // string so the ledger hash matches private.dater_revision_moderation_text
    // (migration 0047) and unmoderated text cannot ride along.
    qualities: z
      .array(z.string().trim().min(1).max(DATER_PITCH_FIELD_LIMITS.quality))
      .length(DATER_PITCH_QUALITY_COUNT)
      .optional(),
  }),
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

  // dater_pitch_content records under the same scope as pitch_content so the
  // Dater's edited copy and the Introducer's original share one content-
  // addressed verdict ledger (identical text dedupes for free) and the DB
  // approve/revision gates read a single scope='pitch_content' row.
  const scope = input.kind === 'dater_pitch_content' ? 'pitch_content' : input.kind;

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
  } else if (input.kind === 'dater_pitch_content') {
    // Authorization: only the claimed subject may moderate their revision copy,
    // and only while the draft still awaits their consent. Anyone else — the
    // Introducer or a stranger — gets the same not-found answer.
    const { data: draft } = await serviceClient
      .from('pitch_drafts')
      .select('subject_user_id, status')
      .eq('id', input.draftId)
      .maybeSingle();
    if (
      draft === null ||
      draft.subject_user_id !== callerId ||
      draft.status !== 'consent_pending'
    ) {
      return NextResponse.json({ error: 'draft not found or not yours' }, { status: 404 });
    }
    // zod already trimmed headline/body, so this is byte-identical to the copy
    // create_dater_revision stores (ConsentRepo trims with the same schema).
    content =
      input.qualities === undefined
        ? `${input.headline}\n\n${input.body}`
        : `${input.headline}\n\n${input.body}\n\n${input.qualities.join('\n\n')}`;
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
    .eq('scope', scope)
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

  // Cost + consent gate (P0-NEW-1/P0-NEW-2): the verdict ledger above already
  // deduplicated (a cache hit needs no external call and no consent), so every
  // reservation here maps to a genuine provider call. pitch_content is scoped
  // to its draft; profile_bio / interest_note are own_content. Consent absent
  // fails honestly (409) — a verdict is a submit precondition, so there is no
  // 'skipped' substitute here.
  const reservation = await reserveProviderUsage(
    serviceClient,
    callerId,
    'moderate_text',
    `moderate-text:${scope}:${contentHash}`,
    1,
    draftId ?? undefined,
  );
  if (!reservation.ok) {
    return NextResponse.json({ error: reservation.message }, { status: reservation.httpStatus });
  }
  if (!reservation.granted) {
    // The content-addressed ledger above answers genuine replays before we
    // ever reserve, so a non-granted reservation here means a concurrent
    // attempt already holds the lease (or just closed it). Fail honestly
    // rather than re-calling the provider.
    return NextResponse.json({ error: 'moderation already in progress' }, { status: 409 });
  }

  let verdictAllowed: boolean;
  let moderationRef: string | null = null;
  try {
    const verdict = await providers.moderation.checkText(content);
    verdictAllowed = verdict.allowed;
    moderationRef = verdict.allowed ? null : verdict.categories.join(',').slice(0, 200);
    await reconcileProviderUsage(
      serviceClient,
      reservation.reservationId,
      reservation.leaseToken,
      1,
      'succeeded',
    );
  } catch (error: unknown) {
    if (error instanceof ProviderNotImplementedError) {
      await reconcileProviderUsage(
        serviceClient,
        reservation.reservationId,
        reservation.leaseToken,
        0,
        'released',
      );
      return NextResponse.json({ error: 'moderation not configured' }, { status: 501 });
    }
    // Conservative accounting (P0-NEW-1): actual 0, DB keeps at least estimate.
    await reconcileProviderUsage(
      serviceClient,
      reservation.reservationId,
      reservation.leaseToken,
      0,
      'failed',
    );
    console.warn('text moderation: provider call failed');
    return NextResponse.json({ error: 'moderation unavailable' }, { status: 502 });
  }

  const { error: upsertError } = await serviceClient.from('text_moderations').upsert(
    {
      scope,
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
