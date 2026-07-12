/**
 * RevenueCat product/offering/entitlement identifiers.
 * Creator Launch is a consumable tracked in the server credit ledger,
 * NOT an entitlement (FRIENDWORD_HANDOFF.md, "수익화 설계").
 */
export const PRODUCTS = {
  creatorLaunch: 'creator_launch_credit_499',
  campaignPass30d: 'campaign_30d_1999',
} as const;

export const OFFERINGS = {
  starter: 'starter',
  creatorLaunch: 'creator_launch',
  campaignPass30d: 'campaign_30d',
} as const;

export const ENTITLEMENTS = {
  campaignPlus: 'campaign_plus',
} as const;
