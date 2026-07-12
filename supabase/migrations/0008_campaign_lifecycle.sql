-- Dater-controlled campaign lifecycle. Direct client writes to campaigns
-- are revoked entirely: every transition now flows through this RPC's
-- explicit state machine (publish itself already happens inside
-- approve_and_publish_pitch). Pausing or archiving takes the public page
-- down immediately because /p/[slug] only reads status = 'published'.

REVOKE UPDATE ON public.campaigns FROM authenticated;

CREATE FUNCTION public.set_campaign_status(target_campaign_id UUID, next_status TEXT)
RETURNS TABLE (campaign_status TEXT)
LANGUAGE plpgsql
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

  SELECT * INTO campaign
    FROM campaigns
   WHERE id = target_campaign_id AND owner_user_id = caller
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'campaign not found or not yours';
  END IF;

  IF NOT (
    (campaign.status = 'published' AND next_status IN ('paused', 'archived'))
    OR (campaign.status = 'paused' AND next_status IN ('published', 'archived'))
  ) THEN
    RAISE EXCEPTION 'cannot move campaign from % to %', campaign.status, next_status;
  END IF;

  UPDATE campaigns
     SET status = next_status
   WHERE id = campaign.id;

  RETURN QUERY SELECT next_status;
END;
$$;

REVOKE ALL ON FUNCTION public.set_campaign_status(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_campaign_status(UUID, TEXT) TO authenticated;
