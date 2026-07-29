import { z } from 'zod';

import {
  pitchSceneV1Schema,
  pitchStructureSchema,
  type PitchSceneV1,
  type PitchStructure,
  type RelationshipDuration,
  type RelationshipType,
} from '@friendword/contracts';

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
const PUBLIC_BETA_CONFIG_KEY = 'public_beta_enabled';

/**
 * Server-authoritative public-read gate (third audit P0-NEW-4). A published
 * campaign is only visible to the open internet when the `public_beta_enabled`
 * app_config flag is 'on', OR when its pitch draft is on the QA preview
 * allowlist. Fails closed: a missing/non-'on' flag denies unless allowlisted,
 * so an already-published campaign never leaks while the gate is off.
 */
export async function isCampaignPubliclyVisible(
  client: ServiceSupabaseClient,
  pitchDraftId: string,
): Promise<boolean> {
  const { data: config, error: configError } = await client
    .from('app_config')
    .select('value')
    .eq('key', PUBLIC_BETA_CONFIG_KEY)
    .maybeSingle();
  if (configError !== null) {
    throw new DataLayerError('publishedPitch.publicBetaConfig', configError);
  }
  if (config?.value === 'on') {
    return true;
  }

  const { data: allowlisted, error: allowlistError } = await client
    .from('qa_preview_allowlist')
    .select('pitch_draft_id')
    .eq('pitch_draft_id', pitchDraftId)
    .maybeSingle();
  if (allowlistError !== null) {
    throw new DataLayerError('publishedPitch.qaAllowlist', allowlistError);
  }
  return allowlisted !== null;
}

export type PublishedPitchPhoto = {
  /**
   * The asset id the approved scene refers to. Published so the player can bind
   * a scene window to the right image; it identifies an asset the reader is
   * already being shown, so it carries nothing the page does not render.
   */
  readonly assetId: string;
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
  /**
   * The dater-approved structured pitch (CP-1/CP-2 contract for the motion
   * demo). Parsed from the published draft's `structure` JSONB; null when the
   * snapshot is missing or does not match the full PitchStructure shape.
   */
  readonly structure: PitchStructure | null;
  /**
   * True when the published `structure` came from the Dater's own section
   * editor. Read from `pitch_drafts.structure_reviewed`, which migration 0047's
   * approve_and_publish_pitch copies from the approved revision's
   * `structure_reviewed`. The DTO name differs from the column on purpose: on
   * the draft the flag is about the Dater, not about the draft's own edits.
   * False for everything published before that editor existed — those Daters
   * approved a headline/body pair and never saw the sections the page renders.
   * Reader-facing copy MUST branch on this: "reviewed and approved this page"
   * on a false row is a false statement. Fails closed to false on a pre-0047
   * row that has no such column.
   */
  readonly daterReviewedStructure: boolean;
  /**
   * Dater's age in whole years, derived server-side from `profiles.birth_date`
   * (CP-1). The raw birth date is never exposed. Null when no birth date is on
   * file yet.
   */
  readonly age: number | null;
  /** Dater's own stated dating intent (CP-1), shown in the approved preview. */
  readonly datingIntent: string | null;
  /**
   * Canonical approximate location per the dater's precision choice (CP-1):
   * 'hidden' → null, 'region' → region only, 'city' → "City, Region". Region
   * and city precision now yield different strings.
   */
  readonly approximateLocation: string | null;
  readonly voiceUrl: string | null;
  readonly photos: readonly PublishedPitchPhoto[];
  /**
   * The approved motion timeline, projected onto the published draft by
   * approve_and_publish_pitch (migration 0048). Null for a legacy row, for a
   * recording with no transcript segments, or when the stored JSON fails the
   * shared safety floors — the player then falls back to the legacy runtime
   * distribution (A4) instead of playing an illegal timeline.
   */
  readonly scene: PitchSceneV1 | null;
};

/**
 * Whole-year age from an ISO birth date, computed in UTC to line up with the
 * server-side `date_part('year', age(birth_date))` gate. Returns null for a
 * missing or unparseable date, or a date in the future.
 */
export function ageFromBirthDate(birthDate: string | null, now: Date): number | null {
  if (birthDate === null) {
    return null;
  }
  const dob = new Date(birthDate);
  if (Number.isNaN(dob.getTime())) {
    return null;
  }
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const monthDelta = now.getUTCMonth() - dob.getUTCMonth();
  if (monthDelta < 0 || (monthDelta === 0 && now.getUTCDate() < dob.getUTCDate())) {
    age -= 1;
  }
  return age >= 0 ? age : null;
}

function normalizeLocationPart(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * Canonical location string for a non-hidden precision (CP-1). Region precision
 * strips the city; city precision prints "City, Region". Falls back to the
 * legacy unstructured `approximate_location` only when no structured region is
 * stored (pre-0041 rows), which can't be split further.
 */
export function canonicalApproximateLocation(
  precision: 'region' | 'city',
  region: string | null,
  city: string | null,
  legacy: string | null,
): string | null {
  const canonicalRegion = normalizeLocationPart(region);
  const canonicalCity = normalizeLocationPart(city);
  if (canonicalRegion !== null) {
    if (precision === 'region') {
      return canonicalRegion;
    }
    return canonicalCity === null ? canonicalRegion : `${canonicalCity}, ${canonicalRegion}`;
  }
  // Pre-0041 rows only carry the unstructured `approximate_location`, which is
  // a city-level string. Region precision must never leak it (CP-1 invariant:
  // region never shows a city-level string), so it fails closed to null; only
  // city precision may fall back to the legacy string.
  return precision === 'city' ? normalizeLocationPart(legacy) : null;
}

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

  // Gate the public read before touching drafts, assets, or signed URLs so a
  // gated campaign yields a clean 404 and mints no media URLs.
  if (!(await isCampaignPubliclyVisible(client, campaign.pitch_draft_id))) {
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

  const ownerProfile = profiles.find((profile) => profile.user_id === campaign.owner_user_id);
  const daterDisplayName = ownerProfile?.display_name ?? 'A friend';
  const introducerDisplayName =
    profiles.find((profile) => profile.user_id === draft.created_by_user_id)?.display_name ??
    'A friend';

  // CP-1: age is derived from the dater's birth date, never the raw value.
  const age = ageFromBirthDate(ownerProfile?.birth_date ?? null, new Date());

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
      photos.push({ assetId: asset.id, url: photoSigned.signedUrl, sortOrder: asset.sort_order });
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

  // CP-1: the dater's own profile carries their stated intent and the
  // structured location. Read it regardless of precision so intent still
  // surfaces when the location is hidden.
  const { data: daterDatingProfile } = await client
    .from('dating_profiles')
    .select('approximate_location, location_region, location_city, dating_intent')
    .eq('user_id', campaign.owner_user_id)
    .maybeSingle();

  // CP-1 location precision: 'hidden' publishes no location; 'region' strips
  // the city; 'city' prints "City, Region".
  const approximateLocation =
    campaign.location_precision === 'hidden'
      ? null
      : canonicalApproximateLocation(
          campaign.location_precision === 'region' ? 'region' : 'city',
          daterDatingProfile?.location_region ?? null,
          daterDatingProfile?.location_city ?? null,
          daterDatingProfile?.approximate_location ?? null,
        );

  const datingIntent = daterDatingProfile?.dating_intent ?? null;

  // CP-1/CP-2: expose the dater-approved structured pitch for the motion demo.
  // A snapshot that doesn't match the full shape reads as null rather than
  // leaking a partial structure downstream.
  const parsedStructure = pitchStructureSchema.safeParse(draft.structure);
  const structure = parsedStructure.success ? parsedStructure.data : null;

  // Migration 0048: the scene the Dater approved, copied onto the draft at
  // publish. Read structurally so a pre-0048 row (no such column) reads as null.
  const parsedScene = pitchSceneV1Schema.safeParse(
    (draft as { readonly scene_definition?: unknown }).scene_definition ?? null,
  );
  const scene = parsedScene.success ? parsedScene.data : null;

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
    structure,
    daterReviewedStructure: draft.structure_reviewed === true,
    age,
    datingIntent,
    approximateLocation,
    voiceUrl: signed?.signedUrl ?? null,
    photos,
    scene,
  };
}
