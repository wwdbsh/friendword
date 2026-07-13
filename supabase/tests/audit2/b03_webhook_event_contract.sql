-- AUDIT2 REGRESSION: P0-3, 감사 §3 RevenueCat 실제 이벤트 계약.
-- Slice 3부터 그린: TRANSFER·속성 누락 lifecycle·미귀속 구매가 durable review로
-- 남고, lineage 기반 reconcile과 멱등성이 보장된다.
BEGIN;

DO $$
BEGIN
  IF to_regclass('public.purchase_event_reviews') IS NULL THEN
    RAISE EXCEPTION 'AUDIT2-P0-3: purchase_event_reviews is missing';
  END IF;
END;
$$;

CREATE FUNCTION pg_temp.rc_event(payload JSONB)
RETURNS JSONB
LANGUAGE sql
AS $$
  SELECT public.record_revenuecat_event(payload);
$$;

SET LOCAL ROLE service_role;

-- 1. Realistic TRANSFER (no product_id/app_user_id) is accepted into review.
DO $$
DECLARE
  result JSONB;
BEGIN
  result := pg_temp.rc_event(jsonb_build_object(
    'id', 'b03-transfer-1',
    'type', 'TRANSFER',
    'environment', 'SANDBOX',
    'store', 'APP_STORE',
    'transferred_from', jsonb_build_array('anonymous-legacy-user'),
    'transferred_to', jsonb_build_array('00000000-0000-0000-0000-000000000004')
  ));
  IF (result ->> 'recorded')::BOOLEAN IS DISTINCT FROM true
     OR (result ->> 'needs_review')::BOOLEAN IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'AUDIT2-P0-3: TRANSFER was not accepted into review: %', result;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM purchase_event_reviews
     WHERE provider_event_id = 'b03-transfer-1' AND status = 'open'
  ) THEN
    RAISE EXCEPTION 'AUDIT2-P0-3: TRANSFER left no durable review row';
  END IF;

  -- Replay is idempotent: still one review row, same response shape.
  result := pg_temp.rc_event(jsonb_build_object(
    'id', 'b03-transfer-1',
    'type', 'TRANSFER',
    'environment', 'SANDBOX',
    'store', 'APP_STORE',
    'transferred_from', jsonb_build_array('anonymous-legacy-user'),
    'transferred_to', jsonb_build_array('00000000-0000-0000-0000-000000000004')
  ));
  IF (SELECT count(*) FROM purchase_event_reviews
       WHERE provider_event_id = 'b03-transfer-1') <> 1 THEN
    RAISE EXCEPTION 'AUDIT2-P0-3: TRANSFER replay duplicated the review row';
  END IF;
END;
$$;

-- 2. Purchase then a REFUND without subscriber attributes reconciles
-- through the original transaction lineage and revokes the credit.
RESET ROLE;
INSERT INTO purchase_intents (
  id, user_id, product_id, scope_type, scope_id, status, expires_at
) VALUES (
  'b0300000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000004',
  'creator_launch_credit_499',
  'PITCH_DRAFT',
  '10000000-0000-0000-0000-000000000002',
  'issued',
  now() + INTERVAL '1 hour'
);
SET LOCAL ROLE service_role;

DO $$
DECLARE
  result JSONB;
BEGIN
  result := pg_temp.rc_event(jsonb_build_object(
    'id', 'b03-purchase-1',
    'type', 'NON_RENEWING_PURCHASE',
    'environment', 'SANDBOX',
    'app_user_id', '00000000-0000-0000-0000-000000000004',
    'product_id', 'creator_launch_credit_499',
    'transaction_id', 'b03-tx-1',
    'original_transaction_id', 'b03-original-1',
    'subscriber_attributes', jsonb_build_object(
      'purchase_intent_id',
      jsonb_build_object('value', 'b0300000-0000-0000-0000-000000000001')
    )
  ));
  IF (result -> 'benefit' ->> 'state') IS DISTINCT FROM 'available' THEN
    RAISE EXCEPTION 'AUDIT2-P0-3: attributed purchase did not grant a credit: %', result;
  END IF;

  -- RevenueCat lifecycle payloads may drop subscriber attributes entirely.
  result := pg_temp.rc_event(jsonb_build_object(
    'id', 'b03-refund-1',
    'type', 'REFUND',
    'environment', 'SANDBOX',
    'app_user_id', '00000000-0000-0000-0000-000000000004',
    'product_id', 'creator_launch_credit_499',
    'transaction_id', 'b03-tx-1',
    'original_transaction_id', 'b03-original-1'
  ));
  IF (result ->> 'recorded')::BOOLEAN IS DISTINCT FROM true
     OR (result ->> 'needs_review')::BOOLEAN IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'AUDIT2-P0-3: attribute-less refund did not reconcile: %', result;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM purchase_credit_ledger
     WHERE idempotency_key = 'b03-original-1' AND credit_state = 'revoked'
  ) THEN
    RAISE EXCEPTION 'AUDIT2-P0-3: lineage refund did not revoke the credit';
  END IF;
END;
$$;

-- 3. A valid, money-received purchase with no resolvable attribution lands
-- in the durable review queue: no benefit, nothing dropped.
DO $$
DECLARE
  result JSONB;
BEGIN
  result := pg_temp.rc_event(jsonb_build_object(
    'id', 'b03-unattributed-1',
    'type', 'NON_RENEWING_PURCHASE',
    'environment', 'SANDBOX',
    'app_user_id', '00000000-0000-0000-0000-000000000004',
    'product_id', 'creator_launch_credit_499',
    'transaction_id', 'b03-tx-2',
    'original_transaction_id', 'b03-original-2'
  ));
  IF (result ->> 'needs_review')::BOOLEAN IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'AUDIT2-P0-3: unattributed purchase was not parked: %', result;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM purchase_event_reviews
     WHERE provider_event_id = 'b03-unattributed-1'
       AND reason = 'unattributed_purchase'
       AND status = 'open'
  ) THEN
    RAISE EXCEPTION 'AUDIT2-P0-3: unattributed purchase left no review row';
  END IF;
  IF EXISTS (
    SELECT 1 FROM purchase_credit_ledger WHERE idempotency_key = 'b03-original-2'
  ) THEN
    RAISE EXCEPTION 'AUDIT2-P0-3: unattributed purchase granted a benefit';
  END IF;
END;
$$;

-- 4. Malformed events still raise (the route turns these into 400s).
DO $$
DECLARE
  rejected BOOLEAN := false;
BEGIN
  BEGIN
    PERFORM pg_temp.rc_event(jsonb_build_object('type', 'REFUND'));
  EXCEPTION WHEN OTHERS THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'AUDIT2-P0-3: event without an id was accepted';
  END IF;

  rejected := false;
  BEGIN
    PERFORM pg_temp.rc_event(jsonb_build_object(
      'id', 'b03-malformed-1',
      'type', 'NON_RENEWING_PURCHASE',
      'app_user_id', '00000000-0000-0000-0000-000000000004',
      'product_id', 'creator_launch_credit_499'
    ));
  EXCEPTION WHEN OTHERS THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'AUDIT2-P0-3: purchase without transaction ids was accepted';
  END IF;
END;
$$;

-- 5. Unhandled-but-authenticated event types are reviewed, not rejected.
DO $$
DECLARE
  result JSONB;
BEGIN
  result := pg_temp.rc_event(jsonb_build_object(
    'id', 'b03-unhandled-1',
    'type', 'SUBSCRIPTION_PAUSED',
    'environment', 'SANDBOX'
  ));
  IF (result ->> 'needs_review')::BOOLEAN IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'AUDIT2-P0-3: unhandled event type was not reviewed: %', result;
  END IF;
END;
$$;

RESET ROLE;

ROLLBACK;

SELECT 'b03_webhook_event_contract.sql passed' AS result;
