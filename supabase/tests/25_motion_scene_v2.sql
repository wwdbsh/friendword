-- Motion pitch Phase 2 (migration 0049): the database judges a PitchScene v2
-- shot list, and it judges the two references a scene cannot prove about
-- itself — a transcript word and a reviewed structure field.
--
-- red-first: on 0048 private.pitch_scene_violation and
-- private.assert_scene_definition take three arguments and know nothing about
-- v2, and private.canonical_pitch_json does not exist, so the pin block below
-- raises immediately and every probe fails.
--
-- The positive control is the CANONICAL FIXTURE: the exact output of
-- examplePitchSceneV2() from packages/contracts/src/pitchSceneV2.ts, with its
-- illustrative photo ids remapped onto this suite's reviewed photos. It
-- exercises all eleven effects, every ladder level and both overlay kinds, so
-- every refusal below is about the mutation and not about the fixture. If the
-- frozen example changes, this literal has to be regenerated from it.
--
-- The rejection strings asserted here are a contract: the web and mobile
-- clients map them to Dater-facing copy, so a message change is a product
-- change.
--
-- THE FLASH BUDGET is the one rule in here that is not a bound on a single
-- field, so it gets its own set of probes in (D). It runs over the UNION of every
-- instantaneous luminance or appearance event — punch onsets, each EXPANDED
-- lightLeak pulse peak over the half-open interval [startMs, endMs) with k = 0
-- counted, wordPop appearances and countBadge appearances. Counting overlay
-- onsets alone was the bug: a 3Hz leak delivered four peaks the budget never saw,
-- and three punches could sit between them for five events in one second.

BEGIN;

DO $$
BEGIN
  IF to_regprocedure(
    'private.pitch_scene_violation(jsonb,integer,uuid[],jsonb,jsonb)'
  ) IS NULL THEN
    RAISE EXCEPTION
      'D25: private.pitch_scene_violation(jsonb,integer,uuid[],jsonb,jsonb) missing';
  END IF;
  IF to_regprocedure(
    'private.assert_scene_definition(jsonb,integer,uuid[],jsonb,jsonb)'
  ) IS NULL THEN
    RAISE EXCEPTION
      'D25: private.assert_scene_definition(jsonb,integer,uuid[],jsonb,jsonb) missing';
  END IF;
  -- The 3-argument forms are gone on purpose: they would be a call path where a
  -- v2 scene is judged with no transcript and no structure.
  IF to_regprocedure('private.pitch_scene_violation(jsonb,integer,uuid[])') IS NOT NULL THEN
    RAISE EXCEPTION 'D25: the 3-argument pitch_scene_violation still exists';
  END IF;
  IF to_regprocedure('private.canonical_pitch_json(jsonb)') IS NULL THEN
    RAISE EXCEPTION 'D25: private.canonical_pitch_json(jsonb) missing';
  END IF;
  IF to_regprocedure('private.pitch_shot_level_min_size(text)') IS NULL THEN
    RAISE EXCEPTION 'D25: private.pitch_shot_level_min_size(text) missing';
  END IF;
END;
$$;

CREATE TEMP TABLE d25_state (key TEXT PRIMARY KEY, text_value TEXT, uuid_value UUID);

-- ── Fixture ─────────────────────────────────────────────────────────────
-- Introducer Alex (0001) pitches Blair (0002). The transcript's last segment
-- ends at 14.4s, which is the only authority for how long the pitch runs, and
-- it carries ten word timings (A7), which is what makes a wordPop legal here.
-- The structure carries the five published fields, which is what makes a
-- kineticText and a countBadge legal here.
INSERT INTO public.pitch_drafts (
  id, created_by_user_id, status, headline, body, structure, transcript
) VALUES (
  '25000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  'draft',
  'Meet my friend Blair',
  'Blair is kind, curious, and always cooking.',
  '{"hook": "Meet my friend Blair",
    "relationship_context": "We have been friends since college.",
    "three_specific_qualities": ["kind", "curious", "cooks constantly"],
    "evidence_or_anecdote": "Blair drove four hours to help me move.",
    "good_match_for": "someone who likes long dinners",
    "hard_claims_requiring_confirmation": []}'::JSONB,
  '{"text": "Blair is kind and curious and always cooking.",
    "language": "en",
    "segments": [
      {"start": 0, "end": 4.8, "text": "Blair is kind"},
      {"start": 4.8, "end": 9.6, "text": "and curious"},
      {"start": 9.6, "end": 14.4, "text": "and always cooking"}
    ],
    "words": [
      {"start": 0.0, "end": 0.5, "word": "Blair"},
      {"start": 0.5, "end": 0.9, "word": "is"},
      {"start": 0.9, "end": 1.4, "word": "kind"},
      {"start": 4.8, "end": 5.1, "word": "and"},
      {"start": 5.1, "end": 5.9, "word": "curious"},
      {"start": 9.6, "end": 9.9, "word": "and"},
      {"start": 9.9, "end": 10.4, "word": "always"},
      {"start": 10.4, "end": 11.2, "word": "cooking"},
      {"start": 11.2, "end": 11.8, "word": "every"},
      {"start": 11.8, "end": 12.4, "word": "night"}
    ]}'::JSONB
);

-- The legacy client's draft: transcribed before word timings existed, no
-- structure, and an 8s recording. A v1 scene must still be accepted here after
-- 0049, because an older mobile bundle keeps submitting one.
INSERT INTO public.pitch_drafts (
  id, created_by_user_id, status, headline, body, transcript
) VALUES (
  '25000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000001',
  'draft',
  'A pre-A7 recording',
  'No word timings, no structure, still publishable.',
  '{"text": "older bundle",
    "language": "en",
    "segments": [
      {"start": 0, "end": 2.5, "text": "one"},
      {"start": 2.5, "end": 5.25, "text": "two"},
      {"start": 5.25, "end": 8, "text": "three"}
    ]}'::JSONB
);

-- A transcript with FOUR-decimal timestamps, which is where the database and the
-- clients used to compute two different durations. 16.0005s is 16000ms in every
-- client (the double nearest 16.0005 times 1000 is 16000.499999999998) and was
-- 16001ms under 0048's NUMERIC rounding. Section (A2) submits a scene declaring
-- 16000 against this draft, so the whole disagreement is one accept/reject.
INSERT INTO public.pitch_drafts (
  id, created_by_user_id, status, headline, body, transcript
) VALUES (
  '25000000-0000-0000-0000-000000000003',
  '00000000-0000-0000-0000-000000000001',
  'draft',
  'A four-decimal transcript',
  'The provider emitted timestamps finer than a millisecond.',
  '{"text": "four decimals",
    "language": "en",
    "segments": [
      {"start": 0, "end": 8.0025, "text": "first"},
      {"start": 8.0025, "end": 16.0005, "text": "second"}
    ]}'::JSONB
);

INSERT INTO public.pitch_assets (
  id, pitch_draft_id, uploaded_by_user_id, asset_type, storage_path, sort_order,
  width, height
) VALUES
  (
    '25000000-0000-0000-0000-000000000201',
    '25000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    'voice',
    'pitch-media/25000000-0000-0000-0000-000000000001/voice.m4a',
    0, NULL, NULL
  ),
  (
    '25000000-0000-0000-0000-0000000002ab',
    '25000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    'photo',
    'pitch-media/25000000-0000-0000-0000-000000000001/photo-1.jpg',
    1, 1200, 1600
  ),
  (
    '25000000-0000-0000-0000-000000000212',
    '25000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    'photo',
    'pitch-media/25000000-0000-0000-0000-000000000001/photo-2.jpg',
    2, 1600, 1200
  ),
  (
    '25000000-0000-0000-0000-000000000213',
    '25000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    'photo',
    'pitch-media/25000000-0000-0000-0000-000000000001/photo-3.jpg',
    3, 1400, 1400
  ),
  (
    '25000000-0000-0000-0000-000000000214',
    '25000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    'photo',
    'pitch-media/25000000-0000-0000-0000-000000000001/photo-4.jpg',
    4, NULL, NULL
  ),
  -- A reviewed photo the canonical scene does NOT use: the header/shot set
  -- equality probe needs a photo that is legal to reference but unreferenced.
  (
    '25000000-0000-0000-0000-000000000215',
    '25000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    'photo',
    'pitch-media/25000000-0000-0000-0000-000000000001/photo-5.jpg',
    5, NULL, NULL
  ),
  (
    '25000000-0000-0000-0000-0000000002c1',
    '25000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000001',
    'photo',
    'pitch-media/25000000-0000-0000-0000-000000000002/photo-1.jpg',
    1, NULL, NULL
  ),
  (
    '25000000-0000-0000-0000-000000000222',
    '25000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000001',
    'photo',
    'pitch-media/25000000-0000-0000-0000-000000000002/photo-2.jpg',
    2, NULL, NULL
  ),
  (
    '25000000-0000-0000-0000-000000000223',
    '25000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000001',
    'photo',
    'pitch-media/25000000-0000-0000-0000-000000000002/photo-3.jpg',
    3, NULL, NULL
  ),
  -- One photo per shot of the four-decimal scene, so its header is the whole
  -- reviewed photo set and nothing about that scene is about the header.
  (
    '25000000-0000-0000-0000-0000000003a1',
    '25000000-0000-0000-0000-000000000003',
    '00000000-0000-0000-0000-000000000001',
    'photo',
    'pitch-media/25000000-0000-0000-0000-000000000003/photo-1.jpg',
    1, NULL, NULL
  ),
  (
    '25000000-0000-0000-0000-0000000003a2',
    '25000000-0000-0000-0000-000000000003',
    '00000000-0000-0000-0000-000000000001',
    'photo',
    'pitch-media/25000000-0000-0000-0000-000000000003/photo-2.jpg',
    2, NULL, NULL
  ),
  (
    '25000000-0000-0000-0000-0000000003a3',
    '25000000-0000-0000-0000-000000000003',
    '00000000-0000-0000-0000-000000000001',
    'photo',
    'pitch-media/25000000-0000-0000-0000-000000000003/photo-3.jpg',
    3, NULL, NULL
  ),
  (
    '25000000-0000-0000-0000-0000000003a4',
    '25000000-0000-0000-0000-000000000003',
    '00000000-0000-0000-0000-000000000001',
    'photo',
    'pitch-media/25000000-0000-0000-0000-000000000003/photo-4.jpg',
    4, NULL, NULL
  );

-- One active campaign per owner (0039): Blair owns the seed campaign, so retire
-- it before this suite publishes its own.
UPDATE public.campaigns SET status = 'archived'
 WHERE owner_user_id = '00000000-0000-0000-0000-000000000002'
   AND status IN ('published', 'paused');

-- ── The canonical fixture ───────────────────────────────────────────────
-- examplePitchSceneV2() verbatim, photo ids remapped:
--
--   0 wide        photo 1   0..3000      kenBurns
--   1 punchIn     photo 2   3000..5400   punch, wordPop
--   2 detail      photo 3   5400..7600   backdropBlur, wordPop
--   3 typographic           7600..9800   hook
--   4 wideAlt     photo 4   9800..12000  punch
--   5 wide        photo 1   12000..14400 (repeat, five shots later)
CREATE FUNCTION pg_temp.canon()
RETURNS JSONB
LANGUAGE sql
AS $fn$
  SELECT $json$
{
  "schemaVersion": 2,
  "template": "warm",
  "canvas": {"width":1080,"height":1920,"fps":30},
  "durationMs": 14400,
  "assetIds": ["25000000-0000-0000-0000-0000000002ab","25000000-0000-0000-0000-000000000212","25000000-0000-0000-0000-000000000213","25000000-0000-0000-0000-000000000214"],
  "shots": [
    {
      "level": "wide",
      "assetId": "25000000-0000-0000-0000-0000000002ab",
      "startMs": 0,
      "endMs": 3000,
      "crop": {"x":0,"y":0,"width":1,"height":1},
      "effects": [
        {
          "type": "kenBurns",
          "to": {"x":0.02,"y":0.02,"width":0.96,"height":0.96},
          "easing": "easeInOut"
        }
      ]
    },
    {
      "level": "punchIn",
      "assetId": "25000000-0000-0000-0000-000000000212",
      "startMs": 3000,
      "endMs": 5400,
      "crop": {"x":0.05,"y":0.05,"width":0.9,"height":0.9},
      "effects": [
        {"type":"punch","atMs":3600,"durationMs":200,"scale":1.1,"easing":"easeOut"},
        {
          "type": "wordPop",
          "word": {"segmentIndex":0,"wordIndex":3},
          "startMs": 4300,
          "endMs": 4700,
          "scale": 1.3,
          "easing": "easeOut"
        }
      ]
    },
    {
      "level": "detail",
      "assetId": "25000000-0000-0000-0000-000000000213",
      "startMs": 5400,
      "endMs": 7600,
      "crop": {"x":0.1,"y":0.15,"width":0.7,"height":0.7},
      "effects": [
        {"type":"backdropBlur","radiusPx":24,"dim":0.3},
        {
          "type": "wordPop",
          "word": {"segmentIndex":1,"wordIndex":0},
          "startMs": 6000,
          "endMs": 6400,
          "scale": 1.2,
          "easing": "linear"
        }
      ]
    },
    {
      "level": "typographic",
      "startMs": 7600,
      "endMs": 9800,
      "text": {
        "type": "kineticText",
        "source": "hook",
        "revealMs": 400,
        "easing": "easeOut",
        "emphasis": 1
      }
    },
    {
      "level": "wideAlt",
      "assetId": "25000000-0000-0000-0000-000000000214",
      "startMs": 9800,
      "endMs": 12000,
      "crop": {"x":0.05,"y":0.05,"width":0.9,"height":0.9},
      "effects": [
        {"type":"punch","atMs":10200,"durationMs":160,"scale":1.03,"easing":"easeOut"}
      ]
    },
    {
      "level": "wide",
      "assetId": "25000000-0000-0000-0000-0000000002ab",
      "startMs": 12000,
      "endMs": 14400,
      "crop": {"x":0,"y":0,"width":1,"height":1},
      "effects": []
    }
  ],
  "look": {
    "grade": {"warmth":0.3,"contrast":1.1,"saturation":1.05,"vignette":0.25},
    "grain": {"intensity":0.12,"sizePx":2,"seed":1234567,"animationHz":24}
  },
  "chrome": {
    "progressBar": {"thicknessPx":4,"opacity":0.6,"anchor":"bottom"},
    "waveViz": {
      "amplitudes": [0,0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8,0.9,0,0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8,0.9,0,0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8,0.9,0,0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8,0.9,0,0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8,0.9,0,0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8,0.9,0,0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8,0.9,0,0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8,0.9,0,0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8,0.9,0,0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8,0.9,0,0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8,0.9,0,0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8,0.9,0,0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8,0.9,0,0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8,0.9,0,0.1,0.2,0.3],
      "sampleIntervalMs": 100,
      "heightPx": 64,
      "opacity": 0.5,
      "anchor": "bottom"
    }
  },
  "overlays": [
    {
      "type": "countBadge",
      "source": "quality:0",
      "startMs": 5500,
      "endMs": 6500,
      "emphasis": 0.8
    },
    {
      "type": "lightLeak",
      "startMs": 7400,
      "endMs": 7700,
      "peakIntensity": 0.4,
      "pulseHz": 2,
      "angleDeg": 35
    }
  ]
}
  $json$::JSONB;
$fn$;

-- The same timeline over three photos: shot 4 borrows photo 3 and the header
-- shrinks to match. Used by the approval probes, which need a scene that uses
-- fewer photos than the revision snapshot carries.
CREATE FUNCTION pg_temp.canon_three_photos()
RETURNS JSONB
LANGUAGE sql
AS $$
  SELECT jsonb_set(
    jsonb_set(
      pg_temp.canon(),
      '{shots,4,assetId}',
      '"25000000-0000-0000-0000-000000000213"'::JSONB
    ),
    '{assetIds}',
    jsonb_build_array(
      '25000000-0000-0000-0000-0000000002ab',
      '25000000-0000-0000-0000-000000000212',
      '25000000-0000-0000-0000-000000000213'
    )
  );
$$;

-- The scene for the four-decimal draft: four 4000ms shots over its four photos,
-- one per level, no effects and no overlays. Deliberately plain — the only thing
-- it asserts is that 16000 is the duration the database computes from
-- 16.0005s, so nothing else about it may be able to fail.
CREATE FUNCTION pg_temp.canon_four_decimal()
RETURNS JSONB
LANGUAGE sql
AS $fn$
  SELECT $json$
{
  "schemaVersion": 2,
  "template": "warm",
  "canvas": {"width":1080,"height":1920,"fps":30},
  "durationMs": 16000,
  "assetIds": ["25000000-0000-0000-0000-0000000003a1","25000000-0000-0000-0000-0000000003a2","25000000-0000-0000-0000-0000000003a3","25000000-0000-0000-0000-0000000003a4"],
  "shots": [
    {
      "level": "wide",
      "assetId": "25000000-0000-0000-0000-0000000003a1",
      "startMs": 0,
      "endMs": 4000,
      "crop": {"x":0,"y":0,"width":1,"height":1},
      "effects": []
    },
    {
      "level": "wideAlt",
      "assetId": "25000000-0000-0000-0000-0000000003a2",
      "startMs": 4000,
      "endMs": 8000,
      "crop": {"x":0.05,"y":0.05,"width":0.9,"height":0.9},
      "effects": []
    },
    {
      "level": "punchIn",
      "assetId": "25000000-0000-0000-0000-0000000003a3",
      "startMs": 8000,
      "endMs": 12000,
      "crop": {"x":0.05,"y":0.05,"width":0.9,"height":0.9},
      "effects": []
    },
    {
      "level": "detail",
      "assetId": "25000000-0000-0000-0000-0000000003a4",
      "startMs": 12000,
      "endMs": 16000,
      "crop": {"x":0.1,"y":0.15,"width":0.7,"height":0.7},
      "effects": []
    }
  ],
  "look": {
    "grade": {"warmth":0.3,"contrast":1.1,"saturation":1.05,"vignette":0.25},
    "grain": {"intensity":0.12,"sizePx":2,"seed":1234567,"animationHz":24}
  },
  "chrome": {
    "progressBar": {"thicknessPx":4,"opacity":0.6,"anchor":"bottom"}
  },
  "overlays": []
}
  $json$::JSONB;
$fn$;

-- Replaces one shot's effects wholesale. jsonb_set on an array path cannot
-- lengthen the array, and several probes need a longer effect list.
CREATE FUNCTION pg_temp.with_effects(scene JSONB, shot_index INTEGER, effects JSONB)
RETURNS JSONB
LANGUAGE sql
AS $$
  SELECT jsonb_set(scene, ARRAY['shots', shot_index::TEXT, 'effects'], effects);
$$;

-- ── Probe helpers ───────────────────────────────────────────────────────
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
    RAISE EXCEPTION 'D25-ACCEPTED';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'D25-ACCEPTED' THEN
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
    RAISE EXCEPTION 'D25-ACCEPTED';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'D25-ACCEPTED' THEN
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
    RAISE EXCEPTION 'D25-ACCEPTED';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'D25-ACCEPTED' THEN
      RETURN NULL;
    END IF;
    RETURN SQLERRM;
  END;
END;
$$;

-- ── (A) The envelope, the header, and the duration authority ────────────
DO $$
DECLARE
  failures TEXT[] := ARRAY[]::TEXT[];
  draft CONSTANT UUID := '25000000-0000-0000-0000-000000000001';
  photo_five CONSTANT TEXT := '"25000000-0000-0000-0000-000000000215"';
  foreign_photo CONSTANT TEXT := '"25000000-0000-0000-0000-0000000002c1"';
  introducer CONSTANT UUID := '00000000-0000-0000-0000-000000000001';
  reason TEXT;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', introducer::text, true);

  -- Positive control: the frozen example is accepted as it stands.
  reason := pg_temp.submit_reject_reason(draft, pg_temp.canon());
  IF reason IS NOT NULL THEN
    failures := array_append(failures, 'the canonical v2 scene was rejected: ' || reason);
  END IF;

  -- An unknown envelope key is refused, not ignored: a tolerated text field
  -- would be a path for unmoderated words onto the public page.
  reason := pg_temp.submit_reject_reason(
    draft, pg_temp.canon() || '{"caption": "words nothing moderated"}'::JSONB
  );
  IF reason IS DISTINCT FROM
     'pitch scene must carry only schemaVersion, template, canvas, durationMs, assetIds, shots, look, chrome and overlays' THEN
    failures := array_append(failures,
      'an extra envelope key was not rejected: ' || coalesce(reason, 'ACCEPTED'));
  END IF;
  reason := pg_temp.submit_reject_reason(draft, pg_temp.canon() - 'look');
  IF reason IS DISTINCT FROM
     'pitch scene must carry only schemaVersion, template, canvas, durationMs, assetIds, shots, look, chrome and overlays' THEN
    failures := array_append(failures,
      'a missing look was not rejected: ' || coalesce(reason, 'ACCEPTED'));
  END IF;

  -- An unknown schemaVersion is not a v2 scene, so it falls through to the v1
  -- rules and is refused there.
  reason := pg_temp.submit_reject_reason(
    draft, jsonb_set(pg_temp.canon(), '{schemaVersion}', '3'::JSONB)
  );
  IF reason IS DISTINCT FROM
     'pitch scene must carry only schemaVersion, canvas, durationMs and scenes' THEN
    failures := array_append(failures,
      'schemaVersion 3 was not rejected: ' || coalesce(reason, 'ACCEPTED'));
  END IF;

  -- Fonts and colours come from the template, which is a closed enum. That is
  -- why no hex string or font name can appear in a scene at all.
  reason := pg_temp.submit_reject_reason(
    draft, jsonb_set(pg_temp.canon(), '{template}', '"neon"'::JSONB)
  );
  IF reason IS DISTINCT FROM 'pitch scene template must be warm or hype' THEN
    failures := array_append(failures,
      'an unknown template was not rejected: ' || coalesce(reason, 'ACCEPTED'));
  END IF;

  reason := pg_temp.submit_reject_reason(
    draft, jsonb_set(pg_temp.canon(), '{canvas,fps}', '61'::JSONB)
  );
  IF reason IS DISTINCT FROM
     'pitch scene canvas must carry a width, a height and an fps in range' THEN
    failures := array_append(failures,
      '61 fps was not rejected: ' || coalesce(reason, 'ACCEPTED'));
  END IF;
  reason := pg_temp.submit_reject_reason(
    draft, jsonb_set(pg_temp.canon(), '{canvas,width}', '5000'::JSONB)
  );
  IF reason IS DISTINCT FROM
     'pitch scene canvas must carry a width, a height and an fps in range' THEN
    failures := array_append(failures,
      'a 5000px canvas was not rejected: ' || coalesce(reason, 'ACCEPTED'));
  END IF;

  -- Duration: the schema range first, then the transcript equality.
  reason := pg_temp.submit_reject_reason(
    draft, jsonb_set(pg_temp.canon(), '{durationMs}', '1000'::JSONB)
  );
  IF reason IS DISTINCT FROM 'pitch scene must last between 1200ms and 600000ms' THEN
    failures := array_append(failures,
      'a 1000ms scene was not rejected: ' || coalesce(reason, 'ACCEPTED'));
  END IF;
  reason := pg_temp.submit_reject_reason(
    draft, jsonb_set(pg_temp.canon(), '{durationMs}', '14401'::JSONB)
  );
  IF reason IS DISTINCT FROM 'pitch scene duration must match the transcript segments' THEN
    failures := array_append(failures,
      'a duration off by 1ms was not rejected: ' || coalesce(reason, 'ACCEPTED'));
  END IF;

  -- The header: 1..12 distinct canonical ids, all of them reviewed photos, and
  -- exactly the set the shots use.
  reason := pg_temp.submit_reject_reason(
    draft,
    jsonb_set(
      pg_temp.canon(), '{assetIds}',
      (pg_temp.canon() -> 'assetIds') || (pg_temp.canon() -> 'assetIds' -> 0)
    )
  );
  IF reason IS DISTINCT FROM 'pitch scene assetIds must be 1 to 12 distinct photo ids' THEN
    failures := array_append(failures,
      'a repeated assetId was not rejected: ' || coalesce(reason, 'ACCEPTED'));
  END IF;
  reason := pg_temp.submit_reject_reason(
    draft, jsonb_set(pg_temp.canon(), '{assetIds,0}', '"not-a-uuid"'::JSONB)
  );
  IF reason IS DISTINCT FROM 'pitch scene assetIds must be 1 to 12 distinct photo ids' THEN
    failures := array_append(failures,
      'a malformed assetId was not rejected: ' || coalesce(reason, 'ACCEPTED'));
  END IF;
  reason := pg_temp.submit_reject_reason(
    draft,
    jsonb_set(
      jsonb_set(pg_temp.canon(), '{assetIds,3}', foreign_photo::JSONB),
      '{shots,4,assetId}', foreign_photo::JSONB
    )
  );
  IF reason IS DISTINCT FROM 'pitch scene must reference only reviewed photo assets' THEN
    failures := array_append(failures,
      'a photo from another draft was not rejected: ' || coalesce(reason, 'ACCEPTED'));
  END IF;
  -- A photo listed but never shown, and a photo shown but never listed: both
  -- break the header that approval compares against the include set.
  reason := pg_temp.submit_reject_reason(
    draft,
    jsonb_set(
      pg_temp.canon(), '{assetIds}',
      (pg_temp.canon() -> 'assetIds') || jsonb_build_array(photo_five::JSONB)
    )
  );
  IF reason IS DISTINCT FROM 'pitch scene assetIds must be exactly the photos its shots use' THEN
    failures := array_append(failures,
      'an unused listed photo was not rejected: ' || coalesce(reason, 'ACCEPTED'));
  END IF;
  reason := pg_temp.submit_reject_reason(
    draft,
    jsonb_set(
      pg_temp.canon(), '{assetIds}',
      jsonb_build_array(
        pg_temp.canon() -> 'assetIds' -> 0,
        pg_temp.canon() -> 'assetIds' -> 1,
        pg_temp.canon() -> 'assetIds' -> 2
      )
    )
  );
  IF reason IS DISTINCT FROM 'pitch scene assetIds must be exactly the photos its shots use' THEN
    failures := array_append(failures,
      'a shot photo missing from the header was not rejected: '
      || coalesce(reason, 'ACCEPTED'));
  END IF;

  IF array_length(failures, 1) IS NOT NULL THEN
    RAISE EXCEPTION '25_motion_scene_v2 envelope failures: %',
      array_to_string(failures, ' | ');
  END IF;
END;
$$;

-- ── (A2) The duration is the clients' arithmetic, to the millisecond ────
-- private.pitch_transcript_duration_ms is the only authority for how long a
-- pitch runs, and a scene has to match it EXACTLY. Every client derives its own
-- copy as Math.round(Number(end) * 1000) — IEEE double, half up — so the
-- database has to answer with that arithmetic and not merely with that intent.
-- A 1ms disagreement refuses the client's shot list, and mobile then publishes
-- with no motion at all: fail-safe, but silent, so it would read as "motion does
-- not work for this recording" rather than as an error.
--
-- red-first on 0048, which rounded in NUMERIC: 8.0025s answered 8003 there and
-- 8002 here, and the submit at the end of this block was refused.
--
-- Each pin below rejects a different plausible implementation:
--   8.0025, 16.0005  a NUMERIC round (exact decimals: the product is exactly
--                    .5 and rounds up, while the double product is below .5)
--   0.0025, 120.0005 PostgreSQL's round(FLOAT8), which is half to EVEN
-- 24_motion_scene already pins 1.2345 -> 1235, which is the same half-even trap
-- one magnitude up.
DO $$
DECLARE
  failures TEXT[] := ARRAY[]::TEXT[];
  draft CONSTANT UUID := '25000000-0000-0000-0000-000000000003';
  introducer CONSTANT UUID := '00000000-0000-0000-0000-000000000001';
  reason TEXT;
BEGIN
  -- The double nearest 8.0025 times 1000 is 8002.499999999999, so the client
  -- answers 8002 while the exact decimal 8002.5 rounds to 8003.
  IF private.pitch_transcript_duration_ms(
       '{"segments": [{"start": 0, "end": 8.0025}]}'::JSONB
     ) IS DISTINCT FROM 8002 THEN
    failures := array_append(failures, '8.0025s is not the clients'' 8002ms');
  END IF;
  IF private.pitch_transcript_duration_ms(
       '{"segments": [{"start": 0, "end": 16.0005}]}'::JSONB
     ) IS DISTINCT FROM 16000 THEN
    failures := array_append(failures, '16.0005s is not the clients'' 16000ms');
  END IF;

  -- Here the double product IS exactly .5, and half up is the only right answer.
  IF private.pitch_transcript_duration_ms(
       '{"segments": [{"start": 0, "end": 0.0025}]}'::JSONB
     ) IS DISTINCT FROM 3 THEN
    failures := array_append(failures, '2.5ms did not round half up to 3ms');
  END IF;
  IF private.pitch_transcript_duration_ms(
       '{"segments": [{"start": 0, "end": 120.0005}]}'::JSONB
     ) IS DISTINCT FROM 120001 THEN
    failures := array_append(failures, '120.0005s did not round half up to 120001ms');
  END IF;

  -- The range guard has to stay in NUMERIC and has to run BEFORE the cast to
  -- double: a transcript may carry a number no double can hold, and an
  -- implementation that cast first would raise instead of answering NULL.
  BEGIN
    IF private.pitch_transcript_duration_ms(
         '{"segments": [{"start": 0, "end": 1e400}]}'::JSONB
       ) IS NOT NULL THEN
      failures := array_append(failures, 'an out-of-range end produced a duration');
    END IF;
  EXCEPTION WHEN OTHERS THEN
    failures := array_append(failures,
      'an out-of-range end raised instead of answering NULL: ' || SQLERRM);
  END;

  -- Positive control: a scene declaring 16000ms against the four-decimal draft
  -- is ACCEPTED. This is the whole defect in one probe — 0048 refused it with
  -- 'pitch scene duration must match the transcript segments'.
  PERFORM set_config('request.jwt.claim.sub', introducer::text, true);
  reason := pg_temp.submit_reject_reason(draft, pg_temp.canon_four_decimal());
  IF reason IS NOT NULL THEN
    failures := array_append(failures,
      'the four-decimal scene was rejected: ' || reason);
  END IF;

  IF array_length(failures, 1) IS NOT NULL THEN
    RAISE EXCEPTION '25_motion_scene_v2 duration arithmetic failures: %',
      array_to_string(failures, ' | ');
  END IF;
END;
$$;

-- ── (B) The shot timeline and the crop ladder ───────────────────────────
DO $$
DECLARE
  failures TEXT[] := ARRAY[]::TEXT[];
  draft CONSTANT UUID := '25000000-0000-0000-0000-000000000001';
  introducer CONSTANT UUID := '00000000-0000-0000-0000-000000000001';
  reason TEXT;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', introducer::text, true);

  reason := pg_temp.submit_reject_reason(
    draft, jsonb_set(pg_temp.canon(), '{shots}', '[]'::JSONB)
  );
  IF reason IS DISTINCT FROM 'pitch scene must carry 1 to 300 shots' THEN
    failures := array_append(failures,
      'an empty shot list was not rejected: ' || coalesce(reason, 'ACCEPTED'));
  END IF;
  reason := pg_temp.submit_reject_reason(
    draft, jsonb_set(pg_temp.canon(), '{shots,0,level}', '"zoomOut"'::JSONB)
  );
  IF reason IS DISTINCT FROM
     'pitch scene shot level must be wide, punchIn, detail, wideAlt or typographic' THEN
    failures := array_append(failures,
      'an unknown ladder level was not rejected: ' || coalesce(reason, 'ACCEPTED'));
  END IF;
  reason := pg_temp.submit_reject_reason(
    draft,
    jsonb_set(
      pg_temp.canon(), '{shots,0}',
      (pg_temp.canon() -> 'shots' -> 0) || '{"text": "unmoderated caption"}'::JSONB
    )
  );
  IF reason IS DISTINCT FROM
     'pitch scene shot must carry only level, assetId, startMs, endMs, crop and effects' THEN
    failures := array_append(failures,
      'an extra shot key was not rejected: ' || coalesce(reason, 'ACCEPTED'));
  END IF;
  reason := pg_temp.submit_reject_reason(
    draft,
    jsonb_set(
      pg_temp.canon(), '{shots,3}',
      (pg_temp.canon() -> 'shots' -> 3)
        || '{"assetId": "25000000-0000-0000-0000-0000000002ab"}'::JSONB
    )
  );
  IF reason IS DISTINCT FROM
     'pitch scene text card must carry only level, startMs, endMs and text' THEN
    failures := array_append(failures,
      'an extra text card key was not rejected: ' || coalesce(reason, 'ACCEPTED'));
  END IF;
  reason := pg_temp.submit_reject_reason(
    draft, jsonb_set(pg_temp.canon(), '{shots,0,assetId}', '"not-a-uuid"'::JSONB)
  );
  IF reason IS DISTINCT FROM 'pitch scene shot must reference a photo by id' THEN
    failures := array_append(failures,
      'a malformed shot assetId was not rejected: ' || coalesce(reason, 'ACCEPTED'));
  END IF;
  reason := pg_temp.submit_reject_reason(
    draft, jsonb_set(pg_temp.canon(), '{shots,0,startMs}', '0.5'::JSONB)
  );
  IF reason IS DISTINCT FROM
     'pitch scene shot must carry a whole millisecond startMs and endMs' THEN
    failures := array_append(failures,
      'a fractional startMs was not rejected: ' || coalesce(reason, 'ACCEPTED'));
  END IF;

  -- Coverage: no gap, no overlap, ends exactly on durationMs.
  reason := pg_temp.submit_reject_reason(
    draft, jsonb_set(pg_temp.canon(), '{shots,1,startMs}', '3100'::JSONB)
  );
  IF reason IS DISTINCT FROM 'pitch scene shots must be contiguous from 0 to durationMs' THEN
    failures := array_append(failures,
      'a 100ms hole was not rejected: ' || coalesce(reason, 'ACCEPTED'));
  END IF;
  reason := pg_temp.submit_reject_reason(
    draft, jsonb_set(pg_temp.canon(), '{shots,5,endMs}', '14000'::JSONB)
  );
  IF reason IS DISTINCT FROM 'pitch scene shots must be contiguous from 0 to durationMs' THEN
    failures := array_append(failures,
      'a timeline that ends early was not rejected: ' || coalesce(reason, 'ACCEPTED'));
  END IF;

  -- THE STROBE FLOOR. "No overlap" alone still admits 30ms shots; the floor is
  -- what stops a photosensitivity hazard reaching the viewer of a public page.
  reason := pg_temp.submit_reject_reason(
    draft,
    jsonb_set(
      jsonb_set(pg_temp.canon(), '{shots,0,endMs}', '1199'::JSONB),
      '{shots,1,startMs}', '1199'::JSONB
    )
  );
  IF reason IS DISTINCT FROM 'every pitch scene shot must last at least 1200ms' THEN
    failures := array_append(failures,
      'a 1199ms shot was not rejected: ' || coalesce(reason, 'ACCEPTED'));
  END IF;
  -- Boundary control: exactly 1200ms is allowed.
  reason := pg_temp.submit_reject_reason(
    draft,
    jsonb_set(
      jsonb_set(pg_temp.canon(), '{shots,0,endMs}', '1200'::JSONB),
      '{shots,1,startMs}', '1200'::JSONB
    )
  );
  IF reason IS NOT NULL THEN
    failures := array_append(failures, 'an exactly-1200ms shot was rejected: ' || reason);
  END IF;
  reason := pg_temp.submit_reject_reason(
    draft,
    jsonb_set(
      jsonb_set(pg_temp.canon(), '{shots,0,endMs}', '4501'::JSONB),
      '{shots,1,startMs}', '4501'::JSONB
    )
  );
  IF reason IS DISTINCT FROM 'no pitch scene shot may last longer than 4500ms' THEN
    failures := array_append(failures,
      'a 4501ms shot was not rejected: ' || coalesce(reason, 'ACCEPTED'));
  END IF;
  -- A text card's reveal is momentary and cannot fill the rest of a long card.
  reason := pg_temp.submit_reject_reason(
    draft,
    jsonb_set(
      jsonb_set(pg_temp.canon(), '{shots,3,endMs}', '10200'::JSONB),
      '{shots,4,startMs}', '10200'::JSONB
    )
  );
  IF reason IS DISTINCT FROM 'a pitch scene text card may not last longer than 2500ms' THEN
    failures := array_append(failures,
      'a 2600ms text card was not rejected: ' || coalesce(reason, 'ACCEPTED'));
  END IF;

  -- Crops: inside [0,1], square, inside the frame, and never tighter than the
  -- level's zoom ceiling.
  reason := pg_temp.submit_reject_reason(
    draft, jsonb_set(pg_temp.canon(), '{shots,1,crop,width}', '1.2'::JSONB)
  );
  IF reason IS DISTINCT FROM
     'pitch scene crop must carry an x, a y, a width and a height between 0 and 1' THEN
    failures := array_append(failures,
      'a crop wider than the frame was not rejected: ' || coalesce(reason, 'ACCEPTED'));
  END IF;
  reason := pg_temp.submit_reject_reason(
    draft, jsonb_set(pg_temp.canon(), '{shots,2,crop,height}', '0.68'::JSONB)
  );
  IF reason IS DISTINCT FROM 'pitch scene crop must be square, which is 9:16 in pixels' THEN
    failures := array_append(failures,
      'a non-square crop was not rejected: ' || coalesce(reason, 'ACCEPTED'));
  END IF;
  reason := pg_temp.submit_reject_reason(
    draft, jsonb_set(pg_temp.canon(), '{shots,2,crop,x}', '0.4'::JSONB)
  );
  IF reason IS DISTINCT FROM
     'pitch scene crop must stay inside the frame the dater reviewed' THEN
    failures := array_append(failures,
      'a crop reaching outside the frame was not rejected: '
      || coalesce(reason, 'ACCEPTED'));
  END IF;
  reason := pg_temp.submit_reject_reason(
    draft,
    jsonb_set(
      jsonb_set(pg_temp.canon(), '{shots,1,crop,width}', '0.75'::JSONB),
      '{shots,1,crop,height}', '0.75'::JSONB
    )
  );
  IF reason IS DISTINCT FROM 'pitch scene shot may not zoom past the ceiling for its level' THEN
    failures := array_append(failures,
      'a punchIn crop tighter than 1.25x was not rejected: '
      || coalesce(reason, 'ACCEPTED'));
  END IF;
  -- The ceiling is on COMPOSED zoom: a crop at the limit plus a punch is over it.
  reason := pg_temp.submit_reject_reason(
    draft,
    jsonb_set(
      jsonb_set(
        jsonb_set(pg_temp.canon(), '{shots,1,crop,width}', '0.8'::JSONB),
        '{shots,1,crop,height}', '0.8'::JSONB
      ),
      '{shots,1,effects,0,scale}', '1.05'::JSONB
    )
  );
  IF reason IS DISTINCT FROM 'pitch scene shot may not zoom past the ceiling for its level' THEN
    failures := array_append(failures,
      'a punch past the level ceiling was not rejected: ' || coalesce(reason, 'ACCEPTED'));
  END IF;
  -- The same rule applies to where a kenBurns travels TO.
  reason := pg_temp.submit_reject_reason(
    draft,
    jsonb_set(
      pg_temp.canon(), '{shots,0,effects,0,to}',
      '{"x":0.02,"y":0.02,"width":0.9,"height":0.9}'::JSONB
    )
  );
  IF reason IS DISTINCT FROM 'pitch scene shot may not zoom past the ceiling for its level' THEN
    failures := array_append(failures,
      'a kenBurns past the level ceiling was not rejected: '
      || coalesce(reason, 'ACCEPTED'));
  END IF;

  IF array_length(failures, 1) IS NOT NULL THEN
    RAISE EXCEPTION '25_motion_scene_v2 shot failures: %', array_to_string(failures, ' | ');
  END IF;
END;
$$;

-- ── (C) The effect vocabulary ───────────────────────────────────────────
DO $$
DECLARE
  failures TEXT[] := ARRAY[]::TEXT[];
  draft CONSTANT UUID := '25000000-0000-0000-0000-000000000001';
  introducer CONSTANT UUID := '00000000-0000-0000-0000-000000000001';
  reason TEXT;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', introducer::text, true);

  reason := pg_temp.submit_reject_reason(
    draft, jsonb_set(pg_temp.canon(), '{shots,1,effects}', '"none"'::JSONB)
  );
  IF reason IS DISTINCT FROM 'pitch scene shot effects must be a list of at most 8 effects' THEN
    failures := array_append(failures,
      'a non-list effects value was not rejected: ' || coalesce(reason, 'ACCEPTED'));
  END IF;
  -- An unknown effect is a REFUSAL, not something a renderer skips. That is
  -- what makes "effects only, original pixels preserved" a code guarantee.
  reason := pg_temp.submit_reject_reason(
    draft, jsonb_set(pg_temp.canon(), '{shots,1,effects,0,type}', '"parallax"'::JSONB)
  );
  IF reason IS DISTINCT FROM
     'pitch scene effect type must be kenBurns, punch, wordPop or backdropBlur' THEN
    failures := array_append(failures,
      'an unknown effect type was not rejected: ' || coalesce(reason, 'ACCEPTED'));
  END IF;
  reason := pg_temp.submit_reject_reason(
    draft,
    jsonb_set(
      pg_temp.canon(), '{shots,0,effects,0}',
      (pg_temp.canon() -> 'shots' -> 0 -> 'effects' -> 0) || '{"durationMs": 200}'::JSONB
    )
  );
  IF reason IS DISTINCT FROM 'pitch scene kenBurns must carry only type, to and easing' THEN
    failures := array_append(failures,
      'an extra kenBurns key was not rejected: ' || coalesce(reason, 'ACCEPTED'));
  END IF;
  reason := pg_temp.submit_reject_reason(
    draft, jsonb_set(pg_temp.canon(), '{shots,0,effects,0,easing}', '"bounce"'::JSONB)
  );
  IF reason IS DISTINCT FROM
     'pitch scene easing must be linear, easeIn, easeOut or easeInOut' THEN
    failures := array_append(failures,
      'an unknown easing was not rejected: ' || coalesce(reason, 'ACCEPTED'));
  END IF;

  -- punch.
  reason := pg_temp.submit_reject_reason(
    draft, jsonb_set(pg_temp.canon(), '{shots,1,effects,0,scale}', '1.2'::JSONB)
  );
  IF reason IS DISTINCT FROM
     'pitch scene punch must last 80ms to 400ms and scale between 1.02x and 1.12x' THEN
    failures := array_append(failures,
      'a 1.2x punch was not rejected: ' || coalesce(reason, 'ACCEPTED'));
  END IF;
  reason := pg_temp.submit_reject_reason(
    draft, jsonb_set(pg_temp.canon(), '{shots,1,effects,0,atMs}', '5300'::JSONB)
  );
  IF reason IS DISTINCT FROM 'pitch scene punch must start and end inside its own shot' THEN
    failures := array_append(failures,
      'a punch spilling past its shot was not rejected: ' || coalesce(reason, 'ACCEPTED'));
  END IF;
  reason := pg_temp.submit_reject_reason(
    draft,
    pg_temp.with_effects(pg_temp.canon(), 1, $probe$[
      {"type":"punch","atMs":3100,"durationMs":100,"scale":1.05,"easing":"easeOut"},
      {"type":"punch","atMs":3600,"durationMs":100,"scale":1.05,"easing":"easeOut"},
      {"type":"punch","atMs":4100,"durationMs":100,"scale":1.05,"easing":"easeOut"},
      {"type":"punch","atMs":4600,"durationMs":100,"scale":1.05,"easing":"easeOut"}
    ]$probe$::JSONB)
  );
  IF reason IS DISTINCT FROM 'pitch scene shot may carry at most 3 punches' THEN
    failures := array_append(failures,
      'a fourth punch was not rejected: ' || coalesce(reason, 'ACCEPTED'));
  END IF;

  -- wordPop. The reference is {segmentIndex, wordIndex}; there is no word text
  -- anywhere in a scene.
  reason := pg_temp.submit_reject_reason(
    draft,
    jsonb_set(
      pg_temp.canon(), '{shots,1,effects,1}',
      (pg_temp.canon() -> 'shots' -> 1 -> 'effects' -> 1) - 'scale'
    )
  );
  IF reason IS DISTINCT FROM
     'pitch scene wordPop must carry only type, word, startMs, endMs, scale and easing' THEN
    failures := array_append(failures,
      'a wordPop missing its scale was not rejected: ' || coalesce(reason, 'ACCEPTED'));
  END IF;
  reason := pg_temp.submit_reject_reason(
    draft,
    jsonb_set(pg_temp.canon(), '{shots,1,effects,1,word}', '{"word": "kind"}'::JSONB)
  );
  IF reason IS DISTINCT FROM
     'pitch scene wordPop must reference a word by segmentIndex and wordIndex' THEN
    failures := array_append(failures,
      'a wordPop carrying the word itself was not rejected: '
      || coalesce(reason, 'ACCEPTED'));
  END IF;
  reason := pg_temp.submit_reject_reason(
    draft, jsonb_set(pg_temp.canon(), '{shots,1,effects,1,scale}', '1.7'::JSONB)
  );
  IF reason IS DISTINCT FROM
     'pitch scene wordPop must carry whole millisecond times and a scale between 1x and 1.6x' THEN
    failures := array_append(failures,
      'a 1.7x wordPop was not rejected: ' || coalesce(reason, 'ACCEPTED'));
  END IF;
  reason := pg_temp.submit_reject_reason(
    draft, jsonb_set(pg_temp.canon(), '{shots,1,effects,1,endMs}', '5500'::JSONB)
  );
  IF reason IS DISTINCT FROM 'pitch scene wordPop must start and end inside its own shot' THEN
    failures := array_append(failures,
      'a wordPop spilling past its shot was not rejected: ' || coalesce(reason, 'ACCEPTED'));
  END IF;
  reason := pg_temp.submit_reject_reason(
    draft, jsonb_set(pg_temp.canon(), '{shots,1,effects,1,endMs}', '4400'::JSONB)
  );
  IF reason IS DISTINCT FROM 'pitch scene wordPop must last between 120ms and 1200ms' THEN
    failures := array_append(failures,
      'a 100ms wordPop was not rejected: ' || coalesce(reason, 'ACCEPTED'));
  END IF;
  reason := pg_temp.submit_reject_reason(
    draft,
    pg_temp.with_effects(pg_temp.canon(), 1, $probe$[
      {"type":"wordPop","word":{"segmentIndex":0,"wordIndex":0},"startMs":3100,"endMs":3300,"scale":1.2,"easing":"easeOut"},
      {"type":"wordPop","word":{"segmentIndex":0,"wordIndex":1},"startMs":3400,"endMs":3600,"scale":1.2,"easing":"easeOut"},
      {"type":"wordPop","word":{"segmentIndex":0,"wordIndex":2},"startMs":3700,"endMs":3900,"scale":1.2,"easing":"easeOut"},
      {"type":"wordPop","word":{"segmentIndex":0,"wordIndex":3},"startMs":4000,"endMs":4200,"scale":1.2,"easing":"easeOut"},
      {"type":"wordPop","word":{"segmentIndex":0,"wordIndex":4},"startMs":4300,"endMs":4500,"scale":1.2,"easing":"easeOut"}
    ]$probe$::JSONB)
  );
  IF reason IS DISTINCT FROM 'pitch scene shot may carry at most 4 wordPops' THEN
    failures := array_append(failures,
      'a fifth wordPop was not rejected: ' || coalesce(reason, 'ACCEPTED'));
  END IF;

  -- backdropBlur, and the "at most one" bounds.
  reason := pg_temp.submit_reject_reason(
    draft, jsonb_set(pg_temp.canon(), '{shots,2,effects,0,radiusPx}', '4'::JSONB)
  );
  IF reason IS DISTINCT FROM
     'pitch scene backdropBlur must carry a radiusPx of 8px to 64px and a dim of at most 0.6' THEN
    failures := array_append(failures,
      'a 4px blur was not rejected: ' || coalesce(reason, 'ACCEPTED'));
  END IF;
  reason := pg_temp.submit_reject_reason(
    draft,
    pg_temp.with_effects(pg_temp.canon(), 0, $probe$[
      {"type":"kenBurns","to":{"x":0.02,"y":0.02,"width":0.96,"height":0.96},"easing":"easeInOut"},
      {"type":"kenBurns","to":{"x":0,"y":0,"width":0.97,"height":0.97},"easing":"linear"}
    ]$probe$::JSONB)
  );
  IF reason IS DISTINCT FROM 'pitch scene shot may carry at most one kenBurns' THEN
    failures := array_append(failures,
      'a second kenBurns was not rejected: ' || coalesce(reason, 'ACCEPTED'));
  END IF;
  reason := pg_temp.submit_reject_reason(
    draft,
    pg_temp.with_effects(pg_temp.canon(), 2, $probe$[
      {"type":"backdropBlur","radiusPx":24,"dim":0.3},
      {"type":"backdropBlur","radiusPx":32,"dim":0.2}
    ]$probe$::JSONB)
  );
  IF reason IS DISTINCT FROM 'pitch scene shot may carry at most one backdropBlur' THEN
    failures := array_append(failures,
      'a second backdropBlur was not rejected: ' || coalesce(reason, 'ACCEPTED'));
  END IF;
  reason := pg_temp.submit_reject_reason(
    draft,
    pg_temp.with_effects(pg_temp.canon(), 2, $probe$[
      {"type":"backdropBlur","radiusPx":8,"dim":0.1},
      {"type":"backdropBlur","radiusPx":9,"dim":0.1},
      {"type":"backdropBlur","radiusPx":10,"dim":0.1},
      {"type":"backdropBlur","radiusPx":11,"dim":0.1},
      {"type":"backdropBlur","radiusPx":12,"dim":0.1},
      {"type":"backdropBlur","radiusPx":13,"dim":0.1},
      {"type":"backdropBlur","radiusPx":14,"dim":0.1},
      {"type":"backdropBlur","radiusPx":15,"dim":0.1},
      {"type":"backdropBlur","radiusPx":16,"dim":0.1}
    ]$probe$::JSONB)
  );
  IF reason IS DISTINCT FROM 'pitch scene shot effects must be a list of at most 8 effects' THEN
    failures := array_append(failures,
      'a ninth effect was not rejected: ' || coalesce(reason, 'ACCEPTED'));
  END IF;

  -- The text card.
  reason := pg_temp.submit_reject_reason(
    draft, jsonb_set(pg_temp.canon(), '{shots,3,text,type}', '"kineticTextV3"'::JSONB)
  );
  IF reason IS DISTINCT FROM
     'pitch scene text card must carry only a kineticText with type, source, revealMs, easing and emphasis' THEN
    failures := array_append(failures,
      'an unknown text effect was not rejected: ' || coalesce(reason, 'ACCEPTED'));
  END IF;
  reason := pg_temp.submit_reject_reason(
    draft, jsonb_set(pg_temp.canon(), '{shots,3,text,source}', '"nickname"'::JSONB)
  );
  IF reason IS DISTINCT FROM
     'pitch scene text source must name a reviewed structure field' THEN
    failures := array_append(failures,
      'an unknown text source was not rejected: ' || coalesce(reason, 'ACCEPTED'));
  END IF;
  reason := pg_temp.submit_reject_reason(
    draft, jsonb_set(pg_temp.canon(), '{shots,3,text,revealMs}', '900'::JSONB)
  );
  IF reason IS DISTINCT FROM 'pitch scene text reveal must last between 80ms and 800ms' THEN
    failures := array_append(failures,
      'a 900ms reveal was not rejected: ' || coalesce(reason, 'ACCEPTED'));
  END IF;
  reason := pg_temp.submit_reject_reason(
    draft, jsonb_set(pg_temp.canon(), '{shots,3,text,emphasis}', '1.5'::JSONB)
  );
  IF reason IS DISTINCT FROM 'pitch scene emphasis must be between 0 and 1' THEN
    failures := array_append(failures,
      'an emphasis above 1 was not rejected: ' || coalesce(reason, 'ACCEPTED'));
  END IF;

  IF array_length(failures, 1) IS NOT NULL THEN
    RAISE EXCEPTION '25_motion_scene_v2 effect failures: %', array_to_string(failures, ' | ');
  END IF;
END;
$$;

-- ── (D) Look, chrome, overlays, and the flash budget ────────────────────
DO $$
DECLARE
  failures TEXT[] := ARRAY[]::TEXT[];
  draft CONSTANT UUID := '25000000-0000-0000-0000-000000000001';
  introducer CONSTANT UUID := '00000000-0000-0000-0000-000000000001';
  reason TEXT;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', introducer::text, true);

  reason := pg_temp.submit_reject_reason(
    draft,
    jsonb_set(pg_temp.canon(), '{look}', (pg_temp.canon() -> 'look') - 'grain')
  );
  IF reason IS DISTINCT FROM 'pitch scene look must carry only a grade and a grain' THEN
    failures := array_append(failures,
      'a look with no grain was not rejected: ' || coalesce(reason, 'ACCEPTED'));
  END IF;
  reason := pg_temp.submit_reject_reason(
    draft, jsonb_set(pg_temp.canon(), '{look,grade,contrast}', '1.5'::JSONB)
  );
  IF reason IS DISTINCT FROM
     'pitch scene grade must carry a warmth, a contrast, a saturation and a vignette in range' THEN
    failures := array_append(failures,
      'a 1.5 contrast was not rejected: ' || coalesce(reason, 'ACCEPTED'));
  END IF;
  -- Grain's safety bound is amplitude, not frequency: it may resample up to
  -- frame rate, but its luminance swing is capped.
  reason := pg_temp.submit_reject_reason(
    draft, jsonb_set(pg_temp.canon(), '{look,grain,intensity}', '0.3'::JSONB)
  );
  IF reason IS DISTINCT FROM
     'pitch scene grain must carry an intensity, a sizePx, a seed and an animationHz in range' THEN
    failures := array_append(failures,
      'a 0.3 grain intensity was not rejected: ' || coalesce(reason, 'ACCEPTED'));
  END IF;
  reason := pg_temp.submit_reject_reason(
    draft, jsonb_set(pg_temp.canon(), '{look,grain,animationHz}', '31'::JSONB)
  );
  IF reason IS DISTINCT FROM
     'pitch scene grain must carry an intensity, a sizePx, a seed and an animationHz in range' THEN
    failures := array_append(failures,
      'a 31Hz grain was not rejected: ' || coalesce(reason, 'ACCEPTED'));
  END IF;
  -- 30Hz grain IS allowed: holding sub-pixel texture to 3Hz would turn it into
  -- a visible flicker, which is the opposite of the safety goal.
  reason := pg_temp.submit_reject_reason(
    draft, jsonb_set(pg_temp.canon(), '{look,grain,animationHz}', '30'::JSONB)
  );
  IF reason IS NOT NULL THEN
    failures := array_append(failures, '30Hz grain was rejected: ' || reason);
  END IF;

  reason := pg_temp.submit_reject_reason(
    draft,
    jsonb_set(
      pg_temp.canon(), '{chrome}',
      (pg_temp.canon() -> 'chrome') || '{"ticker": {"speed": 2}}'::JSONB
    )
  );
  IF reason IS DISTINCT FROM 'pitch scene chrome must carry only a progressBar and a waveViz' THEN
    failures := array_append(failures,
      'an unknown chrome element was not rejected: ' || coalesce(reason, 'ACCEPTED'));
  END IF;
  reason := pg_temp.submit_reject_reason(
    draft, jsonb_set(pg_temp.canon(), '{chrome,progressBar,thicknessPx}', '1'::JSONB)
  );
  IF reason IS DISTINCT FROM
     'pitch scene progressBar must carry a thicknessPx, an opacity and an anchor in range' THEN
    failures := array_append(failures,
      'a 1px progress bar was not rejected: ' || coalesce(reason, 'ACCEPTED'));
  END IF;
  reason := pg_temp.submit_reject_reason(
    draft, jsonb_set(pg_temp.canon(), '{chrome,waveViz,anchor}', '"middle"'::JSONB)
  );
  IF reason IS DISTINCT FROM
     'pitch scene waveViz must carry amplitudes, a sampleIntervalMs, a heightPx, an opacity and an anchor in range' THEN
    failures := array_append(failures,
      'an unknown waveViz anchor was not rejected: ' || coalesce(reason, 'ACCEPTED'));
  END IF;
  -- The envelope is baked, so it must cover the whole scene exactly.
  reason := pg_temp.submit_reject_reason(
    draft, jsonb_set(pg_temp.canon(), '{chrome,waveViz,sampleIntervalMs}', '200'::JSONB)
  );
  IF reason IS DISTINCT FROM 'pitch scene waveViz must carry one amplitude per sample interval' THEN
    failures := array_append(failures,
      'a half-length envelope was not rejected: ' || coalesce(reason, 'ACCEPTED'));
  END IF;
  -- Chrome is entirely optional.
  reason := pg_temp.submit_reject_reason(
    draft, jsonb_set(pg_temp.canon(), '{chrome}', '{}'::JSONB)
  );
  IF reason IS NOT NULL THEN
    failures := array_append(failures, 'an empty chrome was rejected: ' || reason);
  END IF;

  reason := pg_temp.submit_reject_reason(
    draft, jsonb_set(pg_temp.canon(), '{overlays}', '{}'::JSONB)
  );
  IF reason IS DISTINCT FROM 'pitch scene overlays must be a list of at most 64 overlays' THEN
    failures := array_append(failures,
      'a non-list overlays value was not rejected: ' || coalesce(reason, 'ACCEPTED'));
  END IF;
  reason := pg_temp.submit_reject_reason(
    draft, jsonb_set(pg_temp.canon(), '{overlays,0,type}', '"sticker"'::JSONB)
  );
  IF reason IS DISTINCT FROM 'pitch scene overlay type must be lightLeak or countBadge' THEN
    failures := array_append(failures,
      'an unknown overlay was not rejected: ' || coalesce(reason, 'ACCEPTED'));
  END IF;
  reason := pg_temp.submit_reject_reason(
    draft, jsonb_set(pg_temp.canon(), '{overlays,0,startMs}', '5500.5'::JSONB)
  );
  IF reason IS DISTINCT FROM
     'pitch scene overlay must carry a whole millisecond startMs and endMs' THEN
    failures := array_append(failures,
      'a fractional overlay time was not rejected: ' || coalesce(reason, 'ACCEPTED'));
  END IF;
  reason := pg_temp.submit_reject_reason(
    draft, jsonb_set(pg_temp.canon(), '{overlays,1,endMs}', '14500'::JSONB)
  );
  IF reason IS DISTINCT FROM 'pitch scene overlay must end within the scene' THEN
    failures := array_append(failures,
      'an overlay past the end was not rejected: ' || coalesce(reason, 'ACCEPTED'));
  END IF;
  reason := pg_temp.submit_reject_reason(
    draft,
    jsonb_set(
      pg_temp.canon(), '{overlays,1}', (pg_temp.canon() -> 'overlays' -> 1) - 'angleDeg'
    )
  );
  IF reason IS DISTINCT FROM
     'pitch scene lightLeak must carry only type, startMs, endMs, peakIntensity, pulseHz and angleDeg' THEN
    failures := array_append(failures,
      'a lightLeak with no angle was not rejected: ' || coalesce(reason, 'ACCEPTED'));
  END IF;
  -- THE 3Hz CEILING on oscillating luminance.
  reason := pg_temp.submit_reject_reason(
    draft, jsonb_set(pg_temp.canon(), '{overlays,1,pulseHz}', '4'::JSONB)
  );
  IF reason IS DISTINCT FROM
     'pitch scene lightLeak must carry a peakIntensity, a whole-number pulseHz of at most 3 and an angleDeg in range' THEN
    failures := array_append(failures,
      'a 4Hz light leak was not rejected: ' || coalesce(reason, 'ACCEPTED'));
  END IF;
  -- A FRACTIONAL Hz is refused, and not because it is out of range. The pulse
  -- peaks are floor(k * 1000 / pulseHz); with 2.5Hz the PL/pgSQL NUMERIC
  -- division, the builder's float division and zod's can straddle an integer
  -- boundary, and the three implementations would then disagree about which
  -- peaks exist. A whole number makes them the same arithmetic.
  reason := pg_temp.submit_reject_reason(
    draft, jsonb_set(pg_temp.canon(), '{overlays,1,pulseHz}', '2.5'::JSONB)
  );
  IF reason IS DISTINCT FROM
     'pitch scene lightLeak must carry a peakIntensity, a whole-number pulseHz of at most 3 and an angleDeg in range' THEN
    failures := array_append(failures,
      'a 2.5Hz light leak was not rejected: ' || coalesce(reason, 'ACCEPTED'));
  END IF;
  reason := pg_temp.submit_reject_reason(
    draft, jsonb_set(pg_temp.canon(), '{overlays,1,endMs}', '7500'::JSONB)
  );
  IF reason IS DISTINCT FROM 'a pitch scene lightLeak must last between 120ms and 1200ms' THEN
    failures := array_append(failures,
      'a 100ms light leak was not rejected: ' || coalesce(reason, 'ACCEPTED'));
  END IF;
  reason := pg_temp.submit_reject_reason(
    draft,
    jsonb_set(
      pg_temp.canon(), '{overlays,0}', (pg_temp.canon() -> 'overlays' -> 0) - 'emphasis'
    )
  );
  IF reason IS DISTINCT FROM
     'pitch scene countBadge must carry only type, source, startMs, endMs and emphasis' THEN
    failures := array_append(failures,
      'a countBadge with no emphasis was not rejected: ' || coalesce(reason, 'ACCEPTED'));
  END IF;
  reason := pg_temp.submit_reject_reason(
    draft, jsonb_set(pg_temp.canon(), '{overlays,0,source}', '"quality:9"'::JSONB)
  );
  IF reason IS DISTINCT FROM 'pitch scene text source must name a reviewed structure field' THEN
    failures := array_append(failures,
      'a fourth quality was not rejected: ' || coalesce(reason, 'ACCEPTED'));
  END IF;
  reason := pg_temp.submit_reject_reason(
    draft, jsonb_set(pg_temp.canon(), '{overlays,0,endMs}', '5800'::JSONB)
  );
  IF reason IS DISTINCT FROM 'a pitch scene countBadge must last between 400ms and 4000ms' THEN
    failures := array_append(failures,
      'a 300ms count badge was not rejected: ' || coalesce(reason, 'ACCEPTED'));
  END IF;
  reason := pg_temp.submit_reject_reason(
    draft,
    jsonb_set(
      pg_temp.canon(), '{overlays}',
      (pg_temp.canon() -> 'overlays')
        || $probe$[{"type":"countBadge","source":"quality:1","startMs":6000,"endMs":7000,"emphasis":0.5}]$probe$::JSONB
    )
  );
  IF reason IS DISTINCT FROM
     'pitch scene overlays of one type must be ordered and must not overlap' THEN
    failures := array_append(failures,
      'overlapping count badges were not rejected: ' || coalesce(reason, 'ACCEPTED'));
  END IF;

  -- THE FLASH BUDGET, over the UNION of every instantaneous luminance or
  -- appearance event. The canonical timeline is 3600 (punch), 4300 (wordPop),
  -- 5500 (countBadge), 6000 (wordPop), 7400 (lightLeak peak) and 10200 (punch);
  -- its closest pair is 500ms apart, so every probe below is about the mutation.
  reason := pg_temp.submit_reject_reason(
    draft,
    jsonb_set(
      jsonb_set(pg_temp.canon(), '{overlays,1,startMs}', '3700'::JSONB),
      '{overlays,1,endMs}', '4000'::JSONB
    )
  );
  IF reason IS DISTINCT FROM 'pitch scene flashes must be at least 334ms apart' THEN
    failures := array_append(failures,
      'a light leak 100ms after a punch was not rejected: ' || coalesce(reason, 'ACCEPTED'));
  END IF;
  -- Boundary control: exactly 334ms apart is allowed. 10200 is shot 4's punch and
  -- nothing else stands within 334ms of 10534, so this isolates the comparison.
  reason := pg_temp.submit_reject_reason(
    draft,
    jsonb_set(
      jsonb_set(pg_temp.canon(), '{overlays,1,startMs}', '10534'::JSONB),
      '{overlays,1,endMs}', '10800'::JSONB
    )
  );
  IF reason IS NOT NULL THEN
    failures := array_append(failures,
      'a light leak exactly 334ms after a punch was rejected: ' || reason);
  END IF;
  -- A wordPop APPEARING is on the same budget: shot 1 punches at 3600, so a word
  -- arriving 200ms later is a second event inside the same fifth of a second, and
  -- it does not stop being one because the layer that drew it is called text.
  reason := pg_temp.submit_reject_reason(
    draft,
    jsonb_set(
      jsonb_set(pg_temp.canon(), '{shots,1,effects,1,startMs}', '3800'::JSONB),
      '{shots,1,effects,1,endMs}', '4200'::JSONB
    )
  );
  IF reason IS DISTINCT FROM 'pitch scene flashes must be at least 334ms apart' THEN
    failures := array_append(failures,
      'a wordPop 200ms after a punch was not rejected: ' || coalesce(reason, 'ACCEPTED'));
  END IF;
  -- A countBadge ARRIVING is on it too: the badge brings a scrim with it. Shot 2's
  -- wordPop appears at 6000, so a badge at 5900 is 100ms away from it.
  reason := pg_temp.submit_reject_reason(
    draft,
    jsonb_set(
      jsonb_set(pg_temp.canon(), '{overlays,0,startMs}', '5900'::JSONB),
      '{overlays,0,endMs}', '6900'::JSONB
    )
  );
  IF reason IS DISTINCT FROM 'pitch scene flashes must be at least 334ms apart' THEN
    failures := array_append(failures,
      'a count badge 100ms before a wordPop was not rejected: '
      || coalesce(reason, 'ACCEPTED'));
  END IF;
  -- Two wordPops in one shot are on it as well, which is the rule that decides
  -- how fast words may arrive. 4300 and 4600 are both inside shot 1.
  reason := pg_temp.submit_reject_reason(
    draft,
    pg_temp.with_effects(pg_temp.canon(), 1, $probe$[
      {"type":"wordPop","word":{"segmentIndex":0,"wordIndex":0},"startMs":4300,"endMs":4500,"scale":1.2,"easing":"easeOut"},
      {"type":"wordPop","word":{"segmentIndex":0,"wordIndex":1},"startMs":4600,"endMs":4800,"scale":1.2,"easing":"easeOut"}
    ]$probe$::JSONB)
  );
  IF reason IS DISTINCT FROM 'pitch scene flashes must be at least 334ms apart' THEN
    failures := array_append(failures,
      'two wordPops 300ms apart were not rejected: ' || coalesce(reason, 'ACCEPTED'));
  END IF;

  -- A PULSING LEAK IS EXPANDED, NOT COUNTED ONCE. The next two probes use the
  -- SAME 1200ms window and differ only in pulseHz, so nothing but the expansion
  -- can explain the two verdicts. At 2Hz the peaks are 9700, 10200 and 10700, and
  -- 10200 is exactly where shot 4 punches.
  reason := pg_temp.submit_reject_reason(
    draft,
    jsonb_set(
      jsonb_set(
        jsonb_set(pg_temp.canon(), '{overlays,1,startMs}', '9700'::JSONB),
        '{overlays,1,endMs}', '10900'::JSONB
      ),
      '{overlays,1,pulseHz}', '2'::JSONB
    )
  );
  IF reason IS DISTINCT FROM 'pitch scene flashes must be at least 334ms apart' THEN
    failures := array_append(failures,
      'a 2Hz leak whose inner peak lands on a punch was not rejected: '
      || coalesce(reason, 'ACCEPTED'));
  END IF;
  -- 0Hz over the same window is "appears once, never oscillates": one event at
  -- 9700, 500ms clear of the punch.
  reason := pg_temp.submit_reject_reason(
    draft,
    jsonb_set(
      jsonb_set(
        jsonb_set(pg_temp.canon(), '{overlays,1,startMs}', '9700'::JSONB),
        '{overlays,1,endMs}', '10900'::JSONB
      ),
      '{overlays,1,pulseHz}', '0'::JSONB
    )
  );
  IF reason IS NOT NULL THEN
    failures := array_append(failures,
      'a 0Hz leak over the same window was rejected: ' || reason);
  END IF;
  -- A 3Hz leak is refused as soon as it is long enough to oscillate at all: its
  -- own peaks are 333ms apart, which is under the budget. 3Hz survives in the
  -- schema only for a leak short enough to deliver a single peak.
  reason := pg_temp.submit_reject_reason(
    draft,
    jsonb_set(
      jsonb_set(
        jsonb_set(pg_temp.canon(), '{overlays,1,startMs}', '12500'::JSONB),
        '{overlays,1,endMs}', '13700'::JSONB
      ),
      '{overlays,1,pulseHz}', '3'::JSONB
    )
  );
  IF reason IS DISTINCT FROM 'pitch scene flashes must be at least 334ms apart' THEN
    failures := array_append(failures,
      'a 3Hz leak with four peaks 333ms apart was not rejected: '
      || coalesce(reason, 'ACCEPTED'));
  END IF;

  -- THE INTERVAL IS HALF-OPEN. Both probes are a 1Hz leak starting at 9500, so
  -- both have a candidate peak at 10500; only the longer one is still drawn when
  -- it arrives, and 10500 is 300ms from shot 4's punch at 10200.
  reason := pg_temp.submit_reject_reason(
    draft,
    jsonb_set(
      jsonb_set(
        jsonb_set(pg_temp.canon(), '{overlays,1,startMs}', '9500'::JSONB),
        '{overlays,1,endMs}', '10500'::JSONB
      ),
      '{overlays,1,pulseHz}', '1'::JSONB
    )
  );
  IF reason IS NOT NULL THEN
    failures := array_append(failures,
      'a peak landing exactly on endMs was counted: ' || reason);
  END IF;
  reason := pg_temp.submit_reject_reason(
    draft,
    jsonb_set(
      jsonb_set(
        jsonb_set(pg_temp.canon(), '{overlays,1,startMs}', '9500'::JSONB),
        '{overlays,1,endMs}', '10700'::JSONB
      ),
      '{overlays,1,pulseHz}', '1'::JSONB
    )
  );
  IF reason IS DISTINCT FROM 'pitch scene flashes must be at least 334ms apart' THEN
    failures := array_append(failures,
      'a peak inside the leak was not counted: ' || coalesce(reason, 'ACCEPTED'));
  END IF;

  IF array_length(failures, 1) IS NOT NULL THEN
    RAISE EXCEPTION '25_motion_scene_v2 look/overlay failures: %',
      array_to_string(failures, ' | ');
  END IF;
END;
$$;

-- ── (E) The two references a scene cannot prove about itself ────────────
-- Both checks are against THE SAME ROW the scene is being written onto, which
-- is why the fixture is edited in place here rather than probed on a second
-- draft: it is the row's transcript and the row's structure that decide.
DO $$
DECLARE
  failures TEXT[] := ARRAY[]::TEXT[];
  draft CONSTANT UUID := '25000000-0000-0000-0000-000000000001';
  introducer CONSTANT UUID := '00000000-0000-0000-0000-000000000001';
  saved_transcript JSONB;
  saved_structure JSONB;
  reason TEXT;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', introducer::text, true);
  SELECT transcript, structure INTO saved_transcript, saved_structure
    FROM public.pitch_drafts WHERE id = draft;

  -- (a) A recording transcribed before word timings existed (pre-A7) has
  -- nothing for the player to lift.
  UPDATE public.pitch_drafts SET transcript = saved_transcript - 'words' WHERE id = draft;
  reason := pg_temp.submit_reject_reason(draft, pg_temp.canon());
  IF reason IS DISTINCT FROM
     'pitch scene may not lift a word from a recording with no word timings' THEN
    failures := array_append(failures,
      'a wordPop on a recording with no word timings was not rejected: '
      || coalesce(reason, 'ACCEPTED'));
  END IF;
  -- An empty word list is the same answer as no list at all.
  UPDATE public.pitch_drafts
     SET transcript = jsonb_set(saved_transcript, '{words}', '[]'::JSONB)
   WHERE id = draft;
  reason := pg_temp.submit_reject_reason(draft, pg_temp.canon());
  IF reason IS DISTINCT FROM
     'pitch scene may not lift a word from a recording with no word timings' THEN
    failures := array_append(failures,
      'a wordPop on an empty word list was not rejected: '
      || coalesce(reason, 'ACCEPTED'));
  END IF;
  UPDATE public.pitch_drafts SET transcript = saved_transcript WHERE id = draft;

  -- (a) The reference still has to resolve inside that transcript.
  reason := pg_temp.submit_reject_reason(
    draft, jsonb_set(pg_temp.canon(), '{shots,1,effects,1,word,segmentIndex}', '3'::JSONB)
  );
  IF reason IS DISTINCT FROM 'pitch scene wordPop references a word outside the transcript' THEN
    failures := array_append(failures,
      'a wordPop past the last segment was not rejected: ' || coalesce(reason, 'ACCEPTED'));
  END IF;
  reason := pg_temp.submit_reject_reason(
    draft, jsonb_set(pg_temp.canon(), '{shots,1,effects,1,word,wordIndex}', '10'::JSONB)
  );
  IF reason IS DISTINCT FROM 'pitch scene wordPop references a word outside the transcript' THEN
    failures := array_append(failures,
      'a wordPop past the last word was not rejected: ' || coalesce(reason, 'ACCEPTED'));
  END IF;

  -- (b) A card prints a sentence out of the reviewed structure, so the five
  -- published fields have to be there.
  UPDATE public.pitch_drafts SET structure = saved_structure - 'hook' WHERE id = draft;
  reason := pg_temp.submit_reject_reason(draft, pg_temp.canon());
  IF reason IS DISTINCT FROM 'pitch scene text requires the five reviewed structure fields' THEN
    failures := array_append(failures,
      'a text card on a structure with no hook was not rejected: '
      || coalesce(reason, 'ACCEPTED'));
  END IF;
  UPDATE public.pitch_drafts SET structure = NULL WHERE id = draft;
  reason := pg_temp.submit_reject_reason(draft, pg_temp.canon());
  IF reason IS DISTINCT FROM 'pitch scene text requires the five reviewed structure fields' THEN
    failures := array_append(failures,
      'a text card on a structureless draft was not rejected: '
      || coalesce(reason, 'ACCEPTED'));
  END IF;
  -- A scene with no text reference at all is unaffected by the structure.
  reason := pg_temp.submit_reject_reason(
    draft,
    jsonb_set(
      jsonb_set(
        pg_temp.canon(), '{overlays}',
        jsonb_build_array(pg_temp.canon() -> 'overlays' -> 1)
      ),
      '{shots,3}',
      $probe$
        {"level":"wideAlt","assetId":"25000000-0000-0000-0000-000000000213",
         "startMs":7600,"endMs":9800,"crop":{"x":0.1,"y":0.1,"width":0.86,"height":0.86},
         "effects":[]}
      $probe$::JSONB
    )
  );
  IF reason IS NOT NULL THEN
    failures := array_append(failures,
      'a text-free scene needed a structure: ' || reason);
  END IF;
  UPDATE public.pitch_drafts SET structure = saved_structure WHERE id = draft;

  -- No segments, no motion: there would be no reproducible duration to agree
  -- with, and a client-measured audio length varies by device.
  UPDATE public.pitch_drafts
     SET transcript = jsonb_set(saved_transcript, '{segments}', '[]'::JSONB)
   WHERE id = draft;
  reason := pg_temp.submit_reject_reason(draft, pg_temp.canon());
  IF reason IS DISTINCT FROM 'pitch scene requires transcript segments' THEN
    failures := array_append(failures,
      'a v2 scene on an unsegmented transcript was not rejected: '
      || coalesce(reason, 'ACCEPTED'));
  END IF;
  UPDATE public.pitch_drafts SET transcript = saved_transcript WHERE id = draft;

  IF array_length(failures, 1) IS NOT NULL THEN
    RAISE EXCEPTION '25_motion_scene_v2 reference failures: %',
      array_to_string(failures, ' | ');
  END IF;
END;
$$;

-- ── (F) A v1 write from an older bundle is still accepted ───────────────
DO $$
DECLARE
  failures TEXT[] := ARRAY[]::TEXT[];
  legacy CONSTANT UUID := '25000000-0000-0000-0000-000000000002';
  photo_one CONSTANT UUID := '25000000-0000-0000-0000-0000000002c1';
  photo_two CONSTANT UUID := '25000000-0000-0000-0000-000000000222';
  photo_three CONSTANT UUID := '25000000-0000-0000-0000-000000000223';
  introducer CONSTANT UUID := '00000000-0000-0000-0000-000000000001';
  legacy_scene JSONB;
  revision consent_revisions;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', introducer::text, true);

  -- An upper-case asset id and a 30.0 fps, exactly as 24_motion_scene pins
  -- them: the v1 canonical rebuild is untouched by 0049.
  legacy_scene := jsonb_build_object(
    'schemaVersion', 1,
    'canvas', jsonb_build_object('width', 1080, 'height', 1920, 'fps', 30.0),
    'durationMs', 8000,
    'scenes', jsonb_build_array(
      jsonb_build_object('assetId', upper(photo_one::TEXT), 'startMs', 0, 'endMs', 2500),
      jsonb_build_object('assetId', photo_two, 'startMs', 2500, 'endMs', 5250),
      jsonb_build_object('assetId', photo_three, 'startMs', 5250, 'endMs', 8000)
    )
  );

  PERFORM * FROM public.submit_pitch_for_consent(
    legacy, 'email', 'legacy@example.test', 'Blair', legacy_scene
  );

  SELECT * INTO revision
    FROM public.consent_revisions
   WHERE pitch_draft_id = legacy
   ORDER BY revision_number DESC
   LIMIT 1;
  IF revision.scene_definition IS NULL THEN
    failures := array_append(failures, 'the v1 scene from an older bundle was not stored');
  ELSIF revision.scene_definition ->> 'schemaVersion' IS DISTINCT FROM '1' THEN
    failures := array_append(failures, 'the stored v1 scene lost its schemaVersion');
  END IF;
  IF revision.scene_definition -> 'canvas' ->> 'fps' IS DISTINCT FROM '30' THEN
    failures := array_append(failures, 'the v1 canonical rebuild stopped normalizing 30.0 fps');
  END IF;
  IF revision.scene_definition -> 'scenes' -> 0 ->> 'assetId' IS DISTINCT FROM photo_one::TEXT THEN
    failures := array_append(failures, 'the v1 canonical rebuild stopped lower-casing asset ids');
  END IF;
  IF revision.scene_hash IS DISTINCT FROM
     encode(digest(revision.scene_definition::TEXT, 'sha256'), 'hex') THEN
    failures := array_append(failures, 'the v1 scene_hash is not the stored text digest');
  END IF;

  IF array_length(failures, 1) IS NOT NULL THEN
    RAISE EXCEPTION '25_motion_scene_v2 v1-compatibility failures: %',
      array_to_string(failures, ' | ');
  END IF;
END;
$$;

-- ── (G) The stored v2 snapshot and its canonical form ───────────────────
DO $$
DECLARE
  failures TEXT[] := ARRAY[]::TEXT[];
  draft CONSTANT UUID := '25000000-0000-0000-0000-000000000001';
  photo_one CONSTANT UUID := '25000000-0000-0000-0000-0000000002ab';
  introducer CONSTANT UUID := '00000000-0000-0000-0000-000000000001';
  submitted_scene JSONB;
  revision consent_revisions;
  raw_token TEXT;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', introducer::text, true);

  -- Upper-case ids, a 30.0 fps and a 1.100 punch scale: all three must
  -- normalize, so two clients that format JSON differently cannot produce two
  -- hashes for one timeline.
  submitted_scene := jsonb_set(
    jsonb_set(
      jsonb_set(
        jsonb_set(
          pg_temp.canon(), '{canvas,fps}', '30.0'::JSONB
        ),
        '{shots,1,effects,0,scale}', '1.100'::JSONB
      ),
      '{assetIds,0}', to_jsonb(upper(photo_one::TEXT))
    ),
    '{shots,0,assetId}', to_jsonb(upper(photo_one::TEXT))
  );

  SELECT consent_token INTO raw_token
    FROM public.submit_pitch_for_consent(
      draft, 'email', 'dater@example.test', 'Blair', submitted_scene
    );
  INSERT INTO d25_state (key, text_value) VALUES ('consent-token', raw_token);

  SELECT * INTO revision
    FROM public.consent_revisions
   WHERE pitch_draft_id = draft
   ORDER BY revision_number DESC
   LIMIT 1;

  IF revision.scene_definition IS NULL THEN
    failures := array_append(failures, 'the submitted v2 scene was not stored');
  END IF;
  IF revision.scene_definition ->> 'schemaVersion' IS DISTINCT FROM '2' THEN
    failures := array_append(failures, 'the stored scene is not v2');
  END IF;
  IF revision.scene_definition -> 'canvas' ->> 'fps' IS DISTINCT FROM '30' THEN
    failures := array_append(failures, 'a 30.0 fps was stored verbatim instead of canonically');
  END IF;
  IF revision.scene_definition -> 'shots' -> 1 -> 'effects' -> 0 ->> 'scale'
     IS DISTINCT FROM '1.1' THEN
    failures := array_append(failures, 'a 1.100 punch scale was not trimmed');
  END IF;
  IF revision.scene_definition -> 'assetIds' ->> 0 IS DISTINCT FROM photo_one::TEXT
     OR revision.scene_definition -> 'shots' -> 0 ->> 'assetId' IS DISTINCT FROM photo_one::TEXT THEN
    failures := array_append(failures, 'an asset id was not normalized to lower case');
  END IF;
  -- Canonicalization must not DROP anything: the whole shot list, the whole
  -- envelope, and the baked amplitudes all survive.
  IF jsonb_array_length(revision.scene_definition -> 'shots') <> 6
     OR (SELECT count(*) FROM jsonb_object_keys(revision.scene_definition)) <> 9
     OR jsonb_array_length(
          revision.scene_definition -> 'chrome' -> 'waveViz' -> 'amplitudes'
        ) <> 144
     OR jsonb_array_length(revision.scene_definition -> 'overlays') <> 2 THEN
    failures := array_append(failures, 'canonicalization dropped part of the scene');
  END IF;
  IF revision.scene_hash IS DISTINCT FROM
     encode(digest(revision.scene_definition::TEXT, 'sha256'), 'hex') THEN
    failures := array_append(failures,
      'scene_hash is not the sha256 of the stored scene_definition text');
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
    failures := array_append(failures, 'content_hash does not cover the v2 scene');
  END IF;
  -- The canonical form is a fixed point: canonicalizing it again changes
  -- nothing, so a re-hash of a stored scene cannot drift.
  IF private.canonical_pitch_json(revision.scene_definition)
     IS DISTINCT FROM revision.scene_definition THEN
    failures := array_append(failures, 'the canonical form is not a fixed point');
  END IF;

  IF array_length(failures, 1) IS NOT NULL THEN
    RAISE EXCEPTION '25_motion_scene_v2 snapshot failures: %',
      array_to_string(failures, ' | ');
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
    (SELECT text_value FROM d25_state WHERE key = 'consent-token')
  );
END;
$$;

-- ── (H) Carry-forward, demotion, and the Dater's own shot list ──────────
DO $$
DECLARE
  failures TEXT[] := ARRAY[]::TEXT[];
  draft CONSTANT UUID := '25000000-0000-0000-0000-000000000001';
  photo_one CONSTANT UUID := '25000000-0000-0000-0000-0000000002ab';
  photo_two CONSTANT UUID := '25000000-0000-0000-0000-000000000212';
  photo_three CONSTANT UUID := '25000000-0000-0000-0000-000000000213';
  photo_four CONSTANT UUID := '25000000-0000-0000-0000-000000000214';
  dater CONSTANT UUID := '00000000-0000-0000-0000-000000000002';
  all_photos CONSTANT UUID[] := ARRAY[photo_one, photo_two, photo_three, photo_four];
  submitted consent_revisions;
  carried consent_revisions;
  demoted consent_revisions;
  replaced consent_revisions;
  next_id UUID;
  reason TEXT;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', dater::text, true);

  IF (SELECT subject_user_id FROM public.pitch_drafts WHERE id = draft)
     IS DISTINCT FROM dater THEN
    RAISE EXCEPTION '25_motion_scene_v2 fixture failure: the claim did not bind the dater';
  END IF;

  SELECT * INTO submitted
    FROM public.consent_revisions
   WHERE pitch_draft_id = draft
   ORDER BY revision_number DESC
   LIMIT 1;
  IF submitted.scene_definition IS NULL THEN
    RAISE EXCEPTION
      '25_motion_scene_v2 fixture failure: the reviewed revision carries no scene';
  END IF;

  -- (H1) A save with no new_scene carries the reviewed shot list forward
  -- untouched, references and all.
  SELECT revision_id INTO next_id
    FROM public.create_dater_revision(draft, NULL, NULL, all_photos);
  SELECT * INTO carried FROM public.consent_revisions WHERE id = next_id;
  IF carried.scene_definition IS DISTINCT FROM submitted.scene_definition
     OR carried.scene_hash IS DISTINCT FROM submitted.scene_hash THEN
    failures := array_append(failures,
      'a text-only save did not carry the reviewed v2 scene forward');
  END IF;

  -- (H2) Dropping a photo the shot list still uses demotes the scene to NULL
  -- instead of publishing a dangling reference.
  SELECT revision_id INTO next_id
    FROM public.create_dater_revision(
      draft, NULL, NULL, ARRAY[photo_one, photo_two, photo_three]
    );
  SELECT * INTO demoted FROM public.consent_revisions WHERE id = next_id;
  IF demoted.scene_definition IS NOT NULL OR demoted.scene_hash IS NOT NULL THEN
    failures := array_append(failures,
      'a v2 scene survived a save that dropped one of its photos');
  END IF;

  -- (H3) The Dater's own shot list is judged by the same rules.
  reason := pg_temp.revision_reject_reason(
    draft, all_photos,
    jsonb_set(
      jsonb_set(pg_temp.canon(), '{shots,0,endMs}', '1199'::JSONB),
      '{shots,1,startMs}', '1199'::JSONB
    )
  );
  IF reason IS DISTINCT FROM 'every pitch scene shot must last at least 1200ms' THEN
    failures := array_append(failures,
      'the dater path accepted a 1199ms shot: ' || coalesce(reason, 'ACCEPTED'));
  END IF;
  reason := pg_temp.revision_reject_reason(
    draft, ARRAY[photo_one, photo_two, photo_three], pg_temp.canon()
  );
  IF reason IS DISTINCT FROM 'pitch scene must reference only reviewed photo assets' THEN
    failures := array_append(failures,
      'the dater path accepted a scene using an excluded photo: '
      || coalesce(reason, 'ACCEPTED'));
  END IF;

  -- (H4) A fresh three-photo shot list replaces the demoted one. The snapshot
  -- keeps all four photos while the timeline uses three, which is legal — the
  -- scene must match the APPROVED photos, not every photo in the snapshot.
  SELECT revision_id INTO next_id
    FROM public.create_dater_revision(
      draft, NULL, NULL, all_photos, NULL, NULL, pg_temp.canon_three_photos()
    );
  SELECT * INTO replaced FROM public.consent_revisions WHERE id = next_id;
  IF replaced.scene_definition IS NULL THEN
    failures := array_append(failures, 'the dater shot list was not stored');
  END IF;
  IF jsonb_array_length(replaced.scene_definition -> 'assetIds') <> 3 THEN
    failures := array_append(failures, 'the stored dater shot list lost its header');
  END IF;
  IF replaced.scene_hash IS DISTINCT FROM
     encode(digest(replaced.scene_definition::TEXT, 'sha256'), 'hex') THEN
    failures := array_append(failures, 'the dater scene_hash is not the stored text digest');
  END IF;

  INSERT INTO d25_state (key, uuid_value) VALUES ('approval-revision', replaced.id);

  IF array_length(failures, 1) IS NOT NULL THEN
    RAISE EXCEPTION '25_motion_scene_v2 revision failures: %',
      array_to_string(failures, ' | ');
  END IF;
END;
$$;

-- ── (I) Approval reads the v2 header ────────────────────────────────────
DO $$
DECLARE
  failures TEXT[] := ARRAY[]::TEXT[];
  draft CONSTANT UUID := '25000000-0000-0000-0000-000000000001';
  photo_one CONSTANT UUID := '25000000-0000-0000-0000-0000000002ab';
  photo_two CONSTANT UUID := '25000000-0000-0000-0000-000000000212';
  photo_three CONSTANT UUID := '25000000-0000-0000-0000-000000000213';
  photo_four CONSTANT UUID := '25000000-0000-0000-0000-000000000214';
  dater CONSTANT UUID := '00000000-0000-0000-0000-000000000002';
  approval_revision UUID;
  approved consent_revisions;
  published pitch_drafts;
  reason TEXT;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', dater::text, true);
  SELECT uuid_value INTO approval_revision
    FROM d25_state WHERE key = 'approval-revision';
  SELECT * INTO approved FROM public.consent_revisions WHERE id = approval_revision;

  -- Fewer photos than the header lists: approval DELETES the excluded photo, so
  -- publishing this would leave the shot list pointing at a row that is gone.
  reason := pg_temp.approve_reject_reason(
    draft, approval_revision, ARRAY[photo_one, photo_two]
  );
  IF reason IS DISTINCT FROM 'approved photos must match the reviewed motion scene photos' THEN
    failures := array_append(failures,
      'a narrower approved photo set was accepted: ' || coalesce(reason, 'PUBLISHED'));
  END IF;

  -- More photos than the header lists: the extra photo would be published
  -- without ever appearing in the motion the Dater watched.
  reason := pg_temp.approve_reject_reason(
    draft, approval_revision, ARRAY[photo_one, photo_two, photo_three, photo_four]
  );
  IF reason IS DISTINCT FROM 'approved photos must match the reviewed motion scene photos' THEN
    failures := array_append(failures,
      'a wider approved photo set was accepted: ' || coalesce(reason, 'PUBLISHED'));
  END IF;

  -- Exact match publishes, and the shot list reaches the public projection.
  PERFORM * FROM public.approve_and_publish_pitch(
    draft, 14, approval_revision, ARRAY[photo_one, photo_two, photo_three], true
  );
  SELECT * INTO published FROM public.pitch_drafts WHERE id = draft;
  IF published.status IS DISTINCT FROM 'published' THEN
    failures := array_append(failures, 'the matching approval did not publish');
  END IF;
  IF published.scene_definition IS DISTINCT FROM approved.scene_definition
     OR published.scene_hash IS DISTINCT FROM approved.scene_hash THEN
    failures := array_append(failures, 'the approved v2 scene did not reach the draft');
  END IF;
  -- Every photo the published header names still exists.
  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements_text(published.scene_definition -> 'assetIds') AS listed(value)
     WHERE NOT EXISTS (
       SELECT 1 FROM public.pitch_assets asset
        WHERE asset.id = listed.value::UUID
          AND asset.pitch_draft_id = draft
     )
  ) THEN
    failures := array_append(failures, 'the published shot list references a deleted asset');
  END IF;

  IF array_length(failures, 1) IS NOT NULL THEN
    RAISE EXCEPTION '25_motion_scene_v2 approval failures: %',
      array_to_string(failures, ' | ');
  END IF;
END;
$$;

-- ── (J) Golden vectors: one list of scenes, three implementations ───────
-- The flash budget is the only rule in v2 that three languages enforce
-- independently: the zod superRefine in packages/contracts/src/pitchSceneV2.ts,
-- the PL/pgSQL mirror in migration 0049, and the builder that pays the budget
-- while it assembles a scene. Finding F1 was a comment asserting they agreed,
-- backed by arithmetic over the wrong quantities. So the agreement is forced by
-- DATA: the rows below are generated from PITCH_SCENE_GOLDEN_VECTORS and the
-- contracts vitest suite runs the SAME rows against the parser. Editing the
-- generated block by hand would put the two suites back on separate data, which
-- is the state F1 was found in.
--
-- These probes call private.pitch_scene_violation directly rather than going
-- through submit_pitch_for_consent. Each vector carries its own durationMs and
-- its own photo, so no single fixture draft could host all of them — and the RPC
-- path down to this validator is what every other section in this file exercises.

-- ── GOLDEN VECTORS (GENERATED — DO NOT EDIT) ─────────────────────────────
-- Source: packages/contracts/src/pitchSceneGoldenVectors.ts
--         (PITCH_SCENE_GOLDEN_VECTORS, printed by pitchSceneGoldenVectorsSql)
-- The same rows run against the zod parser in that package’s vitest suite.
-- expected_reason NULL means the scene must be ACCEPTED.
CREATE TEMPORARY TABLE pitch_scene_golden_vector (
  name TEXT PRIMARY KEY,
  requires_structure BOOLEAN NOT NULL,
  expected_reason TEXT,
  scene JSONB NOT NULL
);
INSERT INTO pitch_scene_golden_vector (name, requires_structure, expected_reason, scene)
VALUES
  ('p8-leak-pulses-between-punches',
   false,
   'pitch scene flashes must be at least 334ms apart',
   $vector${"schemaVersion":2,"template":"hype","canvas":{"width":1080,"height":1920,"fps":30},"durationMs":4000,"assetIds":["40000000-0000-0000-0000-000000000001"],"shots":[{"level":"punchIn","assetId":"40000000-0000-0000-0000-000000000001","startMs":0,"endMs":4000,"crop":{"x":0.05,"y":0.05,"width":0.9,"height":0.9},"effects":[{"type":"kenBurns","to":{"x":0.07,"y":0.05,"width":0.86,"height":0.86},"easing":"easeOut"},{"type":"punch","atMs":700,"durationMs":200,"scale":1.05,"easing":"easeOut"},{"type":"punch","atMs":1600,"durationMs":200,"scale":1.05,"easing":"easeOut"},{"type":"punch","atMs":2100,"durationMs":200,"scale":1.05,"easing":"easeOut"}]}],"look":{"grade":{"warmth":0.12,"contrast":1.28,"saturation":1.22,"vignette":0.18},"grain":{"intensity":0.1,"sizePx":2,"seed":1234567,"animationHz":30}},"chrome":{"progressBar":{"thicknessPx":5,"opacity":0.8,"anchor":"top"}},"overlays":[{"type":"lightLeak","startMs":1200,"endMs":2400,"peakIntensity":0.38,"pulseHz":3,"angleDeg":35}]}$vector$::JSONB),
  ('punch-and-wordpop-200ms-apart',
   false,
   'pitch scene flashes must be at least 334ms apart',
   $vector${"schemaVersion":2,"template":"hype","canvas":{"width":1080,"height":1920,"fps":30},"durationMs":3000,"assetIds":["40000000-0000-0000-0000-000000000001"],"shots":[{"level":"punchIn","assetId":"40000000-0000-0000-0000-000000000001","startMs":0,"endMs":3000,"crop":{"x":0.05,"y":0.05,"width":0.9,"height":0.9},"effects":[{"type":"kenBurns","to":{"x":0.07,"y":0.05,"width":0.86,"height":0.86},"easing":"easeOut"},{"type":"punch","atMs":1000,"durationMs":200,"scale":1.05,"easing":"easeOut"},{"type":"wordPop","word":{"segmentIndex":0,"wordIndex":4},"startMs":1200,"endMs":1600,"scale":1.34,"easing":"easeOut"}]}],"look":{"grade":{"warmth":0.12,"contrast":1.28,"saturation":1.22,"vignette":0.18},"grain":{"intensity":0.1,"sizePx":2,"seed":1234567,"animationHz":30}},"chrome":{"progressBar":{"thicknessPx":5,"opacity":0.8,"anchor":"top"}},"overlays":[]}$vector$::JSONB),
  ('four-wordpops-one-millisecond-apart',
   false,
   'pitch scene flashes must be at least 334ms apart',
   $vector${"schemaVersion":2,"template":"hype","canvas":{"width":1080,"height":1920,"fps":30},"durationMs":3000,"assetIds":["40000000-0000-0000-0000-000000000001"],"shots":[{"level":"punchIn","assetId":"40000000-0000-0000-0000-000000000001","startMs":0,"endMs":3000,"crop":{"x":0.05,"y":0.05,"width":0.9,"height":0.9},"effects":[{"type":"kenBurns","to":{"x":0.07,"y":0.05,"width":0.86,"height":0.86},"easing":"easeOut"},{"type":"wordPop","word":{"segmentIndex":0,"wordIndex":0},"startMs":1000,"endMs":1400,"scale":1.34,"easing":"easeOut"},{"type":"wordPop","word":{"segmentIndex":0,"wordIndex":1},"startMs":1001,"endMs":1401,"scale":1.34,"easing":"easeOut"},{"type":"wordPop","word":{"segmentIndex":0,"wordIndex":2},"startMs":1002,"endMs":1402,"scale":1.34,"easing":"easeOut"},{"type":"wordPop","word":{"segmentIndex":0,"wordIndex":3},"startMs":1003,"endMs":1403,"scale":1.34,"easing":"easeOut"}]}],"look":{"grade":{"warmth":0.12,"contrast":1.28,"saturation":1.22,"vignette":0.18},"grain":{"intensity":0.1,"sizePx":2,"seed":1234567,"animationHz":30}},"chrome":{"progressBar":{"thicknessPx":5,"opacity":0.8,"anchor":"top"}},"overlays":[]}$vector$::JSONB),
  ('countbadge-inside-a-leak-pulse',
   true,
   'pitch scene flashes must be at least 334ms apart',
   $vector${"schemaVersion":2,"template":"hype","canvas":{"width":1080,"height":1920,"fps":30},"durationMs":3600,"assetIds":["40000000-0000-0000-0000-000000000001"],"shots":[{"level":"wide","assetId":"40000000-0000-0000-0000-000000000001","startMs":0,"endMs":3600,"crop":{"x":0,"y":0,"width":1,"height":1},"effects":[{"type":"kenBurns","to":{"x":0.035,"y":0,"width":0.965,"height":0.965},"easing":"easeOut"}]}],"look":{"grade":{"warmth":0.12,"contrast":1.28,"saturation":1.22,"vignette":0.18},"grain":{"intensity":0.1,"sizePx":2,"seed":1234567,"animationHz":30}},"chrome":{"progressBar":{"thicknessPx":5,"opacity":0.8,"anchor":"top"}},"overlays":[{"type":"lightLeak","startMs":1000,"endMs":2200,"peakIntensity":0.38,"pulseHz":2,"angleDeg":35},{"type":"countBadge","source":"quality:0","startMs":2100,"endMs":2600,"emphasis":0.9}]}$vector$::JSONB),
  ('pulsehz-zero-leak-still-appears',
   false,
   'pitch scene flashes must be at least 334ms apart',
   $vector${"schemaVersion":2,"template":"hype","canvas":{"width":1080,"height":1920,"fps":30},"durationMs":3000,"assetIds":["40000000-0000-0000-0000-000000000001"],"shots":[{"level":"punchIn","assetId":"40000000-0000-0000-0000-000000000001","startMs":0,"endMs":3000,"crop":{"x":0.05,"y":0.05,"width":0.9,"height":0.9},"effects":[{"type":"kenBurns","to":{"x":0.07,"y":0.05,"width":0.86,"height":0.86},"easing":"easeOut"},{"type":"punch","atMs":1200,"durationMs":200,"scale":1.05,"easing":"easeOut"}]}],"look":{"grade":{"warmth":0.12,"contrast":1.28,"saturation":1.22,"vignette":0.18},"grain":{"intensity":0.1,"sizePx":2,"seed":1234567,"animationHz":30}},"chrome":{"progressBar":{"thicknessPx":5,"opacity":0.8,"anchor":"top"}},"overlays":[{"type":"lightLeak","startMs":1000,"endMs":2200,"peakIntensity":0.38,"pulseHz":0,"angleDeg":35}]}$vector$::JSONB),
  ('fractional-pulsehz',
   false,
   'pitch scene lightLeak must carry a peakIntensity, a whole-number pulseHz of at most 3 and an angleDeg in range',
   $vector${"schemaVersion":2,"template":"hype","canvas":{"width":1080,"height":1920,"fps":30},"durationMs":3000,"assetIds":["40000000-0000-0000-0000-000000000001"],"shots":[{"level":"punchIn","assetId":"40000000-0000-0000-0000-000000000001","startMs":0,"endMs":3000,"crop":{"x":0.05,"y":0.05,"width":0.9,"height":0.9},"effects":[{"type":"kenBurns","to":{"x":0.07,"y":0.05,"width":0.86,"height":0.86},"easing":"easeOut"},{"type":"punch","atMs":1600,"durationMs":200,"scale":1.05,"easing":"easeOut"}]}],"look":{"grade":{"warmth":0.12,"contrast":1.28,"saturation":1.22,"vignette":0.18},"grain":{"intensity":0.1,"sizePx":2,"seed":1234567,"animationHz":30}},"chrome":{"progressBar":{"thicknessPx":5,"opacity":0.8,"anchor":"top"}},"overlays":[{"type":"lightLeak","startMs":1000,"endMs":1240,"peakIntensity":0.38,"pulseHz":2.5,"angleDeg":35}]}$vector$::JSONB),
  ('three-hz-leak-short-enough-for-one-peak',
   false,
   NULL,
   $vector${"schemaVersion":2,"template":"hype","canvas":{"width":1080,"height":1920,"fps":30},"durationMs":3000,"assetIds":["40000000-0000-0000-0000-000000000001"],"shots":[{"level":"punchIn","assetId":"40000000-0000-0000-0000-000000000001","startMs":0,"endMs":3000,"crop":{"x":0.05,"y":0.05,"width":0.9,"height":0.9},"effects":[{"type":"kenBurns","to":{"x":0.07,"y":0.05,"width":0.86,"height":0.86},"easing":"easeOut"},{"type":"punch","atMs":1334,"durationMs":200,"scale":1.05,"easing":"easeOut"}]}],"look":{"grade":{"warmth":0.12,"contrast":1.28,"saturation":1.22,"vignette":0.18},"grain":{"intensity":0.1,"sizePx":2,"seed":1234567,"animationHz":30}},"chrome":{"progressBar":{"thicknessPx":5,"opacity":0.8,"anchor":"top"}},"overlays":[{"type":"lightLeak","startMs":1000,"endMs":1300,"peakIntensity":0.38,"pulseHz":3,"angleDeg":35}]}$vector$::JSONB),
  ('countbadge-exactly-334-after-a-leak-pulse',
   true,
   NULL,
   $vector${"schemaVersion":2,"template":"hype","canvas":{"width":1080,"height":1920,"fps":30},"durationMs":3600,"assetIds":["40000000-0000-0000-0000-000000000001"],"shots":[{"level":"wide","assetId":"40000000-0000-0000-0000-000000000001","startMs":0,"endMs":3600,"crop":{"x":0,"y":0,"width":1,"height":1},"effects":[{"type":"kenBurns","to":{"x":0.035,"y":0,"width":0.965,"height":0.965},"easing":"easeOut"}]}],"look":{"grade":{"warmth":0.12,"contrast":1.28,"saturation":1.22,"vignette":0.18},"grain":{"intensity":0.1,"sizePx":2,"seed":1234567,"animationHz":30}},"chrome":{"progressBar":{"thicknessPx":5,"opacity":0.8,"anchor":"top"}},"overlays":[{"type":"lightLeak","startMs":1000,"endMs":2200,"peakIntensity":0.38,"pulseHz":2,"angleDeg":35},{"type":"countBadge","source":"quality:0","startMs":2334,"endMs":2834,"emphasis":0.9}]}$vector$::JSONB),
  ('f1-builder-output',
   false,
   NULL,
   $vector${"schemaVersion":2,"template":"warm","canvas":{"width":1080,"height":1920,"fps":30},"durationMs":15000,"assetIds":["40000000-0000-0000-0000-000000000001"],"shots":[{"level":"wide","assetId":"40000000-0000-0000-0000-000000000001","startMs":0,"endMs":2433,"crop":{"x":0,"y":0,"width":1,"height":1},"effects":[{"type":"kenBurns","to":{"x":0.035,"y":0,"width":0.965,"height":0.965},"easing":"easeInOut"},{"type":"wordPop","word":{"segmentIndex":0,"wordIndex":0},"startMs":0,"endMs":560,"scale":1.18,"easing":"easeOut"}]},{"level":"punchIn","assetId":"40000000-0000-0000-0000-000000000001","startMs":2433,"endMs":6000,"crop":{"x":0.07,"y":0,"width":0.86,"height":0.86},"effects":[{"type":"kenBurns","to":{"x":0.08,"y":0,"width":0.9,"height":0.9},"easing":"easeInOut"},{"type":"punch","atMs":4866,"durationMs":320,"scale":1.04,"easing":"easeOut"},{"type":"wordPop","word":{"segmentIndex":0,"wordIndex":1},"startMs":2433,"endMs":2993,"scale":1.18,"easing":"easeOut"}]},{"level":"detail","assetId":"40000000-0000-0000-0000-000000000001","startMs":6000,"endMs":9000,"crop":{"x":0.11,"y":0,"width":0.78,"height":0.78},"effects":[{"type":"kenBurns","to":{"x":0.1,"y":0,"width":0.74,"height":0.74},"easing":"easeInOut"},{"type":"punch","atMs":7700,"durationMs":320,"scale":1.04,"easing":"easeOut"}]},{"level":"wideAlt","assetId":"40000000-0000-0000-0000-000000000001","startMs":9000,"endMs":12566,"crop":{"x":0.0375,"y":0,"width":0.925,"height":0.925},"effects":[{"type":"kenBurns","to":{"x":0.04,"y":0,"width":0.96,"height":0.96},"easing":"easeInOut"},{"type":"wordPop","word":{"segmentIndex":1,"wordIndex":1},"startMs":10133,"endMs":10693,"scale":1.18,"easing":"easeOut"}]},{"level":"wide","assetId":"40000000-0000-0000-0000-000000000001","startMs":12566,"endMs":15000,"crop":{"x":0,"y":0,"width":1,"height":1},"effects":[{"type":"kenBurns","to":{"x":0.035,"y":0,"width":0.965,"height":0.965},"easing":"easeInOut"},{"type":"wordPop","word":{"segmentIndex":1,"wordIndex":2},"startMs":12566,"endMs":13126,"scale":1.18,"easing":"easeOut"}]}],"look":{"grade":{"warmth":0.3,"contrast":1.08,"saturation":1.05,"vignette":0.28},"grain":{"intensity":0.06,"sizePx":2,"seed":111430214,"animationHz":24}},"chrome":{"progressBar":{"thicknessPx":3,"opacity":0.45,"anchor":"bottom"}},"overlays":[]}$vector$::JSONB);
-- ── END GOLDEN VECTORS ───────────────────────────────────────────────────

DO $$
DECLARE
  failures TEXT[] := ARRAY[]::TEXT[];
  -- The five published fields, for the vectors whose scene prints a card.
  reviewed_structure CONSTANT JSONB := $structure${
    "hook": "Meet my friend Blair",
    "relationship_context": "We have been friends since college.",
    "three_specific_qualities": ["kind", "curious", "cooks constantly"],
    "evidence_or_anecdote": "Blair drove four hours to help me move.",
    "good_match_for": "someone who likes long dinners",
    "hard_claims_requiring_confirmation": []
  }$structure$::JSONB;
  -- Two segments and six word timings: the smallest transcript that bounds every
  -- word reference the vectors make. Only the two array lengths reach the
  -- validator, but writing real times keeps the fixture readable.
  vector_transcript CONSTANT JSONB := $transcript${
    "text": "Blair is kind and curious and always cooking.",
    "language": "en",
    "segments": [
      {"start": 0, "end": 7.3, "text": "Blair is kind"},
      {"start": 7.7, "end": 15, "text": "and curious and always cooking"}
    ],
    "words": [
      {"start": 0, "end": 1.946, "word": "Blair"},
      {"start": 2.433, "end": 4.379, "word": "is"},
      {"start": 4.866, "end": 6.812, "word": "kind"},
      {"start": 7.7, "end": 9.646, "word": "and"},
      {"start": 10.133, "end": 12.079, "word": "curious"},
      {"start": 12.566, "end": 14.512, "word": "cooking"}
    ]
  }$transcript$::JSONB;
  vector RECORD;
  reason TEXT;
  accept_count INTEGER;
  reject_count INTEGER;
BEGIN
  -- A generator that emitted nothing, or only rejections, would leave every
  -- assertion below vacuously true.
  SELECT count(*) FILTER (WHERE expected_reason IS NULL),
         count(*) FILTER (WHERE expected_reason IS NOT NULL)
    INTO accept_count, reject_count
    FROM pitch_scene_golden_vector;
  IF accept_count < 1 OR reject_count < 1 THEN
    RAISE EXCEPTION
      'D25: the golden vector block carries % accept and % reject rows',
      accept_count, reject_count;
  END IF;
  -- The two vectors the safety review named. They are asserted by name because a
  -- rename on the contracts side must break this suite, not silently drop the
  -- coverage it was added for.
  IF NOT EXISTS (
    SELECT 1 FROM pitch_scene_golden_vector
     WHERE name = 'p8-leak-pulses-between-punches' AND expected_reason IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'D25: attack vector p8-leak-pulses-between-punches is missing or is not a rejection';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pitch_scene_golden_vector
     WHERE name = 'f1-builder-output' AND expected_reason IS NULL
  ) THEN
    RAISE EXCEPTION 'D25: builder vector f1-builder-output is missing or is not an acceptance';
  END IF;

  FOR vector IN SELECT * FROM pitch_scene_golden_vector ORDER BY name LOOP
    reason := private.pitch_scene_violation(
      vector.scene,
      (vector.scene ->> 'durationMs')::INTEGER,
      (SELECT array_agg((listed.value #>> '{}')::UUID)
         FROM jsonb_array_elements(vector.scene -> 'assetIds') AS listed(value)),
      vector_transcript,
      CASE WHEN vector.requires_structure THEN reviewed_structure END
    );
    IF reason IS DISTINCT FROM vector.expected_reason THEN
      failures := array_append(
        failures,
        vector.name || ': expected ' || coalesce(vector.expected_reason, 'ACCEPTED')
          || ', got ' || coalesce(reason, 'ACCEPTED')
      );
    END IF;
  END LOOP;

  IF array_length(failures, 1) IS NOT NULL THEN
    RAISE EXCEPTION '25_motion_scene_v2 golden vector failures: %',
      array_to_string(failures, ' | ');
  END IF;
END;
$$;

ROLLBACK;

SELECT '25_motion_scene_v2.sql passed' AS result;
