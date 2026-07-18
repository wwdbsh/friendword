BEGIN;

CREATE TEMP TABLE commerce_test_state (
  key TEXT PRIMARY KEY,
  value UUID NOT NULL
);
GRANT SELECT, INSERT, UPDATE ON commerce_test_state TO authenticated, service_role;

CREATE FUNCTION pg_temp.revenuecat_payload(
  event_id TEXT,
  event_type TEXT,
  app_user_id TEXT,
  product_id TEXT,
  intent_id UUID,
  transaction_id TEXT,
  original_transaction_id TEXT
)
RETURNS JSONB
LANGUAGE sql
AS $$
  SELECT jsonb_build_object(
    'id', event_id,
    'type', event_type,
    'app_user_id', app_user_id,
    'product_id', product_id,
    'purchased_at_ms', floor(extract(epoch FROM now()) * 1000),
    'expiration_at_ms', NULL,
    'transaction_id', transaction_id,
    'original_transaction_id', original_transaction_id,
    'environment', 'SANDBOX',
    'aliases', '[]'::JSONB,
    'subscriber_attributes', jsonb_build_object(
      'purchase_intent_id', jsonb_build_object('value', intent_id::TEXT)
    )
  );
$$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);

INSERT INTO commerce_test_state (key, value)
SELECT 'creator_intent', purchase_intent_id
  FROM issue_purchase_intent(
    'creator_launch_credit_499',
    '10000000-0000-0000-0000-000000000002'
  );

DO $$
DECLARE
  other_draft_rejected BOOLEAN := false;
  unknown_product_rejected BOOLEAN := false;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
  BEGIN
    PERFORM * FROM issue_purchase_intent(
      'creator_launch_credit_499',
      '10000000-0000-0000-0000-000000000002'
    );
  EXCEPTION WHEN raise_exception THEN
    other_draft_rejected := SQLERRM ~* 'scope|owned|draft';
  END;
  IF NOT other_draft_rejected THEN
    RAISE EXCEPTION 'another introducer issued an intent for a draft they do not own';
  END IF;

  BEGIN
    PERFORM * FROM issue_purchase_intent(
      'unknown_product',
      '10000000-0000-0000-0000-000000000002'
    );
  EXCEPTION WHEN raise_exception THEN
    unknown_product_rejected := SQLERRM ~* 'unknown product';
  END;
  IF NOT unknown_product_rejected THEN
    RAISE EXCEPTION 'unknown product was accepted by issue_purchase_intent';
  END IF;
END;
$$;

SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);
DO $$
DECLARE
  own_count INTEGER;
BEGIN
  SELECT count(*) INTO own_count
    FROM purchase_intents
   WHERE id = (SELECT value FROM commerce_test_state WHERE key = 'creator_intent');
  IF own_count <> 1 THEN
    RAISE EXCEPTION 'intent owner could not select their purchase intent';
  END IF;
END;
$$;

SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM purchase_intents
     WHERE id = (SELECT value FROM commerce_test_state WHERE key = 'creator_intent')
  ) THEN
    RAISE EXCEPTION 'another user could select a purchase intent they do not own';
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
-- 0038 enforces one issued intent per scope, so this stale intent (used to
-- prove the webhook parks a lapsed-intent purchase for review) is seeded as
-- 'expired' rather than a second issued row for the live creator_intent scope.
VALUES (
  '14000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000004',
  'creator_launch_credit_499',
  'PITCH_DRAFT',
  '10000000-0000-0000-0000-000000000002',
  'expired',
  now() - INTERVAL '1 second'
);

SET LOCAL ROLE service_role;
-- Second-audit contract (0027): money-received events that cannot be
-- auto-attributed are parked in the durable review queue instead of
-- raising. Each case must grant no benefit and leave a review row.
DO $$
DECLARE
  result JSONB;
BEGIN
  result := record_revenuecat_event(pg_temp.revenuecat_payload(
    'commerce-expired',
    'NON_RENEWING_PURCHASE',
    '00000000-0000-0000-0000-000000000004',
    'creator_launch_credit_499',
    '14000000-0000-0000-0000-000000000001',
    'commerce-expired-tx',
    'commerce-expired-original'
  ));
  IF (result ->> 'needs_review')::BOOLEAN IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'expired purchase intent did not go to review';
  END IF;
  IF EXISTS (
    SELECT 1 FROM purchase_credit_ledger
     WHERE idempotency_key = 'commerce-expired-original'
  ) THEN
    RAISE EXCEPTION 'expired purchase intent granted a credit';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM purchase_event_reviews
     WHERE provider_event_id = 'commerce-expired' AND status = 'open'
  ) THEN
    RAISE EXCEPTION 'expired purchase intent left no review row';
  END IF;

  result := record_revenuecat_event(pg_temp.revenuecat_payload(
    'commerce-mismatch',
    'NON_RENEWING_PURCHASE',
    '00000000-0000-0000-0000-000000000001',
    'creator_launch_credit_499',
    (SELECT value FROM commerce_test_state WHERE key = 'creator_intent'),
    'commerce-mismatch-tx',
    'commerce-mismatch-original'
  ));
  IF (result ->> 'needs_review')::BOOLEAN IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'mismatched app user did not go to review';
  END IF;
  IF EXISTS (
    SELECT 1 FROM purchase_credit_ledger
     WHERE idempotency_key = 'commerce-mismatch-original'
  ) THEN
    RAISE EXCEPTION 'mismatched app user granted a credit';
  END IF;

  result := record_revenuecat_event(pg_temp.revenuecat_payload(
    'commerce-unknown',
    'NON_RENEWING_PURCHASE',
    '00000000-0000-0000-0000-000000000004',
    'unknown_product',
    (SELECT value FROM commerce_test_state WHERE key = 'creator_intent'),
    'commerce-unknown-tx',
    'commerce-unknown-original'
  ));
  IF (result ->> 'needs_review')::BOOLEAN IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'unknown product did not go to review';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM purchase_event_reviews
     WHERE provider_event_id = 'commerce-unknown'
       AND reason = 'unknown_product'
  ) THEN
    RAISE EXCEPTION 'unknown product left no review row';
  END IF;
END;
$$;

DO $$
DECLARE
  first_result JSONB;
  retry_result JSONB;
  creator_intent UUID := (SELECT value FROM commerce_test_state WHERE key = 'creator_intent');
BEGIN
  first_result := record_revenuecat_event(pg_temp.revenuecat_payload(
    'commerce-creator-purchase',
    'NON_RENEWING_PURCHASE',
    '00000000-0000-0000-0000-000000000004',
    'creator_launch_credit_499',
    creator_intent,
    'commerce-creator-tx',
    'commerce-creator-original'
  ));
  retry_result := record_revenuecat_event(pg_temp.revenuecat_payload(
    'commerce-creator-purchase',
    'NON_RENEWING_PURCHASE',
    '00000000-0000-0000-0000-000000000004',
    'creator_launch_credit_499',
    creator_intent,
    'commerce-creator-tx',
    'commerce-creator-original'
  ));
  IF first_result ->> 'recorded' IS DISTINCT FROM 'true'
     OR first_result ->> 'deduplicated' IS DISTINCT FROM 'false'
     OR retry_result ->> 'deduplicated' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'purchase RPC did not report record and deduplication state';
  END IF;
  IF (SELECT count(*) FROM purchase_events WHERE provider_event_id = 'commerce-creator-purchase') <> 1
     OR (SELECT count(*) FROM purchase_credit_ledger WHERE idempotency_key = 'commerce-creator-original') <> 1 THEN
    RAISE EXCEPTION 'purchase event and creator benefit were not idempotent';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM purchase_events
     WHERE provider_event_id = 'commerce-creator-purchase'
       AND transaction_id = 'commerce-creator-tx'
       AND original_transaction_id = 'commerce-creator-original'
       AND environment = 'SANDBOX'
       AND event_type = 'NON_RENEWING_PURCHASE'
       AND raw_app_user_id = '00000000-0000-0000-0000-000000000004'
  ) THEN
    RAISE EXCEPTION 'purchase event did not retain the RevenueCat transaction fields';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM analytics_events
     WHERE user_id = '00000000-0000-0000-0000-000000000004'
       AND event_name = 'creator_launch_purchased'
       AND properties ->> 'provider_event_id' = 'commerce-creator-purchase'
  ) THEN
    RAISE EXCEPTION 'authoritative purchase analytics was not recorded';
  END IF;

  -- Second-audit contract (0027): reusing a consumed intent for a
  -- different transaction goes to the review queue and grants nothing.
  DECLARE
    reused_result JSONB;
  BEGIN
    reused_result := record_revenuecat_event(pg_temp.revenuecat_payload(
      'commerce-reused-intent',
      'NON_RENEWING_PURCHASE',
      '00000000-0000-0000-0000-000000000004',
      'creator_launch_credit_499',
      creator_intent,
      'commerce-reused-intent-tx',
      'commerce-reused-intent-original'
    ));
    IF (reused_result ->> 'needs_review')::BOOLEAN IS DISTINCT FROM true
       OR EXISTS (
         SELECT 1
           FROM purchase_credit_ledger
          WHERE idempotency_key = 'commerce-reused-intent-original'
       ) THEN
      RAISE EXCEPTION 'a consumed purchase intent was reused for another transaction';
    END IF;
  END;
END;
$$;
RESET ROLE;

DELETE FROM purchase_credit_ledger
 WHERE idempotency_key = 'commerce-creator-original';

SET LOCAL ROLE service_role;
DO $$
BEGIN
  PERFORM record_revenuecat_event(pg_temp.revenuecat_payload(
    'commerce-creator-purchase',
    'NON_RENEWING_PURCHASE',
    '00000000-0000-0000-0000-000000000004',
    'creator_launch_credit_499',
    (SELECT value FROM commerce_test_state WHERE key = 'creator_intent'),
    'commerce-creator-tx',
    'commerce-creator-original'
  ));
  IF NOT EXISTS (
    SELECT 1
      FROM purchase_credit_ledger
     WHERE idempotency_key = 'commerce-creator-original'
       AND credit_state = 'available'
  ) THEN
    RAISE EXCEPTION 'event replay did not recover a missing creator benefit';
  END IF;

  PERFORM record_revenuecat_event(pg_temp.revenuecat_payload(
    'commerce-creator-cancel',
    'CANCELLATION',
    '00000000-0000-0000-0000-000000000004',
    'creator_launch_credit_499',
    (SELECT value FROM commerce_test_state WHERE key = 'creator_intent'),
    'commerce-creator-tx',
    'commerce-creator-original'
  ));
  IF NOT EXISTS (
    SELECT 1
      FROM purchase_credit_ledger
     WHERE idempotency_key = 'commerce-creator-original'
       AND credit_state = 'revoked'
  ) THEN
    RAISE EXCEPTION 'cancellation did not revoke an available creator credit';
  END IF;
END;
$$;
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);
INSERT INTO commerce_test_state (key, value)
SELECT 'consume_intent', purchase_intent_id
  FROM issue_purchase_intent(
    'creator_launch_credit_499',
    '10000000-0000-0000-0000-000000000002'
  );
RESET ROLE;

SET LOCAL ROLE service_role;
SELECT record_revenuecat_event(pg_temp.revenuecat_payload(
  'commerce-consume-purchase',
  'NON_RENEWING_PURCHASE',
  '00000000-0000-0000-0000-000000000004',
  'creator_launch_credit_499',
  (SELECT value FROM commerce_test_state WHERE key = 'consume_intent'),
  'commerce-consume-tx',
  'commerce-consume-original'
));
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);
INSERT INTO commerce_test_state (key, value)
SELECT 'consume_ledger', reserve_creator_credit('10000000-0000-0000-0000-000000000002');
RESET ROLE;

SET LOCAL ROLE service_role;
SELECT consume_creator_credit((SELECT value FROM commerce_test_state WHERE key = 'consume_ledger'));
SELECT record_revenuecat_event(pg_temp.revenuecat_payload(
  'commerce-consume-cancel',
  'REFUND',
  '00000000-0000-0000-0000-000000000004',
  'creator_launch_credit_499',
  (SELECT value FROM commerce_test_state WHERE key = 'consume_intent'),
  'commerce-consume-tx',
  'commerce-consume-original'
));
SELECT record_revenuecat_event(pg_temp.revenuecat_payload(
  'commerce-consume-restore',
  'NON_RENEWING_PURCHASE',
  '00000000-0000-0000-0000-000000000004',
  'creator_launch_credit_499',
  (SELECT value FROM commerce_test_state WHERE key = 'consume_intent'),
  'commerce-consume-restore-tx',
  'commerce-consume-original'
));
DO $$
BEGIN
  IF (SELECT count(*) FROM purchase_credit_ledger WHERE idempotency_key = 'commerce-consume-original') <> 1
     OR NOT EXISTS (
       SELECT 1
         FROM purchase_credit_ledger
        WHERE idempotency_key = 'commerce-consume-original'
          AND credit_state = 'consumed'
     ) THEN
    RAISE EXCEPTION 'refund or restore changed a consumed creator credit';
  END IF;
END;
$$;
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);
INSERT INTO commerce_test_state (key, value)
SELECT 'release_intent', purchase_intent_id
  FROM issue_purchase_intent(
    'creator_launch_credit_499',
    '10000000-0000-0000-0000-000000000002'
  );
RESET ROLE;

SET LOCAL ROLE service_role;
SELECT record_revenuecat_event(pg_temp.revenuecat_payload(
  'commerce-release-purchase',
  'NON_RENEWING_PURCHASE',
  '00000000-0000-0000-0000-000000000004',
  'creator_launch_credit_499',
  (SELECT value FROM commerce_test_state WHERE key = 'release_intent'),
  'commerce-release-tx',
  'commerce-release-original'
));
RESET ROLE;

INSERT INTO purchase_credit_ledger (
  user_id,
  credit_state,
  product_id,
  pitch_draft_id,
  idempotency_key
)
VALUES (
  '00000000-0000-0000-0000-000000000004',
  'available',
  'creator_launch_credit_499',
  '10000000-0000-0000-0000-000000000002',
  'commerce-release-extra-original'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);
INSERT INTO commerce_test_state (key, value)
SELECT 'release_ledger', reserve_creator_credit('10000000-0000-0000-0000-000000000002');
DO $$
DECLARE
  double_reserve_rejected BOOLEAN := false;
BEGIN
  BEGIN
    PERFORM reserve_creator_credit('10000000-0000-0000-0000-000000000002');
  EXCEPTION WHEN raise_exception THEN
    double_reserve_rejected := SQLERRM ~* 'no available|already reserved';
  END;
  IF NOT double_reserve_rejected THEN
    RAISE EXCEPTION 'the same creator credit flow was reserved twice';
  END IF;
END;
$$;
SELECT release_creator_credit((SELECT value FROM commerce_test_state WHERE key = 'release_ledger'));
RESET ROLE;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM purchase_credit_ledger
     WHERE id = (SELECT value FROM commerce_test_state WHERE key = 'release_ledger')
       AND credit_state = 'available'
  ) THEN
    RAISE EXCEPTION 'release did not return a reserved creator credit to available';
  END IF;
END;
$$;

INSERT INTO pitch_drafts (id, created_by_user_id, status, headline, body)
VALUES
  (
    '14000000-0000-0000-0000-000000000010',
    '00000000-0000-0000-0000-000000000004',
    'draft',
    'Reserved refund draft',
    'Reserved refund body'
  ),
  (
    '14000000-0000-0000-0000-000000000020',
    '00000000-0000-0000-0000-000000000004',
    'draft',
    'Out of order refund draft',
    'Out of order refund body'
  );

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);
INSERT INTO commerce_test_state (key, value)
SELECT 'reserved_refund_intent', purchase_intent_id
  FROM issue_purchase_intent(
    'creator_launch_credit_499',
    '14000000-0000-0000-0000-000000000010'
  );
INSERT INTO commerce_test_state (key, value)
SELECT 'out_of_order_intent', purchase_intent_id
  FROM issue_purchase_intent(
    'creator_launch_credit_499',
    '14000000-0000-0000-0000-000000000020'
  );
RESET ROLE;

SET LOCAL ROLE service_role;
SELECT record_revenuecat_event(pg_temp.revenuecat_payload(
  'commerce-reserved-refund-purchase',
  'NON_RENEWING_PURCHASE',
  '00000000-0000-0000-0000-000000000004',
  'creator_launch_credit_499',
  (SELECT value FROM commerce_test_state WHERE key = 'reserved_refund_intent'),
  'commerce-reserved-refund-tx',
  'commerce-reserved-refund-original'
));
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);
INSERT INTO commerce_test_state (key, value)
SELECT 'reserved_refund_ledger', reserve_creator_credit(
  '14000000-0000-0000-0000-000000000010'
);
RESET ROLE;

SET LOCAL ROLE service_role;
SELECT record_revenuecat_event(pg_temp.revenuecat_payload(
  'commerce-reserved-refund',
  'REFUND',
  '00000000-0000-0000-0000-000000000004',
  'creator_launch_credit_499',
  (SELECT value FROM commerce_test_state WHERE key = 'reserved_refund_intent'),
  'commerce-reserved-refund-tx',
  'commerce-reserved-refund-original'
));
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);
DO $$
DECLARE
  release_rejected BOOLEAN := false;
BEGIN
  BEGIN
    PERFORM release_creator_credit(
      (SELECT value FROM commerce_test_state WHERE key = 'reserved_refund_ledger')
    );
  EXCEPTION WHEN raise_exception THEN
    release_rejected := SQLERRM ~* 'not reserved';
  END;
  IF NOT release_rejected THEN
    RAISE EXCEPTION 'a refunded reserved credit was released back to available';
  END IF;
END;
$$;
RESET ROLE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM purchase_credit_ledger
     WHERE id = (SELECT value FROM commerce_test_state WHERE key = 'reserved_refund_ledger')
       AND credit_state = 'revoked'
  ) THEN
    RAISE EXCEPTION 'refund did not revoke a reserved creator credit';
  END IF;
END;
$$;

SET LOCAL ROLE service_role;
SELECT record_revenuecat_event(pg_temp.revenuecat_payload(
  'commerce-out-of-order-refund',
  'REFUND',
  '00000000-0000-0000-0000-000000000004',
  'creator_launch_credit_499',
  (SELECT value FROM commerce_test_state WHERE key = 'out_of_order_intent'),
  'commerce-out-of-order-tx',
  'commerce-out-of-order-original'
));
SELECT record_revenuecat_event(pg_temp.revenuecat_payload(
  'commerce-out-of-order-purchase',
  'NON_RENEWING_PURCHASE',
  '00000000-0000-0000-0000-000000000004',
  'creator_launch_credit_499',
  (SELECT value FROM commerce_test_state WHERE key = 'out_of_order_intent'),
  'commerce-out-of-order-tx',
  'commerce-out-of-order-original'
));
RESET ROLE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM purchase_credit_ledger
     WHERE idempotency_key = 'commerce-out-of-order-original'
       AND credit_state = 'revoked'
  ) THEN
    RAISE EXCEPTION 'out-of-order refund allowed a creator credit to become available';
  END IF;
END;
$$;

UPDATE campaigns
   SET published_at = now(),
       ends_at = now() + INTERVAL '14 days'
 WHERE id = '20000000-0000-0000-0000-000000000001';

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
INSERT INTO commerce_test_state (key, value)
SELECT 'pass_intent', purchase_intent_id
  FROM issue_purchase_intent(
    'campaign_pass_30d_1999',
    '20000000-0000-0000-0000-000000000001'
  );
DO $$
DECLARE
  other_campaign_rejected BOOLEAN := false;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
  BEGIN
    PERFORM * FROM issue_purchase_intent(
      'campaign_pass_30d_1999',
      '20000000-0000-0000-0000-000000000001'
    );
  EXCEPTION WHEN raise_exception THEN
    other_campaign_rejected := SQLERRM ~* 'scope|owned|campaign';
  END;
  IF NOT other_campaign_rejected THEN
    RAISE EXCEPTION 'another user issued a pass intent for a campaign they do not own';
  END IF;
END;
$$;
RESET ROLE;

SET LOCAL ROLE service_role;
DO $$
DECLARE
  pass_result JSONB;
  transfer_result JSONB;
  actual_days NUMERIC;
BEGIN
  pass_result := record_revenuecat_event(pg_temp.revenuecat_payload(
    'commerce-pass-purchase',
    'INITIAL_PURCHASE',
    '00000000-0000-0000-0000-000000000002',
    'campaign_pass_30d_1999',
    (SELECT value FROM commerce_test_state WHERE key = 'pass_intent'),
    'commerce-pass-tx',
    'commerce-pass-original'
  ));
  -- 0038 (third audit P0-6): a pass now STACKS 30 days on top of the
  -- remaining window instead of taking max(window, 30d). The campaign had a
  -- 14-day window left, so the paid window becomes 14 + 30 = 44 days.
  SELECT extract(epoch FROM (ends_at - now())) / 86400 INTO actual_days
    FROM campaigns
   WHERE id = '20000000-0000-0000-0000-000000000001';
  IF actual_days < 43.99 OR actual_days > 44.01
     OR pass_result #>> '{benefit,kind}' <> 'campaign_pass'
     OR NOT EXISTS (
       SELECT 1
         FROM campaign_entitlements
        WHERE campaign_id = '20000000-0000-0000-0000-000000000001'
          AND product_id = 'campaign_pass_30d_1999'
          AND active
     ) THEN
    RAISE EXCEPTION 'campaign pass did not stack 30d onto the remaining window';
  END IF;

  PERFORM record_revenuecat_event(pg_temp.revenuecat_payload(
    'commerce-pass-expiration',
    'EXPIRATION',
    '00000000-0000-0000-0000-000000000002',
    'campaign_pass_30d_1999',
    (SELECT value FROM commerce_test_state WHERE key = 'pass_intent'),
    'commerce-pass-tx',
    'commerce-pass-original'
  ));
  IF EXISTS (
    SELECT 1
      FROM campaign_entitlements
     WHERE campaign_id = '20000000-0000-0000-0000-000000000001'
       AND product_id = 'campaign_pass_30d_1999'
       AND active
  ) THEN
    RAISE EXCEPTION 'expiration did not deactivate the campaign pass';
  END IF;

  transfer_result := record_revenuecat_event(
    pg_temp.revenuecat_payload(
      'commerce-pass-transfer',
      'TRANSFER',
      '00000000-0000-0000-0000-000000000002',
      'campaign_pass_30d_1999',
      (SELECT value FROM commerce_test_state WHERE key = 'pass_intent'),
      'commerce-pass-transfer-tx',
      'commerce-pass-original'
    ) - 'transaction_id' - 'original_transaction_id'
  );
  IF transfer_result ->> 'needs_review' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'transfer did not request manual review';
  END IF;
END;
$$;
RESET ROLE;

INSERT INTO pitch_drafts (
  id,
  created_by_user_id,
  subject_user_id,
  status,
  headline,
  body
)
VALUES (
  -- H-7 (migration 0039): user 0002 already owns the seed campaign, which
  -- this suite still needs live after this block, so the one-active-campaign
  -- guard forbids a second 0002 campaign. This "second pass" scenario is
  -- owner-identity-agnostic, so it is re-homed on user 0003 (who owns no other
  -- campaign). Every 0002 reference in this block moves to 0003 in lockstep.
  '14000000-0000-0000-0000-000000000030',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000003',
  'published',
  'Second pass campaign',
  'Second pass campaign body'
);
INSERT INTO consent_requests (
  pitch_draft_id,
  subject_user_id,
  token_hash,
  status,
  responded_at
)
VALUES (
  '14000000-0000-0000-0000-000000000030',
  '00000000-0000-0000-0000-000000000003',
  encode(digest('commerce-second-pass-token', 'sha256'), 'hex'),
  'approved',
  now()
);
INSERT INTO campaigns (
  id,
  pitch_draft_id,
  owner_user_id,
  status,
  published_at,
  ends_at
)
VALUES (
  '14000000-0000-0000-0000-000000000031',
  '14000000-0000-0000-0000-000000000030',
  '00000000-0000-0000-0000-000000000003',
  'published',
  now(),
  now() + INTERVAL '14 days'
);
INSERT INTO campaign_memberships (campaign_id, user_id, role)
VALUES
  (
    '14000000-0000-0000-0000-000000000031',
    '00000000-0000-0000-0000-000000000003',
    'DATER_OWNER'
  ),
  (
    '14000000-0000-0000-0000-000000000031',
    '00000000-0000-0000-0000-000000000001',
    'INTRODUCER'
  );
INSERT INTO purchase_intents (
  id,
  user_id,
  product_id,
  scope_type,
  scope_id,
  status,
  expires_at
)
VALUES (
  '14000000-0000-0000-0000-000000000032',
  '00000000-0000-0000-0000-000000000003',
  'campaign_pass_30d_1999',
  'CAMPAIGN',
  '14000000-0000-0000-0000-000000000031',
  'issued',
  now() + INTERVAL '1 hour'
);

SET LOCAL ROLE service_role;
DO $$
DECLARE
  cross_scope_rejected BOOLEAN := false;
BEGIN
  BEGIN
    PERFORM record_revenuecat_event(pg_temp.revenuecat_payload(
      'commerce-pass-cross-scope',
      'INITIAL_PURCHASE',
      '00000000-0000-0000-0000-000000000003',
      'campaign_pass_30d_1999',
      '14000000-0000-0000-0000-000000000032',
      'commerce-pass-cross-scope-tx',
      'commerce-pass-original'
    ));
  EXCEPTION WHEN raise_exception THEN
    cross_scope_rejected := SQLERRM ~* 'original transaction.*scope';
  END;
  IF NOT cross_scope_rejected THEN
    RAISE EXCEPTION 'one pass transaction was applied to multiple campaigns';
  END IF;
END;
$$;
RESET ROLE;

SET LOCAL ROLE service_role;
DO $$
BEGIN
  PERFORM record_revenuecat_event(pg_temp.revenuecat_payload(
    'commerce-pass-out-of-order-refund',
    'REFUND',
    '00000000-0000-0000-0000-000000000003',
    'campaign_pass_30d_1999',
    '14000000-0000-0000-0000-000000000032',
    'commerce-pass-out-of-order-tx',
    'commerce-pass-out-of-order-original'
  ));
  PERFORM record_revenuecat_event(pg_temp.revenuecat_payload(
    'commerce-pass-out-of-order-purchase',
    'INITIAL_PURCHASE',
    '00000000-0000-0000-0000-000000000003',
    'campaign_pass_30d_1999',
    '14000000-0000-0000-0000-000000000032',
    'commerce-pass-out-of-order-tx',
    'commerce-pass-out-of-order-original'
  ));
  IF NOT EXISTS (
    SELECT 1
      FROM campaign_entitlements
     WHERE campaign_id = '14000000-0000-0000-0000-000000000031'
       AND product_id = 'campaign_pass_30d_1999'
       AND original_transaction_id = 'commerce-pass-out-of-order-original'
       AND NOT active
  ) THEN
    RAISE EXCEPTION 'out-of-order refund allowed a campaign pass to become active';
  END IF;
END;
$$;
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
INSERT INTO commerce_test_state (key, value)
SELECT 'pass_intent_b', purchase_intent_id
  FROM issue_purchase_intent(
    'campaign_pass_30d_1999',
    '20000000-0000-0000-0000-000000000001'
  );
RESET ROLE;

SET LOCAL ROLE service_role;
DO $$
BEGIN
  PERFORM record_revenuecat_event(pg_temp.revenuecat_payload(
    'commerce-pass-purchase-b',
    'INITIAL_PURCHASE',
    '00000000-0000-0000-0000-000000000002',
    'campaign_pass_30d_1999',
    (SELECT value FROM commerce_test_state WHERE key = 'pass_intent_b'),
    'commerce-pass-tx-b',
    'commerce-pass-original-b'
  ));
  PERFORM record_revenuecat_event(pg_temp.revenuecat_payload(
    'commerce-pass-stale-expiration',
    'EXPIRATION',
    '00000000-0000-0000-0000-000000000002',
    'campaign_pass_30d_1999',
    (SELECT value FROM commerce_test_state WHERE key = 'pass_intent'),
    'commerce-pass-tx',
    'commerce-pass-original'
  ));
  IF NOT EXISTS (
    SELECT 1
      FROM campaign_entitlements
     WHERE campaign_id = '20000000-0000-0000-0000-000000000001'
       AND product_id = 'campaign_pass_30d_1999'
       AND original_transaction_id = 'commerce-pass-original-b'
       AND active
  ) THEN
    RAISE EXCEPTION 'an older pass expiration deactivated a newer pass purchase';
  END IF;
  PERFORM record_revenuecat_event(pg_temp.revenuecat_payload(
    'commerce-pass-expiration-b',
    'EXPIRATION',
    '00000000-0000-0000-0000-000000000002',
    'campaign_pass_30d_1999',
    (SELECT value FROM commerce_test_state WHERE key = 'pass_intent_b'),
    'commerce-pass-tx-b',
    'commerce-pass-original-b'
  ));
  IF EXISTS (
    SELECT 1
      FROM campaign_entitlements
     WHERE campaign_id = '20000000-0000-0000-0000-000000000001'
       AND product_id = 'campaign_pass_30d_1999'
       AND active
  ) THEN
    RAISE EXCEPTION 'the current pass expiration did not deactivate its entitlement';
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
-- 0038 allows only one issued intent per scope. These two intents seed two
-- separate pass lineages (c and d) for the refund/renewal lineage tests
-- below; the webhook attributes a purchase to a consumed intent just as well,
-- so they are seeded 'consumed' to avoid colliding on the live scope slot.
VALUES
  (
    '14000000-0000-0000-0000-000000000040',
    '00000000-0000-0000-0000-000000000002',
    'campaign_pass_30d_1999',
    'CAMPAIGN',
    '20000000-0000-0000-0000-000000000001',
    'consumed',
    now() + INTERVAL '1 hour'
  ),
  (
    '14000000-0000-0000-0000-000000000041',
    '00000000-0000-0000-0000-000000000002',
    'campaign_pass_30d_1999',
    'CAMPAIGN',
    '20000000-0000-0000-0000-000000000001',
    'consumed',
    now() + INTERVAL '1 hour'
  );

SET LOCAL ROLE service_role;
DO $$
DECLARE
  renewal_result JSONB;
BEGIN
  PERFORM record_revenuecat_event(jsonb_set(
    pg_temp.revenuecat_payload(
      'commerce-pass-purchase-c',
      'INITIAL_PURCHASE',
      '00000000-0000-0000-0000-000000000002',
      'campaign_pass_30d_1999',
      '14000000-0000-0000-0000-000000000040',
      'commerce-pass-tx-c',
      'commerce-pass-original-c'
    ),
    '{purchased_at_ms}',
    to_jsonb(floor(extract(epoch FROM clock_timestamp()) * 1000))
  ));
  PERFORM record_revenuecat_event(jsonb_set(
    pg_temp.revenuecat_payload(
      'commerce-pass-purchase-d',
      'INITIAL_PURCHASE',
      '00000000-0000-0000-0000-000000000002',
      'campaign_pass_30d_1999',
      '14000000-0000-0000-0000-000000000041',
      'commerce-pass-tx-d',
      'commerce-pass-original-d'
    ),
    '{purchased_at_ms}',
    to_jsonb(floor(extract(epoch FROM clock_timestamp() + INTERVAL '1 day') * 1000))
  ));
  PERFORM record_revenuecat_event(pg_temp.revenuecat_payload(
    'commerce-pass-refund-d',
    'REFUND',
    '00000000-0000-0000-0000-000000000002',
    'campaign_pass_30d_1999',
    '14000000-0000-0000-0000-000000000041',
    'commerce-pass-tx-d',
    'commerce-pass-original-d'
  ));
  IF NOT EXISTS (
    SELECT 1
      FROM campaign_entitlements
     WHERE campaign_id = '20000000-0000-0000-0000-000000000001'
       AND product_id = 'campaign_pass_30d_1999'
       AND original_transaction_id = 'commerce-pass-original-c'
       AND active
  ) THEN
    RAISE EXCEPTION 'refunding the latest pass did not restore an older valid pass';
  END IF;

  PERFORM record_revenuecat_event(pg_temp.revenuecat_payload(
    'commerce-pass-cancel-c',
    'CANCELLATION',
    '00000000-0000-0000-0000-000000000002',
    'campaign_pass_30d_1999',
    '14000000-0000-0000-0000-000000000040',
    'commerce-pass-tx-c',
    'commerce-pass-original-c'
  ));
  IF EXISTS (
    SELECT 1
      FROM campaign_entitlements
     WHERE campaign_id = '20000000-0000-0000-0000-000000000001'
       AND product_id = 'campaign_pass_30d_1999'
       AND active
  ) THEN
    RAISE EXCEPTION 'cancelling the final valid pass left the entitlement active';
  END IF;

  renewal_result := record_revenuecat_event(jsonb_set(
    pg_temp.revenuecat_payload(
      'commerce-pass-renewal-c',
      'RENEWAL',
      '00000000-0000-0000-0000-000000000002',
      'campaign_pass_30d_1999',
      '14000000-0000-0000-0000-000000000040',
      'commerce-pass-renewal-tx-c',
      'commerce-pass-original-c'
    ),
    '{purchased_at_ms}',
    to_jsonb(floor(extract(epoch FROM clock_timestamp() + INTERVAL '10 days') * 1000))
  ));
  IF renewal_result #>> '{benefit,active}' IS DISTINCT FROM 'true'
     OR NOT EXISTS (
       SELECT 1
         FROM campaign_entitlements
        WHERE campaign_id = '20000000-0000-0000-0000-000000000001'
          AND product_id = 'campaign_pass_30d_1999'
          AND original_transaction_id = 'commerce-pass-original-c'
          AND active
     ) THEN
    RAISE EXCEPTION 'a renewal did not reactivate its cancelled pass lineage';
  END IF;
END;
$$;
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
DO $$
DECLARE
  invalid_duration_rejected BOOLEAN := false;
BEGIN
  BEGIN
    PERFORM * FROM approve_and_publish_pitch(
      '10000000-0000-0000-0000-000000000002',
      30,
      '13000000-0000-0000-0000-000000000001',
      ARRAY[]::UUID[],
      true
    );
  EXCEPTION WHEN raise_exception THEN
    invalid_duration_rejected := SQLERRM ~* '14|campaign_days';
  END;
  IF NOT invalid_duration_rejected THEN
    RAISE EXCEPTION 'approve_and_publish_pitch accepted a duration other than 14 days';
  END IF;
END;
$$;
RESET ROLE;

ROLLBACK;

SELECT '14_commerce.sql passed' AS result;
