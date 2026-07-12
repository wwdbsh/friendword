-- Flow C server side: a signed-in viewer submits verified interest on a
-- published campaign, and the dater reviews a sanitized sender profile and
-- accepts or declines. Acceptance opens the intro room in the same
-- transaction. All transitions stay behind SECURITY DEFINER RPCs; contact
-- details (email/phone) are never selected, so they cannot leak.

-- ── profile-media bucket: interested people upload their own photos under
--    their user-id folder; the campaign owner may view them only while an
--    active (submitted/accepted) interest links the two.
INSERT INTO storage.buckets (id, name, public)
VALUES ('profile-media', 'profile-media', false)
ON CONFLICT (id) DO UPDATE SET public = false;

CREATE FUNCTION private.profile_media_owner(object_name TEXT)
RETURNS UUID
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN object_name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[a-z0-9][a-z0-9._-]{0,254}$'
      THEN (storage.foldername(object_name))[1]::UUID
    ELSE NULL
  END;
$$;

CREATE FUNCTION private.can_view_profile_media(media_owner UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT media_owner IS NOT NULL
    AND (
      media_owner = auth.uid()
      OR EXISTS (
        SELECT 1
          FROM public.interests i
          JOIN public.campaigns c ON c.id = i.campaign_id
         WHERE i.sender_user_id = media_owner
           AND c.owner_user_id = auth.uid()
           AND i.status IN ('submitted', 'accepted')
      )
    );
$$;

REVOKE ALL ON FUNCTION private.profile_media_owner(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.can_view_profile_media(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.profile_media_owner(TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.can_view_profile_media(UUID) TO authenticated, service_role;

CREATE POLICY objects_insert_own_profile_media ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'profile-media'
    AND private.profile_media_owner(name) = auth.uid()
  );

CREATE POLICY objects_select_profile_media ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'profile-media'
    AND private.can_view_profile_media(private.profile_media_owner(name))
  );

-- ── submit_interest: profile-gated transition to 'submitted'.
CREATE FUNCTION public.submit_interest(target_campaign_id UUID, interest_note TEXT DEFAULT NULL)
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

  SELECT * INTO campaign
    FROM campaigns
   WHERE id = target_campaign_id AND status = 'published';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'campaign is not open for interest';
  END IF;

  IF campaign.owner_user_id = caller THEN
    RAISE EXCEPTION 'you cannot send interest to your own campaign';
  END IF;

  -- Blocked either way reads the same as a closed campaign on purpose.
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

-- ── list_campaign_interests: the owner's inbox, sanitized. Contact details
--    are structurally absent (profiles/dating_profiles carry none), and age
--    is exposed as a number, never the birth date.
CREATE FUNCTION public.list_campaign_interests(target_campaign_id UUID)
RETURNS TABLE (
  interest_id UUID,
  interest_status TEXT,
  note TEXT,
  submitted_at TIMESTAMPTZ,
  sender_display_name TEXT,
  sender_age INTEGER,
  sender_bio TEXT,
  sender_photos TEXT[],
  sender_dating_intent TEXT,
  sender_location TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  caller UUID := auth.uid();
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;

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
$$;

REVOKE ALL ON FUNCTION public.list_campaign_interests(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_campaign_interests(UUID) TO authenticated;

-- ── decide_interest: owner accepts or declines; acceptance opens the intro
--    room in the same transaction (0001 trigger re-validates the parties).
CREATE FUNCTION public.decide_interest(target_interest_id UUID, decision TEXT)
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

  IF decision NOT IN ('accepted', 'declined') THEN
    RAISE EXCEPTION 'decision must be accepted or declined';
  END IF;

  SELECT i.* INTO interest
    FROM interests i
   WHERE i.id = target_interest_id
     FOR UPDATE;
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

  UPDATE interests
     SET status = decision::interest_status, decided_at = now()
   WHERE id = interest.id;

  IF decision = 'accepted' THEN
    INSERT INTO intro_rooms (campaign_id, dater_user_id, interested_user_id)
    VALUES (interest.campaign_id, caller, interest.sender_user_id)
    ON CONFLICT (campaign_id, dater_user_id, interested_user_id) DO NOTHING;

    SELECT id INTO new_room_id
      FROM intro_rooms
     WHERE campaign_id = interest.campaign_id
       AND dater_user_id = caller
       AND interested_user_id = interest.sender_user_id;
  END IF;

  RETURN QUERY SELECT new_room_id;
END;
$$;

REVOKE ALL ON FUNCTION public.decide_interest(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.decide_interest(UUID, TEXT) TO authenticated;
