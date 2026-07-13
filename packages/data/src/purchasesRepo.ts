import type { BrowserSupabaseClient } from './client';
import { DataLayerError, UnauthenticatedError } from './errors';

export type PurchaseIntentReceipt = {
  readonly id: string;
  readonly expiresAt: string;
};

export type PurchaseBenefitScope =
  | {
      readonly productId: 'creator_launch_credit_499';
      readonly pitchDraftId: string;
    }
  | {
      readonly productId: 'campaign_30d_1999';
      readonly campaignId: string;
    };

function translate(scope: string, error: { readonly message: string }): Error {
  if (error.message.includes('authentication required')) {
    return new UnauthenticatedError();
  }

  return new DataLayerError(scope, error);
}

/** Purchase-intent issuance and read-only webhook-benefit confirmation. */
export class PurchasesRepo {
  constructor(private readonly client: BrowserSupabaseClient) {}

  async issuePurchaseIntent(
    productId: PurchaseBenefitScope['productId'],
    scopeId: string,
  ): Promise<PurchaseIntentReceipt> {
    const { data, error } = await this.client.rpc('issue_purchase_intent', {
      product_id: productId,
      scope_id: scopeId,
    });
    if (error !== null) {
      throw translate('purchases.issueIntent', error);
    }

    const row = data[0];
    if (row === undefined) {
      throw new DataLayerError('purchases.issueIntent', new Error('empty purchase intent result'));
    }

    return { id: row.purchase_intent_id, expiresAt: row.expires_at };
  }

  async hasConfirmedBenefit(scope: PurchaseBenefitScope): Promise<boolean> {
    if (scope.productId === 'creator_launch_credit_499') {
      const { data, error } = await this.client
        .from('purchase_credit_ledger')
        .select('id')
        .eq('product_id', scope.productId)
        .eq('pitch_draft_id', scope.pitchDraftId)
        .eq('credit_state', 'available')
        .limit(1);
      if (error !== null) {
        throw translate('purchases.creatorBenefit', error);
      }
      return data.length > 0;
    }

    const { data, error } = await this.client
      .from('campaign_entitlements')
      .select('id')
      .eq('product_id', scope.productId)
      .eq('campaign_id', scope.campaignId)
      .eq('active', true)
      .limit(1);
    if (error !== null) {
      throw translate('purchases.campaignBenefit', error);
    }
    return data.length > 0;
  }
}
