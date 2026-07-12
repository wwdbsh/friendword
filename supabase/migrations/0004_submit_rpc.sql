-- Clients hold no UPDATE grant on pitch_drafts.status (0003), so the only
-- way to move a draft into the consent stage is this server-validated RPC.
-- It returns the raw consent token exactly once; only its hash is stored.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE FUNCTION public.submit_pitch_for_consent(draft_id UUID)
RETURNS TABLE (consent_request_id UUID, consent_token TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  caller UUID := auth.uid();
  raw_token TEXT;
  new_request_id UUID;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;

  -- Lock the row so concurrent submits cannot double-transition.
  PERFORM 1
     FROM pitch_drafts
    WHERE id = draft_id
      AND created_by_user_id = caller
      AND status = 'draft'
      FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'draft not found, not owned by caller, or not submittable';
  END IF;

  raw_token := replace(replace(encode(gen_random_bytes(24), 'base64'), '+', '-'), '/', '_');
  raw_token := replace(raw_token, '=', '');

  UPDATE pitch_drafts
     SET status = 'consent_pending'
   WHERE id = draft_id;

  INSERT INTO consent_requests (pitch_draft_id, token_hash, status)
  VALUES (draft_id, encode(digest(raw_token, 'sha256'), 'hex'), 'pending')
  RETURNING id INTO new_request_id;

  RETURN QUERY SELECT new_request_id, raw_token;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_pitch_for_consent(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_pitch_for_consent(UUID) TO authenticated;
