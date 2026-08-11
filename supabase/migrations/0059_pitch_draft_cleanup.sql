-- 0059 (T010, Issue #47): an Introducer can delete a pitch of theirs that never
-- became a campaign — the abandoned draft, the invite a friend never answered,
-- the one they declined.
--
-- WHY THIS EXISTS. The fifth audit's ACC-5: there is no way to remove a dead
-- draft. `authenticated` holds no DELETE on pitch_drafts (0052 revoked the
-- hosted blanket ACL and granted back INSERT/UPDATE columns only), and the one
-- function that deletes a draft — erase_pitch_draft (0018) — is service-role
-- only and is called exclusively by the account-erasure job. So the list a
-- person sees in the app only ever grows, and the sole way to clear it is to
-- delete the whole account.
--
-- ── FIVE DECISIONS, before the DDL ────────────────────────────────────────
--
-- 1. CLEANUP IS NOT ERASURE, AND THIS RPC THEREFORE DOES NOT CALL
--    erase_pitch_draft. That was the first design, and it is wrong for one
--    concrete reason: erase_pitch_draft sets `friendword.erasure = 'on'`, and
--    0051's private.record_video_moderation_review_deletion reads exactly that
--    flag to STAY SILENT — deliberately, because copying an uploader id and an
--    evidence path into ops_alerts during a right-to-erasure request would
--    preserve the identifiers the request exists to remove. Reusing the erasure
--    primitive for a voluntary tidy-up would inherit that silence and hand any
--    account a way to make a pending flagged-clip review vanish without a
--    trace. A person cleaning up a draft is not being erased; they are still a
--    user, and "next strike" is still a live question. So cleanup gets its own
--    transaction-local flag and the moderation trace fires normally.
--
--    What IS shared is the mechanism that needed sharing:
--    private.reject_consent_revision_mutation (0018) is redefined below to
--    honour either flag, so consent revisions stay immutable for every client
--    and deletable only from an authorized server path — now two of them,
--    named, rather than one flag doing double duty.
--
-- 2. A PITCH THAT HAS A CAMPAIGN IS NOT THE INTRODUCER'S TO DELETE (gate rule
--    (1)). The campaign belongs to the Dater; taking a live page down is their
--    act, through the existing /inbox "Take it down for good" (set_campaign_status
--    -> archived). The check is written twice on purpose — `status = 'published'`
--    AND "a campaigns row exists" — because they are different facts that happen
--    to coincide today (approve_and_publish_pitch sets both in one transaction),
--    and only the second one is load-bearing: campaigns.pitch_draft_id is a
--    NO ACTION foreign key (0001:109), so without the explicit refusal this RPC
--    would surface a raw 23503 to the client instead of a sentence.
--
--    An ARCHIVED campaign is refused by the same rule. Archiving is the Dater's
--    exit and the campaign row, its interests, its intro rooms and the consent
--    revision the Dater approved are theirs; letting the Introducer delete the
--    draft underneath would destroy another person's record of what they agreed
--    to. Residual cleanup of an archived campaign is a Dater-side question and
--    is answered in docs/PRIVACY_DATA_MAP.md, not here.
--
-- 3. AN IN-FLIGHT MEDIA JOB BLOCKS THE DELETE (gate rule (2)). Two queues can
--    attach to a draft and both are checked:
--      * media_render_jobs (0054) is the queue the rule names. It cannot
--        actually hold a row for a deletable draft — campaign_id is NOT NULL,
--        so a render implies a campaign, which decision 2 already refuses — and
--        it is checked anyway, because the guard must not depend on a column
--        constraint in another table staying the way it is today.
--      * media_ingest_jobs (0050) is the one that fires in practice: it hangs
--        off pitch_assets ON DELETE CASCADE, so deleting a draft while a worker
--        holds a lease would pull the job row out from under it mid-flight.
--    Only 'queued' and 'leased' block; 'done' and 'failed' are terminal and
--    cascade away with the draft. The refusal is therefore temporary by
--    construction, which matters — a permanent block would re-create the dead
--    end this migration exists to remove.
--
-- 4. MONEY IS NOT DELETED BY A TIDY-UP GESTURE. purchase_credit_ledger.pitch_draft_id
--    is the other NO ACTION reference (0001:230), and a creator_launch_credit_499
--    webhook writes that row against a draft that need not be published yet
--    (0042:709). Re-pointing or voiding a purchased credit is a support
--    decision, not a client one, so the RPC refuses and names the reason;
--    docs/OPS.md carries the handling. Silently dropping the row would be a
--    client deleting an accounting record about its own payment.
--
-- 5. ROWS HERE, BYTES BY THE SWEEP — the 0046 precedent, unchanged. Deleting
--    from storage.objects in SQL removes Storage's metadata row while the bytes
--    stay in the backing store, manufacturing an object nothing can reclaim. So
--    this RPC drops the DB rows and the draft's pitch-media prefix becomes
--    unreferenced, which is precisely what hands it to
--    scripts/cleanup-orphan-media.mjs. That sweep protects a prefix while any
--    consent_revisions row names it and while a published/paused campaign
--    exists; both are gone by the time this function commits (revisions cascade,
--    a campaign was refused), so nothing keeps the objects alive and the next
--    daily pass reclaims everything older than 48h — voice, photos, clips and
--    any renders under <draft>/renders/. The media_validations rows keyed to
--    that prefix have no cascade of their own and are removed here by name, the
--    same way scripts/lib/accountErasure.mjs removes them.
--
-- The edit-window question ("which statuses count as dead?") is deliberately
-- NOT asked. Every status a draft can hold without a campaign that is REACHABLE
-- TODAY — draft, consent_pending, changes_requested, archived (the Dater
-- declined) — is the Introducer's own unpublished work, and 'consent_pending'
-- is the single most common dead state there is: the invite nobody ever opened.
-- The list is an illustration of today's data, not the rule: the rule is "no
-- campaign", so a status added tomorrow is covered without touching this
-- function, and enumerating a subset would leave exactly the common one stuck.

-- ── 1. The shared authorization for consent-revision deletion ─────────────
-- 0018's body, plus the cleanup flag. Consent revisions remain immutable for
-- every client (no UPDATE ever, no unflagged DELETE); the only change is that
-- a second named server path may cascade them away.
CREATE OR REPLACE FUNCTION private.reject_consent_revision_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE'
     AND (
       coalesce(current_setting('friendword.erasure', true), '') = 'on'
       OR coalesce(current_setting('friendword.cleanup', true), '') = 'on'
     ) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'consent revisions are immutable';
END;
$$;

-- ── 2. The cleanup RPC ────────────────────────────────────────────────────
CREATE FUNCTION public.delete_my_pitch_draft(target_draft_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  caller UUID := auth.uid();
  draft pitch_drafts;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;
  PERFORM private.assert_active_account(caller);

  -- FOR UPDATE, the 0033 set_campaign_status precedent. Every gate below is a
  -- read of a fact about this draft followed by a delete of it, so without the
  -- row lock two concurrent calls — the double-tap, the retry after a dropped
  -- response — both pass the gates and the second one deletes zero rows and
  -- still answers "deleted". Locking makes the loser wait and then get the
  -- deterministic sentence ('pitch not found or not yours to delete'), which is
  -- the answer that is actually true for it.
  SELECT * INTO draft FROM pitch_drafts WHERE id = target_draft_id FOR UPDATE;
  -- Ownership is the whole authorization model (no global role). The SUBJECT of
  -- a draft can read it but never delete it, and they get the same answer as a
  -- caller naming an id that does not exist, so this is not an existence
  -- oracle — the 0046 precedent, same sentence shape.
  IF NOT FOUND OR draft.created_by_user_id IS DISTINCT FROM caller THEN
    RAISE EXCEPTION 'pitch not found or not yours to delete';
  END IF;

  IF draft.status = 'published'
     OR EXISTS (SELECT 1 FROM campaigns WHERE pitch_draft_id = draft.id) THEN
    RAISE EXCEPTION 'a published pitch is taken down by the person it is about';
  END IF;

  IF EXISTS (
       SELECT 1 FROM media_render_jobs
        WHERE pitch_draft_id = draft.id
          AND status IN ('queued', 'leased')
     )
     OR EXISTS (
       SELECT 1
         FROM media_ingest_jobs job
         JOIN pitch_assets asset ON asset.id = job.asset_id
        WHERE asset.pitch_draft_id = draft.id
          AND job.status IN ('queued', 'leased')
     ) THEN
    RAISE EXCEPTION 'this pitch is still being processed and cannot be deleted yet';
  END IF;

  IF EXISTS (SELECT 1 FROM purchase_credit_ledger WHERE pitch_draft_id = draft.id) THEN
    RAISE EXCEPTION 'this pitch has a purchase attached and cannot be deleted here';
  END IF;

  -- From here the draft is going. The flag authorizes the consent-revision
  -- cascade and NOTHING else: it is not `friendword.erasure`, so 0051's
  -- moderation trace still records any pending flagged-clip review that goes
  -- with the draft, and 0037's active-account bypass is not opened either (a
  -- suspended caller was already refused above).
  PERFORM set_config('friendword.cleanup', 'on', true);

  DELETE FROM media_validations
   WHERE bucket_id = 'pitch-media'
     AND object_name LIKE draft.id::TEXT || '/%';

  -- consent_requests.revision_id references consent_revisions ON DELETE SET
  -- NULL, so the requests go first and the revision cascade has nothing left
  -- pointing at it. 0018 does the same, for the same reason.
  DELETE FROM consent_requests WHERE pitch_draft_id = target_draft_id;
  DELETE FROM pitch_drafts WHERE id = target_draft_id;

  PERFORM set_config('friendword.cleanup', 'off', true);
END;
$$;

-- `FROM PUBLIC, anon`, not `FROM PUBLIC` — 0051's lesson. Hosted Supabase
-- installs ALTER DEFAULT PRIVILEGES granting EXECUTE on every new public
-- function to anon and authenticated, and an explicit grant is untouched by a
-- revoke aimed at PUBLIC. This is SECURITY DEFINER; the grant list is the only
-- thing between an anonymous request and the function's own authority.
REVOKE ALL ON FUNCTION public.delete_my_pitch_draft(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_my_pitch_draft(UUID) TO authenticated;

COMMENT ON FUNCTION public.delete_my_pitch_draft(UUID) IS
  'Deletes an unpublished pitch draft the caller created, with its assets, consent requests and revisions. Refuses a draft that has a campaign (the Dater takes a page down), one with a queued or leased media job, and one carrying a purchase credit. Deletes DB rows only; the storage prefix is left unreferenced for the orphan sweep, which reclaims bytes through the Storage API.';
