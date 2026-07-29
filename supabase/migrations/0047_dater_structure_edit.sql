-- Fifth audit P0: the Dater actually approves the words the public page shows.
--
-- The public pitch page renders the five `structure` fields (hook /
-- relationship_context / three_specific_qualities / evidence_or_anecdote /
-- good_match_for) and ignores the approved body whenever structure is
-- non-null. But create_dater_revision (0041) copied `latest.structure`
-- verbatim while storing only the Dater's edited headline/body — so a Dater
-- who rewrote their pitch still published the AI's original sentences, and
-- the three qualities were never shown to them at all. That contradicts
-- CLAUDE.md §8 (individual pre-publication approval by the Dater) and §12
-- (the page claims "every word here was reviewed and approved").
--
-- Fix, in five parts:
--
-- 1. The Dater edits `structure` itself through `new_structure`.
--    headline/body become SERVER-DERIVED projections of that structure using
--    the same formula as the transcription path
--    (apps/web/app/api/transcribe/route.ts), so the two can never diverge.
--
-- 2. Derivation is NOT opt-in. Whenever the revision carries a structure with
--    the five published fields, headline/body are derived from it on EVERY
--    path — including the legacy 4-argument call. Otherwise a stale bundle or
--    a direct PostgREST call reproduces the original P0 in one RPC: the
--    client's headline is stored while the AI's structure is published.
--
-- 3. `hard_claims_requiring_confirmation` gets a per-claim disposition
--    (`retained_hard_claims`) instead of being frozen. A Dater who deleted a
--    flagged sentence must not be forced to attest that the deleted claim is
--    true; a Dater who kept it still must. The client can only SHRINK the
--    list — every retained value has to appear in the prior revision's list —
--    so a claim can never be invented. Pruning happens when the revision is
--    cut, not at publish: the revision is the immutable record of what was
--    consented to, and the published structure comes from it.
--
-- 4. The text moderation gate hashes the same string on every path, which is
--    what unlocks publishing after an edit. Before, a structure edit
--    registered the 5-part string while a later photo-only save took the
--    legacy branch and looked up the 2-part string — a hash nothing had ever
--    written — so the save failed forever while the changed photo set kept
--    the approve button disabled. Deriving the moderated string from the
--    published structure on both paths makes the two lookups the same one.
--    The gate itself stays UNCONDITIONAL: skipping it for text that is
--    byte-identical to the prior revision would sound safe (the prior
--    revision passed a gate, inductively) but the base case is false —
--    media_validation_enforcement ships 'off', so text stored while it was
--    off has no verdict, and an identity skip would exempt it forever
--    instead of catching it on the first save after the switch is flipped.
--
-- 5. Blank detection covers invisible characters, not just ASCII space.
--    PostgreSQL's one-argument btrim() strips U+0020 only, so a field made of
--    NBSP / zero-width spaces / tabs satisfied the "all five fields" guard
--    and published as an empty paragraph.

-- ── Provenance of the published structure ───────────────────────────────
-- Rows published before this migration carry a structure the Dater was never
-- shown, so the public page must not claim they reviewed it. The revision is
-- the record of truth; the draft column is the read-path projection that
-- approve_and_publish_pitch copies, exactly like headline/body/structure/
-- transcript, so the public read path needs no new join.
ALTER TABLE public.consent_revisions
  ADD COLUMN structure_reviewed BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.consent_revisions.structure_reviewed IS
  'True when the Dater submitted the five published structure fields during this consent review (create_dater_revision called with new_structure, here or in an earlier revision of the same review). Pre-0047 revisions keep the false default.';

ALTER TABLE public.pitch_drafts
  ADD COLUMN structure_reviewed BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.pitch_drafts.structure_reviewed IS
  'Copied from the approved revision structure_reviewed at publish. False means the published structure was never shown to the Dater, so the page may not claim they reviewed it.';

-- ── Invisible-text detection ────────────────────────────────────────────
-- btrim(text) strips U+0020 and nothing else, so "non-blank after trim" was
-- satisfied by TAB, NBSP, EM SPACE, ZERO WIDTH SPACE and friends. Codepoint
-- ranges rather than a POSIX class: [[:space:]] follows the database ctype,
-- which classifies neither U+00A0 nor U+200B as space.
CREATE FUNCTION private.invisible_codepoint(code INTEGER)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = public, extensions, pg_temp
AS $$
  SELECT code <= 32                     -- C0 controls, TAB, LF, CR, SPACE
      OR (code BETWEEN 127 AND 160)     -- DEL, C1 controls, U+00A0 NBSP
      OR code = 173                     -- U+00AD SOFT HYPHEN
      OR code = 847                     -- U+034F COMBINING GRAPHEME JOINER
      OR code = 1564                    -- U+061C ARABIC LETTER MARK
      OR (code BETWEEN 4447 AND 4448)   -- U+115F..U+1160 HANGUL FILLERS
      OR code = 5760                    -- U+1680 OGHAM SPACE MARK
      OR (code BETWEEN 6068 AND 6069)   -- U+17B4..U+17B5 KHMER INHERENT VOWELS
      OR (code BETWEEN 6155 AND 6159)   -- U+180B..U+180F MONGOLIAN SELECTORS
      OR (code BETWEEN 8192 AND 8207)   -- U+2000..U+200F SPACES, ZWSP/ZWNJ/ZWJ, LRM/RLM
      OR (code BETWEEN 8232 AND 8239)   -- U+2028..U+202F SEPARATORS, BIDI, NNBSP
      OR (code BETWEEN 8287 AND 8303)   -- U+205F..U+206F MMSP, WORD JOINER, FORMAT
      OR code = 12288                   -- U+3000 IDEOGRAPHIC SPACE
      OR code = 12644                   -- U+3164 HANGUL FILLER
      OR (code BETWEEN 65024 AND 65039) -- U+FE00..U+FE0F VARIATION SELECTORS
      OR code = 65279                   -- U+FEFF ZERO WIDTH NO-BREAK SPACE
      OR code = 65440;                  -- U+FFA0 HALFWIDTH HANGUL FILLER
$$;

REVOKE ALL ON FUNCTION private.invisible_codepoint(INTEGER) FROM PUBLIC;

CREATE FUNCTION private.pitch_text_is_blank(candidate TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = public, extensions, pg_temp
AS $$
  SELECT NOT EXISTS (
    SELECT 1
      FROM regexp_split_to_table(coalesce(candidate, ''), '') AS glyph(value)
     WHERE NOT private.invisible_codepoint(ascii(glyph.value))
  );
$$;

REVOKE ALL ON FUNCTION private.pitch_text_is_blank(TEXT) FROM PUBLIC;

COMMENT ON FUNCTION private.pitch_text_is_blank(TEXT) IS
  'True when the text renders as nothing: every character is a control, a Unicode space, or a zero-width/format character. btrim() alone only catches ASCII spaces.';

-- ── The published five fields of a structure ────────────────────────────
-- Returns the five Dater-owned fields of ANY structure (AI-authored or
-- Dater-edited), or NULL when the structure does not carry them. This is the
-- test that decides whether headline/body are derived instead of taken from
-- the client, so it checks SHAPE only: no length ceilings (AI copy routinely
-- exceeds the edit limits) and no blank check (a blank AI field must not hand
-- the published words back to an unvalidated client string).
CREATE FUNCTION private.dater_pitch_published_structure(candidate JSONB)
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
SET search_path = public, extensions, pg_temp
AS $$
  SELECT CASE
    WHEN candidate IS NULL
      OR jsonb_typeof(candidate -> 'hook') IS DISTINCT FROM 'string'
      OR jsonb_typeof(candidate -> 'relationship_context') IS DISTINCT FROM 'string'
      OR jsonb_typeof(candidate -> 'evidence_or_anecdote') IS DISTINCT FROM 'string'
      OR jsonb_typeof(candidate -> 'good_match_for') IS DISTINCT FROM 'string'
      OR jsonb_typeof(candidate -> 'three_specific_qualities') IS DISTINCT FROM 'array'
      OR jsonb_array_length(candidate -> 'three_specific_qualities') <> 3
      OR EXISTS (
        SELECT 1
          FROM jsonb_array_elements(
                 candidate -> 'three_specific_qualities'
               ) AS element(value)
         WHERE jsonb_typeof(element.value) <> 'string'
      )
      THEN NULL
    ELSE jsonb_build_object(
      'hook', candidate ->> 'hook',
      'relationship_context', candidate ->> 'relationship_context',
      'three_specific_qualities', candidate -> 'three_specific_qualities',
      'evidence_or_anecdote', candidate ->> 'evidence_or_anecdote',
      'good_match_for', candidate ->> 'good_match_for'
    )
  END;
$$;

REVOKE ALL ON FUNCTION private.dater_pitch_published_structure(JSONB) FROM PUBLIC;

-- The single definition of the body projection. apps/web/app/api/transcribe/
-- route.ts builds the same string when the AI first structures the pitch;
-- 23_dater_structure_edit.sql pins the literal so a drift here goes red.
CREATE FUNCTION private.dater_pitch_body_from_structure(published_structure JSONB)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public, extensions, pg_temp
AS $$
  SELECT (published_structure ->> 'relationship_context')
    || E'\n\n' || (published_structure ->> 'evidence_or_anecdote')
    || E'\n\n' || 'A good match: ' || (published_structure ->> 'good_match_for');
$$;

REVOKE ALL ON FUNCTION private.dater_pitch_body_from_structure(JSONB) FROM PUBLIC;

-- ── Structure validation ────────────────────────────────────────────────
-- The Dater-input validator: returns the normalized (trimmed, five-key)
-- structure or raises. The rejection strings are pinned by
-- supabase/tests/23_dater_structure_edit.sql; changing one means changing
-- that suite too.
CREATE FUNCTION private.normalized_dater_pitch_structure(candidate JSONB)
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  qualities JSONB;
  clean_hook TEXT;
  clean_relationship TEXT;
  clean_evidence TEXT;
  clean_match TEXT;
  clean_qualities TEXT[];
BEGIN
  IF candidate IS NULL OR jsonb_typeof(candidate) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'pitch structure requires all five fields';
  END IF;

  qualities := candidate -> 'three_specific_qualities';

  -- IS DISTINCT FROM (not <>): a missing key yields SQL NULL from
  -- jsonb_typeof, and NULL <> 'string' is NULL, which would fall through.
  IF jsonb_typeof(candidate -> 'hook') IS DISTINCT FROM 'string'
     OR jsonb_typeof(candidate -> 'relationship_context') IS DISTINCT FROM 'string'
     OR jsonb_typeof(candidate -> 'evidence_or_anecdote') IS DISTINCT FROM 'string'
     OR jsonb_typeof(candidate -> 'good_match_for') IS DISTINCT FROM 'string'
     OR jsonb_typeof(qualities) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'pitch structure requires all five fields';
  END IF;

  clean_hook := btrim(candidate ->> 'hook');
  clean_relationship := btrim(candidate ->> 'relationship_context');
  clean_evidence := btrim(candidate ->> 'evidence_or_anecdote');
  clean_match := btrim(candidate ->> 'good_match_for');
  IF private.pitch_text_is_blank(clean_hook)
     OR private.pitch_text_is_blank(clean_relationship)
     OR private.pitch_text_is_blank(clean_evidence)
     OR private.pitch_text_is_blank(clean_match) THEN
    RAISE EXCEPTION 'pitch structure requires all five fields';
  END IF;

  IF jsonb_array_length(qualities) <> 3 THEN
    RAISE EXCEPTION 'pitch structure requires exactly three qualities';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements(qualities) AS element(value)
     WHERE jsonb_typeof(element.value) <> 'string'
  ) THEN
    RAISE EXCEPTION 'pitch structure requires all five fields';
  END IF;

  SELECT array_agg(btrim(element.value #>> '{}') ORDER BY element.ord)
    INTO clean_qualities
    FROM jsonb_array_elements(qualities) WITH ORDINALITY AS element(value, ord);
  IF EXISTS (
    SELECT 1
      FROM unnest(clean_qualities) AS quality
     WHERE private.pitch_text_is_blank(quality)
  ) THEN
    RAISE EXCEPTION 'pitch structure requires all five fields';
  END IF;

  IF char_length(clean_hook) > 120
     OR char_length(clean_relationship) > 500
     OR char_length(clean_evidence) > 500
     OR char_length(clean_match) > 500
     OR EXISTS (
       SELECT 1 FROM unnest(clean_qualities) AS quality WHERE char_length(quality) > 120
     ) THEN
    RAISE EXCEPTION 'pitch structure field is too long';
  END IF;

  RETURN jsonb_build_object(
    'hook', clean_hook,
    'relationship_context', clean_relationship,
    'three_specific_qualities', to_jsonb(clean_qualities),
    'evidence_or_anecdote', clean_evidence,
    'good_match_for', clean_match
  );
END;
$$;

REVOKE ALL ON FUNCTION private.normalized_dater_pitch_structure(JSONB) FROM PUBLIC;

COMMENT ON FUNCTION private.normalized_dater_pitch_structure(JSONB) IS
  'Validates the five Dater-editable pitch structure fields and returns them trimmed. hard_claims_requiring_confirmation is intentionally absent: the flagged list is dispositioned through retained_hard_claims, never taken from new_structure.';

-- ── Moderation text contract ────────────────────────────────────────────
-- The text_moderations ledger (0026) is content-addressed: scope + sha256 of
-- the EXACT string. This function is the single definition of that string for
-- a dater revision, so the client-side /api/moderate-text call and the DB gate
-- below can never hash different bytes.
--
--   with a published structure : "<hook>\n\n<derived body>\n\n<q1>\n\n<q2>\n\n<q3>"
--   without one                : "<raw headline>\n\n<raw body>"   (0026/0036)
--
-- The qualities are appended because they are published verbatim on the public
-- page but appear nowhere in the derived headline/body — without them a Dater
-- could smuggle unmoderated text into the pitch through an edit.
CREATE FUNCTION private.dater_revision_moderation_text(
  revision_headline TEXT,
  revision_body TEXT,
  published_structure JSONB DEFAULT NULL
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public, extensions, pg_temp
AS $$
  SELECT CASE
    WHEN published_structure IS NULL
      THEN coalesce(revision_headline, '') || E'\n\n' || coalesce(revision_body, '')
    ELSE coalesce(revision_headline, '') || E'\n\n' || coalesce(revision_body, '')
      || E'\n\n'
      || (
        SELECT string_agg(element.value #>> '{}', E'\n\n' ORDER BY element.ord)
          FROM jsonb_array_elements(
                 published_structure -> 'three_specific_qualities'
               ) WITH ORDINALITY AS element(value, ord)
      )
  END;
$$;

REVOKE ALL ON FUNCTION
  private.dater_revision_moderation_text(TEXT, TEXT, JSONB) FROM PUBLIC;

-- ── create_dater_revision (full redefinition from 0041) ─────────────────
-- New parameters cannot be added with CREATE OR REPLACE: PostgreSQL treats a
-- different argument list as a new overload, and the shorter call would then
-- fail with "function ... is not unique". Dropping the old function and
-- creating the wider one with DEFAULTs keeps every existing 4-argument call
-- site working (verified against PostgreSQL 17).
DROP FUNCTION public.create_dater_revision(UUID, TEXT, TEXT, UUID[]);

CREATE FUNCTION public.create_dater_revision(
  draft_id UUID,
  new_headline TEXT,
  new_body TEXT,
  included_asset_ids UUID[] DEFAULT NULL,
  new_structure JSONB DEFAULT NULL,
  retained_hard_claims TEXT[] DEFAULT NULL
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
  public.create_dater_revision(UUID, TEXT, TEXT, UUID[], JSONB, TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  public.create_dater_revision(UUID, TEXT, TEXT, UUID[], JSONB, TEXT[]) TO authenticated;

COMMENT ON FUNCTION public.create_dater_revision(UUID, TEXT, TEXT, UUID[], JSONB, TEXT[]) IS
  'Creates the Dater-approved consent revision. Whenever the revision structure carries the five published fields, headline/body are derived from it and new_headline/new_body are ignored — on the legacy 4-argument path too. retained_hard_claims dispositions the flagged claim list: NULL keeps it, an array narrows it to exactly those claims, and a value that was not already flagged is rejected.';

-- ── approve_and_publish_pitch (full redefinition from 0041) ─────────────
-- Only change from 0041: the approved revision's structure_reviewed is
-- projected onto the draft as structure_reviewed, so the public page can
-- tell a Dater-reviewed structure from a pre-0047 one. The hard-claim
-- confirmation gate already reads the approved revision's structure, which is
-- now the pruned list, so a Dater who removed every flagged claim is no longer
-- asked to confirm claims that are not on their page.
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
         structure_reviewed = approved_revision.structure_reviewed,
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
