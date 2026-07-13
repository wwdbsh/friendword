import { z } from 'zod';

import type { RelationshipDuration, RelationshipType } from '@friendword/contracts';
import type { Session } from '@supabase/supabase-js';

import type { BrowserSupabaseClient } from './client';
import type { PitchAssetRow } from './database.types';
import { DataLayerError, UnauthenticatedError } from './errors';

const rawTokenSchema = z
  .string()
  .trim()
  .min(24)
  .regex(/^[A-Za-z0-9_-]+$/);
const uuidSchema = z.string().uuid();
const fileNameSchema = z
  .string()
  .min(1)
  .max(255)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
const PITCH_MEDIA_BUCKET = 'pitch-media';
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

export type ConsentRevision = {
  readonly id: string;
  readonly pitch_draft_id: string;
  readonly revision_number: number;
  readonly headline: string;
  readonly body: string;
  readonly structure: unknown;
  readonly asset_ids: readonly string[];
  readonly voice_asset_path: string | null;
  readonly content_hash: string;
  readonly created_at: string;
};

export type ConsentReview = {
  readonly revision: ConsentRevision;
  readonly assets: readonly PitchAssetRow[];
  readonly hardClaims: readonly string[];
};

export type ConsentApproval = {
  readonly draftId: string;
  readonly campaignDays: 14;
  readonly revisionId: string;
  readonly includedAssetIds: readonly string[];
  readonly hardClaimsConfirmed: boolean;
};

export type ConsentResponseAction = 'request_changes' | 'decline';

export function isTranscriptionEditableStatus(status: string): boolean {
  return status === 'draft' || status === 'changes_requested';
}

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

const revisionStructureSchema = z
  .object({
    hard_claims_requiring_confirmation: z.array(z.string().trim().min(1)).default([]),
  })
  .nullable();

const responseNoteSchema = z.string().trim().min(1);

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

  async getConsentReview(draftId: string): Promise<ConsentReview> {
    await this.getRequiredSession();
    const parsedDraftId = uuidSchema.parse(draftId);
    const { data: request, error: requestError } = await this.client
      .from('consent_requests')
      .select('revision_id')
      .eq('pitch_draft_id', parsedDraftId)
      .single();
    if (requestError !== null) {
      throw new DataLayerError('consent.getConsentReview.request', requestError);
    }
    if (request.revision_id === null) {
      throw new DataLayerError(
        'consent.getConsentReview.request',
        new Error('consent request has no revision'),
      );
    }

    const { data: revision, error: revisionError } = await this.client
      .from('consent_revisions')
      .select()
      .eq('id', request.revision_id)
      .eq('pitch_draft_id', parsedDraftId)
      .single();
    if (revisionError !== null) {
      throw new DataLayerError('consent.getConsentReview.revision', revisionError);
    }

    let assets: readonly PitchAssetRow[] = [];
    if (revision.asset_ids.length > 0) {
      const { data, error } = await this.client
        .from('pitch_assets')
        .select()
        .eq('pitch_draft_id', parsedDraftId)
        .in('id', revision.asset_ids)
        .order('sort_order', { ascending: true });
      if (error !== null) {
        throw new DataLayerError('consent.getConsentReview.assets', error);
      }
      const returnedAssetIds = new Set(data.map((asset) => asset.id));
      if (revision.asset_ids.some((assetId) => !returnedAssetIds.has(assetId))) {
        throw new DataLayerError(
          'consent.getConsentReview.assets',
          new Error('revision asset is unavailable'),
        );
      }
      assets = data;
    }

    const parsedStructure = revisionStructureSchema.safeParse(revision.structure);
    if (!parsedStructure.success) {
      throw new DataLayerError('consent.getConsentReview.structure', parsedStructure.error);
    }

    return {
      revision,
      assets,
      hardClaims: parsedStructure.data?.hard_claims_requiring_confirmation ?? [],
    };
  }

  /** Signed view URL for a registered asset ('pitch-media/<draft>/<file>'). */
  async createAssetViewUrl(storagePath: string): Promise<string> {
    await this.getRequiredSession();
    const prefix = `${PITCH_MEDIA_BUCKET}/`;
    const objectPath = storagePath.startsWith(prefix)
      ? storagePath.slice(prefix.length)
      : storagePath;
    const [draftId, ...pathSegments] = objectPath.split('/');
    const validPath =
      uuidSchema.safeParse(draftId).success &&
      pathSegments.length > 0 &&
      pathSegments.every((segment) => fileNameSchema.safeParse(segment).success);
    if (!validPath) {
      throw new DataLayerError('consent.createAssetViewUrl', new Error('unexpected storage path'));
    }
    const { data, error } = await this.client.storage
      .from(PITCH_MEDIA_BUCKET)
      .createSignedUrl(objectPath, SIGNED_URL_TTL_SECONDS);
    if (error !== null) {
      throw new DataLayerError('consent.createAssetViewUrl', error);
    }

    return data.signedUrl;
  }

  /** Approve and publish in one server transaction; returns the public slug. */
  async approveAndPublish(approval: ConsentApproval): Promise<PublishedCampaign> {
    await this.getRequiredSession();
    const { data, error } = await this.client.rpc('approve_and_publish_pitch', {
      draft_id: uuidSchema.parse(approval.draftId),
      campaign_days: approval.campaignDays,
      revision_id: uuidSchema.parse(approval.revisionId),
      included_asset_ids: approval.includedAssetIds.map((assetId) => uuidSchema.parse(assetId)),
      hard_claims_confirmed: approval.hardClaimsConfirmed,
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

  async respondToConsent(
    draftId: string,
    action: ConsentResponseAction,
    note: string,
  ): Promise<void> {
    await this.getRequiredSession();
    const { error } = await this.client.rpc('respond_consent_request', {
      draft_id: uuidSchema.parse(draftId),
      action,
      note: responseNoteSchema.parse(note),
    });
    if (error !== null) {
      throw new DataLayerError('consent.respondToConsent', error);
    }
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
