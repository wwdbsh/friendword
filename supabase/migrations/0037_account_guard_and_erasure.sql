-- Third audit Slice 3 (H-1, H-2, H-5): account-state enforcement is now
-- exhaustive across SECURITY DEFINER RPCs, introducer deletion is
-- privacy-first (voice is erased, voiceless campaigns archive), resolved
-- purchase-review payloads are PII-scrubbed after a retention window, and
-- clients may delete their own profile-media objects.
--
-- H-1: b11 closed the direct-SELECT hole, but several authenticated
--      SECURITY DEFINER read/mutate RPCs never called
--      private.assert_active_account(caller), so a suspended or deleted
--      account could still read private data (campaign interests, intro
--      rooms, pass state) or mutate state through them. Every such RPC now
--      passes the guard. Exceptions (documented, intentionally ungated):
--        - get_ai_disclosure_revision   : anonymous pre-auth disclosure text.
--        - get_consent_preview          : anonymous pre-auth invite preview.
--        - request_account_deletion     : the account-state gate itself; it
--                                         must run for suspended accounts.
--      track_event keeps its anonymous public-page surface but now guards
--      the authenticated path (a suspended user cannot forge growth signal).
--      Service-role-only RPCs (reserve/reconcile provider ledger, webhook
--      ingestion) are out of scope: they never run as `authenticated` and
--      already gate on their target_user argument.

-- ---------------------------------------------------------------------------
-- H-1: guard the read/mutate RPCs that were missing the active-account check.
-- Each body below is the latest definition (list_campaign_interests: 0006,
-- leave_intro_room / list_my_intro_rooms: 0007, get_campaign_pass_state:
-- 0020, track_event: 0033) reproduced whole with the guard inserted.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.list_campaign_interests(target_campaign_id uuid)
 RETURNS TABLE(interest_id uuid, interest_status text, note text, submitted_at timestamp with time zone, sender_display_name text, sender_age integer, sender_bio text, sender_photos text[], sender_dating_intent text, sender_location text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  caller UUID := auth.uid();
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;
  PERFORM private.assert_active_account(caller);

  IF NOT EXISTS (
    SELECT 1 FROM campaigns
     WHERE id = target_campaign_id AND owner_user_id = caller
  ) THEN
    RAISE EXCEPTION 'campaign not found or not yours';
  END IF;

  RETURN QUERY
  SELECT i.id,
         i.status::TEXT,
         i.note,
         i.submitted_at,
         p.display_name,
         date_part('year', age(p.birth_date))::INTEGER,
         dp.bio,
         dp.photos,
         dp.dating_intent,
         dp.approximate_location
    FROM interests i
    JOIN profiles p ON p.user_id = i.sender_user_id
    LEFT JOIN dating_profiles dp ON dp.user_id = i.sender_user_id
   WHERE i.campaign_id = target_campaign_id
     AND i.status IN ('submitted', 'accepted', 'declined')
   ORDER BY i.submitted_at DESC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.leave_intro_room(target_room_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  caller UUID := auth.uid();
  room intro_rooms;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;
  PERFORM private.assert_active_account(caller);

  SELECT * INTO room
    FROM intro_rooms
   WHERE id = target_room_id
     AND caller IN (dater_user_id, interested_user_id)
     AND status = 'open'
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'room not found, not yours, or already closed';
  END IF;

  UPDATE intro_rooms SET status = 'left' WHERE id = room.id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_my_intro_rooms()
 RETURNS TABLE(room_id uuid, campaign_id uuid, campaign_slug text, other_user_id uuid, other_display_name text, created_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  caller UUID := auth.uid();
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;
  PERFORM private.assert_active_account(caller);

  RETURN QUERY
  SELECT r.id,
         r.campaign_id,
         c.slug,
         CASE WHEN r.dater_user_id = caller THEN r.interested_user_id ELSE r.dater_user_id END,
         p.display_name,
         r.created_at
    FROM intro_rooms r
    JOIN campaigns c ON c.id = r.campaign_id
    JOIN profiles p
      ON p.user_id = CASE
           WHEN r.dater_user_id = caller THEN r.interested_user_id
           ELSE r.dater_user_id
         END
   WHERE caller IN (r.dater_user_id, r.interested_user_id)
     AND r.status = 'open'
     AND NOT EXISTS (
       SELECT 1 FROM blocks b
        WHERE (b.blocker_user_id = r.dater_user_id AND b.blocked_user_id = r.interested_user_id)
           OR (b.blocker_user_id = r.interested_user_id AND b.blocked_user_id = r.dater_user_id)
     )
   ORDER BY r.created_at DESC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_campaign_pass_state(target_campaign_id uuid)
 RETURNS TABLE(pass_active boolean, pass_expires_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  caller UUID := auth.uid();
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;
  PERFORM private.assert_active_account(caller);

  IF NOT EXISTS (
    SELECT 1 FROM campaigns
     WHERE id = target_campaign_id AND owner_user_id = caller
  ) THEN
    RAISE EXCEPTION 'campaign not found or not yours';
  END IF;

  RETURN QUERY
  SELECT
    coalesce(
      bool_or(e.active AND (e.expires_at IS NULL OR e.expires_at > now())),
      false
    ),
    max(e.expires_at)
    FROM campaign_entitlements e
   WHERE e.campaign_id = target_campaign_id
     AND e.product_id = 'campaign_30d_1999';
END;
$function$;

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

-- ---------------------------------------------------------------------------
-- H-2: privacy-first introducer erasure.
--
-- The account-state mutation trigger blocks pitch_assets DELETE for
-- authenticated callers unless the account is active. Account erasure must
-- run even for suspended callers, so honor the existing transaction-local
-- `friendword.erasure` flag (already used by erase_pitch_draft) as a trusted
-- bypass of the active-account assertion. Only SECURITY DEFINER erasure paths
-- set the flag, so no client can reach it.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.enforce_active_account_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  caller UUID := auth.uid();
BEGIN
  IF caller IS NOT NULL
     AND current_setting('role', true) = 'authenticated'
     AND coalesce(current_setting('friendword.erasure', true), '') <> 'on' THEN
    IF TG_TABLE_SCHEMA = 'public'
       AND TG_TABLE_NAME = 'users'
       AND TG_OP = 'UPDATE' THEN
      IF NEW.id = caller
         AND NEW.account_status = 'deleted'
         AND OLD.account_status IN ('active', 'suspended') THEN
        RETURN NEW;
      END IF;
    END IF;
    PERFORM private.assert_active_account(caller);
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

-- Fold introducer erasure into the synchronous deletion request (0016 body,
-- reproduced whole). account_status flips to 'deleted' immediately, so the
-- introducer's voice — personal data — is removed at the same moment, and
-- any published/paused campaign that just lost that voice is archived (a
-- voiceless pitch is never kept public). Dater-owned data (their own photo
-- uploads, campaign history) is preserved; unpublished draft cleanup and
-- physical storage-object removal stay with the service-role deletion job.
CREATE OR REPLACE FUNCTION public.request_account_deletion()
RETURNS TABLE (deletion_request_id UUID, deletion_status TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  caller UUID := auth.uid();
  request deletion_requests;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(caller::TEXT, 160016)
  );

  SELECT * INTO request
    FROM deletion_requests
   WHERE user_id = caller
     AND scope = 'account'
   FOR UPDATE;

  IF request.id IS NULL THEN
    IF NOT EXISTS (
      SELECT 1
        FROM users
       WHERE id = caller
         AND account_status IN ('active', 'suspended')
    ) THEN
      RAISE EXCEPTION 'account is not eligible for deletion';
    END IF;

    INSERT INTO deletion_requests (user_id)
    VALUES (caller)
    RETURNING * INTO request;

    -- Trusted erasure context: allow the personal-data removals below to run
    -- regardless of the caller's (possibly suspended) account state.
    PERFORM set_config('friendword.erasure', 'on', true);

    -- Voice is the introducer's personal data — erase it now rather than
    -- letting the async job reassign it to the dater.
    DELETE FROM pitch_assets
     WHERE uploaded_by_user_id = caller
       AND asset_type = 'voice';

    -- Campaigns owned by other daters whose pitch this caller authored have
    -- just lost their voice; archive them (archived is an always-allowed exit
    -- transition, so the publish gates in 0030/0034 do not conflict).
    UPDATE campaigns c
       SET status = 'archived'
      FROM pitch_drafts d
     WHERE c.pitch_draft_id = d.id
       AND d.created_by_user_id = caller
       AND c.owner_user_id <> caller
       AND c.status IN ('published', 'paused');

    UPDATE users
       SET account_status = 'deleted'
     WHERE id = caller;

    -- Confine the bypass to the erasure statements above; later mutations in
    -- the same transaction must face the active-account guard again.
    PERFORM set_config('friendword.erasure', 'off', true);
  END IF;

  RETURN QUERY SELECT request.id, request.status;
END;
$$;

-- ---------------------------------------------------------------------------
-- H-2: PII scrub for resolved purchase-event reviews.
-- Resolved/discarded reviews older than the retention window keep their
-- operational summary but drop raw PII; open reviews are never touched
-- because ops still need the raw payload to resolve them.
-- ---------------------------------------------------------------------------

ALTER TABLE public.purchase_event_reviews
  ADD COLUMN payload_scrubbed_at TIMESTAMPTZ;

CREATE FUNCTION public.scrub_resolved_purchase_review_payloads(retention_days INTEGER DEFAULT 90)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  affected INTEGER;
BEGIN
  IF retention_days IS NULL OR retention_days < 0 THEN
    RAISE EXCEPTION 'retention_days must be a non-negative integer';
  END IF;

  UPDATE public.purchase_event_reviews
     SET payload = (
           payload - ARRAY[
             'app_user_id', 'original_app_user_id', 'app_user_ids', 'aliases',
             'subscriber_attributes', 'transaction_id',
             'original_transaction_id', 'store_transaction_id'
           ]
         ) || jsonb_build_object('scrubbed', true),
         payload_scrubbed_at = now()
   WHERE status IN ('resolved', 'discarded')
     AND resolved_at IS NOT NULL
     AND resolved_at < now() - make_interval(days => retention_days)
     AND payload_scrubbed_at IS NULL;

  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;

REVOKE ALL ON FUNCTION public.scrub_resolved_purchase_review_payloads(INTEGER)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.scrub_resolved_purchase_review_payloads(INTEGER)
  TO service_role;

-- ---------------------------------------------------------------------------
-- H-5: clients may DELETE their own profile-media objects (owner prefix only).
-- pitch-media stays server-managed (no client DELETE) for draft integrity.
-- ---------------------------------------------------------------------------

CREATE POLICY objects_delete_own_profile_media ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'profile-media'
    AND private.profile_media_owner(name) = auth.uid()
  );
