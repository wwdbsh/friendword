-- AUDIT3 REGRESSION: 3차 감사 §3 P0-NEW-2 — 외부 AI 처리 동의는 서버가 관리하는
-- 현재 disclosure revision에 bind되어야 하고, 임의 문자열·구 revision 동의는
-- 처리를 허가하지 못하며, 동의 게이트는 draft-scoped와 own-content 모든 kind에
-- 적용된다. (Slice 1, migration 0035로 그린 전환)
--
-- red-first: 0035 이전에는 record_ai_processing_consent가 임의 revision을
-- 받아들이고 reserve 동의 게이트가 ('transcribe','structure')에만 걸리므로,
-- 아래 revision-binding 검사가 그대로 RED로 드러난다.
BEGIN;

-- draft 10000000-...-0002는 user 0004가 생성한 'draft' 상태 pitch_draft (seed.sql).
DO $$
DECLARE
  u4 CONSTANT UUID := '00000000-0000-0000-0000-000000000004';
  draft CONSTANT UUID := '10000000-0000-0000-0000-000000000002';
  rev TEXT;
  reported TEXT;
  v_granted BOOLEAN;
  ok BOOLEAN;
BEGIN
  rev := (SELECT value FROM public.app_config WHERE key = 'ai_disclosure_current_revision');
  IF rev IS NULL THEN
    RAISE EXCEPTION 'AUDIT3-CONSENT: ai_disclosure_current_revision is not configured';
  END IF;

  -- get_ai_disclosure_revision() reflects the app_config value verbatim.
  reported := public.get_ai_disclosure_revision();
  IF reported IS DISTINCT FROM rev THEN
    RAISE EXCEPTION 'AUDIT3-CONSENT: get_ai_disclosure_revision() (%) != app_config (%)',
      reported, rev;
  END IF;

  -- (1) recording consent with a non-current revision string is rejected.
  PERFORM set_config('request.jwt.claim.sub', u4::text, true);
  ok := false;
  BEGIN
    PERFORM public.record_ai_processing_consent(draft, 'audit3-not-the-current-revision');
  EXCEPTION WHEN OTHERS THEN ok := true;
  END;
  IF NOT ok THEN
    RAISE EXCEPTION 'AUDIT3-CONSENT: an arbitrary (non-current) revision was accepted';
  END IF;

  -- (2) only a stale-revision consent exists → a draft-scoped reservation is
  -- still blocked, and the error names the consent requirement.
  INSERT INTO public.ai_processing_consents
    (user_id, pitch_draft_id, consent_revision, scope_kind)
  VALUES (u4, draft, 'audit3-stale-revision', 'pitch_draft');
  reported := NULL;
  BEGIN
    PERFORM public.reserve_provider_usage(u4, 'transcribe', 'c03-stale', 10, draft);
    RAISE EXCEPTION 'AUDIT3-CONSENT: transcribe reserved with only a stale-revision consent';
  EXCEPTION WHEN OTHERS THEN
    reported := SQLERRM;
  END;
  IF reported NOT LIKE '%external AI processing consent is required%' THEN
    RAISE EXCEPTION 'AUDIT3-CONSENT: stale-consent reserve failed for the wrong reason: %', reported;
  END IF;

  -- (3) after recording current-revision consent, the reservation succeeds.
  PERFORM public.record_ai_processing_consent(draft, rev);
  SELECT granted INTO v_granted
    FROM public.reserve_provider_usage(u4, 'transcribe', 'c03-current', 10, draft);
  IF NOT v_granted THEN
    RAISE EXCEPTION 'AUDIT3-CONSENT: transcribe was not reserved after current-revision consent';
  END IF;

  -- (4) own-content path: user 0004 has NO own-content consent yet, so a
  -- scope-less media_validate reservation is blocked; recording own-content
  -- consent then unblocks it.
  reported := NULL;
  BEGIN
    PERFORM public.reserve_provider_usage(u4, 'media_validate', 'c03-own-nocon', 5, NULL);
    RAISE EXCEPTION 'AUDIT3-CONSENT: own-content reservation succeeded without consent';
  EXCEPTION WHEN OTHERS THEN
    reported := SQLERRM;
  END;
  IF reported NOT LIKE '%external AI processing consent is required%' THEN
    RAISE EXCEPTION 'AUDIT3-CONSENT: own-content no-consent reserve failed for the wrong reason: %', reported;
  END IF;

  PERFORM public.record_own_content_ai_consent(rev);
  SELECT granted INTO v_granted
    FROM public.reserve_provider_usage(u4, 'media_validate', 'c03-own-con', 5, NULL);
  IF NOT v_granted THEN
    RAISE EXCEPTION 'AUDIT3-CONSENT: own-content reservation blocked after recording consent';
  END IF;
END;
$$;

ROLLBACK;

SELECT 'c03_ai_consent_binding.sql passed' AS result;
