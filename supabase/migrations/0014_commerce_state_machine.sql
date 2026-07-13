ALTER TYPE public.credit_state ADD VALUE IF NOT EXISTS 'revoked';

CREATE TABLE public.purchase_intents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id),
  product_id TEXT NOT NULL,
  scope_type public.purchase_scope NOT NULL,
  scope_id UUID NOT NULL,
  original_transaction_id TEXT,
  status TEXT NOT NULL DEFAULT 'issued'
    CHECK (status IN ('issued', 'consumed', 'expired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + INTERVAL '24 hours'
);

ALTER TABLE public.purchase_intents ENABLE ROW LEVEL SECURITY;
GRANT SELECT (
  id,
  user_id,
  product_id,
  scope_type,
  scope_id,
  status,
  created_at,
  expires_at
) ON public.purchase_intents TO authenticated;
GRANT SELECT ON public.purchase_intents TO service_role;

CREATE POLICY purchase_intents_select_owner ON public.purchase_intents
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE FUNCTION public.issue_purchase_intent(product_id TEXT, scope_id UUID)
RETURNS TABLE (purchase_intent_id UUID, expires_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  caller UUID := auth.uid();
  intent_scope public.purchase_scope;
  new_intent_id UUID;
  new_expires_at TIMESTAMPTZ;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;
  PERFORM private.assert_active_account(caller);

  IF product_id = 'creator_launch_credit_499' THEN
    intent_scope := 'PITCH_DRAFT';
    IF NOT EXISTS (
      SELECT 1
        FROM public.pitch_drafts
       WHERE id = scope_id
         AND created_by_user_id = caller
         AND status <> 'published'
         AND status <> 'archived'
    ) THEN
      RAISE EXCEPTION 'creator purchase scope is not an unpublished draft owned by caller';
    END IF;
  ELSIF product_id = 'campaign_30d_1999' THEN
    intent_scope := 'CAMPAIGN';
    IF NOT EXISTS (
      SELECT 1
        FROM public.campaigns campaign
        JOIN public.campaign_memberships membership
          ON membership.campaign_id = campaign.id
         AND membership.user_id = caller
         AND membership.role = 'DATER_OWNER'
       WHERE campaign.id = scope_id
         AND campaign.owner_user_id = caller
         AND campaign.status = 'published'
    ) THEN
      RAISE EXCEPTION 'pass purchase scope is not a published campaign owned by caller';
    END IF;
  ELSE
    RAISE EXCEPTION 'unknown product %', product_id;
  END IF;

  INSERT INTO public.purchase_intents (user_id, product_id, scope_type, scope_id)
  VALUES (caller, product_id, intent_scope, scope_id)
  RETURNING id, purchase_intents.expires_at INTO new_intent_id, new_expires_at;

  RETURN QUERY SELECT new_intent_id, new_expires_at;
END;
$$;

REVOKE ALL ON FUNCTION public.issue_purchase_intent(TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.issue_purchase_intent(TEXT, UUID) TO authenticated;

ALTER TABLE public.purchase_events
  ADD COLUMN transaction_id TEXT,
  ADD COLUMN original_transaction_id TEXT,
  ADD COLUMN environment TEXT,
  ADD COLUMN event_type TEXT,
  ADD COLUMN raw_app_user_id TEXT;

CREATE INDEX purchase_events_original_transaction_id_idx
  ON public.purchase_events (original_transaction_id);

ALTER TABLE public.campaign_entitlements
  ADD COLUMN original_transaction_id TEXT;

CREATE FUNCTION private.refresh_campaign_pass_entitlement(
  target_campaign_id UUID,
  target_product_id TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  selected_original_transaction_id TEXT;
  selected_expires_at TIMESTAMPTZ;
BEGIN
  WITH lineage_states AS (
    SELECT event.original_transaction_id,
           greatest(
             coalesce(
               min(event.purchased_at) FILTER (
                 WHERE event.event_type IN ('INITIAL_PURCHASE', 'NON_RENEWING_PURCHASE')
               ) + INTERVAL '30 days',
               '-infinity'::TIMESTAMPTZ
             ),
             coalesce(
               max(event.purchased_at) FILTER (
                 WHERE event.event_type = 'RENEWAL'
               ) + INTERVAL '30 days',
               '-infinity'::TIMESTAMPTZ
             )
           ) AS benefit_expires_at,
           max(event.purchased_at) FILTER (
             WHERE event.event_type = 'RENEWAL'
           ) AS latest_renewal_at,
           max(event.purchased_at) FILTER (
             WHERE event.event_type IN ('CANCELLATION', 'REFUND', 'EXPIRATION')
           ) AS latest_terminal_at,
           count(*) FILTER (
             WHERE event.event_type IN ('INITIAL_PURCHASE', 'NON_RENEWING_PURCHASE', 'RENEWAL')
           ) AS purchase_count
      FROM public.purchase_events event
     WHERE event.scope_type = 'CAMPAIGN'
       AND event.scope_id = target_campaign_id
       AND event.product_id = target_product_id
       AND event.original_transaction_id IS NOT NULL
     GROUP BY event.original_transaction_id
  ), active_lineages AS (
    SELECT original_transaction_id, benefit_expires_at
      FROM lineage_states
     WHERE purchase_count > 0
       AND (
         latest_terminal_at IS NULL
         OR latest_renewal_at > latest_terminal_at
       )
  )
  SELECT original_transaction_id, benefit_expires_at
    INTO selected_original_transaction_id, selected_expires_at
    FROM active_lineages
   ORDER BY benefit_expires_at DESC, original_transaction_id
   LIMIT 1;

  IF selected_original_transaction_id IS NULL THEN
    UPDATE public.campaign_entitlements
       SET active = false,
           updated_at = clock_timestamp()
     WHERE campaign_id = target_campaign_id
       AND product_id = target_product_id;
    RETURN false;
  END IF;

  UPDATE public.campaign_entitlements
     SET active = true,
         expires_at = selected_expires_at,
         original_transaction_id = selected_original_transaction_id,
         updated_at = clock_timestamp()
   WHERE campaign_id = target_campaign_id
     AND product_id = target_product_id;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION private.refresh_campaign_pass_entitlement(UUID, TEXT) FROM PUBLIC;

CREATE FUNCTION public.record_revenuecat_event(payload JSONB)
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
  needs_review BOOLEAN := false;
  affected_rows INTEGER;
  benefit_expires_at TIMESTAMPTZ;
  current_credit_state TEXT;
  entitlement_is_active BOOLEAN;
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
  IF jsonb_typeof(payload -> 'product_id') IS DISTINCT FROM 'string'
     OR nullif(btrim(payload ->> 'product_id'), '') IS NULL THEN
    RAISE EXCEPTION 'payload.product_id must be a non-empty string';
  END IF;
  IF jsonb_typeof(payload -> 'app_user_id') IS DISTINCT FROM 'string'
     OR nullif(btrim(payload ->> 'app_user_id'), '') IS NULL THEN
    RAISE EXCEPTION 'payload.app_user_id must be a non-empty string';
  END IF;
  IF payload ? 'transaction_id'
     AND (
       jsonb_typeof(payload -> 'transaction_id') IS DISTINCT FROM 'string'
       OR nullif(btrim(payload ->> 'transaction_id'), '') IS NULL
     ) THEN
    RAISE EXCEPTION 'payload.transaction_id must be a non-empty string';
  END IF;
  IF payload ? 'original_transaction_id'
     AND (
       jsonb_typeof(payload -> 'original_transaction_id') IS DISTINCT FROM 'string'
       OR nullif(btrim(payload ->> 'original_transaction_id'), '') IS NULL
     ) THEN
    RAISE EXCEPTION 'payload.original_transaction_id must be a non-empty string';
  END IF;
  IF payload ? 'purchased_at_ms'
     AND jsonb_typeof(payload -> 'purchased_at_ms') IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION 'payload.purchased_at_ms must be a number';
  END IF;
  IF payload ? 'expiration_at_ms'
     AND jsonb_typeof(payload -> 'expiration_at_ms') NOT IN ('number', 'null') THEN
    RAISE EXCEPTION 'payload.expiration_at_ms must be a number or null';
  END IF;
  IF payload ? 'environment'
     AND (
       jsonb_typeof(payload -> 'environment') IS DISTINCT FROM 'string'
       OR nullif(btrim(payload ->> 'environment'), '') IS NULL
     ) THEN
    RAISE EXCEPTION 'payload.environment must be a non-empty string';
  END IF;
  IF payload ? 'aliases'
     AND jsonb_typeof(payload -> 'aliases') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'payload.aliases must be an array';
  END IF;
  IF payload ? 'original_app_user_id'
     AND (
       jsonb_typeof(payload -> 'original_app_user_id') IS DISTINCT FROM 'string'
       OR nullif(btrim(payload ->> 'original_app_user_id'), '') IS NULL
     ) THEN
    RAISE EXCEPTION 'payload.original_app_user_id must be a non-empty string';
  END IF;
  IF jsonb_typeof(payload -> 'aliases') = 'array'
     AND EXISTS (
       SELECT 1
         FROM jsonb_array_elements(payload -> 'aliases') alias
        WHERE jsonb_typeof(alias) IS DISTINCT FROM 'string'
     ) THEN
    RAISE EXCEPTION 'payload.aliases must contain only strings';
  END IF;
  IF jsonb_typeof(payload -> 'subscriber_attributes') IS DISTINCT FROM 'object'
     OR jsonb_typeof(payload #> '{subscriber_attributes,purchase_intent_id}') IS DISTINCT FROM 'object'
     OR jsonb_typeof(payload #> '{subscriber_attributes,purchase_intent_id,value}') IS DISTINCT FROM 'string'
     OR nullif(btrim(payload #>> '{subscriber_attributes,purchase_intent_id,value}'), '') IS NULL THEN
    RAISE EXCEPTION 'invalid purchase intent attribute';
  END IF;

  incoming_provider_event_id := btrim(payload ->> 'id');
  incoming_event_type := upper(btrim(payload ->> 'type'));
  incoming_product_id := btrim(payload ->> 'product_id');
  app_user_id := btrim(payload ->> 'app_user_id');
  incoming_transaction_id := btrim(payload ->> 'transaction_id');
  incoming_original_transaction_id := btrim(payload ->> 'original_transaction_id');
  incoming_environment := nullif(btrim(payload ->> 'environment'), '');
  intent_id_text := btrim(payload #>> '{subscriber_attributes,purchase_intent_id,value}');

  IF incoming_event_type IN ('INITIAL_PURCHASE', 'NON_RENEWING_PURCHASE', 'RENEWAL')
     AND (incoming_transaction_id IS NULL OR incoming_original_transaction_id IS NULL) THEN
    RAISE EXCEPTION 'purchase events require transaction identifiers';
  END IF;
  IF incoming_event_type IN ('CANCELLATION', 'REFUND', 'EXPIRATION')
     AND incoming_original_transaction_id IS NULL THEN
    RAISE EXCEPTION 'lifecycle events require original_transaction_id';
  END IF;

  IF incoming_product_id NOT IN ('creator_launch_credit_499', 'campaign_30d_1999') THEN
    RAISE EXCEPTION 'unknown product %', incoming_product_id;
  END IF;
  IF intent_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'invalid purchase intent';
  END IF;

  SELECT * INTO intent
    FROM public.purchase_intents
   WHERE id = intent_id_text::UUID
   FOR UPDATE;
  IF NOT FOUND
     OR intent.user_id::TEXT <> app_user_id
     OR intent.product_id <> incoming_product_id
     OR intent.status = 'expired'
     OR (intent.status = 'issued' AND intent.expires_at <= now()) THEN
    RAISE EXCEPTION 'invalid purchase intent';
  END IF;

  IF incoming_product_id = 'campaign_30d_1999' THEN
    PERFORM 1
      FROM public.campaigns
     WHERE id = intent.scope_id
       AND owner_user_id = intent.user_id
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'campaign pass intent scope no longer belongs to purchaser';
    END IF;
  END IF;

  IF incoming_original_transaction_id IS NOT NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(incoming_original_transaction_id, 140014)
    );
  END IF;
  IF incoming_event_type IN ('INITIAL_PURCHASE', 'NON_RENEWING_PURCHASE', 'RENEWAL') THEN
    IF intent.original_transaction_id IS NOT NULL
       AND intent.original_transaction_id IS DISTINCT FROM incoming_original_transaction_id THEN
      RAISE EXCEPTION 'purchase intent is bound to another original transaction';
    END IF;
  ELSIF incoming_event_type IN ('CANCELLATION', 'REFUND', 'EXPIRATION') THEN
    IF intent.original_transaction_id IS NOT NULL
       AND intent.original_transaction_id IS DISTINCT FROM incoming_original_transaction_id THEN
      RAISE EXCEPTION 'lifecycle event does not match purchase intent';
    END IF;
  ELSIF intent.status = 'consumed'
        AND incoming_original_transaction_id IS NOT NULL
        AND intent.original_transaction_id IS DISTINCT FROM incoming_original_transaction_id THEN
    RAISE EXCEPTION 'event does not match consumed purchase intent';
  END IF;
  IF incoming_original_transaction_id IS NOT NULL
     AND EXISTS (
       SELECT 1
         FROM public.purchase_events
        WHERE original_transaction_id = incoming_original_transaction_id
          AND (
            purchaser_user_id <> intent.user_id
            OR product_id <> incoming_product_id
            OR scope_type <> intent.scope_type
            OR scope_id <> intent.scope_id
          )
     ) THEN
    RAISE EXCEPTION 'original transaction id is bound to another purchase scope';
  END IF;

  event_purchase_time := CASE
    WHEN payload ? 'purchased_at_ms'
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
    intent.user_id,
    incoming_product_id,
    intent.scope_type,
    intent.scope_id,
    incoming_provider_event_id,
    event_purchase_time,
    clock_timestamp(),
    clock_timestamp(),
    incoming_transaction_id,
    incoming_original_transaction_id,
    incoming_environment,
    incoming_event_type,
    app_user_id
  )
  ON CONFLICT (provider_event_id) DO NOTHING
  RETURNING true INTO event_was_inserted;
  event_was_inserted := FOUND;

  IF NOT event_was_inserted THEN
    SELECT * INTO existing_event
      FROM public.purchase_events
     WHERE purchase_events.provider_event_id = incoming_provider_event_id;
    IF existing_event.purchaser_user_id <> intent.user_id
       OR existing_event.product_id <> incoming_product_id
       OR existing_event.scope_type <> intent.scope_type
       OR existing_event.scope_id <> intent.scope_id
       OR existing_event.transaction_id IS DISTINCT FROM incoming_transaction_id
       OR existing_event.original_transaction_id IS DISTINCT FROM incoming_original_transaction_id
       OR existing_event.event_type IS DISTINCT FROM incoming_event_type THEN
      RAISE EXCEPTION 'provider event id conflicts with different event data';
    END IF;
    event_purchase_time := existing_event.purchased_at;
  ELSE
    INSERT INTO public.analytics_events (user_id, event_name, properties)
    SELECT intent.user_id,
           CASE
             WHEN incoming_product_id = 'creator_launch_credit_499'
               THEN 'creator_launch_purchased'
             ELSE 'campaign_pass_purchased'
           END,
           jsonb_build_object(
             'provider_event_id', incoming_provider_event_id,
             'product_id', incoming_product_id,
             'scope_id', intent.scope_id,
             'event_type', incoming_event_type,
             'environment', incoming_environment
           )
     WHERE incoming_event_type IN ('INITIAL_PURCHASE', 'NON_RENEWING_PURCHASE', 'RENEWAL');
  END IF;

  IF incoming_original_transaction_id IS NOT NULL
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
        intent.user_id,
        CASE
          WHEN EXISTS (
            SELECT 1
              FROM public.purchase_events
             WHERE original_transaction_id = incoming_original_transaction_id
               AND product_id = incoming_product_id
               AND scope_id = intent.scope_id
               AND event_type IN ('CANCELLATION', 'REFUND')
          ) THEN 'revoked'::public.credit_state
          ELSE 'available'::public.credit_state
        END,
        incoming_product_id,
        intent.scope_id,
        incoming_original_transaction_id
      )
      ON CONFLICT (idempotency_key) DO NOTHING;

      IF NOT EXISTS (
        SELECT 1
          FROM public.purchase_credit_ledger
         WHERE idempotency_key = incoming_original_transaction_id
           AND user_id = intent.user_id
           AND product_id = incoming_product_id
           AND pitch_draft_id = intent.scope_id
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
           AND scope_id = intent.scope_id
           AND event_type IN ('INITIAL_PURCHASE', 'NON_RENEWING_PURCHASE');
      END IF;

      UPDATE public.campaigns
         SET ends_at = greatest(coalesce(ends_at, benefit_expires_at), benefit_expires_at)
       WHERE id = intent.scope_id
         AND owner_user_id = intent.user_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'campaign pass intent scope no longer belongs to purchaser';
      END IF;

      INSERT INTO public.campaign_entitlements (
        campaign_id,
        product_id,
        active,
        expires_at,
        original_transaction_id
      )
      VALUES (
        intent.scope_id,
        incoming_product_id,
        true,
        benefit_expires_at,
        incoming_original_transaction_id
      )
      ON CONFLICT (campaign_id, product_id) DO UPDATE
        SET updated_at = clock_timestamp();
      entitlement_is_active := private.refresh_campaign_pass_entitlement(
        intent.scope_id,
        incoming_product_id
      );
      SELECT expires_at INTO benefit_expires_at
        FROM public.campaign_entitlements
       WHERE campaign_id = intent.scope_id
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
         AND user_id = intent.user_id
         AND product_id = incoming_product_id
         AND pitch_draft_id = intent.scope_id
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
        intent.scope_id,
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
        intent.scope_id,
        incoming_product_id
      );
      benefit := jsonb_build_object(
        'kind', 'campaign_pass_expiration',
        'active', entitlement_is_active
      );
    END IF;
  ELSIF incoming_event_type = 'TRANSFER' THEN
    needs_review := true;
  END IF;

  RETURN jsonb_build_object(
    'recorded', true,
    'deduplicated', NOT event_was_inserted,
    'benefit', benefit,
    'needs_review', needs_review
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_revenuecat_event(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_revenuecat_event(JSONB) TO service_role;

CREATE FUNCTION public.reserve_creator_credit(draft_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  caller UUID := auth.uid();
  reserved_ledger_id UUID;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;
  PERFORM private.assert_active_account(caller);
  PERFORM 1
    FROM public.pitch_drafts
   WHERE id = draft_id
     AND created_by_user_id = caller
     AND status <> 'published'
     AND status <> 'archived'
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'draft not found, not owned by caller, or already published';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM public.purchase_credit_ledger
     WHERE user_id = caller
       AND pitch_draft_id = draft_id
       AND product_id = 'creator_launch_credit_499'
       AND credit_state = 'reserved'
  ) THEN
    RAISE EXCEPTION 'creator credit is already reserved for draft';
  END IF;

  SELECT id INTO reserved_ledger_id
    FROM public.purchase_credit_ledger
   WHERE user_id = caller
     AND pitch_draft_id = draft_id
     AND product_id = 'creator_launch_credit_499'
     AND credit_state = 'available'
   ORDER BY created_at, id
   FOR UPDATE SKIP LOCKED
   LIMIT 1;
  IF reserved_ledger_id IS NULL THEN
    RAISE EXCEPTION 'no available creator credit for draft';
  END IF;

  UPDATE public.purchase_credit_ledger
     SET credit_state = 'reserved',
         updated_at = now()
   WHERE id = reserved_ledger_id;
  RETURN reserved_ledger_id;
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_creator_credit(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reserve_creator_credit(UUID) TO authenticated;

CREATE FUNCTION public.release_creator_credit(ledger_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  caller UUID := auth.uid();
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;
  PERFORM private.assert_active_account(caller);
  UPDATE public.purchase_credit_ledger
     SET credit_state = 'available',
         updated_at = now()
   WHERE id = ledger_id
     AND user_id = caller
     AND credit_state = 'reserved';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'creator credit is not reserved by caller';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.release_creator_credit(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.release_creator_credit(UUID) TO authenticated;

CREATE FUNCTION public.consume_creator_credit(ledger_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  UPDATE public.purchase_credit_ledger
     SET credit_state = 'consumed',
         updated_at = now()
   WHERE id = ledger_id
     AND credit_state = 'reserved';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'creator credit is not reserved';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_creator_credit(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_creator_credit(UUID) TO service_role;

DROP FUNCTION public.approve_and_publish_pitch(UUID, INTEGER, UUID, UUID[], BOOLEAN);
CREATE FUNCTION public.approve_and_publish_pitch(
  draft_id UUID,
  campaign_days INTEGER,
  revision_id UUID,
  included_asset_ids UUID[],
  hard_claims_confirmed BOOLEAN
)
RETURNS TABLE (campaign_id UUID, campaign_slug TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  caller UUID := auth.uid();
  draft pitch_drafts;
  request consent_requests;
  approved_revision consent_revisions;
  new_campaign_id UUID;
  new_slug TEXT;
  dater_name TEXT;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;
  PERFORM private.assert_active_account(caller);

  IF campaign_days IS DISTINCT FROM 14 THEN
    RAISE EXCEPTION 'campaign_days must be 14';
  END IF;
  IF included_asset_ids IS NULL THEN
    RAISE EXCEPTION 'included asset ids are required';
  END IF;

  SELECT * INTO draft
    FROM pitch_drafts
   WHERE id = draft_id
     AND subject_user_id = caller
     AND status = 'consent_pending'
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'draft not found, not yours to approve, or not awaiting consent';
  END IF;

  SELECT * INTO request
    FROM consent_requests
   WHERE pitch_draft_id = draft.id
     AND subject_user_id = caller
   FOR UPDATE;
  IF request.id IS NULL OR request.revision_id IS DISTINCT FROM revision_id THEN
    RAISE EXCEPTION 'approval requires the latest consent revision';
  END IF;

  SELECT * INTO approved_revision
    FROM consent_revisions
   WHERE id = revision_id
     AND pitch_draft_id = draft.id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'approval revision does not belong to this draft';
  END IF;

  IF NOT (included_asset_ids <@ approved_revision.asset_ids)
     OR EXISTS (
       SELECT 1
         FROM unnest(included_asset_ids) included_asset_id
         LEFT JOIN pitch_assets asset
           ON asset.id = included_asset_id
          AND asset.pitch_draft_id = draft.id
        WHERE asset.id IS NULL OR asset.asset_type <> 'photo'
     ) THEN
    RAISE EXCEPTION 'included assets must be reviewed photo assets from the revision';
  END IF;

  IF coalesce(
    jsonb_array_length(
      CASE
        WHEN jsonb_typeof(
          approved_revision.structure -> 'hard_claims_requiring_confirmation'
        ) = 'array'
          THEN approved_revision.structure -> 'hard_claims_requiring_confirmation'
        ELSE '[]'::JSONB
      END
    ),
    0
  ) > 0 AND hard_claims_confirmed IS NOT TRUE THEN
    RAISE EXCEPTION 'hard claims require confirmation before approval';
  END IF;

  IF private.identity_enforcement() THEN
    PERFORM private.assert_identity_evidence(caller);
  END IF;

  DELETE FROM pitch_assets
   WHERE pitch_draft_id = draft.id
     AND (
       NOT (id = ANY(approved_revision.asset_ids))
       OR (asset_type = 'photo' AND NOT (id = ANY(included_asset_ids)))
     );

  UPDATE pitch_drafts
     SET headline = approved_revision.headline,
         body = approved_revision.body,
         structure = approved_revision.structure,
         status = 'published'
   WHERE id = draft.id;

  UPDATE consent_requests
     SET status = 'approved',
         responded_at = now(),
         response_note = NULL
   WHERE id = request.id;

  SELECT display_name INTO dater_name FROM profiles WHERE user_id = caller;
  new_slug := private.generate_campaign_slug(dater_name);

  INSERT INTO campaigns (pitch_draft_id, owner_user_id, status, published_at, slug, ends_at)
  VALUES (draft.id, caller, 'published', now(), new_slug, now() + INTERVAL '14 days')
  ON CONFLICT (pitch_draft_id) DO UPDATE
    SET status = 'published',
        published_at = now(),
        slug = coalesce(campaigns.slug, EXCLUDED.slug),
        ends_at = EXCLUDED.ends_at
    WHERE campaigns.owner_user_id = EXCLUDED.owner_user_id
  RETURNING id, slug INTO new_campaign_id, new_slug;

  IF new_campaign_id IS NULL THEN
    RAISE EXCEPTION 'existing campaign for this pitch belongs to another owner';
  END IF;

  INSERT INTO campaign_memberships (campaign_id, user_id, role)
  VALUES
    (new_campaign_id, caller, 'DATER_OWNER'),
    (new_campaign_id, draft.created_by_user_id, 'INTRODUCER')
  ON CONFLICT (campaign_id, user_id) DO NOTHING;

  RETURN QUERY SELECT new_campaign_id, new_slug;
END;
$$;

REVOKE ALL ON FUNCTION public.approve_and_publish_pitch(UUID, INTEGER, UUID, UUID[], BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_and_publish_pitch(UUID, INTEGER, UUID, UUID[], BOOLEAN) TO authenticated;
