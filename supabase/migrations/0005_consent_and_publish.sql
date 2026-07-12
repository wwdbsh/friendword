-- Flow B server side: a dater claims the consent invitation with the raw
-- token, reviews, then approves & publishes. All transitions stay behind
-- SECURITY DEFINER RPCs — clients still hold no status/subject grants.

ALTER TABLE campaigns ADD COLUMN slug TEXT UNIQUE;

CREATE FUNCTION private.consent_request_by_token(raw_token TEXT)
RETURNS consent_requests
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
  SELECT *
    FROM consent_requests
   WHERE token_hash = encode(digest(raw_token, 'sha256'), 'hex')
   LIMIT 1;
$$;

REVOKE ALL ON FUNCTION private.consent_request_by_token(TEXT) FROM PUBLIC;

-- Anonymous-safe preview: just enough for the dater to recognize the invite
-- (who is introducing, relationship context). No photos, audio, or contact.
CREATE FUNCTION public.get_consent_preview(raw_token TEXT)
RETURNS TABLE (
  introducer_display_name TEXT,
  relationship_type TEXT,
  relationship_duration TEXT,
  request_status TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  request consent_requests;
BEGIN
  request := private.consent_request_by_token(raw_token);
  IF request.id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT p.display_name,
         d.relationship_type,
         d.relationship_duration,
         request.status
    FROM pitch_drafts d
    JOIN profiles p ON p.user_id = d.created_by_user_id
   WHERE d.id = request.pitch_draft_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_consent_preview(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_consent_preview(TEXT) TO anon, authenticated;

CREATE FUNCTION public.claim_consent_request(raw_token TEXT)
RETURNS TABLE (pitch_draft_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  caller UUID := auth.uid();
  request consent_requests;
  draft pitch_drafts;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;

  request := private.consent_request_by_token(raw_token);
  IF request.id IS NULL OR request.status NOT IN ('pending', 'claimed') THEN
    RAISE EXCEPTION 'consent request not found or no longer claimable';
  END IF;

  SELECT * INTO draft FROM pitch_drafts WHERE id = request.pitch_draft_id FOR UPDATE;

  -- The introducer cannot approve their own pitch as its subject.
  IF draft.created_by_user_id = caller THEN
    RAISE EXCEPTION 'introducer cannot claim their own consent request';
  END IF;

  -- A different signed-in user than the already-linked subject is rejected.
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

CREATE FUNCTION private.generate_campaign_slug(base_name TEXT)
RETURNS TEXT
LANGUAGE sql
VOLATILE
SET search_path = public, extensions, pg_temp
AS $$
  SELECT lower(regexp_replace(coalesce(nullif(base_name, ''), 'friend'), '[^a-zA-Z0-9]+', '', 'g'))
         || '-'
         || lower(substr(replace(replace(encode(gen_random_bytes(6), 'base64'), '+', 'x'), '/', 'y'), 1, 6));
$$;

REVOKE ALL ON FUNCTION private.generate_campaign_slug(TEXT) FROM PUBLIC;

CREATE FUNCTION public.approve_and_publish_pitch(draft_id UUID)
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

  -- Order matters: the 0001 publication trigger verifies that the pitch is
  -- published AND its consent request is approved before a campaign row may
  -- carry status 'published'.
  UPDATE pitch_drafts SET status = 'published' WHERE id = draft.id;

  UPDATE consent_requests
     SET status = 'approved', responded_at = now()
   WHERE pitch_draft_id = draft.id AND subject_user_id = caller;

  -- A draft-status campaign row may already exist for this pitch; publish it
  -- in place. Ownership may never move to a different account here.
  INSERT INTO campaigns (pitch_draft_id, owner_user_id, status, published_at, slug)
  VALUES (draft.id, caller, 'published', now(), new_slug)
  ON CONFLICT (pitch_draft_id) DO UPDATE
    SET status = 'published',
        published_at = now(),
        slug = COALESCE(campaigns.slug, EXCLUDED.slug)
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

REVOKE ALL ON FUNCTION public.approve_and_publish_pitch(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_and_publish_pitch(UUID) TO authenticated;
