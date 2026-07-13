-- Second audit Slice 5 (P0-7): invite contact binding is a server
-- invariant, not a UI convention.
--
-- - A consent request can only exist in a claimable state (pending or
--   claimed) with a verified channel + contact hash: enforced by a
--   trigger so every creation and every reactivation path is covered,
--   including direct RPC callers that bypass the app UI.
-- - Legacy contact-less requests cannot be claimed anymore; the
--   introducer must resubmit with a contact (which rebinds the row).
-- - Resubmitting a changes-requested draft may omit the contact only
--   because the existing request already carries its binding — the
--   trigger guarantees that precondition.

CREATE FUNCTION private.require_consent_contact_binding()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.status IN ('pending', 'claimed')
     AND (NEW.invite_contact_hash IS NULL OR NEW.invite_contact_channel IS NULL) THEN
    RAISE EXCEPTION 'a consent request requires a verified invite contact';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.require_consent_contact_binding() FROM PUBLIC;

CREATE TRIGGER consent_requests_contact_binding
BEFORE INSERT OR UPDATE ON public.consent_requests
FOR EACH ROW EXECUTE FUNCTION private.require_consent_contact_binding();

-- Claiming is fail-closed for unbound rows even if one predates the trigger.
CREATE OR REPLACE FUNCTION public.claim_consent_request(raw_token TEXT)
RETURNS TABLE (pitch_draft_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  caller UUID := auth.uid();
  request consent_requests;
  draft pitch_drafts;
  caller_email TEXT;
  caller_contact_hash TEXT;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;
  PERFORM private.assert_active_account(caller);

  request := private.consent_request_by_token(raw_token);
  IF request.id IS NULL OR request.status NOT IN ('pending', 'claimed') THEN
    RAISE EXCEPTION 'consent request not found or no longer claimable';
  END IF;

  -- Second audit P0-7: token possession alone never claims. A request
  -- without a contact binding must be reissued by the introducer.
  IF request.invite_contact_hash IS NULL OR request.invite_contact_channel IS NULL THEN
    RAISE EXCEPTION 'this invitation must be reissued with a verified contact';
  END IF;

  IF request.invite_contact_channel = 'email' THEN
    SELECT email INTO caller_email FROM auth.users WHERE id = caller;
    IF caller_email IS NULL THEN
      RAISE EXCEPTION 'consent invite was sent to a different contact';
    END IF;
    caller_contact_hash := encode(
      digest(private.canonicalize_contact('email', caller_email), 'sha256'),
      'hex'
    );
    IF caller_contact_hash IS DISTINCT FROM request.invite_contact_hash THEN
      RAISE EXCEPTION 'consent invite was sent to a different contact';
    END IF;
  ELSIF request.invite_contact_channel = 'phone' THEN
    RAISE EXCEPTION 'phone invite verification is not available';
  ELSE
    RAISE EXCEPTION 'unsupported invite contact channel';
  END IF;

  SELECT * INTO draft FROM pitch_drafts WHERE id = request.pitch_draft_id FOR UPDATE;
  IF draft.created_by_user_id = caller THEN
    RAISE EXCEPTION 'introducer cannot claim their own consent request';
  END IF;
  IF draft.subject_user_id IS NOT NULL AND draft.subject_user_id <> caller THEN
    RAISE EXCEPTION 'consent request is linked to another account';
  END IF;

  UPDATE pitch_drafts SET subject_user_id = caller WHERE id = draft.id;
  UPDATE consent_requests
     SET subject_user_id = caller, status = 'claimed'
   WHERE id = request.id;

  RETURN QUERY SELECT draft.id;
END;
$$;
