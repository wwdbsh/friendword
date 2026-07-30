-- Motion pitch Phase 2 (docs/MOTION_PITCH_PLAN_2026-07-29.md): the Dater
-- approves a SHOT LIST, not a slideshow.
--
-- PitchScene v2 (packages/contracts/src/pitchSceneV2.ts, frozen) turns four
-- photos into a dozen shots: a crop ladder, two templates, and a closed
-- vocabulary of eleven effects. This migration teaches the database to judge
-- one. Everything here mirrors constants that already exist in the frozen
-- schema; nothing here invents a rule the contract does not state.
--
-- FIVE DECISIONS, because each of them is a place where a reasonable reader
-- would expect something else:
--
-- 1. ONE VALIDATOR, VERSION-BRANCHED. private.pitch_scene_violation keeps its
--    v1 body byte for byte and gains a v2 branch in front of it. A parallel
--    validator would be a second place for the same question ("may this scene
--    be stored?") to be answered, and the two would drift the first time a
--    bound moved. Dispatch is on schemaVersion, exactly like
--    contracts' parsePitchScene: anything that is not explicitly v2 falls
--    through to the untouched v1 rules, so v1 writes from an older mobile
--    bundle keep their existing behaviour and their existing messages.
--
-- 2. THE VALIDATOR NOW TAKES THE TRANSCRIPT AND THE STRUCTURE. A v2 scene can
--    reference two things the scene itself cannot prove: a transcript word
--    (wordPop) and a reviewed structure field (kineticText / countBadge). Both
--    references have to be checked against THE SAME ROW the scene is being
--    written onto, so the two jsonb documents have to reach the validator. The
--    three RPC signatures do not change — only the argument list of the two
--    private helpers does, and the RPC bodies are re-created to pass the pair
--    through. A defaulted argument was not an option: PostgreSQL would treat
--    the wider form as an overload and the old 3-argument calls would then
--    resolve ambiguously (same reasoning as 0047:311-317, 0048:370-373).
--
-- 3. THE DATABASE ENFORCES MECHANICAL FLOORS, NOT TASTE. Every rule below is
--    either a closed token set, a numeric bound the frozen schema states, a
--    reference that must resolve, or viewer safety (the 1200ms shot floor and
--    the 334ms flash budget, which is over the UNION of expanded lightLeak pulse
--    peaks, punch onsets, wordPop and countBadge appearances — see the budget
--    itself for why counting overlay onsets was not enough). The builder's
--    quality rules — a long photo shot
--    must carry a TRAVELLING kenBurns, the same (photo, framing) pair may not
--    repeat within three shots, two text cards may not sit back to back — are
--    deliberately NOT here. They are what makes a scene good, not what makes it
--    safe or storable, and a database that enforced them would refuse a
--    hand-tuned timeline that harms nobody. The 4500ms ceiling IS here, because
--    it is a plain schema bound rather than a judgement about motion.
--
-- 4. CANONICAL FORM FOR v2 IS A GENERIC WALK, NOT A REBUILD. v1 is rebuilt key
--    by key (0048:298-326) because it has four fields. A v2 scene has around
--    sixty, most of them optional, so an explicit rebuild would be a second
--    copy of the schema that has to be edited in lockstep with the validator —
--    and a field forgotten there would be silently dropped from what the Dater
--    approved. Instead private.canonical_pitch_json walks the document that
--    validation has ALREADY proved has an exact key set, and normalizes the two
--    things jsonb does not: numeric spelling (30.0 -> 30, 1.20 -> 1.2) and
--    asset id case. Nothing is dropped, so nothing can go missing.
--
-- 5. WORD AND TEXT REFERENCES ARE CHECKED AGAINST THE ROW, FAIL-CLOSED. A
--    wordPop on a recording transcribed before word timings existed (A7) is
--    refused rather than tolerated, because the player would have nothing to
--    lift and the scene would claim an accent that never lands. A kineticText
--    or countBadge is refused unless the same row's structure carries the five
--    published fields, because the card prints THAT sentence and a card with no
--    sentence behind it is either blank or an invitation to smuggle text in
--    later. The player is a second line of defence: it skips an effect whose
--    reference does not resolve instead of crashing or printing a placeholder.

-- ── Primitives ──────────────────────────────────────────────────────────
-- Small, total readers over jsonb. They exist so the validator below reads as
-- a list of rules rather than a list of type interrogations, and so "absent",
-- "wrong type" and "out of range" collapse into one answer at every call site.

CREATE FUNCTION private.pitch_scene_number(value JSONB)
RETURNS NUMERIC
LANGUAGE sql
IMMUTABLE
SET search_path = public, extensions, pg_temp
AS $$
  SELECT CASE
    WHEN jsonb_typeof(value) = 'number' THEN (value #>> '{}')::NUMERIC
  END;
$$;

REVOKE ALL ON FUNCTION private.pitch_scene_number(JSONB) FROM PUBLIC;

COMMENT ON FUNCTION private.pitch_scene_number(JSONB) IS
  'The value when it is a JSON number, otherwise NULL. jsonb stores numbers as NUMERIC, so a fractional bound is exact here and never a float comparison.';

CREATE FUNCTION private.pitch_scene_number_in(value JSONB, low NUMERIC, high NUMERIC)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = public, extensions, pg_temp
AS $$
  SELECT coalesce(private.pitch_scene_number(value) BETWEEN low AND high, false);
$$;

REVOKE ALL ON FUNCTION private.pitch_scene_number_in(JSONB, NUMERIC, NUMERIC) FROM PUBLIC;

CREATE FUNCTION private.pitch_scene_integer_in(value JSONB, low BIGINT, high BIGINT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = public, extensions, pg_temp
AS $$
  SELECT coalesce(private.pitch_scene_integer(value) BETWEEN low AND high, false);
$$;

REVOKE ALL ON FUNCTION private.pitch_scene_integer_in(JSONB, BIGINT, BIGINT) FROM PUBLIC;

-- Exact key set, which is how "an unknown key is a rejection, not something a
-- renderer ignores" is enforced. Every v2 object is `.strict()` in the
-- contract, so every object here gets one of these.
CREATE FUNCTION private.pitch_scene_keys_are(value JSONB, expected TEXT[])
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = public, extensions, pg_temp
AS $$
  SELECT jsonb_typeof(value) = 'object'
     AND (SELECT count(*) FROM jsonb_object_keys(value)) = coalesce(array_length(expected, 1), 0)
     AND NOT EXISTS (
       SELECT 1
         FROM jsonb_object_keys(value) AS present(key)
        WHERE NOT (present.key = ANY(expected))
     );
$$;

REVOKE ALL ON FUNCTION private.pitch_scene_keys_are(JSONB, TEXT[]) FROM PUBLIC;

COMMENT ON FUNCTION private.pitch_scene_keys_are(JSONB, TEXT[]) IS
  'True when the value is an object carrying exactly the expected keys. An unknown key is a refusal because a tolerated one would be a path for unmoderated words onto a public page.';

CREATE FUNCTION private.pitch_scene_token(value JSONB, allowed TEXT[])
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = public, extensions, pg_temp
AS $$
  SELECT jsonb_typeof(value) = 'string' AND (value #>> '{}') = ANY(allowed);
$$;

REVOKE ALL ON FUNCTION private.pitch_scene_token(JSONB, TEXT[]) FROM PUBLIC;

-- The crop ladder's zoom ceilings, as the smallest crop each level may use
-- (zoom = 1 / size): wide 1.04x, wideAlt 1.16x, punchIn 1.25x, detail 1.49x.
-- Mirrors CROP_LEVEL_MIN_SIZE. NULL for a level that has no crop.
CREATE FUNCTION private.pitch_shot_level_min_size(level TEXT)
RETURNS NUMERIC
LANGUAGE sql
IMMUTABLE
SET search_path = public, extensions, pg_temp
AS $$
  SELECT CASE level
    WHEN 'wide' THEN 0.96
    WHEN 'wideAlt' THEN 0.86
    WHEN 'punchIn' THEN 0.8
    WHEN 'detail' THEN 0.67
  END;
$$;

REVOKE ALL ON FUNCTION private.pitch_shot_level_min_size(TEXT) FROM PUBLIC;

-- A crop rect is normalized against the CANVAS-FITTED frame — the photo already
-- cover-fitted to the canvas — not against the source image. Two consequences,
-- both wanted: a rect can never reveal pixels outside the frame the Dater
-- reviewed, and width = height in that space is exactly 9:16 in pixels, so no
-- crop can distort a face and no asset pixel size is needed to check one.
CREATE FUNCTION private.pitch_scene_crop_violation(crop JSONB, min_size NUMERIC)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  -- Mirrors FLOAT_SLACK. jsonb numbers are exact decimals, but a builder that
  -- computed a crop in binary floating point may hand over 0.8999999999999999.
  slack CONSTANT NUMERIC := 1e-9;
  crop_x NUMERIC;
  crop_y NUMERIC;
  crop_width NUMERIC;
  crop_height NUMERIC;
BEGIN
  IF NOT private.pitch_scene_keys_are(crop, ARRAY['x', 'y', 'width', 'height'])
     OR NOT private.pitch_scene_number_in(crop -> 'x', 0, 1)
     OR NOT private.pitch_scene_number_in(crop -> 'y', 0, 1)
     OR NOT private.pitch_scene_number_in(crop -> 'width', 0, 1)
     OR NOT private.pitch_scene_number_in(crop -> 'height', 0, 1) THEN
    RETURN 'pitch scene crop must carry an x, a y, a width and a height between 0 and 1';
  END IF;
  crop_x := private.pitch_scene_number(crop -> 'x');
  crop_y := private.pitch_scene_number(crop -> 'y');
  crop_width := private.pitch_scene_number(crop -> 'width');
  crop_height := private.pitch_scene_number(crop -> 'height');

  IF crop_width < min_size - slack OR crop_height < min_size - slack THEN
    RETURN 'pitch scene shot may not zoom past the ceiling for its level';
  END IF;
  IF abs(crop_width - crop_height) > slack THEN
    RETURN 'pitch scene crop must be square, which is 9:16 in pixels';
  END IF;
  IF crop_x + crop_width > 1 + slack OR crop_y + crop_height > 1 + slack THEN
    RETURN 'pitch scene crop must stay inside the frame the dater reviewed';
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION private.pitch_scene_crop_violation(JSONB, NUMERIC) FROM PUBLIC;

COMMENT ON FUNCTION private.pitch_scene_crop_violation(JSONB, NUMERIC) IS
  'NULL when the crop rect is a square inside the canvas-fitted frame at or above the level minimum, otherwise the pinned rejection message.';

-- ── Transcript duration ─────────────────────────────────────────────────
-- Re-declared from 0048 with ONE line changed: the rounding now runs the same
-- ARITHMETIC the clients run, not merely the same intent.
--
-- 0048 rounded in NUMERIC — exact decimals, half away from zero. Every client
-- computes `Math.round(Number(end) * 1000)` — IEEE double, half up. The two
-- part company by 1ms whenever the double product falls on the far side of a
-- .5 boundary from the exact decimal: 8.0025s is 8003ms in NUMERIC and 8002ms
-- in a double, because the double nearest 8.0025 times 1000 is
-- 8002.499999999999. 741 of the 1,200,000 four-decimal timestamps under 120s
-- differ that way.
--
-- 1ms is enough to matter, because this number is the duration a scene must
-- match EXACTLY: the client's shot list would be refused, and mobile then
-- falls back to publishing with no motion at all. That is fail-safe but silent,
-- so it would read as "motion just does not work for this recording". The
-- current transcription provider emits two decimals, so nothing reaches it
-- today; the arithmetic is aligned anyway, because a provider that starts
-- emitting finer timestamps must not be able to switch motion off.
--
-- The cast to DOUBLE PRECISION happens BEFORE the multiply, which is what makes
-- the product bit-for-bit the client's: jsonb holds the number as NUMERIC, and
-- NUMERIC -> FLOAT8 parses the same decimal with the same correct rounding as
-- JavaScript's number parser.
--
-- Rounding then cannot use a built-in, and each near miss is worth naming
-- because all three look right:
--   * round(FLOAT8) is half to EVEN, so a product of exactly 1234.5 answers
--     1234 where Math.round answers 1235.
--   * floor(y + 0.5) is half up, but the addition rounds too: at
--     y = 0.49999999999999994 the sum lands on 1.0, answering 1 against
--     Math.round's 0.
--   * round(y::NUMERIC) looks exact and is not. FLOAT8 -> NUMERIC keeps only 15
--     significant digits, so 8002.499999999999 becomes 8002.5 — it reproduces
--     the very defect it appears to repair.
-- Comparing the fractional part instead is exact for every double, because the
-- fraction of a double is itself a double. That IS Math.round's definition for a
-- non-negative value, and a timestamp cannot be negative: the guard below
-- rejects <= 0 before the cast is reached.
--
-- That guard is also what makes the cast safe at all. A transcript may legally
-- carry a NUMERIC far too large for a double, so the range test has to stay in
-- NUMERIC and has to run first; CASE evaluates its branches in order, so it
-- does.
CREATE OR REPLACE FUNCTION private.pitch_transcript_duration_ms(transcript JSONB)
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
SET search_path = public, extensions, pg_temp
AS $$
  SELECT CASE
    WHEN scaled.end_ms IS NULL THEN NULL
    WHEN scaled.end_ms - floor(scaled.end_ms) >= 0.5::DOUBLE PRECISION
      THEN (floor(scaled.end_ms) + 1)::INTEGER
    ELSE floor(scaled.end_ms)::INTEGER
  END
  FROM (
    SELECT CASE
             WHEN tail.last_end IS NULL
               OR tail.last_end <= 0
               OR tail.last_end > 86400 THEN NULL
             ELSE (tail.last_end)::DOUBLE PRECISION * 1000
           END AS end_ms
    FROM (
      SELECT (
        SELECT CASE
                 WHEN jsonb_typeof(segment.value -> 'end') = 'number'
                   THEN (segment.value ->> 'end')::NUMERIC
               END
          FROM jsonb_array_elements(transcript -> 'segments')
               WITH ORDINALITY AS segment(value, ord)
         ORDER BY segment.ord DESC
         LIMIT 1
      ) AS last_end
      WHERE jsonb_typeof(transcript -> 'segments') = 'array'
    ) AS tail
  ) AS scaled;
$$;

COMMENT ON FUNCTION private.pitch_transcript_duration_ms(JSONB) IS
  'Milliseconds to the end of the last transcript segment, or NULL when the transcript carries no usable segments. The single authority for a pitch duration; client-measured audio length is never used. Rounds in IEEE double arithmetic, half up, so the answer is bit-identical to the clients Math.round(Number(end) * 1000).';

-- ── Canonical jsonb ─────────────────────────────────────────────────────
-- jsonb already normalizes key order and whitespace. This adds the two things
-- it does not: numeric spelling and asset id case. Recursive, and deliberately
-- generic — see decision 4 in the header. Validation runs first, so every
-- object walked here has an exact, known key set.
CREATE FUNCTION private.canonical_pitch_json(value JSONB)
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  rebuilt JSONB;
BEGIN
  CASE jsonb_typeof(value)
    WHEN 'number' THEN
      -- 30.0 -> 30, 1.20 -> 1.2. Two clients that format JSON differently must
      -- not be able to produce two scene hashes for one timeline.
      RETURN to_jsonb(trim_scale((value #>> '{}')::NUMERIC));
    WHEN 'string' THEN
      IF (value #>> '{}')
         ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        RETURN to_jsonb(lower(value #>> '{}'));
      END IF;
      RETURN value;
    WHEN 'array' THEN
      -- Array order is meaningful everywhere in a scene (shots, effects,
      -- overlays, assetIds, amplitudes), so it is preserved, never sorted.
      SELECT coalesce(
               jsonb_agg(private.canonical_pitch_json(element.value) ORDER BY element.ord),
               '[]'::JSONB
             )
        INTO rebuilt
        FROM jsonb_array_elements(value) WITH ORDINALITY AS element(value, ord);
      RETURN rebuilt;
    WHEN 'object' THEN
      SELECT coalesce(
               jsonb_object_agg(entry.key, private.canonical_pitch_json(entry.value)),
               '{}'::JSONB
             )
        INTO rebuilt
        FROM jsonb_each(value) AS entry(key, value);
      RETURN rebuilt;
    ELSE
      -- Booleans, JSON null, and a NULL input are already canonical. A v2 scene
      -- contains none of them, so this branch is reachability insurance only.
      RETURN value;
  END CASE;
END;
$$;

REVOKE ALL ON FUNCTION private.canonical_pitch_json(JSONB) FROM PUBLIC;

COMMENT ON FUNCTION private.canonical_pitch_json(JSONB) IS
  'Canonical form of an already-validated scene document: numbers trimmed to their shortest exact spelling, UUID-shaped strings lower-cased, key order left to jsonb, array order preserved. Drops nothing.';

-- ── Scene validation ────────────────────────────────────────────────────
-- Returns NULL when the scene is acceptable, otherwise the rejection message.
-- Still a non-raising predicate for the reason 0048 gives: a client-supplied
-- scene must be REFUSED with a mappable reason, while a scene carried forward
-- onto a changed photo set must be silently DEMOTED to NULL, and splitting
-- those into two rule sets would let them drift.
--
-- The 3-argument form from 0048 is DROPPED rather than kept as a wrapper: a
-- wrapper would be a call path where a v2 scene is judged with no transcript
-- and no structure, which is exactly the pair the new references need. Both
-- helpers are private and were REVOKEd from PUBLIC, so nothing outside these
-- migrations can be calling them.
--
-- The rejection strings are pinned by supabase/tests/24_motion_scene.sql and
-- supabase/tests/25_motion_scene_v2.sql and mapped by the web and mobile
-- clients; changing one means changing those too.
DROP FUNCTION private.pitch_scene_violation(JSONB, INTEGER, UUID[]);

CREATE FUNCTION private.pitch_scene_violation(
  scene JSONB,
  duration_ms_expected INTEGER,
  photo_asset_ids UUID[],
  transcript JSONB,
  structure JSONB
)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  -- Canonical dashed form only. PostgreSQL's UUID input also accepts braces and
  -- unseparated hex, which would let one asset appear under several spellings
  -- and produce different scene hashes.
  uuid_pattern CONSTANT TEXT :=
    '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  easings CONSTANT TEXT[] := ARRAY['linear', 'easeIn', 'easeOut', 'easeInOut'];
  text_sources CONSTANT TEXT[] := ARRAY[
    'hook', 'relationship_context', 'quality:0', 'quality:1', 'quality:2',
    'evidence_or_anecdote', 'good_match_for'
  ];
  slack CONSTANT NUMERIC := 1e-9;
  -- Mirrors MIN_FLASH_INTERVAL_MS = ceil(1000 / MAX_FLICKER_HZ).
  min_flash_interval_ms CONSTANT BIGINT := 334;

  canvas JSONB;
  entries JSONB;
  entry JSONB;
  entry_count INTEGER;
  entry_index INTEGER;
  start_ms BIGINT;
  end_ms BIGINT;
  previous_end BIGINT := 0;
  entry_asset_id UUID;
  seen_asset_ids UUID[] := ARRAY[]::UUID[];
  photos UUID[] := coalesce(photo_asset_ids, ARRAY[]::UUID[]);

  duration BIGINT;
  shot JSONB;
  shot_level TEXT;
  shot_count INTEGER;
  shot_index INTEGER;
  text_card JSONB;
  min_size NUMERIC;
  crop_message TEXT;
  tightest NUMERIC;
  punch_scale NUMERIC;
  effect JSONB;
  effect_count INTEGER;
  effect_index INTEGER;
  effect_type TEXT;
  ken_burns_count INTEGER;
  blur_count INTEGER;
  punch_count INTEGER;
  word_pop_count INTEGER;
  effect_at_ms BIGINT;
  effect_start_ms BIGINT;
  effect_end_ms BIGINT;
  word_ref JSONB;
  segment_count INTEGER := 0;
  word_count INTEGER := 0;
  declared_ids UUID[];
  used_ids UUID[] := ARRAY[]::UUID[];
  chrome JSONB;
  wave_viz JSONB;
  overlay JSONB;
  overlay_count INTEGER;
  overlay_index INTEGER;
  overlay_type TEXT;
  last_overlay_end JSONB := '{}'::JSONB;
  -- Every instantaneous luminance or appearance event on one timeline. A pulsing
  -- light leak contributes one entry per peak, not one per overlay.
  flash_events BIGINT[] := ARRAY[]::BIGINT[];
  sorted_flashes BIGINT[];
  flash_index INTEGER;
  leak_pulse_hz BIGINT;
  leak_pulse_max_index BIGINT;
  needs_structure BOOLEAN := false;
BEGIN
  -- No scene is a legal state, not a violation: it means the published page
  -- falls back to the legacy player.
  IF scene IS NULL THEN
    RETURN NULL;
  END IF;

  -- ══ v2 ════════════════════════════════════════════════════════════════
  -- Dispatch on the version the way contracts' parsePitchScene does. Anything
  -- that is not explicitly v2 — including a v1 envelope mislabelled, a
  -- non-object, or a missing version — falls through to the v1 rules below and
  -- keeps their exact messages.
  IF jsonb_typeof(scene) = 'object'
     AND private.pitch_scene_integer(scene -> 'schemaVersion') = 2 THEN
    IF NOT private.pitch_scene_keys_are(scene, ARRAY[
         'schemaVersion', 'template', 'canvas', 'durationMs', 'assetIds', 'shots',
         'look', 'chrome', 'overlays'
       ]) THEN
      RETURN 'pitch scene must carry only schemaVersion, template, canvas, durationMs, assetIds, shots, look, chrome and overlays';
    END IF;

    -- Fonts and colours live in the template, which is why no hex string or
    -- font name can appear anywhere in a scene.
    IF NOT private.pitch_scene_token(scene -> 'template', ARRAY['warm', 'hype']) THEN
      RETURN 'pitch scene template must be warm or hype';
    END IF;

    canvas := scene -> 'canvas';
    IF NOT private.pitch_scene_keys_are(canvas, ARRAY['width', 'height', 'fps'])
       OR NOT private.pitch_scene_integer_in(canvas -> 'width', 1, 4096)
       OR NOT private.pitch_scene_integer_in(canvas -> 'height', 1, 4096)
       OR NOT private.pitch_scene_integer_in(canvas -> 'fps', 1, 60) THEN
      RETURN 'pitch scene canvas must carry a width, a height and an fps in range';
    END IF;

    duration := private.pitch_scene_integer(scene -> 'durationMs');
    IF duration IS NULL OR duration < 1200 OR duration > 600000 THEN
      RETURN 'pitch scene must last between 1200ms and 600000ms';
    END IF;
    -- A scene cannot exist without transcript segments to hang it on, because
    -- there would then be no reproducible duration to agree with.
    IF duration_ms_expected IS NULL THEN
      RETURN 'pitch scene requires transcript segments';
    END IF;
    IF duration IS DISTINCT FROM duration_ms_expected::BIGINT THEN
      RETURN 'pitch scene duration must match the transcript segments';
    END IF;

    -- The header. Redundant with the shots on purpose: approval compares THIS
    -- array against the Dater's include set instead of walking nested jsonb.
    entry_count := CASE
      WHEN jsonb_typeof(scene -> 'assetIds') = 'array'
        THEN jsonb_array_length(scene -> 'assetIds')
    END;
    IF entry_count IS NULL
       OR entry_count < 1
       OR entry_count > 12
       OR EXISTS (
         SELECT 1
           FROM jsonb_array_elements(scene -> 'assetIds') AS listed(value)
          WHERE jsonb_typeof(listed.value) IS DISTINCT FROM 'string'
             OR (listed.value #>> '{}') !~* uuid_pattern
       )
       OR (
         SELECT count(DISTINCT lower(listed.value #>> '{}'))
           FROM jsonb_array_elements(scene -> 'assetIds') AS listed(value)
       ) <> entry_count THEN
      RETURN 'pitch scene assetIds must be 1 to 12 distinct photo ids';
    END IF;
    SELECT array_agg((listed.value #>> '{}')::UUID ORDER BY listed.ord)
      INTO declared_ids
      FROM jsonb_array_elements(scene -> 'assetIds')
           WITH ORDINALITY AS listed(value, ord);
    IF EXISTS (
      SELECT 1
        FROM unnest(declared_ids) AS declared(asset_id)
       WHERE NOT (declared.asset_id = ANY(photos))
    ) THEN
      RETURN 'pitch scene must reference only reviewed photo assets';
    END IF;

    -- The transcript bounds a word reference; the scene alone cannot. Read once
    -- here rather than per wordPop.
    IF jsonb_typeof(transcript -> 'segments') = 'array' THEN
      segment_count := jsonb_array_length(transcript -> 'segments');
    END IF;
    IF jsonb_typeof(transcript -> 'words') = 'array' THEN
      word_count := jsonb_array_length(transcript -> 'words');
    END IF;

    shot_count := CASE
      WHEN jsonb_typeof(scene -> 'shots') = 'array'
        THEN jsonb_array_length(scene -> 'shots')
    END;
    IF shot_count IS NULL OR shot_count < 1 OR shot_count > 300 THEN
      RETURN 'pitch scene must carry 1 to 300 shots';
    END IF;

    FOR shot_index IN 0 .. shot_count - 1 LOOP
      shot := scene -> 'shots' -> shot_index;
      IF NOT private.pitch_scene_token(shot -> 'level', ARRAY[
           'wide', 'punchIn', 'detail', 'wideAlt', 'typographic'
         ]) THEN
        RETURN 'pitch scene shot level must be wide, punchIn, detail, wideAlt or typographic';
      END IF;
      shot_level := shot ->> 'level';

      IF shot_level = 'typographic' THEN
        IF NOT private.pitch_scene_keys_are(
             shot, ARRAY['level', 'startMs', 'endMs', 'text']
           ) THEN
          RETURN 'pitch scene text card must carry only level, startMs, endMs and text';
        END IF;
      ELSIF NOT private.pitch_scene_keys_are(
              shot, ARRAY['level', 'assetId', 'startMs', 'endMs', 'crop', 'effects']
            ) THEN
        RETURN 'pitch scene shot must carry only level, assetId, startMs, endMs, crop and effects';
      END IF;

      start_ms := private.pitch_scene_integer(shot -> 'startMs');
      end_ms := private.pitch_scene_integer(shot -> 'endMs');
      IF NOT private.pitch_scene_integer_in(shot -> 'startMs', 0, 600000)
         OR NOT private.pitch_scene_integer_in(shot -> 'endMs', 0, 600000) THEN
        RETURN 'pitch scene shot must carry a whole millisecond startMs and endMs';
      END IF;
      -- Contiguity: the first shot starts at 0, each later shot starts exactly
      -- where the previous one ended. This single equality rejects gaps (black
      -- frames) and overlaps (undefined stacking order) alike.
      IF start_ms IS DISTINCT FROM previous_end THEN
        RETURN 'pitch scene shots must be contiguous from 0 to durationMs';
      END IF;
      -- THE STROBE FLOOR. "No overlap" alone still admits 30ms x 100 shots,
      -- which is a photosensitive-epilepsy hazard landing on a VIEWER who is
      -- outside the Dater's consent model entirely.
      IF end_ms - start_ms < 1200 THEN
        RETURN 'every pitch scene shot must last at least 1200ms';
      END IF;
      IF end_ms - start_ms > 4500 THEN
        RETURN 'no pitch scene shot may last longer than 4500ms';
      END IF;

      IF shot_level = 'typographic' THEN
        -- A text card's reveal is momentary and cannot fill the rest, so the
        -- card may not outlast the "nothing sits visually still" bound.
        IF end_ms - start_ms > 2500 THEN
          RETURN 'a pitch scene text card may not last longer than 2500ms';
        END IF;
        text_card := shot -> 'text';
        IF NOT private.pitch_scene_keys_are(
             text_card, ARRAY['type', 'source', 'revealMs', 'easing', 'emphasis']
           )
           OR NOT private.pitch_scene_token(text_card -> 'type', ARRAY['kineticText']) THEN
          RETURN 'pitch scene text card must carry only a kineticText with type, source, revealMs, easing and emphasis';
        END IF;
        -- A token, never the text: the player reads the sentence from the
        -- approved revision, so an edited sentence cannot leave a stale copy
        -- behind in the scene.
        IF NOT private.pitch_scene_token(text_card -> 'source', text_sources) THEN
          RETURN 'pitch scene text source must name a reviewed structure field';
        END IF;
        IF NOT private.pitch_scene_integer_in(text_card -> 'revealMs', 80, 800) THEN
          RETURN 'pitch scene text reveal must last between 80ms and 800ms';
        END IF;
        IF NOT private.pitch_scene_token(text_card -> 'easing', easings) THEN
          RETURN 'pitch scene easing must be linear, easeIn, easeOut or easeInOut';
        END IF;
        IF NOT private.pitch_scene_number_in(text_card -> 'emphasis', 0, 1) THEN
          RETURN 'pitch scene emphasis must be between 0 and 1';
        END IF;
        needs_structure := true;
      ELSE
        IF jsonb_typeof(shot -> 'assetId') IS DISTINCT FROM 'string'
           OR (shot ->> 'assetId') !~* uuid_pattern THEN
          RETURN 'pitch scene shot must reference a photo by id';
        END IF;
        used_ids := array_append(used_ids, (shot ->> 'assetId')::UUID);

        min_size := private.pitch_shot_level_min_size(shot_level);
        crop_message := private.pitch_scene_crop_violation(shot -> 'crop', min_size);
        IF crop_message IS NOT NULL THEN
          RETURN crop_message;
        END IF;

        tightest := private.pitch_scene_number(shot -> 'crop' -> 'width');
        punch_scale := 1;
        ken_burns_count := 0;
        blur_count := 0;
        punch_count := 0;
        word_pop_count := 0;

        effect_count := CASE
          WHEN jsonb_typeof(shot -> 'effects') = 'array'
            THEN jsonb_array_length(shot -> 'effects')
        END;
        IF effect_count IS NULL OR effect_count > 8 THEN
          RETURN 'pitch scene shot effects must be a list of at most 8 effects';
        END IF;

        FOR effect_index IN 0 .. effect_count - 1 LOOP
          effect := shot -> 'effects' -> effect_index;
          IF NOT private.pitch_scene_token(effect -> 'type', ARRAY[
               'kenBurns', 'punch', 'wordPop', 'backdropBlur'
             ]) THEN
            RETURN 'pitch scene effect type must be kenBurns, punch, wordPop or backdropBlur';
          END IF;
          effect_type := effect ->> 'type';

          IF effect_type = 'kenBurns' THEN
            IF NOT private.pitch_scene_keys_are(effect, ARRAY['type', 'to', 'easing']) THEN
              RETURN 'pitch scene kenBurns must carry only type, to and easing';
            END IF;
            IF NOT private.pitch_scene_token(effect -> 'easing', easings) THEN
              RETURN 'pitch scene easing must be linear, easeIn, easeOut or easeInOut';
            END IF;
            crop_message := private.pitch_scene_crop_violation(effect -> 'to', min_size);
            IF crop_message IS NOT NULL THEN
              RETURN crop_message;
            END IF;
            tightest := least(tightest, private.pitch_scene_number(effect -> 'to' -> 'width'));
            ken_burns_count := ken_burns_count + 1;

          ELSIF effect_type = 'punch' THEN
            IF NOT private.pitch_scene_keys_are(
                 effect, ARRAY['type', 'atMs', 'durationMs', 'scale', 'easing']
               ) THEN
              RETURN 'pitch scene punch must carry only type, atMs, durationMs, scale and easing';
            END IF;
            IF NOT private.pitch_scene_token(effect -> 'easing', easings) THEN
              RETURN 'pitch scene easing must be linear, easeIn, easeOut or easeInOut';
            END IF;
            IF NOT private.pitch_scene_integer_in(effect -> 'atMs', 0, 600000)
               OR NOT private.pitch_scene_integer_in(effect -> 'durationMs', 80, 400)
               OR NOT private.pitch_scene_number_in(effect -> 'scale', 1.02, 1.12) THEN
              RETURN 'pitch scene punch must last 80ms to 400ms and scale between 1.02x and 1.12x';
            END IF;
            effect_at_ms := private.pitch_scene_integer(effect -> 'atMs');
            IF effect_at_ms < start_ms
               OR effect_at_ms + private.pitch_scene_integer(effect -> 'durationMs') > end_ms THEN
              RETURN 'pitch scene punch must start and end inside its own shot';
            END IF;
            punch_scale := greatest(punch_scale, private.pitch_scene_number(effect -> 'scale'));
            punch_count := punch_count + 1;
            flash_events := array_append(flash_events, effect_at_ms);

          ELSIF effect_type = 'wordPop' THEN
            IF NOT private.pitch_scene_keys_are(
                 effect, ARRAY['type', 'word', 'startMs', 'endMs', 'scale', 'easing']
               ) THEN
              RETURN 'pitch scene wordPop must carry only type, word, startMs, endMs, scale and easing';
            END IF;
            IF NOT private.pitch_scene_token(effect -> 'easing', easings) THEN
              RETURN 'pitch scene easing must be linear, easeIn, easeOut or easeInOut';
            END IF;
            word_ref := effect -> 'word';
            IF NOT private.pitch_scene_keys_are(
                 word_ref, ARRAY['segmentIndex', 'wordIndex']
               )
               OR NOT private.pitch_scene_integer_in(word_ref -> 'segmentIndex', 0, 999)
               OR NOT private.pitch_scene_integer_in(word_ref -> 'wordIndex', 0, 999) THEN
              RETURN 'pitch scene wordPop must reference a word by segmentIndex and wordIndex';
            END IF;
            IF NOT private.pitch_scene_integer_in(effect -> 'startMs', 0, 600000)
               OR NOT private.pitch_scene_integer_in(effect -> 'endMs', 0, 600000)
               OR NOT private.pitch_scene_number_in(effect -> 'scale', 1, 1.6) THEN
              RETURN 'pitch scene wordPop must carry whole millisecond times and a scale between 1x and 1.6x';
            END IF;
            effect_start_ms := private.pitch_scene_integer(effect -> 'startMs');
            effect_end_ms := private.pitch_scene_integer(effect -> 'endMs');
            IF effect_start_ms < start_ms OR effect_end_ms > end_ms THEN
              RETURN 'pitch scene wordPop must start and end inside its own shot';
            END IF;
            IF effect_end_ms - effect_start_ms < 120
               OR effect_end_ms - effect_start_ms > 1200 THEN
              RETURN 'pitch scene wordPop must last between 120ms and 1200ms';
            END IF;
            -- Gap (a): a recording transcribed before word timings existed has
            -- nothing for the player to lift, so a wordPop on it is a claim
            -- about an accent that can never land.
            IF word_count < 1 THEN
              RETURN 'pitch scene may not lift a word from a recording with no word timings';
            END IF;
            -- wordIndex counts inside its segment, so the flat word list is only
            -- an upper bound — which is all the database can prove, and enough
            -- to stop a nonsense index from being stored.
            IF private.pitch_scene_integer(word_ref -> 'segmentIndex') >= segment_count
               OR private.pitch_scene_integer(word_ref -> 'wordIndex') >= word_count THEN
              RETURN 'pitch scene wordPop references a word outside the transcript';
            END IF;
            word_pop_count := word_pop_count + 1;
            -- A word appearing is an appearance event: the web player ramps its
            -- opacity in, but the budget is what stops four of them arriving
            -- inside one second in the first place.
            flash_events := array_append(flash_events, effect_start_ms);

          ELSE
            IF NOT private.pitch_scene_keys_are(
                 effect, ARRAY['type', 'radiusPx', 'dim']
               )
               OR NOT private.pitch_scene_integer_in(effect -> 'radiusPx', 8, 64)
               OR NOT private.pitch_scene_number_in(effect -> 'dim', 0, 0.6) THEN
              RETURN 'pitch scene backdropBlur must carry a radiusPx of 8px to 64px and a dim of at most 0.6';
            END IF;
            blur_count := blur_count + 1;
          END IF;
        END LOOP;

        IF ken_burns_count > 1 THEN
          RETURN 'pitch scene shot may carry at most one kenBurns';
        END IF;
        IF blur_count > 1 THEN
          RETURN 'pitch scene shot may carry at most one backdropBlur';
        END IF;
        IF punch_count > 3 THEN
          RETURN 'pitch scene shot may carry at most 3 punches';
        END IF;
        IF word_pop_count > 4 THEN
          RETURN 'pitch scene shot may carry at most 4 wordPops';
        END IF;
        -- The zoom ceiling is on what the viewer actually sees: the tightest
        -- crop the shot reaches, multiplied by its loudest punch. A detail shot
        -- cannot reach 1.5x and then punch past it.
        IF (1 / tightest) * punch_scale > (1 / min_size) + slack THEN
          RETURN 'pitch scene shot may not zoom past the ceiling for its level';
        END IF;
      END IF;

      previous_end := end_ms;
    END LOOP;

    IF previous_end IS DISTINCT FROM duration THEN
      RETURN 'pitch scene shots must be contiguous from 0 to durationMs';
    END IF;

    -- Set equality, both directions: a shot may only use a listed photo, and
    -- every listed photo must appear in at least one shot. Approval compares the
    -- header against the Dater's include set, so a header that disagrees with
    -- the shots would make that comparison meaningless.
    IF (SELECT array_agg(DISTINCT declared.asset_id) FROM unnest(declared_ids) AS declared(asset_id))
       IS DISTINCT FROM
       (SELECT array_agg(DISTINCT used.asset_id) FROM unnest(used_ids) AS used(asset_id)) THEN
      RETURN 'pitch scene assetIds must be exactly the photos its shots use';
    END IF;

    -- Scene-level look. Restarting a grade or re-seeding grain at a cut is
    -- visible, which is why these are not per shot.
    IF NOT private.pitch_scene_keys_are(scene -> 'look', ARRAY['grade', 'grain']) THEN
      RETURN 'pitch scene look must carry only a grade and a grain';
    END IF;
    IF NOT private.pitch_scene_keys_are(
         scene -> 'look' -> 'grade',
         ARRAY['warmth', 'contrast', 'saturation', 'vignette']
       )
       OR NOT private.pitch_scene_number_in(scene -> 'look' -> 'grade' -> 'warmth', -1, 1)
       OR NOT private.pitch_scene_number_in(scene -> 'look' -> 'grade' -> 'contrast', 0.8, 1.4)
       OR NOT private.pitch_scene_number_in(scene -> 'look' -> 'grade' -> 'saturation', 0.6, 1.4)
       OR NOT private.pitch_scene_number_in(scene -> 'look' -> 'grade' -> 'vignette', 0, 0.6) THEN
      RETURN 'pitch scene grade must carry a warmth, a contrast, a saturation and a vignette in range';
    END IF;
    -- Grain is the one place where safety is an amplitude bound rather than a
    -- frequency bound: it is sub-pixel texture that resamples per frame in every
    -- real film emulation, so it may animate up to frame rate and its luminance
    -- swing is held under the flash threshold by the intensity ceiling instead.
    IF NOT private.pitch_scene_keys_are(
         scene -> 'look' -> 'grain',
         ARRAY['intensity', 'sizePx', 'seed', 'animationHz']
       )
       OR NOT private.pitch_scene_number_in(scene -> 'look' -> 'grain' -> 'intensity', 0, 0.25)
       OR NOT private.pitch_scene_number_in(scene -> 'look' -> 'grain' -> 'sizePx', 1, 4)
       OR NOT private.pitch_scene_integer_in(scene -> 'look' -> 'grain' -> 'seed', 0, 2147483647)
       OR NOT private.pitch_scene_number_in(scene -> 'look' -> 'grain' -> 'animationHz', 0, 30) THEN
      RETURN 'pitch scene grain must carry an intensity, a sizePx, a seed and an animationHz in range';
    END IF;

    chrome := scene -> 'chrome';
    IF jsonb_typeof(chrome) IS DISTINCT FROM 'object'
       OR EXISTS (
         SELECT 1
           FROM jsonb_object_keys(chrome) AS present(key)
          WHERE NOT (present.key = ANY(ARRAY['progressBar', 'waveViz']))
       ) THEN
      RETURN 'pitch scene chrome must carry only a progressBar and a waveViz';
    END IF;
    IF chrome ? 'progressBar' THEN
      IF NOT private.pitch_scene_keys_are(
           chrome -> 'progressBar', ARRAY['thicknessPx', 'opacity', 'anchor']
         )
         OR NOT private.pitch_scene_integer_in(chrome -> 'progressBar' -> 'thicknessPx', 2, 12)
         OR NOT private.pitch_scene_number_in(chrome -> 'progressBar' -> 'opacity', 0.2, 1)
         OR NOT private.pitch_scene_token(
              chrome -> 'progressBar' -> 'anchor', ARRAY['top', 'bottom']
            ) THEN
        RETURN 'pitch scene progressBar must carry a thicknessPx, an opacity and an anchor in range';
      END IF;
    END IF;
    IF chrome ? 'waveViz' THEN
      wave_viz := chrome -> 'waveViz';
      IF NOT private.pitch_scene_keys_are(
           wave_viz,
           ARRAY['amplitudes', 'sampleIntervalMs', 'heightPx', 'opacity', 'anchor']
         )
         OR NOT private.pitch_scene_integer_in(wave_viz -> 'sampleIntervalMs', 40, 1000)
         OR NOT private.pitch_scene_integer_in(wave_viz -> 'heightPx', 24, 240)
         OR NOT private.pitch_scene_number_in(wave_viz -> 'opacity', 0.2, 1)
         OR NOT private.pitch_scene_token(wave_viz -> 'anchor', ARRAY['top', 'bottom'])
         OR jsonb_typeof(wave_viz -> 'amplitudes') IS DISTINCT FROM 'array'
         OR jsonb_array_length(wave_viz -> 'amplitudes') NOT BETWEEN 1 AND 4096
         OR EXISTS (
           SELECT 1
             FROM jsonb_array_elements(wave_viz -> 'amplitudes') AS sample(value)
            WHERE NOT private.pitch_scene_number_in(sample.value, 0, 1)
         ) THEN
        RETURN 'pitch scene waveViz must carry amplitudes, a sampleIntervalMs, a heightPx, an opacity and an anchor in range';
      END IF;
      -- The envelope is baked, so it has to cover the whole scene exactly: a
      -- player that stretched a short envelope would be re-deriving the shape at
      -- playback time, which is what approval forbids.
      IF jsonb_array_length(wave_viz -> 'amplitudes') <> ceil(
           duration::NUMERIC / private.pitch_scene_integer(wave_viz -> 'sampleIntervalMs')
         ) THEN
        RETURN 'pitch scene waveViz must carry one amplitude per sample interval';
      END IF;
    END IF;

    overlay_count := CASE
      WHEN jsonb_typeof(scene -> 'overlays') = 'array'
        THEN jsonb_array_length(scene -> 'overlays')
    END;
    IF overlay_count IS NULL OR overlay_count > 64 THEN
      RETURN 'pitch scene overlays must be a list of at most 64 overlays';
    END IF;
    FOR overlay_index IN 0 .. overlay_count - 1 LOOP
      overlay := scene -> 'overlays' -> overlay_index;
      IF NOT private.pitch_scene_token(
           overlay -> 'type', ARRAY['lightLeak', 'countBadge']
         ) THEN
        RETURN 'pitch scene overlay type must be lightLeak or countBadge';
      END IF;
      overlay_type := overlay ->> 'type';
      IF NOT private.pitch_scene_integer_in(overlay -> 'startMs', 0, 600000)
         OR NOT private.pitch_scene_integer_in(overlay -> 'endMs', 0, 600000) THEN
        RETURN 'pitch scene overlay must carry a whole millisecond startMs and endMs';
      END IF;
      start_ms := private.pitch_scene_integer(overlay -> 'startMs');
      end_ms := private.pitch_scene_integer(overlay -> 'endMs');
      IF end_ms > duration THEN
        RETURN 'pitch scene overlay must end within the scene';
      END IF;

      IF overlay_type = 'lightLeak' THEN
        IF NOT private.pitch_scene_keys_are(
             overlay,
             ARRAY['type', 'startMs', 'endMs', 'peakIntensity', 'pulseHz', 'angleDeg']
           ) THEN
          RETURN 'pitch scene lightLeak must carry only type, startMs, endMs, peakIntensity, pulseHz and angleDeg';
        END IF;
        -- The 3Hz ceiling on oscillating luminance. It is a photosensitivity
        -- bound, not a style choice, and the viewer never consented to anything.
        -- pulseHz is a WHOLE number so that floor(k * 1000 / pulseHz) below lands
        -- on the same millisecond in PL/pgSQL NUMERIC, JavaScript float and zod:
        -- a fractional Hz can put the three divisions on either side of an
        -- integer boundary and split the peak lists the budget compares.
        IF NOT private.pitch_scene_number_in(overlay -> 'peakIntensity', 0, 0.6)
           OR NOT private.pitch_scene_integer_in(overlay -> 'pulseHz', 0, 3)
           OR NOT private.pitch_scene_number_in(overlay -> 'angleDeg', 0, 360) THEN
          RETURN 'pitch scene lightLeak must carry a peakIntensity, a whole-number pulseHz of at most 3 and an angleDeg in range';
        END IF;
        IF end_ms - start_ms < 120 OR end_ms - start_ms > 1200 THEN
          RETURN 'a pitch scene lightLeak must last between 120ms and 1200ms';
        END IF;
        -- EXPAND THE PULSE, do not count the overlay. A 3Hz leak lasting 1200ms
        -- delivers four luminance peaks; counting only its onset let three
        -- punches sit between them and put five events inside one second.
        leak_pulse_hz := private.pitch_scene_integer(overlay -> 'pulseHz');
        IF leak_pulse_hz = 0 THEN
          -- No oscillation, but the leak still appears once.
          flash_events := array_append(flash_events, start_ms);
        ELSE
          -- Bound on the series, not the rule: the half-open filter decides which
          -- peaks count. 60s x 3Hz = 180 caps the walk even if the leak length
          -- range widened later.
          leak_pulse_max_index := least(
            ceil((end_ms - start_ms)::NUMERIC * leak_pulse_hz / 1000)::BIGINT, 180
          );
          flash_events := flash_events || (
            SELECT coalesce(array_agg(peak.at_ms), ARRAY[]::BIGINT[])
              FROM (
                SELECT start_ms
                       + div(series.k::NUMERIC * 1000, leak_pulse_hz)::BIGINT AS at_ms
                  FROM generate_series(0, leak_pulse_max_index) AS series(k)
              ) AS peak
             -- [startMs, endMs): a peak landing exactly on endMs belongs to no
             -- frame the leak is still drawn on.
             WHERE peak.at_ms < end_ms
          );
        END IF;
      ELSE
        IF NOT private.pitch_scene_keys_are(
             overlay, ARRAY['type', 'source', 'startMs', 'endMs', 'emphasis']
           ) THEN
          RETURN 'pitch scene countBadge must carry only type, source, startMs, endMs and emphasis';
        END IF;
        IF NOT private.pitch_scene_token(overlay -> 'source', text_sources) THEN
          RETURN 'pitch scene text source must name a reviewed structure field';
        END IF;
        IF NOT private.pitch_scene_number_in(overlay -> 'emphasis', 0, 1) THEN
          RETURN 'pitch scene emphasis must be between 0 and 1';
        END IF;
        IF end_ms - start_ms < 400 OR end_ms - start_ms > 4000 THEN
          RETURN 'a pitch scene countBadge must last between 400ms and 4000ms';
        END IF;
        -- A badge arriving over a scrim is an appearance event too. Its scrim is
        -- the brightest thing a countBadge does, and the player ramps it, but the
        -- rate at which badges may arrive is decided here.
        flash_events := array_append(flash_events, start_ms);
        needs_structure := true;
      END IF;

      IF jsonb_typeof(last_overlay_end -> overlay_type) = 'number'
         AND start_ms < (last_overlay_end ->> overlay_type)::BIGINT THEN
        RETURN 'pitch scene overlays of one type must be ordered and must not overlap';
      END IF;
      last_overlay_end := last_overlay_end || jsonb_build_object(overlay_type, end_ms);
    END LOOP;

    -- THE FLASH BUDGET. One timeline for the UNION of every instantaneous
    -- luminance or appearance event: punch onsets, each expanded lightLeak pulse
    -- peak, wordPop appearances and countBadge appearances. Two of them 100ms
    -- apart is a 10Hz stimulus no matter which types they were, and an event a
    -- viewer perceives as a flash does not stop being one because the layer that
    -- drew it is called text. 334ms between any two means any one-second window
    -- holds at most three, which is WCAG 2.3.1's general flash threshold.
    -- Shot cuts are already >=1200ms apart, so they cannot contribute.
    SELECT array_agg(event.value ORDER BY event.value)
      INTO sorted_flashes
      FROM unnest(flash_events) AS event(value);
    FOR flash_index IN 2 .. coalesce(array_length(sorted_flashes, 1), 0) LOOP
      IF sorted_flashes[flash_index] - sorted_flashes[flash_index - 1]
         < min_flash_interval_ms THEN
        RETURN 'pitch scene flashes must be at least 334ms apart';
      END IF;
    END LOOP;

    -- Gap (b): a card prints a sentence out of the reviewed structure, so the
    -- five published fields have to exist on the same row. Without them the card
    -- would be blank, or a later structure write would silently give it words.
    IF needs_structure
       AND private.dater_pitch_published_structure(structure) IS NULL THEN
      RETURN 'pitch scene text requires the five reviewed structure fields';
    END IF;

    RETURN NULL;
  END IF;

  -- ══ v1 (0048, unchanged) ══════════════════════════════════════════════
  IF jsonb_typeof(scene) IS DISTINCT FROM 'object'
     OR jsonb_typeof(scene -> 'schemaVersion') IS DISTINCT FROM 'number'
     OR jsonb_typeof(scene -> 'canvas') IS DISTINCT FROM 'object'
     OR jsonb_typeof(scene -> 'durationMs') IS DISTINCT FROM 'number'
     OR jsonb_typeof(scene -> 'scenes') IS DISTINCT FROM 'array'
     OR (SELECT count(*) FROM jsonb_object_keys(scene)) <> 4 THEN
    RETURN 'pitch scene must carry only schemaVersion, canvas, durationMs and scenes';
  END IF;

  IF private.pitch_scene_integer(scene -> 'schemaVersion') IS DISTINCT FROM 1 THEN
    RETURN 'pitch scene schemaVersion must be 1';
  END IF;

  canvas := scene -> 'canvas';
  IF (SELECT count(*) FROM jsonb_object_keys(canvas)) <> 3
     OR coalesce(private.pitch_scene_integer(canvas -> 'width'), 0) NOT BETWEEN 16 AND 8192
     OR coalesce(private.pitch_scene_integer(canvas -> 'height'), 0) NOT BETWEEN 16 AND 8192
     OR coalesce(private.pitch_scene_integer(canvas -> 'fps'), 0) NOT BETWEEN 1 AND 120 THEN
    RETURN 'pitch scene canvas must carry a width, a height and an fps in range';
  END IF;

  -- A scene cannot exist without transcript segments to hang it on, because
  -- there would then be no reproducible duration to agree with.
  IF duration_ms_expected IS NULL THEN
    RETURN 'pitch scene requires transcript segments';
  END IF;
  IF private.pitch_scene_integer(scene -> 'durationMs')
     IS DISTINCT FROM duration_ms_expected::BIGINT THEN
    RETURN 'pitch scene duration must match the transcript segments';
  END IF;

  entries := scene -> 'scenes';
  entry_count := jsonb_array_length(entries);
  IF entry_count < 1 THEN
    RETURN 'pitch scene requires at least one photo scene';
  END IF;
  -- One scene per photo at most. More scenes than photos means a photo is
  -- reused, which the per-entry duplicate check would catch anyway, but the
  -- count is the cheaper and clearer refusal.
  IF entry_count > coalesce(array_length(photos, 1), 0) THEN
    RETURN 'pitch scene must not use more scenes than reviewed photos';
  END IF;

  FOR entry_index IN 0 .. entry_count - 1 LOOP
    entry := entries -> entry_index;
    start_ms := private.pitch_scene_integer(entry -> 'startMs');
    end_ms := private.pitch_scene_integer(entry -> 'endMs');
    IF jsonb_typeof(entry) IS DISTINCT FROM 'object'
       OR (SELECT count(*) FROM jsonb_object_keys(entry)) <> 3
       OR jsonb_typeof(entry -> 'assetId') IS DISTINCT FROM 'string'
       OR start_ms IS NULL
       OR end_ms IS NULL THEN
      RETURN 'pitch scene entry must carry only assetId, startMs and endMs';
    END IF;
    -- Canonical dashed lowercase/uppercase form only. PostgreSQL's UUID input
    -- also accepts braces and unseparated hex, which would let the same asset
    -- appear under several spellings and produce different scene hashes.
    IF (entry ->> 'assetId')
       !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RETURN 'pitch scene entry must carry only assetId, startMs and endMs';
    END IF;
    entry_asset_id := (entry ->> 'assetId')::UUID;

    -- Contiguity: the first scene starts at 0, each later scene starts exactly
    -- where the previous one ended. This single equality rejects gaps (black
    -- frames) and overlaps (undefined stacking order) alike.
    IF start_ms IS DISTINCT FROM previous_end THEN
      RETURN 'pitch scenes must be contiguous from 0 to durationMs';
    END IF;
    IF end_ms - start_ms < 1000 THEN
      RETURN 'every pitch scene must last at least 1000ms';
    END IF;

    IF NOT (entry_asset_id = ANY(photos)) THEN
      RETURN 'pitch scene must reference only reviewed photo assets';
    END IF;
    IF entry_asset_id = ANY(seen_asset_ids) THEN
      RETURN 'pitch scene must not repeat a photo';
    END IF;
    seen_asset_ids := array_append(seen_asset_ids, entry_asset_id);

    previous_end := end_ms;
  END LOOP;

  IF previous_end IS DISTINCT FROM duration_ms_expected::BIGINT THEN
    RETURN 'pitch scenes must be contiguous from 0 to durationMs';
  END IF;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION
  private.pitch_scene_violation(JSONB, INTEGER, UUID[], JSONB, JSONB) FROM PUBLIC;

COMMENT ON FUNCTION
  private.pitch_scene_violation(JSONB, INTEGER, UUID[], JSONB, JSONB) IS
  'NULL when the PitchScene payload satisfies every mechanical safety rule for its schemaVersion, otherwise the pinned rejection message. v1 is judged exactly as 0048 judged it. v2 additionally resolves its references against the transcript and structure of the row it is being written onto: a wordPop needs word timings, a kineticText or countBadge needs the five published structure fields. A NULL scene is acceptable and means the pitch has no motion.';

-- ── Canonical form ──────────────────────────────────────────────────────
-- The stored jsonb IS the hashed bytes, so equal timelines must serialize
-- identically. The v1 rebuild is unchanged; v2 takes the generic walk (header
-- decision 4). Assumes private.pitch_scene_violation already returned NULL.
CREATE OR REPLACE FUNCTION private.normalized_pitch_scene(scene JSONB)
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
SET search_path = public, extensions, pg_temp
AS $$
  SELECT CASE
    WHEN private.pitch_scene_integer(scene -> 'schemaVersion') = 2
      THEN private.canonical_pitch_json(scene)
    ELSE jsonb_build_object(
      'schemaVersion', 1,
      'canvas', jsonb_build_object(
        'width', private.pitch_scene_integer(scene -> 'canvas' -> 'width'),
        'height', private.pitch_scene_integer(scene -> 'canvas' -> 'height'),
        'fps', private.pitch_scene_integer(scene -> 'canvas' -> 'fps')
      ),
      'durationMs', private.pitch_scene_integer(scene -> 'durationMs'),
      'scenes', (
        SELECT jsonb_agg(
                 jsonb_build_object(
                   'assetId', lower(entry.value ->> 'assetId'),
                   'startMs', private.pitch_scene_integer(entry.value -> 'startMs'),
                   'endMs', private.pitch_scene_integer(entry.value -> 'endMs')
                 )
                 ORDER BY entry.ord
               )
          FROM jsonb_array_elements(scene -> 'scenes')
               WITH ORDINALITY AS entry(value, ord)
      )
    )
  END
  WHERE scene IS NOT NULL;
$$;

COMMENT ON FUNCTION private.normalized_pitch_scene(JSONB) IS
  'Canonical form of a validated scene of either version: the explicit v1 rebuild from 0048, or the generic canonical walk for v2. NULL in, NULL out.';

-- Raising wrapper for the client-supplied paths. Returns the canonical scene so
-- callers store and hash the same value they validated. Dropped and recreated
-- rather than overloaded for the reason given above the validator.
DROP FUNCTION private.assert_scene_definition(JSONB, INTEGER, UUID[]);

CREATE FUNCTION private.assert_scene_definition(
  scene JSONB,
  duration_ms_expected INTEGER,
  photo_asset_ids UUID[],
  transcript JSONB,
  structure JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  violation TEXT;
BEGIN
  violation := private.pitch_scene_violation(
    scene, duration_ms_expected, photo_asset_ids, transcript, structure
  );
  IF violation IS NOT NULL THEN
    RAISE EXCEPTION '%', violation;
  END IF;
  RETURN private.normalized_pitch_scene(scene);
END;
$$;

REVOKE ALL ON FUNCTION
  private.assert_scene_definition(JSONB, INTEGER, UUID[], JSONB, JSONB) FROM PUBLIC;

COMMENT ON FUNCTION
  private.assert_scene_definition(JSONB, INTEGER, UUID[], JSONB, JSONB) IS
  'Validates a client-supplied PitchScene payload of either version against the row it is being written onto and returns its canonical form, or raises the pinned rejection message. Returns NULL for a NULL scene.';

-- ── submit_pitch_for_consent (full redefinition from 0048) ──────────────
-- Signature unchanged, so CREATE OR REPLACE keeps every grant and every call
-- site. The only change is the validator call: the draft's transcript and
-- structure now travel with the scene, because a v2 scene may reference a word
-- in one and a sentence in the other. Both are what the insert trigger (0032)
-- and the revision row freeze, so the reference is checked against exactly the
-- copy the Dater will review.
CREATE OR REPLACE FUNCTION public.submit_pitch_for_consent(
  draft_id UUID,
  invite_channel TEXT DEFAULT NULL,
  invite_contact TEXT DEFAULT NULL,
  invite_friend_name TEXT DEFAULT NULL,
  new_scene JSONB DEFAULT NULL
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
  snapshot_photo_asset_ids UUID[];
  snapshot_voice_asset_path TEXT;
  next_revision_number INTEGER;
  new_revision_id UUID;
  new_request_id UUID;
  canonical_content JSONB;
  final_scene JSONB;
  final_scene_hash TEXT;
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
    coalesce(
      array_agg(id ORDER BY id) FILTER (WHERE asset_type = 'photo'),
      ARRAY[]::UUID[]
    ),
    (
      array_agg(storage_path ORDER BY sort_order, id)
        FILTER (WHERE asset_type = 'voice')
    )[1]
    INTO snapshot_asset_ids, snapshot_photo_asset_ids, snapshot_voice_asset_path
    FROM pitch_assets
   WHERE pitch_draft_id = draft.id;

  -- The duration comes from the draft transcript, which the insert trigger
  -- (0032) freezes onto this revision, so the scene and the captions the player
  -- derives are measured against the same segments forever.
  final_scene := private.assert_scene_definition(
    new_scene,
    private.pitch_transcript_duration_ms(draft.transcript),
    snapshot_photo_asset_ids,
    draft.transcript,
    draft.structure
  );
  IF final_scene IS NOT NULL THEN
    final_scene_hash := encode(digest(final_scene::TEXT, 'sha256'), 'hex');
  END IF;

  SELECT coalesce(max(revision_number), 0) + 1 INTO next_revision_number
    FROM consent_revisions
   WHERE pitch_draft_id = draft.id;

  canonical_content := jsonb_build_object(
    'headline', draft.headline,
    'body', draft.body,
    'structure', draft.structure,
    'asset_ids', to_jsonb(snapshot_asset_ids),
    'voice_asset_path', snapshot_voice_asset_path,
    'scene', final_scene
  );

  INSERT INTO consent_revisions (
    pitch_draft_id,
    revision_number,
    headline,
    body,
    structure,
    asset_ids,
    voice_asset_path,
    scene_definition,
    scene_hash,
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
    final_scene,
    final_scene_hash,
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

COMMENT ON FUNCTION public.submit_pitch_for_consent(UUID, TEXT, TEXT, TEXT, JSONB) IS
  'Pitch photo/audio validation is fail-closed only while media_validation_enforcement is on. new_scene attaches the Introducer-built PitchScene timeline (v1 or v2) to the first revision; it is rejected unless it covers exactly the transcript duration under the mechanical rules for its version, and a v2 scene may only reference words this recording actually timed and structure fields this draft actually carries. Omitting it publishes without motion.';

-- ── create_dater_revision (full redefinition from 0048) ─────────────────
-- Signature unchanged. Two validator calls now carry the transcript and the
-- structure of the revision being written: the Dater's own timeline, and the
-- carry-forward re-check. Carry-forward uses final_structure rather than the
-- prior one on purpose — the scene has to be valid against the row it is about
-- to live on, and a structure that no longer backs a text card demotes the
-- scene to "no motion" exactly like a dropped photo does.
CREATE OR REPLACE FUNCTION public.create_dater_revision(
  draft_id UUID,
  new_headline TEXT,
  new_body TEXT,
  included_asset_ids UUID[] DEFAULT NULL,
  new_structure JSONB DEFAULT NULL,
  retained_hard_claims TEXT[] DEFAULT NULL,
  new_scene JSONB DEFAULT NULL
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
  snapshot_photo_asset_ids UUID[];
  next_revision_number INTEGER;
  new_revision_id UUID;
  canonical_content JSONB;
  is_dater_edited BOOLEAN;
  reviewed_structure BOOLEAN;
  normalized_structure JSONB;
  final_structure JSONB;
  published_structure JSONB;
  prior_published_structure JSONB;
  prior_hard_claims JSONB;
  final_hard_claims JSONB;
  effective_headline TEXT;
  effective_body TEXT;
  prior_headline TEXT;
  prior_body TEXT;
  moderation_text TEXT;
  scene_duration_ms INTEGER;
  final_scene JSONB;
  final_scene_hash TEXT;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;
  PERFORM private.assert_active_account(caller);

  -- Ownership is settled before any input validation, so the RPC cannot be
  -- used as a free structure validator against someone else's draft.
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

  -- Merge order matters: the prior structure supplies every AI-owned key and
  -- the five validated fields override it. A client-sent hard_claims value is
  -- absent from normalized_structure, so it can never win here.
  IF new_structure IS NULL THEN
    final_structure := latest.structure;
  ELSE
    normalized_structure := private.normalized_dater_pitch_structure(new_structure);
    final_structure := coalesce(latest.structure, '{}'::JSONB) || normalized_structure;
  END IF;

  -- Per-claim disposition. The Dater may drop a flagged claim they removed
  -- from their words, but may never introduce one: every retained value has to
  -- appear in the prior revision's flagged list. NULL (the default) means "no
  -- disposition given" and keeps the whole list; an empty array means "I
  -- removed all of them" and is a different, valid answer.
  prior_hard_claims := CASE
    WHEN jsonb_typeof(latest.structure -> 'hard_claims_requiring_confirmation') = 'array'
      THEN latest.structure -> 'hard_claims_requiring_confirmation'
    ELSE '[]'::JSONB
  END;
  IF retained_hard_claims IS NULL THEN
    final_hard_claims := prior_hard_claims;
  ELSE
    IF EXISTS (
      SELECT 1
        FROM unnest(retained_hard_claims) AS retained(value)
       WHERE retained.value IS NULL
          OR NOT EXISTS (
            SELECT 1
              FROM jsonb_array_elements_text(prior_hard_claims) AS flagged(value)
             WHERE flagged.value = retained.value
          )
    ) THEN
      RAISE EXCEPTION 'hard claim is not one of the flagged claims';
    END IF;
    final_hard_claims := to_jsonb(retained_hard_claims);
  END IF;
  -- A revision with no structure at all keeps none: fabricating one for a
  -- headline/body-only pitch would change what publish copies forward.
  IF final_structure IS NOT NULL THEN
    final_structure := final_structure
      || jsonb_build_object('hard_claims_requiring_confirmation', final_hard_claims);
  END IF;

  -- Whenever the revision carries the five published fields, they ARE the
  -- pitch: headline/body are derived from them on every path, so a legacy
  -- 4-argument call can no longer store client copy while publishing the AI's
  -- sentences. new_headline/new_body are consulted only for a revision that
  -- has no published structure at all.
  published_structure := private.dater_pitch_published_structure(final_structure);
  prior_published_structure := private.dater_pitch_published_structure(latest.structure);

  IF published_structure IS NULL THEN
    IF private.pitch_text_is_blank(new_headline)
       OR private.pitch_text_is_blank(new_body) THEN
      RAISE EXCEPTION 'headline and body are required';
    END IF;
    IF char_length(new_headline) > 120 OR char_length(new_body) > 2000 THEN
      RAISE EXCEPTION 'headline or body is too long';
    END IF;
    effective_headline := btrim(new_headline);
    effective_body := btrim(new_body);
  ELSE
    effective_headline := published_structure ->> 'hook';
    effective_body := private.dater_pitch_body_from_structure(published_structure);
  END IF;

  IF prior_published_structure IS NULL THEN
    prior_headline := btrim(latest.headline);
    prior_body := btrim(latest.body);
  ELSE
    prior_headline := prior_published_structure ->> 'hook';
    prior_body := private.dater_pitch_body_from_structure(prior_published_structure);
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

  -- The photos of THIS snapshot, which is what a scene may reference. A photo
  -- the Dater just dropped is gone from here, which is what makes the
  -- carry-forward below re-validate instead of trusting the old timeline.
  SELECT coalesce(array_agg(id ORDER BY id), ARRAY[]::UUID[])
    INTO snapshot_photo_asset_ids
    FROM pitch_assets
   WHERE pitch_draft_id = draft.id
     AND asset_type = 'photo'
     AND id = ANY(snapshot_asset_ids);

  -- The transcript is carried forward verbatim below, so the duration a scene
  -- must match never moves inside one consent review.
  scene_duration_ms := private.pitch_transcript_duration_ms(latest.transcript);

  IF new_scene IS NOT NULL THEN
    final_scene := private.assert_scene_definition(
      new_scene, scene_duration_ms, snapshot_photo_asset_ids,
      latest.transcript, final_structure
    );
  ELSIF latest.scene_definition IS NOT NULL THEN
    -- Carry the reviewed timeline forward, but re-check it against the NEW
    -- snapshot: a save that drops a photo the scene still points at would
    -- otherwise leave a dangling reference once approval deletes that asset.
    -- Demotion to NULL (no motion) is the safe answer — refusing the save
    -- would trap a Dater who simply removed a photo.
    IF private.pitch_scene_violation(
         latest.scene_definition, scene_duration_ms, snapshot_photo_asset_ids,
         latest.transcript, final_structure
       ) IS NULL THEN
      final_scene := private.normalized_pitch_scene(latest.scene_definition);
    END IF;
  END IF;
  IF final_scene IS NOT NULL THEN
    final_scene_hash := encode(digest(final_scene::TEXT, 'sha256'), 'hex');
  END IF;

  moderation_text := private.dater_revision_moderation_text(
    effective_headline, effective_body, published_structure
  );

  IF private.media_validation_enforcement() THEN
    IF NOT private.pitch_photos_validated(snapshot_asset_ids) THEN
      RAISE EXCEPTION 'photos must pass validation before they can enter a revision';
    END IF;
    -- Unconditional, including on a photo-only save: every revision must carry
    -- a passed verdict for the exact words it publishes. A save that repeats
    -- the prior revision's words now looks up the SAME hash the edit
    -- registered, so this no longer locks the Dater out — but text that
    -- entered while enforcement was off still has to earn a verdict on the
    -- first save after the switch is flipped. The web client must therefore
    -- moderate the string it is about to save on every save, not only when the
    -- text changed.
    IF NOT private.text_moderation_passed('pitch_content', moderation_text) THEN
      RAISE EXCEPTION 'pitch text requires a passed moderation verdict';
    END IF;
  END IF;

  is_dater_edited := (effective_headline IS DISTINCT FROM prior_headline)
    OR (effective_body IS DISTINCT FROM prior_body)
    OR (final_structure IS DISTINCT FROM latest.structure);

  -- Sticky within one consent review: once the Dater has submitted the five
  -- fields, a later photo-only save carries that same structure forward, so
  -- the structure on the page is still the one they reviewed.
  reviewed_structure := (new_structure IS NOT NULL) OR latest.structure_reviewed;

  SELECT coalesce(max(consent_revisions.revision_number), 0) + 1
    INTO next_revision_number
    FROM consent_revisions
   WHERE pitch_draft_id = draft.id;

  canonical_content := jsonb_build_object(
    'headline', effective_headline,
    'body', effective_body,
    'structure', final_structure,
    'asset_ids', to_jsonb(snapshot_asset_ids),
    'voice_asset_path', latest.voice_asset_path,
    'scene', final_scene
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
    scene_definition,
    scene_hash,
    content_hash,
    dater_edited,
    structure_reviewed
  )
  VALUES (
    draft.id,
    next_revision_number,
    effective_headline,
    effective_body,
    final_structure,
    snapshot_asset_ids,
    latest.voice_asset_path,
    latest.transcript,
    final_scene,
    final_scene_hash,
    encode(digest(canonical_content::TEXT, 'sha256'), 'hex'),
    is_dater_edited,
    reviewed_structure
  )
  RETURNING id INTO new_revision_id;

  UPDATE consent_requests
     SET revision_id = new_revision_id
   WHERE id = request.id;

  RETURN QUERY SELECT new_revision_id, next_revision_number;
END;
$$;

COMMENT ON FUNCTION
  public.create_dater_revision(UUID, TEXT, TEXT, UUID[], JSONB, TEXT[], JSONB) IS
  'Creates the Dater-approved consent revision. Whenever the revision structure carries the five published fields, headline/body are derived from it and new_headline/new_body are ignored — on the legacy 4-argument path too. retained_hard_claims dispositions the flagged claim list: NULL keeps it, an array narrows it to exactly those claims, and a value that was not already flagged is rejected. new_scene replaces the reviewed motion timeline; omitting it carries the previous one forward only while it still validates against the new snapshot — every photo it references survives, and every word or structure field it references still resolves — and otherwise stores no scene.';

-- ── approve_and_publish_pitch (full redefinition from 0048) ─────────────
-- One change: where the scene's photo set comes from. A v2 scene carries the
-- authoritative list in its `assetIds` header, so approval reads that instead
-- of walking the shots — which is the reason the header exists. The v1 path is
-- untouched. Everything else, including the set-equality refusal itself, is
-- 0048's.
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
  scene_photo_ids UUID[];
  approved_photo_ids UUID[];
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

  -- Set equality, both directions. A scene photo missing from the approved set
  -- would be deleted below and leave a dangling reference; an approved photo
  -- missing from the scene would publish a photo that never appears in the
  -- motion the Dater watched.
  IF approved_revision.scene_definition IS NOT NULL THEN
    IF private.pitch_scene_integer(
         approved_revision.scene_definition -> 'schemaVersion'
       ) = 2 THEN
      SELECT coalesce(array_agg(asset_id ORDER BY asset_id), ARRAY[]::UUID[])
        INTO scene_photo_ids
        FROM (
          SELECT DISTINCT (listed.value #>> '{}')::UUID AS asset_id
            FROM jsonb_array_elements(
                   approved_revision.scene_definition -> 'assetIds'
                 ) AS listed(value)
        ) AS scene_photo;
    ELSE
      SELECT coalesce(array_agg(asset_id ORDER BY asset_id), ARRAY[]::UUID[])
        INTO scene_photo_ids
        FROM (
          SELECT DISTINCT (entry.value ->> 'assetId')::UUID AS asset_id
            FROM jsonb_array_elements(
                   approved_revision.scene_definition -> 'scenes'
                 ) AS entry(value)
        ) AS scene_photo;
    END IF;
    SELECT coalesce(array_agg(asset_id ORDER BY asset_id), ARRAY[]::UUID[])
      INTO approved_photo_ids
      FROM (
        SELECT DISTINCT candidate_id AS asset_id
          FROM unnest(included_asset_ids) candidate_id
      ) AS approved_photo;
    IF scene_photo_ids IS DISTINCT FROM approved_photo_ids THEN
      RAISE EXCEPTION 'approved photos must match the reviewed motion scene photos';
    END IF;
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
         structure_reviewed = approved_revision.structure_reviewed,
         scene_definition = approved_revision.scene_definition,
         scene_hash = approved_revision.scene_hash,
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

COMMENT ON FUNCTION
  public.approve_and_publish_pitch(UUID, INTEGER, UUID, UUID[], BOOLEAN) IS
  'Publishes exactly the approved revision, including its reviewed motion timeline. When the revision carries a scene, included_asset_ids must be the same set of photos the scene references — the assetIds header for v2, the scene entries for v1 — because this RPC deletes the photos outside that set and a mismatch would publish a timeline with dangling references.';
