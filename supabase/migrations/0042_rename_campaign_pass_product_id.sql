-- 0042_rename_campaign_pass_product_id.sql
--
-- Rename the Campaign Pass product identifier to `campaign_pass_30d_1999`.
-- App Store Connect permanently locked the previous id (defined in 0014)
-- after it was created and deleted, so the canonical product id changes.
-- Creator Launch (`creator_launch_credit_499`) is unaffected.
--
-- No hosted purchase data exists yet (pre-sandbox), so no data backfill is
-- needed. This migration only redefines the RPCs whose CURRENT active
-- definitions hardcoded the old id. Each function body below is copied
-- verbatim from its latest definition; only the product-id string literal is
-- changed. Source of each latest definition:
--   get_campaign_analytics        -> 0020_paid_benefits.sql
--   get_campaign_pass_state       -> 0037_account_guard_and_erasure.sql
--   issue_purchase_intent         -> 0038_commerce_state_machine.sql
--   resolve_purchase_event_review -> 0038_commerce_state_machine.sql
--   record_revenuecat_event       -> 0039_core_growth_loop.sql
-- Historical migrations (0014-0039) are left untouched to preserve history.


-- ---------------------------------------------------------------------------
-- get_campaign_pass_state (latest: 0037) — 1 id literal(s) swapped
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_campaign_pass_state(target_campaign_id uuid)
 RETURNS TABLE(pass_active boolean, pass_expires_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  caller UUID := auth.uid();
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;
  PERFORM private.assert_active_account(caller);

  IF NOT EXISTS (
    SELECT 1 FROM campaigns
     WHERE id = target_campaign_id AND owner_user_id = caller
  ) THEN
    RAISE EXCEPTION 'campaign not found or not yours';
  END IF;

  RETURN QUERY
  SELECT
    coalesce(
      bool_or(e.active AND (e.expires_at IS NULL OR e.expires_at > now())),
      false
    ),
    max(e.expires_at)
    FROM campaign_entitlements e
   WHERE e.campaign_id = target_campaign_id
     AND e.product_id = 'campaign_pass_30d_1999';
END;
$function$;


-- ---------------------------------------------------------------------------
-- get_campaign_analytics (latest: 0020) — 1 id literal(s) swapped
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_campaign_analytics(target_campaign_id UUID)
RETURNS TABLE (event_name TEXT, source TEXT, total BIGINT)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  caller UUID := auth.uid();
  campaign campaigns;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;
  PERFORM private.assert_active_account(caller);

  SELECT * INTO campaign
    FROM campaigns
   WHERE id = target_campaign_id AND owner_user_id = caller;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'campaign not found or not yours';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM campaign_entitlements e
     WHERE e.campaign_id = campaign.id
       AND e.product_id = 'campaign_pass_30d_1999'
       AND e.active
       AND (e.expires_at IS NULL OR e.expires_at > now())
  ) THEN
    RAISE EXCEPTION 'campaign pass required';
  END IF;

  RETURN QUERY
  SELECT
    a.event_name::TEXT,
    coalesce(nullif(btrim(a.properties ->> 'source'), ''), 'direct'),
    count(*)::BIGINT
    FROM analytics_events a
   WHERE a.event_name IN (
           'pitch_viewed_unique', 'interest_started', 'interest_submitted', 'campaign_shared'
         )
     AND (
       a.properties ->> 'campaign_id' = campaign.id::TEXT
       OR (campaign.slug IS NOT NULL AND a.properties ->> 'campaign_slug' = campaign.slug)
     )
   GROUP BY a.event_name, coalesce(nullif(btrim(a.properties ->> 'source'), ''), 'direct');
END;
$$;

REVOKE ALL ON FUNCTION public.get_campaign_analytics(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_campaign_analytics(UUID) TO authenticated;


-- ---------------------------------------------------------------------------
-- issue_purchase_intent (latest: 0038) — 2 id literal(s) swapped
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
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;
  PERFORM private.assert_active_account(caller);

  -- Serialize concurrent double-taps on the same (user, product, scope) so
  -- exactly one issued intent survives — the loser reuses the winner's row.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      caller::TEXT || ':' || product_id || ':' || scope_id::TEXT, 140038
    )
  );

  -- An intent whose 24h window already lapsed frees its unique slot.
  UPDATE public.purchase_intents
     SET status = 'expired'
   WHERE user_id = caller
     AND product_id = issue_purchase_intent.product_id
     AND scope_id = issue_purchase_intent.scope_id
     AND status = 'issued'
     AND expires_at <= now();

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
   ORDER BY created_at DESC
   LIMIT 1;
  IF existing_intent.id IS NOT NULL THEN
    RETURN QUERY SELECT existing_intent.id, existing_intent.expires_at;
    RETURN;
  END IF;

  INSERT INTO public.purchase_intents (user_id, product_id, scope_type, scope_id)
  VALUES (caller, product_id, intent_scope, scope_id)
  RETURNING id, purchase_intents.expires_at INTO new_intent_id, new_expires_at;

  RETURN QUERY SELECT new_intent_id, new_expires_at;
END;
$$;

REVOKE ALL ON FUNCTION public.issue_purchase_intent(TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.issue_purchase_intent(TEXT, UUID) TO authenticated;


-- ---------------------------------------------------------------------------
-- resolve_purchase_event_review (latest: 0038) — 2 id literal(s) swapped
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_purchase_event_review(
  target_review_id UUID,
  resolution TEXT,
  target_user_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  review public.purchase_event_reviews;
  review_product TEXT;
  review_original_txn TEXT;
  moved_rows INTEGER := 0;
BEGIN
  IF resolution NOT IN ('reassign', 'dismiss') THEN
    RAISE EXCEPTION 'resolution must be reassign or dismiss';
  END IF;

  SELECT * INTO review
    FROM public.purchase_event_reviews
   WHERE id = target_review_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'review not found';
  END IF;
  IF review.status <> 'open' THEN
    RAISE EXCEPTION 'review % is already resolved', target_review_id;
  END IF;

  review_product := nullif(btrim(coalesce(review.payload ->> 'product_id', '')), '');
  review_original_txn :=
    nullif(btrim(coalesce(review.payload ->> 'original_transaction_id', '')), '');

  IF resolution = 'reassign' THEN
    IF target_user_id IS NULL THEN
      RAISE EXCEPTION 'reassign requires a target_user_id';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = target_user_id) THEN
      RAISE EXCEPTION 'target user does not exist';
    END IF;
    IF review_original_txn IS NULL THEN
      RAISE EXCEPTION 'this review has no transaction lineage to reassign';
    END IF;

    IF review_product = 'creator_launch_credit_499' THEN
      -- Reassign the user-scoped creator credit to the transfer target.
      UPDATE public.purchase_credit_ledger
         SET user_id = target_user_id,
             updated_at = now()
       WHERE idempotency_key = review_original_txn;
      GET DIAGNOSTICS moved_rows = ROW_COUNT;
    ELSIF review_product = 'campaign_pass_30d_1999' THEN
      -- Campaign passes are campaign-scoped; refresh keeps the entitlement
      -- authoritative for its lineage. Recording the target is enough here.
      PERFORM private.refresh_campaign_pass_entitlement(
        (SELECT scope_id FROM public.purchase_events
          WHERE original_transaction_id = review_original_txn
          ORDER BY purchased_at LIMIT 1),
        'campaign_pass_30d_1999'
      );
      GET DIAGNOSTICS moved_rows = ROW_COUNT;
    ELSE
      RAISE EXCEPTION 'review product % cannot be reassigned', coalesce(review_product, '(none)');
    END IF;
  END IF;

  UPDATE public.purchase_event_reviews
     SET status = CASE WHEN resolution = 'reassign' THEN 'resolved' ELSE 'discarded' END,
         resolution_note = CASE
           WHEN resolution = 'reassign'
             THEN 'reassigned to ' || target_user_id::TEXT
           ELSE 'dismissed by ops'
         END,
         resolved_at = now(),
         resolved_by = 'service'
   WHERE id = target_review_id;

  RETURN jsonb_build_object(
    'review_id', target_review_id,
    'resolution', resolution,
    'target_user_id', target_user_id,
    'moved_rows', moved_rows
  );
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_purchase_event_review(UUID, TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_purchase_event_review(UUID, TEXT, UUID)
  FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_purchase_event_review(UUID, TEXT, UUID) TO service_role;


-- ---------------------------------------------------------------------------
-- record_revenuecat_event (latest: 0039) — 3 id literal(s) swapped
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
        original_transaction_id
      )
      VALUES (
        lineage_scope_id,
        incoming_product_id,
        true,
        coalesce(new_ends_at, now() + INTERVAL '30 days'),
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
