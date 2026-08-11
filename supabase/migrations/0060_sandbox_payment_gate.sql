-- 0060_sandbox_payment_gate.sql — T011 / Issue #48 (PAY-2)
--
-- 문제(감사 PAY-2): 0023의 `purchase_intents_launch_gate`는 environment를 보지
-- 않고 `real_payments_enabled=off`이면 **모든** intent 생성을 막는다. 그런데
-- 0038 이후 webhook은 intent 없이는 어떤 구매 이벤트도 귀속하지 못하므로
-- (`unattributed_purchase` review로 빠진다), 실 스토어 sandbox 왕복 검증은
-- 프로덕션 결제 게이트를 켜지 않고서는 구조적으로 불가능했다.
--
-- 이 migration은 게이트를 environment로 분기한다. 프로덕션 결제의 기본 off는
-- 그대로다 — PRODUCTION intent는 여전히 `real_payments_enabled`를 요구하고,
-- PRODUCTION 이벤트는 여전히 0023의 `purchase_events_production_gate`가 막는다.
--
-- ── 격리 설계와 근거 ───────────────────────────────────────────────────
-- 후보 (a) intent에 environment 컬럼 + 웹훅 environment 대조, (b) app_config
-- 별도 스위치 — **둘 다 채택**하고 세 번째 경계를 하나 더 얹었다. 하나만으로는
-- 격리가 시간(스위치)이나 클라이언트 주장(payload)에 의존하기 때문이다.
--
--  1. `app_config.sandbox_payments_enabled` (기본 off, service-role 전용):
--     운영자가 드릴 창을 열 때만 sandbox 경로가 존재한다.
--  2. `public.sandbox_test_accounts` 등록제: 스위치가 열려 있어도 **등록된
--     계정만** SANDBOX intent를 받는다. 그래서 "sandbox가 실사용자의 원장을
--     건드릴 수 있는가"는 시점 문제가 아니라 구조적으로 불가능이 된다 —
--     TestFlight 테스터 아무나 무료 sandbox 구매로 크레딧을 얻을 수 없다.
--  3. environment 라벨: intent·credit ledger·campaign entitlement 행과
--     0033의 server-stamped 성장 이벤트 properties에 environment를 기록한다.
--     sandbox에서 생긴 효익은 사후에 식별·제외 가능하다(매출·비용·성장 집계는
--     SANDBOX를 제외한다 — docs/COST_MODEL.md, scripts/export-growth-evidence).
--
-- environment는 클라이언트가 고르지 않는다. `issue_purchase_intent`가 서버에서
-- 파생한다: 스위치가 열려 있고 호출자가 등록된 테스터면 SANDBOX, 그 외에는
-- PRODUCTION. 등록된 테스터는 드릴 창이 열려 있는 동안 프로덕션 구매를 할 수
-- 없다(그 사람의 구매는 정의상 테스트로 취급된다 — fail-safe 방향).
--
-- 웹훅 쪽 판정은 두 규칙뿐이고 둘 다 "지급하지 않는" 쪽으로 닫힌다:
--   R1. SANDBOX 이벤트는 `sandbox_payments_enabled=on`인 동안, **그리고**
--       지급 대상(intent 소유자)이 `sandbox_test_accounts`에 등록되어 있을
--       때에만 효익을 만든다. 창이 닫혀 있으면 `sandbox_payments_closed`,
--       등록이 없으면 `sandbox_purchase_not_enrolled` review로 보류된다.
--       두 조건을 웹훅에서 다시 보는 이유: intent는 발급 시점의 사실만
--       증명하므로, 드릴 도중 등록을 해제했거나 이전 창에서 발급된 intent가
--       뒤늦게 도착한 웹훅으로 지급을 만들 수 있다. 등록 검사는 payload의
--       app_user_id가 아니라 **실제로 크레딧을 받을 lineage_purchaser**에
--       건다 — alias로 지급 대상을 옮길 수 없게.
--   R2. PRODUCTION 이벤트는 SANDBOX intent를 소비할 수 없다
--       (`environment_mismatch` review). 게이트를 우회해 발급된 intent가
--       실제 돈 이벤트의 귀속 대상이 되는 경로를 막는다.
-- 반대로 **환불·취소·만료(효익을 회수하는 이벤트)에는 R1을 적용하지 않는다.**
-- 회수는 지급과 달리 막는 쪽이 위험하다.
--
-- 지급 경로(share kit unlock, campaign 노출)는 건드리지 않는다. sandbox 효익은
-- 등록된 테스터 자신의 draft·campaign에만 생길 수 있으므로 실사용자의 소비
-- 경로에 섞이지 않고, 드릴이 unlock까지 실제로 검증할 수 있어야 하기 때문이다.

-- ── 1. sandbox 스위치 ──────────────────────────────────────────────────
INSERT INTO public.app_config (key, value)
VALUES ('sandbox_payments_enabled', 'off')
ON CONFLICT (key) DO NOTHING;

CREATE FUNCTION private.sandbox_payments_enabled()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT coalesce(
    (SELECT value = 'on' FROM public.app_config WHERE key = 'sandbox_payments_enabled'),
    false
  );
$$;

REVOKE ALL ON FUNCTION private.sandbox_payments_enabled() FROM PUBLIC;

-- ── 2. sandbox 테스터 등록부 ───────────────────────────────────────────
-- hosted 기본 권한(ALTER DEFAULT PRIVILEGES … TO anon, authenticated)을 믿지
-- 않는다(0051의 교훈): 명시적으로 REVOKE하고 service_role에만 GRANT한다.
CREATE TABLE public.sandbox_test_accounts (
  user_id UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  note TEXT,
  enrolled_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.sandbox_test_accounts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sandbox_test_accounts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.sandbox_test_accounts TO service_role;

COMMENT ON TABLE public.sandbox_test_accounts IS
  'Accounts allowed to issue SANDBOX purchase intents while sandbox_payments_enabled is on. Service-role only; enrolment is an ops action (docs/OPS.md, sandbox 결제 드릴).';

-- ── 3. environment 라벨 ───────────────────────────────────────────────
ALTER TABLE public.purchase_intents
  ADD COLUMN environment TEXT NOT NULL DEFAULT 'PRODUCTION'
    CHECK (environment IN ('SANDBOX', 'PRODUCTION'));

-- authenticated의 purchase_intents SELECT는 컬럼 목록 GRANT다(0014/0052).
-- environment는 서버 판정이므로 그 목록에 넣지 않는다.

ALTER TABLE public.purchase_credit_ledger
  ADD COLUMN environment TEXT NOT NULL DEFAULT 'PRODUCTION'
    CHECK (environment IN ('SANDBOX', 'PRODUCTION'));

ALTER TABLE public.campaign_entitlements
  ADD COLUMN environment TEXT NOT NULL DEFAULT 'PRODUCTION'
    CHECK (environment IN ('SANDBOX', 'PRODUCTION'));

COMMENT ON COLUMN public.purchase_intents.environment IS
  'Which store environment this intent may be redeemed in. Derived server-side by issue_purchase_intent, never sent by the client.';
COMMENT ON COLUMN public.purchase_credit_ledger.environment IS
  'PRODUCTION unless the granting RevenueCat event was a sandbox event. SANDBOX rows are test artefacts and are excluded from revenue reporting.';
COMMENT ON COLUMN public.campaign_entitlements.environment IS
  'PRODUCTION unless the granting RevenueCat event was a sandbox event. One row per (campaign, product): the label never downgrades from PRODUCTION to SANDBOX on a later grant. SANDBOX rows are test artefacts and are excluded from revenue reporting.';

-- The two label columns above are a server judgement: NOT NULL, CHECK-ed to two
-- exact values, so `environment = 'SANDBOX'` is an exact filter on them.
-- `purchase_events.environment` (0014) is a DIFFERENT contract and must not be
-- filtered the same way — it stores RevenueCat's raw string verbatim, is
-- nullable, and is not case-normalized. Every exclusion over that column uses
-- `upper(coalesce(environment, '')) = 'SANDBOX'` (the shape 0023's production
-- gate already uses), so an absent or oddly-cased value counts as real money
-- rather than silently dropping out of revenue. See docs/COST_MODEL.md.
COMMENT ON COLUMN public.purchase_events.environment IS
  'Raw RevenueCat environment string (nullable, not normalized). Filter with upper(coalesce(environment, '''')) = ''SANDBOX''; unlike purchase_credit_ledger.environment and campaign_entitlements.environment this column is not a constrained two-value label.';

-- ── 3b. 성장 이벤트도 환경을 말한다 (0033의 트리거 함수를 대체) ────────
-- 0033은 원장·entitlement INSERT/UPDATE를 server-stamped 성장 이벤트로 바꾼다.
-- 라벨을 행에만 붙이면 `analytics_events`는 sandbox 드릴이 만든 구매와 실제
-- 구매를 구별하지 못하고, 성장 지표는 무료 테스트 거래로 부풀 수 있다 —
-- 그것도 원장에서는 제외되므로 "매출 0, 구매 이벤트 +1"이라는 조용한 불일치로.
-- 그래서 properties에 environment를 함께 적재한다. 본문은 0033의 최신 정의를
-- 그대로 옮기고 properties 한 항목만 늘렸다.
CREATE OR REPLACE FUNCTION private.credit_ledger_growth_events()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.credit_state = 'available' THEN
    PERFORM private.record_growth_event(
      NEW.user_id,
      'creator_launch_purchased',
      jsonb_build_object(
        'pitch_draft_id', NEW.pitch_draft_id,
        'product_id', NEW.product_id,
        'environment', NEW.environment
      )
    );
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.credit_ledger_growth_events() FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.entitlements_growth_events()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  campaign_owner UUID;
BEGIN
  IF NEW.active
     AND (
       TG_OP = 'INSERT'
       OR NOT OLD.active
       OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
     ) THEN
    SELECT owner_user_id INTO campaign_owner
      FROM public.campaigns WHERE id = NEW.campaign_id;
    PERFORM private.record_growth_event(
      campaign_owner,
      'campaign_pass_purchased',
      jsonb_build_object(
        'campaign_id', NEW.campaign_id,
        'product_id', NEW.product_id,
        'environment', NEW.environment
      )
    );
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.entitlements_growth_events() FROM PUBLIC;

-- ── 4. 게이트 분기 (0023의 트리거 함수를 대체) ─────────────────────────
CREATE OR REPLACE FUNCTION private.block_purchase_intents_until_launch()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF upper(coalesce(NEW.environment, 'PRODUCTION')) = 'SANDBOX' THEN
    -- Sandbox intents exist only inside an operator-opened drill window and
    -- only for enrolled test accounts. Both conditions are re-checked here so
    -- a direct INSERT cannot claim a sandbox intent the RPC would not issue.
    IF NOT private.sandbox_payments_enabled() THEN
      RAISE EXCEPTION 'sandbox purchases are not open';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.sandbox_test_accounts WHERE user_id = NEW.user_id
    ) THEN
      RAISE EXCEPTION 'sandbox purchases are limited to enrolled sandbox test accounts';
    END IF;
    RETURN NEW;
  END IF;

  -- Unchanged production invariant (0023).
  IF NOT private.real_payments_enabled() THEN
    RAISE EXCEPTION 'purchases are not available yet';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.block_purchase_intents_until_launch() FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- issue_purchase_intent (최신 정의: 0042) — 본문 통째 복사 후 environment 파생만 추가
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_purchase_intent(product_id TEXT, scope_id UUID)
RETURNS TABLE (purchase_intent_id UUID, expires_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  caller UUID := auth.uid();
  intent_scope public.purchase_scope;
  existing_intent public.purchase_intents;
  new_intent_id UUID;
  new_expires_at TIMESTAMPTZ;
  intent_environment TEXT;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;
  PERFORM private.assert_active_account(caller);

  -- 0060: the store environment is a server judgement, never a client claim.
  -- An enrolled tester inside an open drill window buys in sandbox; everyone
  -- else buys in production and still meets the unchanged launch gate.
  intent_environment := CASE
    WHEN private.sandbox_payments_enabled()
     AND EXISTS (
       SELECT 1 FROM public.sandbox_test_accounts WHERE user_id = caller
     ) THEN 'SANDBOX'
    ELSE 'PRODUCTION'
  END;

  -- Serialize concurrent double-taps on the same (user, product, scope) so
  -- exactly one issued intent survives — the loser reuses the winner's row.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      caller::TEXT || ':' || product_id || ':' || scope_id::TEXT, 140038
    )
  );

  -- An intent whose 24h window already lapsed frees its unique slot. 0060:
  -- so does an intent minted for the other environment — the one-issued-per-
  -- scope index (0038) has no environment column, and an intent must never be
  -- redeemed in an environment it was not gated for.
  UPDATE public.purchase_intents
     SET status = 'expired'
   WHERE user_id = caller
     AND product_id = issue_purchase_intent.product_id
     AND scope_id = issue_purchase_intent.scope_id
     AND status = 'issued'
     AND (expires_at <= now() OR environment <> intent_environment);

  IF product_id = 'creator_launch_credit_499' THEN
    intent_scope := 'PITCH_DRAFT';
    IF NOT EXISTS (
      SELECT 1
        FROM public.pitch_drafts
       WHERE id = scope_id
         AND created_by_user_id = caller
         AND status <> 'archived'
    ) THEN
      RAISE EXCEPTION 'creator purchase scope is not a draft owned by caller';
    END IF;
    IF EXISTS (
      SELECT 1
        FROM public.purchase_credit_ledger
       WHERE pitch_draft_id = scope_id
         AND product_id = 'creator_launch_credit_499'
         AND credit_state IN ('available', 'reserved')
    ) THEN
      RAISE EXCEPTION 'this draft already has an unused Creator Launch credit';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.share_kits WHERE pitch_draft_id = scope_id
    ) THEN
      RAISE EXCEPTION 'this draft already has an unlocked Creator kit';
    END IF;
  ELSIF product_id = 'campaign_pass_30d_1999' THEN
    intent_scope := 'CAMPAIGN';
    -- A paid pass may be bought for a published, paused, or lapsed (expired)
    -- campaign the caller owns — never an archived one. This is the explicit
    -- paid resume path for expired campaigns.
    IF NOT EXISTS (
      SELECT 1
        FROM public.campaigns campaign
        JOIN public.campaign_memberships membership
          ON membership.campaign_id = campaign.id
         AND membership.user_id = caller
         AND membership.role = 'DATER_OWNER'
       WHERE campaign.id = scope_id
         AND campaign.owner_user_id = caller
         AND campaign.status IN ('published', 'paused', 'expired')
    ) THEN
      RAISE EXCEPTION 'pass purchase scope is not a live campaign owned by caller';
    END IF;
    IF EXISTS (
      SELECT 1
        FROM public.campaign_entitlements
       WHERE campaign_id = scope_id
         AND product_id = 'campaign_pass_30d_1999'
         AND active
         AND (expires_at IS NULL OR expires_at > now())
    ) THEN
      RAISE EXCEPTION 'this campaign already has an active Campaign Pass';
    END IF;
  ELSE
    RAISE EXCEPTION 'unknown product %', product_id;
  END IF;

  SELECT * INTO existing_intent
    FROM public.purchase_intents
   WHERE user_id = caller
     AND product_id = issue_purchase_intent.product_id
     AND scope_id = issue_purchase_intent.scope_id
     AND status = 'issued'
     AND expires_at > now()
     AND environment = intent_environment
   ORDER BY created_at DESC
   LIMIT 1;
  IF existing_intent.id IS NOT NULL THEN
    RETURN QUERY SELECT existing_intent.id, existing_intent.expires_at;
    RETURN;
  END IF;

  INSERT INTO public.purchase_intents (
    user_id, product_id, scope_type, scope_id, environment
  )
  VALUES (caller, product_id, intent_scope, scope_id, intent_environment)
  RETURNING id, purchase_intents.expires_at INTO new_intent_id, new_expires_at;

  RETURN QUERY SELECT new_intent_id, new_expires_at;
END;
$$;

REVOKE ALL ON FUNCTION public.issue_purchase_intent(TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.issue_purchase_intent(TEXT, UUID) TO authenticated;


-- ---------------------------------------------------------------------------
-- record_revenuecat_event (최신 정의: 0042) — 본문 통째 복사 후 R1/R2와 라벨만 추가
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_revenuecat_event(payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  incoming_provider_event_id TEXT;
  incoming_event_type TEXT;
  incoming_product_id TEXT;
  app_user_id TEXT;
  incoming_transaction_id TEXT;
  incoming_original_transaction_id TEXT;
  incoming_environment TEXT;
  intent_id_text TEXT;
  intent public.purchase_intents;
  existing_event public.purchase_events;
  event_was_inserted BOOLEAN := false;
  event_purchase_time TIMESTAMPTZ;
  benefit JSONB := 'null'::JSONB;
  affected_rows INTEGER;
  benefit_expires_at TIMESTAMPTZ;
  current_credit_state TEXT;
  entitlement_is_active BOOLEAN;
  lineage_purchaser UUID;
  lineage_scope_type public.purchase_scope;
  lineage_scope_id UUID;
  event_aliases TEXT[];
  candidate_ids TEXT[];
  campaign_row public.campaigns;
  new_ends_at TIMESTAMPTZ;
  lineage_purchase_count INTEGER;
  should_extend_window BOOLEAN := false;
  target_campaign_status TEXT;
  revival_blocked BOOLEAN := false;
  event_environment TEXT;
BEGIN
  IF jsonb_typeof(payload) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'payload must be a JSON object';
  END IF;
  IF jsonb_typeof(payload -> 'id') IS DISTINCT FROM 'string'
     OR nullif(btrim(payload ->> 'id'), '') IS NULL THEN
    RAISE EXCEPTION 'payload.id must be a non-empty string';
  END IF;
  IF jsonb_typeof(payload -> 'type') IS DISTINCT FROM 'string'
     OR nullif(btrim(payload ->> 'type'), '') IS NULL THEN
    RAISE EXCEPTION 'payload.type must be a non-empty string';
  END IF;

  incoming_provider_event_id := btrim(payload ->> 'id');
  incoming_event_type := upper(btrim(payload ->> 'type'));
  incoming_product_id := nullif(btrim(coalesce(payload ->> 'product_id', '')), '');
  app_user_id := nullif(btrim(coalesce(payload ->> 'app_user_id', '')), '');
  incoming_transaction_id := nullif(btrim(coalesce(payload ->> 'transaction_id', '')), '');
  incoming_original_transaction_id :=
    nullif(btrim(coalesce(payload ->> 'original_transaction_id', '')), '');
  incoming_environment := nullif(btrim(coalesce(payload ->> 'environment', '')), '');
  -- 0060: anything that is not explicitly SANDBOX counts as real money. An
  -- absent or unknown environment must never buy the sandbox exemptions.
  event_environment := CASE
    WHEN upper(coalesce(incoming_environment, '')) = 'SANDBOX' THEN 'SANDBOX'
    ELSE 'PRODUCTION'
  END;
  intent_id_text :=
    nullif(btrim(coalesce(payload #>> '{subscriber_attributes,purchase_intent_id,value}', '')), '');

  -- P0-3 alias attribution: the identities this webhook could speak for are
  -- the raw app_user_id plus every alias RevenueCat lists for the subscriber.
  IF jsonb_typeof(payload -> 'aliases') = 'array' THEN
    event_aliases := ARRAY(
      SELECT btrim(value)
        FROM jsonb_array_elements_text(payload -> 'aliases') AS t(value)
       WHERE nullif(btrim(value), '') IS NOT NULL
    );
  ELSE
    event_aliases := ARRAY[]::TEXT[];
  END IF;
  candidate_ids := event_aliases;
  IF app_user_id IS NOT NULL THEN
    candidate_ids := array_prepend(app_user_id, candidate_ids);
  END IF;

  -- TRANSFER and any unhandled type: durable review, never a hard error.
  IF incoming_event_type = 'TRANSFER' THEN
    PERFORM private.queue_purchase_event_review(
      incoming_provider_event_id, incoming_event_type, 'transfer_requires_ops_review', payload
    );
    RETURN jsonb_build_object(
      'recorded', true, 'deduplicated', false, 'benefit', 'null'::JSONB, 'needs_review', true
    );
  END IF;
  IF incoming_event_type NOT IN (
    'INITIAL_PURCHASE', 'NON_RENEWING_PURCHASE', 'RENEWAL',
    'CANCELLATION', 'REFUND', 'EXPIRATION'
  ) THEN
    PERFORM private.queue_purchase_event_review(
      incoming_provider_event_id, incoming_event_type, 'unhandled_event_type', payload
    );
    RETURN jsonb_build_object(
      'recorded', true, 'deduplicated', false, 'benefit', 'null'::JSONB, 'needs_review', true
    );
  END IF;

  -- Handled types need a product and, for purchases, a purchaser + txn ids.
  IF incoming_product_id IS NULL THEN
    PERFORM private.queue_purchase_event_review(
      incoming_provider_event_id, incoming_event_type, 'missing_product_id', payload
    );
    RETURN jsonb_build_object(
      'recorded', true, 'deduplicated', false, 'benefit', 'null'::JSONB, 'needs_review', true
    );
  END IF;
  IF incoming_product_id NOT IN ('creator_launch_credit_499', 'campaign_pass_30d_1999') THEN
    PERFORM private.queue_purchase_event_review(
      incoming_provider_event_id, incoming_event_type, 'unknown_product', payload
    );
    RETURN jsonb_build_object(
      'recorded', true, 'deduplicated', false, 'benefit', 'null'::JSONB, 'needs_review', true
    );
  END IF;
  IF incoming_event_type IN ('INITIAL_PURCHASE', 'NON_RENEWING_PURCHASE', 'RENEWAL')
     AND (app_user_id IS NULL
          OR incoming_transaction_id IS NULL
          OR incoming_original_transaction_id IS NULL) THEN
    RAISE EXCEPTION 'purchase events require app_user_id and transaction identifiers';
  END IF;
  IF incoming_event_type IN ('CANCELLATION', 'REFUND', 'EXPIRATION')
     AND incoming_original_transaction_id IS NULL THEN
    RAISE EXCEPTION 'lifecycle events require original_transaction_id';
  END IF;

  IF incoming_original_transaction_id IS NOT NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(incoming_original_transaction_id, 140014)
    );
  END IF;

  -- Attribution.
  intent := NULL;
  IF incoming_event_type IN ('INITIAL_PURCHASE', 'NON_RENEWING_PURCHASE', 'RENEWAL') THEN
    IF intent_id_text IS NOT NULL THEN
      IF intent_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        PERFORM private.queue_purchase_event_review(
          incoming_provider_event_id, incoming_event_type, 'malformed_purchase_intent', payload
        );
        RETURN jsonb_build_object(
          'recorded', true, 'deduplicated', false, 'benefit', 'null'::JSONB, 'needs_review', true
        );
      END IF;
      SELECT * INTO intent
        FROM public.purchase_intents
       WHERE id = intent_id_text::UUID
       FOR UPDATE;
    END IF;

    -- Lineage fallback: an intent already bound to this original transaction
    -- (e.g. a replayed purchase whose attributes were dropped).
    IF intent.id IS NULL AND incoming_original_transaction_id IS NOT NULL THEN
      SELECT * INTO intent
        FROM public.purchase_intents
       WHERE original_transaction_id = incoming_original_transaction_id
         AND product_id = incoming_product_id
       ORDER BY created_at
       LIMIT 1
       FOR UPDATE;
    END IF;

    -- P0-3: the purchaser matches when the intent owner is the raw app user
    -- OR any listed alias (RevenueCat anonymous ids after reinstall/restore).
    IF intent.id IS NULL
       OR NOT (intent.user_id::TEXT = ANY (candidate_ids))
       OR intent.product_id <> incoming_product_id
       OR intent.status = 'expired'
       OR (intent.status = 'issued' AND intent.expires_at <= now()) THEN
      PERFORM private.queue_purchase_event_review(
        incoming_provider_event_id, incoming_event_type, 'unattributed_purchase', payload
      );
      RETURN jsonb_build_object(
        'recorded', true, 'deduplicated', false, 'benefit', 'null'::JSONB, 'needs_review', true
      );
    END IF;
    IF intent.original_transaction_id IS NOT NULL
       AND intent.original_transaction_id IS DISTINCT FROM incoming_original_transaction_id THEN
      PERFORM private.queue_purchase_event_review(
        incoming_provider_event_id, incoming_event_type, 'intent_transaction_conflict', payload
      );
      RETURN jsonb_build_object(
        'recorded', true, 'deduplicated', false, 'benefit', 'null'::JSONB, 'needs_review', true
      );
    END IF;

    -- 0060 R1: a sandbox purchase grants nothing outside an operator-opened
    -- drill window, so a replayed sandbox webhook after the drill is inert.
    IF event_environment = 'SANDBOX' AND NOT private.sandbox_payments_enabled() THEN
      PERFORM private.queue_purchase_event_review(
        incoming_provider_event_id, incoming_event_type, 'sandbox_payments_closed', payload
      );
      RETURN jsonb_build_object(
        'recorded', true, 'deduplicated', false, 'benefit', 'null'::JSONB, 'needs_review', true
      );
    END IF;
    -- 0060 R2: real money may not redeem an intent that only exists because
    -- the sandbox path bypassed the production launch gate.
    IF event_environment = 'PRODUCTION'
       AND upper(coalesce(intent.environment, 'PRODUCTION')) = 'SANDBOX' THEN
      PERFORM private.queue_purchase_event_review(
        incoming_provider_event_id, incoming_event_type, 'environment_mismatch', payload
      );
      RETURN jsonb_build_object(
        'recorded', true, 'deduplicated', false, 'benefit', 'null'::JSONB, 'needs_review', true
      );
    END IF;

    lineage_purchaser := intent.user_id;
    lineage_scope_type := intent.scope_type;
    lineage_scope_id := intent.scope_id;

    -- 0060 R1 (enrolment half): the switch says *when* a sandbox benefit may
    -- exist, the register says *whose*. Both are re-checked here because the
    -- intent proves only what was true at issue time — an account un-enrolled
    -- mid-drill, or an intent minted in an earlier window, must not pay out.
    -- Checked on the purchaser we are about to credit, never on the payload's
    -- app_user_id, so an alias cannot point the grant at someone else.
    IF event_environment = 'SANDBOX'
       AND NOT EXISTS (
         SELECT 1
           FROM public.sandbox_test_accounts
          WHERE user_id = lineage_purchaser
       ) THEN
      PERFORM private.queue_purchase_event_review(
        incoming_provider_event_id, incoming_event_type,
        'sandbox_purchase_not_enrolled', payload
      );
      RETURN jsonb_build_object(
        'recorded', true, 'deduplicated', false, 'benefit', 'null'::JSONB, 'needs_review', true
      );
    END IF;
  ELSE
    -- Lifecycle: resolve purely through the recorded transaction lineage.
    -- 0060: R1 (window AND enrolment) and R2 deliberately do NOT apply here.
    -- Cancellation, refund and expiration only ever take a benefit away;
    -- refusing one because the drill window closed — or because the tester was
    -- un-enrolled when the drill ended, which is the normal end state — would
    -- leave a granted benefit standing. Revocation stays reachable forever.
    SELECT purchaser_user_id, scope_type, scope_id
      INTO lineage_purchaser, lineage_scope_type, lineage_scope_id
      FROM public.purchase_events
     WHERE original_transaction_id = incoming_original_transaction_id
       AND product_id = incoming_product_id
     ORDER BY purchased_at
     LIMIT 1;
    IF lineage_purchaser IS NULL THEN
      SELECT * INTO intent
        FROM public.purchase_intents
       WHERE original_transaction_id = incoming_original_transaction_id
         AND product_id = incoming_product_id
       ORDER BY created_at
       LIMIT 1;
      IF intent.id IS NOT NULL THEN
        lineage_purchaser := intent.user_id;
        lineage_scope_type := intent.scope_type;
        lineage_scope_id := intent.scope_id;
      END IF;
    END IF;
    -- Out-of-order safety: a refund can beat its purchase event here. When
    -- RevenueCat did keep the intent attribute, use it — so the later
    -- purchase sees the refund in the lineage and grants a revoked credit.
    IF lineage_purchaser IS NULL
       AND intent_id_text IS NOT NULL
       AND intent_id_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      SELECT * INTO intent
        FROM public.purchase_intents
       WHERE id = intent_id_text::UUID
       FOR UPDATE;
      IF intent.id IS NOT NULL
         AND intent.product_id = incoming_product_id
         AND (app_user_id IS NULL OR intent.user_id::TEXT = ANY (candidate_ids))
         AND (intent.original_transaction_id IS NULL
              OR intent.original_transaction_id = incoming_original_transaction_id) THEN
        lineage_purchaser := intent.user_id;
        lineage_scope_type := intent.scope_type;
        lineage_scope_id := intent.scope_id;
      ELSE
        intent := NULL;
      END IF;
    END IF;
    IF lineage_purchaser IS NULL THEN
      PERFORM private.queue_purchase_event_review(
        incoming_provider_event_id, incoming_event_type, 'unmatched_lifecycle_lineage', payload
      );
      RETURN jsonb_build_object(
        'recorded', true, 'deduplicated', false, 'benefit', 'null'::JSONB, 'needs_review', true
      );
    END IF;
    IF app_user_id IS NOT NULL AND NOT (lineage_purchaser::TEXT = ANY (candidate_ids)) THEN
      PERFORM private.queue_purchase_event_review(
        incoming_provider_event_id, incoming_event_type, 'lifecycle_user_mismatch', payload
      );
      RETURN jsonb_build_object(
        'recorded', true, 'deduplicated', false, 'benefit', 'null'::JSONB, 'needs_review', true
      );
    END IF;
  END IF;

  -- One original transaction can only ever belong to one purchase scope.
  IF incoming_original_transaction_id IS NOT NULL
     AND EXISTS (
       SELECT 1
         FROM public.purchase_events
        WHERE original_transaction_id = incoming_original_transaction_id
          AND (
            purchaser_user_id <> lineage_purchaser
            OR product_id <> incoming_product_id
            OR scope_type <> lineage_scope_type
            OR scope_id <> lineage_scope_id
          )
     ) THEN
    RAISE EXCEPTION 'original transaction id is bound to another purchase scope';
  END IF;

  IF incoming_product_id = 'campaign_pass_30d_1999'
     AND incoming_event_type IN ('INITIAL_PURCHASE', 'NON_RENEWING_PURCHASE', 'RENEWAL') THEN
    SELECT * INTO campaign_row
      FROM public.campaigns
     WHERE id = lineage_scope_id
       AND owner_user_id = lineage_purchaser
     FOR UPDATE;
    IF NOT FOUND THEN
      PERFORM private.queue_purchase_event_review(
        incoming_provider_event_id, incoming_event_type, 'pass_scope_ownership_changed', payload
      );
      RETURN jsonb_build_object(
        'recorded', true, 'deduplicated', false, 'benefit', 'null'::JSONB, 'needs_review', true
      );
    END IF;
  END IF;

  event_purchase_time := CASE
    WHEN payload ? 'purchased_at_ms'
     AND jsonb_typeof(payload -> 'purchased_at_ms') = 'number'
      THEN to_timestamp((payload ->> 'purchased_at_ms')::NUMERIC / 1000)
    ELSE now()
  END;

  INSERT INTO public.purchase_events (
    purchaser_user_id,
    product_id,
    scope_type,
    scope_id,
    provider_event_id,
    purchased_at,
    created_at,
    updated_at,
    transaction_id,
    original_transaction_id,
    environment,
    event_type,
    raw_app_user_id
  )
  VALUES (
    lineage_purchaser,
    incoming_product_id,
    lineage_scope_type,
    lineage_scope_id,
    incoming_provider_event_id,
    event_purchase_time,
    clock_timestamp(),
    clock_timestamp(),
    incoming_transaction_id,
    incoming_original_transaction_id,
    incoming_environment,
    incoming_event_type,
    coalesce(app_user_id, lineage_purchaser::TEXT)
  )
  ON CONFLICT (provider_event_id) DO NOTHING
  RETURNING true INTO event_was_inserted;
  event_was_inserted := FOUND;

  IF NOT event_was_inserted THEN
    SELECT * INTO existing_event
      FROM public.purchase_events
     WHERE purchase_events.provider_event_id = incoming_provider_event_id;
    IF existing_event.purchaser_user_id <> lineage_purchaser
       OR existing_event.product_id <> incoming_product_id
       OR existing_event.scope_type <> lineage_scope_type
       OR existing_event.scope_id <> lineage_scope_id
       OR existing_event.transaction_id IS DISTINCT FROM incoming_transaction_id
       OR existing_event.original_transaction_id
          IS DISTINCT FROM incoming_original_transaction_id
       OR existing_event.event_type IS DISTINCT FROM incoming_event_type THEN
      RAISE EXCEPTION 'provider event id conflicts with different event data';
    END IF;
    event_purchase_time := existing_event.purchased_at;
  ELSE
    INSERT INTO public.analytics_events (user_id, event_name, properties)
    SELECT lineage_purchaser,
           CASE
             WHEN incoming_product_id = 'creator_launch_credit_499'
               THEN 'creator_launch_purchased'
             ELSE 'campaign_pass_purchased'
           END,
           jsonb_build_object(
             'provider_event_id', incoming_provider_event_id,
             'product_id', incoming_product_id,
             'scope_id', lineage_scope_id,
             'event_type', incoming_event_type,
             'environment', incoming_environment
           )
     WHERE incoming_event_type IN ('INITIAL_PURCHASE', 'NON_RENEWING_PURCHASE', 'RENEWAL');
  END IF;

  IF intent.id IS NOT NULL
     AND incoming_original_transaction_id IS NOT NULL
     AND intent.original_transaction_id IS NULL THEN
    UPDATE public.purchase_intents
       SET original_transaction_id = incoming_original_transaction_id
     WHERE id = intent.id;
  END IF;

  IF incoming_event_type IN ('INITIAL_PURCHASE', 'NON_RENEWING_PURCHASE', 'RENEWAL') THEN
    UPDATE public.purchase_intents
       SET status = 'consumed',
           original_transaction_id = incoming_original_transaction_id
     WHERE id = intent.id;

    IF incoming_product_id = 'creator_launch_credit_499' THEN
      INSERT INTO public.purchase_credit_ledger (
        user_id,
        credit_state,
        product_id,
        pitch_draft_id,
        idempotency_key,
        environment
      )
      VALUES (
        lineage_purchaser,
        CASE
          WHEN EXISTS (
            SELECT 1
              FROM public.purchase_events
             WHERE original_transaction_id = incoming_original_transaction_id
               AND product_id = incoming_product_id
               AND scope_id = lineage_scope_id
               AND event_type IN ('CANCELLATION', 'REFUND')
          ) THEN 'revoked'::public.credit_state
          ELSE 'available'::public.credit_state
        END,
        incoming_product_id,
        lineage_scope_id,
        incoming_original_transaction_id,
        event_environment
      )
      ON CONFLICT (idempotency_key) DO NOTHING;

      IF NOT EXISTS (
        SELECT 1
          FROM public.purchase_credit_ledger
         WHERE idempotency_key = incoming_original_transaction_id
           AND user_id = lineage_purchaser
           AND product_id = incoming_product_id
           AND pitch_draft_id = lineage_scope_id
      ) THEN
        RAISE EXCEPTION 'original transaction id conflicts with another creator credit';
      END IF;
      SELECT credit_state::TEXT INTO current_credit_state
        FROM public.purchase_credit_ledger
       WHERE idempotency_key = incoming_original_transaction_id;
      benefit := jsonb_build_object('kind', 'creator_credit', 'state', current_credit_state);
    ELSE
      -- P0-6 window state machine. Extend the paid window exactly once per
      -- purchase lineage (idempotent on replay and multi-event webhooks):
      -- new = GREATEST(now, remaining window) + 30 days.
      IF event_was_inserted THEN
        IF incoming_event_type = 'RENEWAL' THEN
          should_extend_window := true;
        ELSE
          SELECT count(*) INTO lineage_purchase_count
            FROM public.purchase_events
           WHERE original_transaction_id = incoming_original_transaction_id
             AND product_id = incoming_product_id
             AND scope_id = lineage_scope_id
             AND event_type IN ('INITIAL_PURCHASE', 'NON_RENEWING_PURCHASE');
          should_extend_window := (lineage_purchase_count = 1);
        END IF;
      END IF;

      IF should_extend_window THEN
        new_ends_at :=
          greatest(now(), coalesce(campaign_row.ends_at, now())) + INTERVAL '30 days';
        -- A paid repurchase revives an involuntarily expired campaign; a
        -- paused campaign keeps the owner's chosen pause (window only grows).
        target_campaign_status := CASE
          WHEN campaign_row.status = 'expired' THEN 'published'
          ELSE campaign_row.status
        END;
        BEGIN
          UPDATE public.campaigns
             SET ends_at = new_ends_at,
                 status = target_campaign_status
           WHERE id = lineage_scope_id
             AND owner_user_id = lineage_purchaser;
        EXCEPTION WHEN OTHERS THEN
          IF SQLERRM ~* 'private beta' OR SQLERRM ~* 'active campaign' THEN
            -- Money received but a publish gate (private beta) or the H-7
            -- one-active-campaign guard blocks reviving expired->published:
            -- extend the window (status stays expired), still grant below, and
            -- queue a review so ops can release visibility once the gate opens
            -- or the owner frees their single active slot.
            UPDATE public.campaigns
               SET ends_at = new_ends_at
             WHERE id = lineage_scope_id
               AND owner_user_id = lineage_purchaser;
            PERFORM private.queue_purchase_event_review(
              incoming_provider_event_id, incoming_event_type,
              CASE
                WHEN SQLERRM ~* 'active campaign'
                  THEN 'revival_blocked_by_active_campaign'
                ELSE 'revival_blocked_by_beta_gate'
              END,
              payload
            );
            revival_blocked := true;
          ELSE
            RAISE;
          END IF;
        END;
      END IF;

      INSERT INTO public.campaign_entitlements (
        campaign_id,
        product_id,
        active,
        expires_at,
        original_transaction_id,
        environment
      )
      VALUES (
        lineage_scope_id,
        incoming_product_id,
        true,
        coalesce(new_ends_at, now() + INTERVAL '30 days'),
        incoming_original_transaction_id,
        event_environment
      )
      ON CONFLICT (campaign_id, product_id) DO UPDATE
        SET updated_at = clock_timestamp(),
            -- One row per (campaign, product), so a later sandbox drill on a
            -- campaign that once held a real paid pass would otherwise relabel
            -- that row SANDBOX and drop it out of revenue. The label only ever
            -- moves toward PRODUCTION: mislabelling real money as a test
            -- artefact is the expensive direction, and the reverse merely
            -- leaves a free drill row counted (visible, correctable).
            environment = CASE
              WHEN campaign_entitlements.environment = 'PRODUCTION' THEN 'PRODUCTION'
              ELSE EXCLUDED.environment
            END;
      entitlement_is_active := private.refresh_campaign_pass_entitlement(
        lineage_scope_id,
        incoming_product_id
      );
      SELECT expires_at INTO benefit_expires_at
        FROM public.campaign_entitlements
       WHERE campaign_id = lineage_scope_id
         AND product_id = incoming_product_id;
      benefit := jsonb_build_object(
        'kind', 'campaign_pass',
        'active', entitlement_is_active,
        'expires_at', benefit_expires_at,
        'revival_blocked', revival_blocked
      );
    END IF;
  ELSIF incoming_event_type IN ('CANCELLATION', 'REFUND') THEN
    IF incoming_product_id = 'creator_launch_credit_499' THEN
      -- Refund/cancellation only revokes credits that are still available or
      -- reserved. A consumed credit (its share kit was delivered) is kept.
      UPDATE public.purchase_credit_ledger
         SET credit_state = 'revoked',
             updated_at = now()
       WHERE idempotency_key = incoming_original_transaction_id
         AND user_id = lineage_purchaser
         AND product_id = incoming_product_id
         AND pitch_draft_id = lineage_scope_id
         AND credit_state IN ('available', 'reserved');
      GET DIAGNOSTICS affected_rows = ROW_COUNT;
      SELECT credit_state::TEXT INTO current_credit_state
        FROM public.purchase_credit_ledger
       WHERE idempotency_key = incoming_original_transaction_id;
      benefit := jsonb_build_object(
        'kind', 'creator_credit_revocation',
        'revoked', affected_rows = 1,
        'state', current_credit_state
      );
    ELSE
      entitlement_is_active := private.refresh_campaign_pass_entitlement(
        lineage_scope_id,
        incoming_product_id
      );
      benefit := jsonb_build_object(
        'kind', 'campaign_pass_deactivation',
        'active', entitlement_is_active,
        'ends_at_retained', true
      );
    END IF;
  ELSIF incoming_event_type = 'EXPIRATION' THEN
    IF incoming_product_id = 'campaign_pass_30d_1999' THEN
      entitlement_is_active := private.refresh_campaign_pass_entitlement(
        lineage_scope_id,
        incoming_product_id
      );
      benefit := jsonb_build_object(
        'kind', 'campaign_pass_expiration',
        'active', entitlement_is_active
      );
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'recorded', true,
    'deduplicated', NOT event_was_inserted,
    'benefit', benefit,
    'needs_review', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_revenuecat_event(JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_revenuecat_event(JSONB) TO service_role;
