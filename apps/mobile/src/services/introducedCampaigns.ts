import { getSupabaseClient } from './supabaseClient';
import { getWebOrigin } from './webOrigin';

/**
 * The introducer-facing view of a campaign they created. `list_my_introduced_campaigns`
 * is server-authoritative (audit §3 GP-P0-1): the slug is only returned when the
 * campaign is published or paused, and comes back NULL for any other state so a
 * private/pre-approval link can never leak to the introducer.
 */
export type IntroducedCampaignStatus = 'published' | 'paused' | 'expired' | 'archived';

export type IntroducedCampaign = {
  readonly campaignId: string;
  readonly slug: string | null;
  readonly status: IntroducedCampaignStatus;
  readonly publishedAt: string | null;
  readonly endsAt: string | null;
  readonly daterDisplayName: string | null;
};

const INTRODUCED_STATUSES: readonly IntroducedCampaignStatus[] = [
  'published',
  'paused',
  'expired',
  'archived',
];

function asIntroducedStatus(value: unknown): IntroducedCampaignStatus {
  if (typeof value === 'string' && (INTRODUCED_STATUSES as readonly string[]).includes(value)) {
    return value as IntroducedCampaignStatus;
  }
  throw new Error(`Unexpected introduced campaign status: ${String(value)}`);
}

function asNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Maps a raw `list_my_introduced_campaigns` RPC row (snake_case, untyped until
 * migration 0039 ships its generated types) to the camelCase view model. Kept
 * pure and exported so the mapping is unit-tested without a live client.
 */
export function mapIntroducedCampaignRow(row: Record<string, unknown>): IntroducedCampaign {
  return {
    campaignId: String(row['campaign_id']),
    slug: asNullableString(row['campaign_slug']),
    status: asIntroducedStatus(row['campaign_status']),
    publishedAt: asNullableString(row['published_at']),
    endsAt: asNullableString(row['ends_at']),
    daterDisplayName: asNullableString(row['dater_display_name']),
  };
}

/**
 * The public pitch URL an introducer shares for free. `src`/`ref` carry the
 * introducer-share attribution the web referral contract preserves.
 */
export function buildIntroducerShareUrl(slug: string): string {
  const encoded = encodeURIComponent(slug);
  return `${getWebOrigin()}/p/${encoded}?src=introducer-share&ref=${encoded}`;
}

/**
 * Free sharing is only offered for a live (published) campaign that actually
 * carries a slug. A NULL slug is the server's link-leak guard and must block
 * the CTA even if some other field claims the campaign is live.
 */
export function canShareIntroducedCampaign(campaign: {
  readonly status: IntroducedCampaignStatus;
  readonly slug: string | null;
}): boolean {
  return campaign.status === 'published' && campaign.slug !== null;
}

export function formatIntroducedCampaignStatus(status: IntroducedCampaignStatus): string {
  switch (status) {
    case 'published':
      return 'Live';
    case 'paused':
      return 'Paused';
    case 'expired':
      return 'Ended';
    case 'archived':
      return 'Archived';
    default:
      return assertNever(status);
  }
}

export function getIntroducerLiveHeadline(daterDisplayName: string | null): string {
  const name = daterDisplayName?.trim();
  if (name !== undefined && name.length > 0) {
    return `${name}'s pitch is live`;
  }
  return 'Your friend’s pitch is live';
}

/**
 * The generated database types do not yet describe `list_my_introduced_campaigns`
 * (migration 0039 owns it), so it is called through this narrow untyped shim —
 * the same loose-RPC pattern the AI-consent service uses. A missing/failed RPC
 * fails closed (throws) rather than silently returning an empty share surface.
 */
type UntypedRpc = (
  name: string,
  args?: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message?: string } | null }>;

export class IntroducedCampaignsError extends Error {
  override readonly name = 'IntroducedCampaignsError';

  constructor() {
    super('Your introduced campaigns could not be loaded.');
  }
}

export async function listMyIntroducedCampaigns(): Promise<readonly IntroducedCampaign[]> {
  const client = getSupabaseClient();
  if (client === null) {
    throw new IntroducedCampaignsError();
  }
  // bind: supabase-js rpc() reads this.rest, so a bare extraction loses `this`.
  const rpc = client.rpc.bind(client) as unknown as UntypedRpc;
  const { data, error } = await rpc('list_my_introduced_campaigns');
  if (error !== null || !Array.isArray(data)) {
    throw new IntroducedCampaignsError();
  }
  return data.map((row) => mapIntroducedCampaignRow(row as Record<string, unknown>));
}

function assertNever(value: never): never {
  throw new Error(`Unexpected introduced campaign status: ${String(value)}`);
}
