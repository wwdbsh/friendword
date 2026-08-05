-- Migration 0056 regressions: the per-room chat throttle is atomic, and it is
-- bucketed per SENDER rather than per room.
--
--   R-A. Two concurrent 20th messages from the same sender in the same room
--        cannot both land. The racing session must genuinely block on the
--        sender's bucket lock, must then be refused with the exact server
--        message, and the window must end holding 20 rows — never 21.
--   R-B. The lock key is exactly the count key. While one sender holds its
--        bucket lock uncommitted, the OTHER participant in the same room
--        inserts without waiting. A room-wide lock would pass R-A and fail
--        here, so the two guards together pin the granularity.
--
-- 18_ugc_limits.sql already pins the cap itself in a single session. What a
-- single session cannot exhibit is the count-then-insert race, so this file
-- drives two real connections through dblink and interleaves them by hand:
--
--   A: BEGIN; insert #20   -- takes the sender bucket lock, counts 19, holds it
--   B: BEGIN; insert #20   -- BLOCKS on the same lock until A commits
--   A: COMMIT              -- B's count now re-snapshots at 20 and refuses
--
-- Without the lock, B counts 19 concurrently with A and stores a 21st row.
--
-- This file runs OUTSIDE a transaction. dblink connections are separate
-- sessions and cannot see uncommitted fixture rows (the trap 21_report_rate_
-- limit.sql:322-325 records), so every fixture row is written through a dblink
-- connection and committed. Everything this file writes is deleted at the end.
--
-- The blocked/unblocked distinction is observed through pg_stat_activity, not
-- inferred from a lock_timeout. 21_report_rate_limit.sql:365-378 records that a
-- lock_timeout-only shape of this guard PASSES even with the advisory lock
-- deleted, because dblink_send_query returns as soon as the query is dispatched
-- and the winner can commit before the racer's backend has started the
-- statement at all. This file waits for the racer to reach a decidable state
-- before releasing the winner, and asserts which state that was.

CREATE EXTENSION IF NOT EXISTS dblink;

-- scripts/test-db.sh invokes psql WITHOUT -X (unlike the audit runners), so a
-- developer ~/.psqlrc could install its own timeouts and turn the deliberate
-- lock wait below into a cancelled statement. Pin them here, and on each dblink
-- session as its first statement, so both ends are known.
--   lock_timeout   generous: the racer is SUPPOSED to wait, and the winner
--                  commits milliseconds later.
--   statement_timeout backstop so a wedged run fails instead of hanging.
SET lock_timeout = '30s';
SET statement_timeout = '120s';

-- Poll a named backend until it has demonstrably reached one of the two
-- possible outcomes:
--   'blocked'   -> it took its snapshot and is waiting on a lock. Correct build.
--   'done'      -> it already finished the statement unserialized (or failed).
--                  Mutated build; the assertions then see the extra row.
--   'undecided' -> never resolved inside the deadline; the caller fails.
CREATE FUNCTION pg_temp.await_racer_state(app_name TEXT)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  observed TEXT;
  waited INTEGER := 0;
BEGIN
  LOOP
    -- The backend activity array is snapshotted on first access and cached for
    -- the rest of the transaction, so without this the loop re-reads whatever
    -- the racer was doing on the very first poll — usually 'active', which is
    -- neither outcome — and spins to the deadline. Observed: the pre-0056 run
    -- reported 'undecided' instead of 'done' until this was added.
    PERFORM pg_catalog.pg_stat_clear_snapshot();
    SELECT CASE
             WHEN activity.wait_event_type = 'Lock' THEN 'blocked'
             WHEN activity.state LIKE 'idle in transaction%' THEN 'done'
             ELSE NULL
           END
      INTO observed
      FROM pg_stat_activity activity
     WHERE activity.application_name = app_name
     LIMIT 1;
    EXIT WHEN observed IS NOT NULL;
    waited := waited + 1;
    IF waited > 400 THEN
      RETURN 'undecided';
    END IF;
    PERFORM pg_sleep(0.01);
  END LOOP;
  RETURN observed;
END;
$$;

-- ═══ Guard R-A: concurrent 20th messages cannot exceed the cap ════════
DO $$
DECLARE
  failures TEXT[] := ARRAY[]::TEXT[];
  conn_a CONSTANT TEXT :=
    'dbname=' || current_database() || ' application_name=fw_t30ra_a';
  conn_b CONSTANT TEXT :=
    'dbname=' || current_database() || ' application_name=fw_t30ra_b';
  -- Seed room 40000000-…0001 (dater 00000000-…0002 ↔ interested
  -- 00000000-…0003, status open). Its two seed messages are 1 day and 23 hours
  -- old, so they are outside the 60 second window and count for nobody.
  send_as_dater CONSTANT TEXT :=
    'INSERT INTO public.messages (intro_room_id, sender_user_id, body)'
    || ' VALUES (''40000000-0000-0000-0000-000000000001'','
    || ' ''00000000-0000-0000-0000-000000000002'', %L)';
  b_state TEXT;
  b_refusal TEXT;
  stored INTEGER;
BEGIN
  PERFORM dblink_connect('t30ra_a', conn_a);
  PERFORM dblink_connect('t30ra_b', conn_b);
  PERFORM dblink_exec('t30ra_a', 'SET lock_timeout = ''30s''');
  PERFORM dblink_exec('t30ra_a', 'SET statement_timeout = ''120s''');
  PERFORM dblink_exec('t30ra_b', 'SET lock_timeout = ''30s''');
  PERFORM dblink_exec('t30ra_b', 'SET statement_timeout = ''120s''');

  -- Nineteen committed in-window messages fill the bucket to one below the cap.
  FOR i IN 1..19 LOOP
    PERFORM dblink_exec('t30ra_a', format(send_as_dater, 't30-ra-fixture-' || i));
  END LOOP;

  SELECT count(*) INTO stored
    FROM public.messages
   WHERE intro_room_id = '40000000-0000-0000-0000-000000000001'
     AND sender_user_id = '00000000-0000-0000-0000-000000000002'
     AND created_at >= now() - INTERVAL '60 seconds';
  IF stored <> 19 THEN
    failures := array_append(
      failures, 'R-A: the fixture left ' || stored || ' in-window rows, not 19');
  END IF;

  -- A opens a transaction and takes the 20th slot, holding the sender bucket
  -- lock for as long as its transaction is open.
  PERFORM dblink_exec('t30ra_a', 'BEGIN');
  PERFORM dblink_exec('t30ra_a', format(send_as_dater, 't30-ra-winner'));

  -- B races the same 20th slot. dblink_send_query is asynchronous, so B is
  -- genuinely in flight while A still holds the lock.
  PERFORM dblink_exec('t30ra_b', 'BEGIN');
  PERFORM dblink_send_query('t30ra_b', format(send_as_dater, 't30-ra-racer'));

  b_state := pg_temp.await_racer_state('fw_t30ra_b');
  IF b_state <> 'blocked' THEN
    failures := array_append(
      failures,
      'R-A: the racing insert reached "' || b_state
        || '" instead of blocking on the sender bucket lock');
  END IF;

  PERFORM dblink_exec('t30ra_a', 'COMMIT');

  BEGIN
    PERFORM dblink_get_result('t30ra_b');
    b_refusal := NULL;
  EXCEPTION WHEN OTHERS THEN
    b_refusal := SQLERRM;
  END;
  PERFORM dblink_get_result('t30ra_b');
  -- COMMIT, not ROLLBACK: an unserialized B must be allowed to persist its row,
  -- otherwise the over-cap outcome is discarded and the guard passes anyway.
  -- When B was correctly refused its transaction is already aborted and this
  -- commit is a rollback.
  BEGIN
    PERFORM dblink_exec('t30ra_b', 'COMMIT');
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  IF b_refusal IS NULL THEN
    failures := array_append(failures, 'R-A: the racing insert was not refused');
  ELSIF position('sending too fast — wait a moment' IN b_refusal) = 0 THEN
    failures := array_append(
      failures, 'R-A: the racing insert failed with "' || b_refusal || '"');
  END IF;

  -- Exactly 20, not "at most 20": if the 60 second window had drifted out from
  -- under the fixture the count would fall short and this guard would pass
  -- vacuously.
  SELECT count(*) INTO stored
    FROM public.messages
   WHERE intro_room_id = '40000000-0000-0000-0000-000000000001'
     AND sender_user_id = '00000000-0000-0000-0000-000000000002'
     AND created_at >= now() - INTERVAL '60 seconds';
  IF stored <> 20 THEN
    failures := array_append(
      failures, 'R-A: ' || stored || ' in-window rows landed under a cap of 20');
  END IF;

  PERFORM dblink_disconnect('t30ra_a');
  PERFORM dblink_disconnect('t30ra_b');

  IF cardinality(failures) > 0 THEN
    RAISE EXCEPTION 'GUARD-R-A: %', array_to_string(failures, '; ');
  END IF;
END;
$$;

-- R-A committed its rows through separate sessions; clear the bucket so R-B
-- starts from a known-empty window for both participants.
DELETE FROM public.messages
 WHERE intro_room_id = '40000000-0000-0000-0000-000000000001'
   AND body LIKE 't30-%';

-- ═══ Guard R-B: the bucket is per sender, not per room ════════════════
DO $$
DECLARE
  failures TEXT[] := ARRAY[]::TEXT[];
  conn_a CONSTANT TEXT :=
    'dbname=' || current_database() || ' application_name=fw_t30rb_a';
  conn_b CONSTANT TEXT :=
    'dbname=' || current_database() || ' application_name=fw_t30rb_b';
  send_as_dater CONSTANT TEXT :=
    'INSERT INTO public.messages (intro_room_id, sender_user_id, body)'
    || ' VALUES (''40000000-0000-0000-0000-000000000001'','
    || ' ''00000000-0000-0000-0000-000000000002'', %L)';
  send_as_peer CONSTANT TEXT :=
    'INSERT INTO public.messages (intro_room_id, sender_user_id, body)'
    || ' VALUES (''40000000-0000-0000-0000-000000000001'','
    || ' ''00000000-0000-0000-0000-000000000003'', %L)';
  b_state TEXT;
  b_error TEXT;
  stored INTEGER;
BEGIN
  SELECT count(*) INTO stored
    FROM public.messages
   WHERE intro_room_id = '40000000-0000-0000-0000-000000000001'
     AND created_at >= now() - INTERVAL '60 seconds';
  IF stored <> 0 THEN
    failures := array_append(
      failures,
      'R-B: the window still held ' || stored
        || ' rows, so neither sender starts under its own cap');
  END IF;

  PERFORM dblink_connect('t30rb_a', conn_a);
  PERFORM dblink_connect('t30rb_b', conn_b);
  PERFORM dblink_exec('t30rb_a', 'SET lock_timeout = ''30s''');
  PERFORM dblink_exec('t30rb_a', 'SET statement_timeout = ''120s''');
  PERFORM dblink_exec('t30rb_b', 'SET lock_timeout = ''30s''');
  PERFORM dblink_exec('t30rb_b', 'SET statement_timeout = ''120s''');

  -- A holds the dater's bucket lock, uncommitted.
  PERFORM dblink_exec('t30rb_a', 'BEGIN');
  PERFORM dblink_exec('t30rb_a', format(send_as_dater, 't30-rb-holder'));

  -- The other participant in the SAME room must not be serialized behind it.
  PERFORM dblink_exec('t30rb_b', 'BEGIN');
  PERFORM dblink_send_query('t30rb_b', format(send_as_peer, 't30-rb-peer'));

  b_state := pg_temp.await_racer_state('fw_t30rb_b');
  IF b_state <> 'done' THEN
    failures := array_append(
      failures,
      'R-B: the peer''s insert reached "' || b_state
        || '" while the other sender held its bucket lock');
  END IF;

  BEGIN
    PERFORM dblink_get_result('t30rb_b');
    b_error := NULL;
  EXCEPTION WHEN OTHERS THEN
    b_error := SQLERRM;
  END;
  PERFORM dblink_get_result('t30rb_b');

  IF b_error IS NOT NULL THEN
    failures := array_append(
      failures, 'R-B: the peer''s insert failed with "' || b_error || '"');
  END IF;

  -- Neither side is kept: nothing here needs to survive the guard.
  BEGIN
    PERFORM dblink_exec('t30rb_b', 'ROLLBACK');
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  PERFORM dblink_exec('t30rb_a', 'ROLLBACK');

  PERFORM dblink_disconnect('t30rb_a');
  PERFORM dblink_disconnect('t30rb_b');

  IF cardinality(failures) > 0 THEN
    RAISE EXCEPTION 'GUARD-R-B: %', array_to_string(failures, '; ');
  END IF;
END;
$$;

-- Both guards wrote through committing sessions; leave the seed room exactly as
-- the seed left it. private.messages_growth_events (0033) only fires for the
-- FIRST message in a room and the seed rows predate everything here, so there
-- is no analytics_events residue to clean.
DELETE FROM public.messages
 WHERE intro_room_id = '40000000-0000-0000-0000-000000000001'
   AND body LIKE 't30-%';

SELECT '30_message_rate_limit_race.sql passed' AS result;
