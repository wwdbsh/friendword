import { z } from 'zod';

import type { Session } from '@supabase/supabase-js';

import type { BrowserSupabaseClient } from './client';
import { DataLayerError, UnauthenticatedError } from './errors';

const uuidSchema = z.string().uuid();

/**
 * Staged interest, stage S1 (migration 0053): a private "I want to meet them"
 * record that is NEVER delivered to the Dater. Delivery only happens at S2,
 * when `promote_interest_intent` delegates to `submit_interest` — a normal
 * INSERT into `interests` behind every existing gate (public beta, moderation
 * evidence, audience policy, rate limits). Intents live in their own table
 * precisely so that "every row in `interests` is a delivered, gate-checked
 * interest" stays true by construction — no status column, no filtered reads.
 *
 * These names are the pinned 0053 server contract; rpcContract.test.ts checks
 * them (and their argument names) against the migration SQL itself, so a
 * rename on either side fails the suite instead of failing at runtime with
 * PGRST202. They are not in the generated database types yet, so calls go
 * through narrow untyped envelopes.
 */
export const INTEREST_INTENT_RPCS = [
  'create_interest_intent',
  'get_my_interest_intent',
  'promote_interest_intent',
] as const;

/**
 * Dater/Introducer-facing read RPCs that must never see intent rows. The repo
 * test pins that this list and INTEREST_INTENT_RPCS are disjoint and that this
 * repo never calls any of them (nor any table, `interests` included: every DB
 * touch in this repo is one of the intent RPCs above).
 */
export const DATER_FACING_INTEREST_READS = [
  'list_campaign_interests',
  'list_my_interests',
] as const;

export type InterestIntent = {
  readonly intentId: string;
  readonly createdAt: string | null;
};

export type PromotedInterest = {
  readonly interestId: string;
  readonly interestStatus: string;
};

// 0053: both create_interest_intent and get_my_interest_intent return
// TABLE (intent_id UUID, created_at TIMESTAMPTZ).
const intentRowsSchema = z.array(
  z.object({
    intent_id: z.string().uuid(),
    created_at: z.string().nullish(),
  }),
);

const promoteRowsSchema = z.array(
  z.object({ interest_id: z.string().uuid(), interest_status: z.string() }),
);

export class InterestIntentRepo {
  constructor(private readonly client: BrowserSupabaseClient) {}

  /**
   * S1: saves a private interest intent for one campaign. Takes NO free text
   * by design — unmoderated words must not exist at this stage; a note is only
   * accepted at promotion, where it passes text moderation. The RPC is
   * idempotent (re-saving returns the stored row), so re-taps are success.
   */
  async saveIntent(campaignId: string): Promise<InterestIntent> {
    await this.getRequiredSession();
    const { data, error } = await this.callIntentRpc('create_interest_intent', {
      target_campaign_id: uuidSchema.parse(campaignId),
    });
    if (error !== null) {
      throw new DataLayerError('interestIntent.save', error);
    }
    const row = this.parseIntentRow(data, 'interestIntent.save');
    if (row === null) {
      throw new DataLayerError('interestIntent.save', new Error('RPC returned no intent'));
    }
    return row;
  }

  /**
   * The caller's own intent for one campaign, or null. Reads through the 0053
   * `get_my_interest_intent` RPC rather than a raw table SELECT: the function
   * scopes to auth.uid() server-side (the same self-only visibility the RLS
   * policy grants) and keeps this repo's entire DB surface inside the pinned
   * RPC contract.
   */
  async getMyIntent(campaignId: string): Promise<InterestIntent | null> {
    await this.getRequiredSession();
    const { data, error } = await this.callIntentRpc('get_my_interest_intent', {
      target_campaign_id: uuidSchema.parse(campaignId),
    });
    if (error !== null) {
      throw new DataLayerError('interestIntent.getMine', error);
    }
    return this.parseIntentRow(data, 'interestIntent.getMine');
  }

  /**
   * S2: promotes the saved intent into a real `interests` row. The server
   * delegates to `submit_interest`, so every delivery gate fires (complete
   * profile with 2+ photos, moderation evidence, the public-beta gate,
   * audience policy) and the intent is consumed only when delivery succeeds.
   * This method reports the outcome honestly and adds no client-side
   * shortcuts.
   */
  async promoteIntent(campaignId: string, note: string | null): Promise<PromotedInterest> {
    await this.getRequiredSession();
    const { data, error } = await this.callIntentRpc('promote_interest_intent', {
      target_campaign_id: uuidSchema.parse(campaignId),
      interest_note: note,
    });
    if (error !== null) {
      throw new DataLayerError('interestIntent.promote', error);
    }
    const parsed = promoteRowsSchema.safeParse(data);
    if (!parsed.success) {
      throw new DataLayerError('interestIntent.promote', parsed.error);
    }
    const row = parsed.data.at(0);
    if (row === undefined) {
      throw new DataLayerError('interestIntent.promote', new Error('RPC returned no interest'));
    }
    return { interestId: row.interest_id, interestStatus: row.interest_status };
  }

  private parseIntentRow(data: unknown, scope: string): InterestIntent | null {
    const parsed = intentRowsSchema.safeParse(data);
    if (!parsed.success) {
      throw new DataLayerError(scope, parsed.error);
    }
    const row = parsed.data.at(0);
    return row === undefined
      ? null
      : { intentId: row.intent_id, createdAt: row.created_at ?? null };
  }

  private async callIntentRpc(
    functionName: (typeof INTEREST_INTENT_RPCS)[number],
    params: Record<string, unknown>,
  ): Promise<{ readonly data: unknown; readonly error: unknown | null }> {
    const rpc: unknown = Reflect.get(this.client, 'rpc');
    if (typeof rpc !== 'function') {
      throw new DataLayerError(
        'interestIntent.rpc',
        new Error('Supabase RPC client is unavailable'),
      );
    }
    const result: unknown = await Reflect.apply(rpc, this.client, [functionName, params]);
    return unwrapEnvelope(result, 'interestIntent.rpc');
  }

  private async getRequiredSession(): Promise<Session> {
    const { data, error } = await this.client.auth.getSession();
    if (error !== null) {
      throw new DataLayerError('interestIntent.getSession', error);
    }
    if (data.session === null) {
      throw new UnauthenticatedError();
    }
    return data.session;
  }
}

function unwrapEnvelope(
  result: unknown,
  scope: string,
): { readonly data: unknown; readonly error: unknown | null } {
  if (
    typeof result !== 'object' ||
    result === null ||
    !('data' in result) ||
    !('error' in result)
  ) {
    throw new DataLayerError(scope, new Error('Supabase returned an invalid result'));
  }
  return { data: Reflect.get(result, 'data'), error: Reflect.get(result, 'error') };
}
