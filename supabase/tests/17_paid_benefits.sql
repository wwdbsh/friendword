-- Slice F: paid benefits must be observable and correctly gated.
-- Campaign analytics require an active Campaign Pass; the Creator Launch
-- credit is consumed exactly once by the share-kit unlock.

BEGIN;

INSERT INTO pitch_drafts (id, created_by_user_id, subject_user_id, status, headline, body)
VALUES (
  'f1700000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000004',
  '00000000-0000-0000-0000-000000000001',
  'published',
  'Paid benefits pitch',
  'Benefit gating fixture.'
);

INSERT INTO consent_requests (pitch_draft_id, subject_user_id, token_hash, status, responded_at)
VALUES (
  'f1700000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  encode(digest('paid-benefits-consent', 'sha256'), 'hex'),
  'approved',
  now()
);

INSERT INTO campaigns (id, pitch_draft_id, owner_user_id, status, published_at, slug, ends_at)
VALUES (
  'f1700000-0000-0000-0000-000000000002',
  'f1700000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  'published',
  now(),
  'paid-benefits-fixture',
  now() + INTERVAL '14 days'
);

INSERT INTO analytics_events (user_id, event_name, properties)
VALUES
  (NULL, 'pitch_viewed_unique',
   '{"campaign_slug": "paid-benefits-fixture", "source": "instagram"}'::JSONB),
  (NULL, 'pitch_viewed_unique',
   '{"campaign_slug": "paid-benefits-fixture", "source": "instagram"}'::JSONB),
  ('00000000-0000-0000-0000-000000000003', 'interest_submitted',
   '{"campaign_id": "f1700000-0000-0000-0000-000000000002"}'::JSONB);

INSERT INTO purchase_credit_ledger (id, user_id, credit_state, product_id, pitch_draft_id, idempotency_key)
VALUES (
  'f1700000-0000-0000-0000-000000000003',
  '00000000-0000-0000-0000-000000000004',
  'available',
  'creator_launch_credit_499',
  'f1700000-0000-0000-0000-000000000001',
  'f17-original-txn-1'
);

SET LOCAL ROLE authenticated;

-- 1. Without a pass: state reads false and analytics are gated.
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000001';
DO $$
DECLARE
  state RECORD;
BEGIN
  SELECT * INTO state FROM get_campaign_pass_state('f1700000-0000-0000-0000-000000000002');
  IF state.pass_active THEN
    RAISE EXCEPTION 'pass reported active without an entitlement';
  END IF;

  BEGIN
    PERFORM * FROM get_campaign_analytics('f1700000-0000-0000-0000-000000000002');
    RAISE EXCEPTION 'analytics were served without a pass';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM = 'analytics were served without a pass' THEN RAISE; END IF;
      IF SQLERRM <> 'campaign pass required' THEN RAISE; END IF;
  END;
END;
$$;

-- 2. A non-owner cannot even read the pass state.
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000003';
DO $$
BEGIN
  BEGIN
    PERFORM * FROM get_campaign_pass_state('f1700000-0000-0000-0000-000000000002');
    RAISE EXCEPTION 'non-owner read the pass state';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM = 'non-owner read the pass state' THEN RAISE; END IF;
      IF SQLERRM <> 'campaign not found or not yours' THEN RAISE; END IF;
  END;
END;
$$;

-- 3. With an active pass the funnel aggregates by source.
RESET ROLE;
INSERT INTO campaign_entitlements (campaign_id, product_id, active, expires_at)
VALUES (
  'f1700000-0000-0000-0000-000000000002',
  'campaign_pass_30d_1999',
  true,
  now() + INTERVAL '30 days'
);
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000001';
DO $$
DECLARE
  state RECORD;
  view_total BIGINT;
  submit_total BIGINT;
BEGIN
  SELECT * INTO state FROM get_campaign_pass_state('f1700000-0000-0000-0000-000000000002');
  IF NOT state.pass_active THEN
    RAISE EXCEPTION 'active pass not reported';
  END IF;

  SELECT total INTO view_total
    FROM get_campaign_analytics('f1700000-0000-0000-0000-000000000002')
   WHERE event_name = 'pitch_viewed_unique' AND source = 'instagram';
  IF view_total IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'expected 2 instagram views, got %', view_total;
  END IF;

  SELECT total INTO submit_total
    FROM get_campaign_analytics('f1700000-0000-0000-0000-000000000002')
   WHERE event_name = 'interest_submitted' AND source = 'direct';
  IF submit_total IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'expected 1 direct submission, got %', submit_total;
  END IF;
END;
$$;

-- 4. The share kit consumes the credit once and stays unlocked.
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000004';
DO $$
DECLARE
  first RECORD;
  second RECORD;
  credit_state_now credit_state;
BEGIN
  SELECT * INTO first FROM unlock_share_kit('f1700000-0000-0000-0000-000000000001');
  IF first.already_unlocked THEN
    RAISE EXCEPTION 'first unlock reported already_unlocked';
  END IF;

  SELECT credit_state INTO credit_state_now
    FROM purchase_credit_ledger
   WHERE id = 'f1700000-0000-0000-0000-000000000003';
  IF credit_state_now <> 'consumed' THEN
    RAISE EXCEPTION 'credit was not consumed, state %', credit_state_now;
  END IF;

  SELECT * INTO second FROM unlock_share_kit('f1700000-0000-0000-0000-000000000001');
  IF NOT second.already_unlocked OR second.share_kit_id IS DISTINCT FROM first.share_kit_id THEN
    RAISE EXCEPTION 'second unlock did not return the same kit idempotently';
  END IF;
END;
$$;

-- 4b. Second-audit contract (0028): once the kit is unlocked the benefit
-- is permanent, so rebuying the same draft is refused — the published
-- share screen must show "Open Creator Kit", never a purchase button.
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000004';
DO $$
DECLARE
  rejected BOOLEAN := false;
BEGIN
  BEGIN
    PERFORM * FROM issue_purchase_intent(
      'creator_launch_credit_499',
      'f1700000-0000-0000-0000-000000000001'
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%unlocked Creator kit%' THEN
      RAISE;
    END IF;
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'unlocked draft still allowed a repurchase intent';
  END IF;
END;
$$;

-- 5. Without a credit the unlock refuses; a non-creator cannot unlock.
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000001';
DO $$
BEGIN
  BEGIN
    PERFORM * FROM unlock_share_kit('f1700000-0000-0000-0000-000000000001');
    RAISE EXCEPTION 'non-creator unlocked the kit';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM = 'non-creator unlocked the kit' THEN RAISE; END IF;
      IF SQLERRM <> 'draft not found or not yours' THEN RAISE; END IF;
  END;
END;
$$;

ROLLBACK;

SELECT '17_paid_benefits.sql passed' AS result;
