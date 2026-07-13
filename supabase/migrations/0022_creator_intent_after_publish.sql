-- The Creator Launch kit unlocks only after the dater publishes (0020),
-- so the introducer must be able to buy the credit from the published
-- share screen too. 0014 wrongly limited creator intents to unpublished
-- drafts; only archived drafts stay unpurchasable.

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
