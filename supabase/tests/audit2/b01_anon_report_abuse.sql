-- AUDIT2 REGRESSION: P0-1, 감사 §3 익명 신고 self-DoS 방어.
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'reports'
       AND column_name = 'reporter_ip_hash'
  ) THEN
    RAISE EXCEPTION 'AUDIT2-P0-1: reports.reporter_ip_hash is missing';
  END IF;
END;
$$;

CREATE FUNCTION pg_temp.reset_report_case()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM public.ops_alerts
   WHERE campaign_id = '20000000-0000-0000-0000-000000000001';
  DELETE FROM public.reports
   WHERE campaign_id = '20000000-0000-0000-0000-000000000001';
  UPDATE public.campaigns
     SET status = 'published',
         ends_at = now() + INTERVAL '14 days'
   WHERE id = '20000000-0000-0000-0000-000000000001';
END;
$$;

DO $$
DECLARE
  failures TEXT[] := ARRAY[]::TEXT[];
  report_count INTEGER;
  campaign_status TEXT;
BEGIN
  -- The same anonymous identity must neither count twice nor auto-pause.
  PERFORM pg_temp.reset_report_case();
  INSERT INTO public.reports (
    reported_user_id,
    campaign_id,
    target_type,
    target_id,
    reason,
    anon_report,
    reporter_ip_hash
  ) VALUES (
    '00000000-0000-0000-0000-000000000002',
    '20000000-0000-0000-0000-000000000001',
    'campaign',
    '20000000-0000-0000-0000-000000000001',
    'impersonation',
    true,
    'audit2-same-anon'
  );
  BEGIN
    INSERT INTO public.reports (
      reported_user_id,
      campaign_id,
      target_type,
      target_id,
      reason,
      anon_report,
      reporter_ip_hash
    ) VALUES (
      '00000000-0000-0000-0000-000000000002',
      '20000000-0000-0000-0000-000000000001',
      'campaign',
      '20000000-0000-0000-0000-000000000001',
      'impersonation',
      true,
      'audit2-same-anon'
    );
  EXCEPTION WHEN OTHERS THEN
    -- A duplicate-rejection policy is also a valid cooldown implementation.
    NULL;
  END;

  SELECT status INTO campaign_status
    FROM public.campaigns
   WHERE id = '20000000-0000-0000-0000-000000000001';
  SELECT count(*) INTO report_count
    FROM public.reports
   WHERE campaign_id = '20000000-0000-0000-0000-000000000001'
     AND reporter_ip_hash = 'audit2-same-anon'
     AND reason = 'impersonation';
  IF campaign_status <> 'published' THEN
    failures := array_append(failures, 'same anonymous identity auto-paused campaign');
  END IF;
  IF report_count > 1 THEN
    failures := array_append(failures, 'same identity+reason was not deduplicated');
  END IF;

  -- Two independent anonymous identities must reach the policy threshold.
  PERFORM pg_temp.reset_report_case();
  INSERT INTO public.reports (
    reported_user_id, campaign_id, target_type, target_id,
    reason, anon_report, reporter_ip_hash
  ) VALUES
    (
      '00000000-0000-0000-0000-000000000002',
      '20000000-0000-0000-0000-000000000001',
      'campaign',
      '20000000-0000-0000-0000-000000000001',
      'minor',
      true,
      'audit2-anon-a'
    ),
    (
      '00000000-0000-0000-0000-000000000002',
      '20000000-0000-0000-0000-000000000001',
      'campaign',
      '20000000-0000-0000-0000-000000000001',
      'minor',
      true,
      'audit2-anon-b'
    );
  IF (SELECT status FROM public.campaigns
       WHERE id = '20000000-0000-0000-0000-000000000001') <> 'paused' THEN
    failures := array_append(failures, 'two trusted anonymous identities did not pause');
  END IF;

  -- Authenticated and anonymous identities must remain distinct.
  PERFORM pg_temp.reset_report_case();
  INSERT INTO public.reports (
    reporter_user_id, reported_user_id, campaign_id, target_type, target_id,
    reason, anon_report
  ) VALUES (
    '00000000-0000-0000-0000-000000000003',
    '00000000-0000-0000-0000-000000000002',
    '20000000-0000-0000-0000-000000000001',
    'campaign',
    '20000000-0000-0000-0000-000000000001',
    'safety_risk',
    false
  );
  INSERT INTO public.reports (
    reported_user_id, campaign_id, target_type, target_id,
    reason, anon_report, reporter_ip_hash
  ) VALUES (
    '00000000-0000-0000-0000-000000000002',
    '20000000-0000-0000-0000-000000000001',
    'campaign',
    '20000000-0000-0000-0000-000000000001',
    'safety_risk',
    true,
    'audit2-mixed-anon'
  );
  IF (SELECT status FROM public.campaigns
       WHERE id = '20000000-0000-0000-0000-000000000001') <> 'paused' THEN
    failures := array_append(failures, 'authenticated+anonymous identities did not pause');
  END IF;

  -- A reporter outside the rolling 24-hour window must not contribute.
  PERFORM pg_temp.reset_report_case();
  INSERT INTO public.reports (
    reported_user_id,
    campaign_id,
    target_type,
    target_id,
    reason,
    anon_report,
    reporter_ip_hash,
    created_at
  ) VALUES (
    '00000000-0000-0000-0000-000000000002',
    '20000000-0000-0000-0000-000000000001',
    'campaign',
    '20000000-0000-0000-0000-000000000001',
    'impersonation',
    true,
    'audit2-expired-window',
    now() - INTERVAL '25 hours'
  );
  INSERT INTO public.reports (
    reported_user_id, campaign_id, target_type, target_id,
    reason, anon_report, reporter_ip_hash
  ) VALUES (
    '00000000-0000-0000-0000-000000000002',
    '20000000-0000-0000-0000-000000000001',
    'campaign',
    '20000000-0000-0000-0000-000000000001',
    'impersonation',
    true,
    'audit2-current-window'
  );
  IF (SELECT status FROM public.campaigns
       WHERE id = '20000000-0000-0000-0000-000000000001') <> 'published' THEN
    failures := array_append(failures, 'report older than 24 hours contributed to pause');
  END IF;

  IF cardinality(failures) > 0 THEN
    RAISE EXCEPTION 'AUDIT2-P0-1: %', array_to_string(failures, '; ');
  END IF;
END;
$$;

ROLLBACK;

SELECT 'b01_anon_report_abuse.sql passed' AS result;
