import type { BrowserSupabaseClient } from './client';
import type { Json } from './database.types';

/**
 * Client-sendable interaction events only. Outcomes the server already
 * knows (publish, interest decisions, purchases, safety actions) are
 * recorded by database triggers (0033) and the RPC rejects them from
 * clients — see docs/ANALYTICS_PLAN.md.
 */
export type AnalyticsEventName =
  | 'introducer_started'
  | 'voice_recorded'
  | 'draft_generated'
  | 'consent_invite_shared'
  | 'campaign_shared'
  | 'pitch_viewed_unique'
  | 'interest_started'
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
