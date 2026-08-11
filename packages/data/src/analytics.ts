import type { BrowserSupabaseClient } from './client';
import type { Json } from './database.types';

/**
 * Client-sendable interaction events only. Outcomes the server already
 * knows (publish, interest decisions, purchases, safety actions) are
 * recorded by database triggers (0033) and the RPC rejects them from
 * clients — see docs/ANALYTICS_PLAN.md.
 *
 * Viral-loop funnel: `reel_visit` (arrival on a campaign page, with the
 * `channel` property) and `s1_intent_created` (a private interest intent was
 * saved) are client interactions. The later stages are server-recorded
 * outcomes and must NOT be sent from clients: S2 delivery is the existing
 * `interest_submitted` trigger event on the `interests` INSERT, and S3 match
 * is `interest_accepted` / `intro_room_created`. The server-side track_event
 * allowlist accepts both names as of migration 0057 (reel_visit anonymously),
 * so they land in analytics_events once that migration is applied.
 */
export type AnalyticsEventName =
  | 'introducer_started'
  | 'voice_recorded'
  | 'draft_generated'
  | 'consent_invite_shared'
  | 'campaign_shared'
  | 'pitch_viewed_unique'
  | 'reel_visit'
  | 'interest_started'
  | 's1_intent_created'
  | 'creator_launch_paywall_viewed'
  | 'campaign_pass_paywall_viewed';

/**
 * Fire-and-forget funnel event. Analytics must never break product flows,
 * so every failure is swallowed. Never put raw content, contact details, or
 * identity material in properties (docs/ANALYTICS_PLAN.md).
 */
export function trackEvent(
  client: BrowserSupabaseClient | null,
  eventName: AnalyticsEventName,
  properties: Readonly<Record<string, Json>> = {},
): void {
  if (client === null) {
    return;
  }

  void client.rpc('track_event', { event_name: eventName, properties }).then(
    ({ error }) => {
      if (error !== null && typeof console !== 'undefined') {
        console.warn('analytics drop:', eventName);
      }
    },
    () => undefined,
  );
}
