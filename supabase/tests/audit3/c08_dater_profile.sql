-- AUDIT3 REGRESSION: 3차 감사 CP-1 (Slice 6) — the Dater confirms their own
-- age (18+), a structured approximate location (region required, city
-- optional), and a controlled dating intent through one SECURITY DEFINER RPC.
-- The structured location columns are RPC-only (no authenticated column
-- grant), so location precision can't be bypassed by writing the raw string.
--
-- red-first: before migration 0041 there is no public.set_dater_profile and no
-- dating_profiles.location_region/location_city columns, so every call and
-- column reference below errors out — the whole file is RED.
BEGIN;

DO $$
DECLARE
  failures TEXT[] := ARRAY[]::TEXT[];
  ok BOOLEAN;
  reported TEXT;
  dater CONSTANT UUID := '00000000-0000-0000-0000-000000000002';
  stored_birth DATE;
  stored_region TEXT;
  stored_city TEXT;
  stored_intent TEXT;
  stored_location TEXT;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', dater::text, true);

  -- ── (A) Under-18 birth date is rejected ──────────────────────────────
  ok := false; reported := NULL;
  BEGIN
    PERFORM public.set_dater_profile((current_date - INTERVAL '17 years')::date, 'Puget Sound', 'Seattle', 'long-term');
  EXCEPTION WHEN OTHERS THEN ok := true; reported := SQLERRM;
  END;
  IF NOT ok THEN
    failures := array_append(failures, 'an under-18 birth date was accepted');
  ELSIF reported NOT LIKE '%at least 18%' THEN
    failures := array_append(failures, 'under-18 reject wrong reason: ' || reported);
  END IF;

  -- ── (B) Missing region is rejected ───────────────────────────────────
  ok := false; reported := NULL;
  BEGIN
    PERFORM public.set_dater_profile(DATE '1994-05-20', '   ', 'Seattle', 'long-term');
  EXCEPTION WHEN OTHERS THEN ok := true; reported := SQLERRM;
  END;
  IF NOT ok THEN
    failures := array_append(failures, 'a blank region was accepted');
  ELSIF reported NOT LIKE '%region is required%' THEN
    failures := array_append(failures, 'blank-region reject wrong reason: ' || reported);
  END IF;

  -- ── (C) Unknown dating intent is rejected ────────────────────────────
  ok := false; reported := NULL;
  BEGIN
    PERFORM public.set_dater_profile(DATE '1994-05-20', 'Puget Sound', 'Seattle', 'situationship');
  EXCEPTION WHEN OTHERS THEN ok := true; reported := SQLERRM;
  END;
  IF NOT ok THEN
    failures := array_append(failures, 'an unknown dating intent was accepted');
  ELSIF reported NOT LIKE '%dating intent must be%' THEN
    failures := array_append(failures, 'bad-intent reject wrong reason: ' || reported);
  END IF;

  -- ── (D) A future birth date is rejected ──────────────────────────────
  ok := false; reported := NULL;
  BEGIN
    PERFORM public.set_dater_profile((current_date + INTERVAL '1 day')::date, 'Puget Sound', NULL, 'short-term');
  EXCEPTION WHEN OTHERS THEN ok := true; reported := SQLERRM;
  END;
  IF NOT ok THEN
    failures := array_append(failures, 'a future birth date was accepted');
  ELSIF reported NOT LIKE '%future%' THEN
    failures := array_append(failures, 'future-date reject wrong reason: ' || reported);
  END IF;

  -- ── (E) Happy path: birth date, structured location, and intent persist
  PERFORM public.set_dater_profile(DATE '1994-05-20', '  Puget Sound  ', '  Seattle  ', 'long-term');
  SELECT birth_date INTO stored_birth FROM public.profiles WHERE user_id = dater;
  SELECT location_region, location_city, dating_intent, approximate_location
    INTO stored_region, stored_city, stored_intent, stored_location
    FROM public.dating_profiles WHERE user_id = dater;
  IF stored_birth IS DISTINCT FROM DATE '1994-05-20' THEN
    failures := array_append(failures, 'birth date was not stored on the profile');
  END IF;
  IF stored_region IS DISTINCT FROM 'Puget Sound' THEN
    failures := array_append(failures, 'region was not trimmed/stored: ' || coalesce(stored_region, '<null>'));
  END IF;
  IF stored_city IS DISTINCT FROM 'Seattle' THEN
    failures := array_append(failures, 'city was not trimmed/stored: ' || coalesce(stored_city, '<null>'));
  END IF;
  IF stored_intent IS DISTINCT FROM 'long-term' THEN
    failures := array_append(failures, 'dating intent was not stored');
  END IF;
  IF stored_location IS DISTINCT FROM 'Seattle, Puget Sound' THEN
    failures := array_append(failures, 'canonical approximate_location wrong: ' || coalesce(stored_location, '<null>'));
  END IF;

  -- ── (F) Region-only (no city) collapses to the region string ─────────
  PERFORM public.set_dater_profile(DATE '1990-01-01', 'Bay Area', NULL, 'open-to-either');
  SELECT location_region, location_city, approximate_location
    INTO stored_region, stored_city, stored_location
    FROM public.dating_profiles WHERE user_id = dater;
  IF stored_region IS DISTINCT FROM 'Bay Area' OR stored_city IS NOT NULL THEN
    failures := array_append(failures, 'region-only update did not clear the city');
  END IF;
  IF stored_location IS DISTINCT FROM 'Bay Area' THEN
    failures := array_append(failures, 'region-only canonical location wrong: ' || coalesce(stored_location, '<null>'));
  END IF;

  -- ── (G) Unauthenticated callers are rejected ─────────────────────────
  PERFORM set_config('request.jwt.claim.sub', '', true);
  ok := false; reported := NULL;
  BEGIN
    PERFORM public.set_dater_profile(DATE '1994-05-20', 'Puget Sound', 'Seattle', 'long-term');
  EXCEPTION WHEN OTHERS THEN ok := true; reported := SQLERRM;
  END;
  IF NOT ok THEN
    failures := array_append(failures, 'an unauthenticated caller set a dater profile');
  ELSIF reported NOT LIKE '%authentication required%' THEN
    failures := array_append(failures, 'unauthenticated reject wrong reason: ' || reported);
  END IF;

  -- ── (H) Structured location columns are RPC-only (no direct grant) ────
  IF has_column_privilege('authenticated', 'public.dating_profiles', 'location_region', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.dating_profiles', 'location_city', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.dating_profiles', 'location_region', 'INSERT')
     OR has_column_privilege('authenticated', 'public.dating_profiles', 'location_city', 'INSERT') THEN
    failures := array_append(failures,
      'authenticated has a direct write grant on a structured location column');
  END IF;

  IF cardinality(failures) > 0 THEN
    RAISE EXCEPTION 'AUDIT3-DATER-PROFILE: %', array_to_string(failures, '; ');
  END IF;
END;
$$;

ROLLBACK;

-- ── Voice preservation (Advisor c10/0036 review hardening) ───────────────
-- create_dater_revision snapshots exactly the client's asset list and
-- approve_and_publish_pitch deletes assets absent from that snapshot. A
-- photos-only list must NOT drop the introducer's original voice (CLAUDE.md
-- §8). red-first: before 0041, a photos-only revision + approve deletes the
-- voice pitch_assets row.
BEGIN;

UPDATE public.app_config SET value = 'off' WHERE key = 'media_validation_enforcement';

INSERT INTO public.pitch_drafts (
  id, created_by_user_id, subject_user_id, status, headline, body, transcript
) VALUES (
  'c0800000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002',
  'consent_pending',
  'Introducer headline',
  'Introducer body the dater keeps as-is.',
  '{"text": "Voice must survive.", "segments": []}'::JSONB
);

INSERT INTO public.pitch_assets (
  id, pitch_draft_id, uploaded_by_user_id, asset_type, storage_path, sort_order
) VALUES
  (
    'c0800000-0000-0000-0000-000000000201',
    'c0800000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    'voice',
    'pitch-media/c0800000-0000-0000-0000-000000000001/voice.m4a',
    0
  ),
  (
    'c0800000-0000-0000-0000-000000000202',
    'c0800000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    'photo',
    'pitch-media/c0800000-0000-0000-0000-000000000001/photo-1.jpg',
    1
  ),
  (
    'c0800000-0000-0000-0000-000000000203',
    'c0800000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    'photo',
    'pitch-media/c0800000-0000-0000-0000-000000000001/photo-2.jpg',
    2
  );

INSERT INTO public.consent_revisions (
  id, pitch_draft_id, revision_number, headline, body, structure,
  asset_ids, voice_asset_path, content_hash
) VALUES (
  'c0800000-0000-0000-0000-000000000301',
  'c0800000-0000-0000-0000-000000000001',
  1,
  'Introducer headline',
  'Introducer body the dater keeps as-is.',
  NULL,
  ARRAY[
    'c0800000-0000-0000-0000-000000000201',
    'c0800000-0000-0000-0000-000000000202',
    'c0800000-0000-0000-0000-000000000203'
  ]::UUID[],
  'pitch-media/c0800000-0000-0000-0000-000000000001/voice.m4a',
  'c08-voice-hash-1'
);

INSERT INTO public.consent_requests (
  id, pitch_draft_id, subject_user_id, token_hash, status, revision_id,
  invite_contact_channel, invite_contact_hash
) VALUES (
  'c0800000-0000-0000-0000-000000000401',
  'c0800000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002',
  encode(digest('c08-voice-token', 'sha256'), 'hex'),
  'claimed',
  'c0800000-0000-0000-0000-000000000301',
  'email',
  encode(digest('c08-voice-dater@example.test', 'sha256'), 'hex')
);

-- One published/paused campaign per owner (0039): archive the dater's seed
-- campaign before this publish.
UPDATE campaigns SET status = 'archived'
 WHERE owner_user_id = '00000000-0000-0000-0000-000000000002'
   AND status IN ('published', 'paused');

DO $$
DECLARE
  failures TEXT[] := ARRAY[]::TEXT[];
  draft CONSTANT UUID := 'c0800000-0000-0000-0000-000000000001';
  dater CONSTANT UUID := '00000000-0000-0000-0000-000000000002';
  voice_asset CONSTANT UUID := 'c0800000-0000-0000-0000-000000000201';
  photo1 CONSTANT UUID := 'c0800000-0000-0000-0000-000000000202';
  photo2 CONSTANT UUID := 'c0800000-0000-0000-0000-000000000203';
  rev2 UUID;
  rev2_assets UUID[];
  slug TEXT;
  voice_survives BOOLEAN;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', dater::text, true);

  -- Cut a revision with a PHOTOS-ONLY list (the voice asset is omitted).
  SELECT revision_id INTO rev2
    FROM public.create_dater_revision(
      draft, 'Introducer headline', 'Introducer body the dater keeps as-is.',
      ARRAY[photo1, photo2]
    );
  IF rev2 IS NULL THEN
    failures := array_append(failures, 'photos-only revision was rejected');
  ELSE
    SELECT asset_ids INTO rev2_assets FROM public.consent_revisions WHERE id = rev2;
    IF NOT (voice_asset = ANY(rev2_assets)) THEN
      failures := array_append(failures,
        'voice asset was dropped from a photos-only revision snapshot');
    END IF;
  END IF;

  -- Approve with the same photos-only inclusion; the voice row must survive.
  SELECT campaign_slug INTO slug
    FROM public.approve_and_publish_pitch(
      draft, 14, rev2, ARRAY[photo1, photo2], true
    );
  IF slug IS NULL THEN
    failures := array_append(failures, 'approve returned no slug');
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.pitch_assets WHERE id = voice_asset
  ) INTO voice_survives;
  IF NOT voice_survives THEN
    failures := array_append(failures,
      'introducer voice asset was deleted at publish (competitive-boundary violation)');
  END IF;

  IF cardinality(failures) > 0 THEN
    RAISE EXCEPTION 'AUDIT3-DATER-VOICE: %', array_to_string(failures, '; ');
  END IF;
END;
$$;

ROLLBACK;

SELECT 'c08_dater_profile.sql passed' AS result;
