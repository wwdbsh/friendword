-- Migration 0045 regressions: the anonymous-report hourly caps are enforced by
-- the database, atomically, and they are genuinely hourly.
--
-- Written in the 19/20 style: every refusal pins the EXACT server message, and
-- every guard carries a positive control in which the same insert succeeds once
-- the mutation is undone — so a fixture that stops reaching the guard fails
-- instead of passing vacuously.
--
-- The reasons are varied deliberately in every loop below. reports_dedupe_repeat
-- (0024) silently drops a repeat anonymous report on the same target with the
-- same reason inside 24 hours, and it fires BEFORE this cap, so reusing one
-- reason would make these fixtures count nothing at all.
BEGIN;

CREATE FUNCTION pg_temp.anon_report(
  ip_hash TEXT,
  target_campaign UUID,
  report_reason TEXT,
  created TIMESTAMPTZ DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  new_id UUID;
BEGIN
  INSERT INTO public.reports (
    reporter_user_id, reported_user_id, campaign_id,
    target_type, target_id, reason, anon_report, reporter_ip_hash
  )
  SELECT
    NULL, campaign.owner_user_id, campaign.id,
    'campaign', campaign.id, report_reason, true, ip_hash
    FROM public.campaigns campaign
   WHERE campaign.id = target_campaign
  RETURNING id INTO new_id;

  IF new_id IS NULL THEN
    -- The dedupe trigger cancelled the row. Never expected in this file; if it
    -- happens a fixture is reusing a reason and the counts below are lies.
    RETURN 'DEDUPED';
  END IF;

  IF created IS NOT NULL THEN
    UPDATE public.reports SET created_at = created WHERE id = new_id;
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM;
END;
$$;

-- Six distinct reasons exist (reports_normalize_severity, 0016), which is one
-- more than the per-reporter cap of 5 — exactly enough to walk the boundary
-- without the dedupe trigger interfering.
CREATE FUNCTION pg_temp.reason_at(n INTEGER)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT (ARRAY['spam', 'other', 'harassment', 'safety_risk', 'impersonation', 'minor'])[
    ((n - 1) % 6) + 1
  ];
$$;

-- Two more campaigns. Only six report reasons exist, and reports_dedupe_repeat
-- keys on (target, reason, reporter), so a single reporter can store at most
-- six rows against one campaign — one short of what R2 needs. Separate targets
-- give each guard a fresh set of reasons, and they let the per-reporter guard
-- be probed without the per-campaign guard firing first, and vice versa.
--   B (owner Drew 0004)  -> the per-campaign guard, R3
--   C (owner Casey 0003) -> the window guard, R2
-- Owners are chosen so the 0039 one-active-campaign guard is satisfied: Blair
-- owns the seed campaign, Alex owns a draft, Casey and Drew own none.
INSERT INTO pitch_drafts (id, created_by_user_id, subject_user_id, status, headline, body)
VALUES
  ('21000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000004',
   'published', 'Rate limit probe B', 'Per-campaign cap probe for 21.'),
  ('21000000-0000-0000-0000-000000000002',
   '00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000003',
   'published', 'Rate limit probe C', 'Hourly window probe for 21.');
INSERT INTO consent_requests (id, pitch_draft_id, subject_user_id, token_hash, status, responded_at)
VALUES
  ('21100000-0000-0000-0000-000000000001', '21000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000004', 'test-21-consent-b', 'approved', now() - INTERVAL '1 day'),
  ('21100000-0000-0000-0000-000000000002', '21000000-0000-0000-0000-000000000002',
   '00000000-0000-0000-0000-000000000003', 'test-21-consent-c', 'approved', now() - INTERVAL '1 day');
INSERT INTO campaigns (id, pitch_draft_id, owner_user_id, status, published_at, slug)
VALUES
  ('21200000-0000-0000-0000-000000000001', '21000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000004', 'published', now(), 'test-21-rate-limit-b'),
  ('21200000-0000-0000-0000-000000000002', '21000000-0000-0000-0000-000000000002',
   '00000000-0000-0000-0000-000000000003', 'published', now(), 'test-21-rate-limit-c');
-- validate_campaign_owner (0001) is deferred to COMMIT, and unlike the audit
-- suites this file has to COMMIT so R4's separate connections can see its rows.
INSERT INTO campaign_memberships (campaign_id, user_id, role)
VALUES
  ('21200000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000004', 'DATER_OWNER'),
  ('21200000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000003', 'DATER_OWNER');

-- ═══ Guard R1: the per-reporter cap is 5 per hour, refused on the 6th ══
DO $$
DECLARE
  failures TEXT[] := ARRAY[]::TEXT[];
  outcome TEXT;
  probe CONSTANT UUID := '20000000-0000-0000-0000-000000000001';
BEGIN
  FOR i IN 1..5 LOOP
    outcome := pg_temp.anon_report('r1-reporter', probe, pg_temp.reason_at(i));
    IF outcome IS NOT NULL THEN
      failures := array_append(
        failures,
        'R1: report ' || i || ' of 5 under the cap was refused with "' || outcome || '"'
      );
    END IF;
  END LOOP;

  -- The boundary: the cap is "5 stored in the last hour", so the 6th is the
  -- first refusal.
  outcome := pg_temp.anon_report('r1-reporter', probe, pg_temp.reason_at(6));
  IF outcome IS NULL THEN
    failures := array_append(failures, 'R1: a 6th report from the same IP hash was stored');
  ELSIF outcome <> 'report rate limit exceeded for this reporter' THEN
    failures := array_append(failures, 'R1: refused with "' || outcome || '"');
  END IF;

  IF (
    SELECT count(*) FROM public.reports WHERE reporter_ip_hash = 'r1-reporter'
  ) <> 5 THEN
    failures := array_append(failures, 'R1: the refused report was stored anyway');
  END IF;

  -- Positive control: a DIFFERENT IP hash, same campaign, same instant. Only
  -- the bucket key changed, and the identical insert succeeds — so the refusal
  -- above came from the per-reporter cap and not from the fixture.
  outcome := pg_temp.anon_report('r1-other-reporter', probe, pg_temp.reason_at(6));
  IF outcome IS NOT NULL THEN
    failures := array_append(
      failures,
      'R1: a different reporter was refused with "' || outcome || '"'
    );
  END IF;

  IF cardinality(failures) > 0 THEN
    RAISE EXCEPTION 'GUARD-R1: %', array_to_string(failures, '; ');
  END IF;
END;
$$;

-- ═══ Guard R3: the endpoint is not an oracle for the TARGET's state ═══
-- 0045 deliberately has no per-campaign cap. Any target-keyed refusal rule made
-- the answer depend on how often the TARGET had been reported, which a few
-- unauthenticated requests could read back. This guard states the property that
-- replaces it: for one reporter, at every point in their own budget, a campaign
-- that is being mass-reported and a campaign that has never been reported are
-- indistinguishable.
--
-- Flood campaign B far past the old cap of 20 with distinct IP hashes; leave
-- campaign C untouched. All 'spam' so severity stays low and the flood does not
-- collide with pause_campaign_after_high_severity_report (0024); distinct
-- hashes so reports_dedupe_repeat does not cancel them.
DO $$
DECLARE
  failures TEXT[] := ARRAY[]::TEXT[];
  outcome TEXT;
  flooded CONSTANT UUID := '21200000-0000-0000-0000-000000000001';
  pristine CONSTANT UUID := '21200000-0000-0000-0000-000000000002';
  under TEXT;
  at_cap TEXT;
BEGIN
  FOR i IN 1..25 LOOP
    outcome := pg_temp.anon_report('r3-flood-' || i, flooded, 'spam');
    IF outcome IS NOT NULL THEN
      failures := array_append(failures, 'R3: flood report ' || i || ' was refused: ' || outcome);
    END IF;
  END LOOP;

  -- Without this the guard could pass on a target that never got past the old
  -- threshold, i.e. by never reaching the condition it claims to test.
  IF (SELECT count(*) FROM public.reports WHERE campaign_id = flooded AND anon_report) < 21 THEN
    failures := array_append(failures, 'R3: the flood did not exceed the retired per-campaign cap');
  END IF;
  IF EXISTS (SELECT 1 FROM public.reports WHERE campaign_id = pristine AND anon_report) THEN
    failures := array_append(failures, 'R3: the pristine campaign is not pristine');
  END IF;

  -- Probe 1, inside the reporter's own budget: both targets answer the same.
  under := pg_temp.anon_report('r3-probe', flooded, 'spam');
  at_cap := pg_temp.anon_report('r3-probe', pristine, 'spam');
  IF under IS DISTINCT FROM at_cap THEN
    failures := array_append(
      failures,
      'R3: flooded target answered "' || coalesce(under, 'stored')
      || '" while the pristine one answered "' || coalesce(at_cap, 'stored') || '"'
    );
  END IF;
  IF under IS NOT NULL THEN
    failures := array_append(failures, 'R3: a first report was refused with "' || under || '"');
  END IF;

  -- Fill this reporter's own bucket to the cap on a third target.
  FOR i IN 1..3 LOOP
    outcome := pg_temp.anon_report(
      'r3-probe', '20000000-0000-0000-0000-000000000001', pg_temp.reason_at(i)
    );
    IF outcome IS NOT NULL THEN
      failures := array_append(failures, 'R3: budget filler ' || i || ' was refused: ' || outcome);
    END IF;
  END LOOP;

  -- Probe 2, now over budget: both targets answer the same again, and with the
  -- reporter's own reason. The response never mentions the target's state.
  under := pg_temp.anon_report('r3-probe', flooded, 'other');
  at_cap := pg_temp.anon_report('r3-probe', pristine, 'other');
  IF under IS DISTINCT FROM at_cap THEN
    failures := array_append(
      failures,
      'R3: over budget, flooded answered "' || coalesce(under, 'stored')
      || '" and pristine answered "' || coalesce(at_cap, 'stored') || '"'
    );
  ELSIF under <> 'report rate limit exceeded for this reporter' THEN
    failures := array_append(failures, 'R3: over budget both answered "' || coalesce(under, 'stored') || '"');
  END IF;

  -- Positive control: an authenticated report on the flooded campaign still
  -- lands, so a flood cannot silence named reporters or starve the auto-pause
  -- trigger.
  INSERT INTO public.reports (
    reporter_user_id, reported_user_id, campaign_id, reason, anon_report
  )
  VALUES (
    '00000000-0000-0000-0000-000000000003',
    '00000000-0000-0000-0000-000000000004',
    flooded, 'harassment', false
  );
  IF NOT EXISTS (
    SELECT 1 FROM public.reports
     WHERE campaign_id = flooded
       AND reporter_user_id = '00000000-0000-0000-0000-000000000003'
  ) THEN
    failures := array_append(failures, 'R3: an authenticated report on a flooded campaign was dropped');
  END IF;

  IF cardinality(failures) > 0 THEN
    RAISE EXCEPTION 'GUARD-R3: %', array_to_string(failures, '; ');
  END IF;
END;
$$;

-- ═══ Guard R2: the window is an hour, and it really is a window ═══════
-- The whole hourly rule is invisible to a test that never ages a row: with the
-- lookback deleted, both caps silently become lifetime caps and R1 still
-- passes. This guard is what makes that mutation fail.
DO $$
DECLARE
  failures TEXT[] := ARRAY[]::TEXT[];
  outcome TEXT;
  probe CONSTANT UUID := '21200000-0000-0000-0000-000000000002';
BEGIN
  -- Five reports that are all just outside the window (1 hour and 1 second
  -- old). They are stored, so a lifetime cap would count them.
  FOR i IN 1..5 LOOP
    outcome := pg_temp.anon_report(
      'r2-reporter', probe, pg_temp.reason_at(i),
      now() - INTERVAL '1 hour' - INTERVAL '1 second'
    );
    IF outcome IS NOT NULL THEN
      failures := array_append(failures, 'R2: aged fixture ' || i || ' was refused: ' || outcome);
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM public.reports WHERE reporter_ip_hash = 'r2-reporter') <> 5 THEN
    failures := array_append(failures, 'R2: the aged fixture did not store 5 rows');
  END IF;

  -- Nothing of this reporter's is inside the window, so a 6th report now is
  -- their FIRST in the window and must be stored.
  outcome := pg_temp.anon_report('r2-reporter', probe, pg_temp.reason_at(6));
  IF outcome IS NOT NULL THEN
    failures := array_append(
      failures,
      'R2: reports older than the window still counted — refused with "' || outcome || '"'
    );
  END IF;

  -- The complement, so the guard cannot pass by never counting anything: age
  -- the same rows to just INSIDE the window and the very next report is
  -- refused. Only the timestamps moved.
  UPDATE public.reports
     SET created_at = now() - INTERVAL '59 minutes'
   WHERE reporter_ip_hash = 'r2-reporter';

  -- Aimed at the seed campaign, not C: this reporter has now used all six
  -- reasons against C, so reports_dedupe_repeat would cancel the row before the
  -- cap ever saw it. The per-reporter bucket is IP-scoped, so the target does
  -- not change what is being measured.
  outcome := pg_temp.anon_report('r2-reporter', '20000000-0000-0000-0000-000000000001', 'spam');
  IF outcome IS NULL THEN
    failures := array_append(failures, 'R2: 6 reports inside the window did not trip the cap');
  ELSIF outcome <> 'report rate limit exceeded for this reporter' THEN
    failures := array_append(failures, 'R2: in-window refusal said "' || outcome || '"');
  END IF;

  IF cardinality(failures) > 0 THEN
    RAISE EXCEPTION 'GUARD-R2: %', array_to_string(failures, '; ');
  END IF;
END;
$$;

COMMIT;

-- ═══ Guard R4: concurrent inserts cannot exceed the cap ═══════════════
-- The bug 0045 exists for is a count-then-insert race: without the advisory
-- lock, two transactions each count 4, each see room under 5, and both commit.
-- A single psql session cannot exhibit it, so this guard drives two real
-- connections through dblink and interleaves them by hand:
--
--   A: BEGIN; insert #5   -- takes the reporter lock, counts 4, holds the lock
--   B: BEGIN; insert #5   -- BLOCKS on the same lock until A commits
--   A: COMMIT             -- B's count now sees 5 and refuses
--
-- Without the lock, B would count 4 concurrently with A and store a 6th row.
-- Runs outside the outer transaction because dblink connections are separate
-- sessions and cannot see uncommitted fixture rows; everything it writes is
-- cleaned up at the end.
CREATE EXTENSION IF NOT EXISTS dblink;

DO $$
DECLARE
  failures TEXT[] := ARRAY[]::TEXT[];
  conn_a CONSTANT TEXT := 'dbname=' || current_database() || ' application_name=fw_r4a';
  conn_b CONSTANT TEXT := 'dbname=' || current_database() || ' application_name=fw_r4b';
  insert_sql CONSTANT TEXT :=
    'INSERT INTO public.reports (reporter_user_id, reported_user_id, campaign_id,'
    || ' target_type, target_id, reason, anon_report, reporter_ip_hash)'
    || ' VALUES (NULL, ''00000000-0000-0000-0000-000000000002'','
    || ' ''20000000-0000-0000-0000-000000000001'', ''campaign'','
    || ' ''20000000-0000-0000-0000-000000000001'', %L, true, ''r4-reporter'')';
  b_refusal TEXT;
  stored INTEGER;
  b_state TEXT;
  waited INTEGER := 0;
BEGIN
  PERFORM dblink_connect('r4a', conn_a);
  PERFORM dblink_connect('r4b', conn_b);

  -- Four reports fill the bucket to one below the cap.
  FOR i IN 1..4 LOOP
    PERFORM dblink_exec('r4a', format(insert_sql, pg_temp.reason_at(i)));
  END LOOP;
  SELECT count(*) INTO stored FROM public.reports WHERE reporter_ip_hash = 'r4-reporter';
  IF stored <> 4 THEN
    failures := array_append(failures, 'R4: the fixture stored ' || stored || ' of 4 rows');
  END IF;

  -- A opens a transaction and inserts the 5th, holding the reporter lock.
  PERFORM dblink_exec('r4a', 'BEGIN');
  PERFORM dblink_exec('r4a', format(insert_sql, pg_temp.reason_at(5)));

  -- B races the same 5th slot. dblink_send_query is asynchronous, so B is
  -- genuinely in flight and blocked on the advisory lock while A still holds it.
  PERFORM dblink_exec('r4b', 'BEGIN');
  PERFORM dblink_send_query('r4b', format(insert_sql, pg_temp.reason_at(6)));

  -- dblink_send_query returns as soon as the query is dispatched, so committing
  -- A right away would race B's backend into starting the statement at all —
  -- and a version of this guard that does that passes even with the advisory
  -- lock deleted. Wait until B's backend has demonstrably reached one of the two
  -- possible outcomes before releasing A:
  --   'Lock'                -> B took its snapshot and is blocked on the
  --                            advisory lock. This is the correct build.
  --   'idle in transaction' -> B already finished the INSERT unserialized.
  --                            This is the mutated build, and the assertions
  --                            below then see the extra row.
  LOOP
    SELECT CASE
             WHEN activity.wait_event_type = 'Lock' THEN 'blocked'
             WHEN activity.state = 'idle in transaction' THEN 'done'
             ELSE NULL
           END
      INTO b_state
      FROM pg_stat_activity activity
     WHERE activity.application_name = 'fw_r4b'
     LIMIT 1;
    EXIT WHEN b_state IS NOT NULL;
    waited := waited + 1;
    IF waited > 400 THEN
      failures := array_append(failures, 'R4: the racing session never reached a decidable state');
      EXIT;
    END IF;
    PERFORM pg_sleep(0.01);
  END LOOP;

  PERFORM dblink_exec('r4a', 'COMMIT');

  BEGIN
    PERFORM dblink_get_result('r4b');
    b_refusal := NULL;
  EXCEPTION WHEN OTHERS THEN
    b_refusal := SQLERRM;
  END;
  PERFORM dblink_get_result('r4b');
  -- COMMIT, not ROLLBACK: an unserialized B must be allowed to persist its row,
  -- otherwise the over-cap outcome is thrown away and the guard passes anyway.
  -- When B was correctly refused its transaction is already aborted and this
  -- commit is a rollback.
  BEGIN
    PERFORM dblink_exec('r4b', 'COMMIT');
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  IF b_refusal IS NULL THEN
    failures := array_append(failures, 'R4: the racing insert was not refused');
  ELSIF position('report rate limit exceeded for this reporter' IN b_refusal) = 0 THEN
    failures := array_append(failures, 'R4: the racing insert failed with "' || b_refusal || '"');
  END IF;

  SELECT count(*) INTO stored FROM public.reports WHERE reporter_ip_hash = 'r4-reporter';
  IF stored <> 5 THEN
    failures := array_append(failures, 'R4: ' || stored || ' rows landed under a cap of 5');
  END IF;

  PERFORM dblink_disconnect('r4a');
  PERFORM dblink_disconnect('r4b');

  IF cardinality(failures) > 0 THEN
    RAISE EXCEPTION 'GUARD-R4: %', array_to_string(failures, '; ');
  END IF;
END;
$$;

-- R1-R3 ran inside a transaction that had to COMMIT for R4's separate sessions
-- to see the schema; clean up everything this file wrote.
DELETE FROM public.ops_alerts WHERE report_id IN (
  SELECT id FROM public.reports
   WHERE reporter_ip_hash LIKE 'r_-%'
      OR campaign_id IN (
        '21200000-0000-0000-0000-000000000001',
        '21200000-0000-0000-0000-000000000002'
      )
);
DELETE FROM public.reports
 WHERE reporter_ip_hash LIKE 'r_-%'
    OR campaign_id IN (
      '21200000-0000-0000-0000-000000000001',
      '21200000-0000-0000-0000-000000000002'
    );
DELETE FROM public.campaigns WHERE id IN (
  '21200000-0000-0000-0000-000000000001',
  '21200000-0000-0000-0000-000000000002'
);
DELETE FROM public.consent_requests WHERE id IN (
  '21100000-0000-0000-0000-000000000001',
  '21100000-0000-0000-0000-000000000002'
);
DELETE FROM public.pitch_drafts WHERE id IN (
  '21000000-0000-0000-0000-000000000001',
  '21000000-0000-0000-0000-000000000002'
);
-- Three high-severity anon reports from distinct IP hashes trip
-- pause_campaign_after_high_severity_report (0024) on the seed campaign; put it
-- back so nothing downstream of this file inherits a paused fixture.
UPDATE public.campaigns SET status = 'published'
 WHERE id = '20000000-0000-0000-0000-000000000001' AND status = 'paused';

SELECT '21_report_rate_limit.sql passed' AS result;
