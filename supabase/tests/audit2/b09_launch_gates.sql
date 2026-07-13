-- AUDIT2 REGRESSION: Slice 0, 감사 §7 "P0가 해결되기 전 real payments/public beta를 feature flag로 차단한다".
-- 이 파일은 Slice 0 배포 직후부터 PASS여야 한다 (다른 b* 파일과 달리 초기 그린).
BEGIN;

DO $$
BEGIN
  IF to_regprocedure('private.real_payments_enabled()') IS NULL THEN
    RAISE EXCEPTION 'AUDIT2-GATE: private.real_payments_enabled() is missing';
  END IF;
  IF to_regprocedure('private.public_beta_enabled()') IS NULL THEN
    RAISE EXCEPTION 'AUDIT2-GATE: private.public_beta_enabled() is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM app_config WHERE key = 'real_payments_enabled') THEN
    RAISE EXCEPTION 'AUDIT2-GATE: real_payments_enabled config row is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM app_config WHERE key = 'public_beta_enabled') THEN
    RAISE EXCEPTION 'AUDIT2-GATE: public_beta_enabled config row is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'purchase_intents_launch_gate'
  ) THEN
    RAISE EXCEPTION 'AUDIT2-GATE: purchase_intents_launch_gate trigger is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'purchase_events_production_gate'
  ) THEN
    RAISE EXCEPTION 'AUDIT2-GATE: purchase_events_production_gate trigger is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'interests_launch_gate'
  ) THEN
    RAISE EXCEPTION 'AUDIT2-GATE: interests_launch_gate trigger is missing';
  END IF;
END;
$$;

-- Close both gates (seed.sql opened them for the other local suites).
UPDATE app_config SET value = 'off'
 WHERE key IN ('real_payments_enabled', 'public_beta_enabled');

-- 1. Purchases cannot even start: intent inserts are blocked.
DO $$
DECLARE
  blocked BOOLEAN := false;
BEGIN
  BEGIN
    INSERT INTO purchase_intents (user_id, product_id, scope_type, scope_id)
    VALUES (
      '00000000-0000-0000-0000-000000000004',
      'creator_launch_credit_499',
      'PITCH_DRAFT',
      '10000000-0000-0000-0000-000000000002'
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%not available yet%' THEN
      RAISE EXCEPTION 'AUDIT2-GATE: intent insert failed for the wrong reason: %', SQLERRM;
    END IF;
    blocked := true;
  END;
  IF NOT blocked THEN
    RAISE EXCEPTION 'AUDIT2-GATE: purchase intent was issued while real payments are off';
  END IF;
END;
$$;

-- 2. A PRODUCTION-store purchase event cannot be recorded while payments are off.
DO $$
DECLARE
  blocked BOOLEAN := false;
BEGIN
  BEGIN
    INSERT INTO purchase_events (
      purchaser_user_id,
      product_id,
      scope_type,
      scope_id,
      provider_event_id,
      purchased_at,
      event_type,
      environment,
      raw_app_user_id
    )
    VALUES (
      '00000000-0000-0000-0000-000000000004',
      'creator_launch_credit_499',
      'PITCH_DRAFT',
      '10000000-0000-0000-0000-000000000002',
      'audit2-gate-production-event',
      now(),
      'NON_RENEWING_PURCHASE',
      'PRODUCTION',
      '00000000-0000-0000-0000-000000000004'
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%real payments are disabled%' THEN
      RAISE EXCEPTION 'AUDIT2-GATE: production event failed for the wrong reason: %', SQLERRM;
    END IF;
    blocked := true;
  END;
  IF NOT blocked THEN
    RAISE EXCEPTION 'AUDIT2-GATE: PRODUCTION purchase event recorded while real payments are off';
  END IF;
END;
$$;

-- 3. Interest submission is closed during the private beta.
DO $$
DECLARE
  blocked BOOLEAN := false;
BEGIN
  BEGIN
    INSERT INTO interests (campaign_id, sender_user_id, status, note, submitted_at)
    VALUES (
      '20000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000004',
      'submitted',
      'Audit2 gate probe',
      now()
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%private beta%' THEN
      RAISE EXCEPTION 'AUDIT2-GATE: interest insert failed for the wrong reason: %', SQLERRM;
    END IF;
    blocked := true;
  END;
  IF NOT blocked THEN
    RAISE EXCEPTION 'AUDIT2-GATE: interest was accepted while the public beta gate is closed';
  END IF;
END;
$$;

-- 4. Opening the gates restores the flows (sandbox events stay allowed either way).
UPDATE app_config SET value = 'on'
 WHERE key IN ('real_payments_enabled', 'public_beta_enabled');

DO $$
BEGIN
  INSERT INTO purchase_intents (user_id, product_id, scope_type, scope_id)
  VALUES (
    '00000000-0000-0000-0000-000000000004',
    'creator_launch_credit_499',
    'PITCH_DRAFT',
    '10000000-0000-0000-0000-000000000002'
  );

  INSERT INTO interests (campaign_id, sender_user_id, status, note, submitted_at)
  VALUES (
    '20000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000004',
    'submitted',
    'Audit2 gate probe (open)',
    now()
  );
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'AUDIT2-GATE: open gates still blocked a flow: %', SQLERRM;
END;
$$;

-- 5. Sandbox purchase events are not blocked even while payments are off.
UPDATE app_config SET value = 'off' WHERE key = 'real_payments_enabled';

DO $$
BEGIN
  INSERT INTO purchase_events (
    purchaser_user_id,
    product_id,
    scope_type,
    scope_id,
    provider_event_id,
    purchased_at,
    event_type,
    environment,
    raw_app_user_id
  )
  VALUES (
    '00000000-0000-0000-0000-000000000004',
    'creator_launch_credit_499',
    'PITCH_DRAFT',
    '10000000-0000-0000-0000-000000000002',
    'audit2-gate-sandbox-event',
    now(),
    'NON_RENEWING_PURCHASE',
    'SANDBOX',
    '00000000-0000-0000-0000-000000000004'
  );
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'AUDIT2-GATE: sandbox event was blocked while payments are off: %', SQLERRM;
END;
$$;

ROLLBACK;
