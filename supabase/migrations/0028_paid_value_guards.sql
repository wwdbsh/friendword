-- Second audit Slice 4 (P0-5, P0-6): every purchase maps to exactly one
-- undelivered-or-delivered benefit.
--
-- - Creator Launch: while a draft has an unused credit or an unlocked
--   share kit, no new intent can be issued for it — the repurchase trap
--   (buy again after consuming the credit) is closed server-side.
-- - Campaign Pass: while the campaign's pass entitlement is active and
--   unexpired, no new intent can be issued (no worthless stacking; the
--   product stays "extend by 30 days from purchase", bought again only
--   after the current pass lapses).
-- - Double-tap safety: an unexpired issued intent for the same
--   user+product+scope is returned as-is instead of minting a sibling,
--   so retries converge on one attribution.

DROP FUNCTION public.issue_purchase_intent(TEXT, UUID);

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
  existing_intent public.purchase_intents;
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
    IF EXISTS (
      SELECT 1
        FROM public.campaign_entitlements
       WHERE campaign_id = scope_id
         AND product_id = 'campaign_30d_1999'
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
