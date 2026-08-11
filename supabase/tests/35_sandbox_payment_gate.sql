-- 35: the sandbox payment gate (0060 — T011 / Issue #48, audit PAY-2).
--
-- Three things must hold at the same time and this file pins all three:
--   * production payments stay OFF by default. `real_payments_enabled=off`
--     still refuses every production intent and every PRODUCTION event.
--   * a sandbox round trip is possible WITHOUT touching that switch, but only
--     inside an operator-opened window AND only for an enrolled test account,
--     and every row (and every server-stamped growth event) it creates says
--     which environment it came from.
--   * revocation is never gated. A refund or expiration still lands after the
--     window closed and after the tester was un-enrolled — the normal end
--     state of a drill — because refusing a revocation leaves a benefit
--     standing, which is the opposite of fail-safe.

BEGIN;

CREATE FUNCTION pg_temp.rc_payload(
  event_id TEXT,
  event_type TEXT,
  app_user_id TEXT,
  product_id TEXT,
  intent_id UUID,
  transaction_id TEXT,
  original_transaction_id TEXT,
  environment TEXT
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
    'environment', environment,
    'aliases', '[]'::JSONB,
    'subscriber_attributes', CASE
      WHEN intent_id IS NULL THEN '{}'::JSONB
      ELSE jsonb_build_object(
        'purchase_intent_id', jsonb_build_object('value', intent_id::TEXT)
      )
    END
  );
$$;

CREATE TEMP TABLE sandbox_gate_state (
  key TEXT PRIMARY KEY,
  value UUID NOT NULL
);
GRANT SELECT, INSERT, UPDATE ON sandbox_gate_state TO authenticated, service_role;

-- ── S0: the switch, the helper and the enrolment table exist ────────────
DO $$
BEGIN
  IF to_regprocedure('private.sandbox_payments_enabled()') IS NULL THEN
    RAISE EXCEPTION 'SANDBOX-GATE: private.sandbox_payments_enabled() is missing';
  END IF;
  IF to_regclass('public.sandbox_test_accounts') IS NULL THEN
    RAISE EXCEPTION 'SANDBOX-GATE: sandbox_test_accounts is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM app_config WHERE key = 'sandbox_payments_enabled') THEN
    RAISE EXCEPTION 'SANDBOX-GATE: sandbox_payments_enabled config row is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'purchase_intents'
       AND column_name = 'environment'
  ) THEN
    RAISE EXCEPTION 'SANDBOX-GATE: purchase_intents.environment is missing';
  END IF;
END;
$$;

-- ── S1: the enrolment table is service-role only ────────────────────────
-- The harness installs hosted default privileges, so a missing REVOKE shows
-- up here exactly as it would on the real project.
DO $$
DECLARE
  leaked TEXT;
BEGIN
  FOREACH leaked IN ARRAY ARRAY['anon', 'authenticated']
  LOOP
    IF has_table_privilege(leaked, 'public.sandbox_test_accounts', 'SELECT')
       OR has_table_privilege(leaked, 'public.sandbox_test_accounts', 'INSERT')
       OR has_table_privilege(leaked, 'public.sandbox_test_accounts', 'UPDATE')
       OR has_table_privilege(leaked, 'public.sandbox_test_accounts', 'DELETE') THEN
      RAISE EXCEPTION 'SANDBOX-GATE: % holds privileges on sandbox_test_accounts', leaked;
    END IF;
  END LOOP;
  IF NOT has_table_privilege('service_role', 'public.sandbox_test_accounts', 'INSERT') THEN
    RAISE EXCEPTION 'SANDBOX-GATE: service_role cannot enrol a sandbox tester';
  END IF;
  -- environment is a server judgement: the client must not even read it.
  IF has_column_privilege('authenticated', 'public.purchase_intents', 'environment', 'SELECT') THEN
    RAISE EXCEPTION 'SANDBOX-GATE: authenticated can read purchase_intents.environment';
  END IF;
END;
$$;

-- ── S2: production stays shut. Both gates closed. ───────────────────────
-- seed.sql enrols every local identity so the other suites can replay SANDBOX
-- events. This suite owns the register instead: it starts from the hosted
-- shape (empty) and enrols deliberately, so the un-enrolled refusals below are
-- real refusals and not an accident of fixture order.
DELETE FROM sandbox_test_accounts;

UPDATE app_config SET value = 'off'
 WHERE key IN ('real_payments_enabled', 'sandbox_payments_enabled');

DO $$
DECLARE
  blocked BOOLEAN := false;
BEGIN
  BEGIN
    INSERT INTO purchase_intents (user_id, product_id, scope_type, scope_id)
    VALUES (
      '00000000-0000-0000-0000-000000000004',
      'creator_launch_credit_499',
      'PITCH_DRAFT',
      '10000000-0000-0000-0000-000000000002'
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%not available yet%' THEN
      RAISE EXCEPTION 'SANDBOX-GATE: production intent failed for the wrong reason: %', SQLERRM;
    END IF;
    blocked := true;
  END;
  IF NOT blocked THEN
    RAISE EXCEPTION 'SANDBOX-GATE: a production intent was issued while payments are off';
  END IF;
END;
$$;

DO $$
DECLARE
  blocked BOOLEAN := false;
BEGIN
  BEGIN
    INSERT INTO purchase_events (
      purchaser_user_id, product_id, scope_type, scope_id, provider_event_id,
      purchased_at, event_type, environment, raw_app_user_id
    )
    VALUES (
      '00000000-0000-0000-0000-000000000004',
      'creator_launch_credit_499',
      'PITCH_DRAFT',
      '10000000-0000-0000-0000-000000000002',
      'sandbox-gate-production-event',
      now(),
      'NON_RENEWING_PURCHASE',
      'PRODUCTION',
      '00000000-0000-0000-0000-000000000004'
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%real payments are disabled%' THEN
      RAISE EXCEPTION 'SANDBOX-GATE: production event failed for the wrong reason: %', SQLERRM;
    END IF;
    blocked := true;
  END;
  IF NOT blocked THEN
    RAISE EXCEPTION 'SANDBOX-GATE: a PRODUCTION event was recorded while payments are off';
  END IF;
END;
$$;

-- ── S3: opening the sandbox window alone does not open purchases ────────
-- An unenrolled account still gets a PRODUCTION intent, which the unchanged
-- launch gate refuses. The window is not a back door.
UPDATE app_config SET value = 'on' WHERE key = 'sandbox_payments_enabled';

DO $$
DECLARE
  blocked BOOLEAN := false;
BEGIN
  BEGIN
    INSERT INTO purchase_intents (user_id, product_id, scope_type, scope_id, environment)
    VALUES (
      '00000000-0000-0000-0000-000000000004',
      'creator_launch_credit_499',
      'PITCH_DRAFT',
      '10000000-0000-0000-0000-000000000002',
      'SANDBOX'
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%enrolled sandbox test accounts%' THEN
      RAISE EXCEPTION 'SANDBOX-GATE: unenrolled sandbox intent failed for the wrong reason: %', SQLERRM;
    END IF;
    blocked := true;
  END;
  IF NOT blocked THEN
    RAISE EXCEPTION 'SANDBOX-GATE: an unenrolled account minted a SANDBOX intent';
  END IF;
END;
$$;

DO $$
DECLARE
  blocked BOOLEAN := false;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);
  BEGIN
    PERFORM * FROM issue_purchase_intent(
      'creator_launch_credit_499',
      '10000000-0000-0000-0000-000000000002'
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%not available yet%' THEN
      RAISE EXCEPTION 'SANDBOX-GATE: unenrolled RPC failed for the wrong reason: %', SQLERRM;
    END IF;
    blocked := true;
  END;
  IF NOT blocked THEN
    RAISE EXCEPTION 'SANDBOX-GATE: an unenrolled account bought while payments are off';
  END IF;
END;
$$;

-- ── S4: an enrolled tester gets a SANDBOX intent with payments still off ─
INSERT INTO sandbox_test_accounts (user_id, note)
VALUES ('00000000-0000-0000-0000-000000000004', 'suite 35');

INSERT INTO sandbox_gate_state (key, value)
SELECT 'creator_intent', purchase_intent_id
  FROM issue_purchase_intent(
    'creator_launch_credit_499',
    '10000000-0000-0000-0000-000000000002'
  );

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM purchase_intents
     WHERE id = (SELECT value FROM sandbox_gate_state WHERE key = 'creator_intent')
       AND environment = 'SANDBOX'
       AND status = 'issued'
  ) THEN
    RAISE EXCEPTION 'SANDBOX-GATE: the enrolled tester did not receive a SANDBOX intent';
  END IF;
  IF (SELECT value FROM app_config WHERE key = 'real_payments_enabled') <> 'off' THEN
    RAISE EXCEPTION 'SANDBOX-GATE: this suite must prove the sandbox path with payments OFF';
  END IF;
END;
$$;

-- ── S5: the round trip — purchase, replay, restore ──────────────────────
DO $$
DECLARE
  creator_intent UUID := (SELECT value FROM sandbox_gate_state WHERE key = 'creator_intent');
  purchase_result JSONB;
  replay_result JSONB;
  restore_result JSONB;
BEGIN
  purchase_result := record_revenuecat_event(pg_temp.rc_payload(
    'sandbox-gate-purchase', 'NON_RENEWING_PURCHASE',
    '00000000-0000-0000-0000-000000000004', 'creator_launch_credit_499',
    creator_intent, 'sandbox-gate-tx', 'sandbox-gate-original', 'SANDBOX'
  ));
  IF purchase_result ->> 'needs_review' <> 'false'
     OR purchase_result #>> '{benefit,state}' <> 'available' THEN
    RAISE EXCEPTION 'SANDBOX-GATE: the sandbox purchase did not grant a credit: %', purchase_result;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM purchase_credit_ledger
     WHERE idempotency_key = 'sandbox-gate-original'
       AND credit_state = 'available'
       AND environment = 'SANDBOX'
  ) THEN
    RAISE EXCEPTION 'SANDBOX-GATE: the granted credit is not labelled SANDBOX';
  END IF;

  -- Webhook idempotency: RevenueCat retries the same event id.
  replay_result := record_revenuecat_event(pg_temp.rc_payload(
    'sandbox-gate-purchase', 'NON_RENEWING_PURCHASE',
    '00000000-0000-0000-0000-000000000004', 'creator_launch_credit_499',
    creator_intent, 'sandbox-gate-tx', 'sandbox-gate-original', 'SANDBOX'
  ));
  IF replay_result ->> 'deduplicated' <> 'true' THEN
    RAISE EXCEPTION 'SANDBOX-GATE: the replayed event was not deduplicated';
  END IF;

  -- Restore: a second delivery of the SAME transaction under a new event id
  -- (the shape a reinstall produces). It must not mint a second credit.
  restore_result := record_revenuecat_event(pg_temp.rc_payload(
    'sandbox-gate-restore', 'NON_RENEWING_PURCHASE',
    '00000000-0000-0000-0000-000000000004', 'creator_launch_credit_499',
    creator_intent, 'sandbox-gate-tx', 'sandbox-gate-original', 'SANDBOX'
  ));
  IF restore_result ->> 'needs_review' <> 'false' THEN
    RAISE EXCEPTION 'SANDBOX-GATE: restore was parked for review: %', restore_result;
  END IF;
  IF (SELECT count(*) FROM purchase_credit_ledger
       WHERE idempotency_key = 'sandbox-gate-original') <> 1 THEN
    RAISE EXCEPTION 'SANDBOX-GATE: restore duplicated the sandbox credit';
  END IF;
END;
$$;

-- ── S5b: the growth event says which environment it came from ───────────
-- Row labels alone are not enough: `analytics_events` is what the growth
-- evidence export reads, and a drill purchase there is indistinguishable from
-- a real one unless the server-stamped event carries the environment.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM analytics_events
     WHERE event_name = 'creator_launch_purchased'
       AND properties ->> 'recorded_by' = 'server'
       AND properties ->> 'pitch_draft_id' = '10000000-0000-0000-0000-000000000002'
       AND properties ->> 'environment' = 'SANDBOX'
  ) THEN
    RAISE EXCEPTION
      'SANDBOX-GATE: the server-stamped creator_launch_purchased event is not identifiable as SANDBOX';
  END IF;
END;
$$;

-- ── S6: R1's enrolment half — an un-enrolled purchaser is paid nothing ───
-- The intent was minted while the tester was enrolled. Un-enrolling ends the
-- drill; a webhook that arrives (or is replayed) afterwards must not pay out
-- even though the window is still open.
-- A second draft: one issued intent exists per (user, product, scope), and the
-- first draft now carries an available credit, so the refusals below need
-- their own scope rather than a recycled one.
INSERT INTO pitch_drafts (id, created_by_user_id, subject_user_id, status, headline, body)
VALUES (
  '10000000-0000-0000-0000-000000000035',
  '00000000-0000-0000-0000-000000000004',
  '00000000-0000-0000-0000-000000000003',
  'draft',
  'Second draft for the sandbox suite',
  'Used only to mint a second purchase intent.'
);

DO $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);
END;
$$;

INSERT INTO sandbox_gate_state (key, value)
SELECT 'second_intent', purchase_intent_id
  FROM issue_purchase_intent(
    'creator_launch_credit_499',
    '10000000-0000-0000-0000-000000000035'
  );

DELETE FROM sandbox_test_accounts
 WHERE user_id = '00000000-0000-0000-0000-000000000004';

DO $$
DECLARE
  unenrolled_result JSONB;
BEGIN
  IF NOT private.sandbox_payments_enabled() THEN
    RAISE EXCEPTION 'SANDBOX-GATE: S6 must run with the window OPEN to isolate enrolment';
  END IF;
  unenrolled_result := record_revenuecat_event(pg_temp.rc_payload(
    'sandbox-gate-unenrolled', 'NON_RENEWING_PURCHASE',
    '00000000-0000-0000-0000-000000000004', 'creator_launch_credit_499',
    (SELECT value FROM sandbox_gate_state WHERE key = 'second_intent'),
    'sandbox-gate-unenrolled-tx', 'sandbox-gate-unenrolled-original', 'SANDBOX'
  ));
  IF unenrolled_result ->> 'needs_review' <> 'true' THEN
    RAISE EXCEPTION 'SANDBOX-GATE: an un-enrolled account was paid a sandbox benefit: %',
      unenrolled_result;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM purchase_event_reviews
     WHERE provider_event_id = 'sandbox-gate-unenrolled'
       AND reason = 'sandbox_purchase_not_enrolled'
  ) THEN
    RAISE EXCEPTION 'SANDBOX-GATE: the un-enrolled purchase did not queue the right review';
  END IF;
  IF EXISTS (
    SELECT 1 FROM purchase_credit_ledger
     WHERE idempotency_key = 'sandbox-gate-unenrolled-original'
  ) THEN
    RAISE EXCEPTION 'SANDBOX-GATE: the un-enrolled purchase created a credit';
  END IF;
  -- The intent is not burned: a refusal must be recoverable by re-enrolling.
  IF NOT EXISTS (
    SELECT 1 FROM purchase_intents
     WHERE id = (SELECT value FROM sandbox_gate_state WHERE key = 'second_intent')
       AND status = 'issued'
  ) THEN
    RAISE EXCEPTION 'SANDBOX-GATE: the refused sandbox purchase consumed the intent';
  END IF;
END;
$$;

INSERT INTO sandbox_test_accounts (user_id, note)
VALUES ('00000000-0000-0000-0000-000000000004', 'suite 35 re-enrolled');

-- ── S7: R1's window half — a sandbox event outside the window grants nothing
UPDATE app_config SET value = 'off' WHERE key = 'sandbox_payments_enabled';

DO $$
DECLARE
  closed_result JSONB;
BEGIN
  closed_result := record_revenuecat_event(pg_temp.rc_payload(
    'sandbox-gate-closed', 'NON_RENEWING_PURCHASE',
    '00000000-0000-0000-0000-000000000004', 'creator_launch_credit_499',
    (SELECT value FROM sandbox_gate_state WHERE key = 'second_intent'),
    'sandbox-gate-closed-tx', 'sandbox-gate-closed-original', 'SANDBOX'
  ));
  IF closed_result ->> 'needs_review' <> 'true' THEN
    RAISE EXCEPTION 'SANDBOX-GATE: a sandbox event paid out while the window was closed';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM purchase_event_reviews
     WHERE provider_event_id = 'sandbox-gate-closed'
       AND reason = 'sandbox_payments_closed'
  ) THEN
    RAISE EXCEPTION 'SANDBOX-GATE: the closed-window event did not queue a review';
  END IF;
  IF EXISTS (
    SELECT 1 FROM purchase_credit_ledger
     WHERE idempotency_key = 'sandbox-gate-closed-original'
  ) THEN
    RAISE EXCEPTION 'SANDBOX-GATE: the closed-window event created a credit';
  END IF;
END;
$$;

-- ── S7b: revocation is exempt from BOTH halves of R1 ────────────────────
-- This is the end state of every drill: the window is closed and the tester is
-- un-enrolled. A refund arriving now must still revoke. If R1 were widened to
-- all events, the credit would survive its own refund.
DELETE FROM sandbox_test_accounts
 WHERE user_id = '00000000-0000-0000-0000-000000000004';

DO $$
DECLARE
  refund_result JSONB;
BEGIN
  IF private.sandbox_payments_enabled()
     OR EXISTS (
       SELECT 1 FROM sandbox_test_accounts
        WHERE user_id = '00000000-0000-0000-0000-000000000004'
     ) THEN
    RAISE EXCEPTION 'SANDBOX-GATE: S7b must run with the window closed AND the tester un-enrolled';
  END IF;

  refund_result := record_revenuecat_event(pg_temp.rc_payload(
    'sandbox-gate-refund', 'REFUND',
    '00000000-0000-0000-0000-000000000004', 'creator_launch_credit_499',
    NULL, NULL, 'sandbox-gate-original', 'SANDBOX'
  ));
  IF refund_result ->> 'needs_review' <> 'false' THEN
    RAISE EXCEPTION 'SANDBOX-GATE: a refund was parked for review after the drill closed: %',
      refund_result;
  END IF;
  IF refund_result #>> '{benefit,revoked}' <> 'true'
     OR refund_result #>> '{benefit,state}' <> 'revoked' THEN
    RAISE EXCEPTION 'SANDBOX-GATE: the sandbox refund did not revoke the credit: %', refund_result;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM purchase_credit_ledger
     WHERE idempotency_key = 'sandbox-gate-original'
       AND credit_state = 'revoked'
  ) THEN
    RAISE EXCEPTION 'SANDBOX-GATE: the ledger row survived its own refund';
  END IF;
END;
$$;

INSERT INTO sandbox_test_accounts (user_id, note)
VALUES ('00000000-0000-0000-0000-000000000004', 'suite 35 re-enrolled again');

-- ── S8: R2 — real money may not redeem a sandbox intent ─────────────────
-- Payments are switched ON here so the 0023 event gate is not what refuses
-- this; the refusal has to come from the environment rule itself.
UPDATE app_config SET value = 'on' WHERE key = 'real_payments_enabled';

DO $$
DECLARE
  mismatch_result JSONB;
BEGIN
  mismatch_result := record_revenuecat_event(pg_temp.rc_payload(
    'sandbox-gate-mismatch', 'NON_RENEWING_PURCHASE',
    '00000000-0000-0000-0000-000000000004', 'creator_launch_credit_499',
    (SELECT value FROM sandbox_gate_state WHERE key = 'second_intent'),
    'sandbox-gate-mismatch-tx', 'sandbox-gate-mismatch-original', 'PRODUCTION'
  ));
  IF mismatch_result ->> 'needs_review' <> 'true' THEN
    RAISE EXCEPTION 'SANDBOX-GATE: a PRODUCTION event redeemed a SANDBOX intent';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM purchase_event_reviews
     WHERE provider_event_id = 'sandbox-gate-mismatch'
       AND reason = 'environment_mismatch'
  ) THEN
    RAISE EXCEPTION 'SANDBOX-GATE: the environment mismatch did not queue a review';
  END IF;
  IF EXISTS (
    SELECT 1 FROM purchase_credit_ledger
     WHERE idempotency_key = 'sandbox-gate-mismatch-original'
  ) THEN
    RAISE EXCEPTION 'SANDBOX-GATE: the mismatched event created a credit';
  END IF;
END;
$$;

-- ── S9: a Campaign Pass bought in sandbox is labelled too ───────────────
UPDATE app_config SET value = 'off' WHERE key = 'real_payments_enabled';
UPDATE app_config SET value = 'on' WHERE key = 'sandbox_payments_enabled';

INSERT INTO sandbox_test_accounts (user_id, note)
VALUES ('00000000-0000-0000-0000-000000000002', 'suite 35 dater');

DO $$
DECLARE
  pass_intent UUID;
  pass_result JSONB;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
  SELECT purchase_intent_id INTO pass_intent
    FROM issue_purchase_intent(
      'campaign_pass_30d_1999',
      '20000000-0000-0000-0000-000000000001'
    );

  pass_result := record_revenuecat_event(pg_temp.rc_payload(
    'sandbox-gate-pass', 'NON_RENEWING_PURCHASE',
    '00000000-0000-0000-0000-000000000002', 'campaign_pass_30d_1999',
    pass_intent, 'sandbox-gate-pass-tx', 'sandbox-gate-pass-original', 'SANDBOX'
  ));
  IF pass_result #>> '{benefit,active}' <> 'true' THEN
    RAISE EXCEPTION 'SANDBOX-GATE: the sandbox Campaign Pass did not activate: %', pass_result;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM campaign_entitlements
     WHERE campaign_id = '20000000-0000-0000-0000-000000000001'
       AND product_id = 'campaign_pass_30d_1999'
       AND environment = 'SANDBOX'
  ) THEN
    RAISE EXCEPTION 'SANDBOX-GATE: the sandbox entitlement is not labelled SANDBOX';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM analytics_events
     WHERE event_name = 'campaign_pass_purchased'
       AND properties ->> 'recorded_by' = 'server'
       AND properties ->> 'campaign_id' = '20000000-0000-0000-0000-000000000001'
       AND properties ->> 'environment' = 'SANDBOX'
  ) THEN
    RAISE EXCEPTION
      'SANDBOX-GATE: the server-stamped campaign_pass_purchased event is not identifiable as SANDBOX';
  END IF;
END;
$$;

-- ── S9b: EXPIRATION is exempt too, with the window closed ───────────────
UPDATE app_config SET value = 'off' WHERE key = 'sandbox_payments_enabled';

DO $$
DECLARE
  expiration_result JSONB;
BEGIN
  expiration_result := record_revenuecat_event(pg_temp.rc_payload(
    'sandbox-gate-pass-expiration', 'EXPIRATION',
    '00000000-0000-0000-0000-000000000002', 'campaign_pass_30d_1999',
    NULL, NULL, 'sandbox-gate-pass-original', 'SANDBOX'
  ));
  IF expiration_result ->> 'needs_review' <> 'false' THEN
    RAISE EXCEPTION 'SANDBOX-GATE: a pass expiration was parked for review after the drill closed: %',
      expiration_result;
  END IF;
  IF expiration_result #>> '{benefit,active}' <> 'false' THEN
    RAISE EXCEPTION 'SANDBOX-GATE: the sandbox pass survived its own expiration: %',
      expiration_result;
  END IF;
  IF EXISTS (
    SELECT 1 FROM campaign_entitlements
     WHERE campaign_id = '20000000-0000-0000-0000-000000000001'
       AND product_id = 'campaign_pass_30d_1999'
       AND active
  ) THEN
    RAISE EXCEPTION 'SANDBOX-GATE: the entitlement row stayed active after EXPIRATION';
  END IF;
END;
$$;

-- ── S10: the label never downgrades PRODUCTION -> SANDBOX ───────────────
-- There is one entitlement row per (campaign, product). A later drill on a
-- campaign that once held a real paid pass must not relabel that row as a test
-- artefact — that would silently remove real money from revenue reporting.
UPDATE app_config SET value = 'on' WHERE key = 'sandbox_payments_enabled';

UPDATE campaign_entitlements
   SET environment = 'PRODUCTION'
 WHERE campaign_id = '20000000-0000-0000-0000-000000000001'
   AND product_id = 'campaign_pass_30d_1999';

DO $$
DECLARE
  second_pass_intent UUID;
  second_pass_result JSONB;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
  SELECT purchase_intent_id INTO second_pass_intent
    FROM issue_purchase_intent(
      'campaign_pass_30d_1999',
      '20000000-0000-0000-0000-000000000001'
    );

  second_pass_result := record_revenuecat_event(pg_temp.rc_payload(
    'sandbox-gate-pass-2', 'NON_RENEWING_PURCHASE',
    '00000000-0000-0000-0000-000000000002', 'campaign_pass_30d_1999',
    second_pass_intent, 'sandbox-gate-pass-2-tx', 'sandbox-gate-pass-2-original', 'SANDBOX'
  ));
  IF second_pass_result #>> '{benefit,active}' <> 'true' THEN
    RAISE EXCEPTION 'SANDBOX-GATE: the second sandbox pass did not activate: %', second_pass_result;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM campaign_entitlements
     WHERE campaign_id = '20000000-0000-0000-0000-000000000001'
       AND product_id = 'campaign_pass_30d_1999'
       AND environment = 'PRODUCTION'
  ) THEN
    RAISE EXCEPTION
      'SANDBOX-GATE: a sandbox grant downgraded a PRODUCTION entitlement label to SANDBOX';
  END IF;
END;
$$;

ROLLBACK;

SELECT '35_sandbox_payment_gate.sql passed' AS result;
