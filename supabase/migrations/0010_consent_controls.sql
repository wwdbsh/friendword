-- Consent deepening: the dater controls which suggested photos publish and
-- how long the campaign stays up. Approve now stamps ends_at; expired pages
-- refuse interest, and the public reader filters them out.

ALTER TABLE campaigns ADD COLUMN ends_at TIMESTAMPTZ;

-- The claimed subject removes a suggested photo before approving. Voice is
-- the product's core artifact and cannot be excluded — declining the pitch
-- is simply not approving it.
CREATE FUNCTION public.exclude_pitch_asset(target_asset_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  caller UUID := auth.uid();
  asset pitch_assets;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;

  SELECT a.* INTO asset
    FROM pitch_assets a
    JOIN pitch_drafts d ON d.id = a.pitch_draft_id
   WHERE a.id = target_asset_id
     AND d.subject_user_id = caller
     AND d.status = 'consent_pending'
     FOR UPDATE OF a;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'asset not found, not yours to review, or already published';
  END IF;

  IF asset.asset_type <> 'photo' THEN
    RAISE EXCEPTION 'only photos can be excluded';
  END IF;

  DELETE FROM pitch_assets WHERE id = asset.id;
END;
$$;

REVOKE ALL ON FUNCTION public.exclude_pitch_asset(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.exclude_pitch_asset(UUID) TO authenticated;

-- Approve now takes the dater's chosen visibility window (days). Replaces
-- the 0005 single-argument function; existing single-argument calls keep
-- working through the default.
DROP FUNCTION public.approve_and_publish_pitch(UUID);

CREATE FUNCTION public.approve_and_publish_pitch(draft_id UUID, campaign_days INTEGER DEFAULT 30)
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

-- Interest also respects the visibility window.
CREATE OR REPLACE FUNCTION public.submit_interest(target_campaign_id UUID, interest_note TEXT DEFAULT NULL)
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
