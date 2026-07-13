import type { BrowserSupabaseClient } from './client';
import { DataLayerError, UnauthenticatedError } from './errors';

export type CampaignPassState = {
  readonly active: boolean;
  readonly expiresAt: string | null;
};

export type OwnedCampaignBenefit = {
  readonly id: string;
  readonly pitchDraftId: string;
  readonly slug: string | null;
  readonly headline: string | null;
  readonly status: 'published' | 'paused';
  readonly pass: CampaignPassState;
};

export type CampaignFunnelRow = {
  readonly eventName: string;
  readonly source: string;
  readonly total: number;
};

export type ShareKitUnlock = {
  readonly shareKitId: string;
  readonly alreadyUnlocked: boolean;
};

export class CreatorCreditRequiredError extends Error {
  override readonly name = 'CreatorCreditRequiredError';

  constructor() {
    super('A Creator Launch credit is required for this pitch');
  }
}

export class KitNotPublishedError extends Error {
  override readonly name = 'KitNotPublishedError';

  constructor() {
    super('The share kit unlocks after the pitch is approved and published');
  }
}

function translate(scope: string, error: { readonly message: string }): Error {
  if (error.message.includes('authentication required')) {
    return new UnauthenticatedError();
  }

  return new DataLayerError(scope, error);
}

/**
 * Paid benefit consumers (audit P0-4 / Slice F). The Campaign Pass gate
 * lives server-side: analytics calls fail with 'campaign pass required'
 * until the entitlement is active, and the share-kit unlock consumes the
 * Creator Launch credit exactly once.
 */
export class BenefitsRepo {
  constructor(private readonly client: BrowserSupabaseClient) {}

  async listMyOwnedCampaigns(): Promise<readonly OwnedCampaignBenefit[]> {
    const { data: authData, error: authError } = await this.client.auth.getSession();
    if (authError !== null) {
      throw new DataLayerError('benefits.ownedCampaignsSession', authError);
    }
    if (authData.session === null) {
      throw new UnauthenticatedError();
    }

    const { data: campaigns, error: campaignsError } = await this.client
      .from('campaigns')
      .select('id, pitch_draft_id, slug, status')
      .eq('owner_user_id', authData.session.user.id)
      .in('status', ['published', 'paused'])
      .order('updated_at', { ascending: false });
    if (campaignsError !== null) {
      throw new DataLayerError('benefits.ownedCampaigns', campaignsError);
    }
    if (campaigns.length === 0) {
      return [];
    }

    const pitchDraftIds = campaigns.map((campaign) => campaign.pitch_draft_id);
    const { data: drafts, error: draftsError } = await this.client
      .from('pitch_drafts')
      .select('id, headline')
      .in('id', pitchDraftIds);
    if (draftsError !== null) {
      throw new DataLayerError('benefits.ownedCampaignDrafts', draftsError);
    }
    const headlines = new Map(drafts.map((draft) => [draft.id, draft.headline]));

    return Promise.all(
      campaigns.filter(isPassSurfaceCampaign).map(async (campaign) => ({
        id: campaign.id,
        pitchDraftId: campaign.pitch_draft_id,
        slug: campaign.slug,
        headline: headlines.get(campaign.pitch_draft_id) ?? null,
        status: campaign.status,
        pass: await this.getCampaignPassState(campaign.id),
      })),
    );
  }

  async getCampaignPassState(campaignId: string): Promise<CampaignPassState> {
    const { data, error } = await this.client.rpc('get_campaign_pass_state', {
      target_campaign_id: campaignId,
    });
    if (error !== null) {
      throw translate('benefits.passState', error);
    }
    const row = data[0];

    return {
      active: row?.pass_active ?? false,
      expiresAt: row?.pass_expires_at ?? null,
    };
  }

  async getCampaignAnalytics(campaignId: string): Promise<readonly CampaignFunnelRow[]> {
    const { data, error } = await this.client.rpc('get_campaign_analytics', {
      target_campaign_id: campaignId,
    });
    if (error !== null) {
      throw translate('benefits.analytics', error);
    }

    return data.map((row) => ({
      eventName: row.event_name,
      source: row.source,
      total: row.total,
    }));
  }

  async unlockShareKit(draftId: string): Promise<ShareKitUnlock> {
    const { data, error } = await this.client.rpc('unlock_share_kit', {
      target_draft_id: draftId,
    });
    if (error !== null) {
      if (error.message.includes('creator launch credit required')) {
        throw new CreatorCreditRequiredError();
      }
      if (error.message.includes('approves and publishes')) {
        throw new KitNotPublishedError();
      }
      throw translate('benefits.unlockShareKit', error);
    }
    const row = data[0];
    if (row === undefined) {
      throw new DataLayerError('benefits.unlockShareKit', new Error('empty unlock result'));
    }

    return { shareKitId: row.share_kit_id, alreadyUnlocked: row.already_unlocked };
  }
}

function isPassSurfaceCampaign<T extends { readonly status: string }>(
  campaign: T,
): campaign is T & { readonly status: 'published' | 'paused' } {
  return campaign.status === 'published' || campaign.status === 'paused';
}
