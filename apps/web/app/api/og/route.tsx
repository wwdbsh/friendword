import { ImageResponse } from 'next/og';
import { z } from 'zod';

import {
  DataLayerError,
  isCampaignPubliclyVisible,
  publicDisplayName,
  type ServiceSupabaseClient,
} from '@friendword/data';

import { getPitchFixture } from '@/fixtures/pitch';
import { getSupabaseServiceClient } from '@/lib/supabaseServer';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const OG_WIDTH = 1200;
const OG_HEIGHT = 630;
const OG_CACHE_SECONDS = 60 * 60;
const SIGNED_PHOTO_SECONDS = 5 * 60;
const PITCH_MEDIA_BUCKET = 'pitch-media';
const slugSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9-]+$/);

const palette = {
  cream: '#FFF6EA',
  ink: '#221B15',
  pop: '#FF5B2E',
  flirt: '#FF3D8A',
  hype: '#FFC63F',
} as const;

// CP-2 honesty: the OG card carries a decorative sticker underline, NOT a bar
// "waveform". A fixed decorative array rendered as variable-height bars read as
// a real audio signal, which the share card cannot substantiate.
const abstractPhotoUrl = `data:image/svg+xml,${encodeURIComponent(`
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 1100">
    <rect width="900" height="1100" fill="#221B15"/>
    <circle cx="690" cy="210" r="300" fill="#FFC63F"/>
    <circle cx="165" cy="990" r="360" fill="#FF5B2E"/>
    <path d="M70 590c80-260 150 220 230-24s150 210 230-18 150 180 300-82" fill="none" stroke="#FF3D8A" stroke-width="42" stroke-linecap="round"/>
  </svg>
`)}`;

type CampaignOg = {
  readonly daterName: string;
  readonly introducerName: string;
  readonly photoUrl: string;
};

function notFoundResponse(): Response {
  return Response.json(
    { error: 'campaign not found' },
    { status: 404, headers: { 'Cache-Control': 'no-store' } },
  );
}

function unavailableResponse(): Response {
  return Response.json(
    { error: 'campaign preview unavailable' },
    { status: 500, headers: { 'Cache-Control': 'no-store' } },
  );
}

async function loadCampaignOg(
  client: ServiceSupabaseClient,
  slug: string,
): Promise<CampaignOg | null> {
  const parsedSlug = slugSchema.safeParse(slug);
  if (!parsedSlug.success) return null;

  const { data: campaign, error: campaignError } = await client
    .from('campaigns')
    .select('pitch_draft_id, owner_user_id')
    .eq('slug', parsedSlug.data)
    .eq('status', 'published')
    .or(`ends_at.is.null,ends_at.gt.${new Date().toISOString()}`)
    .maybeSingle();
  if (campaignError !== null) throw new DataLayerError('campaignOg.campaign', campaignError);
  if (campaign === null) return null;

  // Same server-authoritative public-read gate as the pitch page: a gated
  // campaign renders no OG card and no signed photo URL.
  if (!(await isCampaignPubliclyVisible(client, campaign.pitch_draft_id))) return null;

  const { data: draft, error: draftError } = await client
    .from('pitch_drafts')
    .select('id, created_by_user_id')
    .eq('id', campaign.pitch_draft_id)
    .single();
  if (draftError !== null) throw new DataLayerError('campaignOg.draft', draftError);

  const { data: profiles, error: profilesError } = await client
    .from('profiles')
    .select('user_id, display_name, display_name_confirmed')
    .in('user_id', [campaign.owner_user_id, draft.created_by_user_id]);
  if (profilesError !== null) throw new DataLayerError('campaignOg.profiles', profilesError);

  const { data: photo, error: photoError } = await client
    .from('pitch_assets')
    .select('storage_path')
    .eq('pitch_draft_id', draft.id)
    .eq('asset_type', 'photo')
    .order('sort_order', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (photoError !== null) throw new DataLayerError('campaignOg.photo', photoError);

  const bucketPrefix = `${PITCH_MEDIA_BUCKET}/`;
  const objectPath = photo?.storage_path.startsWith(bucketPrefix)
    ? photo.storage_path.slice(bucketPrefix.length)
    : null;
  if (objectPath === null) {
    throw new DataLayerError('campaignOg.photoPath', photo);
  }
  const { data: signedPhoto, error: signingError } = await client.storage
    .from(PITCH_MEDIA_BUCKET)
    .createSignedUrl(objectPath, SIGNED_PHOTO_SECONDS);
  if (signingError !== null || signedPhoto === null) {
    throw new DataLayerError('campaignOg.photoSigning', signingError);
  }

  // T002 (Issue #71): the OG card is the most widely re-shared surface in the
  // product — it is scraped into other people's timelines. An unconfirmed
  // display name is the email local-part the bootstrap invented (0011), so it
  // gets the same 'A friend' a missing profile row already gets.
  return {
    daterName:
      publicDisplayName(profiles.find((profile) => profile.user_id === campaign.owner_user_id)) ??
      'A friend',
    introducerName:
      publicDisplayName(profiles.find((profile) => profile.user_id === draft.created_by_user_id)) ??
      'A friend',
    photoUrl: signedPhoto.signedUrl,
  };
}

function renderCampaignOg({ daterName, introducerName, photoUrl }: CampaignOg): ImageResponse {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        position: 'relative',
        overflow: 'hidden',
        background: palette.cream,
        color: palette.ink,
        fontFamily: 'sans-serif',
        padding: 48,
      }}
    >
      <div
        style={{
          width: 468,
          height: 534,
          display: 'flex',
          position: 'relative',
          overflow: 'hidden',
          border: `8px solid ${palette.ink}`,
          borderRadius: 36,
          boxShadow: `14px 14px 0 ${palette.ink}`,
          transform: 'rotate(-2deg)',
        }}
      >
        <img
          src={photoUrl}
          alt=""
          width="468"
          height="534"
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            background: 'linear-gradient(180deg, transparent 48%, rgba(34,27,21,0.7) 100%)',
          }}
        />
      </div>

      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '24px 24px 18px 72px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div
            style={{
              display: 'flex',
              border: `4px solid ${palette.ink}`,
              borderRadius: 999,
              background: palette.hype,
              padding: '12px 20px',
              fontSize: 24,
              fontWeight: 800,
              transform: 'rotate(2deg)',
            }}
          >
            FRIENDWORD ORIGINAL
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', fontSize: 38, fontWeight: 700, marginBottom: 12 }}>
            {introducerName} introduces
          </div>
          <div
            style={{
              display: 'flex',
              fontSize: 82,
              lineHeight: 1.04,
              letterSpacing: '-0.06em',
              fontWeight: 900,
            }}
          >
            {daterName}
          </div>
          {/* Decorative sticker underline — clearly branding, not a signal. */}
          <div style={{ display: 'flex', marginTop: 34, alignItems: 'center', gap: 14 }}>
            <div
              style={{
                display: 'flex',
                width: 168,
                height: 14,
                borderRadius: 999,
                background: palette.flirt,
              }}
            />
            <div
              style={{
                display: 'flex',
                width: 22,
                height: 22,
                borderRadius: 999,
                background: palette.hype,
              }}
            />
            <div
              style={{
                display: 'flex',
                width: 14,
                height: 14,
                borderRadius: 999,
                background: palette.pop,
              }}
            />
          </div>
        </div>

        <div style={{ display: 'flex', fontSize: 25, fontWeight: 700 }}>
          Dating, in your friends&apos; words.
        </div>
      </div>
    </div>,
    {
      width: OG_WIDTH,
      height: OG_HEIGHT,
      headers: {
        // Paused or archived campaigns may remain in a social cache for at most this accepted hour.
        'Cache-Control': `public, max-age=0, s-maxage=${OG_CACHE_SECONDS}`,
      },
    },
  );
}

export async function GET(request: Request): Promise<Response> {
  const slug = new URL(request.url).searchParams.get('slug');
  if (slug === null) {
    return notFoundResponse();
  }

  const fixture = getPitchFixture(slug);
  if (fixture !== undefined) {
    return renderCampaignOg({
      daterName: fixture.daterName,
      introducerName: fixture.introducerPseudonym,
      photoUrl: abstractPhotoUrl,
    });
  }

  const serviceClient = getSupabaseServiceClient();
  if (serviceClient === null) {
    return notFoundResponse();
  }

  try {
    const campaign = await loadCampaignOg(serviceClient, slug);
    if (campaign === null) {
      return notFoundResponse();
    }
    return renderCampaignOg(campaign);
  } catch {
    return unavailableResponse();
  }
}
