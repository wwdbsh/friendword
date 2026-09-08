-- 0062 — the scene lasts as long as the recording, not as long as the words.
--
-- T003 (issue #72). `private.pitch_transcript_duration_ms` timed a pitch by the
-- end of its LAST TRANSCRIPT SEGMENT. In production a 54.5s take transcribed to
-- a last segment ending at 37.66s, so the approved scene claimed 37660ms: the
-- web player clamps its clock to `scene.durationMs` while the <audio> element
-- keeps going, and the rendered MP4 got a 39.17s video stream (37.66s + the
-- 1.5s end card) muxed with 54.54s of AAC. Fifteen seconds of a friend still
-- talking over a frozen picture.
--
-- The new rule: GREATEST(provider-reported audio length, last segment end).
--
--   * The audio length is `transcript->'durationMs'`, written by /api/transcribe
--     from the transcription provider's own `duration` for the stored object. It
--     is server-derived and identical on every device, so the determinism this
--     function exists to protect is untouched — a client-measured
--     `<audio>.duration` is still never accepted, and there is nowhere for one
--     to enter: the client sends a scene, and this function judges it.
--   * The segment end stays the FLOOR. A provider that reports a duration
--     shorter than its own last segment cannot shorten a timeline below the
--     words it transcribed, and the shots-cover-[0,durationMs] rule stays
--     satisfiable.
--   * A transcript with no `durationMs` — every row written before this
--     migration — takes the old branch unchanged, value for value. Existing
--     scenes therefore still validate and their `scene_hash` is untouched: this
--     migration re-times nothing that is already published.
--
-- `private.pitch_scene_integer` (0048) is the reader: a JSON number with no
-- fractional part inside INTEGER range, or NULL. So a string "54543", a
-- fractional 54543.2, a boolean or a missing key are all "no audio length" and
-- fall back to the old answer rather than raising. The TypeScript builders
-- mirror this reader exactly (`transcriptAudioDurationMs`).
--
-- CREATE OR REPLACE keeps the signature, the owner and every grant (0048
-- REVOKEd ALL FROM PUBLIC; nothing else was ever granted), so the two call
-- sites in 0050 — submit_pitch_for_consent and create_dater_pitch_revision —
-- keep calling this same function with no redefinition of their own.
-- `assert_scene_definition` does not inline the rule; it compares against the
-- INTEGER this returns, so it is untouched.
--
-- ROLLBACK IS NOT SYMMETRIC. Restoring 0049's body while transcripts already
-- carry `durationMs` re-times those rows DOWNWARD, and the scenes stored under
-- the longer rule no longer match: `create_dater_pitch_revision` (0050:2579-2596)
-- re-checks the carried-forward scene with `pitch_scene_violation` and DEMOTES
-- it to NULL rather than refusing the save, so the next dater edit would quietly
-- drop the motion from an already-approved pitch. Backing this out therefore
-- means the SQL AND the data, in this order — forward-fix first:
--
--   UPDATE public.pitch_drafts      SET transcript = transcript - 'durationMs'
--    WHERE transcript ? 'durationMs';
--   UPDATE public.consent_revisions SET transcript = transcript - 'durationMs'
--    WHERE transcript ? 'durationMs';
--
-- Stripping the key restores the pre-0062 answer on every row (the fallback
-- branch is value-identical), after which the old body may be restored. Scenes
-- already published against the longer rule still carry the longer duration in
-- their stored JSON and hash; they are only re-judged when a dater saves again.
--
-- DEPLOY ORDER: this migration must reach the database BEFORE the web build
-- that starts sending audio-length scenes. Old code + new SQL is safe (old rows
-- carry no `durationMs`, so both branches agree); new code + old SQL is not
-- (the scene would carry 54543 while the old rule expects 37660, and
-- assert_scene_definition would reject the submit).

CREATE OR REPLACE FUNCTION private.pitch_transcript_duration_ms(transcript JSONB)
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
SET search_path = public, extensions, pg_temp
AS $$
  WITH tail AS (
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
  ),
  -- The 0049 scaling and half-up rounding, unchanged: the range test has to run
  -- in NUMERIC and has to run first, because a transcript may legally carry a
  -- value far too large for a double.
  scaled AS (
    SELECT CASE
             WHEN tail.last_end IS NULL
               OR tail.last_end <= 0
               OR tail.last_end > 86400 THEN NULL
             ELSE (tail.last_end)::DOUBLE PRECISION * 1000
           END AS end_ms
      FROM tail
  ),
  segment_end AS (
    SELECT CASE
             WHEN scaled.end_ms IS NULL THEN NULL
             WHEN scaled.end_ms - floor(scaled.end_ms) >= 0.5::DOUBLE PRECISION
               THEN (floor(scaled.end_ms) + 1)::INTEGER
             ELSE floor(scaled.end_ms)::INTEGER
           END AS ms
      FROM scaled
  ),
  audio AS (
    SELECT CASE
             WHEN reported.ms > 0 AND reported.ms <= 86400000
               THEN reported.ms::INTEGER
           END AS ms
      FROM (
        SELECT private.pitch_scene_integer(transcript -> 'durationMs') AS ms
      ) AS reported
  )
  -- No segments at all is still "this pitch has no motion", however long the
  -- audio ran: a scene needs words to hang shots on, and every caller treats
  -- NULL as sceneless.
  SELECT CASE
           WHEN segment_end.ms IS NULL THEN NULL
           ELSE GREATEST(segment_end.ms, coalesce(audio.ms, segment_end.ms))
         END
    FROM segment_end CROSS JOIN audio;
$$;

COMMENT ON FUNCTION private.pitch_transcript_duration_ms(JSONB) IS
  'Milliseconds of the recording a scene must cover: the greater of the provider-reported audio length (transcript->durationMs, an integer written by /api/transcribe) and the end of the last transcript segment, or NULL when the transcript carries no usable segments. The single authority for a pitch duration; client-measured audio length is never used. The segment end is the floor and, for a transcript with no reported length, still the whole rule — bit-identical to the pre-0062 answer, so stored scene hashes are unchanged.';
