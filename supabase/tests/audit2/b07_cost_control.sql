-- AUDIT2 REGRESSION: P0-9, 감사 §3 provider 비용 reserve/reconcile hard cap.
BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.reserve_provider_usage(text,text,integer)') IS NULL
     AND to_regprocedure('public.reserve_provider_usage(text,text,integer,uuid)') IS NULL THEN
    RAISE EXCEPTION 'AUDIT2-P0-9: reserve_provider_usage RPC missing';
  END IF;
  IF to_regprocedure('public.reconcile_provider_usage(uuid,integer,text)') IS NULL THEN
    RAISE EXCEPTION 'AUDIT2-P0-9: reconcile_provider_usage(uuid,integer,text) RPC missing';
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
  first_reservation UUID;
  replay_reservation UUID;
  cap_reservation UUID;
  rejected BOOLEAN;
BEGIN
  PERFORM set_config(
    'request.jwt.claim.sub',
    '00000000-0000-0000-0000-000000000004',
    true
  );
  first_reservation := public.reserve_provider_usage(
    'media_validate', 'audit2-replay-request', 10
  );
  replay_reservation := public.reserve_provider_usage(
    'media_validate', 'audit2-replay-request', 10
  );
  IF replay_reservation IS DISTINCT FROM first_reservation THEN
    RAISE EXCEPTION 'AUDIT2-P0-9: replay returned a second reservation';
  END IF;
  IF (SELECT count(*) FROM public.provider_usage_events
       WHERE id = first_reservation) <> 1 THEN
    RAISE EXCEPTION 'AUDIT2-P0-9: replay did not preserve exactly one usage row';
  END IF;

  UPDATE public.app_config SET value = 'on' WHERE key = 'provider_kill_switch';
  rejected := false;
  BEGIN
    PERFORM public.reserve_provider_usage(
      'media_validate', 'audit2-kill-switch', 1
    );
  EXCEPTION WHEN OTHERS THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'AUDIT2-P0-9: kill switch allowed a reservation';
  END IF;
  UPDATE public.app_config SET value = 'off' WHERE key = 'provider_kill_switch';

  cap_reservation := public.reserve_provider_usage(
    'media_validate', 'audit2-cap-base', 100
  );
  PERFORM public.reconcile_provider_usage(cap_reservation, 100, 'succeeded');
  UPDATE public.app_config SET value = '100' WHERE key = 'provider_monthly_cap_cents';
  rejected := false;
  BEGIN
    PERFORM public.reserve_provider_usage(
      'media_validate', 'audit2-over-monthly-cap', 1
    );
  EXCEPTION WHEN OTHERS THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'AUDIT2-P0-9: monthly hard cap allowed a reservation';
  END IF;

  UPDATE public.app_config SET value = '1000' WHERE key = 'provider_monthly_cap_cents';
  UPDATE public.users
     SET account_status = 'suspended'
   WHERE id = '00000000-0000-0000-0000-000000000003';
  PERFORM set_config(
    'request.jwt.claim.sub',
    '00000000-0000-0000-0000-000000000003',
    true
  );
  rejected := false;
  BEGIN
    PERFORM public.reserve_provider_usage(
      'media_validate', 'audit2-suspended-account', 1
    );
  EXCEPTION WHEN OTHERS THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'AUDIT2-P0-9: suspended account reserved provider usage';
  END IF;

  INSERT INTO public.deletion_requests (user_id, status)
  VALUES ('00000000-0000-0000-0000-000000000001', 'queued')
  ON CONFLICT (user_id, scope) DO UPDATE SET status = 'queued';
  PERFORM set_config(
    'request.jwt.claim.sub',
    '00000000-0000-0000-0000-000000000001',
    true
  );
  rejected := false;
  BEGIN
    PERFORM public.reserve_provider_usage(
      'media_validate', 'audit2-deletion-requested-account', 1
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
