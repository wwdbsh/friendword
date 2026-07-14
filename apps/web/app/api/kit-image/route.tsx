import { ImageResponse } from 'next/og';
import { z } from 'zod';

import { createBrowserClient } from '@friendword/data';

import { getSupabaseServiceClient } from '@/lib/supabaseServer';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const KIT_WIDTH = 1080;
const KIT_HEIGHT = 1920;
const SIGNED_PHOTO_SECONDS = 5 * 60;
const PITCH_MEDIA_BUCKET = 'pitch-media';

const palette = {
  cream: '#FFF6EA',
  ink: '#221B15',
  pop: '#FF5B2E',
  flirt: '#FF3D8A',
  hype: '#FFC63F',
} as const;

/**
 * Creator Launch benefit (Slice F): renders the unlocked 9:16 share card
 * from the published, dater-approved content. Requires the introducer's
 * own access token and an existing share_kits unlock — the credit is
 * consumed by unlock_share_kit, never here, so re-renders are free.
 */
export async function GET(request: Request): Promise<Response> {
  const serviceClient = getSupabaseServiceClient();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (serviceClient === null || url === undefined || anonKey === undefined) {
    return Response.json({ error: 'not configured' }, { status: 501 });
  }

  const accessToken = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (accessToken === '') {
    return Response.json({ error: 'authentication required' }, { status: 401 });
  }
  const draftId = z.string().uuid().safeParse(new URL(request.url).searchParams.get('draftId'));
  if (!draftId.success) {
    return Response.json({ error: 'draftId required' }, { status: 400 });
  }

  const authClient = createBrowserClient(url, anonKey);
  const { data: userData, error: userError } = await authClient.auth.getUser(accessToken);
  if (userError !== null || userData.user === null) {
    return Response.json({ error: 'authentication required' }, { status: 401 });
  }

  const { data: kit } = await serviceClient
    .from('share_kits')
    .select('id, unlocked_by_user_id')
    .eq('pitch_draft_id', draftId.data)
    .maybeSingle();
  if (kit === null || kit.unlocked_by_user_id !== userData.user.id) {
    return Response.json({ error: 'share kit is not unlocked' }, { status: 403 });
  }

  const { data: draft } = await serviceClient
    .from('pitch_drafts')
    .select('id, headline, subject_user_id, created_by_user_id')
    .eq('id', draftId.data)
    .single();
  if (draft === null) {
    return Response.json({ error: 'draft not found' }, { status: 404 });
  }

  const { data: campaign } = await serviceClient
    .from('campaigns')
    .select('slug')
    .eq('pitch_draft_id', draft.id)
    .maybeSingle();

  const { data: profiles } = await serviceClient
    .from('profiles')
    .select('user_id, display_name')
    .in(
      'user_id',
      [draft.subject_user_id, draft.created_by_user_id].filter(
        (value): value is string => value !== null,
      ),
    );
  const daterName =
    profiles?.find((row) => row.user_id === draft.subject_user_id)?.display_name ?? 'A friend';
  const introducerName =
    profiles?.find((row) => row.user_id === draft.created_by_user_id)?.display_name ?? 'A friend';

  const { data: photo } = await serviceClient
    .from('pitch_assets')
    .select('storage_path')
    .eq('pitch_draft_id', draft.id)
    .eq('asset_type', 'photo')
    .order('sort_order', { ascending: true })
    .limit(1)
    .maybeSingle();
  const bucketPrefix = `${PITCH_MEDIA_BUCKET}/`;
  const objectPath = photo?.storage_path.startsWith(bucketPrefix)
    ? photo.storage_path.slice(bucketPrefix.length)
    : photo?.storage_path;
  if (objectPath === undefined) {
    return Response.json({ error: 'approved photo missing' }, { status: 409 });
  }
  const { data: signedPhoto, error: signingError } = await serviceClient.storage
    .from(PITCH_MEDIA_BUCKET)
    .createSignedUrl(objectPath, SIGNED_PHOTO_SECONDS);
  if (signingError !== null || signedPhoto === null) {
    return Response.json({ error: 'approved photo missing' }, { status: 409 });
  }

  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: palette.cream,
        color: palette.ink,
        fontFamily: 'sans-serif',
        padding: 56,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div
          style={{
            display: 'flex',
            border: `6px solid ${palette.ink}`,
            borderRadius: 999,
            background: palette.hype,
            padding: '16px 28px',
            fontSize: 34,
            fontWeight: 800,
            transform: 'rotate(-2deg)',
          }}
        >
          FRIENDWORD ORIGINAL
        </div>
        <div style={{ display: 'flex', fontSize: 30, fontWeight: 700 }}>
          {campaign?.slug !== null && campaign?.slug !== undefined
            ? `friendword /p/${campaign.slug}`
            : 'friendword'}
        </div>
      </div>

      <div
        style={{
          flex: 1,
          display: 'flex',
          marginTop: 44,
          marginBottom: 44,
          border: `10px solid ${palette.ink}`,
          borderRadius: 48,
          boxShadow: `20px 20px 0 ${palette.ink}`,
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        <img
          src={signedPhoto.signedUrl}
          alt=""
          width={KIT_WIDTH - 132}
          height={KIT_HEIGHT - 620}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            background: 'linear-gradient(180deg, transparent 55%, rgba(34,27,21,0.78) 100%)',
          }}
        />
        <div
          style={{
            position: 'absolute',
            left: 40,
            right: 40,
            bottom: 40,
            display: 'flex',
            flexDirection: 'column',
            color: palette.cream,
          }}
        >
          <div style={{ display: 'flex', fontSize: 34, fontWeight: 600 }}>
            {introducerName} introduces
          </div>
          <div style={{ display: 'flex', fontSize: 72, fontWeight: 800 }}>{daterName}</div>
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 22,
          marginBottom: 30,
        }}
      >
        <div
          style={{
            display: 'flex',
            border: `6px solid ${palette.ink}`,
            borderRadius: 20,
            background: palette.flirt,
            color: palette.cream,
            padding: '18px 30px',
            fontSize: 36,
            fontWeight: 800,
          }}
        >
          VOICE PITCH
        </div>
        <div style={{ display: 'flex', flex: 1, fontSize: 30, fontWeight: 600, color: '#5f5347' }}>
          Press play at the link to hear it.
        </div>
      </div>

      <div style={{ display: 'flex', fontSize: 40, fontWeight: 700 }}>
        {draft.headline ?? 'Hear it in my words.'}
      </div>
      <div style={{ display: 'flex', fontSize: 30, marginTop: 14, color: '#5f5347' }}>
        Dating, in your friends&apos; words.
      </div>
    </div>,
    {
      width: KIT_WIDTH,
      height: KIT_HEIGHT,
      headers: { 'Cache-Control': 'private, no-store' },
    },
  );
}
