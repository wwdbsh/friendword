import { NextResponse } from 'next/server';
import { z } from 'zod';

import {
  createProviders,
  isEmptyTranscriptionError,
  ProviderNotImplementedError,
} from '@friendword/adapters';
import { judgeTranscriptSufficiency } from '@friendword/contracts';
import { createBrowserClient, isTranscriptionEditableStatus } from '@friendword/data';

import { isActiveAccount } from '@/lib/accountStatus';
import { reconcileProviderUsage, reserveProviderUsage } from '@/lib/providerBudget';
import { getSupabaseServiceClient } from '@/lib/supabaseServer';

export const dynamic = 'force-dynamic';

const requestSchema = z.object({ draftId: z.string().uuid() });
const PITCH_MEDIA_BUCKET = 'pitch-media';
// Ceiling handed to the transcription provider for one recording. It is a cap,
// not a measurement: the speech-coverage denominator comes from the provider's
// own reported audio duration, never from this value.
const TRANSCRIBE_DURATION_MS = 60_000;

const wordTimingsSchema = z
  .array(z.object({ start: z.number(), end: z.number(), word: z.string() }))
  .min(1);

/**
 * A7: persist provider word timings when they are present, drop them when they
 * are malformed. Returns a spreadable fragment so an absent `words` key stays
 * absent in the stored JSONB rather than becoming an empty array that later
 * readers could mistake for "this recording has no words".
 *
 * Read structurally rather than off the adapter type: the values come from the
 * provider, and a stored transcript is what the consent revision freezes, so a
 * malformed entry must be dropped here instead of published.
 */
function wordTimings(transcript: unknown): {
  readonly words?: readonly {
    readonly start: number;
    readonly end: number;
    readonly word: string;
  }[];
} {
  const candidate = (transcript as { readonly words?: unknown }).words;
  const parsed = wordTimingsSchema.safeParse(candidate);
  return parsed.success ? { words: parsed.data } : {};
}

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
    return NextResponse.json(
      { error: 'draft is no longer editable', code: 'draft_not_editable' },
      { status: 409 },
    );
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

  const voiceObjectName = `${draftId}/voice.m4a`;
  const { data: signed, error: signError } = await serviceClient.storage
    .from(PITCH_MEDIA_BUCKET)
    .createSignedUrl(voiceObjectName, 600);
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
    userData.user.id,
    'transcribe',
    `transcribe:${draftId}:${voiceVersion}`,
    3,
    draftId,
  );
  if (!reservation.ok) {
    return NextResponse.json(
      { error: reservation.message, code: reservation.code },
      { status: reservation.httpStatus },
    );
  }
  if (!reservation.granted) {
    if (reservation.priorStatus === 'succeeded') {
      // S1: distinct from the consent 409 above. The app used to read every
      // 409 as "confirm AI consent again", which is untrue here — the draft
      // already exists.
      return NextResponse.json(
        { error: 'this recording was already transcribed', code: 'already_transcribed' },
        { status: 409 },
      );
    }
    // priorStatus === 'reserved': another attempt is mid-transcription.
    return NextResponse.json(
      { error: 'transcription already in progress', code: 'transcription_in_progress' },
      { status: 409 },
    );
  }

  /**
   * B1: the refusal tells the introducer to record again, so the unusable
   * object has to go — signed uploads are `upsert:false` and creators hold
   * INSERT only, so a take left in place can never be replaced and the advice
   * is unfollowable. Ownership and the editable status are proven above, and no
   * consent revision can exist in those states, so these bytes are nobody's
   * record of anything.
   *
   * The object NAME is deliberately unchanged: the pitch_assets voice row keeps
   * pointing at this path (voice rows are not removable — migration 0046), the
   * consent revision snapshots that path, the published pitch reads it by
   * convention and the orphan sweep keeps it. The next upload refills the same
   * path and mints a new `updated_at`, which is exactly what makes the next
   * reservation ref fresh.
   *
   * Best effort by design: a failed delete must not turn a truthful 422 into a
   * 502, so it is logged and the refusal still stands.
   */
  const discardVoiceObject = async (): Promise<void> => {
    // TOCTOU: the status was checked before the provider call, which takes
    // seconds. Another session can submit a `changes_requested` draft for
    // consent in that window, and a consent revision must never reference bytes
    // this request went on to delete. Re-read and skip if the draft left the
    // editable states; the refusal itself still stands.
    const { data: current, error: currentError } = await serviceClient
      .from('pitch_drafts')
      .select('status')
      .eq('id', draftId)
      .maybeSingle();
    if (
      currentError !== null ||
      current === null ||
      !isTranscriptionEditableStatus(current.status)
    ) {
      console.warn('transcribe: left the refused voice object in place, the draft moved on');
      return;
    }

    const { error: removeError } = await serviceClient.storage
      .from(PITCH_MEDIA_BUCKET)
      .remove([voiceObjectName]);
    if (removeError !== null) {
      console.warn('transcribe: could not delete the refused voice object');
      return;
    }
    // The verdict described bytes that no longer exist. The re-upload's
    // /api/media/validate call rewrites this row anyway; dropping it keeps the
    // gap honest in between.
    await serviceClient
      .from('media_validations')
      .delete()
      .eq('bucket_id', PITCH_MEDIA_BUCKET)
      .eq('object_name', voiceObjectName);
  };

  /**
   * T001 (issue #70): one refusal for every "we could not hear you" outcome —
   * a transcript with no usable speech, and a provider that returned no text at
   * all. The transcription call still happened and still cost money, so the
   * reservation closes as succeeded exactly like the moderation refusal below,
   * and the unusable object is deleted so the next take can take its place.
   */
  const refuseForSilence = async (reason: string, wordCount: number): Promise<NextResponse> => {
    await reconcileProviderUsage(
      serviceClient,
      reservation.reservationId,
      reservation.leaseToken,
      3,
      'succeeded',
    );
    await discardVoiceObject();
    return NextResponse.json(
      { error: 'insufficient speech', code: 'insufficient_speech', reason, wordCount },
      { status: 422 },
    );
  };

  try {
    const transcript = await providers.transcription.transcribe({
      uri: signed.signedUrl,
      durationMs: TRANSCRIBE_DURATION_MS,
    });

    // T001 (issue #70): refuse to draft from a recording that transcribed to
    // nothing usable. Production returned `".     .  .  "` for a 54s take and
    // the structuring model invented an entire pitch from it, which then flowed
    // to the dater's review, the public page and the MP4. The check sits here —
    // before moderation, structuring and any write — so no invented content can
    // exist, and no transcript is persisted either: the introducer re-records.
    const sufficiency = judgeTranscriptSufficiency({
      text: transcript.text,
      ...(transcript.segments === undefined ? {} : { segments: transcript.segments }),
      // Only a provider-reported duration is a real measurement; the request
      // cap above is a ceiling, and using it would score a short honest take as
      // low coverage. Absent it the judge decides on words alone.
      ...(transcript.durationSeconds === undefined
        ? {}
        : { durationMs: transcript.durationSeconds * 1000 }),
    });
    if (!sufficiency.sufficient) {
      return refuseForSilence(sufficiency.reason ?? 'no_words', sufficiency.wordCount);
    }

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
      .eq('object_name', voiceObjectName)
      .select('moderation_status')
      .maybeSingle();
    if (!voiceVerdict.allowed) {
      // The provider work still happened and still cost money.
      await reconcileProviderUsage(
        serviceClient,
        reservation.reservationId,
        reservation.leaseToken,
        3,
        'succeeded',
      );
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
      // A7: word-level timings, additive and optional. The request and the
      // adapter type are owned by the mobile/adapters side, so this reads the
      // field structurally and simply omits it when the provider (or an older
      // adapter build) returns none. Nothing downstream depends on it yet:
      // captions and scene timing are both driven by `segments`.
      ...wordTimings(transcript),
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
      return NextResponse.json(
        { error: 'draft is no longer editable', code: 'draft_not_editable' },
        { status: 409 },
      );
    }

    await serviceClient.from('analytics_events').insert({
      user_id: userData.user.id,
      event_name: 'draft_generated',
      properties: {
        pitch_draft_id: draftId,
        hard_claims: structure.hard_claims_requiring_confirmation.length,
      },
    });

    await reconcileProviderUsage(
      serviceClient,
      reservation.reservationId,
      reservation.leaseToken,
      3,
      'succeeded',
    );
    return NextResponse.json({
      headline: structure.hook,
      hardClaims: structure.hard_claims_requiring_confirmation,
    });
  } catch (error: unknown) {
    // T001: whisper answering a silent recording with no text at all is the
    // same product situation as a transcript of "." — the introducer must
    // re-record — so it takes the same 422, not a generic 502.
    if (isEmptyTranscriptionError(error)) {
      return refuseForSilence('no_words', 0);
    }
    // Conservative accounting (P0-NEW-1): actual 0, but the DB keeps at least
    // the estimate so a provider that already charged stays in the cap.
    await reconcileProviderUsage(
      serviceClient,
      reservation.reservationId,
      reservation.leaseToken,
      0,
      'failed',
    );
    return NextResponse.json({ error: 'transcription failed' }, { status: 502 });
  }
}
