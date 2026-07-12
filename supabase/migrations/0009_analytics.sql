-- Funnel analytics ingestion. Clients (including anonymous pitch viewers)
-- write through this RPC only: event names are whitelisted against
-- docs/ANALYTICS_PLAN.md, properties are size-capped, and the user id is
-- stamped server-side. Raw content, contact details, and identity material
-- must never be sent as properties (plan rule; reviewed at call sites).

CREATE FUNCTION public.track_event(event_name TEXT, properties JSONB DEFAULT '{}'::JSONB)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  IF event_name IS NULL OR event_name NOT IN (
    'introducer_started',
    'voice_recorded',
    'draft_generated',
    'consent_sent',
    'dater_verified',
    'draft_changes_requested',
    'pitch_approved',
    'campaign_published',
    'campaign_shared',
    'pitch_viewed_unique',
    'interest_started',
    'interest_verified',
    'interest_submitted',
    'interest_accepted',
    'intro_room_created',
    'first_message_sent',
    'creator_launch_paywall_viewed',
    'creator_launch_purchased',
    'creator_launch_credit_consumed',
    'campaign_pass_paywall_viewed',
    'campaign_pass_purchased',
    'report_submitted',
    'user_blocked',
    'campaign_paused',
    'campaign_expired'
  ) THEN
    RAISE EXCEPTION 'unknown analytics event: %', event_name;
  END IF;

  IF pg_column_size(properties) > 2048 THEN
    RAISE EXCEPTION 'analytics properties too large';
  END IF;

  INSERT INTO analytics_events (user_id, event_name, properties)
  VALUES (auth.uid(), event_name, coalesce(properties, '{}'::JSONB));
END;
$$;

REVOKE ALL ON FUNCTION public.track_event(TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.track_event(TEXT, JSONB) TO anon, authenticated;
