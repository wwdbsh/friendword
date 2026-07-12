import type { BrowserSupabaseClient } from './client';
import type { Json } from './database.types';

export type AnalyticsEventName =
  | 'introducer_started'
  | 'voice_recorded'
  | 'draft_generated'
  | 'consent_sent'
  | 'dater_verified'
  | 'draft_changes_requested'
  | 'pitch_approved'
  | 'campaign_published'
  | 'campaign_shared'
  | 'pitch_viewed_unique'
  | 'interest_started'
  | 'interest_verified'
  | 'interest_submitted'
  | 'interest_accepted'
  | 'intro_room_created'
  | 'first_message_sent'
  | 'creator_launch_paywall_viewed'
  | 'creator_launch_purchased'
  | 'creator_launch_credit_consumed'
  | 'campaign_pass_paywall_viewed'
  | 'campaign_pass_purchased'
  | 'report_submitted'
  | 'user_blocked'
  | 'campaign_paused'
  | 'campaign_expired';

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
