-- Second audit Slice 3 (P0-3): the webhook state machine now speaks
-- RevenueCat's real event contract.
--
-- - Purchase events attribute through the purchase intent when the
--   subscriber attribute is present, and fall back to the transaction
--   lineage (an intent already bound to the same original transaction).
-- - Refund/cancellation/expiration events attribute purely through the
--   original_transaction_id lineage — RevenueCat does not guarantee
--   subscriber attributes on lifecycle events.
-- - TRANSFER and unknown-but-authenticated event types are stored in a
--   durable review queue instead of being rejected or silently dropped.
-- - Money-received events that cannot be auto-attributed also land in
--   the review queue: nothing terminal, ops can recover.

CREATE TABLE public.purchase_event_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_event_id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  reason TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'resolved', 'discarded')),
  resolution_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

ALTER TABLE public.purchase_event_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.purchase_event_reviews FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.purchase_event_reviews TO service_role;

CREATE FUNCTION private.queue_purchase_event_review(
  provider_event_id TEXT,
  event_type TEXT,
  review_reason TEXT,
  payload JSONB
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
  INSERT INTO public.purchase_event_reviews (
    provider_event_id, event_type, reason, payload
  )
  VALUES (provider_event_id, event_type, review_reason, payload)
  ON CONFLICT (provider_event_id) DO NOTHING;
$$;

REVOKE ALL ON FUNCTION private.queue_purchase_event_review(TEXT, TEXT, TEXT, JSONB)
  FROM PUBLIC;

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
  intent_id_text :=
    nullif(btrim(coalesce(payload #>> '{subscriber_attributes,purchase_intent_id,value}', '')), '');

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
  IF incoming_product_id NOT IN ('creator_launch_credit_499', 'campaign_30d_1999') THEN
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

    IF intent.id IS NULL
       OR intent.user_id::TEXT <> app_user_id
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

    lineage_purchaser := intent.user_id;
    lineage_scope_type := intent.scope_type;
    lineage_scope_id := intent.scope_id;
  ELSE
    -- Lifecycle: resolve purely through the recorded transaction lineage.
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
         AND (app_user_id IS NULL OR intent.user_id::TEXT = app_user_id)
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
    IF app_user_id IS NOT NULL AND lineage_purchaser::TEXT <> app_user_id THEN
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

  IF incoming_product_id = 'campaign_30d_1999'
     AND incoming_event_type IN ('INITIAL_PURCHASE', 'NON_RENEWING_PURCHASE', 'RENEWAL') THEN
    PERFORM 1
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
        idempotency_key
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
        incoming_original_transaction_id
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
      IF incoming_event_type = 'RENEWAL' THEN
        benefit_expires_at := event_purchase_time + INTERVAL '30 days';
      ELSE
        SELECT min(purchased_at) + INTERVAL '30 days' INTO benefit_expires_at
          FROM public.purchase_events
         WHERE original_transaction_id = incoming_original_transaction_id
           AND product_id = incoming_product_id
           AND scope_id = lineage_scope_id
           AND event_type IN ('INITIAL_PURCHASE', 'NON_RENEWING_PURCHASE');
      END IF;

      UPDATE public.campaigns
         SET ends_at = greatest(coalesce(ends_at, benefit_expires_at), benefit_expires_at)
       WHERE id = lineage_scope_id
         AND owner_user_id = lineage_purchaser;

      INSERT INTO public.campaign_entitlements (
        campaign_id,
        product_id,
        active,
        expires_at,
        original_transaction_id
      )
      VALUES (
        lineage_scope_id,
        incoming_product_id,
        true,
        benefit_expires_at,
        incoming_original_transaction_id
      )
      ON CONFLICT (campaign_id, product_id) DO UPDATE
        SET updated_at = clock_timestamp();
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
        'expires_at', benefit_expires_at
      );
    END IF;
  ELSIF incoming_event_type IN ('CANCELLATION', 'REFUND') THEN
    IF incoming_product_id = 'creator_launch_credit_499' THEN
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
    IF incoming_product_id = 'campaign_30d_1999' THEN
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
