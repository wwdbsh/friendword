-- 0043: run the time-critical scheduled ops inside the database (pg_cron).
--
-- Decision 2026-07-25: GitHub Actions is not used for scheduled ops (private
-- repo minutes are exhausted and no billing budget exists). The two passes
-- that are pure SQL move to pg_cron, which runs inside hosted Supabase at no
-- extra cost:
--
--   * expire_due_campaigns()                      every 15 minutes
--   * scrub_resolved_purchase_review_payloads()   daily 03:30 UTC
--
-- The 15-minute expiration cadence also narrows the fourth-audit H-17 window
-- (an overdue-but-unexpired campaign blocks publishing the next one).
--
-- The storage-touching passes (account deletion processing, orphan media
-- sweep) still require the Storage API and remain advisor-run scripts
-- (scripts/run-scheduled-ops.mjs) until a scheduled runtime with Storage
-- access is chosen at launch hardening (fourth audit Slice 9).
--
-- The local test harness (plain PostgreSQL 17) has no pg_cron, so both steps
-- are guarded: without the extension this migration is a no-op with a NOTICE.
-- Both RPCs are owned by the migration role, so the cron job (running as the
-- job owner) may execute them without widening their service_role-only grants.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
  ELSE
    RAISE NOTICE 'pg_cron unavailable; scheduled jobs not installed (local harness)';
  END IF;
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- cron.schedule upserts by job name, so re-running is idempotent.
    PERFORM cron.schedule(
      'expire-due-campaigns',
      '*/15 * * * *',
      $job$SELECT public.expire_due_campaigns();$job$
    );
    PERFORM cron.schedule(
      'scrub-resolved-purchase-review-payloads',
      '30 3 * * *',
      $job$SELECT public.scrub_resolved_purchase_review_payloads();$job$
    );
  END IF;
END;
$$;
