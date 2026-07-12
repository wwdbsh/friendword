-- Flow C journey: a viewer completes their dating profile, submits verified
-- interest on the published campaign (20..01, owner user2), the owner reads
-- the sanitized inbox, and accept/decline transitions open the intro room.

BEGIN;

-- 1. user4 (Drew) has no dating profile yet: submit must be profile-gated.
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000004';
DO $$
BEGIN
  BEGIN
    PERFORM * FROM submit_interest('20000000-0000-0000-0000-000000000001');
    RAISE EXCEPTION 'interest submitted without a dating profile';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM = 'interest submitted without a dating profile' THEN
        RAISE;
      END IF;
  END;
END;
$$;

-- 2. Drew completes a compliant dating profile through client-writable
--    columns, then submit succeeds.
INSERT INTO dating_profiles (user_id, bio, photos, dating_intent, approximate_location)
VALUES (
  '00000000-0000-0000-0000-000000000004',
  'Weekend hikes and jazz bars.',
  ARRAY['local/drew-1.jpg', 'local/drew-2.jpg'],
  'long-term',
  'Seoul'
);

CREATE TEMP TABLE interest_journey (interest_id UUID) ON COMMIT DROP;
GRANT ALL ON interest_journey TO anon, authenticated;
INSERT INTO interest_journey
SELECT interest_id FROM submit_interest(
  '20000000-0000-0000-0000-000000000001',
  'We met at the gallery opening once!'
);

DO $$
DECLARE
  submitted_status interests.status%TYPE;
BEGIN
  SELECT status INTO submitted_status
    FROM interests
   WHERE id = (SELECT interest_id FROM interest_journey);
  IF submitted_status <> 'submitted' THEN
    RAISE EXCEPTION 'expected submitted, got %', submitted_status;
  END IF;
END;
$$;

-- 3. Interest on a non-published campaign is rejected.
DO $$
BEGIN
  BEGIN
    PERFORM * FROM submit_interest('20000000-0000-0000-0000-000000000002');
    RAISE EXCEPTION 'interest accepted on a draft campaign';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM = 'interest accepted on a draft campaign' THEN
        RAISE;
      END IF;
  END;
END;
$$;

-- 4. The owner cannot send interest to their own campaign.
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000002';
DO $$
BEGIN
  BEGIN
    PERFORM * FROM submit_interest('20000000-0000-0000-0000-000000000001');
    RAISE EXCEPTION 'owner self-interest was accepted';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM = 'owner self-interest was accepted' THEN
        RAISE;
      END IF;
  END;
END;
$$;

-- 5. The owner's inbox exposes the sanitized sender profile, never contact
--    columns, and a non-owner cannot read it at all.
DO $$
DECLARE
  row_record RECORD;
BEGIN
  SELECT * INTO row_record
    FROM list_campaign_interests('20000000-0000-0000-0000-000000000001')
   WHERE interest_id = (SELECT interest_id FROM interest_journey);
  IF row_record.sender_display_name <> 'Drew Introducer' THEN
    RAISE EXCEPTION 'inbox missing sender display name, got %', row_record.sender_display_name;
  END IF;
  IF row_record.sender_age < 18 THEN
    RAISE EXCEPTION 'inbox exposed a non-adult age: %', row_record.sender_age;
  END IF;
  IF array_length(row_record.sender_photos, 1) <> 2 THEN
    RAISE EXCEPTION 'inbox expected 2 sender photos';
  END IF;
END;
$$;

SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000003';
DO $$
BEGIN
  BEGIN
    PERFORM * FROM list_campaign_interests('20000000-0000-0000-0000-000000000001');
    RAISE EXCEPTION 'non-owner read the interest inbox';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM = 'non-owner read the interest inbox' THEN
        RAISE;
      END IF;
  END;
END;
$$;

-- 6. Only the owner decides; acceptance opens the intro room via the 0001
--    trigger's validation.
DO $$
BEGIN
  BEGIN
    PERFORM * FROM decide_interest((SELECT interest_id FROM interest_journey), 'accepted');
    RAISE EXCEPTION 'non-owner decided an interest';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM = 'non-owner decided an interest' THEN
        RAISE;
      END IF;
  END;
END;
$$;

SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000002';
DO $$
DECLARE
  room_id UUID;
  room_count INTEGER;
BEGIN
  SELECT intro_room_id INTO room_id
    FROM decide_interest((SELECT interest_id FROM interest_journey), 'accepted');
  IF room_id IS NULL THEN
    RAISE EXCEPTION 'acceptance did not open an intro room';
  END IF;

  SELECT count(*) INTO room_count
    FROM intro_rooms
   WHERE id = room_id
     AND dater_user_id = '00000000-0000-0000-0000-000000000002'
     AND interested_user_id = '00000000-0000-0000-0000-000000000004'
     AND status = 'open';
  IF room_count <> 1 THEN
    RAISE EXCEPTION 'intro room row missing or malformed';
  END IF;

  -- Deciding twice must fail: the interest is no longer 'submitted'.
  BEGIN
    PERFORM * FROM decide_interest((SELECT interest_id FROM interest_journey), 'declined');
    RAISE EXCEPTION 'second decision was accepted';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM = 'second decision was accepted' THEN
        RAISE;
      END IF;
  END;
END;
$$;

-- 7. Decline path: user1 (also has a profile, needs a second photo) submits
--    on the same campaign and gets declined without an intro room.
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000001';
UPDATE dating_profiles
   SET photos = ARRAY['local/alex-1.jpg', 'local/alex-2.jpg']
 WHERE user_id = '00000000-0000-0000-0000-000000000001';

CREATE TEMP TABLE decline_journey (interest_id UUID) ON COMMIT DROP;
GRANT ALL ON decline_journey TO anon, authenticated;
INSERT INTO decline_journey
SELECT interest_id FROM submit_interest('20000000-0000-0000-0000-000000000001');

SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000002';
DO $$
DECLARE
  room_id UUID;
  declined_status interests.status%TYPE;
BEGIN
  SELECT intro_room_id INTO room_id
    FROM decide_interest((SELECT interest_id FROM decline_journey), 'declined');
  IF room_id IS NOT NULL THEN
    RAISE EXCEPTION 'decline unexpectedly opened an intro room';
  END IF;

  SELECT status INTO declined_status
    FROM interests
   WHERE id = (SELECT interest_id FROM decline_journey);
  IF declined_status <> 'declined' THEN
    RAISE EXCEPTION 'expected declined, got %', declined_status;
  END IF;
END;
$$;

ROLLBACK;

SELECT '06_verified_interest.sql passed' AS result;
