-- Migration 0058 regressions: the event → notification outbox path.
--
--   A. PRODUCERS. The four product moments each write exactly one outbox row,
--      to the right person, with the right landing parameter — and write
--      nothing for a recipient who is not an active account.
--   B. IDEMPOTENCY. Re-entering the same transition on the same source row
--      cannot produce a second mail (the unique index, not sender bookkeeping).
--   C. ACL. anon and authenticated hold ZERO privilege on the table and on
--      both RPCs — proven by EXECUTING the denied statements under the
--      hosted-default grants the auth stub installs, not by assuming.
--   D. LIFECYCLE. The kill switch seeds OFF (D0) and stops claiming in the
--      database (D5). Claim leases under SKIP LOCKED and does not hand the
--      same row out twice (D1); complete needs the live lease (D2); a
--      just-failed entry waits out its backoff before the budget can be spent,
--      and spending it raises an ops_alert (D3); a CRASHED sender's lapsed
--      lease is re-claimable with the attempt counted and a fresh token, and
--      its stale token is dead (D8); a lapsed lease with no budget left is
--      terminalized by the claim itself with exactly one alert (D9); illegal
--      transitions raise (D4); a stale row expires instead of being sent —
--      silently when nothing ever tried it (D6), with an alert when something
--      did (D6b); a malformed max-age degrades to 72 instead of stopping the
--      queue (D10).
--   E. NO ADDRESSES. The one free-text column is constrained to a reason CODE,
--      so an address, provider prose, a phone number and an over-long value
--      are all refused; a provider message quoting an address is normalized.
--
-- red-first: before 0058 this file fails on the first outbox assertion (the
-- table does not exist). Each guard doubles as a mutation probe for one rule —
-- removing the interests trigger fails A1, loosening the table ACL fails C1.
BEGIN;

-- ═══ Fixtures ══════════════════════════════════════════════════════════
-- Interest side: Drew (seed 0004) completes a compliant dating profile with
-- caller-owned storage objects and sends interest on Blair's published seed
-- campaign through the real RPC, exactly as 20_accept_and_expiry_invariants
-- does — so the rows under test are ones submit_interest/decide_interest
-- actually produced, not hand-written ones.
INSERT INTO dating_profiles (user_id, bio, photos, dating_intent, approximate_location)
VALUES (
  '00000000-0000-0000-0000-000000000004',
  'Weekend hikes and jazz bars.',
  ARRAY[
    '00000000-0000-0000-0000-000000000004/drew-1.jpg',
    '00000000-0000-0000-0000-000000000004/drew-2.jpg'
  ],
  'long-term',
  'Seoul'
);
INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
VALUES
  (
    'profile-media',
    '00000000-0000-0000-0000-000000000004/drew-1.jpg',
    '00000000-0000-0000-0000-000000000004',
    '{"mimetype":"image/jpeg"}'
  ),
  (
    'profile-media',
    '00000000-0000-0000-0000-000000000004/drew-2.jpg',
    '00000000-0000-0000-0000-000000000004',
    '{"mimetype":"image/jpeg"}'
  );

-- Render side: an independent draft/campaign/job so the render event cannot be
-- confused with the seed campaign's interest events.
-- Its own dater, because the seed campaign's owner (Blair) may hold only one
-- live campaign at a time.
INSERT INTO auth.users (id, email)
VALUES
  ('ee320000-0000-0000-0000-000000000001', 'n32-introducer@example.test'),
  ('ee320000-0000-0000-0000-000000000002', 'n32-dater@example.test');
INSERT INTO users (id, account_status, phone_verified_at)
SELECT id, 'active', now() - INTERVAL '10 days'
  FROM auth.users WHERE id::TEXT LIKE 'ee320000-%';
INSERT INTO profiles (user_id, display_name, birth_date, verification_status)
VALUES
  ('ee320000-0000-0000-0000-000000000001', 'N32 Introducer', '1990-01-01', 'verified'),
  ('ee320000-0000-0000-0000-000000000002', 'N32 Dater', '1991-02-02', 'verified');

INSERT INTO pitch_drafts (id, created_by_user_id, subject_user_id, status, headline, body)
VALUES (
  'ee321000-0000-0000-0000-000000000001',
  'ee320000-0000-0000-0000-000000000001',
  'ee320000-0000-0000-0000-000000000002',
  'published', 'N32 draft', 'Notification outbox render probe.'
);
INSERT INTO consent_revisions (
  id, pitch_draft_id, revision_number, headline, body, asset_ids, content_hash,
  scene_definition, scene_hash
)
VALUES (
  'ee322000-0000-0000-0000-000000000001', 'ee321000-0000-0000-0000-000000000001',
  1, 'N32 draft', 'Notification outbox render probe.', '{}', 'n32-content-1',
  '{"schemaVersion": 2}', 'n32-scene-1'
);
INSERT INTO consent_requests (
  id, pitch_draft_id, subject_user_id, token_hash, status, responded_at, revision_id
)
VALUES (
  'ee323000-0000-0000-0000-000000000001', 'ee321000-0000-0000-0000-000000000001',
  'ee320000-0000-0000-0000-000000000002', 'n32-consent-a', 'approved',
  now() - INTERVAL '1 day', 'ee322000-0000-0000-0000-000000000001'
);
INSERT INTO campaigns (id, pitch_draft_id, owner_user_id, status, published_at, slug, ends_at)
VALUES (
  'ee324000-0000-0000-0000-000000000001', 'ee321000-0000-0000-0000-000000000001',
  'ee320000-0000-0000-0000-000000000002', 'published', now(), 'n32-a',
  now() + INTERVAL '30 days'
);
INSERT INTO media_render_jobs (
  id, revision_id, campaign_id, pitch_draft_id, scene_hash, requested_by_user_id
)
VALUES (
  'ee325000-0000-0000-0000-000000000001',
  'ee322000-0000-0000-0000-000000000001',
  'ee324000-0000-0000-0000-000000000001',
  'ee321000-0000-0000-0000-000000000001',
  'n32-scene-1',
  'ee320000-0000-0000-0000-000000000001'
);

-- seed.sql inserts an already-'accepted' interest, so the producer trigger has
-- already fired once before this file opened — assert that (a free extra proof
-- the trigger binds a plain INSERT, not only the RPC path) and then clear the
-- table so every count below is exactly what THIS file produced. The whole
-- file rolls back, so nothing is actually deleted.
DO $$
DECLARE
  seeded INTEGER;
BEGIN
  SELECT count(*) INTO seeded
    FROM notification_outbox
   WHERE event_type = 'interest_accepted'
     AND recipient_user_id = '00000000-0000-0000-0000-000000000003';
  IF seeded <> 1 THEN
    RAISE EXCEPTION 'A-seed: the seed accepted interest queued % notifications', seeded;
  END IF;
END;
$$;
DELETE FROM notification_outbox;

-- ═══ A. Producers ══════════════════════════════════════════════════════

-- (A0) A suspended recipient is not queued at all. Blair is suspended BEFORE
-- Drew submits, so the interest lands but the mail does not: notifying an
-- account the product has switched off is a message about a state that no
-- longer exists.
UPDATE users SET account_status = 'suspended'
 WHERE id = '00000000-0000-0000-0000-000000000002';

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);
SELECT interest_id FROM submit_interest(
  '20000000-0000-0000-0000-000000000001',
  'We met at the gallery opening once!'
);
RESET ROLE;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM notification_outbox) THEN
    RAISE EXCEPTION 'A0: a suspended recipient was queued a notification';
  END IF;
END;
$$;

UPDATE users SET account_status = 'active'
 WHERE id = '00000000-0000-0000-0000-000000000002';

-- (A1) S2 arrival reaches the DATER. Drew withdraws and re-submits through the
-- real RPC, so this row is produced by the product path, not by a hand write.
UPDATE interests SET status = 'withdrawn'
 WHERE campaign_id = '20000000-0000-0000-0000-000000000001'
   AND sender_user_id = '00000000-0000-0000-0000-000000000004';

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);
SELECT interest_id FROM submit_interest(
  '20000000-0000-0000-0000-000000000001',
  'We met at the gallery opening once!'
);
RESET ROLE;

DO $$
DECLARE
  failures TEXT[] := ARRAY[]::TEXT[];
  probe UUID;
  entry notification_outbox;
BEGIN
  SELECT id INTO probe FROM interests
   WHERE campaign_id = '20000000-0000-0000-0000-000000000001'
     AND sender_user_id = '00000000-0000-0000-0000-000000000004';

  SELECT * INTO entry FROM notification_outbox
   WHERE event_type = 'interest_received';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'A1: submit_interest queued no interest_received notification';
  END IF;
  IF entry.recipient_user_id <> '00000000-0000-0000-0000-000000000002' THEN
    failures := array_append(failures,
      'A1: interest_received went to ' || entry.recipient_user_id::TEXT);
  END IF;
  IF entry.interest_id IS DISTINCT FROM probe THEN
    failures := array_append(failures, 'A1: the row is not keyed on the interest');
  END IF;
  -- /inbox takes no parameter, so the render-only landing column stays NULL —
  -- and the CHECK constraints make the other shape impossible.
  IF entry.pitch_draft_id IS NOT NULL OR entry.render_job_id IS NOT NULL THEN
    failures := array_append(failures, 'A1: an interest event carried render parameters');
  END IF;
  IF entry.status <> 'pending' OR entry.attempts <> 0
     OR entry.sent_at IS NOT NULL OR entry.last_error IS NOT NULL THEN
    failures := array_append(failures, 'A1: a fresh row was not clean pending');
  END IF;

  IF cardinality(failures) > 0 THEN
    RAISE EXCEPTION 'GUARD-A1: %', array_to_string(failures, '; ');
  END IF;
END;
$$;

-- (B1) IDEMPOTENCY: the same transition again on the same interest row must
-- not produce a second mail. withdrawn -> submitted is a genuinely new
-- transition (the growth trigger records it again), so only the unique index
-- can be what stops the duplicate.
UPDATE interests SET status = 'withdrawn'
 WHERE campaign_id = '20000000-0000-0000-0000-000000000001'
   AND sender_user_id = '00000000-0000-0000-0000-000000000004';

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);
SELECT interest_id FROM submit_interest(
  '20000000-0000-0000-0000-000000000001',
  'We met at the gallery opening once!'
);
RESET ROLE;

DO $$
DECLARE
  arrivals INTEGER;
BEGIN
  SELECT count(*) INTO arrivals
    FROM notification_outbox WHERE event_type = 'interest_received';
  IF arrivals <> 1 THEN
    RAISE EXCEPTION 'B1: re-submitting produced % interest_received rows', arrivals;
  END IF;
END;
$$;

-- (A2) The DECLINE answer reaches the SENDER, and only the sender.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
DO $$
DECLARE
  probe UUID;
BEGIN
  SELECT id INTO probe FROM interests
   WHERE campaign_id = '20000000-0000-0000-0000-000000000001'
     AND sender_user_id = '00000000-0000-0000-0000-000000000004';
  PERFORM * FROM public.decide_interest(probe, 'declined');
END;
$$;
RESET ROLE;

DO $$
DECLARE
  entry notification_outbox;
BEGIN
  SELECT * INTO entry FROM notification_outbox
   WHERE event_type = 'interest_declined';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'A2: declining queued no notification to the sender';
  END IF;
  IF entry.recipient_user_id <> '00000000-0000-0000-0000-000000000004' THEN
    RAISE EXCEPTION 'A2: the decline notice went to % instead of the sender',
      entry.recipient_user_id;
  END IF;
END;
$$;

-- (A3) The ACCEPT answer reaches the SENDER. Reset the probe interest the way
-- 20_accept_and_expiry_invariants does, then accept for real.
UPDATE interests SET status = 'submitted', decided_at = NULL
 WHERE campaign_id = '20000000-0000-0000-0000-000000000001'
   AND sender_user_id = '00000000-0000-0000-0000-000000000004';

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
DO $$
DECLARE
  probe UUID;
BEGIN
  SELECT id INTO probe FROM interests
   WHERE campaign_id = '20000000-0000-0000-0000-000000000001'
     AND sender_user_id = '00000000-0000-0000-0000-000000000004';
  PERFORM * FROM public.decide_interest(probe, 'accepted');
END;
$$;
RESET ROLE;

DO $$
DECLARE
  entry notification_outbox;
BEGIN
  SELECT * INTO entry FROM notification_outbox
   WHERE event_type = 'interest_accepted';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'A3: accepting queued no notification to the sender';
  END IF;
  IF entry.recipient_user_id <> '00000000-0000-0000-0000-000000000004' THEN
    RAISE EXCEPTION 'A3: the accept notice went to % instead of the sender',
      entry.recipient_user_id;
  END IF;
END;
$$;

-- (A4) A finished render reaches whoever asked for the export, WITH the draft
-- id — /kit/<draftId> is the only landing screen that takes a parameter.
UPDATE media_render_jobs
   SET status = 'leased',
       attempts = 1,
       lease_token = 'ee326000-0000-0000-0000-000000000001',
       leased_at = now(),
       lease_expires_at = now() + INTERVAL '10 minutes'
 WHERE id = 'ee325000-0000-0000-0000-000000000001';
UPDATE media_render_jobs
   SET status = 'done',
       lease_token = NULL,
       leased_at = NULL,
       lease_expires_at = NULL,
       output_storage_path =
         'pitch-media/ee321000-0000-0000-0000-000000000001/renders/n32.mp4',
       output_bytes = 1024,
       output_duration_ms = 30000
 WHERE id = 'ee325000-0000-0000-0000-000000000001';

DO $$
DECLARE
  failures TEXT[] := ARRAY[]::TEXT[];
  entry notification_outbox;
BEGIN
  SELECT * INTO entry FROM notification_outbox
   WHERE event_type = 'pitch_render_completed';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'A4: a finished render queued no notification';
  END IF;
  IF entry.recipient_user_id <> 'ee320000-0000-0000-0000-000000000001' THEN
    failures := array_append(failures,
      'A4: the render notice went to ' || entry.recipient_user_id::TEXT);
  END IF;
  IF entry.pitch_draft_id IS DISTINCT FROM 'ee321000-0000-0000-0000-000000000001' THEN
    failures := array_append(failures, 'A4: the render notice lost its landing draft id');
  END IF;
  IF entry.render_job_id IS DISTINCT FROM 'ee325000-0000-0000-0000-000000000001'
     OR entry.interest_id IS NOT NULL THEN
    failures := array_append(failures, 'A4: the render notice is not keyed on the job');
  END IF;
  IF cardinality(failures) > 0 THEN
    RAISE EXCEPTION 'GUARD-A4: %', array_to_string(failures, '; ');
  END IF;
END;
$$;

-- ═══ C. The table and the RPCs are invisible to client roles ═══════════
-- Asserted by EXECUTION, under the hosted default grants the auth stub
-- installs — the only form of ACL assertion worth writing in this repo.
DO $$
DECLARE
  failures TEXT[] := ARRAY[]::TEXT[];
  client_role TEXT;
  privilege TEXT;
BEGIN
  FOREACH client_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    FOREACH privilege IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'] LOOP
      IF has_table_privilege(client_role, 'public.notification_outbox', privilege) THEN
        failures := array_append(failures,
          client_role || ' holds ' || privilege || ' on notification_outbox');
      END IF;
    END LOOP;
    IF has_function_privilege(
         client_role, 'public.claim_notification_outbox(INTEGER, INTEGER)', 'EXECUTE'
       ) THEN
      failures := array_append(failures, client_role || ' may claim the outbox');
    END IF;
    IF has_function_privilege(
         client_role,
         'public.complete_notification_outbox(UUID, UUID, TEXT, TEXT)',
         'EXECUTE'
       ) THEN
      failures := array_append(failures, client_role || ' may complete outbox entries');
    END IF;
  END LOOP;
  IF NOT has_table_privilege('service_role', 'public.notification_outbox', 'SELECT') THEN
    failures := array_append(failures, 'service_role lost SELECT on notification_outbox');
  END IF;
  IF cardinality(failures) > 0 THEN
    RAISE EXCEPTION 'GUARD-C1: %', array_to_string(failures, '; ');
  END IF;
END;
$$;

-- C2: the grant table is one thing, the running statement is another.
SET LOCAL ROLE anon;
DO $$
DECLARE
  visible INTEGER;
BEGIN
  BEGIN
    SELECT count(*) INTO visible FROM public.notification_outbox;
    RAISE EXCEPTION 'C2: anon read the notification outbox';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
    WHEN raise_exception THEN RAISE;
  END;
END;
$$;
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);
DO $$
BEGIN
  BEGIN
    PERFORM * FROM public.claim_notification_outbox(1, 60);
    RAISE EXCEPTION 'C2: authenticated claimed outbox work';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
    WHEN raise_exception THEN RAISE;
  END;
END;
$$;
RESET ROLE;

-- ═══ D. Lease lifecycle ════════════════════════════════════════════════

-- (D0) 0058 seeds the kill switch OFF (decision 6): the migration lands before
-- the secrets exist, and the first mail this product ever sends must be a
-- deliberate operator act, not a side effect of a deploy. Assert the SEEDED
-- value before touching it — if a future migration quietly flips the default
-- back to 'on', the launch-day surprise this guards against returns and every
-- test below would still pass, because they all turn it on themselves.
DO $$
DECLARE
  seeded TEXT;
BEGIN
  SELECT value INTO seeded FROM app_config WHERE key = 'notification_email_enabled';
  IF seeded IS DISTINCT FROM 'off' THEN
    RAISE EXCEPTION 'D0: notification_email_enabled seeds as % (expected off)',
      coalesce(seeded, '<missing>');
  END IF;
END;
$$;
UPDATE app_config SET value = 'on' WHERE key = 'notification_email_enabled';

-- Fixture helper: pretend time passed for ONE entry.
--
-- Inside a transaction now() never moves, so nothing here can wait out a lease
-- or a retry backoff by itself. Both of those clocks have to be pushed
-- backwards together — `lease_expires_at` because a lapsed lease is what makes
-- a crashed sender's row re-claimable, and `updated_at` because 0058's
-- backoff (decision 5b) reads it to decide whether an already-attempted entry
-- has waited long enough. `updated_at` is maintained by a BEFORE UPDATE
-- trigger, so it can only be written with that trigger off for the statement
-- (12_claim_binding.sql precedent).
CREATE FUNCTION pg_temp.age_outbox_entry(target UUID, older INTERVAL)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  ALTER TABLE public.notification_outbox DISABLE TRIGGER notification_outbox_set_updated_at;
  UPDATE public.notification_outbox
     SET updated_at = now() - older,
         lease_expires_at = CASE
           WHEN public.notification_outbox.lease_expires_at IS NULL THEN NULL
           ELSE public.notification_outbox.lease_expires_at - older
         END
   WHERE public.notification_outbox.id = target;
  ALTER TABLE public.notification_outbox ENABLE TRIGGER notification_outbox_set_updated_at;
END;
$$;

-- (D1) One claim leases every pending row once; an immediate second claim sees
-- nothing, because the first still holds the leases.
DO $$
DECLARE
  failures TEXT[] := ARRAY[]::TEXT[];
  first_batch INTEGER;
  anonymous INTEGER;
  second_batch INTEGER;
  leased INTEGER;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE claimed.entry_recipient_user_id IS NULL)
    INTO first_batch, anonymous
    FROM public.claim_notification_outbox(50, 120) claimed;
  IF first_batch <> 4 THEN
    failures := array_append(failures,
      'D1: expected 4 claimable rows (received/declined/accepted/render), got '
      || first_batch);
  END IF;
  IF anonymous <> 0 THEN
    failures := array_append(failures, 'D1: a claimed row carried no recipient identity');
  END IF;

  SELECT count(*) INTO second_batch FROM public.claim_notification_outbox(50, 120);
  IF second_batch <> 0 THEN
    failures := array_append(failures,
      'D1: a live lease was handed out again (' || second_batch || ' rows)');
  END IF;

  SELECT count(*) INTO leased FROM notification_outbox
   WHERE status = 'sending' AND lease_token IS NOT NULL AND attempts = 1;
  IF leased <> 4 THEN
    failures := array_append(failures, 'D1: ' || leased || ' rows carry a whole lease');
  END IF;

  -- The claim contract: identities out, addresses never — asserted on the
  -- declared result type, so a later column addition has to face this.
  IF pg_get_function_result(
       'public.claim_notification_outbox(INTEGER, INTEGER)'::REGPROCEDURE
     ) ~* '(email|address|mail)' THEN
    failures := array_append(failures, 'D1: the claim result type names a mailbox');
  END IF;

  IF cardinality(failures) > 0 THEN
    RAISE EXCEPTION 'GUARD-D1: %', array_to_string(failures, '; ');
  END IF;
END;
$$;

-- Prove the count above is what this file actually produced rather than a
-- number someone typed: four events, four rows, no strays.
DO $$
DECLARE
  produced INTEGER;
BEGIN
  SELECT count(*) INTO produced FROM notification_outbox;
  IF produced <> 4 THEN
    RAISE EXCEPTION 'D1b: this file produced % outbox rows, expected 4', produced;
  END IF;
END;
$$;

-- (D2) complete requires the live lease it was given, and 'sent' is final.
DO $$
DECLARE
  failures TEXT[] := ARRAY[]::TEXT[];
  target UUID;
  token UUID;
  after_status TEXT;
  after_sent TIMESTAMPTZ;
BEGIN
  SELECT id, lease_token INTO target, token
    FROM notification_outbox
   WHERE event_type = 'interest_received' AND status = 'sending';
  IF target IS NULL THEN
    RAISE EXCEPTION 'D2: fixture missing — interest_received is not leased';
  END IF;

  -- A wrong token is not a soft failure.
  BEGIN
    PERFORM public.complete_notification_outbox(
      target, 'ee327000-0000-0000-0000-000000000009', 'sent'
    );
    failures := array_append(failures, 'D2: a foreign token completed the entry');
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'notification outbox lease is not held' THEN
      failures := array_append(failures, 'D2: refused with "' || SQLERRM || '"');
    END IF;
  END;

  -- An unknown outcome word is refused before anything is written.
  BEGIN
    PERFORM public.complete_notification_outbox(target, token, 'delivered');
    failures := array_append(failures, 'D2: an unknown outcome was accepted');
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'notification outcome must be sent or failed' THEN
      failures := array_append(failures, 'D2: outcome refused with "' || SQLERRM || '"');
    END IF;
  END;

  PERFORM public.complete_notification_outbox(target, token, 'sent');
  SELECT status, sent_at INTO after_status, after_sent
    FROM notification_outbox WHERE id = target;
  IF after_status <> 'sent' OR after_sent IS NULL THEN
    failures := array_append(failures, 'D2: a delivered entry was not stamped sent');
  END IF;

  -- Replaying the same lease cannot re-send.
  BEGIN
    PERFORM public.complete_notification_outbox(target, token, 'sent');
    failures := array_append(failures, 'D2: a sent entry was completed twice');
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'notification outbox lease is not held' THEN
      failures := array_append(failures, 'D2: replay refused with "' || SQLERRM || '"');
    END IF;
  END;

  IF cardinality(failures) > 0 THEN
    RAISE EXCEPTION 'GUARD-D2: %', array_to_string(failures, '; ');
  END IF;
END;
$$;

-- (E1) A provider message quoting the recipient's address never lands in the
-- table: complete normalizes to a code, and the CHECK refuses '@' outright.
DO $$
DECLARE
  failures TEXT[] := ARRAY[]::TEXT[];
  target UUID;
  token UUID;
  stored TEXT;
  after_status TEXT;
BEGIN
  SELECT id, lease_token INTO target, token
    FROM notification_outbox
   WHERE event_type = 'interest_declined' AND status = 'sending';

  PERFORM public.complete_notification_outbox(
    target, token, 'failed',
    'Resend 422: recipient someone@example.test was rejected'
  );
  SELECT last_error, status INTO stored, after_status
    FROM notification_outbox WHERE id = target;
  IF stored IS NULL OR position('@' IN stored) > 0 OR stored ~ '[^a-z0-9_]' THEN
    failures := array_append(failures, 'E1: stored reason "' || coalesce(stored, '<null>') || '"');
  END IF;
  -- Attempts remain, so it goes back to pending rather than terminal.
  IF after_status <> 'pending' THEN
    failures := array_append(failures,
      'E1: a retryable failure left the entry ' || after_status);
  END IF;

  -- The constraint, not only the RPC's politeness.
  BEGIN
    UPDATE notification_outbox SET last_error = 'rejected for a@b.test' WHERE id = target;
    failures := array_append(failures, 'E1: an address was stored in last_error');
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- And the constraint is an ALLOWLIST, not a hunt for '@'. A denylist only
  -- refuses the leak it was told to imagine; these three carry no address at
  -- all and must still be refused, because none of them is a reason CODE —
  -- provider prose, a phone number, and a code past the length cap.
  BEGIN
    UPDATE notification_outbox SET last_error = 'Timed out after 15s' WHERE id = target;
    failures := array_append(failures, 'E1: provider prose was stored in last_error');
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE notification_outbox SET last_error = '+82-10-1234-5678' WHERE id = target;
    failures := array_append(failures, 'E1: a phone number was stored in last_error');
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE notification_outbox SET last_error = repeat('x', 61) WHERE id = target;
    failures := array_append(failures, 'E1: an over-long value was stored in last_error');
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- The shape the RPC actually produces is of course still accepted, or the
  -- constraint above would be refusing the product rather than the leak.
  UPDATE notification_outbox SET last_error = 'resend_http_429' WHERE id = target;
  UPDATE notification_outbox SET last_error = stored WHERE id = target;

  IF cardinality(failures) > 0 THEN
    RAISE EXCEPTION 'GUARD-E1: %', array_to_string(failures, '; ');
  END IF;
END;
$$;

-- (D3) The retry budget terminalizes and raises an ops_alert — the queue the
-- hourly safety-escalation pass already reads — and the BACKOFF is what paces
-- the attempts on the way there. E1 left this entry pending with one attempt
-- spent and `updated_at` stamped now.
DO $$
DECLARE
  failures TEXT[] := ARRAY[]::TEXT[];
  target UUID;
  token UUID;
  attempt INTEGER;
  immediate INTEGER;
  final_status TEXT;
  alerts INTEGER;
BEGIN
  SELECT id INTO target FROM notification_outbox WHERE event_type = 'interest_declined';

  -- Decision 5b, asserted BEFORE the budget, because it is what makes the
  -- budget mean anything. The sender re-kicks itself and the daily backstop
  -- also pushes; without a time predicate the very next pass takes this row
  -- straight back, and all three attempts are spent against one provider
  -- outage inside a second — with the operator alerted before anybody could
  -- have fixed a thing.
  SELECT count(*) INTO immediate
    FROM public.claim_notification_outbox(50, 300) claimed
   WHERE claimed.entry_id = target;
  IF immediate <> 0 THEN
    failures := array_append(failures,
      'D3: a just-failed entry was re-claimed inside its backoff window');
  END IF;

  -- Four minutes is still inside attempts(1) x 5.
  PERFORM pg_temp.age_outbox_entry(target, INTERVAL '4 minutes');
  SELECT count(*) INTO immediate
    FROM public.claim_notification_outbox(50, 300) claimed
   WHERE claimed.entry_id = target;
  IF immediate <> 0 THEN
    failures := array_append(failures, 'D3: the backoff window is shorter than 5 minutes');
  END IF;

  FOR attempt IN 2..3 LOOP
    -- Past the window for any attempt count the budget allows (3 x 5 = 15m).
    PERFORM pg_temp.age_outbox_entry(target, INTERVAL '30 minutes');
    PERFORM public.claim_notification_outbox(50, 300);
    SELECT lease_token INTO token FROM notification_outbox WHERE id = target;
    IF token IS NULL THEN
      failures := array_append(failures, 'D3: attempt ' || attempt || ' was never claimed');
      EXIT;
    END IF;
    PERFORM public.complete_notification_outbox(target, token, 'failed', 'provider timeout');
  END LOOP;

  SELECT status INTO final_status FROM notification_outbox WHERE id = target;
  IF final_status <> 'failed' THEN
    failures := array_append(failures,
      'D3: three failed sends left the entry ' || final_status);
  END IF;

  SELECT count(*) INTO alerts FROM ops_alerts
   WHERE alert_type = 'notification_send_failed'
     AND resolved_at IS NULL
     AND detail ->> 'outbox_entry_id' = target::TEXT;
  IF alerts <> 1 THEN
    failures := array_append(failures,
      'D3: terminal failure raised ' || alerts || ' ops alerts');
  END IF;

  -- The alert is ids and a code, never text a provider wrote.
  IF EXISTS (
    SELECT 1 FROM ops_alerts
     WHERE alert_type = 'notification_send_failed'
       AND detail::TEXT LIKE '%@%'
  ) THEN
    failures := array_append(failures, 'D3: an ops alert carried an address');
  END IF;

  -- Terminal is terminal: a spent entry is not handed out again, and ageing it
  -- past every backoff window does not resurrect it either.
  PERFORM pg_temp.age_outbox_entry(target, INTERVAL '30 minutes');
  PERFORM public.claim_notification_outbox(50, 300);
  SELECT status INTO final_status FROM notification_outbox WHERE id = target;
  IF final_status <> 'failed' THEN
    failures := array_append(failures, 'D3: a terminal entry was re-claimed');
  END IF;

  IF cardinality(failures) > 0 THEN
    RAISE EXCEPTION 'GUARD-D3: %', array_to_string(failures, '; ');
  END IF;
END;
$$;

-- (D8) THE CRASH CASE, half one: a sender that died mid-send leaves a lapsed
-- lease behind and never reports anything. The next pass must be able to pick
-- that entry up — with the attempt COUNTED (or a crash loop would retry
-- forever, never reaching the operator) and under a NEW token (or the zombie
-- sender, waking up after the lease lapsed, could overwrite the result of the
-- sender that legitimately holds the row now).
--
-- D1 left interest_accepted leased and untouched, which is exactly the state a
-- crash produces.
DO $$
DECLARE
  failures TEXT[] := ARRAY[]::TEXT[];
  target UUID;
  old_token UUID;
  old_attempts INTEGER;
  new_token UUID;
  new_attempts INTEGER;
  new_status TEXT;
  handed_out INTEGER;
BEGIN
  SELECT id, lease_token, attempts INTO target, old_token, old_attempts
    FROM notification_outbox
   WHERE event_type = 'interest_accepted' AND status = 'sending';
  IF target IS NULL THEN
    RAISE EXCEPTION 'D8: fixture missing — interest_accepted is not leased';
  END IF;

  -- While the lease is LIVE the row belongs to nobody else, however long the
  -- holder takes.
  SELECT count(*) INTO handed_out
    FROM public.claim_notification_outbox(50, 300) claimed
   WHERE claimed.entry_id = target;
  IF handed_out <> 0 THEN
    failures := array_append(failures, 'D8: a live lease was handed out to a second sender');
  END IF;

  -- The sender dies. Half an hour later the lease has lapsed and the backoff
  -- window for one spent attempt has long closed.
  PERFORM pg_temp.age_outbox_entry(target, INTERVAL '30 minutes');

  SELECT count(*) INTO handed_out
    FROM public.claim_notification_outbox(50, 300) claimed
   WHERE claimed.entry_id = target;
  IF handed_out <> 1 THEN
    failures := array_append(failures,
      'D8: an expired lease was not re-claimable (' || handed_out || ' rows)');
  END IF;

  SELECT status, lease_token, attempts INTO new_status, new_token, new_attempts
    FROM notification_outbox WHERE id = target;
  IF new_status <> 'sending' THEN
    failures := array_append(failures, 'D8: the re-claim left the entry ' || new_status);
  END IF;
  IF new_attempts IS DISTINCT FROM old_attempts + 1 THEN
    failures := array_append(failures,
      'D8: the re-claim left attempts at ' || coalesce(new_attempts::TEXT, '<null>')
      || ' (was ' || old_attempts || ')');
  END IF;
  IF new_token IS NULL OR new_token = old_token THEN
    failures := array_append(failures, 'D8: the re-claim reused the crashed sender''s token');
  END IF;

  -- And the zombie cannot report on a row it no longer holds.
  BEGIN
    PERFORM public.complete_notification_outbox(target, old_token, 'sent');
    failures := array_append(failures, 'D8: a stale token completed the entry');
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'notification outbox lease is not held' THEN
      failures := array_append(failures, 'D8: the stale token refused with "' || SQLERRM || '"');
    END IF;
  END;

  IF cardinality(failures) > 0 THEN
    RAISE EXCEPTION 'GUARD-D8: %', array_to_string(failures, '; ');
  END IF;
END;
$$;

-- (D9) THE CRASH CASE, half two: a sender that keeps dying never CALLS
-- complete, so the retry budget is never spent through the completion path and
-- the entry would just sit there, lapsing and re-lapsing, until the 72h sweep
-- eventually ate it in silence. The CLAIM itself has to terminalize a lapsed
-- lease whose budget is gone, and raise EXACTLY ONE ops_alert — one, because
-- the escalation pass fails the hourly job while any alert is unresolved, and
-- a queue that alerts again on every pass is a queue an operator learns to
-- ignore.
DO $$
DECLARE
  failures TEXT[] := ARRAY[]::TEXT[];
  target UUID;
  handed_out INTEGER;
  final_status TEXT;
  final_reason TEXT;
  alerts INTEGER;
BEGIN
  SELECT id INTO target FROM notification_outbox
   WHERE event_type = 'interest_accepted' AND status = 'sending';
  -- The third attempt is under way when this sender dies too.
  UPDATE notification_outbox SET attempts = 3 WHERE id = target;
  PERFORM pg_temp.age_outbox_entry(target, INTERVAL '30 minutes');

  SELECT count(*) INTO handed_out
    FROM public.claim_notification_outbox(50, 300) claimed
   WHERE claimed.entry_id = target;
  IF handed_out <> 0 THEN
    failures := array_append(failures, 'D9: an entry with no budget left was handed to a sender');
  END IF;

  SELECT status, last_error INTO final_status, final_reason
    FROM notification_outbox WHERE id = target;
  IF final_status <> 'failed' THEN
    failures := array_append(failures,
      'D9: the spent entry was left ' || final_status || ' instead of terminalized');
  END IF;
  IF final_reason IS DISTINCT FROM 'retry_budget_spent' THEN
    failures := array_append(failures,
      'D9: the spent entry recorded "' || coalesce(final_reason, '<null>') || '"');
  END IF;

  SELECT count(*) INTO alerts FROM ops_alerts
   WHERE alert_type = 'notification_send_failed'
     AND detail ->> 'outbox_entry_id' = target::TEXT;
  IF alerts <> 1 THEN
    failures := array_append(failures,
      'D9: terminalizing raised ' || alerts || ' ops alerts (expected exactly 1)');
  END IF;

  -- A later pass must not alert again about the same dead entry.
  PERFORM public.claim_notification_outbox(50, 300);
  SELECT count(*) INTO alerts FROM ops_alerts
   WHERE alert_type = 'notification_send_failed'
     AND detail ->> 'outbox_entry_id' = target::TEXT;
  IF alerts <> 1 THEN
    failures := array_append(failures, 'D9: a later pass re-alerted (' || alerts || ' total)');
  END IF;

  IF cardinality(failures) > 0 THEN
    RAISE EXCEPTION 'GUARD-D9: %', array_to_string(failures, '; ');
  END IF;
END;
$$;

-- (D4) Illegal transitions raise, so a hand-written service query cannot walk
-- the state machine backwards or create a row that claims to be delivered.
DO $$
DECLARE
  failures TEXT[] := ARRAY[]::TEXT[];
  sent_entry UUID;
BEGIN
  SELECT id INTO sent_entry FROM notification_outbox WHERE status = 'sent';
  BEGIN
    UPDATE notification_outbox SET status = 'pending', sent_at = NULL WHERE id = sent_entry;
    failures := array_append(failures, 'D4: a sent notification was revived');
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'a sent notification is final' THEN
      failures := array_append(failures, 'D4: revival refused with "' || SQLERRM || '"');
    END IF;
  END;

  BEGIN
    INSERT INTO notification_outbox (
      recipient_user_id, event_type, interest_id, status, sent_at
    )
    VALUES (
      '00000000-0000-0000-0000-000000000004', 'interest_accepted',
      (SELECT id FROM interests
        WHERE sender_user_id = '00000000-0000-0000-0000-000000000003' LIMIT 1),
      'sent', now()
    );
    failures := array_append(failures, 'D4: a row was created already sent');
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'notification outbox entry must be created pending' THEN
      failures := array_append(failures, 'D4: pre-sent insert refused with "' || SQLERRM || '"');
    END IF;
  END;

  -- The identity of a queued notification cannot be repointed at someone else.
  BEGIN
    UPDATE notification_outbox
       SET recipient_user_id = '00000000-0000-0000-0000-000000000003'
     WHERE status = 'sending';
    failures := array_append(failures, 'D4: a queued notification was repointed');
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'notification outbox entry identity is immutable' THEN
      failures := array_append(failures, 'D4: repoint refused with "' || SQLERRM || '"');
    END IF;
  END;

  IF cardinality(failures) > 0 THEN
    RAISE EXCEPTION 'GUARD-D4: %', array_to_string(failures, '; ');
  END IF;
END;
$$;

-- (D5) The kill switch stops claiming in the DATABASE, not only in the route.
DO $$
DECLARE
  claimed INTEGER;
BEGIN
  -- Release the outstanding leases so there is genuinely something to claim.
  UPDATE notification_outbox
     SET status = 'pending', attempts = 0, lease_token = NULL, lease_expires_at = NULL
   WHERE status = 'sending';
  IF NOT EXISTS (SELECT 1 FROM notification_outbox WHERE status = 'pending') THEN
    RAISE EXCEPTION 'D5: fixture missing — nothing is pending';
  END IF;

  UPDATE app_config SET value = 'off' WHERE key = 'notification_email_enabled';
  SELECT count(*) INTO claimed FROM public.claim_notification_outbox(50, 120);
  IF claimed <> 0 THEN
    RAISE EXCEPTION 'D5: the kill switch handed out % rows', claimed;
  END IF;

  UPDATE app_config SET value = 'on' WHERE key = 'notification_email_enabled';
  SELECT count(*) INTO claimed FROM public.claim_notification_outbox(50, 120);
  IF claimed = 0 THEN
    RAISE EXCEPTION 'D5: nothing was claimable with the switch back on';
  END IF;
END;
$$;

-- (D6) A row older than the max age is terminalized instead of mailed: an
-- email about a stale state is worse than no email.
DO $$
DECLARE
  target UUID;
  after_status TEXT;
  after_reason TEXT;
  alerts INTEGER;
BEGIN
  SELECT id INTO target FROM notification_outbox WHERE event_type = 'pitch_render_completed';
  UPDATE notification_outbox
     SET status = 'pending', attempts = 0, lease_token = NULL, lease_expires_at = NULL
   WHERE id = target;
  UPDATE notification_outbox
     SET created_at = now() - INTERVAL '200 hours'
   WHERE id = target;

  PERFORM public.claim_notification_outbox(50, 120);

  SELECT status, last_error INTO after_status, after_reason
    FROM notification_outbox WHERE id = target;
  IF after_status <> 'failed' OR after_reason <> 'expired_before_send' THEN
    RAISE EXCEPTION 'D6: a stale entry ended as %/%', after_status, after_reason;
  END IF;

  -- Expiry with attempts = 0 is expected, not an incident: nobody ever tried,
  -- because the switch was off or the secret was unset, and the operator
  -- already knows that. It must not add to the ops queue they are nagged about
  -- hourly.
  SELECT count(*) INTO alerts FROM ops_alerts
   WHERE alert_type = 'notification_send_failed'
     AND detail ->> 'outbox_entry_id' = target::TEXT;
  IF alerts <> 0 THEN
    RAISE EXCEPTION 'D6: staleness raised % ops alerts', alerts;
  END IF;
END;
$$;

-- (D6b) The valve's OTHER mouth. An entry that was attempted and then aged out
-- means something was trying and failing for three days without ever spending
-- its budget — that is not the designed quiet outcome above, it is a fault
-- nobody heard about. Same terminal state, a different reason code so the two
-- are told apart in the table, and an ops_alert.
--
-- Inserted by hand because every row this file produced has already reached a
-- terminal state by now; the transition trigger still forces it to be born
-- 'pending', so this is not a shortcut around the state machine.
INSERT INTO notification_outbox (
  recipient_user_id, event_type, render_job_id, pitch_draft_id
)
VALUES (
  'ee320000-0000-0000-0000-000000000002', 'pitch_render_completed',
  'ee325000-0000-0000-0000-000000000001', 'ee321000-0000-0000-0000-000000000001'
);

DO $$
DECLARE
  failures TEXT[] := ARRAY[]::TEXT[];
  target UUID;
  after_status TEXT;
  after_reason TEXT;
  alerts INTEGER;
BEGIN
  SELECT id INTO target FROM notification_outbox
   WHERE recipient_user_id = 'ee320000-0000-0000-0000-000000000002';
  UPDATE notification_outbox
     SET attempts = 2, created_at = now() - INTERVAL '200 hours'
   WHERE id = target;

  PERFORM public.claim_notification_outbox(50, 300);

  SELECT status, last_error INTO after_status, after_reason
    FROM notification_outbox WHERE id = target;
  IF after_status <> 'failed' OR after_reason IS DISTINCT FROM 'expired_after_attempts' THEN
    failures := array_append(failures,
      'D6b: an attempted-then-stale entry ended as ' || after_status || '/'
      || coalesce(after_reason, '<null>'));
  END IF;

  SELECT count(*) INTO alerts FROM ops_alerts
   WHERE alert_type = 'notification_send_failed'
     AND detail ->> 'outbox_entry_id' = target::TEXT;
  IF alerts <> 1 THEN
    failures := array_append(failures,
      'D6b: expiry after attempts raised ' || alerts || ' ops alerts (expected 1)');
  END IF;

  IF cardinality(failures) > 0 THEN
    RAISE EXCEPTION 'GUARD-D6b: %', array_to_string(failures, '; ');
  END IF;
END;
$$;

-- (D10) `notification_max_age_hours` is a hand-edited string in a config
-- table. `value::INTEGER` on a typo raises INSIDE the claim — which would not
-- merely mis-time the expiry, it would stop the ENTIRE queue: every pass
-- erroring, no mail at all, and the cause three levels down a stack trace. A
-- malformed value must degrade to the 72h default instead.
INSERT INTO notification_outbox (
  recipient_user_id, event_type, render_job_id, pitch_draft_id
)
VALUES (
  '00000000-0000-0000-0000-000000000003', 'pitch_render_completed',
  'ee325000-0000-0000-0000-000000000001', 'ee321000-0000-0000-0000-000000000001'
);

DO $$
DECLARE
  failures TEXT[] := ARRAY[]::TEXT[];
  target UUID;
  handed_out INTEGER;
  after_status TEXT;
BEGIN
  SELECT id INTO target FROM notification_outbox
   WHERE recipient_user_id = '00000000-0000-0000-0000-000000000003'
     AND event_type = 'pitch_render_completed';

  UPDATE app_config SET value = 'seventy two' WHERE key = 'notification_max_age_hours';

  -- (i) The queue keeps running: a fresh entry is still claimed, so the claim
  -- neither raised nor collapsed its window to "everything is already stale".
  SELECT count(*) INTO handed_out
    FROM public.claim_notification_outbox(50, 300) claimed
   WHERE claimed.entry_id = target;
  IF handed_out <> 1 THEN
    failures := array_append(failures,
      'D10: a malformed max-age stopped the queue instead of degrading ('
      || handed_out || ' claimed)');
  END IF;

  -- (ii) And the fallback is really 72, not "no expiry at all" — which would
  -- be the other way to survive a bad value, and the wrong one: it would mail
  -- week-old events the day someone fixed the typo.
  UPDATE notification_outbox
     SET status = 'pending', attempts = 0, lease_token = NULL, lease_expires_at = NULL,
         created_at = now() - INTERVAL '100 hours'
   WHERE id = target;
  PERFORM public.claim_notification_outbox(50, 300);
  SELECT status INTO after_status FROM notification_outbox WHERE id = target;
  IF after_status <> 'failed' THEN
    failures := array_append(failures,
      'D10: with a malformed max-age a 100h-old entry was left ' || after_status);
  END IF;

  UPDATE app_config SET value = '72' WHERE key = 'notification_max_age_hours';

  IF cardinality(failures) > 0 THEN
    RAISE EXCEPTION 'GUARD-D10: %', array_to_string(failures, '; ');
  END IF;
END;
$$;

-- (E2) Whole-table sweep: nothing anywhere in the outbox looks like an address.
DO $$
DECLARE
  offenders INTEGER;
BEGIN
  SELECT count(*) INTO offenders
    FROM notification_outbox entry
   WHERE to_jsonb(entry)::TEXT LIKE '%@%';
  IF offenders <> 0 THEN
    RAISE EXCEPTION 'E2: % outbox rows contain an address-shaped value', offenders;
  END IF;
END;
$$;

ROLLBACK;

SELECT '32_notification_outbox.sql passed' AS result;
