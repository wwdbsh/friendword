-- AUDIT2 REGRESSION: H-5, 감사 §5 캠페인 만료 상태 일관성.
BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.expire_due_campaigns()') IS NULL THEN
    RAISE EXCEPTION 'AUDIT2-H-5: expire_due_campaigns() RPC missing';
  END IF;
  IF to_regprocedure('public.set_campaign_status(uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'AUDIT2-H-5: set_campaign_status(uuid,text) RPC missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint constraint_row
      JOIN pg_class table_row ON table_row.oid = constraint_row.conrelid
      JOIN pg_namespace schema_row ON schema_row.oid = table_row.relnamespace
     WHERE schema_row.nspname = 'public'
       AND table_row.relname = 'campaigns'
       AND constraint_row.contype = 'c'
       AND pg_get_constraintdef(constraint_row.oid) LIKE '%expired%'
  ) THEN
    RAISE EXCEPTION 'AUDIT2-H-5: campaigns.status does not allow expired';
  END IF;
END;
$$;

UPDATE public.campaigns
   SET ends_at = now() - INTERVAL '1 hour'
 WHERE id = '20000000-0000-0000-0000-000000000001';

INSERT INTO public.pitch_drafts (
  id, created_by_user_id, subject_user_id, status, headline, body
) VALUES (
  'b1000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000004',
  '00000000-0000-0000-0000-000000000001',
  'published',
  'Expired paused campaign',
  'This campaign must not be resumable after its end time.'
);
INSERT INTO public.campaigns (
  id,
  pitch_draft_id,
  owner_user_id,
  status,
  published_at,
  slug,
  ends_at
) VALUES (
  'b1000000-0000-0000-0000-000000000002',
  'b1000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  'paused',
  now() - INTERVAL '15 days',
  'audit2-expired-paused',
  now() - INTERVAL '1 day'
);
INSERT INTO public.campaign_memberships (campaign_id, user_id, role)
VALUES
  (
    'b1000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000001',
    'DATER_OWNER'
  ),
  (
    'b1000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000004',
    'INTRODUCER'
  );

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
DO $$
DECLARE
  rejected BOOLEAN := false;
BEGIN
  BEGIN
    PERFORM public.expire_due_campaigns();
  EXCEPTION WHEN OTHERS THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'AUDIT2-H-5: authenticated caller executed expire_due_campaigns';
  END IF;
END;
$$;
RESET ROLE;

SET LOCAL ROLE service_role;
SELECT public.expire_due_campaigns();
RESET ROLE;

DO $$
BEGIN
  IF (SELECT status FROM public.campaigns
       WHERE id = '20000000-0000-0000-0000-000000000001') <> 'expired' THEN
    RAISE EXCEPTION 'AUDIT2-H-5: due published campaign did not transition to expired';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM public.analytics_events
     WHERE event_name = 'campaign_expired'
       AND properties ->> 'campaign_id' = '20000000-0000-0000-0000-000000000001'
  ) THEN
    RAISE EXCEPTION 'AUDIT2-H-5: expiration did not record campaign_expired event';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM public.campaigns
     WHERE id = '20000000-0000-0000-0000-000000000001'
       AND status = 'published'
  ) THEN
    RAISE EXCEPTION 'AUDIT2-H-5: expired campaign remained in published read set';
  END IF;
END;
$$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
DO $$
DECLARE
  rejected BOOLEAN := false;
BEGIN
  BEGIN
    PERFORM * FROM public.set_campaign_status(
      'b1000000-0000-0000-0000-000000000002',
      'published'
    );
  EXCEPTION WHEN OTHERS THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'AUDIT2-H-5: expired paused campaign resumed to published';
  END IF;
END;
$$;

ROLLBACK;

SELECT 'b10_expiration_consistency.sql passed' AS result;
