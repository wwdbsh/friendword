-- AUDIT3 REGRESSION: 3차 감사 §3 P0-NEW-1 — provider 비용 원장은 service_role
-- 전용이어야 하고, request_ref마다 lease/owner/attempt 상태로 정확히 하나의
-- attempt만 provider를 호출하며, 실패/timeout는 estimate를 cap에 보수적으로
-- 남기고, estimated_cents=0·cap 초과·kill switch·lease 불일치를 fail-closed로
-- 막아야 한다. (Slice 1, migration 0035로 그린 전환)
--
-- red-first: 첫 블록은 "일반 role이 원장 RPC를 직접 실행할 수 있는가"라는 권한
-- 결함을 먼저 검사한다. 0035 이전(0031 계약)에는 reserve/reconcile가
-- authenticated에 GRANT되어 있어 이 블록이 그대로 RED로 드러난다.
BEGIN;

-- ── 1. 원장 RPC는 어떤 non-service role에도 EXECUTE가 없어야 한다 ──────
-- 0031은 reserve/reconcile를 authenticated에 grant했다. 그 결함이 여기서
-- 곧바로 붉게 보인다.
DO $$
DECLARE
  bad TEXT[] := ARRAY[]::TEXT[];
  p RECORD;
BEGIN
  FOR p IN
    SELECT oid, (oid::regprocedure)::text AS sig
      FROM pg_proc
     WHERE pronamespace = 'public'::regnamespace
       AND proname IN ('reserve_provider_usage', 'reconcile_provider_usage')
  LOOP
    IF has_function_privilege('authenticated', p.oid, 'EXECUTE') THEN
      bad := array_append(bad, 'authenticated:' || p.sig);
    END IF;
    IF has_function_privilege('anon', p.oid, 'EXECUTE') THEN
      bad := array_append(bad, 'anon:' || p.sig);
    END IF;
  END LOOP;
  IF cardinality(bad) > 0 THEN
    RAISE EXCEPTION 'AUDIT3-LEDGER: non-service role can execute the provider ledger RPC: %',
      array_to_string(bad, ', ');
  END IF;
END;
$$;

-- ── 2. 구 시그니처는 사라지고 새 service-only 시그니처만 존재한다 ─────
DO $$
BEGIN
  IF to_regprocedure('public.reserve_provider_usage(text,text,integer,uuid)') IS NOT NULL
     OR to_regprocedure('public.reserve_provider_usage(text,text,integer)') IS NOT NULL THEN
    RAISE EXCEPTION 'AUDIT3-LEDGER: legacy reserve_provider_usage signature still present';
  END IF;
  IF to_regprocedure('public.reconcile_provider_usage(uuid,integer,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'AUDIT3-LEDGER: legacy reconcile_provider_usage signature still present';
  END IF;
  IF to_regprocedure('public.reserve_provider_usage(uuid,text,text,integer,uuid)') IS NULL THEN
    RAISE EXCEPTION 'AUDIT3-LEDGER: service-only reserve_provider_usage signature missing';
  END IF;
  IF to_regprocedure('public.reconcile_provider_usage(uuid,uuid,integer,text)') IS NULL THEN
    RAISE EXCEPTION 'AUDIT3-LEDGER: service-only reconcile_provider_usage signature missing';
  END IF;
END;
$$;

-- ── 3. authenticated의 직접 호출은 permission denied ─────────────────
SET ROLE authenticated;
DO $$
BEGIN
  BEGIN
    PERFORM public.reserve_provider_usage(
      '00000000-0000-0000-0000-000000000004'::uuid,
      'media_validate', 'c02-authz-reserve', 5, NULL
    );
    RAISE EXCEPTION 'AUDIT3-LEDGER: authenticated executed reserve_provider_usage';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL; -- expected: EXECUTE is service-only
    WHEN undefined_function THEN
      RAISE EXCEPTION 'AUDIT3-LEDGER: service-only reserve_provider_usage not resolvable';
  END;

  BEGIN
    PERFORM public.reconcile_provider_usage(
      gen_random_uuid(), gen_random_uuid(), 1, 'succeeded'
    );
    RAISE EXCEPTION 'AUDIT3-LEDGER: authenticated executed reconcile_provider_usage';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL; -- expected
    WHEN undefined_function THEN
      RAISE EXCEPTION 'AUDIT3-LEDGER: service-only reconcile_provider_usage not resolvable';
  END;
END;
$$;
RESET ROLE;

-- ── 4. service-role 경로 동작 (기본 superuser 연결 = service 권한) ────
DO $$
DECLARE
  u4 CONSTANT UUID := '00000000-0000-0000-0000-000000000004';
  rev TEXT;
  v_res UUID;
  v_lease UUID;
  v_granted BOOLEAN;
  v_res2 UUID;
  v_lease2 UUID;
  v_granted2 BOOLEAN;
  v_prior2 TEXT;
  v_spent BIGINT;
  ok BOOLEAN;
BEGIN
  rev := (SELECT value FROM public.app_config WHERE key = 'ai_disclosure_current_revision');

  -- own-content consent so media_validate (scope NULL) reservations clear
  -- the consent gate. record_* is authenticated-facing → set the jwt sub.
  PERFORM set_config('request.jwt.claim.sub', u4::text, true);
  PERFORM public.record_own_content_ai_consent(rev);

  -- (a) estimated_cents = 0 is rejected (no zero-cost reservations).
  ok := false;
  BEGIN
    PERFORM public.reserve_provider_usage(u4, 'media_validate', 'c02-zero', 0, NULL);
  EXCEPTION WHEN OTHERS THEN ok := true;
  END;
  IF NOT ok THEN
    RAISE EXCEPTION 'AUDIT3-LEDGER: estimated_cents=0 reservation was accepted';
  END IF;

  -- (b) first reserve grants a lease; a concurrent replay under an active
  -- lease is refused the call right and returns the same reservation.
  SELECT reservation_id, lease_token, granted
    INTO v_res, v_lease, v_granted
    FROM public.reserve_provider_usage(u4, 'media_validate', 'c02-replay', 10, NULL);
  IF NOT v_granted OR v_res IS NULL OR v_lease IS NULL THEN
    RAISE EXCEPTION 'AUDIT3-LEDGER: first reservation was not granted a lease';
  END IF;

  SELECT reservation_id, granted, prior_status
    INTO v_res2, v_granted2, v_prior2
    FROM public.reserve_provider_usage(u4, 'media_validate', 'c02-replay', 10, NULL);
  IF v_granted2 THEN
    RAISE EXCEPTION 'AUDIT3-LEDGER: active-lease replay was granted a second call';
  END IF;
  IF v_res2 IS DISTINCT FROM v_res THEN
    RAISE EXCEPTION 'AUDIT3-LEDGER: replay returned a different reservation id';
  END IF;
  IF v_prior2 IS DISTINCT FROM 'reserved' THEN
    RAISE EXCEPTION 'AUDIT3-LEDGER: active-lease replay prior_status was not reserved';
  END IF;

  -- (c) after success, replays never re-arm and never re-call the provider.
  PERFORM public.reconcile_provider_usage(v_res, v_lease, 8, 'succeeded');
  SELECT granted, prior_status
    INTO v_granted2, v_prior2
    FROM public.reserve_provider_usage(u4, 'media_validate', 'c02-replay', 10, NULL);
  IF v_granted2 THEN
    RAISE EXCEPTION 'AUDIT3-LEDGER: succeeded replay was granted a re-call';
  END IF;
  IF v_prior2 IS DISTINCT FROM 'succeeded' THEN
    RAISE EXCEPTION 'AUDIT3-LEDGER: succeeded replay prior_status was not succeeded';
  END IF;

  -- (d) a crashed/expired lease is re-armed on the next reserve.
  SELECT reservation_id, lease_token
    INTO v_res, v_lease
    FROM public.reserve_provider_usage(u4, 'media_validate', 'c02-rearm', 10, NULL);
  UPDATE public.provider_usage_events
     SET lease_expires_at = now() - INTERVAL '1 minute'
   WHERE id = v_res;
  SELECT reservation_id, granted, prior_status, lease_token
    INTO v_res2, v_granted2, v_prior2, v_lease2
    FROM public.reserve_provider_usage(u4, 'media_validate', 'c02-rearm', 10, NULL);
  IF NOT v_granted2 THEN
    RAISE EXCEPTION 'AUDIT3-LEDGER: an expired lease was not re-armed';
  END IF;
  IF v_res2 IS DISTINCT FROM v_res THEN
    RAISE EXCEPTION 'AUDIT3-LEDGER: re-arm changed the reservation id';
  END IF;
  IF v_prior2 IS DISTINCT FROM 'reserved' THEN
    RAISE EXCEPTION 'AUDIT3-LEDGER: re-arm prior_status was not reserved';
  END IF;
  IF v_lease2 IS NULL OR v_lease2 = v_lease THEN
    RAISE EXCEPTION 'AUDIT3-LEDGER: re-arm did not issue a fresh lease token';
  END IF;
  IF (SELECT attempt_count FROM public.provider_usage_events WHERE id = v_res) <> 2 THEN
    RAISE EXCEPTION 'AUDIT3-LEDGER: re-arm did not bump attempt_count';
  END IF;

  -- (e) a reconcile with a mismatched lease token is rejected (a stale
  -- attempt cannot overwrite the winner).
  ok := false;
  BEGIN
    PERFORM public.reconcile_provider_usage(v_res, gen_random_uuid(), 5, 'succeeded');
  EXCEPTION WHEN OTHERS THEN ok := true;
  END;
  IF NOT ok THEN
    RAISE EXCEPTION 'AUDIT3-LEDGER: reconcile accepted a mismatched lease token';
  END IF;

  -- (f) conservative accounting: a failed reconcile keeps the estimate on
  -- the cap even when the route reports actual_cents = 0.
  SELECT reservation_id, lease_token
    INTO v_res, v_lease
    FROM public.reserve_provider_usage(u4, 'media_validate', 'c02-failed', 20, NULL);
  PERFORM public.reconcile_provider_usage(v_res, v_lease, 0, 'failed');
  IF (SELECT actual_cents FROM public.provider_usage_events WHERE id = v_res) <> 20 THEN
    RAISE EXCEPTION 'AUDIT3-LEDGER: failed reconcile did not keep the estimate on the cap';
  END IF;
  IF (SELECT status FROM public.provider_usage_events WHERE id = v_res) <> 'failed' THEN
    RAISE EXCEPTION 'AUDIT3-LEDGER: failed reconcile did not set status=failed';
  END IF;

  -- (g) cap boundary: with the cap set just at current spend + one more
  -- reservation, the next cent over the cap is refused.
  SELECT coalesce(sum(coalesce(actual_cents, estimated_cents, 0)), 0)
    INTO v_spent
    FROM public.provider_usage_events
   WHERE created_at >= date_trunc('month', now())
     AND status <> 'released';
  UPDATE public.app_config
     SET value = (v_spent + 20)::text
   WHERE key = 'provider_monthly_cap_cents';
  SELECT granted INTO v_granted
    FROM public.reserve_provider_usage(u4, 'media_validate', 'c02-cap-fill', 20, NULL);
  IF NOT v_granted THEN
    RAISE EXCEPTION 'AUDIT3-LEDGER: a reservation exactly at the cap was refused';
  END IF;
  ok := false;
  BEGIN
    PERFORM public.reserve_provider_usage(u4, 'media_validate', 'c02-cap-over', 1, NULL);
  EXCEPTION WHEN OTHERS THEN ok := true;
  END;
  IF NOT ok THEN
    RAISE EXCEPTION 'AUDIT3-LEDGER: a reservation over the monthly cap was accepted';
  END IF;
  UPDATE public.app_config SET value = '20000' WHERE key = 'provider_monthly_cap_cents';

  -- (h) kill switch fails closed before any provider byte is planned.
  UPDATE public.app_config SET value = 'on' WHERE key = 'provider_kill_switch';
  ok := false;
  BEGIN
    PERFORM public.reserve_provider_usage(u4, 'media_validate', 'c02-kill', 5, NULL);
  EXCEPTION WHEN OTHERS THEN ok := true;
  END;
  IF NOT ok THEN
    RAISE EXCEPTION 'AUDIT3-LEDGER: kill switch allowed a reservation';
  END IF;
  UPDATE public.app_config SET value = 'off' WHERE key = 'provider_kill_switch';
END;
$$;

ROLLBACK;

SELECT 'c02_provider_ledger.sql passed' AS result;
