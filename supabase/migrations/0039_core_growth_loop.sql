-- Third audit Slice 5 (H-7, GP-P0-1, GP-P0-2): the core growth loop is made
-- server-authoritative — one free active campaign per owner, a durable
-- referral chain (public pitch -> new signup -> new campaign) plus a waitlist
-- acquisition surface, and an Introducer-facing "my introduced campaigns"
-- read model that surfaces the live URL slug.
--
-- H-7  COST_MODEL.md promises "one free active campaign per verified Dater"
--      but nothing enforced it, so an owner could publish many campaigns and
--      break the paid-conversion contract. A BEFORE trigger now refuses any
--      transition INTO an active state (published/paused) when the owner
--      already holds another active campaign. A per-owner advisory xact lock
--      serializes concurrent publishes so two simultaneous publishes cannot
--      both win. Campaign Pass stays a *duration* product, not a *quantity*
--      one: the guard ignores whether a pass exists. expired/archived exits
--      are never blocked, so 0033 expiration and normal lifecycle keep working.
--
-- GP-P0-2  A durable referral chain the server can vouch for:
--      - referral_claims records each user's FIRST-touch source campaign
--        (unique per claimer). claim_referral(slug) is authenticated,
--        active-account guarded, ignores the caller's own campaign, and is a
--        no-op once a first source is recorded.
--      - When a campaign first reaches published, an AFTER trigger fills the
--        new_campaign_id of the owner's / the pitch author's open referral
--        claim (server-authoritative — a client cannot forge the linkage).
--      - waitlist_signups + join_waitlist(email, slug?, source?) is the
--        anon-reachable pre-launch acquisition surface: email-validated,
--        idempotent on the email, slug-attributed when the slug maps to a
--        live campaign, and rate-limited by an hourly cap (app_config
--        'waitlist_hourly_cap', default 100). Both tables are PII and are
--        service-role read only; the exporter consumes them.
--
-- GP-P0-1  list_my_introduced_campaigns() gives an Introducer the campaigns
--      they introduced (campaign_memberships role='INTRODUCER'), including the
--      live slug for published/paused campaigns so they can share the URL. A
--      non-public campaign (draft/expired/archived) is still listed for status
--      but its slug is masked NULL so a private link never leaks.
--
-- The 0038 record_revenuecat_event is redefined wholesale (append-only rule)
-- so its expired->published revival honours the new H-7 guard the same way it
-- already honours the 0034 beta gate: the money is kept, the window extended,
-- and a 'revival_blocked_by_active_campaign' review queued.

-- ── H-7: one free active campaign per owner ────────────────────────────
-- "active" == status IN ('published','paused'). The guard fires only on a
-- transition INTO an active state (INSERT of an active row, or an UPDATE
-- whose OLD status was not active). published<->paused moves and ends_at
-- maintenance on an already-active row do not add an active campaign and so
-- pass untouched.
CREATE FUNCTION private.enforce_one_active_campaign()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.status IN ('published', 'paused')
     AND (TG_OP = 'INSERT' OR OLD.status NOT IN ('published', 'paused')) THEN
    -- Serialize concurrent publishes by the same owner so two simultaneous
    -- transitions cannot both pass the EXISTS check below.
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(NEW.owner_user_id::TEXT, 140039)
    );
    IF EXISTS (
      SELECT 1
        FROM public.campaigns other
       WHERE other.owner_user_id = NEW.owner_user_id
         AND other.id <> NEW.id
         AND other.status IN ('published', 'paused')
    ) THEN
      RAISE EXCEPTION
        'owner already has an active campaign; only one campaign may be published or paused at a time'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.enforce_one_active_campaign() FROM PUBLIC;

-- Name sorts before campaigns_public_beta_gate / _publish_identity_gate /
-- _validate_publication, so the H-7 refusal surfaces first among the BEFORE
-- triggers. That is intentional: the revival catch below matches on its text.
CREATE TRIGGER campaigns_one_active_campaign_guard
BEFORE INSERT OR UPDATE ON public.campaigns
FOR EACH ROW EXECUTE FUNCTION private.enforce_one_active_campaign();

-- ── GP-P0-2: durable referral chain ────────────────────────────────────
CREATE TABLE public.referral_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  claimed_by_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  new_campaign_id UUID REFERENCES public.campaigns(id) ON DELETE SET NULL,
  UNIQUE (claimed_by_user_id)
);

ALTER TABLE public.referral_claims ENABLE ROW LEVEL SECURITY;
-- No policies: RLS with zero policies denies anon/authenticated. Only the
-- SECURITY DEFINER RPCs write it, and only service_role (the exporter) reads.
REVOKE ALL ON TABLE public.referral_claims FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.referral_claims TO service_role;

-- First-touch attribution: the caller records the campaign whose public pitch
-- brought them in. Their own campaign is ignored, and once a first source is
-- recorded later calls are a no-op (the chain stays honest).
CREATE FUNCTION public.claim_referral(source_campaign_slug TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  caller UUID := auth.uid();
  source_campaign public.campaigns;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;
  PERFORM private.assert_active_account(caller);

  IF source_campaign_slug IS NULL OR btrim(source_campaign_slug) = '' THEN
    RAISE EXCEPTION 'a source campaign slug is required';
  END IF;

  SELECT * INTO source_campaign
    FROM public.campaigns
   WHERE slug = source_campaign_slug;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'referral source campaign not found';
  END IF;

  -- A user is never attributed to their own campaign.
  IF source_campaign.owner_user_id = caller THEN
    RETURN;
  END IF;

  INSERT INTO public.referral_claims (source_campaign_id, claimed_by_user_id)
  VALUES (source_campaign.id, caller)
  ON CONFLICT (claimed_by_user_id) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_referral(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_referral(TEXT) TO authenticated;

-- When a campaign first reaches published, close the referral loop: any open
-- claim (new_campaign_id IS NULL) held by the new campaign's owner OR its
-- pitch author is stamped with this campaign id. The linkage is written by the
-- server on the real publish transition, so a client cannot forge the K it
-- produces. A claim whose source IS this campaign is left untouched.
CREATE FUNCTION private.link_referral_on_publish()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  draft_creator UUID;
BEGIN
  IF NEW.status = 'published'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'published') THEN
    SELECT created_by_user_id INTO draft_creator
      FROM public.pitch_drafts
     WHERE id = NEW.pitch_draft_id;

    UPDATE public.referral_claims
       SET new_campaign_id = NEW.id
     WHERE claimed_by_user_id IN (NEW.owner_user_id, draft_creator)
       AND new_campaign_id IS NULL
       AND source_campaign_id <> NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.link_referral_on_publish() FROM PUBLIC;

CREATE TRIGGER campaigns_link_referral_on_publish
AFTER INSERT OR UPDATE OF status ON public.campaigns
FOR EACH ROW EXECUTE FUNCTION private.link_referral_on_publish();

-- ── GP-P0-2: pre-launch waitlist acquisition surface ───────────────────
CREATE TABLE public.waitlist_signups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  source_campaign_id UUID REFERENCES public.campaigns(id) ON DELETE SET NULL,
  source TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Case-insensitive idempotency: one row per email address.
CREATE UNIQUE INDEX waitlist_signups_email_unique
  ON public.waitlist_signups (lower(email));

ALTER TABLE public.waitlist_signups ENABLE ROW LEVEL SECURITY;
-- PII: no anon/authenticated read. The RPC writes via SECURITY DEFINER; the
-- exporter reads via service_role only.
REVOKE ALL ON TABLE public.waitlist_signups FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.waitlist_signups TO service_role;

INSERT INTO public.app_config (key, value)
VALUES ('waitlist_hourly_cap', '100')
ON CONFLICT (key) DO NOTHING;

CREATE FUNCTION public.join_waitlist(
  signup_email TEXT,
  source_campaign_slug TEXT DEFAULT NULL,
  signup_source TEXT DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  normalized_email TEXT;
  resolved_campaign_id UUID;
  hourly_cap INTEGER;
  recent_count INTEGER;
BEGIN
  IF signup_email IS NULL THEN
    RAISE EXCEPTION 'an email is required';
  END IF;
  normalized_email := btrim(signup_email);
  IF length(normalized_email) = 0
     OR length(normalized_email) > 254
     OR normalized_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RAISE EXCEPTION 'a valid email is required';
  END IF;

  -- Idempotent: an already-listed email is a silent no-op and never consumes
  -- hourly-cap headroom.
  IF EXISTS (
    SELECT 1 FROM public.waitlist_signups
     WHERE lower(email) = lower(normalized_email)
  ) THEN
    RETURN;
  END IF;

  IF signup_source IS NOT NULL
     AND signup_source !~ '^[A-Za-z0-9_-]{1,64}$' THEN
    RAISE EXCEPTION 'signup_source must be a short slug';
  END IF;

  -- A slug is attributed only when it maps to a real live/lapsed campaign;
  -- an unknown or still-private slug is stored as NULL, never a hard failure.
  IF source_campaign_slug IS NOT NULL AND btrim(source_campaign_slug) <> '' THEN
    SELECT id INTO resolved_campaign_id
      FROM public.campaigns
     WHERE slug = source_campaign_slug
       AND status IN ('published', 'paused', 'expired')
     LIMIT 1;
  END IF;

  -- Serialize the cap check + insert so a burst cannot overshoot the cap.
  PERFORM pg_catalog.pg_advisory_xact_lock(140039140039);

  SELECT coalesce(
           (SELECT value::INTEGER FROM public.app_config WHERE key = 'waitlist_hourly_cap'),
           100
         )
    INTO hourly_cap;
  SELECT count(*) INTO recent_count
    FROM public.waitlist_signups
   WHERE created_at > now() - INTERVAL '1 hour';
  IF recent_count >= hourly_cap THEN
    RAISE EXCEPTION 'waitlist is receiving too many signups right now; please try again later';
  END IF;

  INSERT INTO public.waitlist_signups (email, source_campaign_id, source)
  VALUES (normalized_email, resolved_campaign_id, signup_source)
  ON CONFLICT (lower(email)) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.join_waitlist(TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.join_waitlist(TEXT, TEXT, TEXT) TO anon, authenticated;

-- ── GP-P0-1: an Introducer sees the campaigns they introduced ──────────
CREATE FUNCTION public.list_my_introduced_campaigns()
RETURNS TABLE (
  campaign_id UUID,
  campaign_slug TEXT,
  campaign_status TEXT,
  published_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  dater_display_name TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  caller UUID := auth.uid();
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;
  PERFORM private.assert_active_account(caller);

  RETURN QUERY
    SELECT c.id,
           -- Only a public campaign exposes its shareable slug; a private
           -- status is listed for state but its link is masked.
           CASE WHEN c.status IN ('published', 'paused') THEN c.slug ELSE NULL END,
           c.status,
           c.published_at,
           c.ends_at,
           p.display_name
      FROM public.campaigns c
      JOIN public.campaign_memberships m
        ON m.campaign_id = c.id
       AND m.user_id = caller
       AND m.role = 'INTRODUCER'
       AND m.status = 'active'
      LEFT JOIN public.profiles p
        ON p.user_id = c.owner_user_id
     ORDER BY c.published_at DESC NULLS LAST, c.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.list_my_introduced_campaigns() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_my_introduced_campaigns() TO authenticated;

-- ── H-7 x 0038: revival honours the one-active-campaign guard ──────────
-- Full redefinition of the 0038 grant/record function. The ONLY change from
-- 0038 is the expired->published revival EXCEPTION handler, which now also
-- catches the H-7 guard ('active campaign') and queues a
-- 'revival_blocked_by_active_campaign' review instead of raising — the money
-- is honoured (window extended, entitlement granted) exactly as for the beta
-- gate case.
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

  IF incoming_product_id = 'campaign_30d_1999'
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
