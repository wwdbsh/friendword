-- Second audit Slice 2 (H-3, H-7): authoritative text limits, chat
-- throttling, and per-owner Storage quotas. Existing rows are deliberately
-- not validated during rollout; every new INSERT/UPDATE is constrained.

ALTER TABLE public.pitch_drafts
  ADD CONSTRAINT pitch_drafts_headline_length_check
    CHECK (char_length(headline) <= 120) NOT VALID,
  ADD CONSTRAINT pitch_drafts_body_length_check
    CHECK (char_length(body) <= 2000) NOT VALID;

ALTER TABLE public.dating_profiles
  ADD CONSTRAINT dating_profiles_bio_length_check
    CHECK (char_length(bio) <= 500) NOT VALID;

ALTER TABLE public.interests
  ADD CONSTRAINT interests_note_length_check
    CHECK (char_length(note) <= 500) NOT VALID;

ALTER TABLE public.messages
  ADD CONSTRAINT messages_body_length_check
    CHECK (char_length(body) <= 2000) NOT VALID;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_display_name_length_check
    CHECK (char_length(display_name) <= 60) NOT VALID;

CREATE FUNCTION private.enforce_message_rate_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF (
    SELECT count(*)
      FROM public.messages existing
     WHERE existing.sender_user_id = NEW.sender_user_id
       AND existing.intro_room_id = NEW.intro_room_id
       AND existing.created_at >= now() - INTERVAL '60 seconds'
  ) >= 20 THEN
    RAISE EXCEPTION 'sending too fast — wait a moment';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.enforce_message_rate_limit() FROM PUBLIC;

CREATE TRIGGER messages_enforce_rate_limit
BEFORE INSERT ON public.messages
FOR EACH ROW EXECUTE FUNCTION private.enforce_message_rate_limit();

-- Count through SECURITY DEFINER helpers so the storage.objects policy does
-- not recursively evaluate itself. Prefix parsing remains identical to the
-- existing ownership policies.
CREATE FUNCTION private.pitch_media_object_count(target_draft_id UUID)
RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT count(*)
    FROM storage.objects object
   WHERE object.bucket_id = 'pitch-media'
     AND private.pitch_media_draft_id(object.name) = target_draft_id;
$$;

CREATE FUNCTION private.profile_media_object_count(target_user_id UUID)
RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT count(*)
    FROM storage.objects object
   WHERE object.bucket_id = 'profile-media'
     AND private.profile_media_owner(object.name) = target_user_id;
$$;

REVOKE ALL ON FUNCTION private.pitch_media_object_count(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.profile_media_object_count(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.pitch_media_object_count(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.profile_media_object_count(UUID) TO authenticated, service_role;

DROP POLICY objects_insert_own_profile_media ON storage.objects;
CREATE POLICY objects_insert_own_profile_media ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'profile-media'
    AND private.is_active_account(auth.uid())
    AND private.profile_media_owner(name) = auth.uid()
    AND private.profile_media_object_count(auth.uid()) < 12
  );

DROP POLICY objects_insert_pitch_creators ON storage.objects;
CREATE POLICY objects_insert_pitch_creators ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'pitch-media'
    AND private.is_active_account(auth.uid())
    AND private.can_upload_pitch_media(private.pitch_media_draft_id(name))
    AND private.pitch_media_object_count(private.pitch_media_draft_id(name)) < 12
  );
