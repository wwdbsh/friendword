-- AUDIT3 REGRESSION: third audit Slice 4 (P0-3, P0-5, P0-6).
-- Encodes the *fixed* commerce state machine; red-first, so it FAILS until
-- migration 0038_commerce_state_machine.sql lands.
--
-- P0-5  Intent concurrency: a partial unique index guarantees at most one
--       issued intent per (user, product, scope); a re-issue returns the
--       same intent id instead of a sibling, and a raw duplicate insert is
--       refused by the database.
-- P0-6  Campaign Pass state machine: a lapsed (expired) campaign can be
--       repurchased and revived; the paid window stacks 30 days on the
--       greater of now and the remaining window; scheduler lag never
--       changes the outcome; the beta gate parks a blocked revival instead
--       of dropping the grant.
-- P0-3  Alias attribution and a service-role transfer-review resolver.

BEGIN;

CREATE TEMP TABLE c06_state (key TEXT PRIMARY KEY, id UUID NOT NULL);
GRANT SELECT, INSERT, UPDATE ON c06_state TO authenticated, service_role;

-- ========================================================================
-- P0-5  INTENT CONCURRENCY / DOUBLE-TAP UNIQUENESS
-- ========================================================================

-- Re-issuing the same (user, product, scope) returns the SAME intent id.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);
DO $$
DECLARE
  first_id UUID;
  second_id UUID;
BEGIN
  SELECT purchase_intent_id INTO first_id
    FROM issue_purchase_intent('creator_launch_credit_499', '10000000-0000-0000-0000-000000000002');
  SELECT purchase_intent_id INTO second_id
    FROM issue_purchase_intent('creator_launch_credit_499', '10000000-0000-0000-0000-000000000002');
  IF first_id IS DISTINCT FROM second_id THEN
    RAISE EXCEPTION 'c06 P0-5: a double-tap minted a sibling intent (% vs %)', first_id, second_id;
  END IF;
  IF (SELECT count(*) FROM purchase_intents
       WHERE user_id = '00000000-0000-0000-0000-000000000004'
         AND product_id = 'creator_launch_credit_499'
         AND scope_id = '10000000-0000-0000-0000-000000000002'
         AND status = 'issued') <> 1 THEN
    RAISE EXCEPTION 'c06 P0-5: more than one issued intent survived for the same scope';
  END IF;
END;
$$;
RESET ROLE;

-- The database itself refuses a second concurrent issued row (simulates the
-- lost race of two double-tap sessions).
DO $$
DECLARE
  duplicate_blocked BOOLEAN := false;
BEGIN
  BEGIN
    INSERT INTO purchase_intents (user_id, product_id, scope_type, scope_id, status, expires_at)
    VALUES (
      '00000000-0000-0000-0000-000000000004',
      'creator_launch_credit_499',
      'PITCH_DRAFT',
      '10000000-0000-0000-0000-000000000002',
      'issued',
      now() + INTERVAL '1 hour'
    );
  EXCEPTION WHEN unique_violation THEN
    duplicate_blocked := true;
  END;
  IF NOT duplicate_blocked THEN
    RAISE EXCEPTION 'c06 P0-5: the database allowed a second issued intent for the same scope';
  END IF;
END;
$$;

-- ========================================================================
-- P0-6  CAMPAIGN PASS: LAPSE -> REPURCHASE, STACKING, REVIVAL
-- Fixture: a dater-owned published campaign with a real remaining window.
-- ========================================================================

INSERT INTO pitch_drafts (id, created_by_user_id, subject_user_id, status, headline, body)
VALUES (
  'c6000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002',
  'published',
  'c06 pass campaign',
  'c06 pass campaign body'
);
INSERT INTO consent_requests (pitch_draft_id, subject_user_id, token_hash, status, responded_at)
VALUES (
  'c6000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002',
  encode(digest('c06-consent-token', 'sha256'), 'hex'),
  'approved',
  now()
);
INSERT INTO campaigns (id, pitch_draft_id, owner_user_id, status, published_at, ends_at)
VALUES (
  'c6000000-0000-0000-0000-000000000002',
  'c6000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002',
  'published',
  now(),
  now() + INTERVAL '10 days'
);
INSERT INTO campaign_memberships (campaign_id, user_id, role)
VALUES
  ('c6000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002', 'DATER_OWNER'),
  ('c6000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'INTRODUCER');

-- 1. Active campaign (10 days left) purchase stacks the window to now+40d.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
INSERT INTO c06_state
SELECT 'active_intent', purchase_intent_id
  FROM issue_purchase_intent('campaign_30d_1999', 'c6000000-0000-0000-0000-000000000002');
RESET ROLE;

SET LOCAL ROLE service_role;
DO $$
DECLARE
  days NUMERIC;
BEGIN
  PERFORM record_revenuecat_event(jsonb_build_object(
    'id', 'c06-active-purchase',
    'type', 'INITIAL_PURCHASE',
    'app_user_id', '00000000-0000-0000-0000-000000000002',
    'product_id', 'campaign_30d_1999',
    'transaction_id', 'c06-active-tx',
    'original_transaction_id', 'c06-active-original',
    'environment', 'SANDBOX',
    'aliases', '[]'::JSONB,
    'subscriber_attributes', jsonb_build_object(
      'purchase_intent_id',
      jsonb_build_object('value', (SELECT id::TEXT FROM c06_state WHERE key = 'active_intent'))
    )
  ));
  SELECT extract(epoch FROM (ends_at - now())) / 86400 INTO days
    FROM campaigns WHERE id = 'c6000000-0000-0000-0000-000000000002';
  IF days < 39.9 OR days > 40.1 THEN
    RAISE EXCEPTION 'c06 P0-6: active pass did not stack 30d onto the 10d window (got % days)', days;
  END IF;
END;
$$;
RESET ROLE;

-- 2. The scheduler lapses the window, expire_due_campaigns marks it expired.
UPDATE campaigns SET ends_at = now() - INTERVAL '1 day'
 WHERE id = 'c6000000-0000-0000-0000-000000000002';
SET LOCAL ROLE service_role;
SELECT expire_due_campaigns();
RESET ROLE;
DO $$
BEGIN
  IF (SELECT status FROM campaigns WHERE id = 'c6000000-0000-0000-0000-000000000002') <> 'expired' THEN
    RAISE EXCEPTION 'c06 P0-6: campaign did not expire after its window lapsed';
  END IF;
END;
$$;

-- 3. A free resume is still forbidden (2026-07-13 contract retained).
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
DO $$
DECLARE
  resume_blocked BOOLEAN := false;
BEGIN
  BEGIN
    PERFORM * FROM set_campaign_status('c6000000-0000-0000-0000-000000000002', 'published');
  EXCEPTION WHEN raise_exception THEN
    resume_blocked := SQLERRM ~* 'window has ended|cannot be resumed|cannot move';
  END;
  IF NOT resume_blocked THEN
    RAISE EXCEPTION 'c06 P0-6: an expired campaign was resumed for free';
  END IF;
END;
$$;

-- 4. But a paid repurchase is allowed on the expired campaign (old contract
--    rejected this — the core red). The prior pass has lapsed (as an
--    EXPIRATION webhook would deactivate the entitlement).
RESET ROLE;
UPDATE campaign_entitlements SET active = false, expires_at = now() - INTERVAL '1 day'
 WHERE campaign_id = 'c6000000-0000-0000-0000-000000000002';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
INSERT INTO c06_state
SELECT 'revival_intent', purchase_intent_id
  FROM issue_purchase_intent('campaign_30d_1999', 'c6000000-0000-0000-0000-000000000002');
RESET ROLE;

-- 5. Grant with the beta gate OPEN revives expired -> published, now+30d.
SET LOCAL ROLE service_role;
DO $$
DECLARE
  days NUMERIC;
BEGIN
  PERFORM record_revenuecat_event(jsonb_build_object(
    'id', 'c06-revival-purchase',
    'type', 'INITIAL_PURCHASE',
    'app_user_id', '00000000-0000-0000-0000-000000000002',
    'product_id', 'campaign_30d_1999',
    'transaction_id', 'c06-revival-tx',
    'original_transaction_id', 'c06-revival-original',
    'environment', 'SANDBOX',
    'aliases', '[]'::JSONB,
    'subscriber_attributes', jsonb_build_object(
      'purchase_intent_id',
      jsonb_build_object('value', (SELECT id::TEXT FROM c06_state WHERE key = 'revival_intent'))
    )
  ));
  IF (SELECT status FROM campaigns WHERE id = 'c6000000-0000-0000-0000-000000000002') <> 'published' THEN
    RAISE EXCEPTION 'c06 P0-6: paid repurchase did not revive the expired campaign';
  END IF;
  SELECT extract(epoch FROM (ends_at - now())) / 86400 INTO days
    FROM campaigns WHERE id = 'c6000000-0000-0000-0000-000000000002';
  IF days < 29.9 OR days > 30.1 THEN
    RAISE EXCEPTION 'c06 P0-6: revived window is not now+30d (got % days)', days;
  END IF;
END;
$$;
RESET ROLE;

-- 6. Scheduler-lag equivalence: ends_at in the past but status still
--    published (scheduler has not run) grants exactly now+30d, not stacked.
UPDATE campaigns SET ends_at = now() - INTERVAL '2 days'
 WHERE id = 'c6000000-0000-0000-0000-000000000002';
UPDATE campaign_entitlements SET active = false
 WHERE campaign_id = 'c6000000-0000-0000-0000-000000000002';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
INSERT INTO c06_state
SELECT 'lag_intent', purchase_intent_id
  FROM issue_purchase_intent('campaign_30d_1999', 'c6000000-0000-0000-0000-000000000002');
RESET ROLE;

SET LOCAL ROLE service_role;
DO $$
DECLARE
  days NUMERIC;
BEGIN
  PERFORM record_revenuecat_event(jsonb_build_object(
    'id', 'c06-lag-purchase',
    'type', 'INITIAL_PURCHASE',
    'app_user_id', '00000000-0000-0000-0000-000000000002',
    'product_id', 'campaign_30d_1999',
    'transaction_id', 'c06-lag-tx',
    'original_transaction_id', 'c06-lag-original',
    'environment', 'SANDBOX',
    'aliases', '[]'::JSONB,
    'subscriber_attributes', jsonb_build_object(
      'purchase_intent_id',
      jsonb_build_object('value', (SELECT id::TEXT FROM c06_state WHERE key = 'lag_intent'))
    )
  ));
  SELECT extract(epoch FROM (ends_at - now())) / 86400 INTO days
    FROM campaigns WHERE id = 'c6000000-0000-0000-0000-000000000002';
  IF days < 29.9 OR days > 30.1 THEN
    RAISE EXCEPTION 'c06 P0-6: scheduler-lag grant is not now+30d (got % days)', days;
  END IF;
END;
$$;
RESET ROLE;

-- 7. Beta-gate revival: gate CLOSED, expired campaign, paid repurchase keeps
--    the campaign expired, records a revival_blocked review, still grants the
--    entitlement (money received; benefit applies once the gate opens).
UPDATE campaigns SET ends_at = now() - INTERVAL '1 day', status = 'expired'
 WHERE id = 'c6000000-0000-0000-0000-000000000002';
UPDATE campaign_entitlements SET active = false
 WHERE campaign_id = 'c6000000-0000-0000-0000-000000000002';
UPDATE app_config SET value = 'off' WHERE key = 'public_beta_enabled';

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
INSERT INTO c06_state
SELECT 'blocked_intent', purchase_intent_id
  FROM issue_purchase_intent('campaign_30d_1999', 'c6000000-0000-0000-0000-000000000002');
RESET ROLE;

SET LOCAL ROLE service_role;
DO $$
BEGIN
  PERFORM record_revenuecat_event(jsonb_build_object(
    'id', 'c06-blocked-purchase',
    'type', 'INITIAL_PURCHASE',
    'app_user_id', '00000000-0000-0000-0000-000000000002',
    'product_id', 'campaign_30d_1999',
    'transaction_id', 'c06-blocked-tx',
    'original_transaction_id', 'c06-blocked-original',
    'environment', 'SANDBOX',
    'aliases', '[]'::JSONB,
    'subscriber_attributes', jsonb_build_object(
      'purchase_intent_id',
      jsonb_build_object('value', (SELECT id::TEXT FROM c06_state WHERE key = 'blocked_intent'))
    )
  ));
  IF (SELECT status FROM campaigns WHERE id = 'c6000000-0000-0000-0000-000000000002') <> 'expired' THEN
    RAISE EXCEPTION 'c06 P0-6: beta gate did not keep the revival blocked';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM purchase_event_reviews
     WHERE provider_event_id = 'c06-blocked-purchase'
       AND reason = 'revival_blocked_by_beta_gate'
  ) THEN
    RAISE EXCEPTION 'c06 P0-6: no revival_blocked review was recorded';
  END IF;
  -- The money is durably recorded (grant not parked) and the entitlement is
  -- live; only the public visibility waits for the gate.
  IF NOT EXISTS (
    SELECT 1 FROM purchase_events
     WHERE original_transaction_id = 'c06-blocked-original'
       AND scope_id = 'c6000000-0000-0000-0000-000000000002'
       AND event_type = 'INITIAL_PURCHASE'
  ) THEN
    RAISE EXCEPTION 'c06 P0-6: beta-blocked revival dropped the paid purchase record';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM campaign_entitlements
     WHERE campaign_id = 'c6000000-0000-0000-0000-000000000002' AND active
  ) THEN
    RAISE EXCEPTION 'c06 P0-6: beta-blocked revival left no active entitlement';
  END IF;
END;
$$;
RESET ROLE;
UPDATE app_config SET value = 'on' WHERE key = 'public_beta_enabled';

-- ========================================================================
-- P0-3  ALIAS ATTRIBUTION
-- The webhook app_user_id is a RevenueCat anonymous id (not the real user);
-- the real owner appears only in the aliases array. Benefit must attribute.
-- ========================================================================

INSERT INTO pitch_drafts (id, created_by_user_id, subject_user_id, status, headline, body)
VALUES (
  'c6000000-0000-0000-0000-000000000010',
  '00000000-0000-0000-0000-000000000004',
  '00000000-0000-0000-0000-000000000001',
  'draft',
  'c06 alias draft',
  'c06 alias draft body'
);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);
INSERT INTO c06_state
SELECT 'alias_intent', purchase_intent_id
  FROM issue_purchase_intent('creator_launch_credit_499', 'c6000000-0000-0000-0000-000000000010');
RESET ROLE;

SET LOCAL ROLE service_role;
DO $$
BEGIN
  PERFORM record_revenuecat_event(jsonb_build_object(
    'id', 'c06-alias-purchase',
    'type', 'NON_RENEWING_PURCHASE',
    'app_user_id', '$RCAnonymousID:abc123def456',
    'product_id', 'creator_launch_credit_499',
    'transaction_id', 'c06-alias-tx',
    'original_transaction_id', 'c06-alias-original',
    'environment', 'SANDBOX',
    'aliases', jsonb_build_array('$RCAnonymousID:abc123def456', '00000000-0000-0000-0000-000000000004'),
    'subscriber_attributes', jsonb_build_object(
      'purchase_intent_id',
      jsonb_build_object('value', (SELECT id::TEXT FROM c06_state WHERE key = 'alias_intent'))
    )
  ));
  IF NOT EXISTS (
    SELECT 1 FROM purchase_credit_ledger
     WHERE idempotency_key = 'c06-alias-original'
       AND user_id = '00000000-0000-0000-0000-000000000004'
       AND credit_state = 'available'
  ) THEN
    RAISE EXCEPTION 'c06 P0-3: alias attribution failed to grant the creator credit';
  END IF;
END;
$$;
RESET ROLE;

-- ========================================================================
-- P0-3  TRANSFER REVIEW RESOLVER
-- ========================================================================

-- Build a transfer review over a real creator-credit lineage.
INSERT INTO pitch_drafts (id, created_by_user_id, subject_user_id, status, headline, body)
VALUES (
  'c6000000-0000-0000-0000-000000000020',
  '00000000-0000-0000-0000-000000000004',
  '00000000-0000-0000-0000-000000000001',
  'draft',
  'c06 transfer draft',
  'c06 transfer draft body'
);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);
INSERT INTO c06_state
SELECT 'transfer_intent', purchase_intent_id
  FROM issue_purchase_intent('creator_launch_credit_499', 'c6000000-0000-0000-0000-000000000020');
RESET ROLE;

SET LOCAL ROLE service_role;
DO $$
BEGIN
  -- Original purchase grants a credit to user 4.
  PERFORM record_revenuecat_event(jsonb_build_object(
    'id', 'c06-transfer-purchase',
    'type', 'NON_RENEWING_PURCHASE',
    'app_user_id', '00000000-0000-0000-0000-000000000004',
    'product_id', 'creator_launch_credit_499',
    'transaction_id', 'c06-transfer-tx',
    'original_transaction_id', 'c06-transfer-original',
    'environment', 'SANDBOX',
    'aliases', '[]'::JSONB,
    'subscriber_attributes', jsonb_build_object(
      'purchase_intent_id',
      jsonb_build_object('value', (SELECT id::TEXT FROM c06_state WHERE key = 'transfer_intent'))
    )
  ));
  -- A TRANSFER of that same subscription is parked for ops review.
  PERFORM record_revenuecat_event(jsonb_build_object(
    'id', 'c06-transfer-event',
    'type', 'TRANSFER',
    'product_id', 'creator_launch_credit_499',
    'original_transaction_id', 'c06-transfer-original',
    'environment', 'SANDBOX',
    'transferred_from', jsonb_build_array('00000000-0000-0000-0000-000000000004'),
    'transferred_to', jsonb_build_array('00000000-0000-0000-0000-000000000001')
  ));
  IF NOT EXISTS (
    SELECT 1 FROM purchase_event_reviews
     WHERE provider_event_id = 'c06-transfer-event' AND status = 'open'
  ) THEN
    RAISE EXCEPTION 'c06 P0-3: transfer was not parked in the review queue';
  END IF;
END;
$$;
RESET ROLE;

INSERT INTO c06_state
SELECT 'transfer_review', id FROM purchase_event_reviews
 WHERE provider_event_id = 'c06-transfer-event';

-- authenticated callers cannot resolve reviews.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
DO $$
DECLARE
  denied BOOLEAN := false;
BEGIN
  BEGIN
    PERFORM resolve_purchase_event_review(
      (SELECT id FROM c06_state WHERE key = 'transfer_review'),
      'dismiss',
      NULL
    );
  EXCEPTION
    WHEN insufficient_privilege THEN denied := true;
    WHEN others THEN denied := SQLERRM ~* 'permission|denied|service';
  END;
  IF NOT denied THEN
    RAISE EXCEPTION 'c06 P0-3: an authenticated caller resolved a review';
  END IF;
END;
$$;
RESET ROLE;

-- reassign moves the credit to the transfer target; double-resolve is refused.
SET LOCAL ROLE service_role;
DO $$
DECLARE
  double_blocked BOOLEAN := false;
BEGIN
  PERFORM resolve_purchase_event_review(
    (SELECT id FROM c06_state WHERE key = 'transfer_review'),
    'reassign',
    '00000000-0000-0000-0000-000000000001'
  );
  IF NOT EXISTS (
    SELECT 1 FROM purchase_credit_ledger
     WHERE idempotency_key = 'c06-transfer-original'
       AND user_id = '00000000-0000-0000-0000-000000000001'
  ) THEN
    RAISE EXCEPTION 'c06 P0-3: reassign did not move the benefit to the target user';
  END IF;
  IF (SELECT status FROM purchase_event_reviews WHERE id = (SELECT id FROM c06_state WHERE key = 'transfer_review')) = 'open' THEN
    RAISE EXCEPTION 'c06 P0-3: reassign left the review open';
  END IF;
  BEGIN
    PERFORM resolve_purchase_event_review(
      (SELECT id FROM c06_state WHERE key = 'transfer_review'),
      'dismiss',
      NULL
    );
  EXCEPTION WHEN raise_exception THEN
    double_blocked := SQLERRM ~* 'already|resolved|not open';
  END;
  IF NOT double_blocked THEN
    RAISE EXCEPTION 'c06 P0-3: a resolved review was resolved again';
  END IF;
END;
$$;
RESET ROLE;

-- dismiss closes an open review with a reason.
SET LOCAL ROLE service_role;
DO $$
DECLARE
  dismiss_review UUID;
BEGIN
  PERFORM record_revenuecat_event(jsonb_build_object(
    'id', 'c06-dismiss-event',
    'type', 'TRANSFER',
    'product_id', 'creator_launch_credit_499',
    'original_transaction_id', 'c06-dismiss-original',
    'environment', 'SANDBOX',
    'transferred_from', jsonb_build_array('00000000-0000-0000-0000-000000000004')
  ));
  SELECT id INTO dismiss_review FROM purchase_event_reviews WHERE provider_event_id = 'c06-dismiss-event';
  PERFORM resolve_purchase_event_review(dismiss_review, 'dismiss', NULL);
  IF (SELECT status FROM purchase_event_reviews WHERE id = dismiss_review) NOT IN ('discarded', 'resolved') THEN
    RAISE EXCEPTION 'c06 P0-3: dismiss did not close the review';
  END IF;
END;
$$;
RESET ROLE;

-- ========================================================================
-- P0-6  REFUND DOES NOT RECOVER A CONSUMED KIT
-- A consumed creator credit that already produced a share kit stays
-- consumed after a refund (delivered consumable digital good).
-- ========================================================================
SET LOCAL ROLE service_role;
DO $$
BEGIN
  -- The transfer_intent credit (now user 1) is unrelated; use the alias
  -- credit lineage: unlock its kit then refund, and confirm the kit stays.
  UPDATE purchase_credit_ledger SET credit_state = 'consumed'
   WHERE idempotency_key = 'c06-alias-original';
  INSERT INTO share_kits (pitch_draft_id, unlocked_by_user_id, credit_ledger_id)
  SELECT 'c6000000-0000-0000-0000-000000000010', user_id, id
    FROM purchase_credit_ledger WHERE idempotency_key = 'c06-alias-original';
  PERFORM record_revenuecat_event(jsonb_build_object(
    'id', 'c06-alias-refund',
    'type', 'REFUND',
    'product_id', 'creator_launch_credit_499',
    'original_transaction_id', 'c06-alias-original',
    'environment', 'SANDBOX'
  ));
  IF NOT EXISTS (
    SELECT 1 FROM purchase_credit_ledger
     WHERE idempotency_key = 'c06-alias-original' AND credit_state = 'consumed'
  ) THEN
    RAISE EXCEPTION 'c06 P0-6: refund clawed back a consumed (delivered) creator credit';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM share_kits WHERE pitch_draft_id = 'c6000000-0000-0000-0000-000000000010'
  ) THEN
    RAISE EXCEPTION 'c06 P0-6: refund removed an already-delivered share kit';
  END IF;
END;
$$;
RESET ROLE;

ROLLBACK;

SELECT 'c06_commerce_state_machine.sql passed' AS result;
