-- Motion pitch Phase 1 (migration 0048): the approved consent snapshot carries
-- the scene timeline, the database owns the references/hash/immutability, and
-- the mechanical safety floor is enforced server-side.
--
-- red-first: on 0047 neither RPC accepts a scene argument, consent_revisions has
-- no scene_definition column, and private.assert_scene_definition does not
-- exist, so the pin block at the top of this file raises immediately and every
-- probe below fails.
--
-- The rejection strings asserted here are a contract: the web and mobile clients
-- map them to Dater-facing copy, so a message change is a product change.

BEGIN;

DO $$
BEGIN
  IF to_regprocedure(
    'public.submit_pitch_for_consent(uuid,text,text,text,jsonb)'
  ) IS NULL THEN
    RAISE EXCEPTION
      'D24: submit_pitch_for_consent(uuid,text,text,text,jsonb) RPC missing';
  END IF;
  IF to_regprocedure(
    'public.create_dater_revision(uuid,text,text,uuid[],jsonb,text[],jsonb)'
  ) IS NULL THEN
    RAISE EXCEPTION
      'D24: create_dater_revision(uuid,text,text,uuid[],jsonb,text[],jsonb) RPC missing';
  END IF;
  -- 0049 widened the validator's argument list (a v2 scene references a
  -- transcript word and a structure field) and 0050 widened it again (a v3 clip
  -- shot references a video asset whose ingest succeeded). The v1 rules this
  -- suite pins are unchanged behind both.
  IF to_regprocedure(
    'private.assert_scene_definition(jsonb,integer,uuid[],jsonb,jsonb,uuid[])'
  ) IS NULL THEN
    RAISE EXCEPTION
      'D24: private.assert_scene_definition(jsonb,integer,uuid[],jsonb,jsonb,uuid[]) missing';
  END IF;
  IF to_regprocedure('private.pitch_transcript_duration_ms(jsonb)') IS NULL THEN
    RAISE EXCEPTION 'D24: private.pitch_transcript_duration_ms(jsonb) missing';
  END IF;
  IF (
    SELECT count(*) FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'consent_revisions'
       AND column_name IN ('scene_definition', 'scene_hash')
  ) <> 2 THEN
    RAISE EXCEPTION 'D24: consent_revisions is missing scene_definition/scene_hash';
  END IF;
  IF (
    SELECT count(*) FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'pitch_drafts'
       AND column_name IN ('scene_definition', 'scene_hash')
  ) <> 2 THEN
    RAISE EXCEPTION 'D24: pitch_drafts is missing scene_definition/scene_hash';
  END IF;
  IF (
    SELECT count(*) FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'pitch_assets'
       AND column_name IN ('width', 'height')
  ) <> 2 THEN
    RAISE EXCEPTION 'D24: pitch_assets is missing width/height';
  END IF;
END;
$$;

CREATE TEMP TABLE d24_state (key TEXT PRIMARY KEY, text_value TEXT, uuid_value UUID);

-- ── Fixture ─────────────────────────────────────────────────────────────
-- Introducer Alex (0001) pitches Blair (0002). The transcript segments are the
-- only authority for how long the pitch runs: the last one ends at 8s, so every
-- accepted scene must cover exactly [0, 8000].
INSERT INTO public.pitch_drafts (
  id, created_by_user_id, status, headline, body, transcript
) VALUES (
  '24000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  'draft',
  'Meet my friend Blair',
  'Blair is kind, curious, and always cooking.',
  '{"text": "Blair is kind and curious and always cooking.",
    "language": "en",
    "segments": [
      {"start": 0, "end": 2.5, "text": "Blair is kind"},
      {"start": 2.5, "end": 5.25, "text": "and curious"},
      {"start": 5.25, "end": 8, "text": "and always cooking"}
    ]}'::JSONB
);

-- A second draft: its photo is the "asset from another pitch" probe, and its
-- empty segment list is the "no motion is possible" probe.
INSERT INTO public.pitch_drafts (
  id, created_by_user_id, status, headline, body, transcript
) VALUES (
  '24000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000001',
  'draft',
  'A pitch with no segments',
  'Nothing here can carry motion.',
  '{"text": "unsegmented", "language": "en", "segments": []}'::JSONB
);

INSERT INTO public.pitch_assets (
  id, pitch_draft_id, uploaded_by_user_id, asset_type, storage_path, sort_order,
  width, height
) VALUES
  (
    '24000000-0000-0000-0000-000000000201',
    '24000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    'voice',
    'pitch-media/24000000-0000-0000-0000-000000000001/voice.m4a',
    0, NULL, NULL
  ),
  (
    '24000000-0000-0000-0000-000000000211',
    '24000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    'photo',
    'pitch-media/24000000-0000-0000-0000-000000000001/photo-1.jpg',
    1, 1200, 1600
  ),
  (
    '24000000-0000-0000-0000-000000000212',
    '24000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    'photo',
    'pitch-media/24000000-0000-0000-0000-000000000001/photo-2.jpg',
    2, 1600, 1200
  ),
  (
    '24000000-0000-0000-0000-000000000213',
    '24000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    'photo',
    'pitch-media/24000000-0000-0000-0000-000000000001/photo-3.jpg',
    3, NULL, NULL
  ),
  (
    '24000000-0000-0000-0000-000000000221',
    '24000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000001',
    'photo',
    'pitch-media/24000000-0000-0000-0000-000000000002/photo-1.jpg',
    1, NULL, NULL
  );

-- One active campaign per owner (0039): Blair owns the seed campaign, so retire
-- it before this suite publishes its own.
UPDATE public.campaigns SET status = 'archived'
 WHERE owner_user_id = '00000000-0000-0000-0000-000000000002'
   AND status IN ('published', 'paused');

-- ── Probe helpers ───────────────────────────────────────────────────────
CREATE FUNCTION pg_temp.scene(duration_ms INTEGER, entries JSONB)
RETURNS JSONB
LANGUAGE sql
AS $$
  SELECT jsonb_build_object(
    'schemaVersion', 1,
    'canvas', jsonb_build_object('width', 1080, 'height', 1920, 'fps', 30),
    'durationMs', duration_ms,
    'scenes', entries
  );
$$;

CREATE FUNCTION pg_temp.entry(asset UUID, start_ms INTEGER, end_ms INTEGER)
RETURNS JSONB
LANGUAGE sql
AS $$
  SELECT jsonb_build_object('assetId', asset, 'startMs', start_ms, 'endMs', end_ms);
$$;

-- Returns the rejection message, or NULL when the RPC accepted the scene. The
-- sentinel raise rolls the subtransaction back, so probing an accepted scene
-- leaves neither a revision nor a status change behind.
CREATE FUNCTION pg_temp.submit_reject_reason(target_draft UUID, candidate JSONB)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
BEGIN
  BEGIN
    PERFORM * FROM public.submit_pitch_for_consent(
      target_draft, 'email', 'dater@example.test', 'Blair', candidate
    );
    RAISE EXCEPTION 'D24-ACCEPTED';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'D24-ACCEPTED' THEN
      RETURN NULL;
    END IF;
    RETURN SQLERRM;
  END;
END;
$$;

CREATE FUNCTION pg_temp.revision_reject_reason(
  target_draft UUID,
  included UUID[],
  candidate JSONB
)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
BEGIN
  BEGIN
    PERFORM * FROM public.create_dater_revision(
      target_draft, 'probe headline', 'probe body', included, NULL, NULL, candidate
    );
    RAISE EXCEPTION 'D24-ACCEPTED';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'D24-ACCEPTED' THEN
      RETURN NULL;
    END IF;
    RETURN SQLERRM;
  END;
END;
$$;

CREATE FUNCTION pg_temp.approve_reject_reason(
  target_draft UUID,
  target_revision UUID,
  included UUID[]
)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
BEGIN
  BEGIN
    PERFORM * FROM public.approve_and_publish_pitch(
      target_draft, 14, target_revision, included, true
    );
    RAISE EXCEPTION 'D24-ACCEPTED';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'D24-ACCEPTED' THEN
      RETURN NULL;
    END IF;
    RETURN SQLERRM;
  END;
END;
$$;

-- ── (A) The duration authority ──────────────────────────────────────────
DO $$
DECLARE
  failures TEXT[] := ARRAY[]::TEXT[];
BEGIN
  IF private.pitch_transcript_duration_ms(
       '{"segments": [{"start": 0, "end": 2.5}, {"start": 2.5, "end": 8}]}'::JSONB
     ) IS DISTINCT FROM 8000 THEN
    failures := array_append(failures, 'the last segment end is not the duration');
  END IF;
  IF private.pitch_transcript_duration_ms(
       '{"segments": [{"start": 0, "end": 1.2345}]}'::JSONB
     ) IS DISTINCT FROM 1235 THEN
    failures := array_append(failures, 'the duration is not rounded to the nearest ms');
  END IF;
  IF private.pitch_transcript_duration_ms('{"segments": []}'::JSONB) IS NOT NULL THEN
    failures := array_append(failures, 'an empty segment list produced a duration');
  END IF;
  IF private.pitch_transcript_duration_ms('{"text": "x"}'::JSONB) IS NOT NULL THEN
    failures := array_append(failures, 'a transcript with no segments key produced a duration');
  END IF;
  IF private.pitch_transcript_duration_ms(NULL) IS NOT NULL THEN
    failures := array_append(failures, 'a missing transcript produced a duration');
  END IF;
  IF private.pitch_transcript_duration_ms(
       '{"segments": [{"start": 0, "end": "8"}]}'::JSONB
     ) IS NOT NULL THEN
    failures := array_append(failures, 'a string segment end produced a duration');
  END IF;

  IF array_length(failures, 1) IS NOT NULL THEN
    RAISE EXCEPTION '24_motion_scene duration failures: %', array_to_string(failures, ' | ');
  END IF;
END;
$$;

-- ── (B) What submit accepts and what it refuses ─────────────────────────
DO $$
DECLARE
  failures TEXT[] := ARRAY[]::TEXT[];
  draft CONSTANT UUID := '24000000-0000-0000-0000-000000000001';
  unsegmented CONSTANT UUID := '24000000-0000-0000-0000-000000000002';
  voice CONSTANT UUID := '24000000-0000-0000-0000-000000000201';
  photo_one CONSTANT UUID := '24000000-0000-0000-0000-000000000211';
  photo_two CONSTANT UUID := '24000000-0000-0000-0000-000000000212';
  photo_three CONSTANT UUID := '24000000-0000-0000-0000-000000000213';
  foreign_photo CONSTANT UUID := '24000000-0000-0000-0000-000000000221';
  introducer CONSTANT UUID := '00000000-0000-0000-0000-000000000001';
  valid_scene JSONB;
  reason TEXT;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', introducer::text, true);

  valid_scene := pg_temp.scene(8000, jsonb_build_array(
    pg_temp.entry(photo_one, 0, 2500),
    pg_temp.entry(photo_two, 2500, 5250),
    pg_temp.entry(photo_three, 5250, 8000)
  ));

  -- Positive control: the builder's own shape is accepted, so every refusal
  -- below is about the mutation and not about the fixture.
  reason := pg_temp.submit_reject_reason(draft, valid_scene);
  IF reason IS NOT NULL THEN
    failures := array_append(failures, 'the valid scene was rejected: ' || reason);
  END IF;

  -- Envelope shape. Since 0049 the schemaVersion is a real dispatch key: a
  -- payload claiming 2 is judged by the v2 rules, and a v1 envelope fails their
  -- key check. Since 0050 the same is true of 3, which shares that branch and
  -- names clipAssetIds in its refusal. Every version the database cannot judge
  -- still lands on v1's refusal, which is what 4 below asserts.
  reason := pg_temp.submit_reject_reason(
    draft, jsonb_set(valid_scene, '{schemaVersion}', '2'::JSONB)
  );
  IF reason IS DISTINCT FROM
     'pitch scene must carry only schemaVersion, template, canvas, durationMs, assetIds, shots, look, chrome and overlays' THEN
    failures := array_append(failures,
      'a v1 envelope claiming schemaVersion 2 was not rejected: '
      || coalesce(reason, 'ACCEPTED'));
  END IF;
  reason := pg_temp.submit_reject_reason(
    draft, jsonb_set(valid_scene, '{schemaVersion}', '3'::JSONB)
  );
  IF reason IS DISTINCT FROM
     'pitch scene must carry only schemaVersion, template, canvas, durationMs, assetIds, clipAssetIds, shots, look, chrome and overlays' THEN
    failures := array_append(failures,
      'a v1 envelope claiming schemaVersion 3 was not rejected: '
      || coalesce(reason, 'ACCEPTED'));
  END IF;
  reason := pg_temp.submit_reject_reason(
    draft, jsonb_set(valid_scene, '{schemaVersion}', '4'::JSONB)
  );
  IF reason IS DISTINCT FROM 'pitch scene schemaVersion must be 1' THEN
    failures := array_append(failures,
      'schemaVersion 4 was not rejected: ' || coalesce(reason, 'ACCEPTED'));
  END IF;

  -- An unknown envelope key is refused, not ignored: a tolerated text field
  -- would be a path for unmoderated words onto the public page.
  reason := pg_temp.submit_reject_reason(
    draft, valid_scene || '{"caption": "words nothing moderated"}'::JSONB
  );
  IF reason IS DISTINCT FROM
     'pitch scene must carry only schemaVersion, canvas, durationMs and scenes' THEN
    failures := array_append(failures,
      'an extra envelope key was not rejected: ' || coalesce(reason, 'ACCEPTED'));
  END IF;
  reason := pg_temp.submit_reject_reason(draft, valid_scene - 'canvas');
  IF reason IS DISTINCT FROM
     'pitch scene must carry only schemaVersion, canvas, durationMs and scenes' THEN
    failures := array_append(failures,
      'a missing canvas was not rejected: ' || coalesce(reason, 'ACCEPTED'));
  END IF;

  reason := pg_temp.submit_reject_reason(
    draft, jsonb_set(valid_scene, '{canvas,fps}', '0'::JSONB)
  );
  IF reason IS DISTINCT FROM
     'pitch scene canvas must carry a width, a height and an fps in range' THEN
    failures := array_append(failures,
      'fps 0 was not rejected: ' || coalesce(reason, 'ACCEPTED'));
  END IF;
  reason := pg_temp.submit_reject_reason(
    draft, jsonb_set(valid_scene, '{canvas,width}', '"1080"'::JSONB)
  );
  IF reason IS DISTINCT FROM
     'pitch scene canvas must carry a width, a height and an fps in range' THEN
    failures := array_append(failures,
      'a string canvas width was not rejected: ' || coalesce(reason, 'ACCEPTED'));
  END IF;
  reason := pg_temp.submit_reject_reason(
    draft,
    jsonb_set(valid_scene, '{canvas}', (valid_scene -> 'canvas') || '{"blur": 4}'::JSONB)
  );
  IF reason IS DISTINCT FROM
     'pitch scene canvas must carry a width, a height and an fps in range' THEN
    failures := array_append(failures,
      'an extra canvas key was not rejected: ' || coalesce(reason, 'ACCEPTED'));
  END IF;
  reason := pg_temp.submit_reject_reason(
    draft, jsonb_set(valid_scene, '{canvas}', (valid_scene -> 'canvas') - 'fps')
  );
  IF reason IS DISTINCT FROM
     'pitch scene canvas must carry a width, a height and an fps in range' THEN
    failures := array_append(failures,
      'a canvas with no fps was not rejected: ' || coalesce(reason, 'ACCEPTED'));
  END IF;

  -- Scene entry shape.
  reason := pg_temp.submit_reject_reason(
    draft,
    jsonb_set(
      valid_scene, '{scenes,0}',
      pg_temp.entry(photo_one, 0, 2500) || '{"text": "unmoderated caption"}'::JSONB
    )
  );
  IF reason IS DISTINCT FROM 'pitch scene entry must carry only assetId, startMs and endMs' THEN
    failures := array_append(failures,
      'an extra entry key was not rejected: ' || coalesce(reason, 'ACCEPTED'));
  END IF;
  reason := pg_temp.submit_reject_reason(
    draft, jsonb_set(valid_scene, '{scenes,0,startMs}', '0.5'::JSONB)
  );
  IF reason IS DISTINCT FROM 'pitch scene entry must carry only assetId, startMs and endMs' THEN
    failures := array_append(failures,
      'a fractional startMs was not rejected: ' || coalesce(reason, 'ACCEPTED'));
  END IF;
  reason := pg_temp.submit_reject_reason(
    draft, jsonb_set(valid_scene, '{scenes,0,assetId}', '"not-a-uuid"'::JSONB)
  );
  IF reason IS DISTINCT FROM 'pitch scene entry must carry only assetId, startMs and endMs' THEN
    failures := array_append(failures,
      'a malformed assetId was not rejected: ' || coalesce(reason, 'ACCEPTED'));
  END IF;

  -- Duration must be the transcript's, not the client's.
  reason := pg_temp.submit_reject_reason(
    draft, jsonb_set(valid_scene, '{durationMs}', '7999'::JSONB)
  );
  IF reason IS DISTINCT FROM 'pitch scene duration must match the transcript segments' THEN
    failures := array_append(failures,
      'a duration off by 1ms was not rejected: ' || coalesce(reason, 'ACCEPTED'));
  END IF;

  -- THE STROBE. "No overlap" alone still admits 30ms scenes; the floor is what
  -- stops a photosensitivity hazard reaching the viewer of a published page.
  reason := pg_temp.submit_reject_reason(draft, pg_temp.scene(8000, jsonb_build_array(
    pg_temp.entry(photo_one, 0, 999),
    pg_temp.entry(photo_two, 999, 8000)
  )));
  IF reason IS DISTINCT FROM 'every pitch scene must last at least 1000ms' THEN
    failures := array_append(failures,
      'a 999ms scene was not rejected: ' || coalesce(reason, 'ACCEPTED'));
  END IF;
  -- The last scene gets no exception.
  reason := pg_temp.submit_reject_reason(draft, pg_temp.scene(8000, jsonb_build_array(
    pg_temp.entry(photo_one, 0, 7001),
    pg_temp.entry(photo_two, 7001, 8000)
  )));
  IF reason IS DISTINCT FROM 'every pitch scene must last at least 1000ms' THEN
    failures := array_append(failures,
      'a 999ms final scene was not rejected: ' || coalesce(reason, 'ACCEPTED'));
  END IF;
  -- Boundary control: exactly 1000ms is allowed.
  reason := pg_temp.submit_reject_reason(draft, pg_temp.scene(8000, jsonb_build_array(
    pg_temp.entry(photo_one, 0, 1000),
    pg_temp.entry(photo_two, 1000, 8000)
  )));
  IF reason IS NOT NULL THEN
    failures := array_append(failures, 'an exactly-1000ms scene was rejected: ' || reason);
  END IF;

  -- Coverage: no gap, no overlap, starts at 0, ends at durationMs.
  reason := pg_temp.submit_reject_reason(draft, pg_temp.scene(8000, jsonb_build_array(
    pg_temp.entry(photo_one, 0, 3000),
    pg_temp.entry(photo_two, 4000, 8000)
  )));
  IF reason IS DISTINCT FROM 'pitch scenes must be contiguous from 0 to durationMs' THEN
    failures := array_append(failures,
      'a 1s hole was not rejected: ' || coalesce(reason, 'ACCEPTED'));
  END IF;
  reason := pg_temp.submit_reject_reason(draft, pg_temp.scene(8000, jsonb_build_array(
    pg_temp.entry(photo_one, 0, 5000),
    pg_temp.entry(photo_two, 4000, 8000)
  )));
  IF reason IS DISTINCT FROM 'pitch scenes must be contiguous from 0 to durationMs' THEN
    failures := array_append(failures,
      'an overlap was not rejected: ' || coalesce(reason, 'ACCEPTED'));
  END IF;
  reason := pg_temp.submit_reject_reason(draft, pg_temp.scene(8000, jsonb_build_array(
    pg_temp.entry(photo_one, 500, 4000),
    pg_temp.entry(photo_two, 4000, 8000)
  )));
  IF reason IS DISTINCT FROM 'pitch scenes must be contiguous from 0 to durationMs' THEN
    failures := array_append(failures,
      'a timeline that does not start at 0 was not rejected: ' || coalesce(reason, 'ACCEPTED'));
  END IF;
  reason := pg_temp.submit_reject_reason(draft, pg_temp.scene(8000, jsonb_build_array(
    pg_temp.entry(photo_one, 0, 4000),
    pg_temp.entry(photo_two, 4000, 7000)
  )));
  IF reason IS DISTINCT FROM 'pitch scenes must be contiguous from 0 to durationMs' THEN
    failures := array_append(failures,
      'a timeline that ends early was not rejected: ' || coalesce(reason, 'ACCEPTED'));
  END IF;
  reason := pg_temp.submit_reject_reason(draft, pg_temp.scene(8000, '[]'::JSONB));
  IF reason IS DISTINCT FROM 'pitch scene requires at least one photo scene' THEN
    failures := array_append(failures,
      'an empty timeline was not rejected: ' || coalesce(reason, 'ACCEPTED'));
  END IF;

  -- References.
  reason := pg_temp.submit_reject_reason(draft, pg_temp.scene(8000, jsonb_build_array(
    pg_temp.entry(photo_one, 0, 4000),
    pg_temp.entry(photo_one, 4000, 8000)
  )));
  IF reason IS DISTINCT FROM 'pitch scene must not repeat a photo' THEN
    failures := array_append(failures,
      'a repeated photo was not rejected: ' || coalesce(reason, 'ACCEPTED'));
  END IF;
  reason := pg_temp.submit_reject_reason(draft, pg_temp.scene(8000, jsonb_build_array(
    pg_temp.entry(photo_one, 0, 4000),
    pg_temp.entry(voice, 4000, 8000)
  )));
  IF reason IS DISTINCT FROM 'pitch scene must reference only reviewed photo assets' THEN
    failures := array_append(failures,
      'the voice asset was not rejected as a scene photo: ' || coalesce(reason, 'ACCEPTED'));
  END IF;
  reason := pg_temp.submit_reject_reason(draft, pg_temp.scene(8000, jsonb_build_array(
    pg_temp.entry(photo_one, 0, 4000),
    pg_temp.entry(foreign_photo, 4000, 8000)
  )));
  IF reason IS DISTINCT FROM 'pitch scene must reference only reviewed photo assets' THEN
    failures := array_append(failures,
      'a photo from another draft was not rejected: ' || coalesce(reason, 'ACCEPTED'));
  END IF;
  reason := pg_temp.submit_reject_reason(draft, pg_temp.scene(8000, jsonb_build_array(
    pg_temp.entry(photo_one, 0, 2000),
    pg_temp.entry(photo_two, 2000, 4000),
    pg_temp.entry(photo_three, 4000, 6000),
    pg_temp.entry(foreign_photo, 6000, 8000)
  )));
  IF reason IS DISTINCT FROM 'pitch scene must not use more scenes than reviewed photos' THEN
    failures := array_append(failures,
      'more scenes than photos was not rejected: ' || coalesce(reason, 'ACCEPTED'));
  END IF;

  -- No segments, no motion: there would be no reproducible duration to agree
  -- with, and a client-measured audio length varies by device.
  reason := pg_temp.submit_reject_reason(unsegmented, pg_temp.scene(4000, jsonb_build_array(
    pg_temp.entry(foreign_photo, 0, 4000)
  )));
  IF reason IS DISTINCT FROM 'pitch scene requires transcript segments' THEN
    failures := array_append(failures,
      'a scene on an unsegmented transcript was not rejected: '
      || coalesce(reason, 'ACCEPTED'));
  END IF;

  IF array_length(failures, 1) IS NOT NULL THEN
    RAISE EXCEPTION '24_motion_scene submit-validation failures: %',
      array_to_string(failures, ' | ');
  END IF;
END;
$$;

-- ── (C) Backwards compatibility: a submit with no scene still works ──────
DO $$
DECLARE
  failures TEXT[] := ARRAY[]::TEXT[];
  unsegmented CONSTANT UUID := '24000000-0000-0000-0000-000000000002';
  request_id UUID;
  revision consent_revisions;
BEGIN
  PERFORM set_config(
    'request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true
  );

  SELECT consent_request_id INTO request_id
    FROM public.submit_pitch_for_consent(
      unsegmented, 'email', 'dater@example.test', 'Blair'
    );
  IF request_id IS NULL THEN
    failures := array_append(failures, 'a 4-argument submit no longer works');
  END IF;
  SELECT * INTO revision
    FROM public.consent_revisions
   WHERE pitch_draft_id = unsegmented
   ORDER BY revision_number DESC
   LIMIT 1;
  IF revision.id IS NULL THEN
    failures := array_append(failures, 'the legacy submit cut no revision');
  ELSIF revision.scene_definition IS NOT NULL OR revision.scene_hash IS NOT NULL THEN
    failures := array_append(failures, 'a scene was invented for a scene-less submit');
  END IF;

  IF array_length(failures, 1) IS NOT NULL THEN
    RAISE EXCEPTION '24_motion_scene legacy-submit failures: %',
      array_to_string(failures, ' | ');
  END IF;
END;
$$;

-- ── (D) The stored snapshot, its hash, and its immutability ─────────────
DO $$
DECLARE
  failures TEXT[] := ARRAY[]::TEXT[];
  draft CONSTANT UUID := '24000000-0000-0000-0000-000000000001';
  photo_one CONSTANT UUID := '24000000-0000-0000-0000-000000000211';
  photo_two CONSTANT UUID := '24000000-0000-0000-0000-000000000212';
  photo_three CONSTANT UUID := '24000000-0000-0000-0000-000000000213';
  introducer CONSTANT UUID := '00000000-0000-0000-0000-000000000001';
  submitted_scene JSONB;
  revision consent_revisions;
  raw_token TEXT;
  reason TEXT;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', introducer::text, true);

  -- An upper-case asset id and a 30.0 fps: both must normalize, so two clients
  -- that format JSON differently cannot produce two hashes for one timeline.
  submitted_scene := jsonb_build_object(
    'schemaVersion', 1,
    'canvas', jsonb_build_object('width', 1080, 'height', 1920, 'fps', 30.0),
    'durationMs', 8000,
    'scenes', jsonb_build_array(
      jsonb_build_object('assetId', upper(photo_one::TEXT), 'startMs', 0, 'endMs', 2500),
      pg_temp.entry(photo_two, 2500, 5250),
      pg_temp.entry(photo_three, 5250, 8000)
    )
  );

  SELECT consent_token INTO raw_token
    FROM public.submit_pitch_for_consent(
      draft, 'email', 'dater@example.test', 'Blair', submitted_scene
    );
  INSERT INTO d24_state (key, text_value) VALUES ('consent-token', raw_token);

  SELECT * INTO revision
    FROM public.consent_revisions
   WHERE pitch_draft_id = draft
   ORDER BY revision_number DESC
   LIMIT 1;

  IF revision.scene_definition IS NULL THEN
    failures := array_append(failures, 'the submitted scene was not stored');
  END IF;
  IF revision.scene_hash IS DISTINCT FROM
     encode(digest(revision.scene_definition::TEXT, 'sha256'), 'hex') THEN
    failures := array_append(failures,
      'scene_hash is not the sha256 of the stored scene_definition text');
  END IF;
  IF revision.scene_definition -> 'canvas' ->> 'fps' IS DISTINCT FROM '30' THEN
    failures := array_append(failures,
      'a 30.0 fps was stored verbatim instead of canonically');
  END IF;
  IF revision.scene_definition -> 'scenes' -> 0 ->> 'assetId'
     IS DISTINCT FROM photo_one::TEXT THEN
    failures := array_append(failures, 'the asset id was not normalized to lower case');
  END IF;
  -- The scene is part of the content hash, so it is part of what the Dater
  -- consents to rather than a decoration hanging off the side.
  IF revision.content_hash IS DISTINCT FROM encode(
       digest(
         jsonb_build_object(
           'headline', revision.headline,
           'body', revision.body,
           'structure', revision.structure,
           'asset_ids', to_jsonb(revision.asset_ids),
           'voice_asset_path', revision.voice_asset_path,
           'scene', revision.scene_definition
         )::TEXT,
         'sha256'
       ),
       'hex'
     ) THEN
    failures := array_append(failures, 'content_hash does not cover the scene');
  END IF;

  -- Immutability is inherited from the existing revision trigger (0013/0018);
  -- the new columns are not an escape hatch out of it.
  reason := NULL;
  BEGIN
    UPDATE public.consent_revisions
       SET scene_definition = pg_temp.scene(8000, jsonb_build_array(
             pg_temp.entry(photo_one, 0, 8000)
           ))
     WHERE id = revision.id;
  EXCEPTION WHEN OTHERS THEN
    reason := SQLERRM;
  END;
  IF reason IS DISTINCT FROM 'consent revisions are immutable' THEN
    failures := array_append(failures,
      'a scene UPDATE was not refused as immutable: ' || coalesce(reason, 'ACCEPTED'));
  END IF;
  reason := NULL;
  BEGIN
    DELETE FROM public.consent_revisions WHERE id = revision.id;
  EXCEPTION WHEN OTHERS THEN
    reason := SQLERRM;
  END;
  IF reason IS DISTINCT FROM 'consent revisions are immutable' THEN
    failures := array_append(failures,
      'a revision DELETE was not refused as immutable: ' || coalesce(reason, 'ACCEPTED'));
  END IF;

  -- A scene can never exist without its hash, on either table.
  reason := NULL;
  BEGIN
    INSERT INTO public.consent_revisions (
      pitch_draft_id, revision_number, headline, body, content_hash, scene_definition
    ) VALUES (
      draft, 99, 'unhashed', 'unhashed', 'd24-unhashed',
      pg_temp.scene(8000, jsonb_build_array(pg_temp.entry(photo_one, 0, 8000)))
    );
  EXCEPTION WHEN OTHERS THEN
    reason := SQLERRM;
  END;
  IF reason IS NULL OR reason NOT LIKE '%consent_revisions_scene_hash_pairing%' THEN
    failures := array_append(failures,
      'a revision scene without a hash was accepted: ' || coalesce(reason, 'ACCEPTED'));
  END IF;
  reason := NULL;
  BEGIN
    UPDATE public.pitch_drafts
       SET scene_definition = pg_temp.scene(8000, jsonb_build_array(
             pg_temp.entry(photo_one, 0, 8000)
           ))
     WHERE id = draft;
  EXCEPTION WHEN OTHERS THEN
    reason := SQLERRM;
  END;
  IF reason IS NULL OR reason NOT LIKE '%pitch_drafts_scene_hash_pairing%' THEN
    failures := array_append(failures,
      'a draft scene without a hash was accepted: ' || coalesce(reason, 'ACCEPTED'));
  END IF;

  -- Asset dimensions are positive or absent, never zero.
  reason := NULL;
  BEGIN
    UPDATE public.pitch_assets SET width = 0 WHERE id = photo_one;
  EXCEPTION WHEN OTHERS THEN
    reason := SQLERRM;
  END;
  IF reason IS NULL OR reason NOT LIKE '%pitch_assets_width_check%' THEN
    failures := array_append(failures,
      'a zero asset width was accepted: ' || coalesce(reason, 'ACCEPTED'));
  END IF;

  IF array_length(failures, 1) IS NOT NULL THEN
    RAISE EXCEPTION '24_motion_scene snapshot failures: %', array_to_string(failures, ' | ');
  END IF;
END;
$$;

-- Blair claims the review with the invited address; everything below is the
-- Dater acting on their own pitch.
DO $$
BEGIN
  PERFORM set_config(
    'request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true
  );
  PERFORM * FROM public.claim_consent_request(
    (SELECT text_value FROM d24_state WHERE key = 'consent-token')
  );
END;
$$;

-- ── (E) Carry-forward, demotion, and the Dater's own timeline ───────────
DO $$
DECLARE
  failures TEXT[] := ARRAY[]::TEXT[];
  draft CONSTANT UUID := '24000000-0000-0000-0000-000000000001';
  photo_one CONSTANT UUID := '24000000-0000-0000-0000-000000000211';
  photo_two CONSTANT UUID := '24000000-0000-0000-0000-000000000212';
  photo_three CONSTANT UUID := '24000000-0000-0000-0000-000000000213';
  dater CONSTANT UUID := '00000000-0000-0000-0000-000000000002';
  dater_headline CONSTANT TEXT := 'Blair rewrote the hook';
  dater_body CONSTANT TEXT := 'Blair rewrote the body too.';
  submitted consent_revisions;
  carried consent_revisions;
  demoted consent_revisions;
  replaced consent_revisions;
  retimed consent_revisions;
  next_id UUID;
  reason TEXT;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', dater::text, true);

  IF (SELECT subject_user_id FROM public.pitch_drafts WHERE id = draft)
     IS DISTINCT FROM dater THEN
    RAISE EXCEPTION '24_motion_scene fixture failure: the claim did not bind the dater';
  END IF;

  SELECT * INTO submitted
    FROM public.consent_revisions
   WHERE pitch_draft_id = draft
   ORDER BY revision_number DESC
   LIMIT 1;
  IF submitted.scene_definition IS NULL THEN
    RAISE EXCEPTION
      '24_motion_scene fixture failure: the reviewed revision carries no scene to carry forward';
  END IF;

  -- (E1) A save with no new_scene carries the reviewed timeline forward
  -- untouched, so a Dater who only edits words keeps their motion.
  SELECT revision_id INTO next_id
    FROM public.create_dater_revision(
      draft, dater_headline, dater_body, ARRAY[photo_one, photo_two, photo_three]
    );
  SELECT * INTO carried FROM public.consent_revisions WHERE id = next_id;
  IF carried.scene_definition IS DISTINCT FROM submitted.scene_definition
     OR carried.scene_hash IS DISTINCT FROM submitted.scene_hash THEN
    failures := array_append(failures,
      'a text-only save did not carry the reviewed scene forward');
  END IF;

  -- (E2) Dropping a photo the timeline still points at demotes the scene to
  -- NULL instead of publishing a dangling reference. Refusing the save would
  -- trap a Dater who simply removed a photo, so demotion is the answer.
  SELECT revision_id INTO next_id
    FROM public.create_dater_revision(
      draft, dater_headline, dater_body, ARRAY[photo_one, photo_two]
    );
  SELECT * INTO demoted FROM public.consent_revisions WHERE id = next_id;
  IF demoted.scene_definition IS NOT NULL OR demoted.scene_hash IS NOT NULL THEN
    failures := array_append(failures,
      'a scene survived a save that dropped one of its photos');
  END IF;

  -- (E3) The Dater's own timeline is validated by the same rules.
  reason := pg_temp.revision_reject_reason(
    draft, ARRAY[photo_one, photo_two],
    pg_temp.scene(8000, jsonb_build_array(
      pg_temp.entry(photo_one, 0, 999),
      pg_temp.entry(photo_two, 999, 8000)
    ))
  );
  IF reason IS DISTINCT FROM 'every pitch scene must last at least 1000ms' THEN
    failures := array_append(failures,
      'the dater path accepted a 999ms scene: ' || coalesce(reason, 'ACCEPTED'));
  END IF;
  reason := pg_temp.revision_reject_reason(
    draft, ARRAY[photo_one, photo_two],
    pg_temp.scene(8000, jsonb_build_array(
      pg_temp.entry(photo_one, 0, 4000),
      pg_temp.entry(photo_three, 4000, 8000)
    ))
  );
  IF reason IS DISTINCT FROM 'pitch scene must reference only reviewed photo assets' THEN
    failures := array_append(failures,
      'a scene referencing an excluded photo was accepted: '
      || coalesce(reason, 'ACCEPTED'));
  END IF;

  -- (E4) A fresh timeline replaces the demoted one. The snapshot keeps all
  -- three photos while the timeline uses two, which is legal — the scene must
  -- match the APPROVED photos, not every photo in the snapshot.
  SELECT revision_id INTO next_id
    FROM public.create_dater_revision(
      draft, dater_headline, dater_body,
      ARRAY[photo_one, photo_two, photo_three], NULL, NULL,
      pg_temp.scene(8000, jsonb_build_array(
        pg_temp.entry(photo_one, 0, 4000),
        pg_temp.entry(photo_two, 4000, 8000)
      ))
    );
  SELECT * INTO replaced FROM public.consent_revisions WHERE id = next_id;
  IF replaced.scene_definition IS NULL THEN
    failures := array_append(failures, 'the dater timeline was not stored');
  END IF;
  IF replaced.scene_hash IS DISTINCT FROM
     encode(digest(replaced.scene_definition::TEXT, 'sha256'), 'hex') THEN
    failures := array_append(failures, 'the dater scene_hash is not the stored text digest');
  END IF;

  -- (E5) Re-timing the same photos moves content_hash: everything else about
  -- these two revisions is byte-identical, so only the scene can explain it.
  SELECT revision_id INTO next_id
    FROM public.create_dater_revision(
      draft, dater_headline, dater_body,
      ARRAY[photo_one, photo_two, photo_three], NULL, NULL,
      pg_temp.scene(8000, jsonb_build_array(
        pg_temp.entry(photo_one, 0, 3000),
        pg_temp.entry(photo_two, 3000, 8000)
      ))
    );
  SELECT * INTO retimed FROM public.consent_revisions WHERE id = next_id;
  IF retimed.headline IS DISTINCT FROM replaced.headline
     OR retimed.body IS DISTINCT FROM replaced.body
     OR retimed.structure IS DISTINCT FROM replaced.structure
     OR retimed.asset_ids IS DISTINCT FROM replaced.asset_ids THEN
    failures := array_append(failures,
      'the re-timed revision differs in more than the scene, so the hash proves nothing');
  END IF;
  IF retimed.scene_hash IS NOT DISTINCT FROM replaced.scene_hash THEN
    failures := array_append(failures, 'a re-timed scene produced the same scene_hash');
  END IF;
  IF retimed.content_hash IS NOT DISTINCT FROM replaced.content_hash THEN
    failures := array_append(failures, 'content_hash ignored a scene-only change');
  END IF;

  INSERT INTO d24_state (key, uuid_value) VALUES ('approval-revision', retimed.id);

  IF array_length(failures, 1) IS NOT NULL THEN
    RAISE EXCEPTION '24_motion_scene revision failures: %', array_to_string(failures, ' | ');
  END IF;
END;
$$;

-- ── (F) Approval: the approved photo set is exactly the timeline's ───────
DO $$
DECLARE
  failures TEXT[] := ARRAY[]::TEXT[];
  draft CONSTANT UUID := '24000000-0000-0000-0000-000000000001';
  photo_one CONSTANT UUID := '24000000-0000-0000-0000-000000000211';
  photo_two CONSTANT UUID := '24000000-0000-0000-0000-000000000212';
  photo_three CONSTANT UUID := '24000000-0000-0000-0000-000000000213';
  dater CONSTANT UUID := '00000000-0000-0000-0000-000000000002';
  approval_revision UUID;
  approved consent_revisions;
  published pitch_drafts;
  reason TEXT;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', dater::text, true);
  SELECT uuid_value INTO approval_revision
    FROM d24_state WHERE key = 'approval-revision';
  SELECT * INTO approved FROM public.consent_revisions WHERE id = approval_revision;

  -- Fewer photos than the timeline uses: approval DELETES the excluded photo,
  -- so publishing this would leave the scene pointing at a row that is gone.
  reason := pg_temp.approve_reject_reason(draft, approval_revision, ARRAY[photo_one]);
  IF reason IS DISTINCT FROM 'approved photos must match the reviewed motion scene photos' THEN
    failures := array_append(failures,
      'a narrower approved photo set was accepted: ' || coalesce(reason, 'PUBLISHED'));
  END IF;

  -- More photos than the timeline uses: the extra photo would be published
  -- without ever appearing in the motion the Dater watched.
  reason := pg_temp.approve_reject_reason(
    draft, approval_revision, ARRAY[photo_one, photo_two, photo_three]
  );
  IF reason IS DISTINCT FROM 'approved photos must match the reviewed motion scene photos' THEN
    failures := array_append(failures,
      'a wider approved photo set was accepted: ' || coalesce(reason, 'PUBLISHED'));
  END IF;

  -- Exact match publishes, and the timeline reaches the public projection.
  PERFORM * FROM public.approve_and_publish_pitch(
    draft, 14, approval_revision, ARRAY[photo_one, photo_two], true
  );
  SELECT * INTO published FROM public.pitch_drafts WHERE id = draft;
  IF published.status IS DISTINCT FROM 'published' THEN
    failures := array_append(failures, 'the matching approval did not publish');
  END IF;
  IF published.scene_definition IS DISTINCT FROM approved.scene_definition THEN
    failures := array_append(failures,
      'the approved scene did not reach the published draft');
  END IF;
  IF published.scene_hash IS DISTINCT FROM approved.scene_hash THEN
    failures := array_append(failures,
      'the approved scene_hash did not reach the published draft');
  END IF;
  -- Every photo the published timeline references still exists.
  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements(published.scene_definition -> 'scenes') AS entry(value)
     WHERE NOT EXISTS (
       SELECT 1 FROM public.pitch_assets asset
        WHERE asset.id = (entry.value ->> 'assetId')::UUID
          AND asset.pitch_draft_id = draft
     )
  ) THEN
    failures := array_append(failures, 'the published timeline references a deleted asset');
  END IF;

  IF array_length(failures, 1) IS NOT NULL THEN
    RAISE EXCEPTION '24_motion_scene approval failures: %', array_to_string(failures, ' | ');
  END IF;
END;
$$;

-- ── (G) A scene-less revision publishes exactly as before ───────────────
DO $$
DECLARE
  failures TEXT[] := ARRAY[]::TEXT[];
  unsegmented CONSTANT UUID := '24000000-0000-0000-0000-000000000002';
  published pitch_drafts;
BEGIN
  SELECT * INTO published FROM public.pitch_drafts WHERE id = unsegmented;
  IF published.scene_definition IS NOT NULL OR published.scene_hash IS NOT NULL THEN
    failures := array_append(failures,
      'a draft that never carried a scene acquired one');
  END IF;

  IF array_length(failures, 1) IS NOT NULL THEN
    RAISE EXCEPTION '24_motion_scene legacy-projection failures: %',
      array_to_string(failures, ' | ');
  END IF;
END;
$$;

ROLLBACK;

SELECT '24_motion_scene.sql passed' AS result;
