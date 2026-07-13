-- AUDIT REGRESSION: P0-4, 감사 문서 §5 "두 유료 상품과 원자 원장".
-- 현재 실패 이유: record_revenuecat_event RPC와 transaction 식별 컬럼이 없고 기간 정책이 7/30/90일이다.

BEGIN;

DO $$
DECLARE
  missing_column TEXT;
BEGIN
  SELECT required.column_name INTO missing_column
    FROM unnest(ARRAY['transaction_id', 'original_transaction_id']) AS required(column_name)
   WHERE NOT EXISTS (
     SELECT 1
       FROM information_schema.columns actual
      WHERE actual.table_schema = 'public'
        AND actual.table_name = 'purchase_events'
        AND actual.column_name = required.column_name
   )
   LIMIT 1;

  IF missing_column IS NOT NULL THEN
    RAISE EXCEPTION 'AUDIT-P04: purchase_events.% is missing', missing_column;
  END IF;

  IF to_regprocedure('public.record_revenuecat_event(jsonb)') IS NULL THEN
    RAISE EXCEPTION 'AUDIT-P04: record_revenuecat_event(jsonb) RPC is missing';
  END IF;

  IF to_regclass('public.purchase_intents') IS NULL THEN
    RAISE EXCEPTION 'AUDIT-P04: purchase_intents is missing';
  END IF;
END;
$$;

INSERT INTO purchase_intents (
  id,
  user_id,
  product_id,
  scope_type,
  scope_id,
  status,
  expires_at
)
VALUES
  (
    'a0400000-0000-0000-0000-000000000101',
    '00000000-0000-0000-0000-000000000004',
    'creator_launch_credit_499',
    'PITCH_DRAFT',
    '10000000-0000-0000-0000-000000000002',
    'issued',
    now() + INTERVAL '1 hour'
  ),
  (
    'a0400000-0000-0000-0000-000000000102',
    '00000000-0000-0000-0000-000000000004',
    'creator_launch_credit_499',
    'PITCH_DRAFT',
    '10000000-0000-0000-0000-000000000002',
    'issued',
    now() + INTERVAL '1 hour'
  ),
  (
    'a0400000-0000-0000-0000-000000000103',
    '00000000-0000-0000-0000-000000000004',
    'creator_launch_credit_499',
    'PITCH_DRAFT',
    '10000000-0000-0000-0000-000000000002',
    'issued',
    now() + INTERVAL '1 hour'
  );

SET LOCAL ROLE authenticated;
DO $$
DECLARE
  unauthorized_call_rejected BOOLEAN := false;
BEGIN
  BEGIN
    PERFORM record_revenuecat_event(jsonb_build_object(
      'provider_event_id', 'audit-p04-unauthorized',
      'event_type', 'NON_RENEWING_PURCHASE',
      'app_user_id', '00000000-0000-0000-0000-000000000004',
      'product_id', 'creator_launch_credit_499',
      'purchase_intent_id', 'a0400000-0000-0000-0000-000000000101',
      'transaction_id', 'audit-p04-unauthorized-transaction',
      'original_transaction_id', 'audit-p04-unauthorized-original'
    ));
    RAISE EXCEPTION 'audit_authenticated_webhook_call_was_accepted';
  EXCEPTION
    WHEN insufficient_privilege THEN
      unauthorized_call_rejected := true;
    WHEN raise_exception THEN
      IF SQLERRM ~* 'service.role|permission|authorized' THEN
        unauthorized_call_rejected := true;
      ELSIF SQLERRM <> 'audit_authenticated_webhook_call_was_accepted' THEN
        RAISE;
      END IF;
  END;
  IF NOT unauthorized_call_rejected THEN
    RAISE EXCEPTION 'AUDIT-P04: authenticated role executed webhook ledger RPC';
  END IF;
END;
$$;
RESET ROLE;

SET LOCAL ROLE service_role;

DO $$
DECLARE
  purchase_count, ledger_count INTEGER;
  unknown_product_rejected BOOLEAN := false;
  revoked_count INTEGER;
BEGIN
  PERFORM record_revenuecat_event(jsonb_build_object(
    'provider_event_id', 'audit-p04-purchase',
    'event_type', 'NON_RENEWING_PURCHASE',
    'app_user_id', '00000000-0000-0000-0000-000000000004',
    'product_id', 'creator_launch_credit_499',
    'purchase_intent_id', 'a0400000-0000-0000-0000-000000000101',
    'transaction_id', 'audit-p04-transaction',
    'original_transaction_id', 'audit-p04-original-transaction'
  ));
  PERFORM record_revenuecat_event(jsonb_build_object(
    'provider_event_id', 'audit-p04-purchase',
    'event_type', 'NON_RENEWING_PURCHASE',
    'app_user_id', '00000000-0000-0000-0000-000000000004',
    'product_id', 'creator_launch_credit_499',
    'purchase_intent_id', 'a0400000-0000-0000-0000-000000000101',
    'transaction_id', 'audit-p04-transaction',
    'original_transaction_id', 'audit-p04-original-transaction'
  ));

  SELECT count(*) INTO purchase_count
    FROM purchase_events
   WHERE provider_event_id = 'audit-p04-purchase';
  SELECT count(*) INTO ledger_count
    FROM purchase_credit_ledger
   WHERE idempotency_key = 'audit-p04-original-transaction';
  IF purchase_count <> 1 OR ledger_count <> 1 THEN
    RAISE EXCEPTION 'AUDIT-P04: duplicate event produced % purchases and % ledger rows',
      purchase_count,
      ledger_count;
  END IF;

  BEGIN
    PERFORM record_revenuecat_event(jsonb_build_object(
      'provider_event_id', 'audit-p04-unknown-product',
      'event_type', 'INITIAL_PURCHASE',
      'app_user_id', '00000000-0000-0000-0000-000000000004',
      'product_id', 'unknown_product',
      'purchase_intent_id', 'a0400000-0000-0000-0000-000000000101',
      'transaction_id', 'audit-p04-unknown-transaction',
      'original_transaction_id', 'audit-p04-unknown-original'
    ));
    RAISE EXCEPTION 'audit_unknown_product_was_accepted';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM = 'audit_unknown_product_was_accepted' THEN
        unknown_product_rejected := false;
      ELSIF SQLERRM ~* 'unknown|product' THEN
        unknown_product_rejected := true;
      ELSE
        RAISE;
      END IF;
  END;
  IF NOT unknown_product_rejected THEN
    RAISE EXCEPTION 'AUDIT-P04: unknown product_id was accepted';
  END IF;

  PERFORM record_revenuecat_event(jsonb_build_object(
    'provider_event_id', 'audit-p04-cancellation',
    'event_type', 'CANCELLATION',
    'app_user_id', '00000000-0000-0000-0000-000000000004',
    'product_id', 'creator_launch_credit_499',
    'purchase_intent_id', 'a0400000-0000-0000-0000-000000000101',
    'transaction_id', 'audit-p04-transaction',
    'original_transaction_id', 'audit-p04-original-transaction'
  ));

  SELECT count(*) INTO revoked_count
    FROM purchase_credit_ledger
   WHERE idempotency_key = 'audit-p04-original-transaction'
     AND credit_state::TEXT IN ('refunded', 'revoked');
  IF revoked_count <> 1 THEN
    RAISE EXCEPTION 'AUDIT-P04: cancellation did not revoke available credit';
  END IF;

  PERFORM record_revenuecat_event(jsonb_build_object(
    'provider_event_id', 'audit-p04-refund-purchase',
    'event_type', 'NON_RENEWING_PURCHASE',
    'app_user_id', '00000000-0000-0000-0000-000000000004',
    'product_id', 'creator_launch_credit_499',
    'purchase_intent_id', 'a0400000-0000-0000-0000-000000000102',
    'transaction_id', 'audit-p04-refund-transaction',
    'original_transaction_id', 'audit-p04-refund-original'
  ));
  PERFORM record_revenuecat_event(jsonb_build_object(
    'provider_event_id', 'audit-p04-refund',
    'event_type', 'REFUND',
    'app_user_id', '00000000-0000-0000-0000-000000000004',
    'product_id', 'creator_launch_credit_499',
    'purchase_intent_id', 'a0400000-0000-0000-0000-000000000102',
    'transaction_id', 'audit-p04-refund-transaction',
    'original_transaction_id', 'audit-p04-refund-original'
  ));
  PERFORM record_revenuecat_event(jsonb_build_object(
    'provider_event_id', 'audit-p04-refund',
    'event_type', 'REFUND',
    'app_user_id', '00000000-0000-0000-0000-000000000004',
    'product_id', 'creator_launch_credit_499',
    'purchase_intent_id', 'a0400000-0000-0000-0000-000000000102',
    'transaction_id', 'audit-p04-refund-transaction',
    'original_transaction_id', 'audit-p04-refund-original'
  ));
  SELECT count(*) INTO revoked_count
    FROM purchase_credit_ledger
   WHERE idempotency_key = 'audit-p04-refund-original'
     AND credit_state::TEXT IN ('refunded', 'revoked');
  IF revoked_count <> 1 THEN
    RAISE EXCEPTION 'AUDIT-P04: refund did not revoke available credit';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM purchase_events
     WHERE provider_event_id = 'audit-p04-refund'
       AND transaction_id = 'audit-p04-refund-transaction'
       AND original_transaction_id = 'audit-p04-refund-original'
  ) THEN
    RAISE EXCEPTION 'AUDIT-P04: refund event or transaction linkage was not preserved';
  END IF;
  IF (SELECT count(*) FROM purchase_events WHERE provider_event_id = 'audit-p04-refund') <> 1 THEN
    RAISE EXCEPTION 'AUDIT-P04: refund replay was not idempotent';
  END IF;
END;
$$;
RESET ROLE;

CREATE FUNCTION pg_temp.reject_audit_ledger_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit forced ledger failure';
END;
$$;
CREATE TRIGGER audit_reject_ledger_insert
BEFORE INSERT ON purchase_credit_ledger
FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_audit_ledger_insert();

SET LOCAL ROLE service_role;
DO $$
DECLARE
  atomic_failure_observed BOOLEAN := false;
BEGIN
  BEGIN
    PERFORM record_revenuecat_event(jsonb_build_object(
      'provider_event_id', 'audit-p04-atomic-failure',
      'event_type', 'NON_RENEWING_PURCHASE',
      'app_user_id', '00000000-0000-0000-0000-000000000004',
      'product_id', 'creator_launch_credit_499',
      'purchase_intent_id', 'a0400000-0000-0000-0000-000000000103',
      'transaction_id', 'audit-p04-atomic-transaction',
      'original_transaction_id', 'audit-p04-atomic-original'
    ));
    RAISE EXCEPTION 'audit_partial_ledger_failure_was_swallowed';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM = 'audit forced ledger failure' THEN
        atomic_failure_observed := true;
      ELSE
        RAISE;
      END IF;
  END;
  IF NOT atomic_failure_observed THEN
    RAISE EXCEPTION 'AUDIT-P04: benefit write failure did not abort webhook RPC';
  END IF;
END;
$$;
RESET ROLE;
DROP TRIGGER audit_reject_ledger_insert ON purchase_credit_ledger;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM purchase_events
     WHERE provider_event_id = 'audit-p04-atomic-failure'
  ) THEN
    RAISE EXCEPTION 'AUDIT-P04: purchase event survived a failed benefit write';
  END IF;
END;
$$;

INSERT INTO pitch_drafts (
  id,
  created_by_user_id,
  subject_user_id,
  status,
  headline,
  body
)
VALUES
  (
    'a0400000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000004',
    '00000000-0000-0000-0000-000000000001',
    'consent_pending',
    'Free Starter fourteen days',
    'A free campaign may publish for exactly fourteen days.'
  ),
  (
    'a0400000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000004',
    '00000000-0000-0000-0000-000000000001',
    'consent_pending',
    'Free Starter thirty days',
    'A free campaign may not publish for thirty days.'
  ),
  (
    'a0400000-0000-0000-0000-000000000003',
    '00000000-0000-0000-0000-000000000004',
    '00000000-0000-0000-0000-000000000001',
    'consent_pending',
    'Free Starter ninety days',
    'No purchase state permits a ninety-day publish request.'
  );
INSERT INTO pitch_assets (id, pitch_draft_id, uploaded_by_user_id, asset_type, storage_path)
VALUES
  (
    'a0400000-0000-0000-0000-000000000011',
    'a0400000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000004',
    'photo',
    'a0400000-0000-0000-0000-000000000001/approved-photo.jpg'
  ),
  (
    'a0400000-0000-0000-0000-000000000012',
    'a0400000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000004',
    'photo',
    'a0400000-0000-0000-0000-000000000002/approved-photo.jpg'
  ),
  (
    'a0400000-0000-0000-0000-000000000013',
    'a0400000-0000-0000-0000-000000000003',
    '00000000-0000-0000-0000-000000000004',
    'photo',
    'a0400000-0000-0000-0000-000000000003/approved-photo.jpg'
  );
INSERT INTO consent_revisions (
  id,
  pitch_draft_id,
  revision_number,
  headline,
  body,
  structure,
  asset_ids,
  voice_asset_path,
  content_hash
)
VALUES
  (
    'a0400000-0000-0000-0000-000000000021',
    'a0400000-0000-0000-0000-000000000001',
    1,
    'Free Starter fourteen days',
    'A free campaign may publish for exactly fourteen days.',
    '{}'::JSONB,
    ARRAY['a0400000-0000-0000-0000-000000000011']::UUID[],
    NULL,
    encode(digest('audit-p04-revision-14', 'sha256'), 'hex')
  ),
  (
    'a0400000-0000-0000-0000-000000000022',
    'a0400000-0000-0000-0000-000000000002',
    1,
    'Free Starter thirty days',
    'A free campaign may not publish for thirty days.',
    '{}'::JSONB,
    ARRAY['a0400000-0000-0000-0000-000000000012']::UUID[],
    NULL,
    encode(digest('audit-p04-revision-30', 'sha256'), 'hex')
  ),
  (
    'a0400000-0000-0000-0000-000000000023',
    'a0400000-0000-0000-0000-000000000003',
    1,
    'Free Starter ninety days',
    'No purchase state permits a ninety-day publish request.',
    '{}'::JSONB,
    ARRAY['a0400000-0000-0000-0000-000000000013']::UUID[],
    NULL,
    encode(digest('audit-p04-revision-90', 'sha256'), 'hex')
  );
INSERT INTO consent_requests (
  pitch_draft_id,
  subject_user_id,
  token_hash,
  status,
  revision_id
)
VALUES
  ('a0400000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', encode(digest('audit-p04-token-14', 'sha256'), 'hex'), 'pending', 'a0400000-0000-0000-0000-000000000021'),
  ('a0400000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', encode(digest('audit-p04-token-30', 'sha256'), 'hex'), 'pending', 'a0400000-0000-0000-0000-000000000022'),
  ('a0400000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', encode(digest('audit-p04-token-90', 'sha256'), 'hex'), 'pending', 'a0400000-0000-0000-0000-000000000023');
INSERT INTO verification_checks (
  user_id,
  provider,
  provider_reference,
  status,
  verified_at
)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'audit',
  'audit-p04-success',
  'passed',
  now()
);

SET LOCAL ROLE authenticated;
DO $$
DECLARE
  published_campaign UUID;
  actual_days NUMERIC;
  free_thirty_rejected BOOLEAN := false;
  ninety_rejected BOOLEAN := false;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
  SELECT campaign_id INTO published_campaign
    FROM approve_and_publish_pitch(
      'a0400000-0000-0000-0000-000000000001',
      14,
      'a0400000-0000-0000-0000-000000000021',
      ARRAY['a0400000-0000-0000-0000-000000000011']::UUID[],
      true
    );
  SELECT extract(epoch FROM (ends_at - published_at)) / 86400 INTO actual_days
    FROM campaigns
   WHERE id = published_campaign;
  IF actual_days < 13.99 OR actual_days > 14.01 THEN
    RAISE EXCEPTION 'AUDIT-P04: Free Starter duration was % days instead of 14', actual_days;
  END IF;

  BEGIN
    PERFORM * FROM approve_and_publish_pitch(
      'a0400000-0000-0000-0000-000000000002',
      30,
      'a0400000-0000-0000-0000-000000000022',
      ARRAY['a0400000-0000-0000-0000-000000000012']::UUID[],
      true
    );
    RAISE EXCEPTION 'audit_free_thirty_was_accepted';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM = 'audit_free_thirty_was_accepted' THEN
        free_thirty_rejected := false;
      ELSIF SQLERRM ~* '14|duration|campaign_days|entitlement' THEN
        free_thirty_rejected := true;
      ELSE
        RAISE;
      END IF;
  END;
  IF NOT free_thirty_rejected THEN
    RAISE EXCEPTION 'AUDIT-P04: Free Starter accepted a 30-day duration';
  END IF;

  BEGIN
    PERFORM * FROM approve_and_publish_pitch(
      'a0400000-0000-0000-0000-000000000003',
      90,
      'a0400000-0000-0000-0000-000000000023',
      ARRAY['a0400000-0000-0000-0000-000000000013']::UUID[],
      true
    );
    RAISE EXCEPTION 'audit_pass_ninety_was_accepted';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM = 'audit_pass_ninety_was_accepted' THEN
      ninety_rejected := false;
      ELSIF SQLERRM ~* '14|30|90|duration|campaign_days' THEN
        ninety_rejected := true;
      ELSE
        RAISE;
      END IF;
  END;
  IF NOT ninety_rejected THEN
    RAISE EXCEPTION 'AUDIT-P04: publish accepted a 90-day duration';
  END IF;
END;
$$;

RESET ROLE;
INSERT INTO purchase_intents (
  id,
  user_id,
  product_id,
  scope_type,
  scope_id,
  status,
  expires_at
)
SELECT 'a0400000-0000-0000-0000-000000000104',
       owner_user_id,
       'campaign_30d_1999',
       'CAMPAIGN',
       id,
       'issued',
       now() + INTERVAL '1 hour'
  FROM campaigns
 WHERE pitch_draft_id = 'a0400000-0000-0000-0000-000000000001';

SET LOCAL ROLE service_role;
DO $$
DECLARE
  extended_days NUMERIC;
BEGIN
  PERFORM record_revenuecat_event(jsonb_build_object(
    'provider_event_id', 'audit-p04-pass-purchase',
    'event_type', 'INITIAL_PURCHASE',
    'app_user_id', '00000000-0000-0000-0000-000000000001',
    'product_id', 'campaign_30d_1999',
    'purchase_intent_id', 'a0400000-0000-0000-0000-000000000104',
    'transaction_id', 'audit-p04-pass-transaction',
    'original_transaction_id', 'audit-p04-pass-original'
  ));
  SELECT extract(epoch FROM (ends_at - published_at)) / 86400 INTO extended_days
    FROM campaigns
   WHERE pitch_draft_id = 'a0400000-0000-0000-0000-000000000001';
  IF extended_days < 29.99 OR extended_days > 30.01 THEN
    RAISE EXCEPTION 'AUDIT-P04: Campaign Pass did not extend the published campaign to 30 days';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM campaign_entitlements ce
    JOIN campaigns c ON c.id = ce.campaign_id
     WHERE c.pitch_draft_id = 'a0400000-0000-0000-0000-000000000001'
       AND ce.product_id = 'campaign_30d_1999'
       AND ce.active
  ) THEN
    RAISE EXCEPTION 'AUDIT-P04: Campaign Pass entitlement was not activated';
  END IF;
END;
$$;

ROLLBACK;

SELECT 'a04_commerce_ledger.sql passed' AS result;
