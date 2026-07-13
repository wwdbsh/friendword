-- Reconciliation: an in-progress version of 0013 was deployed to hosted
-- Supabase before the file was finalized (2026-07-13 push incident). This
-- migration re-applies the final definitions that differ from that WIP
-- deploy so local and remote converge. Idempotent on databases that
-- already run the final 0013.

DROP POLICY IF EXISTS pitch_assets_insert_creators ON public.pitch_assets;
DROP POLICY IF EXISTS objects_insert_pitch_creators ON storage.objects;
DROP FUNCTION IF EXISTS private.can_upload_pitch_media(UUID);

CREATE OR REPLACE FUNCTION private.can_upload_pitch_media(draft_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF draft_id IS NULL THEN
    RETURN false;
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM public.pitch_drafts
     WHERE id = draft_id
       AND created_by_user_id = auth.uid()
       AND status IN ('draft', 'changes_requested')
  ) THEN
    RETURN false;
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(draft_id::TEXT, 0)
  );
  RETURN EXISTS (
    SELECT 1
      FROM public.pitch_drafts
     WHERE id = draft_id
       AND created_by_user_id = auth.uid()
       AND status IN ('draft', 'changes_requested')
  );
END;
$$;

REVOKE ALL ON FUNCTION private.can_upload_pitch_media(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.can_upload_pitch_media(UUID) TO authenticated, service_role;

REVOKE ALL ON FUNCTION private.can_upload_pitch_media(UUID) FROM PUBLIC;

CREATE POLICY pitch_assets_insert_creators ON public.pitch_assets
  FOR INSERT WITH CHECK (
    auth.uid() = uploaded_by_user_id
    AND private.can_upload_pitch_media(pitch_draft_id)
  );

CREATE POLICY objects_insert_pitch_creators ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'pitch-media'
    AND private.can_upload_pitch_media(private.pitch_media_draft_id(name))
  );


CREATE OR REPLACE FUNCTION public.respond_consent_request(
  draft_id UUID,
  action TEXT,
  note TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  caller UUID := auth.uid();
  request consent_requests;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;
  PERFORM private.assert_active_account(caller);

  IF action IS NULL OR action NOT IN ('request_changes', 'decline') THEN
    RAISE EXCEPTION 'action must be request_changes or decline';
  END IF;

  SELECT r.* INTO request
    FROM consent_requests r
    JOIN pitch_drafts d ON d.id = r.pitch_draft_id
   WHERE r.pitch_draft_id = draft_id
     AND r.subject_user_id = caller
     AND r.status = 'claimed'
     AND r.revision_id IS NOT NULL
     AND d.subject_user_id = caller
     AND d.status = 'consent_pending'
   FOR UPDATE OF r;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'consent request not found, not claimed by caller, or not awaiting response';
  END IF;

  UPDATE consent_requests
     SET status = CASE WHEN action = 'decline' THEN 'declined' ELSE 'claimed' END,
         response_note = nullif(btrim(note), ''),
         responded_at = now()
   WHERE id = request.id;

  UPDATE pitch_drafts
     SET status = CASE
       WHEN action = 'decline' THEN 'archived'::pitch_draft_status
       ELSE 'changes_requested'::pitch_draft_status
     END
   WHERE id = request.pitch_draft_id;
END;
$$;


REVOKE ALL ON FUNCTION public.respond_consent_request(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.respond_consent_request(UUID, TEXT, TEXT) TO authenticated;
