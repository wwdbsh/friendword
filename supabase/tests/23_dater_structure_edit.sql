-- Fifth audit P0 (migration 0047): the Dater edits the five published
-- `structure` fields, headline/body are server-derived from that structure,
-- and the edited structure is what approve_and_publish_pitch copies onto the
-- public projection. Before 0047 create_dater_revision copied
-- latest.structure verbatim, so the public page rendered the AI's original
-- sentences while claiming the Dater had approved every word.
--
-- red-first: on 0046 the 5-argument RPC does not exist at all, so every call
-- below fails with "function public.create_dater_revision(...) does not
-- exist" and this file is RED.

BEGIN;

-- ── Fixture: a claimed consent review in flight for dater 0002 ──────────
INSERT INTO public.pitch_drafts (
  id, created_by_user_id, subject_user_id, status, headline, body, structure, transcript
) VALUES (
  'd2300000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002',
  'consent_pending',
  'AI wrote this hook',
  'AI relationship context.',
  '{"hook": "AI wrote this hook",
    "relationship_context": "AI relationship context.",
    "three_specific_qualities": ["AI quality one", "AI quality two", "AI quality three"],
    "evidence_or_anecdote": "AI anecdote.",
    "good_match_for": "AI match.",
    "hard_claims_requiring_confirmation": ["Owns a home", "Runs marathons"]}'::JSONB,
  '{"text": "Blair is the kindest person I know.", "segments": []}'::JSONB
);

INSERT INTO public.pitch_assets (
  id, pitch_draft_id, uploaded_by_user_id, asset_type, storage_path, sort_order
) VALUES
  (
    'd2300000-0000-0000-0000-000000000201',
    'd2300000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    'voice',
    'pitch-media/d2300000-0000-0000-0000-000000000001/voice.m4a',
    0
  ),
  (
    'd2300000-0000-0000-0000-000000000202',
    'd2300000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    'photo',
    'pitch-media/d2300000-0000-0000-0000-000000000001/photo-1.jpg',
    1
  );

INSERT INTO public.consent_revisions (
  id, pitch_draft_id, revision_number, headline, body, structure,
  asset_ids, voice_asset_path, content_hash
) VALUES (
  'd2300000-0000-0000-0000-000000000301',
  'd2300000-0000-0000-0000-000000000001',
  1,
  'AI wrote this hook',
  'AI relationship context.',
  '{"hook": "AI wrote this hook",
    "relationship_context": "AI relationship context.",
    "three_specific_qualities": ["AI quality one", "AI quality two", "AI quality three"],
    "evidence_or_anecdote": "AI anecdote.",
    "good_match_for": "AI match.",
    "hard_claims_requiring_confirmation": ["Owns a home", "Runs marathons"]}'::JSONB,
  ARRAY[
    'd2300000-0000-0000-0000-000000000201',
    'd2300000-0000-0000-0000-000000000202'
  ]::UUID[],
  'pitch-media/d2300000-0000-0000-0000-000000000001/voice.m4a',
  'd23-fixture-hash-1'
);

INSERT INTO public.consent_requests (
  id, pitch_draft_id, subject_user_id, token_hash, status, revision_id,
  invite_contact_channel, invite_contact_hash
) VALUES (
  'd2300000-0000-0000-0000-000000000401',
  'd2300000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002',
  encode(digest('d23-consent-token', 'sha256'), 'hex'),
  'claimed',
  'd2300000-0000-0000-0000-000000000301',
  'email',
  encode(digest('d23-dater@example.test', 'sha256'), 'hex')
);

-- One active campaign per owner (0039): dater 0002 owns the seed campaign,
-- so retire it before this suite publishes its own.
UPDATE public.campaigns SET status = 'archived'
 WHERE owner_user_id = '00000000-0000-0000-0000-000000000002'
   AND status IN ('published', 'paused');

-- Probe helper: returns the rejection message, or NULL when the RPC accepted
-- the structure. The sentinel raise rolls the subtransaction back, so probing
-- an accepted structure leaves no revision behind.
CREATE FUNCTION pg_temp.structure_reject_reason(
  target_draft UUID,
  target_photo UUID,
  candidate JSONB
)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
BEGIN
  BEGIN
    PERFORM * FROM public.create_dater_revision(
      target_draft,
      'client supplied headline',
      'client supplied body',
      ARRAY[target_photo],
      candidate
    );
    RAISE EXCEPTION 'D23-ACCEPTED';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'D23-ACCEPTED' THEN
      RETURN NULL;
    END IF;
    RETURN SQLERRM;
  END;
END;
$$;

DO $$
DECLARE
  failures TEXT[] := ARRAY[]::TEXT[];
  draft CONSTANT UUID := 'd2300000-0000-0000-0000-000000000001';
  rev1 CONSTANT UUID := 'd2300000-0000-0000-0000-000000000301';
  photo CONSTANT UUID := 'd2300000-0000-0000-0000-000000000202';
  dater CONSTANT UUID := '00000000-0000-0000-0000-000000000002';
  introducer CONSTANT UUID := '00000000-0000-0000-0000-000000000001';
  edited CONSTANT JSONB := '{
    "hook": "Blair picked this hook",
    "relationship_context": "We met in a pottery class in 2019.",
    "three_specific_qualities": [
      "Remembers every birthday",
      "Cooks for the whole floor",
      "Fixes bikes for free"
    ],
    "evidence_or_anecdote": "They drove four hours to help me move.",
    "good_match_for": "Someone who plans and someone who improvises."
  }'::JSONB;
  expected_headline CONSTANT TEXT := 'Blair picked this hook';
  expected_body CONSTANT TEXT :=
    'We met in a pottery class in 2019.' || E'\n\n'
    || 'They drove four hours to help me move.' || E'\n\n'
    || 'A good match: Someone who plans and someone who improvises.';
  quality_only JSONB;
  rev2 consent_revisions;
  rev3 consent_revisions;
  rev4 consent_revisions;
  rev2_id UUID;
  rev3_id UUID;
  rev4_id UUID;
  reason TEXT;
  current_revision UUID;
  i INTEGER;
  blank_names CONSTANT TEXT[] := ARRAY[
    'TAB', 'LF', 'CR', 'VT', 'FF', 'NEL U+0085', 'NBSP U+00A0', 'OGHAM U+1680',
    'EN QUAD U+2000', 'EM SPACE U+2003', 'HAIR SPACE U+200A', 'ZWSP U+200B',
    'ZWNJ U+200C', 'ZWJ U+200D', 'LINE SEP U+2028', 'PARA SEP U+2029',
    'NNBSP U+202F', 'MMSP U+205F', 'WORD JOINER U+2060', 'IDEOGRAPHIC SPACE U+3000',
    'BOM U+FEFF'
  ];
  blank_runes CONSTANT TEXT[] := ARRAY[
    E'\t', E'\n', E'\r', E'\x0B', E'\x0C', U&'\0085', U&'\00A0', U&'\1680',
    U&'\2000', U&'\2003', U&'\200A', U&'\200B',
    U&'\200C', U&'\200D', U&'\2028', U&'\2029',
    U&'\202F', U&'\205F', U&'\2060', U&'\3000',
    U&'\FEFF'
  ];
BEGIN
  PERFORM set_config('request.jwt.claim.sub', dater::text, true);

  -- ── (A) A structure edit creates a new revision that actually carries
  --        the edited structure, with server-derived headline/body ───────
  SELECT revision_id INTO rev2_id
    FROM public.create_dater_revision(
      draft,
      'client supplied headline that must be ignored',
      'client supplied body that must be ignored',
      ARRAY[photo],
      edited
    );
  SELECT * INTO rev2 FROM public.consent_revisions WHERE id = rev2_id;

  IF rev2.id IS NULL OR rev2.revision_number <> 2 THEN
    failures := array_append(failures, 'the structure edit did not create revision 2');
  END IF;
  IF rev2.structure ->> 'hook' IS DISTINCT FROM 'Blair picked this hook'
     OR rev2.structure ->> 'relationship_context'
        IS DISTINCT FROM 'We met in a pottery class in 2019.'
     OR rev2.structure ->> 'evidence_or_anecdote'
        IS DISTINCT FROM 'They drove four hours to help me move.'
     OR rev2.structure ->> 'good_match_for'
        IS DISTINCT FROM 'Someone who plans and someone who improvises.'
     OR rev2.structure -> 'three_specific_qualities' IS DISTINCT FROM
        '["Remembers every birthday", "Cooks for the whole floor", "Fixes bikes for free"]'::JSONB
  THEN
    failures := array_append(failures,
      'the revision structure is not the structure the dater edited');
  END IF;

  -- headline/body are derived from the structure, never from the client.
  IF rev2.headline IS DISTINCT FROM expected_headline
     OR rev2.body IS DISTINCT FROM expected_body THEN
    failures := array_append(failures,
      'headline/body were not derived from the edited structure: ' || rev2.headline);
  END IF;

  -- The AI safety flag survives the edit untouched.
  IF rev2.structure -> 'hard_claims_requiring_confirmation'
     IS DISTINCT FROM '["Owns a home", "Runs marathons"]'::JSONB THEN
    failures := array_append(failures,
      'hard_claims_requiring_confirmation was not preserved across the edit');
  END IF;

  IF rev2.dater_edited IS NOT TRUE THEN
    failures := array_append(failures, 'a structure edit did not set dater_edited');
  END IF;
  -- CP-1 §12: the introducer-cut revision 1 was never shown to the dater, so
  -- only the revision they submitted may claim the structure was reviewed.
  IF (SELECT structure_reviewed FROM public.consent_revisions WHERE id = rev1) IS NOT FALSE THEN
    failures := array_append(failures, 'the pre-review revision claimed structure_reviewed');
  END IF;
  IF rev2.structure_reviewed IS NOT TRUE THEN
    failures := array_append(failures, 'a structure edit did not set structure_reviewed');
  END IF;
  IF rev2.content_hash = 'd23-fixture-hash-1' THEN
    failures := array_append(failures, 'content_hash did not change with the edit');
  END IF;

  SELECT revision_id INTO current_revision
    FROM public.consent_requests WHERE pitch_draft_id = draft;
  IF current_revision IS DISTINCT FROM rev2_id THEN
    failures := array_append(failures, 'the consent request still points at the old revision');
  END IF;

  -- ── (B) Editing only a quality changes content_hash even though the
  --        derived headline/body are byte-identical ────────────────────
  quality_only := jsonb_set(
    edited,
    '{three_specific_qualities,0}',
    '"Remembers every anniversary"'::JSONB
  );
  SELECT revision_id INTO rev3_id
    FROM public.create_dater_revision(
      draft, 'ignored', 'ignored', ARRAY[photo], quality_only
    );
  SELECT * INTO rev3 FROM public.consent_revisions WHERE id = rev3_id;

  IF rev3.headline IS DISTINCT FROM rev2.headline
     OR rev3.body IS DISTINCT FROM rev2.body THEN
    failures := array_append(failures,
      'a quality-only edit should not move the derived headline/body');
  END IF;
  IF rev3.structure = rev2.structure THEN
    failures := array_append(failures, 'a quality-only edit did not change the structure');
  END IF;
  IF rev3.content_hash = rev2.content_hash THEN
    failures := array_append(failures,
      'content_hash ignored a structure-only change');
  END IF;
  IF rev3.dater_edited IS NOT TRUE THEN
    failures := array_append(failures,
      'dater_edited ignored a structure-only change');
  END IF;

  -- ── (C) Exactly three qualities ─────────────────────────────────────
  reason := pg_temp.structure_reject_reason(
    draft, photo,
    jsonb_set(edited, '{three_specific_qualities}', '["only", "two"]'::JSONB)
  );
  IF reason IS DISTINCT FROM 'pitch structure requires exactly three qualities' THEN
    failures := array_append(failures,
      'two qualities were not rejected: ' || coalesce(reason, 'ACCEPTED'));
  END IF;
  reason := pg_temp.structure_reject_reason(
    draft, photo,
    jsonb_set(edited, '{three_specific_qualities}', '["a", "b", "c", "d"]'::JSONB)
  );
  IF reason IS DISTINCT FROM 'pitch structure requires exactly three qualities' THEN
    failures := array_append(failures,
      'four qualities were not rejected: ' || coalesce(reason, 'ACCEPTED'));
  END IF;
  -- Positive control: exactly three is accepted.
  reason := pg_temp.structure_reject_reason(
    draft, photo,
    jsonb_set(edited, '{three_specific_qualities}', '["a", "b", "c"]'::JSONB)
  );
  IF reason IS NOT NULL THEN
    failures := array_append(failures, 'exactly three qualities was rejected: ' || reason);
  END IF;

  -- ── (D) All five fields are required, blanks included ───────────────
  FOREACH reason IN ARRAY ARRAY[
    'hook', 'relationship_context', 'evidence_or_anecdote', 'good_match_for'
  ] LOOP
    IF pg_temp.structure_reject_reason(draft, photo, edited - reason)
       IS DISTINCT FROM 'pitch structure requires all five fields' THEN
      failures := array_append(failures, 'a missing ' || reason || ' was not rejected');
    END IF;
    IF pg_temp.structure_reject_reason(
         draft, photo, jsonb_set(edited, ARRAY[reason], '"   "'::JSONB)
       ) IS DISTINCT FROM 'pitch structure requires all five fields' THEN
      failures := array_append(failures, 'a blank ' || reason || ' was not rejected');
    END IF;
  END LOOP;
  IF pg_temp.structure_reject_reason(draft, photo, edited - 'three_specific_qualities')
     IS DISTINCT FROM 'pitch structure requires all five fields' THEN
    failures := array_append(failures, 'a missing three_specific_qualities was not rejected');
  END IF;
  IF pg_temp.structure_reject_reason(
       draft, photo,
       jsonb_set(edited, '{three_specific_qualities,1}', '"  "'::JSONB)
     ) IS DISTINCT FROM 'pitch structure requires all five fields' THEN
    failures := array_append(failures, 'a blank quality was not rejected');
  END IF;

  -- ── (D2) "Blank" means no visible character, not "no U+0020" ────────
  -- btrim(text) strips U+0020 only, so a field of tabs, NBSP, en/em spaces
  -- or zero-width characters used to publish as an empty paragraph.
  FOR i IN 1..array_length(blank_runes, 1) LOOP
    IF pg_temp.structure_reject_reason(
         draft, photo, jsonb_set(edited, '{hook}', to_jsonb(repeat(blank_runes[i], 2)))
       ) IS DISTINCT FROM 'pitch structure requires all five fields' THEN
      failures := array_append(failures,
        'a hook of only ' || blank_names[i] || ' was not rejected');
    END IF;
    IF pg_temp.structure_reject_reason(
         draft, photo,
         jsonb_set(edited, '{three_specific_qualities,2}', to_jsonb(blank_runes[i]))
       ) IS DISTINCT FROM 'pitch structure requires all five fields' THEN
      failures := array_append(failures,
        'a quality of only ' || blank_names[i] || ' was not rejected');
    END IF;
    -- Other side of the boundary: the same character next to a visible one
    -- is ordinary text and must still be accepted.
    IF pg_temp.structure_reject_reason(
         draft, photo,
         jsonb_set(edited, '{hook}', to_jsonb(blank_runes[i] || 'x' || blank_runes[i]))
       ) IS NOT NULL THEN
      failures := array_append(failures,
        'a visible hook containing ' || blank_names[i] || ' was rejected');
    END IF;
  END LOOP;

  -- ── (E) Length ceilings, both sides of every boundary ───────────────
  IF pg_temp.structure_reject_reason(
       draft, photo, jsonb_set(edited, '{hook}', to_jsonb(repeat('h', 120)))
     ) IS NOT NULL THEN
    failures := array_append(failures, 'a 120-character hook was rejected');
  END IF;
  IF pg_temp.structure_reject_reason(
       draft, photo, jsonb_set(edited, '{hook}', to_jsonb(repeat('h', 121)))
     ) IS DISTINCT FROM 'pitch structure field is too long' THEN
    failures := array_append(failures, 'a 121-character hook was accepted');
  END IF;

  IF pg_temp.structure_reject_reason(
       draft, photo,
       jsonb_set(edited, '{relationship_context}', to_jsonb(repeat('r', 500)))
     ) IS NOT NULL THEN
    failures := array_append(failures, 'a 500-character relationship_context was rejected');
  END IF;
  IF pg_temp.structure_reject_reason(
       draft, photo,
       jsonb_set(edited, '{relationship_context}', to_jsonb(repeat('r', 501)))
     ) IS DISTINCT FROM 'pitch structure field is too long' THEN
    failures := array_append(failures, 'a 501-character relationship_context was accepted');
  END IF;

  IF pg_temp.structure_reject_reason(
       draft, photo,
       jsonb_set(edited, '{evidence_or_anecdote}', to_jsonb(repeat('e', 501)))
     ) IS DISTINCT FROM 'pitch structure field is too long' THEN
    failures := array_append(failures, 'a 501-character evidence_or_anecdote was accepted');
  END IF;
  IF pg_temp.structure_reject_reason(
       draft, photo,
       jsonb_set(edited, '{good_match_for}', to_jsonb(repeat('g', 501)))
     ) IS DISTINCT FROM 'pitch structure field is too long' THEN
    failures := array_append(failures, 'a 501-character good_match_for was accepted');
  END IF;

  IF pg_temp.structure_reject_reason(
       draft, photo,
       jsonb_set(edited, '{three_specific_qualities,2}', to_jsonb(repeat('q', 120)))
     ) IS NOT NULL THEN
    failures := array_append(failures, 'a 120-character quality was rejected');
  END IF;
  IF pg_temp.structure_reject_reason(
       draft, photo,
       jsonb_set(edited, '{three_specific_qualities,2}', to_jsonb(repeat('q', 121)))
     ) IS DISTINCT FROM 'pitch structure field is too long' THEN
    failures := array_append(failures, 'a 121-character quality was accepted');
  END IF;

  -- ── (F) A client-sent hard_claims list is ignored, not merged ───────
  IF pg_temp.structure_reject_reason(
       draft, photo,
       edited || '{"hard_claims_requiring_confirmation": []}'::JSONB
     ) IS NOT NULL THEN
    failures := array_append(failures, 'a client hard_claims key made the edit fail');
  END IF;
  SELECT revision_id INTO rev4_id
    FROM public.create_dater_revision(
      draft, 'ignored', 'ignored', ARRAY[photo],
      quality_only || '{"hard_claims_requiring_confirmation": []}'::JSONB
    );
  IF (SELECT structure -> 'hard_claims_requiring_confirmation'
        FROM public.consent_revisions WHERE id = rev4_id)
     IS DISTINCT FROM '["Owns a home", "Runs marathons"]'::JSONB THEN
    failures := array_append(failures,
      'the client erased hard_claims_requiring_confirmation through new_structure');
  END IF;

  -- ── (G) Only the subject dater may edit ─────────────────────────────
  PERFORM set_config('request.jwt.claim.sub', introducer::text, true);
  reason := pg_temp.structure_reject_reason(draft, photo, edited);
  IF reason IS DISTINCT FROM
     'draft not found, not yours to edit, or not in consent review' THEN
    failures := array_append(failures,
      'a non-subject edited the structure: ' || coalesce(reason, 'ACCEPTED'));
  END IF;
  -- Ownership is decided before the payload is inspected: a stranger must not
  -- be able to use someone else's draft as a free structure-validation oracle.
  reason := pg_temp.structure_reject_reason(draft, photo, edited - 'hook');
  IF reason IS DISTINCT FROM
     'draft not found, not yours to edit, or not in consent review' THEN
    failures := array_append(failures,
      'a non-subject learned the structure verdict first: ' || coalesce(reason, 'ACCEPTED'));
  END IF;
  PERFORM set_config('request.jwt.claim.sub', dater::text, true);

  -- ── (H) new_structure NULL keeps the pre-0047 behavior ──────────────
  SELECT revision_id INTO rev4_id
    FROM public.create_dater_revision(
      draft, expected_headline, expected_body, ARRAY[photo]
    );
  SELECT * INTO rev4 FROM public.consent_revisions WHERE id = rev4_id;
  IF rev4.structure IS DISTINCT FROM
     (SELECT structure FROM public.consent_revisions WHERE id = rev3_id) THEN
    failures := array_append(failures,
      'a 4-argument call did not carry the previous structure forward');
  END IF;
  -- Positive control for the structure-diff term: carrying the structure
  -- forward with identical copy must NOT flag the revision as edited.
  IF rev4.dater_edited IS NOT FALSE THEN
    failures := array_append(failures,
      'an unchanged 4-argument revision was flagged as dater-edited');
  END IF;
  IF rev4.structure_reviewed IS NOT TRUE THEN
    failures := array_append(failures,
      'a later 4-argument save un-reviewed a structure the dater had reviewed');
  END IF;

  -- ── (I) Revisions stay immutable ────────────────────────────────────
  -- The sentinel raise rolls the subtransaction back, so a broken trigger
  -- reports itself instead of corrupting the approval check below.
  BEGIN
    UPDATE public.consent_revisions SET headline = 'mutated' WHERE id = rev4_id;
    RAISE EXCEPTION 'D23-MUTABLE';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'D23-MUTABLE' THEN
      failures := array_append(failures, 'a consent revision UPDATE was accepted');
    ELSIF SQLERRM <> 'consent revisions are immutable' THEN
      failures := array_append(failures, 'revision UPDATE wrong reason: ' || SQLERRM);
    END IF;
  END;
  BEGIN
    DELETE FROM public.consent_revisions WHERE id = rev4_id;
    RAISE EXCEPTION 'D23-MUTABLE';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'D23-MUTABLE' THEN
      failures := array_append(failures, 'a consent revision DELETE was accepted');
    ELSIF SQLERRM <> 'consent revisions are immutable' THEN
      failures := array_append(failures, 'revision DELETE wrong reason: ' || SQLERRM);
    END IF;
  END;

  -- ── (J) Approval publishes the EDITED structure ─────────────────────
  PERFORM * FROM public.approve_and_publish_pitch(
    draft, 14, rev4_id, ARRAY[photo], true
  );
  IF (SELECT structure FROM public.pitch_drafts WHERE id = draft)
     IS DISTINCT FROM rev4.structure THEN
    failures := array_append(failures,
      'the published draft structure is not the approved revision structure');
  END IF;
  IF (SELECT structure ->> 'hook' FROM public.pitch_drafts WHERE id = draft)
     IS DISTINCT FROM 'Blair picked this hook' THEN
    failures := array_append(failures,
      'the public projection still carries the AI hook after a dater edit');
  END IF;
  IF (SELECT headline FROM public.pitch_drafts WHERE id = draft)
     IS DISTINCT FROM expected_headline THEN
    failures := array_append(failures, 'the published headline is not the derived headline');
  END IF;
  -- The dater reviewed the structure in (A); the later 4-argument save must
  -- not un-review it, and approval must carry the marker to the public row.
  IF (SELECT structure_reviewed FROM public.pitch_drafts WHERE id = draft) IS NOT TRUE THEN
    failures := array_append(failures,
      'structure_reviewed did not reach the published draft after a structure edit');
  END IF;

  IF array_length(failures, 1) IS NOT NULL THEN
    RAISE EXCEPTION '23_dater_structure_edit failures: %', array_to_string(failures, ' | ');
  END IF;
END;
$$;

-- ── Moderation: every edited sentence needs a passed verdict ────────────
UPDATE public.app_config SET value = 'on' WHERE key = 'media_validation_enforcement';

INSERT INTO public.pitch_drafts (
  id, created_by_user_id, subject_user_id, status, headline, body, structure
) VALUES (
  'd2300000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002',
  'consent_pending',
  'Second AI hook',
  'Second AI body.',
  '{"hard_claims_requiring_confirmation": []}'::JSONB
);
INSERT INTO public.pitch_assets (
  id, pitch_draft_id, uploaded_by_user_id, asset_type, storage_path, sort_order
) VALUES
  (
    'd2300000-0000-0000-0000-000000000212',
    'd2300000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000001',
    'photo',
    'pitch-media/d2300000-0000-0000-0000-000000000002/photo-1.jpg',
    0
  ),
  (
    'd2300000-0000-0000-0000-000000000213',
    'd2300000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000001',
    'photo',
    'pitch-media/d2300000-0000-0000-0000-000000000002/photo-2.jpg',
    1
  );
INSERT INTO public.media_validations (
  bucket_id, object_name, validated_at,
  mime_ok, magic_ok, size_ok, decode_ok, moderation_status, moderation_ref
) VALUES
  (
    'pitch-media',
    'd2300000-0000-0000-0000-000000000002/photo-1.jpg',
    now(), true, true, true, true, 'passed', 'd23-photo-1'
  ),
  (
    'pitch-media',
    'd2300000-0000-0000-0000-000000000002/photo-2.jpg',
    now(), true, true, true, true, 'passed', 'd23-photo-2'
  );
INSERT INTO public.consent_revisions (
  id, pitch_draft_id, revision_number, headline, body, structure,
  asset_ids, content_hash
) VALUES (
  'd2300000-0000-0000-0000-000000000302',
  'd2300000-0000-0000-0000-000000000002',
  1,
  'Second AI hook',
  'Second AI body.',
  '{"hard_claims_requiring_confirmation": []}'::JSONB,
  ARRAY[
    'd2300000-0000-0000-0000-000000000212',
    'd2300000-0000-0000-0000-000000000213'
  ]::UUID[],
  'd23-fixture-hash-2'
);
INSERT INTO public.consent_requests (
  id, pitch_draft_id, subject_user_id, token_hash, status, revision_id,
  invite_contact_channel, invite_contact_hash
) VALUES (
  'd2300000-0000-0000-0000-000000000402',
  'd2300000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000002',
  encode(digest('d23-consent-token-2', 'sha256'), 'hex'),
  'claimed',
  'd2300000-0000-0000-0000-000000000302',
  'email',
  encode(digest('d23-dater-2@example.test', 'sha256'), 'hex')
);

DO $$
DECLARE
  failures TEXT[] := ARRAY[]::TEXT[];
  draft CONSTANT UUID := 'd2300000-0000-0000-0000-000000000002';
  photo CONSTANT UUID := 'd2300000-0000-0000-0000-000000000212';
  photo_two CONSTANT UUID := 'd2300000-0000-0000-0000-000000000213';
  dater CONSTANT UUID := '00000000-0000-0000-0000-000000000002';
  edited CONSTANT JSONB := '{
    "hook": "Second hook",
    "relationship_context": "Second context.",
    "three_specific_qualities": ["Quality alpha", "Quality beta", "Quality gamma"],
    "evidence_or_anecdote": "Second evidence.",
    "good_match_for": "Second match."
  }'::JSONB;
  -- Literal, not computed from the helper: a mutation in the SQL formula must
  -- turn this red rather than follow the code.
  derived_text CONSTANT TEXT :=
    'Second hook' || E'\n\n'
    || 'Second context.' || E'\n\n' || 'Second evidence.' || E'\n\n'
    || 'A good match: Second match.';
  full_text CONSTANT TEXT :=
    derived_text || E'\n\n' || 'Quality alpha' || E'\n\n' || 'Quality beta'
    || E'\n\n' || 'Quality gamma';
  -- A second structure whose 2-part "headline\n\nbody" string is never given a
  -- verdict, so the lockout check below cannot pass by accident.
  locked_out CONSTANT JSONB := '{
    "hook": "Locked out hook",
    "relationship_context": "Locked out context.",
    "three_specific_qualities": ["Kappa", "Lambda", "Mu"],
    "evidence_or_anecdote": "Locked out evidence.",
    "good_match_for": "Locked out match."
  }'::JSONB;
  locked_out_text CONSTANT TEXT :=
    'Locked out hook' || E'\n\n'
    || 'Locked out context.' || E'\n\n' || 'Locked out evidence.' || E'\n\n'
    || 'A good match: Locked out match.' || E'\n\n'
    || 'Kappa' || E'\n\n' || 'Lambda' || E'\n\n' || 'Mu';
  reason TEXT;
  revision_count INTEGER;
  edit_revision UUID;
  photo_revision UUID;
  edit_row consent_revisions;
  photo_row consent_revisions;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', dater::text, true);

  -- No verdict at all → rejected, and no revision is written.
  reason := pg_temp.structure_reject_reason(draft, photo, edited);
  IF reason IS DISTINCT FROM 'pitch text requires a passed moderation verdict' THEN
    failures := array_append(failures,
      'unmoderated structure text entered a revision: ' || coalesce(reason, 'ACCEPTED'));
  END IF;
  SELECT count(*) INTO revision_count
    FROM public.consent_revisions WHERE pitch_draft_id = draft;
  IF revision_count <> 1 THEN
    failures := array_append(failures, 'a rejected edit still created a revision');
  END IF;

  -- A verdict covering only the derived headline/body is NOT enough: the
  -- three qualities are published verbatim and must be moderated too.
  INSERT INTO public.text_moderations (scope, content_hash, moderation_status)
  VALUES ('pitch_content', encode(digest(derived_text, 'sha256'), 'hex'), 'passed')
  ON CONFLICT (scope, content_hash) DO NOTHING;
  reason := pg_temp.structure_reject_reason(draft, photo, edited);
  IF reason IS DISTINCT FROM 'pitch text requires a passed moderation verdict' THEN
    failures := array_append(failures,
      'the qualities escaped moderation: ' || coalesce(reason, 'ACCEPTED'));
  END IF;

  -- A flagged verdict for the full text is still a rejection.
  INSERT INTO public.text_moderations (scope, content_hash, moderation_status)
  VALUES ('pitch_content', encode(digest(full_text, 'sha256'), 'hex'), 'flagged')
  ON CONFLICT (scope, content_hash) DO UPDATE SET moderation_status = 'flagged';
  reason := pg_temp.structure_reject_reason(draft, photo, edited);
  IF reason IS DISTINCT FROM 'pitch text requires a passed moderation verdict' THEN
    failures := array_append(failures,
      'a flagged verdict published: ' || coalesce(reason, 'ACCEPTED'));
  END IF;
  SELECT count(*) INTO revision_count
    FROM public.consent_revisions WHERE pitch_draft_id = draft;
  IF revision_count <> 1 THEN
    failures := array_append(failures, 'a flagged edit still created a revision');
  END IF;

  -- Positive control: a passed verdict for the exact full text is accepted.
  UPDATE public.text_moderations SET moderation_status = 'passed'
   WHERE scope = 'pitch_content'
     AND content_hash = encode(digest(full_text, 'sha256'), 'hex');
  reason := pg_temp.structure_reject_reason(draft, photo, edited);
  IF reason IS NOT NULL THEN
    failures := array_append(failures, 'a fully moderated structure edit was rejected: ' || reason);
  END IF;

  -- A passed verdict does not license a different quality.
  reason := pg_temp.structure_reject_reason(
    draft, photo,
    jsonb_set(edited, '{three_specific_qualities,0}', '"Quality delta"'::JSONB)
  );
  IF reason IS DISTINCT FROM 'pitch text requires a passed moderation verdict' THEN
    failures := array_append(failures,
      'an edited quality reused a stale verdict: ' || coalesce(reason, 'ACCEPTED'));
  END IF;

  -- ── No save lockout after a structure edit ──────────────────────────
  -- The edit registers a verdict for "hook\n\nderived body\n\nq1\n\nq2\n\nq3".
  -- A later photo-only save republishes those exact bytes, so it must not be
  -- asked for a verdict keyed on a different string. When it was, the dater
  -- could never drop a photo again — and "Approve & publish" stayed disabled
  -- because the photo set was dirty, so they could not publish at all.
  -- Deliberately a DIFFERENT structure from `edited`: only its 5-part string
  -- gets a verdict, never the 2-part "headline\n\nbody" pair. A path-dependent
  -- moderation string therefore has nothing to find on the photo-only save.
  INSERT INTO public.text_moderations (scope, content_hash, moderation_status)
  VALUES ('pitch_content', encode(digest(locked_out_text, 'sha256'), 'hex'), 'passed')
  ON CONFLICT (scope, content_hash) DO UPDATE SET moderation_status = 'passed';

  SELECT revision_id INTO edit_revision
    FROM public.create_dater_revision(
      draft, 'ignored', 'ignored', ARRAY[photo, photo_two], locked_out
    );
  SELECT * INTO edit_row FROM public.consent_revisions WHERE id = edit_revision;

  BEGIN
    SELECT revision_id INTO photo_revision
      FROM public.create_dater_revision(
        draft, btrim(edit_row.headline), btrim(edit_row.body), ARRAY[photo]
      );
  EXCEPTION WHEN OTHERS THEN
    failures := array_append(failures,
      'a photo-only save after a structure edit was locked out: ' || SQLERRM);
  END;
  IF photo_revision IS NOT NULL THEN
    SELECT * INTO photo_row FROM public.consent_revisions WHERE id = photo_revision;
    -- The words must survive the photo-only save untouched.
    IF photo_row.headline IS DISTINCT FROM edit_row.headline
       OR photo_row.body IS DISTINCT FROM edit_row.body
       OR photo_row.structure IS DISTINCT FROM edit_row.structure THEN
      failures := array_append(failures,
        'a photo-only save rewrote the approved words');
    END IF;
    IF photo_row.asset_ids @> ARRAY[photo_two]::UUID[] THEN
      failures := array_append(failures, 'the dropped photo stayed in the snapshot');
    END IF;
  END IF;

  IF array_length(failures, 1) IS NOT NULL THEN
    RAISE EXCEPTION '23_dater_structure_edit moderation failures: %',
      array_to_string(failures, ' | ');
  END IF;
END;
$$;

-- ── Hard-claim disposition, legacy-path derivation, review provenance ───
-- Enforcement back off: this block is about who owns the published words and
-- the flagged claims, not about the moderation ledger.
UPDATE public.app_config SET value = 'off' WHERE key = 'media_validation_enforcement';

-- draft 3: a structured pitch with two AI-flagged hard claims.
INSERT INTO public.pitch_drafts (
  id, created_by_user_id, subject_user_id, status, headline, body, structure
) VALUES (
  'd2300000-0000-0000-0000-000000000003',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002',
  'consent_pending',
  'Third AI hook',
  'Third AI body.',
  '{"hook": "Third AI hook",
    "relationship_context": "Third AI context.",
    "three_specific_qualities": ["Third one", "Third two", "Third three"],
    "evidence_or_anecdote": "She owns a home in Brooklyn.",
    "good_match_for": "Third match.",
    "safety_notes": "AI-owned key that must survive every edit",
    "hard_claims_requiring_confirmation": ["Owns a home", "Runs marathons"]}'::JSONB
);
INSERT INTO public.pitch_assets (
  id, pitch_draft_id, uploaded_by_user_id, asset_type, storage_path, sort_order
) VALUES
  (
    'd2300000-0000-0000-0000-000000000231',
    'd2300000-0000-0000-0000-000000000003',
    '00000000-0000-0000-0000-000000000001',
    'photo',
    'pitch-media/d2300000-0000-0000-0000-000000000003/photo-1.jpg',
    0
  ),
  (
    'd2300000-0000-0000-0000-000000000232',
    'd2300000-0000-0000-0000-000000000003',
    '00000000-0000-0000-0000-000000000001',
    'photo',
    'pitch-media/d2300000-0000-0000-0000-000000000003/photo-2.jpg',
    1
  );
INSERT INTO public.consent_revisions (
  id, pitch_draft_id, revision_number, headline, body, structure,
  asset_ids, content_hash
) VALUES (
  'd2300000-0000-0000-0000-000000000303',
  'd2300000-0000-0000-0000-000000000003',
  1,
  'Third AI hook',
  'Third AI body.',
  '{"hook": "Third AI hook",
    "relationship_context": "Third AI context.",
    "three_specific_qualities": ["Third one", "Third two", "Third three"],
    "evidence_or_anecdote": "She owns a home in Brooklyn.",
    "good_match_for": "Third match.",
    "safety_notes": "AI-owned key that must survive every edit",
    "hard_claims_requiring_confirmation": ["Owns a home", "Runs marathons"]}'::JSONB,
  ARRAY[
    'd2300000-0000-0000-0000-000000000231',
    'd2300000-0000-0000-0000-000000000232'
  ]::UUID[],
  'd23-fixture-hash-3'
);
INSERT INTO public.consent_requests (
  id, pitch_draft_id, subject_user_id, token_hash, status, revision_id,
  invite_contact_channel, invite_contact_hash
) VALUES (
  'd2300000-0000-0000-0000-000000000403',
  'd2300000-0000-0000-0000-000000000003',
  '00000000-0000-0000-0000-000000000002',
  encode(digest('d23-consent-token-3', 'sha256'), 'hex'),
  'claimed',
  'd2300000-0000-0000-0000-000000000303',
  'email',
  encode(digest('d23-dater-3@example.test', 'sha256'), 'hex')
);

-- draft 4: no structure at all, so the merge has nothing to inherit.
INSERT INTO public.pitch_drafts (
  id, created_by_user_id, subject_user_id, status, headline, body, structure
) VALUES (
  'd2300000-0000-0000-0000-000000000004',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002',
  'consent_pending',
  'Fourth AI hook',
  'Fourth AI body.',
  NULL
);
INSERT INTO public.pitch_assets (
  id, pitch_draft_id, uploaded_by_user_id, asset_type, storage_path, sort_order
) VALUES (
  'd2300000-0000-0000-0000-000000000241',
  'd2300000-0000-0000-0000-000000000004',
  '00000000-0000-0000-0000-000000000001',
  'photo',
  'pitch-media/d2300000-0000-0000-0000-000000000004/photo-1.jpg',
  0
);
INSERT INTO public.consent_revisions (
  id, pitch_draft_id, revision_number, headline, body, structure,
  asset_ids, content_hash
) VALUES (
  'd2300000-0000-0000-0000-000000000304',
  'd2300000-0000-0000-0000-000000000004',
  1,
  'Fourth AI hook',
  'Fourth AI body.',
  NULL,
  ARRAY['d2300000-0000-0000-0000-000000000241']::UUID[],
  'd23-fixture-hash-4'
);
INSERT INTO public.consent_requests (
  id, pitch_draft_id, subject_user_id, token_hash, status, revision_id,
  invite_contact_channel, invite_contact_hash
) VALUES (
  'd2300000-0000-0000-0000-000000000404',
  'd2300000-0000-0000-0000-000000000004',
  '00000000-0000-0000-0000-000000000002',
  encode(digest('d23-consent-token-4', 'sha256'), 'hex'),
  'claimed',
  'd2300000-0000-0000-0000-000000000304',
  'email',
  encode(digest('d23-dater-4@example.test', 'sha256'), 'hex')
);

DO $$
DECLARE
  failures TEXT[] := ARRAY[]::TEXT[];
  draft3 CONSTANT UUID := 'd2300000-0000-0000-0000-000000000003';
  draft4 CONSTANT UUID := 'd2300000-0000-0000-0000-000000000004';
  photo_a CONSTANT UUID := 'd2300000-0000-0000-0000-000000000231';
  photo_b CONSTANT UUID := 'd2300000-0000-0000-0000-000000000232';
  photo_d4 CONSTANT UUID := 'd2300000-0000-0000-0000-000000000241';
  dater CONSTANT UUID := '00000000-0000-0000-0000-000000000002';
  ai_body CONSTANT TEXT :=
    'Third AI context.' || E'\n\n'
    || 'She owns a home in Brooklyn.' || E'\n\n'
    || 'A good match: Third match.';
  redacted CONSTANT JSONB := '{
    "hook": "Blair third hook",
    "relationship_context": "We met at a climbing gym.",
    "three_specific_qualities": ["Patient", "Curious", "Generous"],
    "evidence_or_anecdote": "She drove three hours to help me move.",
    "good_match_for": "Someone who talks things through."
  }'::JSONB;
  legacy_only CONSTANT JSONB := '{
    "hook": "Fourth hook",
    "relationship_context": "Fourth context.",
    "three_specific_qualities": ["Alpha", "Beta", "Gamma"],
    "evidence_or_anecdote": "Fourth evidence.",
    "good_match_for": "Fourth match."
  }'::JSONB;
  rev consent_revisions;
  rev_id UUID;
  reported TEXT;
  approved BOOLEAN;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', dater::text, true);

  -- ── (K) The legacy 4-argument call can no longer publish the AI's
  --        sentences under a headline the Dater wrote ───────────────────
  -- This is the original P0 reproduced through the legacy path: the client
  -- headline/body were stored while /p/[slug] rendered `structure`.
  SELECT revision_id INTO rev_id
    FROM public.create_dater_revision(
      draft3,
      'CLIENT REWROTE THE HEADLINE',
      'CLIENT REWROTE THE BODY, none of this is the AI text.',
      ARRAY[photo_a, photo_b]
    );
  SELECT * INTO rev FROM public.consent_revisions WHERE id = rev_id;
  IF rev.headline IS DISTINCT FROM 'Third AI hook' OR rev.body IS DISTINCT FROM ai_body THEN
    failures := array_append(failures,
      'a 4-argument call stored client copy against a published structure: ' || rev.headline);
  END IF;
  IF rev.structure ->> 'hook' IS DISTINCT FROM rev.headline THEN
    failures := array_append(failures, 'the stored headline diverged from the published hook');
  END IF;
  IF rev.structure_reviewed IS NOT FALSE THEN
    failures := array_append(failures,
      'a 4-argument call claimed the dater had reviewed the structure');
  END IF;

  -- ── (L) A retained claim must be one the AI actually flagged ─────────
  BEGIN
    PERFORM * FROM public.create_dater_revision(
      draft3, 'ignored', 'ignored', ARRAY[photo_a, photo_b], redacted,
      ARRAY['Owns a private island']
    );
    failures := array_append(failures, 'an invented hard claim was accepted');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM IS DISTINCT FROM 'hard claim is not one of the flagged claims' THEN
      failures := array_append(failures, 'invented-claim reject wrong reason: ' || SQLERRM);
    END IF;
  END;

  -- ── (M) The Dater keeps one claim and says they removed the other ────
  SELECT revision_id INTO rev_id
    FROM public.create_dater_revision(
      draft3, 'ignored', 'ignored', ARRAY[photo_a, photo_b], redacted,
      ARRAY['Owns a home']
    );
  SELECT * INTO rev FROM public.consent_revisions WHERE id = rev_id;
  IF rev.structure -> 'hard_claims_requiring_confirmation'
     IS DISTINCT FROM '["Owns a home"]'::JSONB THEN
    failures := array_append(failures,
      'the retained claim list was not narrowed to the dater disposition');
  END IF;
  IF rev.structure ->> 'safety_notes' IS NULL THEN
    failures := array_append(failures, 'an AI-owned structure key was lost by the disposition');
  END IF;
  IF rev.structure_reviewed IS NOT TRUE THEN
    failures := array_append(failures, 'a structure edit did not record structure_reviewed');
  END IF;

  -- A dropped claim cannot come back: the prior revision is the source list.
  BEGIN
    PERFORM * FROM public.create_dater_revision(
      draft3, 'ignored', 'ignored', ARRAY[photo_a, photo_b], redacted,
      ARRAY['Runs marathons']
    );
    failures := array_append(failures, 'a dropped hard claim was resurrected');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM IS DISTINCT FROM 'hard claim is not one of the flagged claims' THEN
      failures := array_append(failures, 'resurrected-claim reject wrong reason: ' || SQLERRM);
    END IF;
  END;

  -- ── (N) With a claim still retained, approval demands confirmation ───
  -- Photo-only save first so dater_edited is false and the approval gate is
  -- driven by the claim list alone.
  SELECT revision_id INTO rev_id
    FROM public.create_dater_revision(draft3, 'ignored', 'ignored', ARRAY[photo_a]);
  SELECT * INTO rev FROM public.consent_revisions WHERE id = rev_id;
  IF rev.dater_edited IS NOT FALSE THEN
    failures := array_append(failures,
      'a photo-only save after a structure edit was flagged as a text edit');
  END IF;
  IF rev.structure_reviewed IS NOT TRUE THEN
    failures := array_append(failures, 'a photo-only save un-reviewed the structure');
  END IF;

  UPDATE public.campaigns SET status = 'archived'
   WHERE owner_user_id = dater AND status IN ('published', 'paused');
  reported := NULL;
  BEGIN
    PERFORM * FROM public.approve_and_publish_pitch(
      draft3, 14, rev_id, ARRAY[photo_a], false
    );
  EXCEPTION WHEN OTHERS THEN reported := SQLERRM;
  END;
  IF reported IS DISTINCT FROM 'hard claims require confirmation before approval' THEN
    failures := array_append(failures,
      'a retained hard claim did not require confirmation: ' || coalesce(reported, 'PUBLISHED'));
  END IF;

  -- ── (O) With every claim dropped, the confirmation demand goes away ──
  SELECT revision_id INTO rev_id
    FROM public.create_dater_revision(
      draft3, 'ignored', 'ignored', ARRAY[photo_a, photo_b], redacted,
      ARRAY[]::TEXT[]
    );
  SELECT * INTO rev FROM public.consent_revisions WHERE id = rev_id;
  IF rev.structure -> 'hard_claims_requiring_confirmation' IS DISTINCT FROM '[]'::JSONB THEN
    failures := array_append(failures, 'an empty disposition did not clear the claim list');
  END IF;

  SELECT revision_id INTO rev_id
    FROM public.create_dater_revision(draft3, 'ignored', 'ignored', ARRAY[photo_a]);
  SELECT * INTO rev FROM public.consent_revisions WHERE id = rev_id;
  IF rev.dater_edited IS NOT FALSE THEN
    failures := array_append(failures, 'the second photo-only save was flagged as a text edit');
  END IF;

  approved := false;
  BEGIN
    PERFORM * FROM public.approve_and_publish_pitch(
      draft3, 14, rev_id, ARRAY[photo_a], false
    );
    approved := true;
  EXCEPTION WHEN OTHERS THEN reported := SQLERRM;
  END;
  IF NOT approved THEN
    failures := array_append(failures,
      'approval still demanded confirmation for claims the dater removed: ' || reported);
  ELSE
    IF (SELECT structure -> 'hard_claims_requiring_confirmation'
          FROM public.pitch_drafts WHERE id = draft3)
       IS DISTINCT FROM '[]'::JSONB THEN
      failures := array_append(failures, 'a removed hard claim was published anyway');
    END IF;
    IF (SELECT structure_reviewed FROM public.pitch_drafts WHERE id = draft3) IS NOT TRUE THEN
      failures := array_append(failures,
        'the published draft did not record that the dater reviewed the structure');
    END IF;
  END IF;

  -- ── (P) A merged structure always carries the flag key ──────────────
  -- The public page's parser requires hard_claims_requiring_confirmation; a
  -- structure without it parses as null there, so the hook and all three
  -- qualities the Dater just approved would be dropped from the page.
  SELECT revision_id INTO rev_id
    FROM public.create_dater_revision(
      draft4, 'ignored', 'ignored', ARRAY[photo_d4], legacy_only
    );
  SELECT * INTO rev FROM public.consent_revisions WHERE id = rev_id;
  IF NOT (rev.structure ? 'hard_claims_requiring_confirmation') THEN
    failures := array_append(failures,
      'a structure edit over a NULL structure published without the hard-claims key');
  END IF;
  IF rev.structure -> 'hard_claims_requiring_confirmation' IS DISTINCT FROM '[]'::JSONB THEN
    failures := array_append(failures, 'the absent hard-claims list did not default to empty');
  END IF;
  IF rev.headline IS DISTINCT FROM 'Fourth hook' THEN
    failures := array_append(failures, 'the NULL-structure edit did not derive the headline');
  END IF;

  IF array_length(failures, 1) IS NOT NULL THEN
    RAISE EXCEPTION '23_dater_structure_edit disposition failures: %',
      array_to_string(failures, ' | ');
  END IF;
END;
$$;

-- ── A pitch the Dater never saw a structure for stays unreviewed ────────
-- D6: pre-0047 rows carry AI structure the Dater was never shown. The public
-- page needs a render-time discriminator, so a purely legacy consent review
-- must publish with structure_reviewed = false.
INSERT INTO public.pitch_drafts (
  id, created_by_user_id, subject_user_id, status, headline, body, structure
) VALUES (
  'd2300000-0000-0000-0000-000000000005',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002',
  'consent_pending',
  'Fifth AI hook',
  'Fifth AI body.',
  NULL
);
INSERT INTO public.pitch_assets (
  id, pitch_draft_id, uploaded_by_user_id, asset_type, storage_path, sort_order
) VALUES (
  'd2300000-0000-0000-0000-000000000251',
  'd2300000-0000-0000-0000-000000000005',
  '00000000-0000-0000-0000-000000000001',
  'photo',
  'pitch-media/d2300000-0000-0000-0000-000000000005/photo-1.jpg',
  0
);
INSERT INTO public.consent_revisions (
  id, pitch_draft_id, revision_number, headline, body, structure,
  asset_ids, content_hash
) VALUES (
  'd2300000-0000-0000-0000-000000000305',
  'd2300000-0000-0000-0000-000000000005',
  1,
  'Fifth AI hook',
  'Fifth AI body.',
  NULL,
  ARRAY['d2300000-0000-0000-0000-000000000251']::UUID[],
  'd23-fixture-hash-5'
);
INSERT INTO public.consent_requests (
  id, pitch_draft_id, subject_user_id, token_hash, status, revision_id,
  invite_contact_channel, invite_contact_hash
) VALUES (
  'd2300000-0000-0000-0000-000000000405',
  'd2300000-0000-0000-0000-000000000005',
  '00000000-0000-0000-0000-000000000002',
  encode(digest('d23-consent-token-5', 'sha256'), 'hex'),
  'claimed',
  'd2300000-0000-0000-0000-000000000305',
  'email',
  encode(digest('d23-dater-5@example.test', 'sha256'), 'hex')
);

DO $$
DECLARE
  failures TEXT[] := ARRAY[]::TEXT[];
  draft5 CONSTANT UUID := 'd2300000-0000-0000-0000-000000000005';
  photo CONSTANT UUID := 'd2300000-0000-0000-0000-000000000251';
  dater CONSTANT UUID := '00000000-0000-0000-0000-000000000002';
  rev_id UUID;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', dater::text, true);

  SELECT revision_id INTO rev_id
    FROM public.create_dater_revision(
      draft5, 'Blair legacy headline', 'Blair legacy body.', ARRAY[photo]
    );
  IF (SELECT structure_reviewed FROM public.consent_revisions WHERE id = rev_id)
     IS NOT FALSE THEN
    failures := array_append(failures,
      'a headline/body-only review claimed the structure was reviewed');
  END IF;

  UPDATE public.campaigns SET status = 'archived'
   WHERE owner_user_id = dater AND status IN ('published', 'paused');
  PERFORM * FROM public.approve_and_publish_pitch(draft5, 14, rev_id, ARRAY[photo], true);

  IF (SELECT structure_reviewed FROM public.pitch_drafts WHERE id = draft5) IS NOT FALSE THEN
    failures := array_append(failures,
      'a published row the dater never saw a structure for claims they reviewed it');
  END IF;

  IF array_length(failures, 1) IS NOT NULL THEN
    RAISE EXCEPTION '23_dater_structure_edit provenance failures: %',
      array_to_string(failures, ' | ');
  END IF;
END;
$$;

-- ── Flipping media_validation_enforcement on is retroactive ─────────────
-- app_config ships media_validation_enforcement = 'off', so text can enter a
-- revision with no verdict at all. The gate must therefore stay unconditional:
-- an "the words did not change since the prior revision, so skip the check"
-- shortcut would exempt that text forever instead of catching it on the first
-- save after the switch is flipped. This block pins the retroactivity, and the
-- moderation block above pins that the unconditional gate still lets a
-- photo-only save through after a structure edit — both must hold at once.
UPDATE public.app_config SET value = 'off' WHERE key = 'media_validation_enforcement';

INSERT INTO public.pitch_drafts (
  id, created_by_user_id, subject_user_id, status, headline, body, structure
) VALUES (
  'd2300000-0000-0000-0000-000000000006',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002',
  'consent_pending',
  'Sixth AI hook',
  'Sixth AI body.',
  NULL
);
INSERT INTO public.pitch_assets (
  id, pitch_draft_id, uploaded_by_user_id, asset_type, storage_path, sort_order
) VALUES
  (
    'd2300000-0000-0000-0000-000000000261',
    'd2300000-0000-0000-0000-000000000006',
    '00000000-0000-0000-0000-000000000001',
    'photo',
    'pitch-media/d2300000-0000-0000-0000-000000000006/photo-1.jpg',
    0
  ),
  (
    'd2300000-0000-0000-0000-000000000262',
    'd2300000-0000-0000-0000-000000000006',
    '00000000-0000-0000-0000-000000000001',
    'photo',
    'pitch-media/d2300000-0000-0000-0000-000000000006/photo-2.jpg',
    1
  );
INSERT INTO public.media_validations (
  bucket_id, object_name, validated_at,
  mime_ok, magic_ok, size_ok, decode_ok, moderation_status, moderation_ref
) VALUES
  (
    'pitch-media', 'd2300000-0000-0000-0000-000000000006/photo-1.jpg',
    now(), true, true, true, true, 'passed', 'd23-photo-6-1'
  ),
  (
    'pitch-media', 'd2300000-0000-0000-0000-000000000006/photo-2.jpg',
    now(), true, true, true, true, 'passed', 'd23-photo-6-2'
  );
INSERT INTO public.consent_revisions (
  id, pitch_draft_id, revision_number, headline, body, structure,
  asset_ids, content_hash
) VALUES (
  'd2300000-0000-0000-0000-000000000306',
  'd2300000-0000-0000-0000-000000000006',
  1,
  'Sixth AI hook',
  'Sixth AI body.',
  NULL,
  ARRAY[
    'd2300000-0000-0000-0000-000000000261',
    'd2300000-0000-0000-0000-000000000262'
  ]::UUID[],
  'd23-fixture-hash-6'
);
INSERT INTO public.consent_requests (
  id, pitch_draft_id, subject_user_id, token_hash, status, revision_id,
  invite_contact_channel, invite_contact_hash
) VALUES (
  'd2300000-0000-0000-0000-000000000406',
  'd2300000-0000-0000-0000-000000000006',
  '00000000-0000-0000-0000-000000000002',
  encode(digest('d23-consent-token-6', 'sha256'), 'hex'),
  'claimed',
  'd2300000-0000-0000-0000-000000000306',
  'email',
  encode(digest('d23-dater-6@example.test', 'sha256'), 'hex')
);

DO $$
DECLARE
  failures TEXT[] := ARRAY[]::TEXT[];
  draft6 CONSTANT UUID := 'd2300000-0000-0000-0000-000000000006';
  photo_one CONSTANT UUID := 'd2300000-0000-0000-0000-000000000261';
  photo_two CONSTANT UUID := 'd2300000-0000-0000-0000-000000000262';
  dater CONSTANT UUID := '00000000-0000-0000-0000-000000000002';
  unverified_headline CONSTANT TEXT := 'Blair wrote this while the switch was off';
  unverified_body CONSTANT TEXT := 'Nothing checked these words.';
  -- Literal, not built from the helper: a mutation in the legacy branch of
  -- private.dater_revision_moderation_text must turn this red.
  unverified_text CONSTANT TEXT :=
    unverified_headline || E'\n\n' || unverified_body;
  rev_id UUID;
  reason TEXT;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', dater::text, true);

  -- Enforcement off: the words land in a revision with no verdict anywhere.
  SELECT revision_id INTO rev_id
    FROM public.create_dater_revision(
      draft6, unverified_headline, unverified_body,
      ARRAY[photo_one, photo_two]
    );
  IF rev_id IS NULL THEN
    failures := array_append(failures, 'the enforcement-off revision was rejected');
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.text_moderations
     WHERE scope = 'pitch_content'
       AND content_hash = encode(digest(unverified_text, 'sha256'), 'hex')
  ) THEN
    failures := array_append(failures,
      'the fixture already holds a verdict, so this block proves nothing');
  END IF;

  -- Flip the switch. The next save repeats those exact unverified words while
  -- only dropping a photo, and must still be stopped.
  UPDATE public.app_config SET value = 'on' WHERE key = 'media_validation_enforcement';

  reason := NULL;
  BEGIN
    PERFORM * FROM public.create_dater_revision(
      draft6, unverified_headline, unverified_body, ARRAY[photo_one]
    );
  EXCEPTION WHEN OTHERS THEN
    reason := SQLERRM;
  END;
  IF reason IS DISTINCT FROM 'pitch text requires a passed moderation verdict' THEN
    failures := array_append(failures,
      'unverified text carried forward escaped the gate after enforcement was turned on: '
      || coalesce(reason, 'ACCEPTED'));
  END IF;

  -- Positive control: once the words earn a verdict, the same save succeeds,
  -- so the gate is not simply an unconditional refusal.
  INSERT INTO public.text_moderations (scope, content_hash, moderation_status)
  VALUES ('pitch_content', encode(digest(unverified_text, 'sha256'), 'hex'), 'passed')
  ON CONFLICT (scope, content_hash) DO UPDATE SET moderation_status = 'passed';

  rev_id := NULL;
  BEGIN
    SELECT revision_id INTO rev_id
      FROM public.create_dater_revision(
        draft6, unverified_headline, unverified_body, ARRAY[photo_one]
      );
  EXCEPTION WHEN OTHERS THEN
    failures := array_append(failures,
      'a verdict-backed photo-only save was still rejected: ' || SQLERRM);
  END;
  IF rev_id IS NOT NULL
     AND (SELECT photo_two = ANY(asset_ids) FROM public.consent_revisions WHERE id = rev_id) THEN
    failures := array_append(failures, 'the dropped photo stayed in the snapshot');
  END IF;

  IF array_length(failures, 1) IS NOT NULL THEN
    RAISE EXCEPTION '23_dater_structure_edit enforcement-flip failures: %',
      array_to_string(failures, ' | ');
  END IF;
END;
$$;

ROLLBACK;

SELECT '23_dater_structure_edit.sql passed' AS result;
