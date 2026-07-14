-- AUDIT2 REGRESSION: P0-10, 감사 §3 외부 AI 처리 affirmative consent.
-- 2026-07-14 3차 감사 P0-NEW-1·2로 계약 갱신: reserve_provider_usage는 이제
-- service_role 전용(target_user_id 인자)이고, 동의는 서버의 현재 disclosure
-- revision에 bind된다. record_ai_processing_consent는 현재 revision만 받는다.
BEGIN;

DO $$
BEGIN
  IF to_regclass('public.ai_processing_consents') IS NULL THEN
    RAISE EXCEPTION 'AUDIT2-P0-10: ai_processing_consents table missing';
  END IF;
  IF to_regprocedure('public.record_ai_processing_consent(uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'AUDIT2-P0-10: record_ai_processing_consent(uuid,text) RPC missing';
  END IF;
  IF to_regprocedure('public.reserve_provider_usage(uuid,text,text,integer,uuid)') IS NULL THEN
    RAISE EXCEPTION 'AUDIT2-P0-10: service-only reserve_provider_usage RPC missing';
  END IF;
END;
$$;

INSERT INTO public.app_config (key, value)
VALUES
  ('provider_kill_switch', 'off'),
  ('provider_monthly_cap_cents', '1000')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

DO $$
DECLARE
  u4 CONSTANT UUID := '00000000-0000-0000-0000-000000000004';
  draft CONSTANT UUID := '10000000-0000-0000-0000-000000000002';
  rev TEXT;
  rejected BOOLEAN;
  v_granted BOOLEAN;
BEGIN
  rev := (SELECT value FROM public.app_config WHERE key = 'ai_disclosure_current_revision');

  -- No consent yet → a draft-scoped provider reservation is refused.
  rejected := false;
  BEGIN
    PERFORM public.reserve_provider_usage(u4, 'transcribe', 'audit2-no-ai-consent', 10, draft);
  EXCEPTION WHEN OTHERS THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'AUDIT2-P0-10: provider usage reserved before AI consent';
  END IF;

  -- A non-owner cannot record consent for someone else's draft.
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true);
  rejected := false;
  BEGIN
    PERFORM public.record_ai_processing_consent(draft, rev);
  EXCEPTION WHEN OTHERS THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'AUDIT2-P0-10: non-owner recorded AI consent';
  END IF;

  -- The owner records current-revision consent; the row is bound to that revision.
  PERFORM set_config('request.jwt.claim.sub', u4::text, true);
  PERFORM public.record_ai_processing_consent(draft, rev);
  IF NOT EXISTS (
    SELECT 1
      FROM public.ai_processing_consents
     WHERE user_id = u4
       AND pitch_draft_id = draft
       AND consent_revision = rev
       AND scope_kind = 'pitch_draft'
       AND consented_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'AUDIT2-P0-10: consent revision/timestamp was not recorded';
  END IF;

  -- With current-revision consent, the reservation is granted.
  SELECT granted INTO v_granted
    FROM public.reserve_provider_usage(u4, 'transcribe', 'audit2-with-ai-consent', 10, draft);
  IF NOT v_granted THEN
    RAISE EXCEPTION 'AUDIT2-P0-10: consented provider usage was not reserved';
  END IF;
END;
$$;

ROLLBACK;

SELECT 'b08_ai_processing_consent.sql passed' AS result;
