-- Motion pitch Phase 1 (docs/MOTION_PITCH_PLAN_2026-07-29.md): the Dater
-- approves a scene timeline, not just words.
--
-- Until now the vertical motion pitch existed only inside the web player: it
-- recomputed photo windows from the transcript on every render
-- (apps/web/src/pitch/scenes.ts). Nothing about the motion was part of what the
-- Dater consented to, and nothing was reproducible — a later change to the
-- distribution helper silently changed the page the Dater had already approved.
--
-- This migration makes the timeline a first-class part of the consent snapshot:
--
--   1. consent_revisions carries `scene_definition` (PitchScene v1) plus a
--      server-computed `scene_hash`. Revisions are already immutable
--      (0013/0018), so a stored scene is a frozen record of what was shown.
--   2. pitch_drafts carries the same pair as the read-path projection that
--      approve_and_publish_pitch copies forward, exactly like
--      headline/body/structure/transcript/structure_reviewed (0047).
--   3. The scene is BUILT IN TYPESCRIPT and only VALIDATED here. The database
--      owns references, the hash, and immutability — not layout. The web and
--      mobile builders are ports of `distributePhotoScenes`, which is pure and
--      deterministic; re-deriving the timeline in SQL would create a second
--      source of truth for the same numbers.
--   4. A revision with no scene is legal and means "play the legacy player
--      path". Nothing is backfilled: a pre-0048 revision was approved without a
--      timeline and manufacturing one now would claim a review that never
--      happened.
--
-- WHAT THE SCENE DOES NOT CARRY: text. Caption strings and their timings are
-- derived by the player from the revision's transcript segments, which already
-- pass the moderation gate as part of the structure. A scene entry is therefore
-- restricted to exactly {assetId, startMs, endMs} and the envelope to exactly
-- {schemaVersion, canvas, durationMs, scenes} — an unknown key is rejected
-- rather than ignored, because a tolerated `text` field would be a path for
-- unmoderated words onto a public page.
--
-- WHY THE 1000ms FLOOR IS A DATABASE RULE AND NOT A STYLE CHOICE: "no overlap"
-- alone still admits 30ms x 100 scenes, which is a photosensitive-epilepsy
-- strobe. That risk lands on the VIEWER of the published page, who is outside
-- the Dater's consent model entirely, so no client may be trusted with it. The
-- v1 builder's output sits far above the floor, so nothing expressive is lost.

-- ── Columns ─────────────────────────────────────────────────────────────
-- Intrinsic pixel size of a registered asset. The renderer needs it to decide
-- crop/pan geometry without downloading the bytes first; NULL means "not
-- reported" (every pre-0048 row, and any client that does not measure).
ALTER TABLE public.pitch_assets
  ADD COLUMN width INTEGER CHECK (width > 0),
  ADD COLUMN height INTEGER CHECK (height > 0);

COMMENT ON COLUMN public.pitch_assets.width IS
  'Intrinsic pixel width reported at registration. NULL when unknown; never inferred.';
COMMENT ON COLUMN public.pitch_assets.height IS
  'Intrinsic pixel height reported at registration. NULL when unknown; never inferred.';

ALTER TABLE public.consent_revisions
  ADD COLUMN scene_definition JSONB,
  ADD COLUMN scene_hash TEXT,
  ADD CONSTRAINT consent_revisions_scene_hash_pairing
    CHECK ((scene_definition IS NULL) = (scene_hash IS NULL));

COMMENT ON COLUMN public.consent_revisions.scene_definition IS
  'PitchScene v1 timeline the Dater reviewed, or NULL when this revision has no motion (legacy player fallback). Written only by submit_pitch_for_consent and create_dater_revision, which validate it first.';
-- The canonical content the hash covers grew a key, so the 0013 comment is
-- stale. Old rows are not rehashed: content_hash is never compared against a
-- recomputation of a stored row, only written once when the revision is cut.
COMMENT ON COLUMN public.consent_revisions.content_hash IS
  'SHA-256 hex of jsonb canonical text with keys headline, body, structure, asset_ids, voice_asset_path, scene; asset_ids are UUID-ascending. Rows written before 0048 hashed the same object without the scene key.';

COMMENT ON COLUMN public.consent_revisions.scene_hash IS
  'sha256 hex of scene_definition::text as the stored jsonb serializes it, computed server-side. The Phase 4 render worker must hash the bytes it reads from ::text rather than re-serializing a parsed copy, or the two hashes will disagree.';

ALTER TABLE public.pitch_drafts
  ADD COLUMN scene_definition JSONB,
  ADD COLUMN scene_hash TEXT,
  ADD CONSTRAINT pitch_drafts_scene_hash_pairing
    CHECK ((scene_definition IS NULL) = (scene_hash IS NULL));

COMMENT ON COLUMN public.pitch_drafts.scene_definition IS
  'Read-path projection of the approved revision scene_definition, copied by approve_and_publish_pitch. NULL means the published page has no approved timeline.';
COMMENT ON COLUMN public.pitch_drafts.scene_hash IS
  'Read-path projection of the approved revision scene_hash.';

-- ── Transcript duration ─────────────────────────────────────────────────
-- The ONLY authority for how long a pitch runs. Client-measured audio duration
-- varies by decoder and device, so it can never be the number a hash is built
-- from; the transcript is frozen onto every revision (0032) and its last
-- segment end is identical everywhere.
--
-- Returns NULL when there are no usable segments, which is exactly the "this
-- pitch has no motion" case: a scene may not exist without one.
--
-- The rounding rule is `round(last_end_seconds * 1000)`, which the TypeScript
-- builders reproduce with Math.round(lastEnd * 1000). Both round half up for
-- positive values, so the two agree on every value a transcription provider
-- emits (two decimal places).
CREATE FUNCTION private.pitch_transcript_duration_ms(transcript JSONB)
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
SET search_path = public, extensions, pg_temp
AS $$
  SELECT CASE
    WHEN tail.last_end IS NULL
      OR tail.last_end <= 0
      OR tail.last_end > 86400 THEN NULL
    ELSE round(tail.last_end * 1000)::INTEGER
  END
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
  ) AS tail;
$$;

REVOKE ALL ON FUNCTION private.pitch_transcript_duration_ms(JSONB) FROM PUBLIC;

COMMENT ON FUNCTION private.pitch_transcript_duration_ms(JSONB) IS
  'Milliseconds to the end of the last transcript segment, or NULL when the transcript carries no usable segments. The single authority for a pitch duration; client-measured audio length is never used.';

-- ── JSON integer reader ─────────────────────────────────────────────────
-- Returns the value only when it is a JSON number with no fractional part and
-- inside INTEGER range. 30.5, "30", true, 1e500 and a missing key all yield
-- NULL, so a caller never has to distinguish "absent" from "wrong type".
CREATE FUNCTION private.pitch_scene_integer(value JSONB)
RETURNS BIGINT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  numeric_value NUMERIC;
BEGIN
  IF jsonb_typeof(value) IS DISTINCT FROM 'number' THEN
    RETURN NULL;
  END IF;
  numeric_value := (value #>> '{}')::NUMERIC;
  IF numeric_value <> trunc(numeric_value)
     OR numeric_value < -2147483648
     OR numeric_value > 2147483647 THEN
    RETURN NULL;
  END IF;
  RETURN numeric_value::BIGINT;
END;
$$;

REVOKE ALL ON FUNCTION private.pitch_scene_integer(JSONB) FROM PUBLIC;

-- ── Scene validation ────────────────────────────────────────────────────
-- Returns NULL when the scene is acceptable, otherwise the rejection message.
-- A non-raising predicate because two callers need opposite behaviour from the
-- same rules: a client-supplied scene must be REFUSED with a reason the app can
-- map, while a scene carried forward onto a changed photo set must be silently
-- DEMOTED to NULL. Splitting those into two rule sets would let them drift.
--
-- The rejection strings are pinned by supabase/tests/24_motion_scene.sql and
-- mapped by the web and mobile clients; changing one means changing those too.
CREATE FUNCTION private.pitch_scene_violation(
  scene JSONB,
  duration_ms_expected INTEGER,
  photo_asset_ids UUID[]
)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
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
BEGIN
  -- No scene is a legal state, not a violation: it means the published page
  -- falls back to the legacy player.
  IF scene IS NULL THEN
    RETURN NULL;
  END IF;

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
  private.pitch_scene_violation(JSONB, INTEGER, UUID[]) FROM PUBLIC;

COMMENT ON FUNCTION private.pitch_scene_violation(JSONB, INTEGER, UUID[]) IS
  'NULL when the PitchScene v1 payload satisfies every mechanical safety rule, otherwise the pinned rejection message. A NULL scene is acceptable and means the pitch has no motion.';

-- ── Canonical form ──────────────────────────────────────────────────────
-- The stored jsonb IS the hashed bytes, so equal timelines must serialize
-- identically. jsonb already normalizes key order and whitespace; this rebuild
-- also normalizes numeric spelling (30.0 -> 30) and asset id case, so a client
-- that formats JSON differently cannot produce a second hash for the same
-- scene. Assumes private.pitch_scene_violation already returned NULL.
CREATE FUNCTION private.normalized_pitch_scene(scene JSONB)
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
SET search_path = public, extensions, pg_temp
AS $$
  SELECT jsonb_build_object(
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
  WHERE scene IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION private.normalized_pitch_scene(JSONB) FROM PUBLIC;

-- Raising wrapper for the client-supplied paths. Returns the canonical scene so
-- callers store and hash the same value they validated.
CREATE FUNCTION private.assert_scene_definition(
  scene JSONB,
  duration_ms_expected INTEGER,
  photo_asset_ids UUID[]
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
    scene, duration_ms_expected, photo_asset_ids
  );
  IF violation IS NOT NULL THEN
    RAISE EXCEPTION '%', violation;
  END IF;
  RETURN private.normalized_pitch_scene(scene);
END;
$$;

REVOKE ALL ON FUNCTION
  private.assert_scene_definition(JSONB, INTEGER, UUID[]) FROM PUBLIC;

COMMENT ON FUNCTION private.assert_scene_definition(JSONB, INTEGER, UUID[]) IS
  'Validates a client-supplied PitchScene v1 payload and returns its canonical form, or raises the pinned rejection message. Returns NULL for a NULL scene.';

-- ── submit_pitch_for_consent (full redefinition from 0016) ──────────────
-- The Introducer's submit is where the FIRST scene comes from. It has to be:
-- the common path is a Dater who reads the review page and approves without
-- saving an edit, and create_dater_revision never runs for them. If only the
-- Dater's save could attach a timeline, those pitches would publish with no
-- motion at all. The mobile client already depends on @friendword/contracts and
-- the draft transcript exists by submit time, so it can build the scene there.
--
-- A new parameter cannot be added with CREATE OR REPLACE — PostgreSQL treats a
-- different argument list as a new overload and the 4-argument call then fails
-- with "function ... is not unique" (same reasoning as 0047:311-317). Dropping
-- and recreating with a DEFAULT keeps every existing 1/2/4-argument call site
-- resolving to the wider function.
DROP FUNCTION public.submit_pitch_for_consent(UUID, TEXT, TEXT, TEXT);

CREATE FUNCTION public.submit_pitch_for_consent(
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
    snapshot_photo_asset_ids
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

REVOKE ALL ON FUNCTION
  public.submit_pitch_for_consent(UUID, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  public.submit_pitch_for_consent(UUID, TEXT, TEXT, TEXT, JSONB) TO authenticated;

COMMENT ON FUNCTION public.submit_pitch_for_consent(UUID, TEXT, TEXT, TEXT, JSONB) IS
  'Pitch photo/audio validation is fail-closed only while media_validation_enforcement is on. new_scene attaches the Introducer-built PitchScene v1 timeline to the first revision; it is rejected unless it covers exactly the transcript duration with contiguous scenes of at least 1000ms over distinct reviewed photos. Omitting it publishes without motion.';

-- ── create_dater_revision (full redefinition from 0047) ─────────────────
-- Same DROP-then-create reasoning as above and as 0047:311-317.
DROP FUNCTION public.create_dater_revision(UUID, TEXT, TEXT, UUID[], JSONB, TEXT[]);

CREATE FUNCTION public.create_dater_revision(
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
      new_scene, scene_duration_ms, snapshot_photo_asset_ids
    );
  ELSIF latest.scene_definition IS NOT NULL THEN
    -- Carry the reviewed timeline forward, but re-check it against the NEW
    -- snapshot: a save that drops a photo the scene still points at would
    -- otherwise leave a dangling reference once approval deletes that asset.
    -- Demotion to NULL (no motion) is the safe answer — refusing the save
    -- would trap a Dater who simply removed a photo.
    IF private.pitch_scene_violation(
         latest.scene_definition, scene_duration_ms, snapshot_photo_asset_ids
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

REVOKE ALL ON FUNCTION
  public.create_dater_revision(UUID, TEXT, TEXT, UUID[], JSONB, TEXT[], JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  public.create_dater_revision(UUID, TEXT, TEXT, UUID[], JSONB, TEXT[], JSONB) TO authenticated;

COMMENT ON FUNCTION
  public.create_dater_revision(UUID, TEXT, TEXT, UUID[], JSONB, TEXT[], JSONB) IS
  'Creates the Dater-approved consent revision. Whenever the revision structure carries the five published fields, headline/body are derived from it and new_headline/new_body are ignored — on the legacy 4-argument path too. retained_hard_claims dispositions the flagged claim list: NULL keeps it, an array narrows it to exactly those claims, and a value that was not already flagged is rejected. new_scene replaces the reviewed motion timeline; omitting it carries the previous one forward only while every photo it references survives in the new snapshot, and otherwise stores no scene.';

-- ── approve_and_publish_pitch (full redefinition from 0047) ──────────────
-- Two changes from 0047:
--
--   1. The approved photo set must be EXACTLY the set the scene references.
--      This RPC deletes every photo asset outside included_asset_ids
--      (0047:700-705), so approving a narrower set than the timeline uses would
--      publish a scene pointing at rows that no longer exist. The answer is a
--      refusal, not a silent demotion to NULL: the Dater is looking at a moving
--      page in the approval UI, and quietly publishing a still one would be
--      publishing something they did not review.
--   2. scene_definition/scene_hash are projected onto the draft, the same
--      read-path copy structure_reviewed already gets (0047:712).
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
    SELECT coalesce(array_agg(asset_id ORDER BY asset_id), ARRAY[]::UUID[])
      INTO scene_photo_ids
      FROM (
        SELECT DISTINCT (entry.value ->> 'assetId')::UUID AS asset_id
          FROM jsonb_array_elements(
                 approved_revision.scene_definition -> 'scenes'
               ) AS entry(value)
      ) AS scene_photo;
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
  'Publishes exactly the approved revision, including its reviewed motion timeline. When the revision carries a scene, included_asset_ids must be the same set of photos the scene references — this RPC deletes the photos outside that set, so a mismatch would publish a timeline with dangling references.';
