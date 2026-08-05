-- 0055: the NULL-digest grandfathering in the accept-time sender predicate
-- closes. A missing submission-time photo digest stops meaning "trust the
-- stored paths" and starts meaning "prove provenance now".
--
-- WHAT 0044 ALLOWED
--   private.assert_interest_sender_acceptable re-asserts photo provenance
--   (assert_profile_photo_objects) and the strict "bio, intent, at least 2
--   photos" rule only when the sender's photo evidence changed after
--   submission — detected by comparing interests.submitted_photo_digest with
--   the current private.profile_photo_digest. A NULL digest skipped that branch
--   entirely, so an interest with no recorded submission evidence could be
--   accepted with photo paths that resolve to no caller-owned profile-media
--   object, and with a single photo. 0044 grandfathered that deliberately: at
--   the time, enforcing it would have made every already-submitted interest
--   from a legacy sender permanently un-acceptable, with the refusal shown to
--   the DATER.
--
-- WHY IT IS CLOSABLE NOW
--   - There is no client INSERT path onto interests any more. 0052 grants
--     authenticated exactly UPDATE (status, decided_at) on the table; creation
--     is submit_interest-only.
--   - Every current write path records the digest. submit_interest (0044)
--     writes private.profile_photo_digest(caller) on both the INSERT and the
--     ON CONFLICT DO UPDATE branch, and promote_interest_intent (0053)
--     delegates to submit_interest wholesale rather than writing its own row.
--     So no NEW interest can be created with a NULL digest.
--   - Measured on the hosted database on 2026-08-05 (read-only): interests
--     holds exactly one row, its digest is NULL, and it is already terminal
--     'accepted' (decided 2026-07-29, a QA/E2E leftover). Zero NULL-digest rows
--     sit in 'submitted'. The accept predicate runs only on the transition INTO
--     'accepted' — decide_interest requires status 'submitted', and
--     private.enforce_interest_accept_invariants fires only when the status
--     actually changes to 'accepted'. This change is therefore a no-op against
--     the hosted data as it stands: it has nothing to refuse.
--   The deploy-day break 0044 was avoiding does not exist any more.
--
-- NO BACKFILL, DELIBERATELY
--   The obvious "fix" — writing private.profile_photo_digest(sender) into the
--   NULL rows — is refused. That digest describes the evidence as it stands
--   TODAY, not as it stood at submission, which was never recorded. Storing it
--   would fabricate submission-time evidence and, worse, would make the digest
--   compare EQUAL for those rows forever, permanently disabling the very
--   re-check this migration restores. A NULL stays NULL and is judged on its
--   merits at accept time.
--
-- SEMANTICS AFTER THIS MIGRATION
--   NULL digest = "no recorded submission evidence — prove provenance now".
--   The gated branch runs unconditionally for such a row: the strict
--   completeness rule first, then assert_profile_photo_objects. A legacy sender
--   whose profile is complete and whose photo paths resolve to owned
--   profile-media objects with an allowed MIME type still passes untouched;
--   only a sender who cannot prove provenance today is refused. Rows that DO
--   carry a digest are unaffected — the change is confined to the NULL case.
--
-- RECOVERY LIMITATION (operator-visible, stated plainly)
--   A sender refused by this re-check self-repairs by re-submitting: the
--   ON CONFLICT DO UPDATE branch of submit_interest refreshes
--   submitted_photo_digest along with the row. But re-submission goes through
--   the BEFORE INSERT beta gate (block_interests_until_public_beta,
--   0023/0034), which refuses while public_beta_enabled is 'off' unless the
--   campaign's pitch draft is on the QA preview allowlist. So while the beta is
--   closed, a refused legacy sender has no in-product recovery unless an
--   operator allowlists the draft. Given the measured hosted state — no
--   NULL-digest interest awaiting a decision — nobody is in that position
--   today, but the limitation is real and belongs in the record.
--
-- ROLLBACK
--   A later migration that CREATE OR REPLACEs
--   private.assert_interest_sender_acceptable with the 0044 body (predicate
--   `submitted_photo_digest IS NOT NULL AND submitted_photo_digest IS DISTINCT
--   FROM ...`) restores the grandfathering exactly. No schema, data or grant
--   changes are made here, so there is nothing else to undo.
--
-- ROLLOUT
--   Local-only for now. This migration must not be pushed standalone ahead of
--   0054; hosted application rides with the pending 0054 push and 0054's own
--   gates.

-- 0044 body reproduced whole. The ONLY change is the digest predicate below:
-- `IS NOT NULL AND ... IS DISTINCT FROM` becomes `IS NULL OR ... IS DISTINCT
-- FROM`. Check order and every refusal message are byte-identical to 0044, so
-- the messages pinned by 20/a08/c09 and decide_interest's re-attributing
-- wrapper still hold.
CREATE OR REPLACE FUNCTION private.assert_interest_sender_acceptable(
  sender_user_id UUID,
  submitted_photo_digest TEXT
)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM private.assert_active_account(sender_user_id);

  IF EXISTS (
    SELECT 1
      FROM public.deletion_requests
     WHERE user_id = sender_user_id
       AND scope = 'account'
       AND status IN ('queued', 'processing')
  ) THEN
    RAISE EXCEPTION 'the sender has requested account deletion';
  END IF;

  IF NOT private.adult_birth_date(sender_user_id) THEN
    RAISE EXCEPTION 'verified interest requires an adult birth date on your profile';
  END IF;

  IF NOT private.dating_profile_present(sender_user_id) THEN
    RAISE EXCEPTION 'the sender no longer has a bio, an intent, and at least one photo';
  END IF;

  IF submitted_photo_digest IS NULL
     OR submitted_photo_digest IS DISTINCT FROM private.profile_photo_digest(sender_user_id) THEN
    IF NOT private.dating_profile_complete(sender_user_id) THEN
      RAISE EXCEPTION 'complete your dating profile (bio, intent, and at least 2 photos) first';
    END IF;
    PERFORM private.assert_profile_photo_objects(sender_user_id);
  END IF;

  PERFORM private.assert_profile_photo_validations(sender_user_id);

  IF private.identity_enforcement() THEN
    PERFORM private.assert_identity_evidence(sender_user_id);
  END IF;
END;
$$;

-- CREATE OR REPLACE preserves the ACL 0044 set; restated so the privilege
-- boundary is readable in this file rather than only in 0044.
REVOKE ALL ON FUNCTION private.assert_interest_sender_acceptable(UUID, TEXT) FROM PUBLIC;

COMMENT ON FUNCTION public.decide_interest(UUID, TEXT) IS
  'Owner decision on an interest. Accepting asserts the campaign window and re-asserts the sender''s account status, erasure state, adult birth date, dating-profile floor and — under the ops switches — media validation and identity evidence; photo provenance and the strict 2-photo rule are re-asserted whenever the sender changed their photo set after submitting OR no submission-time digest was recorded (0055 closed 0044''s NULL-digest grandfathering). Declining is never gated. Refusals raise and leave the interest submitted so it stays acceptable once the condition clears.';
