import { z } from 'zod';

import type { RelationshipDuration, RelationshipType } from '@friendword/contracts';

import type { ServiceSupabaseClient } from './client';
import { DataLayerError } from './errors';

const slugSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9-]+$/);
const PITCH_MEDIA_BUCKET = 'pitch-media';
const VOICE_FILE_NAME = 'voice.m4a';
const SIGNED_URL_TTL_SECONDS = 60 * 60;

export type PublishedPitchPhoto = {
  readonly url: string;
  readonly sortOrder: number;
};

export type PublishedTranscriptSegment = {
  readonly start: number;
  readonly end: number;
  readonly text: string;
};

export type PublishedTranscript = {
  readonly text: string;
  readonly segments: readonly PublishedTranscriptSegment[];
};

export type PublishedPitch = {
  readonly campaignId: string;
  readonly campaignSlug: string;
  readonly publishedAt: string | null;
  readonly daterDisplayName: string;
  readonly introducerDisplayName: string;
  readonly relationshipType: RelationshipType | null;
  readonly relationshipDuration: RelationshipDuration | null;
  readonly headline: string | null;
  readonly body: string | null;
  readonly transcript: PublishedTranscript | null;
  readonly approximateLocation: string | null;
  readonly voiceUrl: string | null;
  readonly photos: readonly PublishedPitchPhoto[];
};

/**
 * Server-only read model for the public pitch page. Takes the service client
 * on purpose: anonymous visitors have no session, so the page's Next.js
 * server component fetches on their behalf and exposes only what the dater
 * already approved for publication.
 */
export async function getPublishedPitchBySlug(
  client: ServiceSupabaseClient,
  slug: string,
): Promise<PublishedPitch | null> {
  const parsedSlug = slugSchema.safeParse(slug);
  if (!parsedSlug.success) {
    return null;
  }

  const { data: campaign, error: campaignError } = await client
    .from('campaigns')
    .select()
    .eq('slug', parsedSlug.data)
    .eq('status', 'published')
    .or(`ends_at.is.null,ends_at.gt.${new Date().toISOString()}`)
    .maybeSingle();
  if (campaignError !== null) {
    throw new DataLayerError('publishedPitch.campaign', campaignError);
  }
  if (campaign === null) {
    return null;
  }

  const { data: draft, error: draftError } = await client
    .from('pitch_drafts')
    .select()
    .eq('id', campaign.pitch_draft_id)
    .single();
  if (draftError !== null) {
    throw new DataLayerError('publishedPitch.draft', draftError);
  }

  const { data: profiles, error: profilesError } = await client
    .from('profiles')
    .select()
    .in('user_id', [campaign.owner_user_id, draft.created_by_user_id]);
  if (profilesError !== null) {
    throw new DataLayerError('publishedPitch.profiles', profilesError);
  }

  const daterDisplayName =
    profiles.find((profile) => profile.user_id === campaign.owner_user_id)?.display_name ??
    'A friend';
  const introducerDisplayName =
    profiles.find((profile) => profile.user_id === draft.created_by_user_id)?.display_name ??
    'A friend';

  const { data: signed } = await client.storage
    .from(PITCH_MEDIA_BUCKET)
    .createSignedUrl(`${draft.id}/${VOICE_FILE_NAME}`, SIGNED_URL_TTL_SECONDS);

  const { data: assets, error: assetsError } = await client
    .from('pitch_assets')
    .select()
    .eq('pitch_draft_id', draft.id)
    .eq('asset_type', 'photo')
    .order('sort_order', { ascending: true });
  if (assetsError !== null) {
    throw new DataLayerError('publishedPitch.assets', assetsError);
  }

  const bucketPrefix = `${PITCH_MEDIA_BUCKET}/`;
  const photos: PublishedPitchPhoto[] = [];
  for (const asset of assets) {
    if (!asset.storage_path.startsWith(bucketPrefix)) {
      continue;
    }
    const { data: photoSigned } = await client.storage
      .from(PITCH_MEDIA_BUCKET)
      .createSignedUrl(asset.storage_path.slice(bucketPrefix.length), SIGNED_URL_TTL_SECONDS);
    if (photoSigned !== null) {
      photos.push({ url: photoSigned.signedUrl, sortOrder: asset.sort_order });
    }
  }

  // CP-2: the published transcript is the dater-approved snapshot.
  let transcript: PublishedTranscript | null = null;
  const rawTranscript = draft.transcript;
  if (
    typeof rawTranscript === 'object' &&
    rawTranscript !== null &&
    !Array.isArray(rawTranscript) &&
    typeof (rawTranscript as { readonly text?: unknown }).text === 'string'
  ) {
    const candidate = rawTranscript as {
      readonly text: string;
      readonly segments?: readonly unknown[];
    };
    const segments = (candidate.segments ?? []).flatMap((segment) => {
      if (
        typeof segment === 'object' &&
        segment !== null &&
        typeof (segment as { readonly start?: unknown }).start === 'number' &&
        typeof (segment as { readonly end?: unknown }).end === 'number' &&
        typeof (segment as { readonly text?: unknown }).text === 'string'
      ) {
        const typed = segment as { start: number; end: number; text: string };
        return [{ start: typed.start, end: typed.end, text: typed.text }];
      }
      return [];
    });
    transcript = { text: candidate.text, segments };
  }

  // CP-1 location precision: 'hidden' publishes no location at all.
  let approximateLocation: string | null = null;
  if (campaign.location_precision !== 'hidden') {
    const { data: daterDatingProfile } = await client
      .from('dating_profiles')
      .select('approximate_location')
      .eq('user_id', campaign.owner_user_id)
      .maybeSingle();
    approximateLocation = daterDatingProfile?.approximate_location ?? null;
  }

  return {
    campaignId: campaign.id,
    campaignSlug: parsedSlug.data,
    publishedAt: campaign.published_at,
    daterDisplayName,
    introducerDisplayName,
    relationshipType: draft.relationship_type,
    relationshipDuration: draft.relationship_duration,
    headline: draft.headline,
    body: draft.body,
    transcript,
    approximateLocation,
    voiceUrl: signed?.signedUrl ?? null,
    photos,
  };
}
