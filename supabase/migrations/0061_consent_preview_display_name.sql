-- T002 (Issue #71): an unconfirmed display name never reaches a public surface.
--
-- `private.handle_new_auth_user` (0011) seeds `profiles.display_name` from the
-- email local-part with `display_name_confirmed = false`, because a bootstrap
-- cannot know whether the person approves of being called "sanghyun.lee92" in
-- front of strangers. Every other public reader is service-role TypeScript and
-- is gated in the data layer; `get_consent_preview` is the one public reader
-- that runs in the database — anonymously, before the dater has signed in — so
-- its gate has to live here.
--
-- The signature and the return columns are unchanged; only the first column's
-- value is gated. `introducer_display_name` becomes NULL for an unconfirmed
-- introducer, and the consent page prints a no-name variant of its copy.
--
-- Deploy ordering: the client that tolerates NULL must be live BEFORE this
-- migration is pushed. Rollback is a forward migration (0062) restoring the
-- ungated body below.
--
-- ROLLBACK WARNING: once 0061 is live on hosted, the web app must NOT be rolled
-- back past the commit that introduced it. Old code parses
-- `introducer_display_name` as a non-null string, so old code + this RPC makes
-- the consent page fail its parse and tell the dater their invite is invalid —
-- on the one screen that has no other way in. Reverting the database first
-- (forward migration 0062) is the only safe order.
--
-- Body reproduced from 0005_consent_and_publish.sql (the latest definition; no
-- later migration redefines it) with the CASE added.
--
-- CREATE OR REPLACE keeps the pg_proc entry and therefore its ACL, so the
-- 0005 `REVOKE ALL FROM PUBLIC` / `GRANT EXECUTE TO anon, authenticated`
-- still stands. `supabase/tests/36_consent_preview_display_name.sql` asserts
-- exactly that rather than trusting it.

CREATE OR REPLACE FUNCTION public.get_consent_preview(raw_token TEXT)
RETURNS TABLE (
  introducer_display_name TEXT,
  relationship_type TEXT,
  relationship_duration TEXT,
  request_status TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  request consent_requests;
BEGIN
  request := private.consent_request_by_token(raw_token);
  IF request.id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT CASE WHEN p.display_name_confirmed THEN p.display_name ELSE NULL END,
         d.relationship_type,
         d.relationship_duration,
         request.status
    FROM pitch_drafts d
    JOIN profiles p ON p.user_id = d.created_by_user_id
   WHERE d.id = request.pitch_draft_id;
END;
$$;
