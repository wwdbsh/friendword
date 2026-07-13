ALTER TABLE public.pitch_drafts
  ADD COLUMN structure JSONB;

REVOKE INSERT, UPDATE ON public.pitch_drafts FROM authenticated;
GRANT INSERT (
  created_by_user_id,
  headline,
  body,
  relationship_type,
  relationship_duration,
  structure
) ON public.pitch_drafts TO authenticated;
GRANT UPDATE (
  headline,
  body,
  relationship_type,
  relationship_duration,
  structure
) ON public.pitch_drafts TO authenticated;

DROP POLICY pitch_drafts_update_creators ON public.pitch_drafts;
CREATE POLICY pitch_drafts_update_creators ON public.pitch_drafts
  FOR UPDATE
  USING (
    auth.uid() = created_by_user_id
    AND status IN ('draft', 'changes_requested')
  )
  WITH CHECK (
    auth.uid() = created_by_user_id
    AND status IN ('draft', 'changes_requested')
  );

DROP POLICY pitch_assets_insert_creators ON public.pitch_assets;
CREATE POLICY pitch_assets_insert_creators ON public.pitch_assets
  FOR INSERT WITH CHECK (
    auth.uid() = uploaded_by_user_id
    AND private.can_upload_pitch_media(pitch_draft_id)
  );

CREATE OR REPLACE FUNCTION private.can_upload_pitch_media(draft_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF draft_id IS NULL THEN
    RETURN false;
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM public.pitch_drafts
     WHERE id = draft_id
       AND created_by_user_id = auth.uid()
       AND status IN ('draft', 'changes_requested')
  ) THEN
    RETURN false;
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(draft_id::TEXT, 0)
  );
  RETURN EXISTS (
    SELECT 1
      FROM public.pitch_drafts
     WHERE id = draft_id
       AND created_by_user_id = auth.uid()
       AND status IN ('draft', 'changes_requested')
  );
END;
$$;

REVOKE ALL ON FUNCTION private.can_upload_pitch_media(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.can_upload_pitch_media(UUID) TO authenticated, service_role;

DROP POLICY objects_insert_pitch_creators ON storage.objects;
CREATE POLICY objects_insert_pitch_creators ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'pitch-media'
    AND private.can_upload_pitch_media(private.pitch_media_draft_id(name))
  );

CREATE TABLE public.consent_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pitch_draft_id UUID NOT NULL REFERENCES public.pitch_drafts(id),
  revision_number INTEGER NOT NULL CHECK (revision_number > 0),
  headline TEXT NOT NULL,
  body TEXT NOT NULL,
  structure JSONB,
  asset_ids UUID[] NOT NULL DEFAULT '{}',
  voice_asset_path TEXT,
  content_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (pitch_draft_id, revision_number)
);

COMMENT ON COLUMN public.consent_revisions.content_hash IS
  'SHA-256 hex of jsonb canonical text with keys headline, body, structure, asset_ids, voice_asset_path; asset_ids are UUID-ascending.';

ALTER TABLE public.consent_revisions ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.consent_revisions TO authenticated, service_role;
GRANT INSERT ON public.consent_revisions TO service_role;

CREATE POLICY consent_revisions_select_participants ON public.consent_revisions
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.pitch_drafts
       WHERE pitch_drafts.id = consent_revisions.pitch_draft_id
         AND auth.uid() IN (
           pitch_drafts.created_by_user_id,
           pitch_drafts.subject_user_id
         )
    )
  );

CREATE FUNCTION private.reject_consent_revision_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'consent revisions are immutable';
END;
$$;

REVOKE ALL ON FUNCTION private.reject_consent_revision_mutation() FROM PUBLIC;

CREATE TRIGGER consent_revisions_reject_mutation
BEFORE UPDATE OR DELETE ON public.consent_revisions
FOR EACH ROW EXECUTE FUNCTION private.reject_consent_revision_mutation();

ALTER TABLE public.consent_requests
  ADD COLUMN revision_id UUID REFERENCES public.consent_revisions(id),
  ADD COLUMN response_note TEXT;

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

CREATE FUNCTION public.respond_consent_request(
  draft_id UUID,
  action TEXT,
  note TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  caller UUID := auth.uid();
  request consent_requests;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;
  PERFORM private.assert_active_account(caller);

  IF action IS NULL OR action NOT IN ('request_changes', 'decline') THEN
    RAISE EXCEPTION 'action must be request_changes or decline';
  END IF;

  SELECT r.* INTO request
    FROM consent_requests r
    JOIN pitch_drafts d ON d.id = r.pitch_draft_id
   WHERE r.pitch_draft_id = draft_id
     AND r.subject_user_id = caller
     AND r.status = 'claimed'
     AND r.revision_id IS NOT NULL
     AND d.subject_user_id = caller
     AND d.status = 'consent_pending'
   FOR UPDATE OF r;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'consent request not found, not claimed by caller, or not awaiting response';
  END IF;

  UPDATE consent_requests
     SET status = CASE WHEN action = 'decline' THEN 'declined' ELSE 'claimed' END,
         response_note = nullif(btrim(note), ''),
         responded_at = now()
   WHERE id = request.id;

  UPDATE pitch_drafts
     SET status = CASE
       WHEN action = 'decline' THEN 'archived'::pitch_draft_status
       ELSE 'changes_requested'::pitch_draft_status
     END
   WHERE id = request.pitch_draft_id;
END;
$$;

REVOKE ALL ON FUNCTION public.respond_consent_request(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.respond_consent_request(UUID, TEXT, TEXT) TO authenticated;

DROP FUNCTION public.exclude_pitch_asset(UUID);

DROP FUNCTION public.approve_and_publish_pitch(UUID, INTEGER);
CREATE FUNCTION public.approve_and_publish_pitch(
  draft_id UUID,
  campaign_days INTEGER,
  revision_id UUID,
  included_asset_ids UUID[],
  hard_claims_confirmed BOOLEAN
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
  request consent_requests;
  approved_revision consent_revisions;
  new_campaign_id UUID;
  new_slug TEXT;
  dater_name TEXT;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;
  PERFORM private.assert_active_account(caller);

  IF campaign_days IS NULL OR campaign_days NOT IN (7, 14, 30, 90) THEN
    RAISE EXCEPTION 'campaign_days must be 7, 14, 30, or 90';
  END IF;
  IF included_asset_ids IS NULL THEN
    RAISE EXCEPTION 'included asset ids are required';
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

  SELECT * INTO request
    FROM consent_requests
   WHERE pitch_draft_id = draft.id
     AND subject_user_id = caller
   FOR UPDATE;
  IF request.id IS NULL OR request.revision_id IS DISTINCT FROM revision_id THEN
    RAISE EXCEPTION 'approval requires the latest consent revision';
  END IF;

  SELECT * INTO approved_revision
    FROM consent_revisions
   WHERE id = revision_id
     AND pitch_draft_id = draft.id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'approval revision does not belong to this draft';
  END IF;

  IF NOT (included_asset_ids <@ approved_revision.asset_ids)
     OR EXISTS (
       SELECT 1
         FROM unnest(included_asset_ids) included_asset_id
         LEFT JOIN pitch_assets asset
           ON asset.id = included_asset_id
          AND asset.pitch_draft_id = draft.id
        WHERE asset.id IS NULL OR asset.asset_type <> 'photo'
     ) THEN
    RAISE EXCEPTION 'included assets must be reviewed photo assets from the revision';
  END IF;

  IF coalesce(
    jsonb_array_length(
      CASE
        WHEN jsonb_typeof(
          approved_revision.structure -> 'hard_claims_requiring_confirmation'
        ) = 'array'
          THEN approved_revision.structure -> 'hard_claims_requiring_confirmation'
        ELSE '[]'::JSONB
      END
    ),
    0
  ) > 0 AND hard_claims_confirmed IS NOT TRUE THEN
    RAISE EXCEPTION 'hard claims require confirmation before approval';
  END IF;

  IF private.identity_enforcement() THEN
    PERFORM private.assert_identity_evidence(caller);
  END IF;

  DELETE FROM pitch_assets
   WHERE pitch_draft_id = draft.id
     AND (
       NOT (id = ANY(approved_revision.asset_ids))
       OR (asset_type = 'photo' AND NOT (id = ANY(included_asset_ids)))
     );

  UPDATE pitch_drafts
     SET headline = approved_revision.headline,
         body = approved_revision.body,
         structure = approved_revision.structure,
         status = 'published'
   WHERE id = draft.id;

  UPDATE consent_requests
     SET status = 'approved',
         responded_at = now(),
         response_note = NULL
   WHERE id = request.id;

  SELECT display_name INTO dater_name FROM profiles WHERE user_id = caller;
  new_slug := private.generate_campaign_slug(dater_name);

  INSERT INTO campaigns (pitch_draft_id, owner_user_id, status, published_at, slug, ends_at)
  VALUES (draft.id, caller, 'published', now(), new_slug, now() + make_interval(days => campaign_days))
  ON CONFLICT (pitch_draft_id) DO UPDATE
    SET status = 'published',
        published_at = now(),
        slug = coalesce(campaigns.slug, EXCLUDED.slug),
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

REVOKE ALL ON FUNCTION public.approve_and_publish_pitch(UUID, INTEGER, UUID, UUID[], BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_and_publish_pitch(UUID, INTEGER, UUID, UUID[], BOOLEAN) TO authenticated;
