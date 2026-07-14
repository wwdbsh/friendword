-- Third audit (docs/FRIENDWORD_THIRD_AUDIT_HANDOFF_2026-07-14.md §3
-- P0-NEW-4) Slice 0: the public_beta_enabled=off gate was only wired to
-- interest INSERTs (0023), so campaign publishing stayed open while the
-- doc claimed "external surface is server-blocked". That claim was false.
--
-- This migration makes the gate authoritative for the *publish transition*
-- too, and replaces the "flip the global switch for QA" habit with an
-- explicit per-draft preview allowlist:
--
--   - public.qa_preview_allowlist: service-role-only rows naming the
--     pitch drafts that may go public while the beta is closed (e.g. a
--     signed QA preview surface). No anon/authenticated access.
--   - private.public_beta_or_preview_allowed(draft): the beta is open, OR
--     this specific draft is on the allowlist.
--   - campaigns_public_beta_gate: blocks the transition INTO published
--     (INSERT of a published row, or UPDATE that first reaches published)
--     unless allowed. Published->published maintenance (ends_at renewal),
--     published->paused/expired/archived transitions are never blocked, so
--     0033's expire_due_campaigns() and normal lifecycle keep working.
--   - block_interests_until_public_beta is redefined to honour the same
--     allowlist, keyed by the interest's campaign pitch_draft_id.
--
-- 0023 is left untouched (migrations are append-only); this file redefines
-- only the interest trigger function via CREATE OR REPLACE.

-- ── Explicit QA preview allowlist (service role only) ──────────────────
CREATE TABLE public.qa_preview_allowlist (
  pitch_draft_id UUID PRIMARY KEY REFERENCES public.pitch_drafts(id) ON DELETE CASCADE,
  note TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.qa_preview_allowlist ENABLE ROW LEVEL SECURITY;

-- No policies: RLS with zero policies denies anon/authenticated entirely.
-- service_role (BYPASSRLS) is the only client that can read or write it,
-- and only through the explicit grants below.
REVOKE ALL ON TABLE public.qa_preview_allowlist FROM PUBLIC;
REVOKE ALL ON TABLE public.qa_preview_allowlist FROM anon, authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.qa_preview_allowlist TO service_role;

-- ── Shared gate helper: beta open, or this draft is an approved preview ──
CREATE FUNCTION private.public_beta_or_preview_allowed(target_pitch_draft_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT private.public_beta_enabled()
    OR EXISTS (
      SELECT 1
        FROM public.qa_preview_allowlist
       WHERE pitch_draft_id = target_pitch_draft_id
    );
$$;

REVOKE ALL ON FUNCTION private.public_beta_or_preview_allowed(UUID) FROM PUBLIC;

-- ── Publish transition gate (P0-NEW-4) ─────────────────────────────────
-- Only the transition INTO published is gated. A publish INSERT, or an
-- UPDATE where the row was not already published, must clear the gate.
-- Maintenance on an already published campaign and every exit transition
-- (paused/expired/archived) pass through untouched.
CREATE FUNCTION private.block_publish_until_public_beta()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.status = 'published'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'published') THEN
    IF NOT private.public_beta_or_preview_allowed(NEW.pitch_draft_id) THEN
      RAISE EXCEPTION 'Friendword is in a private beta; publishing is not open yet';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.block_publish_until_public_beta() FROM PUBLIC;

CREATE TRIGGER campaigns_public_beta_gate
BEFORE INSERT OR UPDATE ON public.campaigns
FOR EACH ROW EXECUTE FUNCTION private.block_publish_until_public_beta();

-- ── Interest gate honours the same allowlist (redefines 0023) ──────────
-- Latest definition of block_interests_until_public_beta lives in 0023;
-- this is the full replacement. A campaign whose pitch draft is on the
-- allowlist accepts interest even while the beta is closed. A missing
-- campaign fails closed, exactly as before. EXISTS (not NOT IN) avoids the
-- NULL-swallows-the-predicate trap in plpgsql.
CREATE OR REPLACE FUNCTION private.block_interests_until_public_beta()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  target_draft UUID;
BEGIN
  SELECT pitch_draft_id INTO target_draft
    FROM public.campaigns
   WHERE id = NEW.campaign_id;
  IF target_draft IS NULL
     OR NOT private.public_beta_or_preview_allowed(target_draft) THEN
    RAISE EXCEPTION 'Friendword is in a private beta; interest submissions are not open yet';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.block_interests_until_public_beta() FROM PUBLIC;
