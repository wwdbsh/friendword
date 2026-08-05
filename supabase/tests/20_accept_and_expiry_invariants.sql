-- Migration 0044 regressions: the two invariants that used to hold only on the
-- user-facing RPC path.
--
--   A. decide_interest re-asserts the SENDER's submit-time eligibility before
--      opening an intro room (fourth audit P0-3 / E2E N-G). Submission-time
--      approval is not accept-time approval.
--   B. campaigns enforces the expired-exit invariant with a trigger, so a
--      direct service-role UPDATE cannot revive a lapsed window for free
--      (E2E O-1).
--
-- Written in the 19_e2e_guard_regressions.sql style: every refusal pins the
-- EXACT server message, and every guard carries a positive control in which
-- the same call succeeds once the mutation is undone — so a fixture that stops
-- reaching the guard fails instead of passing vacuously.
BEGIN;

-- ═══ Fixture: a genuinely valid interest ══════════════════════════════
-- Drew (0004) completes a compliant dating profile with caller-owned storage
-- objects and submits interest on Blair's published seed campaign through the
-- real RPC, so the row under test is one submit_interest actually produced.
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

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);
SELECT interest_id FROM submit_interest(
  '20000000-0000-0000-0000-000000000001',
  'We met at the gallery opening once!'
);
RESET ROLE;

-- Re-running an accept as a positive control consumes the interest, so each
-- guard restores it to 'submitted' and removes the room it opened. Nothing on
-- interests fires on UPDATE except the AFTER growth-event trigger, and
-- intro_rooms is re-created by the next accept.
CREATE FUNCTION pg_temp.reset_probe_interest()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM intro_rooms
   WHERE campaign_id = '20000000-0000-0000-0000-000000000001'
     AND interested_user_id = '00000000-0000-0000-0000-000000000004';
  UPDATE interests
     SET status = 'submitted', decided_at = NULL
   WHERE campaign_id = '20000000-0000-0000-0000-000000000001'
     AND sender_user_id = '00000000-0000-0000-0000-000000000004';
END;
$$;

-- Shared probe: accept the fixture interest as Blair and report the outcome.
-- Returns NULL when the accept succeeded, otherwise the exact server message.
CREATE FUNCTION pg_temp.try_accept()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  probe UUID;
BEGIN
  SELECT id INTO probe FROM interests
   WHERE campaign_id = '20000000-0000-0000-0000-000000000001'
     AND sender_user_id = '00000000-0000-0000-0000-000000000004';
  PERFORM * FROM public.decide_interest(probe, 'accepted');
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM;
END;
$$;
GRANT EXECUTE ON FUNCTION pg_temp.try_accept() TO authenticated;

-- ═══ Guard A1: a suspended sender can no longer be accepted ═══════════
UPDATE users SET account_status = 'suspended'
 WHERE id = '00000000-0000-0000-0000-000000000004';

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
DO $$
DECLARE
  failures TEXT[] := ARRAY[]::TEXT[];
  actual TEXT;
BEGIN
  actual := pg_temp.try_accept();
  IF actual IS NULL THEN
    failures := array_append(failures, 'A1: a suspended sender was accepted into an intro room');
  ELSIF actual <> 'this interest can no longer be accepted: account must be active' THEN
    failures := array_append(failures, 'A1: refused with "' || actual || '"');
  END IF;

  -- The refusal is not a silent drop: the interest stays decidable and no room
  -- was opened. This is the deliberate contract — see decide_interest (0044).
  IF NOT EXISTS (
    SELECT 1 FROM interests
     WHERE campaign_id = '20000000-0000-0000-0000-000000000001'
       AND sender_user_id = '00000000-0000-0000-0000-000000000004'
       AND status = 'submitted'
       AND decided_at IS NULL
  ) THEN
    failures := array_append(failures, 'A1: the refused interest left "submitted"');
  END IF;
  IF EXISTS (
    SELECT 1 FROM intro_rooms
     WHERE campaign_id = '20000000-0000-0000-0000-000000000001'
       AND interested_user_id = '00000000-0000-0000-0000-000000000004'
  ) THEN
    failures := array_append(failures, 'A1: a refused accept still opened an intro room');
  END IF;

  IF cardinality(failures) > 0 THEN
    RAISE EXCEPTION 'GUARD-A1: %', array_to_string(failures, '; ');
  END IF;
END;
$$;

RESET ROLE;
UPDATE users SET account_status = 'active'
 WHERE id = '00000000-0000-0000-0000-000000000004';
SET LOCAL ROLE authenticated;

DO $$
DECLARE
  actual TEXT := pg_temp.try_accept();
BEGIN
  -- Positive control: reinstating the account is the only change, and the very
  -- same accept now succeeds and opens the room.
  IF actual IS NOT NULL THEN
    RAISE EXCEPTION 'GUARD-A1: the reinstated sender was still refused with "%"', actual;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM intro_rooms
     WHERE campaign_id = '20000000-0000-0000-0000-000000000001'
       AND dater_user_id = '00000000-0000-0000-0000-000000000002'
       AND interested_user_id = '00000000-0000-0000-0000-000000000004'
       AND status = 'open'
  ) THEN
    RAISE EXCEPTION 'GUARD-A1: the accepted interest opened no intro room';
  END IF;
END;
$$;

RESET ROLE;
SELECT pg_temp.reset_probe_interest();

-- ═══ Guard A2: a sender with erasure in flight can no longer be accepted ═══
-- request_account_deletion flips account_status in the same transaction, but a
-- service-role-queued request must fail closed on its own.
INSERT INTO deletion_requests (user_id, scope, status)
VALUES ('00000000-0000-0000-0000-000000000004', 'account', 'queued');

SET LOCAL ROLE authenticated;
DO $$
DECLARE
  actual TEXT := pg_temp.try_accept();
BEGIN
  IF actual IS NULL THEN
    RAISE EXCEPTION 'GUARD-A2: a sender awaiting erasure was accepted into an intro room';
  END IF;
  IF actual <> 'this interest can no longer be accepted: the sender has requested account deletion' THEN
    RAISE EXCEPTION 'GUARD-A2: refused with "%"', actual;
  END IF;
END;
$$;

RESET ROLE;
DELETE FROM deletion_requests
 WHERE user_id = '00000000-0000-0000-0000-000000000004';
SET LOCAL ROLE authenticated;

DO $$
DECLARE
  actual TEXT := pg_temp.try_accept();
BEGIN
  IF actual IS NOT NULL THEN
    RAISE EXCEPTION 'GUARD-A2: withdrawing the deletion request left the accept refused with "%"', actual;
  END IF;
END;
$$;

RESET ROLE;
SELECT pg_temp.reset_probe_interest();

-- ═══ Guard A3: the campaign must still be publishable at accept time ══
UPDATE campaigns SET status = 'paused'
 WHERE id = '20000000-0000-0000-0000-000000000001';

SET LOCAL ROLE authenticated;
DO $$
DECLARE
  actual TEXT := pg_temp.try_accept();
BEGIN
  IF actual IS NULL THEN
    RAISE EXCEPTION 'GUARD-A3: an interest was accepted into a paused campaign';
  END IF;
  IF actual <> 'campaign must be published and inside its window to accept interest' THEN
    RAISE EXCEPTION 'GUARD-A3: paused campaign refused with "%"', actual;
  END IF;
END;
$$;

RESET ROLE;
-- Two statements on purpose: the 0044 trigger refuses a campaign ENTERING
-- 'published' with a window that has already ended, so the only way to reach
-- "published but lapsed" is the way the clock reaches it — republish live, then
-- let the window fall behind. Guard B7 below pins that refusal.
UPDATE campaigns
   SET status = 'published', ends_at = now() + INTERVAL '1 hour'
 WHERE id = '20000000-0000-0000-0000-000000000001';
UPDATE campaigns
   SET ends_at = now() - INTERVAL '1 hour'
 WHERE id = '20000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;

DO $$
DECLARE
  actual TEXT := pg_temp.try_accept();
BEGIN
  -- Published but past its window: the same window submit_interest requires.
  IF actual IS NULL THEN
    RAISE EXCEPTION 'GUARD-A3: an interest was accepted after the campaign window ended';
  END IF;
  IF actual <> 'campaign must be published and inside its window to accept interest' THEN
    RAISE EXCEPTION 'GUARD-A3: lapsed window refused with "%"', actual;
  END IF;
END;
$$;

RESET ROLE;
UPDATE campaigns SET ends_at = now() + INTERVAL '7 days'
 WHERE id = '20000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;

DO $$
DECLARE
  actual TEXT := pg_temp.try_accept();
BEGIN
  IF actual IS NOT NULL THEN
    RAISE EXCEPTION 'GUARD-A3: a published campaign inside its window was refused with "%"', actual;
  END IF;
END;
$$;

RESET ROLE;
SELECT pg_temp.reset_probe_interest();

-- ═══ Guard A4: photo evidence is re-checked, not trusted from submit ══
-- The sender repoints their profile at an object owned by someone else after
-- the dater's inbox already rendered it.
INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
VALUES (
  'profile-media',
  '00000000-0000-0000-0000-000000000002/not-drews.jpg',
  '00000000-0000-0000-0000-000000000002',
  '{"mimetype":"image/jpeg"}'
);
UPDATE dating_profiles
   SET photos = ARRAY[
     '00000000-0000-0000-0000-000000000004/drew-1.jpg',
     '00000000-0000-0000-0000-000000000002/not-drews.jpg'
   ]
 WHERE user_id = '00000000-0000-0000-0000-000000000004';

SET LOCAL ROLE authenticated;
DO $$
DECLARE
  actual TEXT := pg_temp.try_accept();
BEGIN
  IF actual IS NULL THEN
    RAISE EXCEPTION 'GUARD-A4: an interest was accepted with a photo the sender does not own';
  END IF;
  IF actual <> 'this interest can no longer be accepted: profile photos require owned storage objects with an allowed image MIME type' THEN
    RAISE EXCEPTION 'GUARD-A4: swapped photo refused with "%"', actual;
  END IF;
END;
$$;

RESET ROLE;
UPDATE storage.objects
   SET metadata = '{"mimetype":"image/gif"}'
 WHERE bucket_id = 'profile-media'
   AND name = '00000000-0000-0000-0000-000000000004/drew-2.jpg';
UPDATE dating_profiles
   SET photos = ARRAY[
     '00000000-0000-0000-0000-000000000004/drew-1.jpg',
     '00000000-0000-0000-0000-000000000004/drew-2.jpg'
   ]
 WHERE user_id = '00000000-0000-0000-0000-000000000004';
SET LOCAL ROLE authenticated;

DO $$
DECLARE
  actual TEXT := pg_temp.try_accept();
BEGIN
  -- Own object, disallowed MIME: the ownership check is not the only clause.
  IF actual IS NULL THEN
    RAISE EXCEPTION 'GUARD-A4: an interest was accepted with a disallowed image MIME type';
  END IF;
  IF actual <> 'this interest can no longer be accepted: profile photos require owned storage objects with an allowed image MIME type' THEN
    RAISE EXCEPTION 'GUARD-A4: disallowed MIME refused with "%"', actual;
  END IF;
END;
$$;

RESET ROLE;
UPDATE storage.objects
   SET metadata = '{"mimetype":"image/jpeg"}'
 WHERE bucket_id = 'profile-media'
   AND name = '00000000-0000-0000-0000-000000000004/drew-2.jpg';
SET LOCAL ROLE authenticated;

DO $$
DECLARE
  actual TEXT := pg_temp.try_accept();
BEGIN
  IF actual IS NOT NULL THEN
    RAISE EXCEPTION 'GUARD-A4: restoring owned JPEG photos left the accept refused with "%"', actual;
  END IF;
END;
$$;

RESET ROLE;
SELECT pg_temp.reset_probe_interest();

-- ═══ Guard A4b: a CHANGED but valid photo set is accepted ═════════════
-- The provenance re-check is gated on the photo set differing from the digest
-- submit_interest recorded (0044). Restoring the original array makes the
-- digests match again, so the A4 positive control above cannot tell "the check
-- passed" from "the check was skipped". Here the array genuinely differs — the
-- gate opens — and the accept still succeeds because the new objects are owned
-- JPEGs. Without this, A4 would pass with the gated branch permanently dead.
INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
VALUES
  (
    'profile-media',
    '00000000-0000-0000-0000-000000000004/drew-3.jpg',
    '00000000-0000-0000-0000-000000000004',
    '{"mimetype":"image/jpeg"}'
  ),
  (
    'profile-media',
    '00000000-0000-0000-0000-000000000004/drew-4.jpg',
    '00000000-0000-0000-0000-000000000004',
    '{"mimetype":"image/jpeg"}'
  );
UPDATE dating_profiles
   SET photos = ARRAY[
     '00000000-0000-0000-0000-000000000004/drew-3.jpg',
     '00000000-0000-0000-0000-000000000004/drew-4.jpg'
   ]
 WHERE user_id = '00000000-0000-0000-0000-000000000004';
SET LOCAL ROLE authenticated;

DO $$
DECLARE
  actual TEXT;
BEGIN
  IF (SELECT photos FROM dating_profiles
       WHERE user_id = '00000000-0000-0000-0000-000000000004')
     = ARRAY[
         '00000000-0000-0000-0000-000000000004/drew-1.jpg',
         '00000000-0000-0000-0000-000000000004/drew-2.jpg'
       ] THEN
    RAISE EXCEPTION 'GUARD-A4b: the fixture did not actually change the photo set';
  END IF;
  actual := pg_temp.try_accept();
  IF actual IS NOT NULL THEN
    RAISE EXCEPTION 'GUARD-A4b: a changed but valid photo set was refused with "%"', actual;
  END IF;
END;
$$;

RESET ROLE;
UPDATE dating_profiles
   SET photos = ARRAY[
     '00000000-0000-0000-0000-000000000004/drew-1.jpg',
     '00000000-0000-0000-0000-000000000004/drew-2.jpg'
   ]
 WHERE user_id = '00000000-0000-0000-0000-000000000004';
SELECT pg_temp.reset_probe_interest();

-- ═══ Guard A5: with media_validation_enforcement on, validation must hold ══
UPDATE app_config SET value = 'on' WHERE key = 'media_validation_enforcement';

SET LOCAL ROLE authenticated;
DO $$
DECLARE
  actual TEXT := pg_temp.try_accept();
BEGIN
  IF actual IS NULL THEN
    RAISE EXCEPTION 'GUARD-A5: an unvalidated photo set was accepted while enforcement is on';
  END IF;
  IF actual <> 'this interest can no longer be accepted: profile photos require completed validation' THEN
    RAISE EXCEPTION 'GUARD-A5: refused with "%"', actual;
  END IF;
END;
$$;

RESET ROLE;
INSERT INTO media_validations (
  bucket_id, object_name, validated_at,
  mime_ok, magic_ok, size_ok, decode_ok, moderation_status
)
VALUES
  ('profile-media', '00000000-0000-0000-0000-000000000004/drew-1.jpg', now(),
   true, true, true, true, 'passed'),
  ('profile-media', '00000000-0000-0000-0000-000000000004/drew-2.jpg', now(),
   true, true, true, true, 'passed');
SET LOCAL ROLE authenticated;

DO $$
DECLARE
  actual TEXT := pg_temp.try_accept();
BEGIN
  IF actual IS NOT NULL THEN
    RAISE EXCEPTION 'GUARD-A5: passed validation evidence left the accept refused with "%"', actual;
  END IF;
END;
$$;

RESET ROLE;
SELECT pg_temp.reset_probe_interest();

-- A flagged verdict on a photo the sender swapped in after submitting is still
-- refused, so the guard reads the verdict rather than the row's existence.
UPDATE media_validations SET moderation_status = 'flagged'
 WHERE bucket_id = 'profile-media'
   AND object_name = '00000000-0000-0000-0000-000000000004/drew-2.jpg';
SET LOCAL ROLE authenticated;

DO $$
DECLARE
  actual TEXT := pg_temp.try_accept();
BEGIN
  IF actual IS NULL THEN
    RAISE EXCEPTION 'GUARD-A5: a flagged photo was accepted while enforcement is on';
  END IF;
  IF actual <> 'this interest can no longer be accepted: profile photos require completed validation' THEN
    RAISE EXCEPTION 'GUARD-A5: flagged photo refused with "%"', actual;
  END IF;
END;
$$;

RESET ROLE;
UPDATE app_config SET value = 'off' WHERE key = 'media_validation_enforcement';
SET LOCAL ROLE authenticated;

DO $$
DECLARE
  actual TEXT := pg_temp.try_accept();
BEGIN
  -- Switch off is the only change: the flagged verdict stops mattering, which
  -- proves the refusal above came from the switch and not from the fixture.
  IF actual IS NOT NULL THEN
    RAISE EXCEPTION 'GUARD-A5: enforcement off still refused the accept with "%"', actual;
  END IF;
END;
$$;

RESET ROLE;
SELECT pg_temp.reset_probe_interest();
UPDATE media_validations SET moderation_status = 'passed'
 WHERE bucket_id = 'profile-media'
   AND object_name = '00000000-0000-0000-0000-000000000004/drew-2.jpg';

-- ═══ Guard A6: with identity_enforcement on, evidence must still be current ══
UPDATE app_config SET value = 'on' WHERE key = 'identity_enforcement';

SET LOCAL ROLE authenticated;
DO $$
DECLARE
  actual TEXT := pg_temp.try_accept();
BEGIN
  IF actual IS NULL THEN
    RAISE EXCEPTION 'GUARD-A6: a sender with no identity evidence was accepted while enforcement is on';
  END IF;
  IF actual <> 'this interest can no longer be accepted: current adult (18+) identity evidence required' THEN
    RAISE EXCEPTION 'GUARD-A6: missing evidence refused with "%"', actual;
  END IF;
END;
$$;

RESET ROLE;
INSERT INTO verification_checks (
  user_id, provider, provider_reference, status, verified_at,
  check_type, provider_ref, result, checked_at, expires_at
)
SELECT
  '00000000-0000-0000-0000-000000000004', 'harness',
  '20-accept-' || kind.check_type, 'passed', now(),
  kind.check_type, '20-accept-' || kind.check_type,
  'passed', now(), now() - INTERVAL '1 day'
FROM (VALUES ('adult_18plus'), ('liveness')) AS kind(check_type);
SET LOCAL ROLE authenticated;

DO $$
DECLARE
  actual TEXT := pg_temp.try_accept();
BEGIN
  -- Evidence that passed once but has since expired is not current evidence.
  IF actual IS NULL THEN
    RAISE EXCEPTION 'GUARD-A6: expired identity evidence was accepted while enforcement is on';
  END IF;
  IF actual <> 'this interest can no longer be accepted: current adult (18+) identity evidence required' THEN
    RAISE EXCEPTION 'GUARD-A6: expired evidence refused with "%"', actual;
  END IF;
END;
$$;

RESET ROLE;
UPDATE verification_checks SET expires_at = now() + INTERVAL '30 days'
 WHERE user_id = '00000000-0000-0000-0000-000000000004'
   AND provider = 'harness';
SET LOCAL ROLE authenticated;

DO $$
DECLARE
  actual TEXT := pg_temp.try_accept();
BEGIN
  IF actual IS NOT NULL THEN
    RAISE EXCEPTION 'GUARD-A6: current identity evidence left the accept refused with "%"', actual;
  END IF;
END;
$$;

RESET ROLE;
SELECT pg_temp.reset_probe_interest();
UPDATE app_config SET value = 'off' WHERE key = 'identity_enforcement';

-- ═══ Guard A7: declining is never gated ═══════════════════════════════
-- The deliberate contract: a dater must be able to clear their inbox whatever
-- happened to the sender, and the refusals above must not create a dead end.
UPDATE users SET account_status = 'suspended'
 WHERE id = '00000000-0000-0000-0000-000000000004';

SET LOCAL ROLE authenticated;
DO $$
DECLARE
  probe UUID;
  room_id UUID;
BEGIN
  SELECT id INTO probe FROM interests
   WHERE campaign_id = '20000000-0000-0000-0000-000000000001'
     AND sender_user_id = '00000000-0000-0000-0000-000000000004';
  BEGIN
    SELECT intro_room_id INTO room_id FROM public.decide_interest(probe, 'declined');
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'GUARD-A7: declining a suspended sender was refused: %', SQLERRM;
  END;
  IF room_id IS NOT NULL THEN
    RAISE EXCEPTION 'GUARD-A7: declining opened an intro room';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM interests WHERE id = probe AND status = 'declined'
  ) THEN
    RAISE EXCEPTION 'GUARD-A7: the declined interest did not reach "declined"';
  END IF;
END;
$$;

RESET ROLE;
UPDATE users SET account_status = 'active'
 WHERE id = '00000000-0000-0000-0000-000000000004';
UPDATE interests SET status = 'submitted', decided_at = NULL
 WHERE sender_user_id = '00000000-0000-0000-0000-000000000004';

-- ═══ Guard A8: a self-declared minor is never accepted ════════════════
-- Both switches are off here, which is the shipping default. The sender edits
-- their OWN profiles row after submitting; submit_interest refuses that state,
-- so accept must too. This predicate is never grandfathered.
UPDATE profiles SET birth_date = CURRENT_DATE - INTERVAL '15 years'
 WHERE user_id = '00000000-0000-0000-0000-000000000004';

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
DO $$
DECLARE
  actual TEXT := pg_temp.try_accept();
BEGIN
  IF actual IS NULL THEN
    RAISE EXCEPTION 'GUARD-A8: a 15-year-old sender was accepted into an intro room';
  END IF;
  IF actual <> 'this interest can no longer be accepted: verified interest requires an adult birth date on your profile' THEN
    RAISE EXCEPTION 'GUARD-A8: refused with "%"', actual;
  END IF;
  IF EXISTS (
    SELECT 1 FROM intro_rooms
     WHERE interested_user_id = '00000000-0000-0000-0000-000000000004'
  ) THEN
    RAISE EXCEPTION 'GUARD-A8: a refused accept still opened an intro room';
  END IF;
END;
$$;

RESET ROLE;
UPDATE profiles SET birth_date = DATE '1991-11-02'
 WHERE user_id = '00000000-0000-0000-0000-000000000004';
SET LOCAL ROLE authenticated;

DO $$
DECLARE
  actual TEXT := pg_temp.try_accept();
BEGIN
  IF actual IS NOT NULL THEN
    RAISE EXCEPTION 'GUARD-A8: restoring an adult birth date left the accept refused with "%"', actual;
  END IF;
END;
$$;

RESET ROLE;
SELECT pg_temp.reset_probe_interest();

-- ═══ Guard A9: an emptied dating profile is not a vacuous pass ════════
-- assert_profile_photo_objects / assert_profile_photo_validations are EXISTS
-- over unnest(photos), so an EMPTY array asserts nothing. The profile floor is
-- what stops that from reading as approval.
UPDATE dating_profiles
   SET photos = '{}', bio = '', dating_intent = ''
 WHERE user_id = '00000000-0000-0000-0000-000000000004';

SET LOCAL ROLE authenticated;
DO $$
DECLARE
  actual TEXT := pg_temp.try_accept();
BEGIN
  IF actual IS NULL THEN
    RAISE EXCEPTION 'GUARD-A9: a sender with an empty dating profile was accepted';
  END IF;
  IF actual <> 'this interest can no longer be accepted: the sender no longer has a bio, an intent, and at least one photo' THEN
    RAISE EXCEPTION 'GUARD-A9: refused with "%"', actual;
  END IF;
END;
$$;

RESET ROLE;
UPDATE dating_profiles
   SET photos = ARRAY[
     '00000000-0000-0000-0000-000000000004/drew-1.jpg',
     '00000000-0000-0000-0000-000000000004/drew-2.jpg'
   ],
       bio = 'Weekend hikes and jazz bars.',
       dating_intent = 'long-term'
 WHERE user_id = '00000000-0000-0000-0000-000000000004';
SET LOCAL ROLE authenticated;

DO $$
DECLARE
  actual TEXT := pg_temp.try_accept();
BEGIN
  IF actual IS NOT NULL THEN
    RAISE EXCEPTION 'GUARD-A9: restoring the dating profile left the accept refused with "%"', actual;
  END IF;
END;
$$;

RESET ROLE;
SELECT pg_temp.reset_probe_interest();

-- ═══ Guard A10: a NULL digest is missing evidence, not a free pass ════
-- 0055 closes 0044's grandfathering. submitted_photo_digest IS NULL used to
-- SKIP the photo-provenance branch; it now FORCES it, so "no recorded
-- submission evidence" means "prove provenance now" instead of "trust the
-- stored paths". Casey (0003) is exactly the legacy shape 0044 grandfathered:
-- a seed interest written before the digest column existed, and a seed dating
-- profile whose single photo path resolves to no owned profile-media object.
--
-- Three guards, because the fail-closed rule has three distinct outcomes and
-- one combined assertion could not tell them apart: the strict completeness
-- rule refuses first (A10a), provenance refuses next (A10b), and a legacy
-- sender whose evidence still stands up today is accepted (A10c) — the
-- positive control that keeps A10a/A10b from passing vacuously.

-- ── A10a: one photo no longer passes a NULL-digest accept ──
UPDATE interests SET status = 'submitted', decided_at = NULL
 WHERE id = '30000000-0000-0000-0000-000000000001';

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
DO $$
DECLARE
  accepted BOOLEAN := false;
  refusal TEXT;
BEGIN
  IF (SELECT submitted_photo_digest FROM interests
       WHERE id = '30000000-0000-0000-0000-000000000001') IS NOT NULL THEN
    RAISE EXCEPTION 'GUARD-A10a: the legacy fixture unexpectedly carries a digest';
  END IF;
  IF (SELECT photos FROM dating_profiles
       WHERE user_id = '00000000-0000-0000-0000-000000000003')
     <> ARRAY['local/casey.jpg'] THEN
    RAISE EXCEPTION 'GUARD-A10a: the legacy fixture no longer has a single unresolvable photo path';
  END IF;
  BEGIN
    PERFORM * FROM public.decide_interest('30000000-0000-0000-0000-000000000001', 'accepted');
    accepted := true;
  EXCEPTION WHEN OTHERS THEN
    refusal := SQLERRM;
  END;
  IF accepted THEN
    RAISE EXCEPTION 'GUARD-A10a: a NULL-digest interest from an incomplete profile was accepted';
  END IF;
  IF refusal <> 'this interest can no longer be accepted: complete your dating profile (bio, intent, and at least 2 photos) first' THEN
    RAISE EXCEPTION 'GUARD-A10a: refused with "%"', refusal;
  END IF;
END;
$$;

-- ── A10b: two photos clear completeness, and provenance refuses ──
-- Same NULL digest, still unresolvable paths. With completeness satisfied the
-- refusal can only come from assert_profile_photo_objects, which is the check
-- 0044 skipped entirely for this row.
RESET ROLE;
UPDATE dating_profiles
   SET photos = ARRAY['local/casey.jpg', 'local/casey-2.jpg']
 WHERE user_id = '00000000-0000-0000-0000-000000000003';
UPDATE interests SET status = 'submitted', decided_at = NULL
 WHERE id = '30000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;

DO $$
DECLARE
  accepted BOOLEAN := false;
  refusal TEXT;
BEGIN
  IF (SELECT submitted_photo_digest FROM interests
       WHERE id = '30000000-0000-0000-0000-000000000001') IS NOT NULL THEN
    RAISE EXCEPTION 'GUARD-A10b: the legacy fixture unexpectedly carries a digest';
  END IF;
  BEGIN
    PERFORM * FROM public.decide_interest('30000000-0000-0000-0000-000000000001', 'accepted');
    accepted := true;
  EXCEPTION WHEN OTHERS THEN
    refusal := SQLERRM;
  END;
  IF accepted THEN
    RAISE EXCEPTION 'GUARD-A10b: a NULL-digest interest with unresolvable photo paths was accepted';
  END IF;
  IF refusal <> 'this interest can no longer be accepted: profile photos require owned storage objects with an allowed image MIME type' THEN
    RAISE EXCEPTION 'GUARD-A10b: refused with "%"', refusal;
  END IF;
END;
$$;

-- ── A10c: a legacy sender who can still prove provenance is accepted ──
-- The digest stays NULL — only the evidence behind the paths changes. This is
-- the recovery path 0055 documents: fail-closed refuses missing evidence, not
-- legacy rows as such. media_validation_enforcement is pinned off because
-- assert_profile_photo_validations runs after the provenance branch and would
-- otherwise refuse for an unrelated reason.
RESET ROLE;
UPDATE app_config SET value = 'off' WHERE key = 'media_validation_enforcement';
INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
VALUES
  (
    'profile-media',
    '00000000-0000-0000-0000-000000000003/casey-1.jpg',
    '00000000-0000-0000-0000-000000000003',
    '{"mimetype":"image/jpeg"}'
  ),
  (
    'profile-media',
    '00000000-0000-0000-0000-000000000003/casey-2.jpg',
    '00000000-0000-0000-0000-000000000003',
    '{"mimetype":"image/jpeg"}'
  );
UPDATE dating_profiles
   SET photos = ARRAY[
     '00000000-0000-0000-0000-000000000003/casey-1.jpg',
     '00000000-0000-0000-0000-000000000003/casey-2.jpg'
   ]
 WHERE user_id = '00000000-0000-0000-0000-000000000003';
UPDATE interests SET status = 'submitted', decided_at = NULL
 WHERE id = '30000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;

DO $$
DECLARE
  room UUID;
BEGIN
  IF (SELECT submitted_photo_digest FROM interests
       WHERE id = '30000000-0000-0000-0000-000000000001') IS NOT NULL THEN
    RAISE EXCEPTION 'GUARD-A10c: the legacy fixture unexpectedly carries a digest';
  END IF;
  BEGIN
    SELECT intro_room_id INTO room
      FROM public.decide_interest('30000000-0000-0000-0000-000000000001', 'accepted');
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'GUARD-A10c: a NULL-digest interest with resolvable owned photos was refused: %', SQLERRM;
  END;
  IF room IS NULL THEN
    RAISE EXCEPTION 'GUARD-A10c: the accept opened no intro room';
  END IF;
END;
$$;

RESET ROLE;

-- ═══ Guard A11: the accept invariant holds for a direct table write ═══
-- authenticated holds GRANT UPDATE (status, decided_at) ON interests (0006)
-- under interests_update_owners, and GRANT INSERT on intro_rooms (0002). Before
-- 0044's trigger the dater could reproduce the entire accept with two ordinary
-- PostgREST writes, skipping every RPC-side check.
UPDATE users SET account_status = 'suspended'
 WHERE id = '00000000-0000-0000-0000-000000000004';

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
DO $$
DECLARE
  failures TEXT[] := ARRAY[]::TEXT[];
  accepted BOOLEAN := false;
  actual TEXT;
BEGIN
  BEGIN
    UPDATE interests
       SET status = 'accepted', decided_at = now()
     WHERE campaign_id = '20000000-0000-0000-0000-000000000001'
       AND sender_user_id = '00000000-0000-0000-0000-000000000004';
    accepted := true;
  EXCEPTION WHEN OTHERS THEN
    actual := SQLERRM;
  END;
  IF accepted THEN
    failures := array_append(failures, 'A11: a direct table UPDATE accepted a suspended sender');
  ELSIF actual <> 'account must be active' THEN
    failures := array_append(failures, 'A11: refused with "' || actual || '"');
  END IF;

  -- The intro room is unreachable too: validate_intro_room_parties (0001)
  -- requires an 'accepted' interest, which the refusal above prevented.
  accepted := false;
  BEGIN
    INSERT INTO intro_rooms (campaign_id, dater_user_id, interested_user_id)
    VALUES (
      '20000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000002',
      '00000000-0000-0000-0000-000000000004'
    );
    accepted := true;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  IF accepted THEN
    failures := array_append(failures, 'A11: a direct intro_rooms INSERT opened a room anyway');
  END IF;

  IF cardinality(failures) > 0 THEN
    RAISE EXCEPTION 'GUARD-A11: %', array_to_string(failures, '; ');
  END IF;
END;
$$;

RESET ROLE;
UPDATE users SET account_status = 'active'
 WHERE id = '00000000-0000-0000-0000-000000000004';
SET LOCAL ROLE authenticated;

DO $$
DECLARE
  updated_count INTEGER;
BEGIN
  -- Positive control: reinstating the sender is the only change, and the very
  -- same direct UPDATE now succeeds — so the refusal came from the invariant,
  -- not from a missing grant or a policy that never permitted the write.
  UPDATE interests
     SET status = 'accepted', decided_at = now()
   WHERE campaign_id = '20000000-0000-0000-0000-000000000001'
     AND sender_user_id = '00000000-0000-0000-0000-000000000004';
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  IF updated_count <> 1 THEN
    RAISE EXCEPTION 'GUARD-A11: the reinstated sender could not be accepted by table UPDATE';
  END IF;
END;
$$;

RESET ROLE;
SELECT pg_temp.reset_probe_interest();

-- ═══ Guard B: expired-campaign exits are enforced by the database ═════
-- B0 positive control: the scheduled pass that CREATES expired campaigns still
-- works. expire_due_campaigns() is what pg_cron runs every 15 minutes (0043),
-- so a guard that broke it would break the whole expiration story.
UPDATE campaigns SET ends_at = now() - INTERVAL '1 day'
 WHERE id = '20000000-0000-0000-0000-000000000001';
SET LOCAL ROLE service_role;
SELECT public.expire_due_campaigns();
RESET ROLE;

DO $$
DECLARE
  failures TEXT[] := ARRAY[]::TEXT[];
  accepted BOOLEAN;
  actual TEXT;
  state TEXT;
  probe CONSTANT UUID := '20000000-0000-0000-0000-000000000001';
  refusal CONSTANT TEXT :=
    'an expired campaign can only be archived, or republished with a window that has not ended';
BEGIN
  IF (SELECT status FROM campaigns WHERE id = probe) <> 'expired' THEN
    failures := array_append(failures, 'B0: expire_due_campaigns() no longer expires a due campaign');
  END IF;

  -- (B1) The E2E-observed hole: a direct UPDATE republishing a lapsed window.
  accepted := false;
  actual := NULL;
  state := NULL;
  BEGIN
    UPDATE campaigns SET status = 'published' WHERE id = probe;
    accepted := true;
  EXCEPTION WHEN OTHERS THEN
    actual := SQLERRM;
    state := SQLSTATE;
  END;
  IF accepted THEN
    failures := array_append(failures, 'B1: a direct UPDATE revived an expired campaign with a dead window');
  ELSIF actual <> refusal OR state <> '23514' THEN
    failures := array_append(failures, 'B1: refused with ' || state || ' "' || actual || '"');
  END IF;

  -- (B2) expired -> paused would launder a lapsed campaign into a state the
  -- owner's own resume path accepts, so it is refused too.
  accepted := false;
  actual := NULL;
  BEGIN
    UPDATE campaigns SET status = 'paused' WHERE id = probe;
    accepted := true;
  EXCEPTION WHEN OTHERS THEN
    actual := SQLERRM;
  END;
  IF accepted THEN
    failures := array_append(failures, 'B2: an expired campaign was laundered into paused');
  ELSIF actual <> refusal THEN
    failures := array_append(failures, 'B2: refused with "' || actual || '"');
  END IF;

  -- (B3) ends_at maintenance on a still-expired row is untouched: this is what
  -- record_revenuecat_event (0042) does when a publish gate blocks a revival.
  BEGIN
    UPDATE campaigns SET ends_at = now() + INTERVAL '30 days' WHERE id = probe;
  EXCEPTION WHEN OTHERS THEN
    failures := array_append(failures, 'B3: parking a paid window on an expired campaign was blocked: ' || SQLERRM);
  END;
  IF (SELECT status FROM campaigns WHERE id = probe) <> 'expired' THEN
    failures := array_append(failures, 'B3: the parked window changed the status');
  END IF;

  -- (B4) Positive control: the paid revival shape — status and a future
  -- ends_at set by the same statement — is allowed.
  UPDATE campaigns SET ends_at = now() - INTERVAL '1 day' WHERE id = probe;
  BEGIN
    UPDATE campaigns
       SET status = 'published', ends_at = now() + INTERVAL '30 days'
     WHERE id = probe;
  EXCEPTION WHEN OTHERS THEN
    failures := array_append(failures, 'B4: the paid revival shape was blocked: ' || SQLERRM);
  END;
  IF (SELECT status FROM campaigns WHERE id = probe) <> 'published' THEN
    failures := array_append(failures, 'B4: the paid revival did not republish the campaign');
  END IF;

  -- (B5) Positive control: archiving is always a legitimate exit.
  UPDATE campaigns
     SET status = 'expired', ends_at = now() - INTERVAL '1 day'
   WHERE id = probe;
  BEGIN
    UPDATE campaigns SET status = 'archived' WHERE id = probe;
  EXCEPTION WHEN OTHERS THEN
    failures := array_append(failures, 'B5: archiving an expired campaign was blocked: ' || SQLERRM);
  END;
  IF (SELECT status FROM campaigns WHERE id = probe) <> 'archived' THEN
    failures := array_append(failures, 'B5: the expired campaign did not archive');
  END IF;

  IF cardinality(failures) > 0 THEN
    RAISE EXCEPTION 'GUARD-B: %', array_to_string(failures, '; ');
  END IF;
END;
$$;

-- ═══ Guard B6: the owner-facing RPC contract is unchanged ═════════════
UPDATE campaigns
   SET status = 'expired', ends_at = now() - INTERVAL '1 day'
 WHERE id = '20000000-0000-0000-0000-000000000001';

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
DO $$
DECLARE
  failures TEXT[] := ARRAY[]::TEXT[];
  accepted BOOLEAN;
  actual TEXT;
  final_status TEXT;
BEGIN
  accepted := false;
  actual := NULL;
  BEGIN
    PERFORM * FROM public.set_campaign_status(
      '20000000-0000-0000-0000-000000000001',
      'published'
    );
    accepted := true;
  EXCEPTION WHEN OTHERS THEN
    actual := SQLERRM;
  END;
  IF accepted THEN
    failures := array_append(failures, 'B6: the owner RPC resumed an expired campaign');
  ELSIF actual <> 'cannot move campaign from expired to published' THEN
    -- The RPC still refuses first, with its own message; the trigger is the
    -- backstop for callers that do not go through it.
    failures := array_append(failures, 'B6: the owner RPC refused with "' || actual || '"');
  END IF;

  -- Positive control: the owner's legitimate exit still works through the RPC.
  BEGIN
    SELECT campaign_status INTO final_status
      FROM public.set_campaign_status(
        '20000000-0000-0000-0000-000000000001',
        'archived'
      );
  EXCEPTION WHEN OTHERS THEN
    failures := array_append(failures, 'B6: the owner could not archive an expired campaign: ' || SQLERRM);
  END;
  IF final_status IS DISTINCT FROM 'archived' THEN
    failures := array_append(failures, 'B6: archiving returned ' || coalesce(final_status, 'NULL'));
  END IF;

  IF cardinality(failures) > 0 THEN
    RAISE EXCEPTION 'GUARD-B6: %', array_to_string(failures, '; ');
  END IF;
END;
$$;

RESET ROLE;

-- ═══ Guard B7: 'archived' is not a laundry route back into published ══
-- The expired-exit clause whitelists 'archived', so on its own it was bypassed
-- in two statements: expired -> archived -> published, the second of which sees
-- OLD.status='archived' and never looks at the window. The second clause
-- refuses any campaign ENTERING published with a window that has already ended,
-- whatever it was before.
DO $$
DECLARE
  failures TEXT[] := ARRAY[]::TEXT[];
  accepted BOOLEAN;
  actual TEXT;
  state TEXT;
  probe CONSTANT UUID := '20000000-0000-0000-0000-000000000001';
  refusal CONSTANT TEXT :=
    'a campaign cannot become published with a window that has already ended';
BEGIN
  UPDATE campaigns
     SET status = 'expired', ends_at = now() - INTERVAL '1 day'
   WHERE id = probe;
  UPDATE campaigns SET status = 'archived' WHERE id = probe;

  accepted := false;
  BEGIN
    UPDATE campaigns SET status = 'published' WHERE id = probe;
    accepted := true;
  EXCEPTION WHEN OTHERS THEN
    actual := SQLERRM;
    state := SQLSTATE;
  END;
  IF accepted THEN
    failures := array_append(failures, 'B7: archived laundered a lapsed campaign back into published');
  ELSIF actual <> refusal OR state <> '23514' THEN
    failures := array_append(failures, 'B7: refused with ' || state || ' "' || actual || '"');
  END IF;
  IF (SELECT status FROM campaigns WHERE id = probe) <> 'archived' THEN
    failures := array_append(failures, 'B7: the refused republish still changed the status');
  END IF;

  -- Paused is the same story: entering published is the control point, not the
  -- status the row happened to be in.
  UPDATE campaigns SET status = 'paused' WHERE id = probe;
  accepted := false;
  BEGIN
    UPDATE campaigns SET status = 'published' WHERE id = probe;
    accepted := true;
  EXCEPTION WHEN OTHERS THEN
    actual := SQLERRM;
  END;
  IF accepted THEN
    failures := array_append(failures, 'B7: a paused campaign was published with a dead window');
  ELSIF actual <> refusal THEN
    failures := array_append(failures, 'B7: paused refused with "' || actual || '"');
  END IF;

  -- Positive control: the clause reads the window, not the status it came from.
  -- The identical UPDATE with a live window succeeds.
  BEGIN
    UPDATE campaigns
       SET status = 'published', ends_at = now() + INTERVAL '30 days'
     WHERE id = probe;
  EXCEPTION WHEN OTHERS THEN
    failures := array_append(failures, 'B7: publishing with a live window was blocked: ' || SQLERRM);
  END;
  IF (SELECT status FROM campaigns WHERE id = probe) <> 'published' THEN
    failures := array_append(failures, 'B7: the live-window publish did not take');
  END IF;

  -- Second positive control: a campaign that is ALREADY published may still
  -- have its window moved into the past. That is the scheduler-lag state
  -- expire_due_campaigns() exists to clean up, and four existing suites (10,
  -- b10, c06) construct it; refusing it would forbid writing a state the clock
  -- produces unaided. This is the documented limit of the guard.
  BEGIN
    UPDATE campaigns SET ends_at = now() - INTERVAL '1 day' WHERE id = probe;
  EXCEPTION WHEN OTHERS THEN
    failures := array_append(failures, 'B7: scheduler-lag simulation was blocked: ' || SQLERRM);
  END;

  IF cardinality(failures) > 0 THEN
    RAISE EXCEPTION 'GUARD-B7: %', array_to_string(failures, '; ');
  END IF;
END;
$$;

ROLLBACK;

SELECT '20_accept_and_expiry_invariants.sql passed' AS result;
