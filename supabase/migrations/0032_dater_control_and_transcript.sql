-- Second audit Slice 7 (CP-1, CP-2): the dater controls the words, the
-- photos, the audience, the location precision, and the duration — and
-- the public pitch carries the real transcript.
--
-- - pitch_drafts.transcript stores the provider transcript (text +
--   segment timestamps); every consent revision snapshots it immutably.
-- - The claimed dater can author a new revision (headline/body), upload
--   their own photos into the draft, and set publish preferences
--   (audience policy, location precision, 7- or 14-day free duration).
-- - approve_and_publish_pitch publishes exactly the reviewed snapshot
--   plus those stored preferences; interest submissions are filtered by
--   the published audience policy server-side.

ALTER TABLE public.pitch_drafts
  ADD COLUMN transcript JSONB,
  ADD COLUMN audience_policy JSONB,
  ADD COLUMN location_precision TEXT
    CHECK (location_precision IN ('city', 'region', 'hidden')),
  ADD COLUMN publish_days INTEGER
    CHECK (publish_days IN (7, 14));

ALTER TABLE public.consent_revisions
  ADD COLUMN transcript JSONB;

ALTER TABLE public.campaigns
  ADD COLUMN audience_policy JSONB,
  ADD COLUMN location_precision TEXT
    CHECK (location_precision IN ('city', 'region', 'hidden'));

-- Revisions always freeze the transcript that existed when they were cut.
CREATE FUNCTION private.snapshot_revision_transcript()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.transcript IS NULL THEN
    SELECT transcript INTO NEW.transcript
      FROM public.pitch_drafts
     WHERE id = NEW.pitch_draft_id;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.snapshot_revision_transcript() FROM PUBLIC;

CREATE TRIGGER consent_revisions_snapshot_transcript
BEFORE INSERT ON public.consent_revisions
FOR EACH ROW EXECUTE FUNCTION private.snapshot_revision_transcript();

-- The claimed dater may upload their own photos while the draft is in
-- consent review (CP-1: "기존 사진 교체와 Dater 본인의 새 사진 업로드").
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
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(draft_id::TEXT, 0)
  );
  RETURN EXISTS (
    SELECT 1
      FROM public.pitch_drafts draft
     WHERE draft.id = draft_id
       AND (
         (draft.created_by_user_id = auth.uid()
          AND draft.status IN ('draft', 'changes_requested'))
         OR
         (draft.subject_user_id = auth.uid()
          AND draft.status = 'consent_pending')
       )
  );
END;
$$;

CREATE POLICY pitch_assets_insert_subject ON public.pitch_assets
  FOR INSERT WITH CHECK (
    auth.uid() = uploaded_by_user_id
    AND asset_type = 'photo'
    AND EXISTS (
      SELECT 1
        FROM public.pitch_drafts draft
       WHERE draft.id = pitch_draft_id
         AND draft.subject_user_id = auth.uid()
         AND draft.status = 'consent_pending'
    )
  );

-- CP-1: the dater edits the copy by cutting a new immutable revision.
CREATE FUNCTION public.create_dater_revision(
  draft_id UUID,
  new_headline TEXT,
  new_body TEXT,
  included_asset_ids UUID[] DEFAULT NULL
)
RETURNS TABLE (revision_id UUID, revision_number INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  caller UUID := auth.uid();
  draft pitch_drafts;
  request consent_requests;
  latest consent_revisions;
  snapshot_asset_ids UUID[];
  next_revision_number INTEGER;
  new_revision_id UUID;
  canonical_content JSONB;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;
  PERFORM private.assert_active_account(caller);

  IF nullif(btrim(new_headline), '') IS NULL OR nullif(btrim(new_body), '') IS NULL THEN
    RAISE EXCEPTION 'headline and body are required';
  END IF;
  IF char_length(new_headline) > 120 OR char_length(new_body) > 2000 THEN
    RAISE EXCEPTION 'headline or body is too long';
  END IF;

  SELECT * INTO draft
    FROM pitch_drafts
   WHERE id = draft_id
     AND subject_user_id = caller
     AND status = 'consent_pending'
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'draft not found, not yours to edit, or not in consent review';
  END IF;

  SELECT * INTO request
    FROM consent_requests
   WHERE pitch_draft_id = draft.id
     AND subject_user_id = caller
   FOR UPDATE;
  IF request.id IS NULL THEN
    RAISE EXCEPTION 'consent request not found for this draft';
  END IF;

  SELECT * INTO latest
    FROM consent_revisions
   WHERE id = request.revision_id;
  IF latest.id IS NULL THEN
    RAISE EXCEPTION 'current consent revision not found';
  END IF;

  IF included_asset_ids IS NULL THEN
    SELECT coalesce(array_agg(id ORDER BY id), ARRAY[]::UUID[])
      INTO snapshot_asset_ids
      FROM pitch_assets
     WHERE pitch_draft_id = draft.id;
  ELSE
    IF EXISTS (
      SELECT 1
        FROM unnest(included_asset_ids) candidate_id
        LEFT JOIN pitch_assets asset
          ON asset.id = candidate_id AND asset.pitch_draft_id = draft.id
       WHERE asset.id IS NULL
    ) THEN
      RAISE EXCEPTION 'included assets must belong to this draft';
    END IF;
    SELECT coalesce(array_agg(DISTINCT candidate_id ORDER BY candidate_id), ARRAY[]::UUID[])
      INTO snapshot_asset_ids
      FROM unnest(included_asset_ids) candidate_id;
  END IF;

  SELECT coalesce(max(consent_revisions.revision_number), 0) + 1
    INTO next_revision_number
    FROM consent_revisions
   WHERE pitch_draft_id = draft.id;

  canonical_content := jsonb_build_object(
    'headline', btrim(new_headline),
    'body', btrim(new_body),
    'structure', latest.structure,
    'asset_ids', to_jsonb(snapshot_asset_ids),
    'voice_asset_path', latest.voice_asset_path
  );

  INSERT INTO consent_revisions (
    pitch_draft_id,
    revision_number,
    headline,
    body,
    structure,
    asset_ids,
    voice_asset_path,
    transcript,
    content_hash
  )
  VALUES (
    draft.id,
    next_revision_number,
    btrim(new_headline),
    btrim(new_body),
    latest.structure,
    snapshot_asset_ids,
    latest.voice_asset_path,
    latest.transcript,
    encode(digest(canonical_content::TEXT, 'sha256'), 'hex')
  )
  RETURNING id INTO new_revision_id;

  UPDATE consent_requests
     SET revision_id = new_revision_id
   WHERE id = request.id;

  RETURN QUERY SELECT new_revision_id, next_revision_number;
END;
$$;

REVOKE ALL ON FUNCTION public.create_dater_revision(UUID, TEXT, TEXT, UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_dater_revision(UUID, TEXT, TEXT, UUID[])
  TO authenticated;

-- CP-1: audience policy, location precision, and free duration choice.
CREATE FUNCTION public.set_publish_preferences(
  draft_id UUID,
  audience JSONB DEFAULT NULL,
  target_location_precision TEXT DEFAULT 'city',
  target_publish_days INTEGER DEFAULT 14
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  caller UUID := auth.uid();
  min_age INTEGER;
  max_age INTEGER;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;
  PERFORM private.assert_active_account(caller);

  IF target_publish_days NOT IN (7, 14) THEN
    RAISE EXCEPTION 'free campaigns run for 7 or 14 days';
  END IF;
  IF target_location_precision NOT IN ('city', 'region', 'hidden') THEN
    RAISE EXCEPTION 'location precision must be city, region, or hidden';
  END IF;

  IF audience IS NOT NULL THEN
    IF jsonb_typeof(audience) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'audience policy must be an object';
    END IF;
    min_age := coalesce((audience ->> 'min_age')::INTEGER, 18);
    max_age := (audience ->> 'max_age')::INTEGER;
    IF min_age < 18 THEN
      RAISE EXCEPTION 'audience minimum age cannot be under 18';
    END IF;
    IF max_age IS NOT NULL AND max_age < min_age THEN
      RAISE EXCEPTION 'audience maximum age cannot be below the minimum';
    END IF;
    IF audience ? 'intents'
       AND jsonb_typeof(audience -> 'intents') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'audience intents must be an array';
    END IF;
  END IF;

  UPDATE pitch_drafts
     SET audience_policy = audience,
         location_precision = target_location_precision,
         publish_days = target_publish_days
   WHERE id = draft_id
     AND subject_user_id = caller
     AND status = 'consent_pending';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'draft not found, not yours to configure, or not in consent review';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.set_publish_preferences(UUID, JSONB, TEXT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_publish_preferences(UUID, JSONB, TEXT, INTEGER)
  TO authenticated;

-- Publish the exact reviewed snapshot plus the stored preferences. Same
-- signature as 0017; campaign_days now accepts the dater's 7-day choice
-- and must match the stored preference when one was set.
CREATE OR REPLACE FUNCTION public.approve_and_publish_pitch(
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

  IF campaign_days IS NULL OR campaign_days NOT IN (7, 14) THEN
    RAISE EXCEPTION 'campaign_days must be 7 or 14';
  END IF;
  IF included_asset_ids IS NULL OR coalesce(array_length(included_asset_ids, 1), 0) < 1 THEN
    RAISE EXCEPTION 'publishing requires at least one approved photo';
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
  IF draft.publish_days IS NOT NULL AND draft.publish_days IS DISTINCT FROM campaign_days THEN
    RAISE EXCEPTION 'campaign_days must match the configured publish preference';
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

  INSERT INTO campaigns (
    pitch_draft_id, owner_user_id, status, published_at, slug, ends_at,
    audience_policy, location_precision
  )
  VALUES (
    draft.id, caller, 'published', now(), new_slug,
    now() + make_interval(days => campaign_days),
    draft.audience_policy, coalesce(draft.location_precision, 'city')
  )
  ON CONFLICT (pitch_draft_id) DO UPDATE
    SET status = 'published',
        published_at = now(),
        slug = coalesce(campaigns.slug, EXCLUDED.slug),
        ends_at = EXCLUDED.ends_at,
        audience_policy = EXCLUDED.audience_policy,
        location_precision = EXCLUDED.location_precision
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

-- Audience policy enforcement at the interest boundary (server-side).
CREATE FUNCTION private.enforce_campaign_audience_policy()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  policy JSONB;
  min_age INTEGER;
  max_age INTEGER;
  sender_birth_date DATE;
  sender_age INTEGER;
  sender_intent TEXT;
BEGIN
  SELECT audience_policy INTO policy
    FROM public.campaigns
   WHERE id = NEW.campaign_id;
  IF policy IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT birth_date INTO sender_birth_date
    FROM public.profiles
   WHERE user_id = NEW.sender_user_id;
  min_age := coalesce((policy ->> 'min_age')::INTEGER, 18);
  max_age := (policy ->> 'max_age')::INTEGER;
  IF sender_birth_date IS NULL THEN
    RAISE EXCEPTION 'this campaign has an audience policy that needs your profile age';
  END IF;
  sender_age := date_part('year', age(sender_birth_date))::INTEGER;
  IF sender_age < min_age OR (max_age IS NOT NULL AND sender_age > max_age) THEN
    RAISE EXCEPTION 'this campaign accepts interest from a different age range';
  END IF;

  IF jsonb_typeof(policy -> 'intents') = 'array'
     AND jsonb_array_length(policy -> 'intents') > 0 THEN
    SELECT dating_intent INTO sender_intent
      FROM public.dating_profiles
     WHERE user_id = NEW.sender_user_id;
    IF sender_intent IS NULL
       OR NOT (policy -> 'intents') ? sender_intent THEN
      RAISE EXCEPTION 'this campaign accepts interest with a different dating intent';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.enforce_campaign_audience_policy() FROM PUBLIC;

CREATE TRIGGER interests_audience_gate
BEFORE INSERT ON public.interests
FOR EACH ROW EXECUTE FUNCTION private.enforce_campaign_audience_policy();
