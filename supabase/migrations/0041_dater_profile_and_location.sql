-- Third audit CP-1 (Slice 6): the Dater confirms their own age, structured
-- approximate location, and dating intent during consent — and the public
-- pitch shows a canonical location where region precision drops the city.
--
-- Before this migration `dating_profiles.approximate_location` was a single
-- free-form string, so `location_precision='region'` and `'city'` returned
-- the identical value. We add structured region/city columns and derive the
-- canonical string from them in the read model (publishedPitchRepo). Writes to
-- the structured columns flow only through the SECURITY DEFINER RPC below —
-- authenticated roles get no direct column grant — so precision can never be
-- bypassed by tampering with the raw string.
--
-- Age is derived from `profiles.birth_date` (the same column the audience gate
-- reads for interest senders); the raw birth date is never exposed publicly.

ALTER TABLE public.dating_profiles
  ADD COLUMN location_region TEXT,
  ADD COLUMN location_city TEXT,
  ADD CONSTRAINT dating_profiles_location_region_length
    CHECK (location_region IS NULL OR char_length(location_region) <= 80) NOT VALID,
  ADD CONSTRAINT dating_profiles_location_city_length
    CHECK (location_city IS NULL OR char_length(location_city) <= 80) NOT VALID;

-- CP-1: the claimed Dater confirms their own profile inputs. One authenticated
-- RPC validates adulthood (18+), a required region, an optional city, and a
-- controlled dating intent, then writes birth_date to profiles and the
-- structured location + intent to dating_profiles. It only ever touches the
-- caller's own rows (auth.uid()), so it needs no draft scoping.
CREATE FUNCTION public.set_dater_profile(
  target_birth_date DATE,
  target_region TEXT,
  target_city TEXT DEFAULT NULL,
  target_intent TEXT DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  caller UUID := auth.uid();
  clean_region TEXT;
  clean_city TEXT;
  computed_age INTEGER;
  canonical_location TEXT;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;
  PERFORM private.assert_active_account(caller);

  IF target_birth_date IS NULL THEN
    RAISE EXCEPTION 'birth date is required';
  END IF;
  IF target_birth_date > current_date THEN
    RAISE EXCEPTION 'birth date cannot be in the future';
  END IF;
  computed_age := date_part('year', age(target_birth_date))::INTEGER;
  IF computed_age < 18 THEN
    RAISE EXCEPTION 'you must be at least 18 to publish a pitch';
  END IF;
  IF computed_age > 120 THEN
    RAISE EXCEPTION 'birth date is out of range';
  END IF;

  clean_region := nullif(btrim(target_region), '');
  IF clean_region IS NULL THEN
    RAISE EXCEPTION 'region is required';
  END IF;
  IF char_length(clean_region) > 80 THEN
    RAISE EXCEPTION 'region is too long';
  END IF;

  clean_city := nullif(btrim(target_city), '');
  IF clean_city IS NOT NULL AND char_length(clean_city) > 80 THEN
    RAISE EXCEPTION 'city is too long';
  END IF;

  IF target_intent IS NULL
     OR target_intent NOT IN ('long-term', 'open-to-either', 'short-term') THEN
    RAISE EXCEPTION 'dating intent must be long-term, open-to-either, or short-term';
  END IF;

  canonical_location :=
    CASE WHEN clean_city IS NULL THEN clean_region
         ELSE clean_city || ', ' || clean_region END;

  UPDATE public.profiles
     SET birth_date = target_birth_date,
         updated_at = now()
   WHERE user_id = caller;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile not found for the caller';
  END IF;

  INSERT INTO public.dating_profiles AS dp (
    user_id, dating_intent, approximate_location, location_region, location_city
  )
  VALUES (caller, target_intent, canonical_location, clean_region, clean_city)
  ON CONFLICT (user_id) DO UPDATE
     SET dating_intent = EXCLUDED.dating_intent,
         approximate_location = EXCLUDED.approximate_location,
         location_region = EXCLUDED.location_region,
         location_city = EXCLUDED.location_city,
         profile_updated_at = now(),
         updated_at = now();
END;
$$;

REVOKE ALL ON FUNCTION
  public.set_dater_profile(DATE, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  public.set_dater_profile(DATE, TEXT, TEXT, TEXT) TO authenticated;

-- Deletion policy: the structured columns live on dating_profiles, which is
-- `ON DELETE CASCADE` from users (0001), so account deletion drops them with
-- the rest of the profile — same lifecycle as approximate_location. RLS is
-- unchanged: dating_profiles remains owner-select-only, and the new columns
-- carry no authenticated INSERT/UPDATE grant, so they can be written only
-- through this definer RPC.

-- ── Hardening (Advisor c10/0036 review): preserve the introducer voice ──
-- create_dater_revision snapshots exactly the assets the client lists, and
-- approve_and_publish_pitch later deletes any asset absent from that snapshot.
-- A photos-only client list therefore drops the introducer's original voice
-- asset and approval erases it — a competitive-boundary violation (CLAUDE.md
-- §8). Fix: the explicit-list path auto-includes every voice asset of the
-- draft. Full redefinition copied from 0036 (latest), with the ELSE branch
-- modified; all other behavior (media/text gates, dater_edited, snapshot) is
-- byte-identical to 0036.
CREATE OR REPLACE FUNCTION public.create_dater_revision(
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
  is_dater_edited BOOLEAN;
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
    -- Auto-include the introducer's voice asset(s) so a photos-only list can
    -- never drop the original voice and have approval delete the row.
    SELECT coalesce(array_agg(DISTINCT merged_id ORDER BY merged_id), ARRAY[]::UUID[])
      INTO snapshot_asset_ids
      FROM (
        SELECT candidate_id AS merged_id FROM unnest(included_asset_ids) candidate_id
        UNION
        SELECT id AS merged_id
          FROM pitch_assets
         WHERE pitch_draft_id = draft.id
           AND asset_type = 'voice'
      ) merged;
  END IF;

  IF private.media_validation_enforcement() THEN
    IF NOT private.pitch_photos_validated(snapshot_asset_ids) THEN
      RAISE EXCEPTION 'photos must pass validation before they can enter a revision';
    END IF;
    IF NOT private.text_moderation_passed(
      'pitch_content',
      coalesce(new_headline, '') || E'\n\n' || coalesce(new_body, '')
    ) THEN
      RAISE EXCEPTION 'pitch text requires a passed moderation verdict';
    END IF;
  END IF;

  is_dater_edited := (btrim(new_headline) IS DISTINCT FROM btrim(latest.headline))
    OR (btrim(new_body) IS DISTINCT FROM btrim(latest.body));

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
    content_hash,
    dater_edited
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
    encode(digest(canonical_content::TEXT, 'sha256'), 'hex'),
    is_dater_edited
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

-- ── Adult-only publishing gate (CP-1, durable) ──────────────────────────
-- set_dater_profile validates 18+, but profiles.birth_date also carries a
-- pre-existing direct authenticated UPDATE grant (0002) that the interest
-- sender age flow relies on — so the 18+ check can't live only in that RPC.
-- Enforce it at approval too, so a direct birth_date write can never publish
-- an under-18 dater. Full redefinition copied from 0036 (latest), with only
-- the age assertion added right after the active-account guard.
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
  dater_birth_date DATE;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;
  PERFORM private.assert_active_account(caller);

  -- CP-1: publishing is adults-only. The dater's confirmed birth date must
  -- put them at 18+. Enforced here (not only in set_dater_profile) because a
  -- direct birth_date write must never bypass the gate.
  SELECT birth_date INTO dater_birth_date FROM profiles WHERE user_id = caller;
  IF dater_birth_date IS NULL
     OR date_part('year', age(dater_birth_date))::INTEGER < 18 THEN
    RAISE EXCEPTION 'confirm an adult (18+) birth date before publishing';
  END IF;

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

  IF private.media_validation_enforcement()
     AND NOT private.pitch_photos_validated(included_asset_ids) THEN
    RAISE EXCEPTION 'included photos must pass validation before publish';
  END IF;

  IF (
    coalesce(
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
    ) > 0
    OR approved_revision.dater_edited
  ) AND hard_claims_confirmed IS NOT TRUE THEN
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
         transcript = approved_revision.transcript,
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
