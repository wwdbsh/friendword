-- Durable encoding of the eight refusal guards that were verified by hand
-- against hosted Supabase during the 2026-07-29 E2E run. A one-shot UI/API
-- observation leaves no artifact, so this file re-asserts each refusal in the
-- local harness, and asserts the EXACT message the server returns — a message
-- change is a contract change the product surfaces depend on.
--
-- Every guard here also carries a positive control in the same block (the
-- allowed direction, the boundary value, or the other party), so a fixture
-- that silently stops reaching the guard fails instead of passing vacuously.
--
-- Deliberate overlap with existing suites, kept because those files assert
-- only that "some exception" was raised (or exercise a different caller):
--   05/12/b05  claim_consent_request  — no exact-message or self-invite case
--   c01        publish beta gate      — trigger-level; this repeats it as the
--                                       observed publish/allowlist pair
--   c07        one active campaign    — this adds the archived-exit control
--   06         owner self-interest    — no exact message
--   18         message length + rate  — runs as superuser; this runs the real
--                                       `authenticated` + RLS caller path
BEGIN;

-- ═══ Guards 1 & 2: claim_consent_request binds a claim to the invited contact
-- Drafts belong to Drew (0004, draft-introducer@example.test): one invite is
-- addressed to Drew's own email, one to Blair (0002, dater@example.test).
INSERT INTO pitch_drafts (id, created_by_user_id, status, headline, body)
VALUES
  (
    '19000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000004',
    'draft',
    'Self-addressed invite probe',
    'The introducer addresses the invite to their own verified email.'
  ),
  (
    '19000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000004',
    'draft',
    'Invited-contact claim probe',
    'Only the invited contact may claim this consent request.'
  );

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);

DO $$
DECLARE
  failures TEXT[] := ARRAY[]::TEXT[];
  self_token TEXT;
  invited_token TEXT;
  accepted BOOLEAN;
  actual TEXT;
  claimed_draft UUID;
BEGIN
  SELECT consent_token INTO self_token
    FROM public.submit_pitch_for_consent(
      '19000000-0000-0000-0000-000000000001',
      'email',
      'draft-introducer@example.test',
      'Drew'
    );
  SELECT consent_token INTO invited_token
    FROM public.submit_pitch_for_consent(
      '19000000-0000-0000-0000-000000000002',
      'email',
      'dater@example.test',
      'Blair'
    );

  -- (1a) The introducer is refused even when the invited contact IS their own
  -- email, i.e. after the contact-hash check has already passed.
  accepted := false;
  actual := NULL;
  BEGIN
    PERFORM * FROM public.claim_consent_request(self_token);
    accepted := true;
  EXCEPTION WHEN OTHERS THEN
    actual := SQLERRM;
  END;
  IF accepted THEN
    failures := array_append(failures, 'G1a: introducer claimed their own self-addressed invite');
  ELSIF actual <> 'introducer cannot claim their own consent request' THEN
    failures := array_append(failures, 'G1a: refused with "' || actual || '"');
  END IF;

  -- (1b) The E2E-observed shape: the introducer claiming an invite addressed
  -- to someone else is stopped earlier, by the contact binding.
  accepted := false;
  actual := NULL;
  BEGIN
    PERFORM * FROM public.claim_consent_request(invited_token);
    accepted := true;
  EXCEPTION WHEN OTHERS THEN
    actual := SQLERRM;
  END;
  IF accepted THEN
    failures := array_append(failures, 'G1b: introducer claimed an invite addressed to another contact');
  ELSIF actual <> 'consent invite was sent to a different contact' THEN
    failures := array_append(failures, 'G1b: refused with "' || actual || '"');
  END IF;

  -- (2a) A third party holding the token is refused: their email is not the
  -- invited contact.
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true);
  accepted := false;
  actual := NULL;
  BEGIN
    PERFORM * FROM public.claim_consent_request(invited_token);
    accepted := true;
  EXCEPTION WHEN OTHERS THEN
    actual := SQLERRM;
  END;
  IF accepted THEN
    failures := array_append(failures, 'G2a: a third party claimed an invite addressed to someone else');
  ELSIF actual <> 'consent invite was sent to a different contact' THEN
    failures := array_append(failures, 'G2a: refused with "' || actual || '"');
  END IF;

  -- (2b) Positive control: the invited contact claims the very same token.
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
  BEGIN
    SELECT pitch_draft_id INTO claimed_draft
      FROM public.claim_consent_request(invited_token);
  EXCEPTION WHEN OTHERS THEN
    failures := array_append(failures, 'G2b: the invited contact could not claim: ' || SQLERRM);
  END;
  IF claimed_draft IS DISTINCT FROM '19000000-0000-0000-0000-000000000002'::UUID THEN
    failures := array_append(
      failures,
      'G2b: claim returned ' || coalesce(claimed_draft::TEXT, 'NULL') || ' instead of the invited draft'
    );
  END IF;

  IF cardinality(failures) > 0 THEN
    RAISE EXCEPTION 'E2E-GUARD-1/2: %', array_to_string(failures, '; ');
  END IF;
END;
$$;

RESET ROLE;

DO $$
DECLARE
  failures TEXT[] := ARRAY[]::TEXT[];
BEGIN
  -- The successful claim bound the request AND the draft to the invited
  -- contact; the refused draft was left unbound.
  IF NOT EXISTS (
    SELECT 1 FROM consent_requests
     WHERE pitch_draft_id = '19000000-0000-0000-0000-000000000002'
       AND subject_user_id = '00000000-0000-0000-0000-000000000002'
       AND status = 'claimed'
  ) THEN
    failures := array_append(failures, 'the claimed consent request was not bound to the invited contact');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pitch_drafts
     WHERE id = '19000000-0000-0000-0000-000000000002'
       AND subject_user_id = '00000000-0000-0000-0000-000000000002'
  ) THEN
    failures := array_append(failures, 'the claimed draft did not take the invited contact as its subject');
  END IF;
  IF EXISTS (
    SELECT 1 FROM pitch_drafts
     WHERE id = '19000000-0000-0000-0000-000000000001'
       AND subject_user_id IS NOT NULL
  ) THEN
    failures := array_append(failures, 'the refused self-addressed draft still gained a subject');
  END IF;

  IF cardinality(failures) > 0 THEN
    RAISE EXCEPTION 'E2E-GUARD-1/2-STATE: %', array_to_string(failures, '; ');
  END IF;
END;
$$;

-- ═══ Guard 3: publishing is blocked while the public beta is closed, and the
-- QA preview allowlist is the only exception.
-- seed.sql opens the gates for local test databases, so the closed state is
-- set here explicitly instead of being inherited.
UPDATE app_config SET value = 'off' WHERE key = 'public_beta_enabled';

INSERT INTO pitch_drafts (id, created_by_user_id, subject_user_id, status, headline, body)
VALUES (
  '19000000-0000-0000-0000-000000000003',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000003',
  'published',
  'Closed beta publish probe',
  'Publishing must be refused while the public beta is closed.'
);
INSERT INTO consent_requests (id, pitch_draft_id, subject_user_id, token_hash, status, responded_at)
VALUES (
  '19100000-0000-0000-0000-000000000003',
  '19000000-0000-0000-0000-000000000003',
  '00000000-0000-0000-0000-000000000003',
  '19-e2e-consent-beta-gate',
  'approved',
  now() - INTERVAL '1 day'
);

DO $$
DECLARE
  failures TEXT[] := ARRAY[]::TEXT[];
  accepted BOOLEAN;
  actual TEXT;
  probe_campaign CONSTANT UUID := '19200000-0000-0000-0000-000000000003';
BEGIN
  -- (3a) Blocked while the draft is NOT on the allowlist.
  accepted := false;
  actual := NULL;
  BEGIN
    INSERT INTO campaigns (id, pitch_draft_id, owner_user_id, status, published_at, slug)
    VALUES (
      probe_campaign,
      '19000000-0000-0000-0000-000000000003',
      '00000000-0000-0000-0000-000000000003',
      'published',
      now(),
      '19-e2e-beta-gate'
    );
    accepted := true;
  EXCEPTION WHEN OTHERS THEN
    actual := SQLERRM;
  END;
  IF accepted THEN
    failures := array_append(failures, 'G3a: a campaign published while public_beta_enabled=off with no allowlist row');
  ELSIF actual <> 'Friendword is in a private beta; publishing is not open yet' THEN
    failures := array_append(failures, 'G3a: refused with "' || actual || '"');
  END IF;

  -- (3b) The same statement succeeds once the draft is allowlisted, and
  -- nothing else about the fixture changed.
  INSERT INTO qa_preview_allowlist (pitch_draft_id, note)
  VALUES ('19000000-0000-0000-0000-000000000003', '19_e2e guard 3 preview surface');

  BEGIN
    INSERT INTO campaigns (id, pitch_draft_id, owner_user_id, status, published_at, slug)
    VALUES (
      probe_campaign,
      '19000000-0000-0000-0000-000000000003',
      '00000000-0000-0000-0000-000000000003',
      'published',
      now(),
      '19-e2e-beta-gate'
    );
  EXCEPTION WHEN OTHERS THEN
    failures := array_append(failures, 'G3b: an allowlisted draft could not publish while the gate is closed: ' || SQLERRM);
  END;
  IF NOT EXISTS (
    SELECT 1 FROM campaigns WHERE id = probe_campaign AND status = 'published'
  ) THEN
    failures := array_append(failures, 'G3b: the allowlisted publish left no published campaign');
  END IF;

  IF cardinality(failures) > 0 THEN
    RAISE EXCEPTION 'E2E-GUARD-3: %', array_to_string(failures, '; ');
  END IF;
END;
$$;

-- ═══ Guard 4: one active (published or paused) campaign per owner.
UPDATE app_config SET value = 'on' WHERE key = 'public_beta_enabled';

INSERT INTO pitch_drafts (id, created_by_user_id, subject_user_id, status, headline, body)
VALUES
  (
    '19000000-0000-0000-0000-000000000004',
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000004',
    'published',
    'First active campaign probe',
    'The first active campaign for an owner must publish.'
  ),
  (
    '19000000-0000-0000-0000-000000000005',
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000004',
    'published',
    'Second active campaign probe',
    'A second simultaneously active campaign for the same owner must be refused.'
  );
INSERT INTO consent_requests (id, pitch_draft_id, subject_user_id, token_hash, status, responded_at)
VALUES
  (
    '19100000-0000-0000-0000-000000000004',
    '19000000-0000-0000-0000-000000000004',
    '00000000-0000-0000-0000-000000000004',
    '19-e2e-consent-active-1',
    'approved',
    now() - INTERVAL '1 day'
  ),
  (
    '19100000-0000-0000-0000-000000000005',
    '19000000-0000-0000-0000-000000000005',
    '00000000-0000-0000-0000-000000000004',
    '19-e2e-consent-active-2',
    'approved',
    now() - INTERVAL '1 day'
  );

DO $$
DECLARE
  failures TEXT[] := ARRAY[]::TEXT[];
  accepted BOOLEAN;
  actual TEXT;
  first_campaign CONSTANT UUID := '19200000-0000-0000-0000-000000000004';
  second_campaign CONSTANT UUID := '19200000-0000-0000-0000-000000000005';
  refusal CONSTANT TEXT :=
    'owner already has an active campaign; only one campaign may be published or paused at a time';
BEGIN
  -- Positive control: the owner's first active campaign publishes.
  BEGIN
    INSERT INTO campaigns (id, pitch_draft_id, owner_user_id, status, published_at, slug)
    VALUES (
      first_campaign,
      '19000000-0000-0000-0000-000000000004',
      '00000000-0000-0000-0000-000000000004',
      'published',
      now(),
      '19-e2e-active-1'
    );
  EXCEPTION WHEN OTHERS THEN
    failures := array_append(failures, 'G4: the first active campaign was blocked: ' || SQLERRM);
  END;

  -- (4a) A second published campaign for the same owner is refused.
  accepted := false;
  actual := NULL;
  BEGIN
    INSERT INTO campaigns (id, pitch_draft_id, owner_user_id, status, published_at, slug)
    VALUES (
      second_campaign,
      '19000000-0000-0000-0000-000000000005',
      '00000000-0000-0000-0000-000000000004',
      'published',
      now(),
      '19-e2e-active-2'
    );
    accepted := true;
  EXCEPTION WHEN OTHERS THEN
    actual := SQLERRM;
  END;
  IF accepted THEN
    failures := array_append(failures, 'G4a: a second published campaign for one owner was accepted');
  ELSIF actual <> refusal THEN
    failures := array_append(failures, 'G4a: refused with "' || actual || '"');
  END IF;

  -- (4b) Pausing the first campaign does not free the slot: paused is active.
  UPDATE campaigns SET status = 'paused' WHERE id = first_campaign;
  accepted := false;
  actual := NULL;
  BEGIN
    INSERT INTO campaigns (id, pitch_draft_id, owner_user_id, status, published_at, slug)
    VALUES (
      second_campaign,
      '19000000-0000-0000-0000-000000000005',
      '00000000-0000-0000-0000-000000000004',
      'published',
      now(),
      '19-e2e-active-2'
    );
    accepted := true;
  EXCEPTION WHEN OTHERS THEN
    actual := SQLERRM;
  END;
  IF accepted THEN
    failures := array_append(failures, 'G4b: a paused campaign did not count as active');
  ELSIF actual <> refusal THEN
    failures := array_append(failures, 'G4b: refused with "' || actual || '"');
  END IF;

  -- (4c) Positive control: archiving the first campaign frees the slot, so the
  -- refusals above came from the H-7 guard and not from the fixture.
  UPDATE campaigns SET status = 'archived' WHERE id = first_campaign;
  BEGIN
    INSERT INTO campaigns (id, pitch_draft_id, owner_user_id, status, published_at, slug)
    VALUES (
      second_campaign,
      '19000000-0000-0000-0000-000000000005',
      '00000000-0000-0000-0000-000000000004',
      'published',
      now(),
      '19-e2e-active-2'
    );
  EXCEPTION WHEN OTHERS THEN
    failures := array_append(failures, 'G4c: publishing after archiving the only active campaign was blocked: ' || SQLERRM);
  END;

  IF cardinality(failures) > 0 THEN
    RAISE EXCEPTION 'E2E-GUARD-4: %', array_to_string(failures, '; ');
  END IF;
END;
$$;

-- ═══ Guards 5 & 6: submit_interest refusals.
-- Guard 5 reads profiles.birth_date (the identity profile), not
-- dating_profiles; the dating-profile completeness check runs after it.
-- The seed campaign 20000000-…-0001 is owned by Blair (0002).
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);

DO $$
DECLARE
  accepted BOOLEAN := false;
  actual TEXT;
BEGIN
  -- (6) The campaign owner cannot send interest to their own campaign.
  BEGIN
    PERFORM * FROM public.submit_interest('20000000-0000-0000-0000-000000000001');
    accepted := true;
  EXCEPTION WHEN OTHERS THEN
    actual := SQLERRM;
  END;
  IF accepted THEN
    RAISE EXCEPTION 'E2E-GUARD-6: the owner sent interest to their own campaign';
  END IF;
  IF actual <> 'you cannot send interest to your own campaign' THEN
    RAISE EXCEPTION 'E2E-GUARD-6: refused with "%"', actual;
  END IF;
END;
$$;

RESET ROLE;
UPDATE profiles SET birth_date = NULL WHERE user_id = '00000000-0000-0000-0000-000000000004';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);

DO $$
DECLARE
  accepted BOOLEAN := false;
  actual TEXT;
BEGIN
  -- (5a) No birth date at all.
  BEGIN
    PERFORM * FROM public.submit_interest('20000000-0000-0000-0000-000000000001');
    accepted := true;
  EXCEPTION WHEN OTHERS THEN
    actual := SQLERRM;
  END;
  IF accepted THEN
    RAISE EXCEPTION 'E2E-GUARD-5: interest was accepted with no birth date';
  END IF;
  IF actual <> 'verified interest requires an adult birth date on your profile' THEN
    RAISE EXCEPTION 'E2E-GUARD-5: refused with "%"', actual;
  END IF;
END;
$$;

RESET ROLE;
UPDATE profiles
   SET birth_date = (CURRENT_DATE - INTERVAL '18 years' + INTERVAL '1 day')::DATE
 WHERE user_id = '00000000-0000-0000-0000-000000000004';
SET LOCAL ROLE authenticated;

DO $$
DECLARE
  accepted BOOLEAN := false;
  actual TEXT;
BEGIN
  -- (5b) One day short of 18.
  BEGIN
    PERFORM * FROM public.submit_interest('20000000-0000-0000-0000-000000000001');
    accepted := true;
  EXCEPTION WHEN OTHERS THEN
    actual := SQLERRM;
  END;
  IF accepted THEN
    RAISE EXCEPTION 'E2E-GUARD-5: interest was accepted one day short of 18';
  END IF;
  IF actual <> 'verified interest requires an adult birth date on your profile' THEN
    RAISE EXCEPTION 'E2E-GUARD-5: refused with "%"', actual;
  END IF;
END;
$$;

RESET ROLE;
UPDATE profiles
   SET birth_date = (CURRENT_DATE - INTERVAL '18 years')::DATE
 WHERE user_id = '00000000-0000-0000-0000-000000000004';
SET LOCAL ROLE authenticated;

DO $$
DECLARE
  accepted BOOLEAN := false;
  actual TEXT;
BEGIN
  -- (5c) Boundary control: exactly 18 today clears the age gate, so the caller
  -- reaches the NEXT refusal instead. Without this the age assertions above
  -- could be passing for an unrelated reason.
  BEGIN
    PERFORM * FROM public.submit_interest('20000000-0000-0000-0000-000000000001');
    accepted := true;
  EXCEPTION WHEN OTHERS THEN
    actual := SQLERRM;
  END;
  IF accepted THEN
    RAISE EXCEPTION 'E2E-GUARD-5: an incomplete dating profile submitted interest';
  END IF;
  IF actual <> 'complete your dating profile (bio, intent, and at least 2 photos) first' THEN
    RAISE EXCEPTION 'E2E-GUARD-5: a caller who turned 18 today was refused with "%"', actual;
  END IF;
END;
$$;

-- ═══ Guards 7 & 8: message writes, exercised as the real `authenticated`
-- caller so both the BEFORE trigger and the RLS policy are in the path.
-- Seed room 40000000-…-0001 is open between Blair (0002) and Casey (0003).
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true);

DO $$
DECLARE
  failures TEXT[] := ARRAY[]::TEXT[];
  accepted BOOLEAN;
  actual TEXT;
  state TEXT;
  room CONSTANT UUID := '40000000-0000-0000-0000-000000000001';
BEGIN
  -- (7a) 2001 characters violates messages_body_length_check.
  accepted := false;
  actual := NULL;
  state := NULL;
  BEGIN
    INSERT INTO messages (intro_room_id, sender_user_id, body)
    VALUES (room, '00000000-0000-0000-0000-000000000003', repeat('m', 2001));
    accepted := true;
  EXCEPTION WHEN OTHERS THEN
    actual := SQLERRM;
    state := SQLSTATE;
  END;
  IF accepted THEN
    failures := array_append(failures, 'G7a: a 2001-character message body was accepted');
  ELSIF state <> '23514' OR actual NOT LIKE '%messages_body_length_check%' THEN
    failures := array_append(failures, 'G7a: refused with ' || state || ' "' || actual || '"');
  END IF;

  -- (7a) Boundary control: 2000 characters is accepted.
  BEGIN
    INSERT INTO messages (intro_room_id, sender_user_id, body)
    VALUES (room, '00000000-0000-0000-0000-000000000003', repeat('m', 2000));
  EXCEPTION WHEN OTHERS THEN
    failures := array_append(failures, 'G7a: a 2000-character message body was rejected: ' || SQLERRM);
  END;

  -- (7b) A non-participant cannot post into the room. The BEFORE trigger runs
  -- ahead of the RLS WITH CHECK, so this is the sender-validation refusal.
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);
  accepted := false;
  actual := NULL;
  BEGIN
    INSERT INTO messages (intro_room_id, sender_user_id, body)
    VALUES (room, '00000000-0000-0000-0000-000000000004', 'non-participant message');
    accepted := true;
  EXCEPTION WHEN OTHERS THEN
    actual := SQLERRM;
  END;
  IF accepted THEN
    failures := array_append(failures, 'G7b: a non-participant posted into an intro room');
  ELSIF actual <> 'message sender must be an unblocked participant in an open intro room' THEN
    failures := array_append(failures, 'G7b: non-participant refused with "' || actual || '"');
  END IF;

  -- (7b) …and cannot post under a participant's identity either: the sender
  -- clears the BEFORE trigger (0002 IS a participant) and is stopped by RLS.
  accepted := false;
  state := NULL;
  BEGIN
    INSERT INTO messages (intro_room_id, sender_user_id, body)
    VALUES (room, '00000000-0000-0000-0000-000000000002', 'spoofed sender message');
    accepted := true;
  EXCEPTION WHEN OTHERS THEN
    actual := SQLERRM;
    state := SQLSTATE;
  END;
  IF accepted THEN
    failures := array_append(failures, 'G7b: a non-participant posted under a participant identity');
  ELSIF state <> '42501' THEN
    failures := array_append(failures, 'G7b: spoofed sender refused with ' || state || ' "' || actual || '"');
  END IF;

  IF cardinality(failures) > 0 THEN
    RAISE EXCEPTION 'E2E-GUARD-7: %', array_to_string(failures, '; ');
  END IF;
END;
$$;

-- (7b) A blocked participant is refused by the sender-validation trigger.
RESET ROLE;
INSERT INTO blocks (blocker_user_id, blocked_user_id)
VALUES ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000003');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true);

DO $$
DECLARE
  accepted BOOLEAN := false;
  actual TEXT;
BEGIN
  BEGIN
    INSERT INTO messages (intro_room_id, sender_user_id, body)
    VALUES (
      '40000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000003',
      'blocked participant message'
    );
    accepted := true;
  EXCEPTION WHEN OTHERS THEN
    actual := SQLERRM;
  END;
  IF accepted THEN
    RAISE EXCEPTION 'E2E-GUARD-7: a blocked participant posted into the room';
  END IF;
  IF actual <> 'message sender must be an unblocked participant in an open intro room' THEN
    RAISE EXCEPTION 'E2E-GUARD-7: blocked participant refused with "%"', actual;
  END IF;
END;
$$;

RESET ROLE;
DELETE FROM blocks
 WHERE blocker_user_id = '00000000-0000-0000-0000-000000000002'
   AND blocked_user_id = '00000000-0000-0000-0000-000000000003';

-- ═══ Guard 8: the rate limit refuses the 21st message from the same sender in
-- the same room inside 60 seconds (private.enforce_message_rate_limit, 0025:
-- count(...) >= 20 over `now() - INTERVAL '60 seconds'`).
UPDATE messages
   SET created_at = now() - INTERVAL '5 minutes'
 WHERE intro_room_id = '40000000-0000-0000-0000-000000000001';

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true);

INSERT INTO messages (intro_room_id, sender_user_id, body)
SELECT
  '40000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000003',
  'e2e rate-limit message ' || sequence_number
FROM generate_series(1, 20) AS sequence_number;

DO $$
DECLARE
  failures TEXT[] := ARRAY[]::TEXT[];
  accepted BOOLEAN;
  actual TEXT;
  room CONSTANT UUID := '40000000-0000-0000-0000-000000000001';
BEGIN
  -- (8a) The 21st message inside the window is refused.
  accepted := false;
  actual := NULL;
  BEGIN
    INSERT INTO messages (intro_room_id, sender_user_id, body)
    VALUES (room, '00000000-0000-0000-0000-000000000003', 'e2e rate-limit message 21');
    accepted := true;
  EXCEPTION WHEN OTHERS THEN
    actual := SQLERRM;
  END;
  IF accepted THEN
    failures := array_append(failures, 'G8a: the 21st message in 60 seconds was accepted');
  ELSIF actual <> 'sending too fast — wait a moment' THEN
    failures := array_append(failures, 'G8a: refused with "' || actual || '"');
  END IF;

  -- (8b) The cap is per sender, not per room: the other participant is free.
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
  BEGIN
    INSERT INTO messages (intro_room_id, sender_user_id, body)
    VALUES (room, '00000000-0000-0000-0000-000000000002', 'other sender is not throttled');
  EXCEPTION WHEN OTHERS THEN
    failures := array_append(failures, 'G8b: the other participant was throttled too: ' || SQLERRM);
  END;

  IF cardinality(failures) > 0 THEN
    RAISE EXCEPTION 'E2E-GUARD-8: %', array_to_string(failures, '; ');
  END IF;
END;
$$;

-- (8c) The window rolls: once the 20 messages leave the last 60 seconds the
-- same sender may post again.
RESET ROLE;
UPDATE messages
   SET created_at = now() - INTERVAL '61 seconds'
 WHERE intro_room_id = '40000000-0000-0000-0000-000000000001'
   AND sender_user_id = '00000000-0000-0000-0000-000000000003';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true);

DO $$
BEGIN
  BEGIN
    INSERT INTO messages (intro_room_id, sender_user_id, body)
    VALUES (
      '40000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000003',
      'allowed once the rolling window cleared'
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'E2E-GUARD-8: the rolling window did not clear: %', SQLERRM;
  END;
END;
$$;

-- (7b) A closed room accepts nothing, not even from its participants.
RESET ROLE;
UPDATE intro_rooms
   SET status = 'closed'
 WHERE id = '40000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;

DO $$
DECLARE
  accepted BOOLEAN := false;
  actual TEXT;
BEGIN
  BEGIN
    INSERT INTO messages (intro_room_id, sender_user_id, body)
    VALUES (
      '40000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000003',
      'closed room message'
    );
    accepted := true;
  EXCEPTION WHEN OTHERS THEN
    actual := SQLERRM;
  END;
  IF accepted THEN
    RAISE EXCEPTION 'E2E-GUARD-7: a participant posted into a closed room';
  END IF;
  IF actual <> 'message sender must be an unblocked participant in an open intro room' THEN
    RAISE EXCEPTION 'E2E-GUARD-7: closed-room post refused with "%"', actual;
  END IF;
END;
$$;

RESET ROLE;
ROLLBACK;

SELECT '19_e2e_guard_regressions.sql passed' AS result;
