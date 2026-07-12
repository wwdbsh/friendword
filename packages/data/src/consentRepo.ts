import { z } from 'zod';

import type { RelationshipDuration, RelationshipType } from '@friendword/contracts';
import type { Session } from '@supabase/supabase-js';

import type { BrowserSupabaseClient } from './client';
import type { PitchAssetRow, PitchDraftRow } from './database.types';
import { DataLayerError, UnauthenticatedError } from './errors';

const rawTokenSchema = z
  .string()
  .trim()
  .min(24)
  .regex(/^[A-Za-z0-9_-]+$/);
const uuidSchema = z.string().uuid();
const PITCH_MEDIA_BUCKET = 'pitch-media';
const VOICE_FILE_NAME = 'voice.m4a';
const SIGNED_URL_TTL_SECONDS = 60 * 60;

export type ConsentPreview = {
  readonly introducerDisplayName: string;
  readonly relationshipType: RelationshipType | null;
  readonly relationshipDuration: RelationshipDuration | null;
  readonly requestStatus: string;
};

export type ConsentClaim = {
  readonly pitchDraftId: string;
};

export type PublishedCampaign = {
  readonly campaignId: string;
  readonly campaignSlug: string;
};

const previewRowSchema = z.array(
  z.object({
    introducer_display_name: z.string(),
    relationship_type: z.string().nullable(),
    relationship_duration: z.string().nullable(),
    request_status: z.string(),
  }),
);

const claimRowSchema = z.array(z.object({ pitch_draft_id: z.string().uuid() }));

const publishRowSchema = z.array(
  z.object({
    campaign_id: z.string().uuid(),
    campaign_slug: z.string().min(1),
  }),
);

/**
 * Flow B client surface: the dater previews an invite anonymously, signs in,
 * claims it, reviews the introducer's material, and approves. Every state
 * transition still happens inside the 0004/0005 SECURITY DEFINER RPCs — this
 * repo only calls them and reads what RLS exposes to the claimed subject.
 */
export class ConsentRepo {
  constructor(private readonly client: BrowserSupabaseClient) {}

  /** Anonymous-safe invite preview; null when the token matches nothing. */
  async getPreview(rawToken: string): Promise<ConsentPreview | null> {
    const parsed = rawTokenSchema.safeParse(rawToken);
    if (!parsed.success) {
      return null;
    }

    const { data, error } = await this.client.rpc('get_consent_preview', {
      raw_token: parsed.data,
    });
    if (error !== null) {
      throw new DataLayerError('consent.getPreview', error);
    }

    const row = previewRowSchema.parse(data).at(0);
    if (row === undefined) {
      return null;
    }

    return {
      introducerDisplayName: row.introducer_display_name,
      relationshipType: (row.relationship_type as RelationshipType | null) ?? null,
      relationshipDuration: (row.relationship_duration as RelationshipDuration | null) ?? null,
      requestStatus: row.request_status,
    };
  }

  /** Links the signed-in dater to the draft (server-validated, 0005 RPC). */
  async claim(rawToken: string): Promise<ConsentClaim> {
    await this.getRequiredSession();
    const { data, error } = await this.client.rpc('claim_consent_request', {
      raw_token: rawTokenSchema.parse(rawToken),
    });
    if (error !== null) {
      throw new DataLayerError('consent.claim', error);
    }

    const row = claimRowSchema.parse(data).at(0);
    if (row === undefined) {
      throw new DataLayerError('consent.claim', new Error('RPC returned no draft'));
    }

    return { pitchDraftId: row.pitch_draft_id };
  }

  /** The claimed subject reads the draft under RLS for review. */
  async getDraftForReview(draftId: string): Promise<PitchDraftRow> {
    await this.getRequiredSession();
    const { data, error } = await this.client
      .from('pitch_drafts')
      .select()
      .eq('id', uuidSchema.parse(draftId))
      .single();
    if (error !== null) {
      throw new DataLayerError('consent.getDraftForReview', error);
    }

    return data;
  }

  /**
   * Short-lived playback URL for the introducer's voice note. Storage RLS
   * only grants this to the draft's creator or claimed subject.
   */
  async createVoicePlaybackUrl(draftId: string): Promise<string> {
    await this.getRequiredSession();
    const objectPath = `${uuidSchema.parse(draftId)}/${VOICE_FILE_NAME}`;
    const { data, error } = await this.client.storage
      .from(PITCH_MEDIA_BUCKET)
      .createSignedUrl(objectPath, SIGNED_URL_TTL_SECONDS);
    if (error !== null) {
      throw new DataLayerError('consent.createVoicePlaybackUrl', error);
    }

    return data.signedUrl;
  }

  /** Registered uploads for the draft, in the introducer's chosen order. */
  async listAssets(draftId: string): Promise<readonly PitchAssetRow[]> {
    await this.getRequiredSession();
    const { data, error } = await this.client
      .from('pitch_assets')
      .select()
      .eq('pitch_draft_id', uuidSchema.parse(draftId))
      .order('sort_order', { ascending: true });
    if (error !== null) {
      throw new DataLayerError('consent.listAssets', error);
    }

    return data;
  }

  /** Signed view URL for a registered asset ('pitch-media/<draft>/<file>'). */
  async createAssetViewUrl(storagePath: string): Promise<string> {
    await this.getRequiredSession();
    const prefix = `${PITCH_MEDIA_BUCKET}/`;
    if (!storagePath.startsWith(prefix)) {
      throw new DataLayerError(
        'consent.createAssetViewUrl',
        new Error(`unexpected storage path: ${storagePath}`),
      );
    }
    const { data, error } = await this.client.storage
      .from(PITCH_MEDIA_BUCKET)
      .createSignedUrl(storagePath.slice(prefix.length), SIGNED_URL_TTL_SECONDS);
    if (error !== null) {
      throw new DataLayerError('consent.createAssetViewUrl', error);
    }

    return data.signedUrl;
  }

  /** Approve and publish in one server transaction; returns the public slug. */
  async approveAndPublish(draftId: string): Promise<PublishedCampaign> {
    await this.getRequiredSession();
    const { data, error } = await this.client.rpc('approve_and_publish_pitch', {
      draft_id: uuidSchema.parse(draftId),
    });
    if (error !== null) {
      throw new DataLayerError('consent.approveAndPublish', error);
    }

    const row = publishRowSchema.parse(data).at(0);
    if (row === undefined) {
      throw new DataLayerError('consent.approveAndPublish', new Error('RPC returned no campaign'));
    }

    return { campaignId: row.campaign_id, campaignSlug: row.campaign_slug };
  }

  private async getRequiredSession(): Promise<Session> {
    const { data, error } = await this.client.auth.getSession();
    if (error !== null) {
      throw new DataLayerError('consent.getSession', error);
    }
    if (data.session === null) {
      throw new UnauthenticatedError();
    }

    return data.session;
  }
}
