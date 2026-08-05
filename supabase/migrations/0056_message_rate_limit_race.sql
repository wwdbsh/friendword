-- 0056: the chat throttle stops being a suggestion.
--
-- private.enforce_message_rate_limit (0025) counts the sender's messages in the
-- last 60 seconds and refuses at 20, but it takes no lock. Under READ COMMITTED
-- each transaction's count runs against its own snapshot, so two concurrent
-- inserts for the same sender both read 19, both find room under the cap, and
-- both commit — 21 rows in the window. Nothing about the trigger being a BEFORE
-- trigger changes that: the count and the insert it gates are not serialized
-- against any other transaction.
--
-- 0045 (lines 16-18) named this exact bug when it fixed the anonymous-report
-- caps, and deliberately left it: "private.enforce_message_rate_limit (0025) is
-- the trigger scaffolding only — its own count has no lock and carries exactly
-- this race for chat messages, which is a separate bug and is NOT fixed here."
-- This migration pays that earmark off.
--
-- THE PATTERN is the one 0024 and 0045 already use: take a transaction-scoped
-- advisory lock on the bucket key, THEN count. The lock is transaction-scoped,
-- so it is still held while the INSERT this trigger gates completes and
-- commits. That is what makes the cap atomic: a concurrent inserter for the
-- same bucket blocks at the PERFORM, and because this function is VOLATILE its
-- count re-snapshots after the lock is granted, so it sees the row the winner
-- just committed. The function must therefore NOT be marked STABLE or
-- IMMUTABLE — a STABLE function may reuse the snapshot taken before the wait,
-- which would make the loser count 19 again and let the 21st row land with the
-- lock doing nothing. 0045:66-78 records the same property.
--
-- BUCKET GRANULARITY is exactly the count key: (sender_user_id, intro_room_id).
-- Locking the room alone would be simpler and wrong — it would serialize the
-- two participants against each other, so an active back-and-forth would queue
-- on a cap neither party is near. supabase/tests/30_message_rate_limit_race.sql
-- guard R-B pins that the peer inserts without waiting.
--
-- SEED 250025 is this trigger's own advisory-lock keyspace, matching the
-- migration that introduced the throttle (0025). The seeds in use are 0
-- (pitch-draft revisions), 140014, 140039, 160016, 450019, 530001, 540054 and
-- 540055; 250025 is new here. The key is a single composite text value rather
-- than the two-key pg_advisory_xact_lock(int, int) form, so the seed still
-- separates this keyspace from every other. uuid::TEXT is canonical lowercase
-- in PostgreSQL, so the concatenation is stable for a given pair.
--
-- TRIGGER ORDER. BEFORE row triggers on the same event fire in name order:
--   messages_enforce_rate_limit (0025, this function)
--   messages_validate_sender    (0001)
-- so the lock is taken before the participant check runs, and
-- messages_growth_events (0033) is an AFTER trigger that runs later still.
-- private.record_growth_event (0033) takes no lock of its own, so there is no
-- second lock to order this one against and no deadlock cycle to construct.
--
-- LOCK KEY EXPOSURE, stated precisely. messages.sender_user_id is client
-- supplied: 0052:95 (originally 0002:84) grants authenticated INSERT on
-- (intro_room_id, sender_user_id, body), and the RLS WITH CHECK that pins
-- sender_user_id = auth.uid() (0002:229-233) is evaluated AFTER before-row
-- triggers. A caller who knows a room id can therefore name the PEER as sender:
-- this trigger takes the victim's bucket lock, validate_message_sender (0001:
-- 430-455) passes because the forged sender genuinely is a participant, and
-- only RLS then refuses the row. So an attacker can pick which bucket key gets
-- locked. The exposure is bounded and accepted: intro_room ids are v4 UUIDs and
-- are only visible to participants, the lock is transaction scoped and the
-- attacking statement is a single PostgREST INSERT that aborts at the RLS check
-- microseconds later, and the worst outcome is that one victim's next message
-- in one room waits for that statement. Moving the check earlier is a change to
-- the RLS/trigger ordering contract, not to this fix, and is not attempted
-- here.
--
-- THE INDEX. public.messages carried NO secondary index — only its primary key
-- (0001:170-177). The count filters on sender_user_id, intro_room_id and a
-- created_at window, so before this migration it was a sequential scan of the
-- whole table, and after this migration it would be a sequential scan performed
-- while holding the bucket lock. messages_sender_room_created_at_idx makes that
-- an index range scan so the critical section stays short. Plain CREATE INDEX,
-- not CONCURRENTLY: migrations run inside a transaction, and the table is
-- pre-beta and small.
--
-- ROLLBACK: restore the 0025 body (identical except for the PERFORM line) with
-- CREATE OR REPLACE, and DROP INDEX public.messages_sender_room_created_at_idx.
-- Both are reversible in place; neither touches data.
--
-- ROLLOUT: rides with the pending 0054/0055 push — and that coupling has a
-- cost worth naming: 0054 is deliberately held behind unrelated user gates
-- (worker secrets, the Linux render benchmark, the share-origin decision —
-- docs/SESSION_HANDOFF.md §2-3), and `supabase db push --linked` applies
-- 0054..0056 together, so THE PRODUCTION CHAT-CAP RACE THIS FILE FIXES STAYS
-- OPEN until those gates clear. Accepted by the goal's sequencing decision
-- (fcp render-launch-path, T008); recorded in docs/DECISIONS.md 2026-08-05.
-- The migration itself is a data no-op — no rows are read, written or
-- migrated, and the refusal message is byte-identical to 0025's so
-- 18_ugc_limits.sql and any client string match are unaffected.

CREATE OR REPLACE FUNCTION private.enforce_message_rate_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Taken BEFORE the count, and transaction scoped, so it is still held while
  -- the gated INSERT commits. See the header on why this function stays
  -- VOLATILE.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      NEW.sender_user_id::TEXT || ':' || NEW.intro_room_id::TEXT,
      250025
    )
  );

  IF (
    SELECT count(*)
      FROM public.messages existing
     WHERE existing.sender_user_id = NEW.sender_user_id
       AND existing.intro_room_id = NEW.intro_room_id
       AND existing.created_at >= now() - INTERVAL '60 seconds'
  ) >= 20 THEN
    RAISE EXCEPTION 'sending too fast — wait a moment';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.enforce_message_rate_limit() FROM PUBLIC;

CREATE INDEX messages_sender_room_created_at_idx
  ON public.messages (sender_user_id, intro_room_id, created_at);
