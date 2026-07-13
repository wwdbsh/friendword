import { NextResponse } from 'next/server';
import { z } from 'zod';

import { createProviders, ProviderNotImplementedError } from '@friendword/adapters';
import { createBrowserClient, isTranscriptionEditableStatus } from '@friendword/data';

import { isActiveAccount } from '@/lib/accountStatus';
import { reconcileProviderUsage, reserveProviderUsage } from '@/lib/providerBudget';
import { getSupabaseServiceClient } from '@/lib/supabaseServer';

export const dynamic = 'force-dynamic';

const requestSchema = z.object({ draftId: z.string().uuid() });
const PITCH_MEDIA_BUCKET = 'pitch-media';

/**
 * Turns the introducer's uploaded voice note into the structured draft
 * (Flow A step 5): transcription → PitchStructure → headline/body on the
 * draft. Requires the introducer's own access token; runs the real OpenAI
 * providers and reports 501 honestly when the key is not configured —
 * nothing is ever faked into the draft.
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
    return NextResponse.json({ error: 'draftId required' }, { status: 400 });
  }
  const { draftId } = parsedBody.data;

  const authClient = createBrowserClient(url, anonKey);
  const { data: userData, error: userError } = await authClient.auth.getUser(accessToken);
  if (userError !== null || userData.user === null) {
    return NextResponse.json({ error: 'authentication required' }, { status: 401 });
  }
  if (!(await isActiveAccount(serviceClient, userData.user.id))) {
    return NextResponse.json({ error: 'account is not active' }, { status: 403 });
  }

  const { data: draft, error: draftError } = await serviceClient
    .from('pitch_drafts')
    .select()
    .eq('id', draftId)
    .single();
  if (draftError !== null || draft.created_by_user_id !== userData.user.id) {
    return NextResponse.json({ error: 'draft not found or not yours' }, { status: 404 });
  }
  if (!isTranscriptionEditableStatus(draft.status)) {
    return NextResponse.json({ error: 'draft is no longer editable' }, { status: 409 });
  }

  let providers;
  try {
    providers = createProviders({
      FRIENDWORD_PROVIDER_MODE: 'real',
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    });
  } catch (error: unknown) {
    if (error instanceof ProviderNotImplementedError) {
      return NextResponse.json({ error: 'transcription not configured' }, { status: 501 });
    }
    throw error;
  }

  const { data: signed, error: signError } = await serviceClient.storage
    .from(PITCH_MEDIA_BUCKET)
    .createSignedUrl(`${draftId}/voice.m4a`, 600);
  if (signError !== null) {
    return NextResponse.json({ error: 'voice note not found' }, { status: 404 });
  }

  // Cost + consent gate (second audit P0-9/P0-10): reserve before any
  // provider byte moves. The request ref is bound to the exact voice
  // object version, so replays of the same recording never pay twice.
  const { data: voiceObjects } = await serviceClient.storage
    .from(PITCH_MEDIA_BUCKET)
    .list(draftId, { search: 'voice.m4a' });
  const voiceVersion = voiceObjects?.[0]?.updated_at ?? 'unknown';
  const reservation = await reserveProviderUsage(
    serviceClient,
    accessToken,
    'transcribe',
    `transcribe:${draftId}:${voiceVersion}`,
    3,
    draftId,
  );
  if (!reservation.ok) {
    return NextResponse.json({ error: reservation.message }, { status: reservation.httpStatus });
  }
  if (reservation.status === 'succeeded') {
    return NextResponse.json({ error: 'this recording was already transcribed' }, { status: 409 });
  }

  try {
    const transcript = await providers.transcription.transcribe({
      uri: signed.signedUrl,
      durationMs: 60_000,
    });

    // Voice moderation (second audit P0-2): the transcript is the audio's
    // moderatable form. The verdict upgrades the voice object's
    // media_validations row from 'skipped', which is what the enforcement
    // gate requires before this draft can enter consent. Only an existing
    // row is updated — structural checks stay owned by /api/media/validate.
    const voiceVerdict = await providers.moderation.checkText(transcript.text);
    const { data: voiceValidation } = await serviceClient
      .from('media_validations')
      .update({
        moderation_status: voiceVerdict.allowed ? 'passed' : 'flagged',
        moderation_ref: voiceVerdict.allowed
          ? null
          : voiceVerdict.categories.join(',').slice(0, 200),
      })
      .eq('bucket_id', PITCH_MEDIA_BUCKET)
      .eq('object_name', `${draftId}/voice.m4a`)
      .select('moderation_status')
      .maybeSingle();
    if (!voiceVerdict.allowed) {
      // The provider work still happened and still cost money.
      await reconcileProviderUsage(serviceClient, reservation.reservationId, 3, 'succeeded');
      return NextResponse.json(
        { error: 'the voice recording did not pass moderation' },
        { status: 422 },
      );
    }
    if (voiceValidation === null) {
      console.warn('transcribe: voice object has no validation row to upgrade');
    }

    const structure = await providers.pitchStructure.structure(transcript.text, {
      relationshipType: draft.relationship_type ?? 'friend',
      relationshipDuration: draft.relationship_duration ?? 'y1to3',
    });

    const body = [
      structure.relationship_context,
      structure.evidence_or_anecdote,
      `A good match: ${structure.good_match_for}`,
    ]
      .filter((part) => part.trim() !== '')
      .join('\n\n');

    // CP-2: persist the real transcript (text + segment timestamps) so the
    // consent revision snapshots it and the public pitch can render true
    // captions and an accessible transcript.
    const transcriptRecord = {
      text: transcript.text,
      language: transcript.language,
      segments: transcript.segments ?? [],
    };
    const { data: updatedDraft, error: updateError } = await serviceClient
      .from('pitch_drafts')
      .update({ headline: structure.hook, body, structure, transcript: transcriptRecord })
      .eq('id', draftId)
      .in('status', ['draft', 'changes_requested'])
      .select('id')
      .maybeSingle();
    if (updateError !== null) {
      return NextResponse.json({ error: 'draft update failed' }, { status: 500 });
    }
    if (updatedDraft === null) {
      return NextResponse.json({ error: 'draft is no longer editable' }, { status: 409 });
    }

    await serviceClient.from('analytics_events').insert({
      user_id: userData.user.id,
      event_name: 'draft_generated',
      properties: {
        pitch_draft_id: draftId,
        hard_claims: structure.hard_claims_requiring_confirmation.length,
      },
    });

    await reconcileProviderUsage(serviceClient, reservation.reservationId, 3, 'succeeded');
    return NextResponse.json({
      headline: structure.hook,
      hardClaims: structure.hard_claims_requiring_confirmation,
    });
  } catch {
    await reconcileProviderUsage(serviceClient, reservation.reservationId, 0, 'failed');
    return NextResponse.json({ error: 'transcription failed' }, { status: 502 });
  }
}
