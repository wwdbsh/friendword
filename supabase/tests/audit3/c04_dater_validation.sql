-- AUDIT3 REGRESSION: 3차 감사 §3 P0-NEW-3 — Dater가 만드는 revision과 publish는
-- 사진 validation·텍스트 moderation을 authoritative하게 요구하고, Dater가 문구를
-- 직접 바꾼 revision은 hard-claim 확인을 강제하며, 승인 시 approved revision의
-- transcript가 public reader가 읽는 pitch_drafts.transcript로 무조건 복사된다.
-- 또한 Dater(subject)가 자기 동의를 기록하고 그 동의로 service reserve가 예약된다.
-- (Slice 2, migration 0036으로 그린 전환)
--
-- red-first: 0036 이전에는 create_dater_revision이 asset의 draft 소속만 확인하고
-- media_validations/text_moderations pass를 요구하지 않으므로 미검증 photo·미검수
-- 텍스트 revision이 성공해버리고, consent_revisions.dater_edited 컬럼도 없으며,
-- approve_and_publish_pitch는 transcript를 복사하지 않아 아래 검사가 그대로 RED다.
BEGIN;

-- The dater validation/text gates are fail-closed only while enforcement is on.
UPDATE public.app_config
   SET value = 'on'
 WHERE key = 'media_validation_enforcement';

-- Server-authoritative pitch_content verdict for the exact text the dater
-- submits. Hash formula is byte-identical to 0026's trigger and the
-- /api/moderate-text route: raw (non-btrimmed) headline + E'\n\n' + body.
INSERT INTO public.text_moderations (scope, content_hash, moderation_status)
VALUES (
  'pitch_content',
  encode(digest(
    'Blair approved headline' || E'\n\n' || 'Blair approved body.',
    'sha256'
  ), 'hex'),
  'passed'
)
ON CONFLICT (scope, content_hash) DO NOTHING;

-- ── Draft 1: enforcement-on gate coverage ────────────────────────────
INSERT INTO public.pitch_drafts (
  id, created_by_user_id, subject_user_id, status, headline, body, transcript
) VALUES (
  'c0400000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002',
  'consent_pending',
  'Introducer headline',
  'Introducer body that the dater will rewrite.',
  '{"text": "Blair is the kindest person I know.", "segments": []}'::JSONB
);

INSERT INTO public.pitch_assets (
  id, pitch_draft_id, uploaded_by_user_id, asset_type, storage_path, sort_order
) VALUES
  (
    'c0400000-0000-0000-0000-000000000201',
    'c0400000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    'voice',
    'pitch-media/c0400000-0000-0000-0000-000000000001/voice.m4a',
    0
  ),
  (
    'c0400000-0000-0000-0000-000000000202',
    'c0400000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    'photo',
    'pitch-media/c0400000-0000-0000-0000-000000000001/photo-1.jpg',
    1
  ),
  (
    'c0400000-0000-0000-0000-000000000203',
    'c0400000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    'photo',
    'pitch-media/c0400000-0000-0000-0000-000000000001/photo-2.jpg',
    2
  ),
  (
    'c0400000-0000-0000-0000-000000000204',
    'c0400000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    'photo',
    'pitch-media/c0400000-0000-0000-0000-000000000001/photo-3.jpg',
    3
  );

-- photo-1 fully passes; photo-2 is flagged; photo-3 has no validation row.
INSERT INTO public.media_validations (
  bucket_id, object_name, validated_at,
  mime_ok, magic_ok, size_ok, decode_ok, moderation_status, moderation_ref
) VALUES
  (
    'pitch-media',
    'c0400000-0000-0000-0000-000000000001/photo-1.jpg',
    now(), true, true, true, true, 'passed', 'c04-photo-1'
  ),
  (
    'pitch-media',
    'c0400000-0000-0000-0000-000000000001/photo-2.jpg',
    now(), true, true, true, true, 'flagged', 'c04-photo-2'
  );

INSERT INTO public.consent_revisions (
  id, pitch_draft_id, revision_number, headline, body, structure,
  asset_ids, voice_asset_path, content_hash
) VALUES (
  'c0400000-0000-0000-0000-000000000301',
  'c0400000-0000-0000-0000-000000000001',
  1,
  'Introducer headline',
  'Introducer body that the dater will rewrite.',
  NULL,
  ARRAY[
    'c0400000-0000-0000-0000-000000000201',
    'c0400000-0000-0000-0000-000000000202',
    'c0400000-0000-0000-0000-000000000203',
    'c0400000-0000-0000-0000-000000000204'
  ]::UUID[],
  'pitch-media/c0400000-0000-0000-0000-000000000001/voice.m4a',
  'c04-fixture-hash-1'
);

INSERT INTO public.consent_requests (
  id, pitch_draft_id, subject_user_id, token_hash, status, revision_id,
  invite_contact_channel, invite_contact_hash
) VALUES (
  'c0400000-0000-0000-0000-000000000401',
  'c0400000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002',
  encode(digest('c04-consent-token', 'sha256'), 'hex'),
  'claimed',
  'c0400000-0000-0000-0000-000000000301',
  'email',
  encode(digest('c04-dater@example.test', 'sha256'), 'hex')
);

DO $$
DECLARE
  failures TEXT[] := ARRAY[]::TEXT[];
  ok BOOLEAN;
  reported TEXT;
  v_granted BOOLEAN;
  rev TEXT;
  draft CONSTANT UUID := 'c0400000-0000-0000-0000-000000000001';
  rev1 CONSTANT UUID := 'c0400000-0000-0000-0000-000000000301';
  dater CONSTANT UUID := '00000000-0000-0000-0000-000000000002';
  photo_ok CONSTANT UUID := 'c0400000-0000-0000-0000-000000000202';
  photo_flagged CONSTANT UUID := 'c0400000-0000-0000-0000-000000000203';
  photo_unvalidated CONSTANT UUID := 'c0400000-0000-0000-0000-000000000204';
  rev2 UUID;
  edited BOOLEAN;
  slug TEXT;
  published_transcript JSONB;
  revision_transcript JSONB;
  draft_status TEXT;
BEGIN
  rev := (SELECT value FROM public.app_config WHERE key = 'ai_disclosure_current_revision');
  IF rev IS NULL THEN
    RAISE EXCEPTION 'AUDIT3-DATER: ai_disclosure_current_revision is not configured';
  END IF;

  -- Act as the claimed dater (subject) for every RPC that reads auth.uid().
  PERFORM set_config('request.jwt.claim.sub', dater::text, true);

  -- ── (A) Dater records their own draft-scoped consent; a service reserve
  --        for the dater's media validation is then granted. ────────────
  PERFORM public.record_ai_processing_consent(draft, rev);
  SELECT granted INTO v_granted
    FROM public.reserve_provider_usage(dater, 'media_validate', 'c04-reserve', 5, draft);
  IF v_granted IS NOT TRUE THEN
    failures := array_append(failures,
      'dater consent + service reserve (draft-scope, subject) was not granted');
  END IF;

  -- ── (B) create_dater_revision photo gate ─────────────────────────────
  -- Unvalidated photo (no media_validations row) is rejected.
  ok := false; reported := NULL;
  BEGIN
    PERFORM * FROM public.create_dater_revision(
      draft, 'Blair approved headline', 'Blair approved body.',
      ARRAY[photo_unvalidated]
    );
  EXCEPTION WHEN OTHERS THEN ok := true; reported := SQLERRM;
  END;
  IF NOT ok THEN
    failures := array_append(failures, 'unvalidated photo entered a dater revision');
  ELSIF reported NOT LIKE '%photos must pass validation%' THEN
    failures := array_append(failures, 'unvalidated-photo reject wrong reason: ' || reported);
  END IF;

  -- Flagged photo is rejected.
  ok := false; reported := NULL;
  BEGIN
    PERFORM * FROM public.create_dater_revision(
      draft, 'Blair approved headline', 'Blair approved body.',
      ARRAY[photo_flagged]
    );
  EXCEPTION WHEN OTHERS THEN ok := true; reported := SQLERRM;
  END;
  IF NOT ok THEN
    failures := array_append(failures, 'flagged photo entered a dater revision');
  ELSIF reported NOT LIKE '%photos must pass validation%' THEN
    failures := array_append(failures, 'flagged-photo reject wrong reason: ' || reported);
  END IF;

  -- ── (C) create_dater_revision text gate ──────────────────────────────
  -- Validated photo but no passed verdict for this exact text → rejected.
  ok := false; reported := NULL;
  BEGIN
    PERFORM * FROM public.create_dater_revision(
      draft, 'Blair edited again', 'New claims added.',
      ARRAY[photo_ok]
    );
  EXCEPTION WHEN OTHERS THEN ok := true; reported := SQLERRM;
  END;
  IF NOT ok THEN
    failures := array_append(failures, 'unmoderated pitch text entered a dater revision');
  ELSIF reported NOT LIKE '%pitch text requires a passed moderation verdict%' THEN
    failures := array_append(failures, 'unmoderated-text reject wrong reason: ' || reported);
  END IF;

  -- ── (D) approve_and_publish_pitch photo re-check (defense in depth) ───
  -- rev1 (old-path revision) still carries the unvalidated photo. A direct
  -- approve that includes it must be rejected under enforcement.
  ok := false; reported := NULL;
  BEGIN
    PERFORM * FROM public.approve_and_publish_pitch(
      draft, 14, rev1, ARRAY[photo_unvalidated], true
    );
  EXCEPTION WHEN OTHERS THEN ok := true; reported := SQLERRM;
  END;
  IF NOT ok THEN
    failures := array_append(failures, 'publish accepted an unvalidated photo');
  ELSIF reported NOT LIKE '%included photos must pass validation before publish%' THEN
    failures := array_append(failures, 'publish-photo reject wrong reason: ' || reported);
  END IF;

  -- ── (E) Full-pass revision succeeds and records dater_edited=true ─────
  SELECT revision_id INTO rev2
    FROM public.create_dater_revision(
      draft, 'Blair approved headline', 'Blair approved body.',
      ARRAY[photo_ok]
    );
  IF rev2 IS NULL THEN
    failures := array_append(failures, 'a fully validated+moderated revision was rejected');
  ELSE
    SELECT dater_edited INTO edited
      FROM public.consent_revisions WHERE id = rev2;
    IF edited IS NOT TRUE THEN
      failures := array_append(failures,
        'dater_edited was not set when the dater rewrote the copy');
    END IF;
  END IF;

  -- ── (F) A passed verdict does not license a different text ────────────
  -- Same validated photo, but the headline no longer matches the verdict.
  ok := false; reported := NULL;
  BEGIN
    PERFORM * FROM public.create_dater_revision(
      draft, 'Blair approved headline EDITED', 'Blair approved body.',
      ARRAY[photo_ok]
    );
  EXCEPTION WHEN OTHERS THEN ok := true; reported := SQLERRM;
  END;
  IF NOT ok THEN
    failures := array_append(failures, 'edited text reused a stale moderation verdict');
  ELSIF reported NOT LIKE '%pitch text requires a passed moderation verdict%' THEN
    failures := array_append(failures, 'text-hash-mismatch reject wrong reason: ' || reported);
  END IF;

  -- ── (G) dater_edited revision requires hard-claim confirmation ───────
  ok := false; reported := NULL;
  BEGIN
    PERFORM * FROM public.approve_and_publish_pitch(
      draft, 14, rev2, ARRAY[photo_ok], false
    );
  EXCEPTION WHEN OTHERS THEN ok := true; reported := SQLERRM;
  END;
  IF NOT ok THEN
    failures := array_append(failures,
      'a dater-edited revision published without hard-claim confirmation');
  ELSIF reported NOT LIKE '%hard claims require confirmation%' THEN
    failures := array_append(failures, 'dater-edit confirm reject wrong reason: ' || reported);
  END IF;

  -- ── (H) Confirmed approve publishes and snapshots the transcript ─────
  SELECT campaign_slug INTO slug
    FROM public.approve_and_publish_pitch(
      draft, 14, rev2, ARRAY[photo_ok], true
    );
  IF slug IS NULL THEN
    failures := array_append(failures, 'confirmed approve returned no slug');
  END IF;

  SELECT transcript, status INTO published_transcript, draft_status
    FROM public.pitch_drafts WHERE id = draft;
  SELECT transcript INTO revision_transcript
    FROM public.consent_revisions WHERE id = rev2;
  IF draft_status IS DISTINCT FROM 'published' THEN
    failures := array_append(failures, 'draft was not marked published');
  END IF;
  IF published_transcript IS DISTINCT FROM revision_transcript THEN
    failures := array_append(failures,
      'published draft transcript is not the approved revision snapshot');
  END IF;

  IF cardinality(failures) > 0 THEN
    RAISE EXCEPTION 'AUDIT3-DATER: %', array_to_string(failures, '; ');
  END IF;
END;
$$;

-- ── Transcript snapshot copy is flag-independent (enforcement off) ────
UPDATE public.app_config
   SET value = 'off'
 WHERE key = 'media_validation_enforcement';

INSERT INTO public.pitch_drafts (
  id, created_by_user_id, subject_user_id, status, headline, body, transcript
) VALUES (
  'c0400000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002',
  'consent_pending',
  'Introducer headline two',
  'Introducer body two that the dater will rewrite.',
  '{"text": "Second transcript to snapshot.", "segments": []}'::JSONB
);

INSERT INTO public.pitch_assets (
  id, pitch_draft_id, uploaded_by_user_id, asset_type, storage_path, sort_order
) VALUES (
  'c0400000-0000-0000-0000-000000000212',
  'c0400000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000001',
  'photo',
  'pitch-media/c0400000-0000-0000-0000-000000000002/photo-1.jpg',
  0
);

INSERT INTO public.consent_revisions (
  id, pitch_draft_id, revision_number, headline, body, structure,
  asset_ids, voice_asset_path, content_hash
) VALUES (
  'c0400000-0000-0000-0000-000000000311',
  'c0400000-0000-0000-0000-000000000002',
  1,
  'Introducer headline two',
  'Introducer body two that the dater will rewrite.',
  NULL,
  ARRAY['c0400000-0000-0000-0000-000000000212']::UUID[],
  NULL,
  'c04-fixture-hash-2'
);

INSERT INTO public.consent_requests (
  id, pitch_draft_id, subject_user_id, token_hash, status, revision_id,
  invite_contact_channel, invite_contact_hash
) VALUES (
  'c0400000-0000-0000-0000-000000000411',
  'c0400000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000002',
  encode(digest('c04-consent-token-2', 'sha256'), 'hex'),
  'claimed',
  'c0400000-0000-0000-0000-000000000311',
  'email',
  encode(digest('c04-dater2@example.test', 'sha256'), 'hex')
);

DO $$
DECLARE
  failures TEXT[] := ARRAY[]::TEXT[];
  draft CONSTANT UUID := 'c0400000-0000-0000-0000-000000000002';
  dater CONSTANT UUID := '00000000-0000-0000-0000-000000000002';
  photo2 CONSTANT UUID := 'c0400000-0000-0000-0000-000000000212';
  rev2b UUID;
  slug TEXT;
  published_transcript JSONB;
  revision_transcript JSONB;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', dater::text, true);

  -- Enforcement off: no photo/text verdict is required to cut the revision.
  SELECT revision_id INTO rev2b
    FROM public.create_dater_revision(
      draft, 'Second approved headline', 'Second approved body.',
      ARRAY[photo2]
    );
  IF rev2b IS NULL THEN
    failures := array_append(failures, 'enforcement-off revision was rejected');
  END IF;

  -- dater_edited is flag-independent, so confirmation is still required.
  SELECT campaign_slug INTO slug
    FROM public.approve_and_publish_pitch(
      draft, 14, rev2b, ARRAY[photo2], true
    );
  IF slug IS NULL THEN
    failures := array_append(failures, 'enforcement-off approve returned no slug');
  END IF;

  SELECT transcript INTO published_transcript
    FROM public.pitch_drafts WHERE id = draft;
  SELECT transcript INTO revision_transcript
    FROM public.consent_revisions WHERE id = rev2b;
  IF published_transcript IS DISTINCT FROM revision_transcript THEN
    failures := array_append(failures,
      'transcript snapshot copy did not run with enforcement off');
  END IF;

  IF cardinality(failures) > 0 THEN
    RAISE EXCEPTION 'AUDIT3-DATER: %', array_to_string(failures, '; ');
  END IF;
END;
$$;

ROLLBACK;

SELECT 'c04_dater_validation.sql passed' AS result;
