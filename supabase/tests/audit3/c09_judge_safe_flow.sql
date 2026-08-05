-- AUDIT3 REGRESSION — GP-P0-3 (judge-safe interest → inbox → accept → Intro Room)
-- With public_beta_enabled='off', a campaign whose pitch draft is on the QA
-- preview allowlist (0034, service-role only) must let a judge experience the
-- WHOLE differentiator chain: interest submission, the dater's inbox, accepting
-- the interest, and the Intro Room that opens on accept. A non-allowlisted
-- campaign must stay fully blocked.
--
-- FINDING (call-path verified): the public-beta gate is enforced at exactly two
-- write points — the campaign publish trigger and the interests INSERT trigger
-- (both honour the allowlist, 0034). Nothing after interest submission
-- (decide_interest/accept, or the intro_rooms INSERT it performs) is beta-gated
-- at all; those carry only the active-account guard and ownership/state-machine
-- guards. So the allowlist already opens the whole chain, and no new gate/
-- migration is needed. This file LOCKS that invariant as a regression: if a
-- future change bolts a beta gate onto accept/room creation, the judge-safe
-- flow would silently break, and this test catches it. It also pins the
-- direct-RPC-bypass, RLS and double-accept (concurrency) invariants the audit
-- requires for every DB change.
BEGIN;

-- ── Fixtures minted while the seed's beta is still open, so publish succeeds ──
-- Subject == owner with an approved consent request satisfies the 0001 publish
-- validator (campaigns_validate_publication); the ONLY remaining gate is the
-- public beta gate we probe below. Owners are chosen to avoid the 0039
-- one-active-campaign guard: Alex (0001) owns only a DRAFT campaign, Drew
-- (0004) owns none, so each can hold one new published campaign.
--   CJ = judge-safe campaign (owner Alex 0001), draft dJ  -> allowlisted
--   CN = control campaign    (owner Drew 0004), draft dN  -> NOT allowlisted
INSERT INTO pitch_drafts (id, created_by_user_id, subject_user_id, status, headline, body)
VALUES
  ('c0900000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001',
   'published', 'Audit3 judge-safe J', 'Judge-safe allowlisted chain probe.'),
  ('c0900000-0000-0000-0000-000000000002',
   '00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000004',
   'published', 'Audit3 control N', 'Non-allowlisted blocked probe.');

INSERT INTO consent_requests (id, pitch_draft_id, subject_user_id, token_hash, status, responded_at)
VALUES
  ('c0910000-0000-0000-0000-000000000001', 'c0900000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000001', 'audit3-c09-consent-j', 'approved', now() - INTERVAL '1 day'),
  ('c0910000-0000-0000-0000-000000000002', 'c0900000-0000-0000-0000-000000000002',
   '00000000-0000-0000-0000-000000000004', 'audit3-c09-consent-n', 'approved', now() - INTERVAL '1 day');

INSERT INTO campaigns (id, pitch_draft_id, owner_user_id, status, published_at, slug)
VALUES
  ('c0920000-0000-0000-0000-000000000001', 'c0900000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000001', 'published', now(), 'audit3-c09-judge'),
  ('c0920000-0000-0000-0000-000000000002', 'c0900000-0000-0000-0000-000000000002',
   '00000000-0000-0000-0000-000000000004', 'published', now(), 'audit3-c09-control');

-- Close both gates (seed opened them). Allowlist ONLY the judge-safe draft.
UPDATE app_config SET value = 'off'
 WHERE key IN ('real_payments_enabled', 'public_beta_enabled');

INSERT INTO qa_preview_allowlist (pitch_draft_id, note)
VALUES ('c0900000-0000-0000-0000-000000000001', 'audit3 c09 judge-safe preview');

-- ── 0. Sender eligibility fixture, so §3's accept is about the beta gate ──
-- The interests below are INSERTed directly, so they carry no
-- submitted_photo_digest. Since 0055 a NULL digest forces the accept-time photo
-- provenance and 2-photo re-check (0044 grandfathered it away). Casey (0003),
-- the sender whose interest §3 accepts, gets a complete dating profile backed
-- by resolvable caller-owned profile-media objects, so §3 is decided by what
-- this suite is actually about — whether the beta gate reaches past submission
-- — and not by a sender-eligibility refusal. (§5's accept attempt needs no such
-- fixture: decide_interest's owner guard refuses a non-owner before it ever
-- looks at the sender.) The ROLLBACK at the end of the file undoes all of it.
INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
VALUES
  (
    'profile-media',
    '00000000-0000-0000-0000-000000000003/c09-casey-1.jpg',
    '00000000-0000-0000-0000-000000000003',
    '{"mimetype":"image/jpeg"}'
  ),
  (
    'profile-media',
    '00000000-0000-0000-0000-000000000003/c09-casey-2.jpg',
    '00000000-0000-0000-0000-000000000003',
    '{"mimetype":"image/jpeg"}'
  );

UPDATE dating_profiles
   SET bio = 'Museum fan and weekend cyclist.',
       dating_intent = 'long-term',
       photos = ARRAY[
         '00000000-0000-0000-0000-000000000003/c09-casey-1.jpg',
         '00000000-0000-0000-0000-000000000003/c09-casey-2.jpg'
       ]
 WHERE user_id = '00000000-0000-0000-0000-000000000003';

-- ── 1. Allowlisted interest submission is accepted while the beta is closed ──
-- Direct INSERT exercises the interests INSERT trigger (block_interests_until_
-- public_beta) on the same path a bypass would, and proves the allowlist opens
-- it. Casey (0003) reaches out to the judge-safe campaign CJ.
DO $$
BEGIN
  BEGIN
    INSERT INTO interests (id, campaign_id, sender_user_id, status, note, submitted_at)
    VALUES ('c0930000-0000-0000-0000-000000000001',
            'c0920000-0000-0000-0000-000000000001',
            '00000000-0000-0000-0000-000000000003', 'submitted',
            'c09 judge-safe interest', now());
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'AUDIT3-C09: interest into an allowlisted campaign was blocked while beta off: %', SQLERRM;
  END;
END;
$$;

-- ── 2. The dater's inbox surfaces that interest (beta off, allowlisted) ──
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
DO $$
DECLARE
  submitted_count INTEGER;
BEGIN
  SELECT count(*) INTO submitted_count
    FROM public.list_campaign_interests('c0920000-0000-0000-0000-000000000001')
   WHERE interest_id = 'c0930000-0000-0000-0000-000000000001'
     AND interest_status = 'submitted';
  IF submitted_count <> 1 THEN
    RAISE EXCEPTION 'AUDIT3-C09: judge-safe inbox did not surface the submitted interest (got %)', submitted_count;
  END IF;
END;
$$;
RESET ROLE;

-- ── 3. Accepting opens an Intro Room, and a second accept is rejected ──
-- (accept + intro_rooms INSERT are NOT beta-gated; the second accept proves the
-- status-machine/concurrency invariant that prevents a double-accept race.)
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
DO $$
DECLARE
  opened_room UUID;
BEGIN
  SELECT intro_room_id INTO opened_room
    FROM public.decide_interest('c0930000-0000-0000-0000-000000000001', 'accepted');
  IF opened_room IS NULL THEN
    RAISE EXCEPTION 'AUDIT3-C09: accept did not open an Intro Room while the beta is closed';
  END IF;

  BEGIN
    PERFORM public.decide_interest('c0930000-0000-0000-0000-000000000001', 'accepted');
    RAISE EXCEPTION 'AUDIT3-C09-DOUBLE: a second accept on the same interest was allowed';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'AUDIT3-C09-DOUBLE%' THEN
      RAISE;
    END IF;
    -- expected: 'interest is not awaiting a decision'
  END;
END;
$$;
RESET ROLE;

-- The Intro Room row actually exists for the (dater, interested) pair.
DO $$
DECLARE
  room_count INTEGER;
BEGIN
  SELECT count(*) INTO room_count FROM intro_rooms
   WHERE campaign_id = 'c0920000-0000-0000-0000-000000000001'
     AND dater_user_id = '00000000-0000-0000-0000-000000000001'
     AND interested_user_id = '00000000-0000-0000-0000-000000000003';
  IF room_count <> 1 THEN
    RAISE EXCEPTION 'AUDIT3-C09: the accepted interest did not create exactly one Intro Room (got %)', room_count;
  END IF;
END;
$$;

-- ── 4. A non-allowlisted campaign stays fully blocked while beta off ──
DO $$
DECLARE
  blocked BOOLEAN := false;
BEGIN
  BEGIN
    INSERT INTO interests (campaign_id, sender_user_id, status, note, submitted_at)
    VALUES ('c0920000-0000-0000-0000-000000000002',
            '00000000-0000-0000-0000-000000000003', 'submitted',
            'c09 non-allowlisted probe', now());
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%private beta%' THEN
      RAISE EXCEPTION 'AUDIT3-C09: non-allowlisted interest blocked for the wrong reason: %', SQLERRM;
    END IF;
    blocked := true;
  END;
  IF NOT blocked THEN
    RAISE EXCEPTION 'AUDIT3-C09: interest into a non-allowlisted campaign was accepted while the gate is closed';
  END IF;
END;
$$;

-- ── 4b. Boundary dependency: because submission is blocked at the boundary, the
-- whole downstream (inbox/accept/room) is UNREACHABLE for a non-allowlisted
-- campaign. The gate lives at exactly one place (interest submission), and the
-- rest of the chain is safe precisely because nothing can reach it. This makes
-- decision A explicit: no downstream beta gate is needed. ──
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);
DO $$
DECLARE
  inbox_count INTEGER;
BEGIN
  SELECT count(*) INTO inbox_count
    FROM public.list_campaign_interests('c0920000-0000-0000-0000-000000000002');
  IF inbox_count <> 0 THEN
    RAISE EXCEPTION 'AUDIT3-C09: a non-allowlisted campaign has reachable inbox items (boundary block leaked, got %)', inbox_count;
  END IF;
END;
$$;
RESET ROLE;

-- ── 5. Direct-RPC bypass: a non-owner cannot accept an interest ──
-- A fresh submitted interest from Drew (0004) into the allowlisted CJ; a
-- non-owner (Casey 0003) calling decide_interest must be refused by the owner
-- guard, so accept cannot be forged by anyone but the campaign owner.
INSERT INTO interests (id, campaign_id, sender_user_id, status, note, submitted_at)
VALUES ('c0930000-0000-0000-0000-000000000002',
        'c0920000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-000000000004', 'submitted',
        'c09 owner-guard probe', now());

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true);
DO $$
DECLARE
  denied BOOLEAN := false;
BEGIN
  BEGIN
    PERFORM public.decide_interest('c0930000-0000-0000-0000-000000000002', 'accepted');
  EXCEPTION WHEN OTHERS THEN
    denied := true;
  END;
  IF NOT denied THEN
    RAISE EXCEPTION 'AUDIT3-C09: a non-owner accepted an interest (owner guard / direct-bypass broken)';
  END IF;
END;
$$;
RESET ROLE;

-- ── 6. RLS: only the two participants can read the opened Intro Room ──
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true);
DO $$
DECLARE
  seen INTEGER;
BEGIN
  SELECT count(*) INTO seen FROM public.intro_rooms
   WHERE campaign_id = 'c0920000-0000-0000-0000-000000000001'
     AND dater_user_id = '00000000-0000-0000-0000-000000000001'
     AND interested_user_id = '00000000-0000-0000-0000-000000000003';
  IF seen <> 1 THEN
    RAISE EXCEPTION 'AUDIT3-C09: a participant could not read their own Intro Room (RLS too strict)';
  END IF;
END;
$$;
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
DO $$
DECLARE
  leaked INTEGER;
BEGIN
  SELECT count(*) INTO leaked FROM public.intro_rooms
   WHERE campaign_id = 'c0920000-0000-0000-0000-000000000001'
     AND dater_user_id = '00000000-0000-0000-0000-000000000001'
     AND interested_user_id = '00000000-0000-0000-0000-000000000003';
  IF leaked <> 0 THEN
    RAISE EXCEPTION 'AUDIT3-C09: a non-participant read another pair''s Intro Room (RLS leak)';
  END IF;
END;
$$;
RESET ROLE;

ROLLBACK;

SELECT 'c09_judge_safe_flow.sql passed' AS result;
