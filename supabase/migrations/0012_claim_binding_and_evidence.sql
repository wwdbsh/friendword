-- Identity rollout boundary: bind email invitations now, fail closed for
-- phone invitations until a verified phone identity exists, and keep
-- provider-backed evidence behind an ops-controlled enforcement switch.

CREATE TABLE public.app_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.app_config (key, value)
VALUES ('identity_enforcement', 'off');

ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_config FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_config TO service_role;

ALTER TABLE public.consent_requests
  ADD COLUMN invite_contact_channel TEXT
    CHECK (invite_contact_channel IN ('email', 'phone')),
  ADD COLUMN invite_contact_hash TEXT,
  ADD COLUMN invite_friend_name TEXT;

CREATE FUNCTION private.identity_enforcement()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT coalesce(
    (SELECT value = 'on' FROM public.app_config WHERE key = 'identity_enforcement'),
    false
  );
$$;

CREATE FUNCTION private.assert_active_account(target_user_id UUID)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.users
     WHERE id = target_user_id AND account_status = 'active'
  ) THEN
    RAISE EXCEPTION 'account must be active';
  END IF;
END;
$$;

CREATE FUNCTION private.assert_identity_evidence(target_user_id UUID)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.users
     WHERE id = target_user_id AND phone_verified_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'phone verification required';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.verification_checks
     WHERE user_id = target_user_id
       AND status = 'passed'
       AND verified_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'identity verification required';
  END IF;
END;
$$;

CREATE FUNCTION private.canonicalize_contact(channel TEXT, raw_contact TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  canonical TEXT;
BEGIN
  IF channel = 'email' THEN
    canonical := lower(btrim(raw_contact));
  ELSIF channel = 'phone' THEN
    -- Phone canonicalization intentionally preserves country/leading-zero
    -- semantics and only removes formatting until a provider is selected.
    canonical := regexp_replace(raw_contact, '[^0-9]', '', 'g');
  ELSE
    RAISE EXCEPTION 'invite channel must be email or phone';
  END IF;

  IF canonical IS NULL OR canonical = '' THEN
    RAISE EXCEPTION 'invite contact is required';
  END IF;

  RETURN canonical;
END;
$$;

CREATE FUNCTION private.profile_photo_object_name(storage_path TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN storage_path LIKE 'profile-media/%'
      THEN substr(storage_path, length('profile-media/') + 1)
    ELSE storage_path
  END;
$$;

REVOKE ALL ON FUNCTION private.identity_enforcement() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.assert_active_account(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.assert_identity_evidence(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.canonicalize_contact(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.profile_photo_object_name(TEXT) FROM PUBLIC;

DROP FUNCTION public.submit_pitch_for_consent(UUID);
CREATE FUNCTION public.submit_pitch_for_consent(
  draft_id UUID,
  invite_channel TEXT DEFAULT NULL,
  invite_contact TEXT DEFAULT NULL,
  invite_friend_name TEXT DEFAULT NULL
)
RETURNS TABLE (consent_request_id UUID, consent_token TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  caller UUID := auth.uid();
  raw_token TEXT;
  new_request_id UUID;
  contact_hash TEXT;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;
  PERFORM private.assert_active_account(caller);

  IF (invite_channel IS NULL) <> (invite_contact IS NULL) THEN
    RAISE EXCEPTION 'invite channel and contact must be provided together';
  END IF;
  IF invite_channel IS NOT NULL THEN
    contact_hash := encode(
      digest(private.canonicalize_contact(invite_channel, invite_contact), 'sha256'),
      'hex'
    );
  END IF;

  PERFORM 1
     FROM pitch_drafts
    WHERE id = draft_id
      AND created_by_user_id = caller
      AND status = 'draft'
      FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'draft not found, not owned by caller, or not submittable';
  END IF;

  raw_token := replace(replace(encode(gen_random_bytes(24), 'base64'), '+', '-'), '/', '_');
  raw_token := replace(raw_token, '=', '');

  UPDATE pitch_drafts SET status = 'consent_pending' WHERE id = draft_id;

  INSERT INTO consent_requests (
    pitch_draft_id,
    token_hash,
    status,
    invite_contact_channel,
    invite_contact_hash,
    invite_friend_name
  )
  VALUES (
    draft_id,
    encode(digest(raw_token, 'sha256'), 'hex'),
    'pending',
    invite_channel,
    contact_hash,
    nullif(btrim(invite_friend_name), '')
  )
  RETURNING id INTO new_request_id;

  RETURN QUERY SELECT new_request_id, raw_token;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_pitch_for_consent(UUID, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_pitch_for_consent(UUID, TEXT, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.claim_consent_request(raw_token TEXT)
RETURNS TABLE (pitch_draft_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  caller UUID := auth.uid();
  request consent_requests;
  draft pitch_drafts;
  caller_email TEXT;
  caller_contact_hash TEXT;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;
  PERFORM private.assert_active_account(caller);

  request := private.consent_request_by_token(raw_token);
  IF request.id IS NULL OR request.status NOT IN ('pending', 'claimed') THEN
    RAISE EXCEPTION 'consent request not found or no longer claimable';
  END IF;

  IF request.invite_contact_hash IS NOT NULL
     AND request.invite_contact_channel IS NOT NULL THEN
    IF request.invite_contact_channel = 'email' THEN
      SELECT email INTO caller_email FROM auth.users WHERE id = caller;
      IF caller_email IS NULL THEN
        RAISE EXCEPTION 'consent invite was sent to a different contact';
      END IF;
      caller_contact_hash := encode(
        digest(private.canonicalize_contact('email', caller_email), 'sha256'),
        'hex'
      );
      IF caller_contact_hash IS DISTINCT FROM request.invite_contact_hash THEN
        RAISE EXCEPTION 'consent invite was sent to a different contact';
      END IF;
    ELSIF request.invite_contact_channel = 'phone' THEN
      RAISE EXCEPTION 'phone invite verification is not available';
    END IF;
  END IF;

  SELECT * INTO draft FROM pitch_drafts WHERE id = request.pitch_draft_id FOR UPDATE;
  IF draft.created_by_user_id = caller THEN
    RAISE EXCEPTION 'introducer cannot claim their own consent request';
  END IF;
  IF draft.subject_user_id IS NOT NULL AND draft.subject_user_id <> caller THEN
    RAISE EXCEPTION 'consent request is linked to another account';
  END IF;

  UPDATE pitch_drafts SET subject_user_id = caller WHERE id = draft.id;
  UPDATE consent_requests
     SET subject_user_id = caller, status = 'claimed'
   WHERE id = request.id;

  RETURN QUERY SELECT draft.id;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_consent_request(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_consent_request(TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.approve_and_publish_pitch(
  draft_id UUID,
  campaign_days INTEGER DEFAULT 30
)
RETURNS TABLE (campaign_id UUID, campaign_slug TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  caller UUID := auth.uid();
  draft pitch_drafts;
  new_campaign_id UUID;
  new_slug TEXT;
  dater_name TEXT;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;
  PERFORM private.assert_active_account(caller);

  IF campaign_days NOT IN (7, 30, 90) THEN
    RAISE EXCEPTION 'campaign_days must be 7, 30, or 90';
  END IF;

  SELECT * INTO draft
    FROM pitch_drafts
   WHERE id = draft_id
     AND subject_user_id = caller
     AND status = 'consent_pending'
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'draft not found, not yours to approve, or not awaiting consent';
  END IF;

  IF private.identity_enforcement() THEN
    PERFORM private.assert_identity_evidence(caller);
  END IF;

  SELECT display_name INTO dater_name FROM profiles WHERE user_id = caller;
  new_slug := private.generate_campaign_slug(dater_name);

  UPDATE pitch_drafts SET status = 'published' WHERE id = draft.id;
  UPDATE consent_requests
     SET status = 'approved', responded_at = now()
   WHERE pitch_draft_id = draft.id AND subject_user_id = caller;

  INSERT INTO campaigns (pitch_draft_id, owner_user_id, status, published_at, slug, ends_at)
  VALUES (draft.id, caller, 'published', now(), new_slug, now() + make_interval(days => campaign_days))
  ON CONFLICT (pitch_draft_id) DO UPDATE
    SET status = 'published',
        published_at = now(),
        slug = COALESCE(campaigns.slug, EXCLUDED.slug),
        ends_at = EXCLUDED.ends_at
    WHERE campaigns.owner_user_id = EXCLUDED.owner_user_id
  RETURNING id, slug INTO new_campaign_id, new_slug;

  IF new_campaign_id IS NULL THEN
    RAISE EXCEPTION 'existing campaign for this pitch belongs to another owner';
  END IF;

  INSERT INTO campaign_memberships (campaign_id, user_id, role)
  VALUES
    (new_campaign_id, caller, 'DATER_OWNER'),
    (new_campaign_id, draft.created_by_user_id, 'INTRODUCER')
  ON CONFLICT (campaign_id, user_id) DO NOTHING;

  RETURN QUERY SELECT new_campaign_id, new_slug;
END;
$$;

REVOKE ALL ON FUNCTION public.approve_and_publish_pitch(UUID, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_and_publish_pitch(UUID, INTEGER) TO authenticated;

CREATE OR REPLACE FUNCTION public.submit_interest(
  target_campaign_id UUID,
  interest_note TEXT DEFAULT NULL
)
RETURNS TABLE (interest_id UUID, interest_status TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  caller UUID := auth.uid();
  campaign campaigns;
  sender_birth_date DATE;
  sender_profile dating_profiles;
  upserted interests;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;
  PERFORM private.assert_active_account(caller);

  SELECT * INTO campaign
    FROM campaigns
   WHERE id = target_campaign_id
     AND status = 'published'
     AND (ends_at IS NULL OR ends_at > now());
  IF NOT FOUND THEN
    RAISE EXCEPTION 'campaign is not open for interest';
  END IF;
  IF campaign.owner_user_id = caller THEN
    RAISE EXCEPTION 'you cannot send interest to your own campaign';
  END IF;
  IF EXISTS (
    SELECT 1 FROM blocks
     WHERE (blocker_user_id = campaign.owner_user_id AND blocked_user_id = caller)
        OR (blocker_user_id = caller AND blocked_user_id = campaign.owner_user_id)
  ) THEN
    RAISE EXCEPTION 'campaign is not open for interest';
  END IF;

  SELECT birth_date INTO sender_birth_date FROM profiles WHERE user_id = caller;
  IF sender_birth_date IS NULL
     OR sender_birth_date > (CURRENT_DATE - INTERVAL '18 years') THEN
    RAISE EXCEPTION 'verified interest requires an adult birth date on your profile';
  END IF;

  SELECT * INTO sender_profile FROM dating_profiles WHERE user_id = caller;
  IF NOT FOUND
     OR coalesce(nullif(trim(sender_profile.bio), ''), NULL) IS NULL
     OR coalesce(nullif(trim(sender_profile.dating_intent), ''), NULL) IS NULL
     OR coalesce(array_length(sender_profile.photos, 1), 0) < 2 THEN
    RAISE EXCEPTION 'complete your dating profile (bio, intent, and at least 2 photos) first';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM unnest(sender_profile.photos) AS photo(storage_path)
     WHERE NOT EXISTS (
       SELECT 1 FROM storage.objects object
        WHERE object.bucket_id = 'profile-media'
          AND object.name = private.profile_photo_object_name(photo.storage_path)
          AND private.profile_media_owner(object.name) = caller
          AND object.metadata ->> 'mimetype' IN ('image/jpeg', 'image/png', 'image/webp')
     )
  ) THEN
    RAISE EXCEPTION 'profile photos require owned storage objects with an allowed image MIME type';
  END IF;

  IF private.identity_enforcement() THEN
    PERFORM private.assert_identity_evidence(caller);
  END IF;

  INSERT INTO interests (campaign_id, sender_user_id, status, note, submitted_at)
  VALUES (target_campaign_id, caller, 'submitted', interest_note, now())
  ON CONFLICT (campaign_id, sender_user_id) DO UPDATE
    SET status = 'submitted',
        note = EXCLUDED.note,
        submitted_at = now()
    WHERE interests.status IN ('started', 'verification_pending', 'submitted', 'withdrawn')
  RETURNING * INTO upserted;

  IF upserted.id IS NULL THEN
    RAISE EXCEPTION 'this interest was already answered';
  END IF;

  RETURN QUERY SELECT upserted.id, upserted.status::TEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_interest(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_interest(UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.decide_interest(target_interest_id UUID, decision TEXT)
RETURNS TABLE (intro_room_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  caller UUID := auth.uid();
  interest interests;
  campaign_owner UUID;
  new_room_id UUID;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;
  PERFORM private.assert_active_account(caller);

  IF decision NOT IN ('accepted', 'declined') THEN
    RAISE EXCEPTION 'decision must be accepted or declined';
  END IF;
  SELECT i.* INTO interest FROM interests i WHERE i.id = target_interest_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'interest not found or not yours to decide';
  END IF;
  SELECT owner_user_id INTO campaign_owner FROM campaigns WHERE id = interest.campaign_id;
  IF campaign_owner IS DISTINCT FROM caller THEN
    RAISE EXCEPTION 'interest not found or not yours to decide';
  END IF;
  IF interest.status <> 'submitted' THEN
    RAISE EXCEPTION 'interest is not awaiting a decision';
  END IF;

  UPDATE interests SET status = decision::interest_status, decided_at = now()
   WHERE id = interest.id;
  IF decision = 'accepted' THEN
    INSERT INTO intro_rooms (campaign_id, dater_user_id, interested_user_id)
    VALUES (interest.campaign_id, caller, interest.sender_user_id)
    ON CONFLICT (campaign_id, dater_user_id, interested_user_id) DO NOTHING;
    SELECT id INTO new_room_id FROM intro_rooms
     WHERE campaign_id = interest.campaign_id
       AND dater_user_id = caller
       AND interested_user_id = interest.sender_user_id;
  END IF;

  RETURN QUERY SELECT new_room_id;
END;
$$;

REVOKE ALL ON FUNCTION public.decide_interest(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.decide_interest(UUID, TEXT) TO authenticated;

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
  ) THEN
    RAISE EXCEPTION 'cannot move campaign from % to %', campaign.status, next_status;
  END IF;

  UPDATE campaigns SET status = next_status WHERE id = campaign.id;
  RETURN QUERY SELECT next_status;
END;
$$;

REVOKE ALL ON FUNCTION public.set_campaign_status(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_campaign_status(UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.validate_message_sender()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM private.assert_active_account(NEW.sender_user_id);
  IF NOT EXISTS (
    SELECT 1 FROM intro_rooms
     WHERE id = NEW.intro_room_id
       AND NEW.sender_user_id IN (dater_user_id, interested_user_id)
       AND status = 'open'
  ) OR EXISTS (
    SELECT 1 FROM intro_rooms
    JOIN blocks
      ON (blocks.blocker_user_id = intro_rooms.dater_user_id
          AND blocks.blocked_user_id = intro_rooms.interested_user_id)
      OR (blocks.blocker_user_id = intro_rooms.interested_user_id
          AND blocks.blocked_user_id = intro_rooms.dater_user_id)
     WHERE intro_rooms.id = NEW.intro_room_id
  ) THEN
    RAISE EXCEPTION 'message sender must be an unblocked participant in an open intro room';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_message_sender() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.track_event(
  event_name TEXT,
  properties JSONB DEFAULT '{}'::JSONB
)
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
    'draft_changes_requested',
    'pitch_approved',
    'campaign_published',
    'campaign_shared',
    'pitch_viewed_unique',
    'interest_started',
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
