-- AUDIT2 REGRESSION: P0-5·P0-6, 감사 §3 유료 가치 1:1 전달.
BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.issue_purchase_intent(text,uuid)') IS NULL THEN
    RAISE EXCEPTION 'AUDIT2-P0-5/P0-6: issue_purchase_intent(text,uuid) RPC missing';
  END IF;
  IF to_regprocedure('public.record_revenuecat_event(jsonb)') IS NULL THEN
    RAISE EXCEPTION 'AUDIT2-P0-5/P0-6: record_revenuecat_event(jsonb) RPC missing';
  END IF;
  IF to_regclass('public.share_kits') IS NULL THEN
    RAISE EXCEPTION 'AUDIT2-P0-5: share_kits is missing';
  END IF;
END;
$$;

CREATE FUNCTION pg_temp.intent_is_rejected(target_product TEXT, target_scope UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM * FROM public.issue_purchase_intent(target_product, target_scope);
  RETURN false;
EXCEPTION WHEN OTHERS THEN
  RETURN true;
END;
$$;

CREATE FUNCTION pg_temp.revenuecat_payload(
  event_id TEXT,
  event_type TEXT,
  app_user_id UUID,
  product_id TEXT,
  purchase_intent_id UUID,
  transaction_id TEXT,
  original_transaction_id TEXT
)
RETURNS JSONB
LANGUAGE sql
AS $$
  SELECT jsonb_build_object(
    'id', event_id,
    'type', event_type,
    'app_user_id', app_user_id::TEXT,
    'product_id', product_id,
    'transaction_id', transaction_id,
    'original_transaction_id', original_transaction_id,
    'environment', 'SANDBOX',
    'subscriber_attributes', jsonb_build_object(
      'purchase_intent_id', jsonb_build_object('value', purchase_intent_id::TEXT)
    )
  );
$$;

INSERT INTO public.purchase_credit_ledger (
  id,
  user_id,
  credit_state,
  product_id,
  pitch_draft_id,
  idempotency_key
) VALUES (
  'b0400000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  'available',
  'creator_launch_credit_499',
  '10000000-0000-0000-0000-000000000001',
  'audit2-existing-credit'
);

CREATE TEMP TABLE audit2_paid_failures (message TEXT NOT NULL);
CREATE FUNCTION pg_temp.note_paid_failure(failure_message TEXT)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
  INSERT INTO audit2_paid_failures (message) VALUES (failure_message);
$$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);

DO $$
BEGIN
  IF NOT pg_temp.intent_is_rejected(
    'creator_launch_credit_499',
    '10000000-0000-0000-0000-000000000001'
  ) THEN
    PERFORM pg_temp.note_paid_failure('available Creator credit allowed duplicate intent');
  END IF;
END;
$$;

RESET ROLE;

UPDATE public.purchase_credit_ledger
   SET credit_state = 'consumed'
 WHERE id = 'b0400000-0000-0000-0000-000000000001';
INSERT INTO public.share_kits (
  id, pitch_draft_id, unlocked_by_user_id, credit_ledger_id
) VALUES (
  'b0400000-0000-0000-0000-000000000002',
  '10000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  'b0400000-0000-0000-0000-000000000001'
);
INSERT INTO public.campaign_entitlements (
  campaign_id, product_id, active, expires_at
) VALUES (
  '20000000-0000-0000-0000-000000000001',
  'campaign_pass_30d_1999',
  true,
  now() + INTERVAL '20 days'
)
ON CONFLICT (campaign_id, product_id) DO UPDATE
  SET active = true,
      expires_at = EXCLUDED.expires_at;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);

DO $$
DECLARE
  unlocked_again BOOLEAN;
BEGIN

  IF NOT pg_temp.intent_is_rejected(
    'creator_launch_credit_499',
    '10000000-0000-0000-0000-000000000001'
  ) THEN
    PERFORM pg_temp.note_paid_failure('unlocked Creator kit allowed duplicate intent');
  END IF;

  SELECT already_unlocked INTO unlocked_again
    FROM public.unlock_share_kit('10000000-0000-0000-0000-000000000001');
  IF unlocked_again IS DISTINCT FROM true
     OR NOT EXISTS (
       SELECT 1 FROM public.share_kits
        WHERE pitch_draft_id = '10000000-0000-0000-0000-000000000001'
     ) THEN
    PERFORM pg_temp.note_paid_failure(
      'consumed credit did not preserve permanent kit re-entry'
    );
  END IF;

  PERFORM set_config(
    'request.jwt.claim.sub',
    '00000000-0000-0000-0000-000000000002',
    true
  );
  IF NOT pg_temp.intent_is_rejected(
    'campaign_pass_30d_1999',
    '20000000-0000-0000-0000-000000000001'
  ) THEN
    PERFORM pg_temp.note_paid_failure('active Campaign Pass allowed duplicate intent');
  END IF;
END;
$$;

RESET ROLE;

-- Replay and same-transaction duplicates must not duplicate either benefit.
INSERT INTO public.purchase_intents (
  id, user_id, product_id, scope_type, scope_id, status, expires_at
) VALUES
  (
    'b0400000-0000-0000-0000-000000000010',
    '00000000-0000-0000-0000-000000000004',
    'creator_launch_credit_499',
    'PITCH_DRAFT',
    '10000000-0000-0000-0000-000000000002',
    'issued',
    now() + INTERVAL '1 hour'
  ),
  (
    'b0400000-0000-0000-0000-000000000011',
    '00000000-0000-0000-0000-000000000001',
    'campaign_pass_30d_1999',
    'CAMPAIGN',
    '20000000-0000-0000-0000-000000000002',
    'issued',
    now() + INTERVAL '1 hour'
  );

SET LOCAL ROLE service_role;

DO $$
DECLARE
  creator_credit_count INTEGER;
  pass_expiry_before TIMESTAMPTZ;
  pass_expiry_after TIMESTAMPTZ;
BEGIN
  PERFORM public.record_revenuecat_event(pg_temp.revenuecat_payload(
    'audit2-creator-event-1',
    'NON_RENEWING_PURCHASE',
    '00000000-0000-0000-0000-000000000004',
    'creator_launch_credit_499',
    'b0400000-0000-0000-0000-000000000010',
    'audit2-creator-transaction',
    'audit2-creator-original'
  ));
  PERFORM public.record_revenuecat_event(pg_temp.revenuecat_payload(
    'audit2-creator-event-1',
    'NON_RENEWING_PURCHASE',
    '00000000-0000-0000-0000-000000000004',
    'creator_launch_credit_499',
    'b0400000-0000-0000-0000-000000000010',
    'audit2-creator-transaction',
    'audit2-creator-original'
  ));
  PERFORM public.record_revenuecat_event(pg_temp.revenuecat_payload(
    'audit2-creator-event-2',
    'NON_RENEWING_PURCHASE',
    '00000000-0000-0000-0000-000000000004',
    'creator_launch_credit_499',
    'b0400000-0000-0000-0000-000000000010',
    'audit2-creator-transaction',
    'audit2-creator-original'
  ));
  SELECT count(*) INTO creator_credit_count
    FROM public.purchase_credit_ledger
   WHERE idempotency_key = 'audit2-creator-original';
  IF creator_credit_count <> 1 THEN
    RAISE EXCEPTION 'AUDIT2-P0-5: replay created % Creator credits', creator_credit_count;
  END IF;

  PERFORM public.record_revenuecat_event(pg_temp.revenuecat_payload(
    'audit2-pass-event-1',
    'NON_RENEWING_PURCHASE',
    '00000000-0000-0000-0000-000000000001',
    'campaign_pass_30d_1999',
    'b0400000-0000-0000-0000-000000000011',
    'audit2-pass-transaction',
    'audit2-pass-original'
  ));
  SELECT expires_at INTO pass_expiry_before
    FROM public.campaign_entitlements
   WHERE campaign_id = '20000000-0000-0000-0000-000000000002'
     AND product_id = 'campaign_pass_30d_1999';
  PERFORM public.record_revenuecat_event(pg_temp.revenuecat_payload(
    'audit2-pass-event-1',
    'NON_RENEWING_PURCHASE',
    '00000000-0000-0000-0000-000000000001',
    'campaign_pass_30d_1999',
    'b0400000-0000-0000-0000-000000000011',
    'audit2-pass-transaction',
    'audit2-pass-original'
  ));
  PERFORM public.record_revenuecat_event(pg_temp.revenuecat_payload(
    'audit2-pass-event-2',
    'NON_RENEWING_PURCHASE',
    '00000000-0000-0000-0000-000000000001',
    'campaign_pass_30d_1999',
    'b0400000-0000-0000-0000-000000000011',
    'audit2-pass-transaction',
    'audit2-pass-original'
  ));
  SELECT expires_at INTO pass_expiry_after
    FROM public.campaign_entitlements
   WHERE campaign_id = '20000000-0000-0000-0000-000000000002'
     AND product_id = 'campaign_pass_30d_1999';
  IF pass_expiry_after IS DISTINCT FROM pass_expiry_before THEN
    RAISE EXCEPTION 'AUDIT2-P0-6: replay changed Pass expiry from % to %',
      pass_expiry_before,
      pass_expiry_after;
  END IF;
END;
$$;

RESET ROLE;

DO $$
DECLARE
  failures TEXT[];
BEGIN
  SELECT array_agg(message ORDER BY message) INTO failures
    FROM audit2_paid_failures;
  IF coalesce(cardinality(failures), 0) > 0 THEN
    RAISE EXCEPTION 'AUDIT2-P0-5/P0-6: %', array_to_string(failures, '; ');
  END IF;
END;
$$;

ROLLBACK;

SELECT 'b04_paid_value_delivery.sql passed' AS result;
