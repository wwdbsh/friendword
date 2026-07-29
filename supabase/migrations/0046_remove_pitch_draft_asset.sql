-- 0046: an Introducer can remove a photo they attached to a pitch draft.
--
-- There was no path to delete a pitch_assets row. authenticated holds INSERT
-- only (0002_rls.sql:78) and the one RPC that could remove a row,
-- exclude_pitch_asset, was dropped in 0013. That was survivable while media was
-- registered late, but the mobile client now registers an asset immediately
-- after upload (so the 48h orphan sweep cannot reclaim media a draft still
-- needs) and reconciles "registered assets == the draft's current photos"
-- before submitting. With no delete path, an Introducer who removes a photo
-- from the composer leaves a pitch_assets row behind, reconciliation fails
-- forever, and the ONLY recovery is starting the draft over. This RPC closes
-- that dead end.
--
-- VOICE IS NOT REMOVABLE. The Introducer's original voice recording is a server
-- invariant (decision 2026-07-14) — it is the competitive core of the pitch and
-- the reason create_dater_revision carries the voice asset forward untouched
-- rather than letting a revision drop it. A generic "delete my asset" RPC that
-- also removed voice would hand the client a way to publish a pitch with no
-- Introducer voice at all, so asset_type is checked, not assumed.
--
-- STORAGE BYTES ARE NOT DELETED HERE, only the pitch_assets row. Deleting from
-- storage.objects in SQL removes Storage's metadata row while the bytes stay in
-- the backing store, which manufactures an object nothing can ever reclaim —
-- strictly worse than the orphan it is meant to avoid. Reclaiming bytes has to
-- go through the Storage API, which is what scripts/cleanup-orphan-media.mjs
-- does: it deletes pitch media that no pitch_assets row references and is older
-- than 48 hours (docs/OPS.md). Dropping the row is exactly what hands the
-- object to that sweep, so this RPC does the DB half and the existing,
-- already-operated sweep does the storage half.
--
-- The edit window matches private.can_upload_pitch_media (0012): the creator may
-- change a draft in 'draft' or 'changes_requested'. Everything from
-- consent_pending on is refused, because from that moment the subject is
-- looking at, or has already approved, a specific set of media — silently
-- removing one of those photos afterwards would change what was consented to.
CREATE FUNCTION public.remove_pitch_draft_asset(p_asset_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  caller UUID := auth.uid();
  asset pitch_assets;
  draft pitch_drafts;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;
  PERFORM private.assert_active_account(caller);

  SELECT * INTO asset FROM pitch_assets WHERE id = p_asset_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'pitch asset not found or not yours to remove';
  END IF;

  SELECT * INTO draft FROM pitch_drafts WHERE id = asset.pitch_draft_id;
  -- A non-creator gets the same message as a missing asset: the subject of a
  -- draft can read its assets, so a distinguishable refusal would only tell
  -- them which ids exist, which they can already see, but the creator check and
  -- the existence check answer alike on principle.
  IF NOT FOUND OR draft.created_by_user_id IS DISTINCT FROM caller THEN
    RAISE EXCEPTION 'pitch asset not found or not yours to remove';
  END IF;

  IF draft.status NOT IN ('draft', 'changes_requested') THEN
    RAISE EXCEPTION 'this pitch can no longer be edited';
  END IF;

  IF asset.asset_type <> 'photo' THEN
    RAISE EXCEPTION 'the introducer voice recording cannot be removed';
  END IF;

  -- The subject may attach photos of their own while a draft is consent_pending
  -- (policy pitch_assets_insert_subject, 0002). Those are the subject's
  -- contribution to their own pitch; the creator does not get to delete them.
  IF asset.uploaded_by_user_id IS DISTINCT FROM caller THEN
    RAISE EXCEPTION 'only the uploader can remove this pitch asset';
  END IF;

  DELETE FROM pitch_assets WHERE id = p_asset_id;
END;
$$;

REVOKE ALL ON FUNCTION public.remove_pitch_draft_asset(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.remove_pitch_draft_asset(UUID) TO authenticated;

COMMENT ON FUNCTION public.remove_pitch_draft_asset(UUID) IS
  'Detaches a photo the caller uploaded to their own pitch draft while it is still editable (draft or changes_requested). Voice assets are never removable. Deletes the pitch_assets row only; the storage object is left for the orphan sweep, which reclaims bytes through the Storage API.';
