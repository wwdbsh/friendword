-- Second audit Slice 9 (H-4, H-5, CP-7): growth evidence the server can
-- vouch for, an authoritative expiration state machine, and the sender's
-- interest context.
--
-- - Outcome analytics (publish, interest, rooms, purchases, safety) are
--   recorded by AFTER triggers on the tables where the outcome actually
--   happens, so no client can forge them and no RPC redefinition loses
--   them. track_event shrinks to client interaction events with validated
--   properties.
-- - expire_due_campaigns() (service role only) moves due campaigns to
--   'expired' and set_campaign_status can no longer resume past ends_at.
-- - list_my_interests() gives the mobile "My interests" context a
--   server-recoverable read model.

-- ── Server-recorded outcome events ────────────────────────────────────

CREATE FUNCTION private.record_growth_event(
  actor_user_id UUID,
  growth_event_name TEXT,
  growth_properties JSONB
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  INSERT INTO public.analytics_events (user_id, event_name, properties)
  VALUES (
    actor_user_id,
    growth_event_name,
    coalesce(growth_properties, '{}'::JSONB) || '{"recorded_by": "server"}'::JSONB
  );
$$;

REVOKE ALL ON FUNCTION private.record_growth_event(UUID, TEXT, JSONB) FROM PUBLIC;

CREATE FUNCTION private.campaigns_growth_events()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  old_status TEXT := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.status END;
BEGIN
  IF NEW.status = 'published'
     AND (old_status IS NULL OR old_status = 'draft') THEN
    PERFORM private.record_growth_event(
      NEW.owner_user_id,
      'campaign_published',
      jsonb_build_object('campaign_id', NEW.id, 'campaign_slug', NEW.slug)
    );
  END IF;
  IF NEW.status = 'paused' AND old_status IS DISTINCT FROM 'paused' THEN
    PERFORM private.record_growth_event(
      NEW.owner_user_id,
      'campaign_paused',
      jsonb_build_object('campaign_id', NEW.id)
    );
  END IF;
  IF NEW.status = 'expired' AND old_status IS DISTINCT FROM 'expired' THEN
    PERFORM private.record_growth_event(
      NEW.owner_user_id,
      'campaign_expired',
      jsonb_build_object('campaign_id', NEW.id)
    );
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.campaigns_growth_events() FROM PUBLIC;

CREATE TRIGGER campaigns_growth_events
AFTER INSERT OR UPDATE OF status ON public.campaigns
FOR EACH ROW EXECUTE FUNCTION private.campaigns_growth_events();

CREATE FUNCTION private.consent_requests_growth_events()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  old_status TEXT := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.status END;
  introducer UUID;
BEGIN
  IF NEW.status = 'pending' AND old_status IS DISTINCT FROM 'pending' THEN
    SELECT created_by_user_id INTO introducer
      FROM public.pitch_drafts WHERE id = NEW.pitch_draft_id;
    PERFORM private.record_growth_event(
      introducer,
      'consent_sent',
      jsonb_build_object('pitch_draft_id', NEW.pitch_draft_id)
    );
  END IF;
  IF NEW.status = 'approved' AND old_status IS DISTINCT FROM 'approved' THEN
    PERFORM private.record_growth_event(
      NEW.subject_user_id,
      'pitch_approved',
      jsonb_build_object('pitch_draft_id', NEW.pitch_draft_id)
    );
  END IF;
  IF NEW.status = 'changes_requested'
     AND old_status IS DISTINCT FROM 'changes_requested' THEN
    PERFORM private.record_growth_event(
      NEW.subject_user_id,
      'draft_changes_requested',
      jsonb_build_object('pitch_draft_id', NEW.pitch_draft_id)
    );
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.consent_requests_growth_events() FROM PUBLIC;

CREATE TRIGGER consent_requests_growth_events
AFTER INSERT OR UPDATE OF status ON public.consent_requests
FOR EACH ROW EXECUTE FUNCTION private.consent_requests_growth_events();

CREATE FUNCTION private.interests_growth_events()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  old_status TEXT := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.status::TEXT END;
  campaign_owner UUID;
BEGIN
  IF NEW.status = 'submitted' AND old_status IS DISTINCT FROM 'submitted' THEN
    PERFORM private.record_growth_event(
      NEW.sender_user_id,
      'interest_submitted',
      jsonb_build_object('campaign_id', NEW.campaign_id, 'interest_id', NEW.id)
    );
  END IF;
  IF NEW.status = 'accepted' AND old_status IS DISTINCT FROM 'accepted' THEN
    SELECT owner_user_id INTO campaign_owner
      FROM public.campaigns WHERE id = NEW.campaign_id;
    PERFORM private.record_growth_event(
      campaign_owner,
      'interest_accepted',
      jsonb_build_object('campaign_id', NEW.campaign_id, 'interest_id', NEW.id)
    );
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.interests_growth_events() FROM PUBLIC;

CREATE TRIGGER interests_growth_events
AFTER INSERT OR UPDATE OF status ON public.interests
FOR EACH ROW EXECUTE FUNCTION private.interests_growth_events();

CREATE FUNCTION private.intro_rooms_growth_events()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM private.record_growth_event(
    NEW.dater_user_id,
    'intro_room_created',
    jsonb_build_object('intro_room_id', NEW.id, 'campaign_id', NEW.campaign_id)
  );
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.intro_rooms_growth_events() FROM PUBLIC;

CREATE TRIGGER intro_rooms_growth_events
AFTER INSERT ON public.intro_rooms
FOR EACH ROW EXECUTE FUNCTION private.intro_rooms_growth_events();

CREATE FUNCTION private.messages_growth_events()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.messages
     WHERE intro_room_id = NEW.intro_room_id AND id <> NEW.id
  ) THEN
    PERFORM private.record_growth_event(
      NEW.sender_user_id,
      'first_message_sent',
      jsonb_build_object('intro_room_id', NEW.intro_room_id)
    );
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.messages_growth_events() FROM PUBLIC;

CREATE TRIGGER messages_growth_events
AFTER INSERT ON public.messages
FOR EACH ROW EXECUTE FUNCTION private.messages_growth_events();

CREATE FUNCTION private.reports_growth_events()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM private.record_growth_event(
    NEW.reporter_user_id,
    'report_submitted',
    jsonb_build_object('campaign_id', NEW.campaign_id)
  );
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.reports_growth_events() FROM PUBLIC;

CREATE TRIGGER reports_growth_events
AFTER INSERT ON public.reports
FOR EACH ROW EXECUTE FUNCTION private.reports_growth_events();

CREATE FUNCTION private.blocks_growth_events()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM private.record_growth_event(NEW.blocker_user_id, 'user_blocked', '{}'::JSONB);
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.blocks_growth_events() FROM PUBLIC;

CREATE TRIGGER blocks_growth_events
AFTER INSERT ON public.blocks
FOR EACH ROW EXECUTE FUNCTION private.blocks_growth_events();

CREATE FUNCTION private.credit_ledger_growth_events()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.credit_state = 'available' THEN
    PERFORM private.record_growth_event(
      NEW.user_id,
      'creator_launch_purchased',
      jsonb_build_object('pitch_draft_id', NEW.pitch_draft_id, 'product_id', NEW.product_id)
    );
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.credit_ledger_growth_events() FROM PUBLIC;

CREATE TRIGGER credit_ledger_growth_events
AFTER INSERT ON public.purchase_credit_ledger
FOR EACH ROW EXECUTE FUNCTION private.credit_ledger_growth_events();

CREATE FUNCTION private.entitlements_growth_events()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  campaign_owner UUID;
BEGIN
  IF NEW.active
     AND (
       TG_OP = 'INSERT'
       OR NOT OLD.active
       OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
     ) THEN
    SELECT owner_user_id INTO campaign_owner
      FROM public.campaigns WHERE id = NEW.campaign_id;
    PERFORM private.record_growth_event(
      campaign_owner,
      'campaign_pass_purchased',
      jsonb_build_object('campaign_id', NEW.campaign_id, 'product_id', NEW.product_id)
    );
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.entitlements_growth_events() FROM PUBLIC;

CREATE TRIGGER entitlements_growth_events
AFTER INSERT OR UPDATE ON public.campaign_entitlements
FOR EACH ROW EXECUTE FUNCTION private.entitlements_growth_events();

-- ── Client ingestion: interaction events only, validated properties ───

CREATE OR REPLACE FUNCTION public.track_event(
  event_name TEXT,
  properties JSONB DEFAULT '{}'::JSONB
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
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
    'interest_started',
    'creator_launch_paywall_viewed',
    'campaign_pass_paywall_viewed'
  ) THEN
    RAISE EXCEPTION 'unknown analytics event: %', event_name;
  END IF;

  -- Anonymous visitors may only describe public-page interactions.
  IF caller IS NULL
     AND event_name NOT IN ('pitch_viewed_unique', 'interest_started') THEN
    RAISE EXCEPTION 'analytics event % requires authentication', event_name;
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
$$;

-- ── Expiration state machine (H-5, b10) ───────────────────────────────

CREATE FUNCTION public.expire_due_campaigns()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  expired_count INTEGER;
BEGIN
  -- The campaign_expired analytics events come from the campaigns trigger.
  UPDATE campaigns
     SET status = 'expired'
   WHERE status IN ('published', 'paused')
     AND ends_at IS NOT NULL
     AND ends_at <= now();
  GET DIAGNOSTICS expired_count = ROW_COUNT;
  RETURN expired_count;
END;
$$;

REVOKE ALL ON FUNCTION public.expire_due_campaigns() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.expire_due_campaigns() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_due_campaigns() TO service_role;

-- Same contract as 0012 plus: a campaign whose window ended can never be
-- resumed, and an expired campaign can still be archived by its owner.
CREATE OR REPLACE FUNCTION public.set_campaign_status(
  target_campaign_id UUID,
  next_status TEXT
)
RETURNS TABLE (campaign_status TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  caller UUID := auth.uid();
  campaign campaigns;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;
  PERFORM private.assert_active_account(caller);

  SELECT * INTO campaign FROM campaigns
   WHERE id = target_campaign_id AND owner_user_id = caller FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'campaign not found or not yours';
  END IF;
  IF NOT (
    (campaign.status = 'published' AND next_status IN ('paused', 'archived'))
    OR (campaign.status = 'paused' AND next_status IN ('published', 'archived'))
    OR (campaign.status = 'expired' AND next_status = 'archived')
  ) THEN
    RAISE EXCEPTION 'cannot move campaign from % to %', campaign.status, next_status;
  END IF;
  IF next_status = 'published'
     AND campaign.ends_at IS NOT NULL
     AND campaign.ends_at <= now() THEN
    RAISE EXCEPTION 'campaign window has ended; it cannot be resumed';
  END IF;

  UPDATE campaigns SET status = next_status WHERE id = campaign.id;
  RETURN QUERY SELECT next_status;
END;
$$;

REVOKE ALL ON FUNCTION public.set_campaign_status(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_campaign_status(UUID, TEXT) TO authenticated;

-- ── CP-7: the sender's interest context, server-recoverable ───────────

CREATE FUNCTION public.list_my_interests()
RETURNS TABLE (
  interest_id UUID,
  interest_status TEXT,
  submitted_at TIMESTAMPTZ,
  decided_at TIMESTAMPTZ,
  campaign_id UUID,
  campaign_slug TEXT,
  campaign_status TEXT,
  dater_display_name TEXT,
  campaign_headline TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  caller UUID := auth.uid();
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;
  PERFORM private.assert_active_account(caller);

  RETURN QUERY
  SELECT
    interest.id,
    interest.status::TEXT,
    interest.submitted_at,
    interest.decided_at,
    campaign.id,
    campaign.slug,
    campaign.status,
    coalesce(dater_profile.display_name, 'A Friendword member'),
    draft.headline
  FROM interests interest
  JOIN campaigns campaign ON campaign.id = interest.campaign_id
  JOIN pitch_drafts draft ON draft.id = campaign.pitch_draft_id
  LEFT JOIN profiles dater_profile ON dater_profile.user_id = campaign.owner_user_id
  WHERE interest.sender_user_id = caller
    -- Blocked interests never resurface in the sender's own list.
    AND interest.status <> 'blocked'
  ORDER BY coalesce(interest.submitted_at, interest.created_at) DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.list_my_interests() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_my_interests() TO authenticated;
