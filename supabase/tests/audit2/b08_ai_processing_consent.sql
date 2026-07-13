-- AUDIT2 REGRESSION: P0-10, 감사 §3 외부 AI 처리 affirmative consent.
BEGIN;

DO $$
BEGIN
  IF to_regclass('public.ai_processing_consents') IS NULL THEN
    RAISE EXCEPTION 'AUDIT2-P0-10: ai_processing_consents table missing';
  END IF;
  IF to_regprocedure('public.record_ai_processing_consent(uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'AUDIT2-P0-10: record_ai_processing_consent(uuid,text) RPC missing';
  END IF;
  IF to_regprocedure('public.reserve_provider_usage(text,text,integer,uuid)') IS NULL THEN
    RAISE EXCEPTION 'AUDIT2-P0-10: draft-scoped reserve_provider_usage RPC missing';
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
  rejected BOOLEAN;
  reservation_id UUID;
BEGIN
  PERFORM set_config(
    'request.jwt.claim.sub',
    '00000000-0000-0000-0000-000000000004',
    true
  );
  rejected := false;
  BEGIN
    PERFORM public.reserve_provider_usage(
      'transcribe',
      'audit2-no-ai-consent',
      10,
      '10000000-0000-0000-0000-000000000002'
    );
  EXCEPTION WHEN OTHERS THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'AUDIT2-P0-10: provider usage reserved before AI consent';
  END IF;

  PERFORM set_config(
    'request.jwt.claim.sub',
    '00000000-0000-0000-0000-000000000003',
    true
  );
  rejected := false;
  BEGIN
    PERFORM public.record_ai_processing_consent(
      '10000000-0000-0000-0000-000000000002',
      'audit2-ai-consent-v1'
    );
  EXCEPTION WHEN OTHERS THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'AUDIT2-P0-10: non-owner recorded AI consent';
  END IF;

  PERFORM set_config(
    'request.jwt.claim.sub',
    '00000000-0000-0000-0000-000000000004',
    true
  );
  PERFORM public.record_ai_processing_consent(
    '10000000-0000-0000-0000-000000000002',
    'audit2-ai-consent-v1'
  );
  IF NOT EXISTS (
    SELECT 1
      FROM public.ai_processing_consents
     WHERE user_id = '00000000-0000-0000-0000-000000000004'
       AND pitch_draft_id = '10000000-0000-0000-0000-000000000002'
       AND consent_revision = 'audit2-ai-consent-v1'
       AND consented_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'AUDIT2-P0-10: consent revision/timestamp was not recorded';
  END IF;

  reservation_id := public.reserve_provider_usage(
    'transcribe',
    'audit2-with-ai-consent',
    10,
    '10000000-0000-0000-0000-000000000002'
  );
  IF reservation_id IS NULL THEN
    RAISE EXCEPTION 'AUDIT2-P0-10: consented provider usage was not reserved';
  END IF;
END;
$$;

ROLLBACK;

SELECT 'b08_ai_processing_consent.sql passed' AS result;
