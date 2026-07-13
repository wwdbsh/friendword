CREATE TABLE public.media_validations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id TEXT NOT NULL,
  object_name TEXT NOT NULL,
  validated_at TIMESTAMPTZ NOT NULL,
  mime_ok BOOLEAN NOT NULL,
  magic_ok BOOLEAN NOT NULL,
  size_ok BOOLEAN NOT NULL,
  decode_ok BOOLEAN NOT NULL,
  moderation_status TEXT NOT NULL
    CHECK (moderation_status IN ('passed', 'flagged', 'skipped')),
  moderation_ref TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (bucket_id, object_name)
);

COMMENT ON TABLE public.media_validations IS
  'Service-written media checks. skipped is reserved for deployments without OPENAI_API_KEY; enforcement accepts only passed.';

ALTER TABLE public.media_validations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.media_validations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.media_validations TO service_role;

INSERT INTO public.app_config (key, value)
VALUES ('media_validation_enforcement', 'off')
ON CONFLICT (key) DO NOTHING;

CREATE FUNCTION private.media_validation_enforcement()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT coalesce(
    (
      SELECT value = 'on'
        FROM public.app_config
       WHERE key = 'media_validation_enforcement'
    ),
    false
  );
$$;

REVOKE ALL ON FUNCTION private.media_validation_enforcement() FROM PUBLIC;

ALTER TABLE public.consent_revisions
  DROP CONSTRAINT consent_revisions_pitch_draft_id_fkey,
  ADD CONSTRAINT consent_revisions_pitch_draft_id_fkey
    FOREIGN KEY (pitch_draft_id) REFERENCES public.pitch_drafts(id) ON DELETE CASCADE;

CREATE OR REPLACE FUNCTION private.reject_consent_revision_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE'
     AND current_setting('role', true) = 'service_role' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'consent revisions are immutable';
END;
$$;

REVOKE ALL ON FUNCTION private.reject_consent_revision_mutation() FROM PUBLIC;

CREATE FUNCTION private.is_active_account(target_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.users
     WHERE id = target_user_id
       AND account_status = 'active'
  );
$$;

CREATE FUNCTION private.enforce_active_account_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  caller UUID := auth.uid();
BEGIN
  IF caller IS NOT NULL
     AND current_setting('role', true) = 'authenticated' THEN
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

REVOKE ALL ON FUNCTION private.is_active_account(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.enforce_active_account_mutation() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.is_active_account(UUID) TO authenticated, service_role;

DO $$
DECLARE
  target_table TEXT;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'users', 'profiles', 'dating_profiles', 'introducer_profiles',
    'pitch_drafts', 'pitch_assets', 'vouches', 'interests',
    'intro_rooms', 'messages', 'reports', 'blocks'
  ]
  LOOP
    EXECUTE format(
      'CREATE TRIGGER %I_enforce_active_account '
      'BEFORE INSERT OR UPDATE OR DELETE ON public.%I '
      'FOR EACH ROW EXECUTE FUNCTION private.enforce_active_account_mutation()',
      target_table,
      target_table
    );
  END LOOP;
END;
$$;

DROP POLICY objects_insert_own_profile_media ON storage.objects;
CREATE POLICY objects_insert_own_profile_media ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'profile-media'
    AND private.is_active_account(auth.uid())
    AND private.profile_media_owner(name) = auth.uid()
  );

DROP POLICY objects_insert_pitch_creators ON storage.objects;
CREATE POLICY objects_insert_pitch_creators ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'pitch-media'
    AND private.is_active_account(auth.uid())
    AND private.can_upload_pitch_media(private.pitch_media_draft_id(name))
  );

CREATE FUNCTION public.reassign_pitch_storage_owner(
  target_draft_id UUID,
  new_owner_id UUID
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM public.campaigns
     WHERE pitch_draft_id = target_draft_id
       AND owner_user_id = new_owner_id
  ) THEN
    RAISE EXCEPTION 'storage ownership target must own the draft campaign';
  END IF;

  UPDATE storage.objects
     SET owner_id = new_owner_id::TEXT
   WHERE bucket_id = 'pitch-media'
     AND private.pitch_media_draft_id(name) = target_draft_id;
END;
$$;

REVOKE ALL ON FUNCTION public.reassign_pitch_storage_owner(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reassign_pitch_storage_owner(UUID, UUID) TO service_role;

ALTER TABLE public.reports
  ALTER COLUMN reporter_user_id DROP NOT NULL,
  ADD COLUMN target_type TEXT
    CHECK (target_type IN ('campaign', 'interest', 'intro_room', 'message')),
  ADD COLUMN target_id UUID,
  ADD COLUMN severity TEXT NOT NULL DEFAULT 'low'
    CHECK (severity IN ('low', 'high')),
  ADD COLUMN detail TEXT,
  ADD COLUMN anon_report BOOLEAN NOT NULL DEFAULT false,
  ADD CONSTRAINT reports_reporter_origin_check CHECK (
    (anon_report AND reporter_user_id IS NULL)
    OR (NOT anon_report AND reporter_user_id IS NOT NULL)
  ),
  ADD CONSTRAINT reports_target_pair_check CHECK (
    (target_type IS NULL AND target_id IS NULL)
    OR (target_type IS NOT NULL AND target_id IS NOT NULL)
  );

CREATE INDEX reports_campaign_severity_created_at_idx
  ON public.reports (campaign_id, severity, created_at DESC);

CREATE FUNCTION private.can_report_intro_room_counterpart(
  target_campaign_id UUID,
  reporter_id UUID,
  reported_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.intro_rooms room
     WHERE room.campaign_id = target_campaign_id
       AND reporter_id IN (room.dater_user_id, room.interested_user_id)
       AND reported_id = CASE
         WHEN reporter_id = room.dater_user_id THEN room.interested_user_id
         ELSE room.dater_user_id
       END
  );
$$;

REVOKE ALL ON FUNCTION private.can_report_intro_room_counterpart(UUID, UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.can_report_intro_room_counterpart(UUID, UUID, UUID)
  TO authenticated, service_role;

DROP POLICY reports_insert_reporters ON public.reports;
CREATE POLICY reports_insert_reporters ON public.reports
  FOR INSERT TO authenticated
  WITH CHECK (
    reporter_user_id = auth.uid()
    AND private.is_active_account(auth.uid())
    AND target_type IS NULL
    AND target_id IS NULL
    AND private.can_report_intro_room_counterpart(
      campaign_id,
      auth.uid(),
      reported_user_id
    )
  );

CREATE FUNCTION private.normalize_report_severity()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.reason := lower(btrim(NEW.reason));
  NEW.severity := CASE
    WHEN NEW.reason IN ('safety_risk', 'impersonation', 'minor') THEN 'high'
    ELSE 'low'
  END;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.normalize_report_severity() FROM PUBLIC;

CREATE TRIGGER reports_normalize_severity
BEFORE INSERT ON public.reports
FOR EACH ROW EXECUTE FUNCTION private.normalize_report_severity();

CREATE TABLE public.ops_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_type TEXT NOT NULL,
  campaign_id UUID REFERENCES public.campaigns(id) ON DELETE SET NULL,
  report_id UUID REFERENCES public.reports(id) ON DELETE SET NULL,
  detail JSONB NOT NULL DEFAULT '{}'::JSONB,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.ops_alerts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ops_alerts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ops_alerts TO service_role;

CREATE FUNCTION private.pause_campaign_after_high_severity_report()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  paused_campaign_id UUID;
BEGIN
  IF NEW.severity <> 'high' OR NEW.campaign_id IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(NEW.campaign_id::TEXT, 160016)
  );

  IF (
    SELECT count(DISTINCT coalesce(reporter_user_id::TEXT, id::TEXT))
      FROM public.reports
     WHERE campaign_id = NEW.campaign_id
       AND severity = 'high'
       AND created_at >= now() - INTERVAL '24 hours'
  ) < 2 THEN
    RETURN NEW;
  END IF;

  UPDATE public.campaigns
     SET status = 'paused'
   WHERE id = NEW.campaign_id
     AND status = 'published'
  RETURNING id INTO paused_campaign_id;

  IF paused_campaign_id IS NOT NULL THEN
    INSERT INTO public.ops_alerts (alert_type, campaign_id, report_id, detail)
    VALUES (
      'campaign_auto_paused',
      paused_campaign_id,
      NEW.id,
      jsonb_build_object('window_hours', 24, 'threshold', 2)
    );
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.pause_campaign_after_high_severity_report() FROM PUBLIC;

CREATE TRIGGER reports_pause_campaign_after_high_severity
AFTER INSERT ON public.reports
FOR EACH ROW EXECUTE FUNCTION private.pause_campaign_after_high_severity_report();

CREATE FUNCTION public.report_content(
  target_type TEXT,
  target_id UUID,
  reason TEXT,
  detail TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  caller UUID := auth.uid();
  target_campaign_id UUID;
  target_reported_user_id UUID;
  target_severity TEXT;
  new_report_id UUID;
  room intro_rooms;
  target_interest interests;
  target_message messages;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;
  PERFORM private.assert_active_account(caller);

  IF target_type IS NULL
     OR target_type NOT IN ('campaign', 'interest', 'intro_room', 'message') THEN
    RAISE EXCEPTION 'target_type must be campaign, interest, intro_room, or message';
  END IF;
  IF target_id IS NULL THEN
    RAISE EXCEPTION 'target_id is required';
  END IF;
  IF nullif(btrim(reason), '') IS NULL THEN
    RAISE EXCEPTION 'reason is required';
  END IF;
  IF length(btrim(reason)) > 64 THEN
    RAISE EXCEPTION 'reason is too long';
  END IF;
  IF detail IS NOT NULL AND length(detail) > 2000 THEN
    RAISE EXCEPTION 'detail is too long';
  END IF;

  IF target_type = 'campaign' THEN
    SELECT id, owner_user_id
      INTO target_campaign_id, target_reported_user_id
      FROM campaigns
     WHERE id = target_id
       AND status IN ('published', 'paused');
    IF NOT FOUND THEN
      RAISE EXCEPTION 'report target not found or not reportable';
    END IF;
  ELSIF target_type = 'interest' THEN
    SELECT * INTO target_interest
      FROM interests
     WHERE id = target_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'report target not found or not reportable';
    END IF;
    SELECT owner_user_id INTO target_reported_user_id
      FROM campaigns
     WHERE id = target_interest.campaign_id;
    target_campaign_id := target_interest.campaign_id;
    IF caller <> target_reported_user_id THEN
      RAISE EXCEPTION 'report target not found or not reportable';
    END IF;
    target_reported_user_id := target_interest.sender_user_id;
  ELSIF target_type = 'intro_room' THEN
    SELECT * INTO room
      FROM intro_rooms
     WHERE id = target_id
       AND caller IN (dater_user_id, interested_user_id);
    IF NOT FOUND THEN
      RAISE EXCEPTION 'report target not found or not reportable';
    END IF;
    target_campaign_id := room.campaign_id;
    target_reported_user_id := CASE
      WHEN caller = room.dater_user_id THEN room.interested_user_id
      ELSE room.dater_user_id
    END;
  ELSE
    SELECT * INTO target_message
      FROM messages
     WHERE id = target_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'report target not found or not reportable';
    END IF;
    SELECT * INTO room
      FROM intro_rooms
     WHERE id = target_message.intro_room_id
       AND caller IN (dater_user_id, interested_user_id);
    IF NOT FOUND OR target_message.sender_user_id = caller THEN
      RAISE EXCEPTION 'report target not found or not reportable';
    END IF;
    target_campaign_id := room.campaign_id;
    target_reported_user_id := target_message.sender_user_id;
  END IF;

  IF target_reported_user_id = caller THEN
    RAISE EXCEPTION 'you cannot report your own content';
  END IF;

  target_severity := CASE
    WHEN lower(btrim(reason)) IN ('safety_risk', 'impersonation', 'minor') THEN 'high'
    ELSE 'low'
  END;

  INSERT INTO reports (
    reporter_user_id,
    reported_user_id,
    campaign_id,
    reason,
    target_type,
    target_id,
    severity,
    detail,
    anon_report
  )
  VALUES (
    caller,
    target_reported_user_id,
    target_campaign_id,
    lower(btrim(reason)),
    target_type,
    target_id,
    target_severity,
    nullif(btrim(detail), ''),
    false
  )
  RETURNING id INTO new_report_id;

  RETURN new_report_id;
END;
$$;

REVOKE ALL ON FUNCTION public.report_content(TEXT, UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.report_content(TEXT, UUID, TEXT, TEXT) TO authenticated;

CREATE TABLE public.deletion_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  scope TEXT NOT NULL DEFAULT 'account' CHECK (scope = 'account'),
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'processing', 'done', 'failed')),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  note TEXT,
  UNIQUE (user_id, scope)
);

ALTER TABLE public.deletion_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.deletion_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.deletion_requests TO service_role;
GRANT SELECT ON public.deletion_requests TO authenticated;
GRANT DELETE ON public.purchase_intents TO service_role;

CREATE POLICY deletion_requests_select_own ON public.deletion_requests
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE FUNCTION public.request_account_deletion()
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

    UPDATE users
       SET account_status = 'deleted'
     WHERE id = caller;
  END IF;

  RETURN QUERY SELECT request.id, request.status;
END;
$$;

REVOKE ALL ON FUNCTION public.request_account_deletion() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_account_deletion() TO authenticated;

DROP FUNCTION public.submit_pitch_for_consent(UUID, TEXT, TEXT, TEXT);
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
#variable_conflict use_column
DECLARE
  caller UUID := auth.uid();
  draft pitch_drafts;
  existing_request consent_requests;
  raw_token TEXT;
  contact_hash TEXT;
  snapshot_asset_ids UUID[];
  snapshot_voice_asset_path TEXT;
  next_revision_number INTEGER;
  new_revision_id UUID;
  new_request_id UUID;
  canonical_content JSONB;
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

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(draft_id::TEXT, 0)
  );

  SELECT * INTO draft
    FROM pitch_drafts
   WHERE id = draft_id
     AND created_by_user_id = caller
     AND status IN ('draft', 'changes_requested')
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'draft not found, not owned by caller, or not submittable';
  END IF;
  IF nullif(btrim(draft.headline), '') IS NULL
     OR nullif(btrim(draft.body), '') IS NULL THEN
    RAISE EXCEPTION 'complete the AI draft or direct writing before requesting consent';
  END IF;

  IF private.media_validation_enforcement() AND EXISTS (
    SELECT 1
      FROM pitch_assets asset
     WHERE asset.pitch_draft_id = draft.id
       AND NOT EXISTS (
         SELECT 1
           FROM media_validations validation
          WHERE validation.bucket_id = 'pitch-media'
            AND validation.object_name = CASE
              WHEN asset.storage_path LIKE 'pitch-media/%'
                THEN substr(asset.storage_path, length('pitch-media/') + 1)
              ELSE asset.storage_path
            END
            AND validation.mime_ok
            AND validation.magic_ok
            AND validation.size_ok
            AND validation.decode_ok
            AND validation.moderation_status = 'passed'
       )
  ) THEN
    RAISE EXCEPTION 'pitch media requires completed validation';
  END IF;

  SELECT
    coalesce(array_agg(id ORDER BY id), ARRAY[]::UUID[]),
    (
      array_agg(storage_path ORDER BY sort_order, id)
        FILTER (WHERE asset_type = 'voice')
    )[1]
    INTO snapshot_asset_ids, snapshot_voice_asset_path
    FROM pitch_assets
   WHERE pitch_draft_id = draft.id;

  SELECT coalesce(max(revision_number), 0) + 1 INTO next_revision_number
    FROM consent_revisions
   WHERE pitch_draft_id = draft.id;

  canonical_content := jsonb_build_object(
    'headline', draft.headline,
    'body', draft.body,
    'structure', draft.structure,
    'asset_ids', to_jsonb(snapshot_asset_ids),
    'voice_asset_path', snapshot_voice_asset_path
  );

  INSERT INTO consent_revisions (
    pitch_draft_id,
    revision_number,
    headline,
    body,
    structure,
    asset_ids,
    voice_asset_path,
    content_hash
  )
  VALUES (
    draft.id,
    next_revision_number,
    draft.headline,
    draft.body,
    draft.structure,
    snapshot_asset_ids,
    snapshot_voice_asset_path,
    encode(digest(canonical_content::TEXT, 'sha256'), 'hex')
  )
  RETURNING id INTO new_revision_id;

  SELECT * INTO existing_request
    FROM consent_requests
   WHERE pitch_draft_id = draft.id
   FOR UPDATE;

  IF existing_request.id IS NULL THEN
    raw_token := replace(replace(encode(gen_random_bytes(24), 'base64'), '+', '-'), '/', '_');
    raw_token := replace(raw_token, '=', '');

    INSERT INTO consent_requests (
      pitch_draft_id,
      token_hash,
      status,
      revision_id,
      invite_contact_channel,
      invite_contact_hash,
      invite_friend_name
    )
    VALUES (
      draft.id,
      encode(digest(raw_token, 'sha256'), 'hex'),
      'pending',
      new_revision_id,
      invite_channel,
      contact_hash,
      nullif(btrim(invite_friend_name), '')
    )
    RETURNING id INTO new_request_id;
  ELSE
    new_request_id := existing_request.id;
    UPDATE consent_requests
       SET revision_id = new_revision_id,
           status = CASE
             WHEN subject_user_id IS NULL THEN 'pending'
             ELSE 'claimed'
           END,
           response_note = NULL,
           responded_at = NULL
     WHERE id = existing_request.id;
  END IF;

  UPDATE pitch_drafts SET status = 'consent_pending' WHERE id = draft.id;

  RETURN QUERY SELECT new_request_id, raw_token;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_pitch_for_consent(UUID, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_pitch_for_consent(UUID, TEXT, TEXT, TEXT) TO authenticated;

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

  IF private.media_validation_enforcement() AND EXISTS (
    SELECT 1
      FROM unnest(sender_profile.photos) AS photo(storage_path)
     WHERE NOT EXISTS (
       SELECT 1
         FROM media_validations validation
        WHERE validation.bucket_id = 'profile-media'
          AND validation.object_name = private.profile_photo_object_name(photo.storage_path)
          AND validation.mime_ok
          AND validation.magic_ok
          AND validation.size_ok
          AND validation.decode_ok
          AND validation.moderation_status = 'passed'
     )
  ) THEN
    RAISE EXCEPTION 'profile photos require completed validation';
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

COMMENT ON FUNCTION public.submit_pitch_for_consent(UUID, TEXT, TEXT, TEXT) IS
  'Pitch photo/audio validation is fail-closed only while media_validation_enforcement is on.';
COMMENT ON FUNCTION public.submit_interest(UUID, TEXT) IS
  'Profile photo validation is fail-closed only while media_validation_enforcement is on.';
COMMENT ON TABLE public.messages IS
  'Chat moderation is fail-open; reports are the enforcement path until real-time moderation is added.';
