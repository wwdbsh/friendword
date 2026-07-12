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
  readonly voiceUrl: string | null;
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
    voiceUrl: signed?.signedUrl ?? null,
  };
}
