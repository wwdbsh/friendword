-- 0057: the reel funnel's first two stages stop being dropped on the floor.
--
-- packages/data/src/analytics.ts:26,28 already declares `reel_visit` and
-- `s1_intent_created` as client-sendable names, and two call sites already
-- fire them:
--   apps/web/src/components/ReferralTracker.tsx:76  → reel_visit
--   apps/web/app/p/[campaignSlug]/interest/InterestFlow.tsx:261 → s1_intent_created
-- The server allowlist in public.track_event (0037:200-212, itself the 0033
-- body carried forward) never learned either name, so every one of those calls
-- raises 'unknown analytics event' and PostgREST answers 400. trackEvent is
-- fire-and-forget by design (analytics must never break a product flow), so
-- the failure is silent: the funnel entry and the S1 conversion are simply
-- absent from analytics_events. Both source files say so in comments —
-- ReferralTracker.tsx:65-66 and analytics.ts:16-17 both name this migration's
-- job as the missing half. This closes it.
--
-- WHAT CHANGES, precisely: two names are added to the accepted-name list, and
-- `reel_visit` joins the anonymous-caller list. Nothing else about the
-- function moves. The signature (text, jsonb) is unchanged, so the
-- packages/data rpcContract extractor still sees the same RPC.
--
-- THE 0037 BODY IS REPRODUCED WHOLE, per this repo's rule for CREATE OR
-- REPLACE: the server-recorded outcome guard (second audit H-4), the
-- suspended/deleted-account assertion (third audit H-1), the property-key
-- allowlist, the campaign/draft existence checks, the slug shape check, the
-- size cap and the malformed-id EXCEPTION handler all survive verbatim. A
-- partial copy here would silently repeal one of them.
--
-- WHY reel_visit IS ANONYMOUS AND s1_intent_created IS NOT.
--
-- reel_visit is the funnel ENTRY: a visitor arriving on a public campaign page
-- from a shared reel, almost always signed out. Counting only the ones who
-- later authenticate would measure the bottom of the funnel and call it the
-- top — the metric exists precisely to see the visits that never convert. It
-- therefore joins `pitch_viewed_unique` and `interest_started` on the
-- anonymous-caller list. That surface is already anonymous-writable, so this
-- adds a third name to an existing public write path, not a new one: the same
-- property allowlist, the same existence checks, the same 2048-byte cap, and
-- the same server-stamped NULL user_id apply. ReferralTracker dedupes per
-- campaign per tab in sessionStorage, which is a client-side courtesy and not
-- a server guarantee — an anonymous caller can still repeat the event, exactly
-- as it can today for pitch_viewed_unique. The row carries no identity: only
-- campaign_slug and channel, both already allowlisted keys.
--
-- s1_intent_created is deliberately NOT anonymous. It is fired at
-- InterestFlow.tsx:261 only after ensureUserRow() and a successful
-- InterestIntentRepo.saveIntent(), both of which require a session — an
-- anonymous caller literally cannot reach the state the event claims. Leaving
-- it authenticated-only means the account guard below (private
-- .assert_active_account) applies to it, so a suspended or deleted account
-- cannot manufacture S1 conversions. Adding it to the anonymous list would
-- make an unauthenticated forgery of a private-intent record possible while
-- gaining nothing real.
--
-- NEITHER EVENT IS A SERVER-RECORDED OUTCOME, so neither belongs in the
-- reject list above it. The later funnel stages do and already sit there: S2
-- delivery is the `interest_submitted` trigger on the interests INSERT and S3
-- is `interest_accepted`/`intro_room_created` (0033). This migration does not
-- touch those, and clients still cannot send them.
--
-- Regression coverage: supabase/tests/31_reel_analytics_allowlist.sql.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.track_event(event_name text, properties jsonb DEFAULT '{}'::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  caller UUID := auth.uid();
  property_key TEXT;
  property_text TEXT;
BEGIN
  -- Outcomes the server already knows are trigger-recorded; a client
  -- claiming one is forging growth evidence (second audit H-4).
  IF event_name IS NULL THEN
    RAISE EXCEPTION 'unknown analytics event: %', event_name;
  END IF;
  IF event_name IN (
    'consent_sent', 'dater_verified', 'draft_changes_requested',
    'pitch_approved', 'campaign_published', 'interest_verified',
    'interest_submitted', 'interest_accepted', 'intro_room_created',
    'first_message_sent', 'creator_launch_purchased',
    'creator_launch_credit_consumed', 'campaign_pass_purchased',
    'report_submitted', 'user_blocked', 'campaign_paused',
    'campaign_expired'
  ) THEN
    RAISE EXCEPTION 'analytics event % is recorded by the server', event_name;
  END IF;
  IF event_name NOT IN (
    'introducer_started',
    'voice_recorded',
    'draft_generated',
    'consent_invite_shared',
    'campaign_shared',
    'pitch_viewed_unique',
    'reel_visit',
    'interest_started',
    's1_intent_created',
    'creator_launch_paywall_viewed',
    'campaign_pass_paywall_viewed'
  ) THEN
    RAISE EXCEPTION 'unknown analytics event: %', event_name;
  END IF;

  -- Anonymous visitors may only describe public-page interactions.
  IF caller IS NULL
     AND event_name NOT IN (
       'pitch_viewed_unique', 'reel_visit', 'interest_started'
     ) THEN
    RAISE EXCEPTION 'analytics event % requires authentication', event_name;
  END IF;

  -- Third audit H-1: suspended/deleted accounts cannot record analytics.
  -- Anonymous callers (caller IS NULL) keep the public-page surface above.
  IF caller IS NOT NULL THEN
    PERFORM private.assert_active_account(caller);
  END IF;

  IF properties IS NOT NULL THEN
    IF jsonb_typeof(properties) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'analytics properties must be an object';
    END IF;
    IF pg_column_size(properties) > 2048 THEN
      RAISE EXCEPTION 'analytics properties too large';
    END IF;
    FOR property_key IN SELECT jsonb_object_keys(properties) LOOP
      IF property_key NOT IN (
        'campaign_id', 'campaign_slug', 'pitch_draft_id',
        'source', 'platform', 'channel', 'duration_ms', 'product_id'
      ) THEN
        RAISE EXCEPTION 'analytics property % is not allowed', property_key;
      END IF;
    END LOOP;

    IF properties ? 'campaign_id'
       AND jsonb_typeof(properties -> 'campaign_id') <> 'null' THEN
      IF NOT EXISTS (
        SELECT 1 FROM campaigns
         WHERE id = (properties ->> 'campaign_id')::UUID
      ) THEN
        RAISE EXCEPTION 'analytics campaign_id does not exist';
      END IF;
    END IF;
    IF properties ? 'campaign_slug'
       AND jsonb_typeof(properties -> 'campaign_slug') <> 'null' THEN
      IF (properties ->> 'campaign_slug') <> 'demo-blair'
         AND NOT EXISTS (
           SELECT 1 FROM campaigns WHERE slug = properties ->> 'campaign_slug'
         ) THEN
        RAISE EXCEPTION 'analytics campaign_slug does not exist';
      END IF;
    END IF;
    IF properties ? 'pitch_draft_id'
       AND jsonb_typeof(properties -> 'pitch_draft_id') <> 'null' THEN
      IF NOT EXISTS (
        SELECT 1 FROM pitch_drafts
         WHERE id = (properties ->> 'pitch_draft_id')::UUID
      ) THEN
        RAISE EXCEPTION 'analytics pitch_draft_id does not exist';
      END IF;
    END IF;
    FOREACH property_key IN ARRAY ARRAY['source', 'platform', 'channel'] LOOP
      IF properties ? property_key
         AND jsonb_typeof(properties -> property_key) <> 'null' THEN
        property_text := properties ->> property_key;
        IF property_text !~ '^[A-Za-z0-9_-]{1,64}$' THEN
          RAISE EXCEPTION 'analytics % must be a short slug', property_key;
        END IF;
      END IF;
    END LOOP;
  END IF;

  INSERT INTO analytics_events (user_id, event_name, properties)
  VALUES (caller, event_name, coalesce(properties, '{}'::JSONB));
EXCEPTION
  WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'analytics properties contain a malformed id';
END;
$function$;

-- Privileges are unchanged from 0009/0037 (CREATE OR REPLACE preserves them);
-- restated so this file is self-describing about who may call the RPC.
REVOKE ALL ON FUNCTION public.track_event(TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.track_event(TEXT, JSONB) TO anon, authenticated;
