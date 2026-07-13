-- Erasure paths: consent revisions stay immutable for everyone (no UPDATE,
-- no client DELETE), but authorized erasure — account deletion jobs and
-- test cleanup running as service role — must be able to remove a draft
-- and every snapshot that hangs off it. Deletion is only possible through
-- erase_pitch_draft, which sets a transaction-local flag the trigger checks.

CREATE OR REPLACE FUNCTION private.reject_consent_revision_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE'
     AND coalesce(current_setting('friendword.erasure', true), '') = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'consent revisions are immutable';
END;
$$;

ALTER TABLE public.consent_revisions
  DROP CONSTRAINT consent_revisions_pitch_draft_id_fkey,
  ADD CONSTRAINT consent_revisions_pitch_draft_id_fkey
    FOREIGN KEY (pitch_draft_id) REFERENCES public.pitch_drafts(id) ON DELETE CASCADE;

ALTER TABLE public.consent_requests
  DROP CONSTRAINT consent_requests_revision_id_fkey,
  ADD CONSTRAINT consent_requests_revision_id_fkey
    FOREIGN KEY (revision_id) REFERENCES public.consent_revisions(id) ON DELETE SET NULL;

CREATE FUNCTION public.erase_pitch_draft(target_draft_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  PERFORM set_config('friendword.erasure', 'on', true);
  DELETE FROM consent_requests WHERE pitch_draft_id = target_draft_id;
  DELETE FROM pitch_drafts WHERE id = target_draft_id;
END;
$$;

REVOKE ALL ON FUNCTION public.erase_pitch_draft(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.erase_pitch_draft(UUID) TO service_role;

-- Harness parity: hosted Supabase grants service_role table access through
-- default privileges; the local stub role needs them spelled out.
GRANT SELECT, DELETE ON public.purchase_intents TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchase_events TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchase_credit_ledger TO service_role;
