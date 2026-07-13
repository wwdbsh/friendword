import type { BrowserSupabaseClient } from './client';
import { DataLayerError, UnauthenticatedError } from './errors';

export type CampaignPassState = {
  readonly active: boolean;
  readonly expiresAt: string | null;
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
      throw translate('benefits.unlockShareKit', error);
    }
    const row = data[0];
    if (row === undefined) {
      throw new DataLayerError('benefits.unlockShareKit', new Error('empty unlock result'));
    }

    return { shareKitId: row.share_kit_id, alreadyUnlocked: row.already_unlocked };
  }
}
