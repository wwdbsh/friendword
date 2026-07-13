-- Paid product benefits (audit P0-4, Slice F): the Campaign Pass unlocks a
-- real, observable capability — the campaign analytics funnel — and the
-- Creator Launch credit is consumed exactly once to unlock the draft's
-- social share kit. Safety, accepting interest, and chat stay free.

CREATE FUNCTION public.get_campaign_pass_state(target_campaign_id UUID)
RETURNS TABLE (pass_active BOOLEAN, pass_expires_at TIMESTAMPTZ)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  caller UUID := auth.uid();
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;
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
     AND e.product_id = 'campaign_30d_1999';
END;
$$;

REVOKE ALL ON FUNCTION public.get_campaign_pass_state(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_campaign_pass_state(UUID) TO authenticated;

-- Pass-gated funnel: unique views, interest starts, and submissions per
-- attribution source. The gate is the product benefit, so no pass = error.
CREATE FUNCTION public.get_campaign_analytics(target_campaign_id UUID)
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
       AND e.product_id = 'campaign_30d_1999'
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

-- The Creator Launch kit unlock: one available credit for the draft is
-- consumed atomically the first time; the unlock itself is permanent and
-- idempotent afterwards (restores never re-charge).
CREATE TABLE public.share_kits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pitch_draft_id UUID NOT NULL UNIQUE REFERENCES pitch_drafts(id) ON DELETE CASCADE,
  unlocked_by_user_id UUID NOT NULL REFERENCES users(id),
  credit_ledger_id UUID NOT NULL REFERENCES purchase_credit_ledger(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.share_kits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.share_kits FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.share_kits TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.share_kits TO service_role;

CREATE POLICY share_kits_select_unlocker ON public.share_kits
  FOR SELECT USING (auth.uid() = unlocked_by_user_id);

CREATE FUNCTION public.unlock_share_kit(target_draft_id UUID)
RETURNS TABLE (share_kit_id UUID, already_unlocked BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  caller UUID := auth.uid();
  draft pitch_drafts;
  credit purchase_credit_ledger;
  existing share_kits;
  new_kit_id UUID;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;
  PERFORM private.assert_active_account(caller);

  SELECT * INTO draft
    FROM pitch_drafts
   WHERE id = target_draft_id AND created_by_user_id = caller
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'draft not found or not yours';
  END IF;
  IF draft.status <> 'published' THEN
    RAISE EXCEPTION 'the share kit unlocks after your friend approves and publishes';
  END IF;

  SELECT * INTO existing FROM share_kits WHERE pitch_draft_id = draft.id;
  IF FOUND THEN
    RETURN QUERY SELECT existing.id, true;
    RETURN;
  END IF;

  SELECT * INTO credit
    FROM purchase_credit_ledger
   WHERE user_id = caller
     AND pitch_draft_id = draft.id
     AND product_id = 'creator_launch_credit_499'
     AND credit_state = 'available'
   ORDER BY created_at
   LIMIT 1
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'creator launch credit required';
  END IF;

  UPDATE purchase_credit_ledger
     SET credit_state = 'consumed'
   WHERE id = credit.id;

  INSERT INTO share_kits (pitch_draft_id, unlocked_by_user_id, credit_ledger_id)
  VALUES (draft.id, caller, credit.id)
  RETURNING id INTO new_kit_id;

  INSERT INTO analytics_events (user_id, event_name, properties)
  VALUES (
    caller,
    'creator_launch_credit_consumed',
    jsonb_build_object('pitch_draft_id', draft.id)
  );

  RETURN QUERY SELECT new_kit_id, false;
END;
$$;

REVOKE ALL ON FUNCTION public.unlock_share_kit(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.unlock_share_kit(UUID) TO authenticated;
