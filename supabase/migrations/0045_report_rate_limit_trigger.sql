-- 0045: the anonymous-report hourly caps become a database invariant.
--
-- /api/report (apps/web/app/api/report/route.ts) counted recent reports and
-- then inserted, in two PostgREST round trips and two transactions. Under
-- READ COMMITTED that is a plain count-then-insert race: two concurrent
-- requests both read a count under the cap and both insert. It was verified by
-- driving the route with 8 concurrent requests from one IP against a cap of 5 —
-- all 8 rows landed. The route's in-process serialization could only close the
-- window inside a single server instance, and it converted the endpoint into a
-- global serial queue, so it is being removed in favour of this trigger.
--
-- The lock pattern is the one private.pause_campaign_after_high_severity_report
-- already uses (0024): take a transaction-scoped advisory lock on the bucket
-- key, THEN count, so the count and the insert that follows it are serialized
-- against every other transaction touching the same bucket.
-- private.enforce_message_rate_limit (0025) is the trigger scaffolding only —
-- its own count has no lock and carries exactly this race for chat messages,
-- which is a separate bug and is NOT fixed here.
--
-- Threshold and window mirror REPORTS_PER_HOUR_PER_IP and the one-hour lookback
-- in that route. The route keeps its own pre-check so it can answer 429 without
-- burning an insert; this trigger is what makes the cap true. If either side
-- changes, both must.
--
-- THERE IS DELIBERATELY NO PER-CAMPAIGN CAP (Advisor decision, 2026-07-29).
-- The route also carried REPORTS_PER_HOUR_PER_CAMPAIGN = 20, and it is dropped
-- rather than moved here:
--   1. It came from the initial implementation, not from an audit finding, so
--      it is not a contract anything else relies on.
--   2. A campaign does not control how many times it is reported. Limiting the
--      ACTOR is what bounds abuse; limiting the TARGET does nothing except
--      discard genuine reports about the campaign being reported most.
--   3. A discarded high-severity report never reaches
--      pause_campaign_after_high_severity_report (0024), so a flood of cheap
--      low-severity anonymous reports could shield a campaign from auto-pause.
--   4. It made the endpoint an oracle for the target's state. Whatever the
--      endpoint answered — a distinguishable 429, or a silent drop that failed
--      to advance the prober's own bucket — a handful of unauthenticated
--      requests revealed whether a page was already at its cap. With the cap
--      gone the answer depends only on the caller's own reporter bucket, so
--      there is nothing about the target left to probe. Guard R3 in
--      supabase/tests/21_report_rate_limit.sql pins that.
--   5. Storage abuse is still bounded by the per-reporter cap and by
--      private.dedupe_repeat_reports (0024). What remains is an ops load
--      question, not a reason to drop safety reports at request time.
--
-- SCOPE. Only anonymous reports are limited, matching the endpoint that has no
-- authentication to rate-limit against. Authenticated reports are already
-- bounded by private.dedupe_repeat_reports (0024) plus the RLS insert policy.
CREATE FUNCTION private.enforce_anon_report_rate_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT NEW.anon_report THEN
    RETURN NEW;
  END IF;

  -- Per reporter IP hash. A legacy anonymous row with no hash cannot be
  -- bucketed, so it is not counted against anyone and is not limited itself.
  --
  -- The lock is taken BEFORE the count, and it is transaction-scoped, so it is
  -- still held while the INSERT this trigger is gating completes and commits.
  -- That is what makes the cap atomic: a concurrent inserter for the same hash
  -- blocks here, and because this function is VOLATILE its count re-snapshots
  -- after the lock is granted, so it sees the row the winner just committed.
  IF NEW.reporter_ip_hash IS NOT NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(NEW.reporter_ip_hash, 450019)
    );

    IF (
      SELECT count(*)
        FROM public.reports existing
       WHERE existing.reporter_ip_hash = NEW.reporter_ip_hash
         AND existing.created_at >= now() - INTERVAL '1 hour'
    ) >= 5 THEN
      RAISE EXCEPTION 'report rate limit exceeded for this reporter';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.enforce_anon_report_rate_limit() FROM PUBLIC;

-- The count reads reports.created_at for one reporter_ip_hash within the last
-- hour, which reports_ip_hash_created_at_idx (0019) already serves, so no new
-- index is created here.
--
-- TRIGGER ORDER. BEFORE row triggers on the same event fire in name order:
--   reports_dedupe_repeat            (0024)
--   reports_enforce_active_account   (0024)
--   reports_normalize_severity       (0016)
--   reports_rate_limit_anon          (this one)
--   reports_set_updated_at
-- Sorting AFTER reports_dedupe_repeat is the load-bearing choice. That trigger
-- returns NULL for a repeat anonymous report, which cancels the INSERT outright
-- and skips every later BEFORE trigger. A report that is going to be dropped as
-- a duplicate must therefore neither consume the reporter's budget nor be
-- refused by it: dedupe is about information already recorded, the cap is about
-- volume actually stored. Running before it would let a duplicate flood raise
-- rate-limit errors for rows that were never going to exist.
-- Sorting after reports_normalize_severity costs nothing — neither rule reads
-- severity — but keeps the row fully normalized before it is counted against,
-- so a future severity-aware cap needs no reordering.
CREATE TRIGGER reports_rate_limit_anon
BEFORE INSERT ON public.reports
FOR EACH ROW EXECUTE FUNCTION private.enforce_anon_report_rate_limit();
