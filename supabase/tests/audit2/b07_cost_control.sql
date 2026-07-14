-- AUDIT2 REGRESSION: P0-9, 감사 §3 provider 비용 reserve/reconcile hard cap.
-- 2026-07-14 3차 감사 P0-NEW-1·2로 계약 갱신: reserve/reconcile는 이제
-- service_role 전용이고 target_user_id를 인자로 받으며, 모든 kind가 외부 AI
-- 동의 게이트를 통과해야 하고, reconcile은 lease_token을 요구한다. 이 스위트는
-- 기본 superuser 연결(= service 권한)로 새 시그니처를 호출한다.
BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.reserve_provider_usage(uuid,text,text,integer,uuid)') IS NULL THEN
    RAISE EXCEPTION 'AUDIT2-P0-9: service-only reserve_provider_usage RPC missing';
  END IF;
  IF to_regprocedure('public.reconcile_provider_usage(uuid,uuid,integer,text)') IS NULL THEN
    RAISE EXCEPTION 'AUDIT2-P0-9: service-only reconcile_provider_usage RPC missing';
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
  rev TEXT;
  first_reservation UUID;
  first_lease UUID;
  replay_reservation UUID;
  replay_granted BOOLEAN;
  cap_reservation UUID;
  cap_lease UUID;
  rejected BOOLEAN;
BEGIN
  rev := (SELECT value FROM public.app_config WHERE key = 'ai_disclosure_current_revision');

  -- media_validate is own-content scoped, so record own-content consent first.
  PERFORM set_config('request.jwt.claim.sub', u4::text, true);
  PERFORM public.record_own_content_ai_consent(rev);

  -- Idempotent replay: same request_ref keeps exactly one row and is refused
  -- a second live call while the lease is active.
  SELECT reservation_id, lease_token
    INTO first_reservation, first_lease
    FROM public.reserve_provider_usage(u4, 'media_validate', 'audit2-replay-request', 10, NULL);
  SELECT reservation_id, granted
    INTO replay_reservation, replay_granted
    FROM public.reserve_provider_usage(u4, 'media_validate', 'audit2-replay-request', 10, NULL);
  IF replay_reservation IS DISTINCT FROM first_reservation THEN
    RAISE EXCEPTION 'AUDIT2-P0-9: replay returned a second reservation';
  END IF;
  IF replay_granted THEN
    RAISE EXCEPTION 'AUDIT2-P0-9: active-lease replay was granted a second call';
  END IF;
  IF (SELECT count(*) FROM public.provider_usage_events
       WHERE id = first_reservation) <> 1 THEN
    RAISE EXCEPTION 'AUDIT2-P0-9: replay did not preserve exactly one usage row';
  END IF;

  -- Kill switch fails closed.
  UPDATE public.app_config SET value = 'on' WHERE key = 'provider_kill_switch';
  rejected := false;
  BEGIN
    PERFORM public.reserve_provider_usage(u4, 'media_validate', 'audit2-kill-switch', 1, NULL);
  EXCEPTION WHEN OTHERS THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'AUDIT2-P0-9: kill switch allowed a reservation';
  END IF;
  UPDATE public.app_config SET value = 'off' WHERE key = 'provider_kill_switch';

  -- Monthly hard cap. Estimates are bounded to 1..50, so fill with 50 then
  -- lower the cap to that spend and prove the next cent over is refused.
  SELECT reservation_id, lease_token
    INTO cap_reservation, cap_lease
    FROM public.reserve_provider_usage(u4, 'media_validate', 'audit2-cap-base', 50, NULL);
  PERFORM public.reconcile_provider_usage(cap_reservation, cap_lease, 50, 'succeeded');
  UPDATE public.app_config SET value = '50' WHERE key = 'provider_monthly_cap_cents';
  rejected := false;
  BEGIN
    PERFORM public.reserve_provider_usage(u4, 'media_validate', 'audit2-over-monthly-cap', 1, NULL);
  EXCEPTION WHEN OTHERS THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'AUDIT2-P0-9: monthly hard cap allowed a reservation';
  END IF;
  UPDATE public.app_config SET value = '1000' WHERE key = 'provider_monthly_cap_cents';

  -- Suspended account cannot reserve (checked before the consent gate).
  UPDATE public.users
     SET account_status = 'suspended'
   WHERE id = '00000000-0000-0000-0000-000000000003';
  rejected := false;
  BEGIN
    PERFORM public.reserve_provider_usage(
      '00000000-0000-0000-0000-000000000003', 'media_validate', 'audit2-suspended-account', 1, NULL
    );
  EXCEPTION WHEN OTHERS THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'AUDIT2-P0-9: suspended account reserved provider usage';
  END IF;

  -- Deletion-requested account cannot reserve.
  INSERT INTO public.deletion_requests (user_id, status)
  VALUES ('00000000-0000-0000-0000-000000000001', 'queued')
  ON CONFLICT (user_id, scope) DO UPDATE SET status = 'queued';
  rejected := false;
  BEGIN
    PERFORM public.reserve_provider_usage(
      '00000000-0000-0000-0000-000000000001', 'media_validate', 'audit2-deletion-requested-account', 1, NULL
    );
  EXCEPTION WHEN OTHERS THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'AUDIT2-P0-9: deletion-requested account reserved provider usage';
  END IF;
END;
$$;

ROLLBACK;

SELECT 'b07_cost_control.sql passed' AS result;
