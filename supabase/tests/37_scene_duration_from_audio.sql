-- 37: a scene lasts as long as the recording, not as long as the words
-- (0062 — T003 / Issue #72).
--
-- The production case is the fixture: a 54.543s take whose last transcript
-- segment ends at 37.66s. Before 0062 `private.pitch_transcript_duration_ms`
-- answered 37660 for it, the approved scene claimed 37660ms, and the player
-- froze the picture fifteen seconds before the voice stopped.
--
-- red-first: on 0061 probe (A) below gets 37660 instead of 54543 and raises,
-- and probe (D) fails to publish the 54543ms scene the new rule requires.
--
-- Probes (B) and (C) are the ones that protect what is already published: a
-- transcript with no reported audio length, and one whose reported length is
-- shorter than its own words, both answer exactly what 0049 answered. Every
-- stored scene was written under that answer and is hashed over it, so a
-- change here would invalidate live campaigns rather than lengthen them.

BEGIN;

DO $$
DECLARE
  -- The two transcripts differ in one key. Segment ends are seconds, as the
  -- provider reports them and as /api/transcribe stores them.
  with_audio CONSTANT JSONB := jsonb_build_object(
    'text', 'a real take',
    'durationMs', 54543,
    'segments', jsonb_build_array(
      jsonb_build_object('start', 0, 'end', 12.5, 'text', 'first'),
      jsonb_build_object('start', 12.5, 'end', 37.66, 'text', 'last')
    )
  );
  without_audio CONSTANT JSONB := jsonb_build_object(
    'text', 'a real take',
    'segments', jsonb_build_array(
      jsonb_build_object('start', 0, 'end', 12.5, 'text', 'first'),
      jsonb_build_object('start', 12.5, 'end', 37.66, 'text', 'last')
    )
  );
  short_audio CONSTANT JSONB := without_audio || jsonb_build_object('durationMs', 20000);
  answer INTEGER;
BEGIN
  -- (A) The reported audio length wins over the last segment end.
  answer := private.pitch_transcript_duration_ms(with_audio);
  IF answer IS DISTINCT FROM 54543 THEN
    RAISE EXCEPTION 'D37-A: reported audio length ignored, got %', answer;
  END IF;

  -- (B) No reported length: the pre-0062 answer, value for value.
  answer := private.pitch_transcript_duration_ms(without_audio);
  IF answer IS DISTINCT FROM 37660 THEN
    RAISE EXCEPTION 'D37-B: legacy transcript re-timed, got %', answer;
  END IF;

  -- (C) The transcribed words are the floor: a provider that reports less than
  -- it transcribed cannot shorten the timeline below its own segments.
  answer := private.pitch_transcript_duration_ms(short_audio);
  IF answer IS DISTINCT FROM 37660 THEN
    RAISE EXCEPTION 'D37-C: a short reported length shortened the scene, got %', answer;
  END IF;

  -- (C2) Anything that is not an integer number of milliseconds is not a
  -- duration: it falls back to the segment rule instead of raising or being
  -- coerced, because `private.pitch_scene_integer` is the only reader and the
  -- TypeScript builders mirror exactly it.
  FOR answer IN
    SELECT private.pitch_transcript_duration_ms(without_audio || candidate.value)
      FROM (VALUES
        (jsonb_build_object('durationMs', '54543')),
        (jsonb_build_object('durationMs', 54543.5)),
        (jsonb_build_object('durationMs', true)),
        (jsonb_build_object('durationMs', -54543)),
        (jsonb_build_object('durationMs', 0)),
        -- Past the 24-hour guard, and past what an INTEGER can hold at all:
        -- both fall back rather than raising, exactly as the TypeScript reader
        -- does (a cast that overflowed here would abort a publish).
        (jsonb_build_object('durationMs', 86400001)),
        (jsonb_build_object('durationMs', 2147483648::BIGINT))
      ) AS candidate(value)
  LOOP
    IF answer IS DISTINCT FROM 37660 THEN
      RAISE EXCEPTION 'D37-C2: an unreadable durationMs changed the answer, got %', answer;
    END IF;
  END LOOP;

  -- (C3) A transcript with no usable segments is still sceneless, however long
  -- the audio ran: there are no words to hang shots on.
  answer := private.pitch_transcript_duration_ms(
    jsonb_build_object('text', 'x', 'durationMs', 54543, 'segments', '[]'::JSONB)
  );
  IF answer IS NOT NULL THEN
    RAISE EXCEPTION 'D37-C3: an audio length invented a scene without segments, got %', answer;
  END IF;
END;
$$;

-- (D) The gate that actually publishes. assert_scene_definition is handed the
-- duration this function computes, so the scene the client sends must now cover
-- the whole recording. A v1 scene is used because its shape is a literal two
-- lines and this probe is about the duration argument, not about v2's ladder.
DO $$
DECLARE
  photo CONSTANT UUID := '11111111-1111-4111-8111-111111111111';
  with_audio CONSTANT JSONB := jsonb_build_object(
    'text', 'a real take',
    'durationMs', 54543,
    'segments', jsonb_build_array(
      jsonb_build_object('start', 0, 'end', 37.66, 'text', 'last')
    )
  );
  without_audio CONSTANT JSONB := jsonb_build_object(
    'text', 'a real take',
    'segments', jsonb_build_array(
      jsonb_build_object('start', 0, 'end', 37.66, 'text', 'last')
    )
  );
  scene_at INTEGER;
  transcript JSONB;
  accepted JSONB;
BEGIN
  FOR transcript, scene_at IN
    SELECT * FROM (VALUES (with_audio, 54543), (without_audio, 37660)) AS pair(t, ms)
  LOOP
    -- The matching length is accepted.
    accepted := private.assert_scene_definition(
      jsonb_build_object(
        'schemaVersion', 1,
        'canvas', jsonb_build_object('width', 1080, 'height', 1920, 'fps', 30),
        'durationMs', scene_at,
        'scenes', jsonb_build_array(
          jsonb_build_object('assetId', photo::TEXT, 'startMs', 0, 'endMs', scene_at)
        )
      ),
      private.pitch_transcript_duration_ms(transcript),
      ARRAY[photo],
      transcript,
      NULL,
      ARRAY[]::UUID[]
    );
    IF private.pitch_scene_integer(accepted -> 'durationMs') IS DISTINCT FROM scene_at::BIGINT THEN
      RAISE EXCEPTION 'D37-D: canonical scene lost its duration at %', scene_at;
    END IF;

    -- The other length — the one the old rule would have produced, or the new
    -- one on a legacy row — is refused. Both directions, so the probe cannot
    -- pass by accepting everything.
    BEGIN
      PERFORM private.assert_scene_definition(
        jsonb_build_object(
          'schemaVersion', 1,
          'canvas', jsonb_build_object('width', 1080, 'height', 1920, 'fps', 30),
          'durationMs', 92203 - scene_at,
          'scenes', jsonb_build_array(
            jsonb_build_object(
              'assetId', photo::TEXT, 'startMs', 0, 'endMs', 92203 - scene_at
            )
          )
        ),
        private.pitch_transcript_duration_ms(transcript),
        ARRAY[photo],
        transcript,
        NULL,
        ARRAY[]::UUID[]
      );
      RAISE EXCEPTION 'D37-D: a scene of % was published against a % recording',
        92203 - scene_at, scene_at;
    EXCEPTION
      WHEN OTHERS THEN
        IF SQLERRM <> 'pitch scene duration must match the transcript segments' THEN
          RAISE;
        END IF;
    END;
  END LOOP;
END;
$$;

-- (E) CREATE OR REPLACE must not have handed the function back to PUBLIC: 0048
-- REVOKEd ALL and nothing was ever granted, so no role may execute it.
DO $$
BEGIN
  IF has_function_privilege(
       'public', 'private.pitch_transcript_duration_ms(JSONB)', 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'D37-E: PUBLIC regained EXECUTE on pitch_transcript_duration_ms';
  END IF;
  IF has_function_privilege(
       'anon', 'private.pitch_transcript_duration_ms(JSONB)', 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'D37-E: anon can execute pitch_transcript_duration_ms';
  END IF;
  IF has_function_privilege(
       'authenticated', 'private.pitch_transcript_duration_ms(JSONB)', 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'D37-E: authenticated can execute pitch_transcript_duration_ms';
  END IF;
END;
$$;

ROLLBACK;

SELECT '37_scene_duration_from_audio.sql passed' AS result;
