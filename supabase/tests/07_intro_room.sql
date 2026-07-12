-- Intro Room journey on the seeded open room 40..01 (dater user2 ↔
-- interested user3): listing, messaging under RLS, blocking, and leaving.

BEGIN;

-- 1. Both participants list the room with the other party's display name;
--    an outsider (user1) sees nothing.
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000002';
DO $$
DECLARE
  room RECORD;
BEGIN
  SELECT * INTO room FROM list_my_intro_rooms() LIMIT 1;
  IF room.room_id IS DISTINCT FROM '40000000-0000-0000-0000-000000000001' THEN
    RAISE EXCEPTION 'dater did not list the seeded room';
  END IF;
  IF room.other_display_name <> 'Casey Interested' THEN
    RAISE EXCEPTION 'dater saw wrong counterpart: %', room.other_display_name;
  END IF;
END;
$$;

SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000001';
DO $$
DECLARE
  room_count INTEGER;
BEGIN
  SELECT count(*) INTO room_count FROM list_my_intro_rooms();
  IF room_count <> 0 THEN
    RAISE EXCEPTION 'outsider listed % intro rooms', room_count;
  END IF;
END;
$$;

-- 2. A participant sends a message; an outsider reads nothing.
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000003';
INSERT INTO messages (intro_room_id, sender_user_id, body)
VALUES (
  '40000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000003',
  'Hi! Great to be introduced.'
);

SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000001';
DO $$
DECLARE
  message_count INTEGER;
BEGIN
  SELECT count(*) INTO message_count
    FROM messages
   WHERE intro_room_id = '40000000-0000-0000-0000-000000000001';
  IF message_count <> 0 THEN
    RAISE EXCEPTION 'outsider read % room messages', message_count;
  END IF;
END;
$$;

-- 3. One party spoofing the sender id is rejected by the insert policy.
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000003';
DO $$
BEGIN
  BEGIN
    INSERT INTO messages (intro_room_id, sender_user_id, body)
    VALUES (
      '40000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000002',
      'spoofed sender'
    );
    RAISE EXCEPTION 'sender spoofing was accepted';
  EXCEPTION
    WHEN insufficient_privilege OR check_violation THEN
      NULL;
    WHEN raise_exception THEN
      IF SQLERRM = 'sender spoofing was accepted' THEN
        RAISE;
      END IF;
  END;
END;
$$;

-- 4. Blocking cuts the room off both ways: the blocked party can no longer
--    message, and neither side lists the room.
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000002';
INSERT INTO blocks (blocker_user_id, blocked_user_id)
VALUES ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000003');

SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000003';
DO $$
BEGIN
  BEGIN
    INSERT INTO messages (intro_room_id, sender_user_id, body)
    VALUES (
      '40000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000003',
      'this must not send'
    );
    RAISE EXCEPTION 'blocked party still sent a message';
  EXCEPTION
    WHEN insufficient_privilege OR check_violation THEN
      NULL;
    WHEN raise_exception THEN
      IF SQLERRM = 'blocked party still sent a message' THEN
        RAISE;
      END IF;
  END;
END;
$$;

DO $$
DECLARE
  room_count INTEGER;
BEGIN
  SELECT count(*) INTO room_count FROM list_my_intro_rooms();
  IF room_count <> 0 THEN
    RAISE EXCEPTION 'blocked party still lists the room';
  END IF;
END;
$$;

-- 5. The blocked party may still file a report about the counterpart.
INSERT INTO reports (reporter_user_id, reported_user_id, campaign_id, reason)
VALUES (
  '00000000-0000-0000-0000-000000000003',
  '00000000-0000-0000-0000-000000000002',
  '20000000-0000-0000-0000-000000000001',
  'test: uncomfortable messages'
);

-- 6. With the block lifted, leaving closes the room and stops messaging.
RESET ROLE;
DELETE FROM blocks
 WHERE blocker_user_id = '00000000-0000-0000-0000-000000000002'
   AND blocked_user_id = '00000000-0000-0000-0000-000000000003';

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000003';
SELECT leave_intro_room('40000000-0000-0000-0000-000000000001');

DO $$
BEGIN
  BEGIN
    PERFORM leave_intro_room('40000000-0000-0000-0000-000000000001');
    RAISE EXCEPTION 'left an already-left room';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM = 'left an already-left room' THEN
        RAISE;
      END IF;
  END;
END;
$$;

SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000002';
DO $$
DECLARE
  room_count INTEGER;
BEGIN
  SELECT count(*) INTO room_count FROM list_my_intro_rooms();
  IF room_count <> 0 THEN
    RAISE EXCEPTION 'left room still listed';
  END IF;

  BEGIN
    INSERT INTO messages (intro_room_id, sender_user_id, body)
    VALUES (
      '40000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000002',
      'room is closed'
    );
    RAISE EXCEPTION 'message sent into a left room';
  EXCEPTION
    WHEN insufficient_privilege OR check_violation THEN
      NULL;
    WHEN raise_exception THEN
      IF SQLERRM = 'message sent into a left room' THEN
        RAISE;
      END IF;
  END;
END;
$$;

ROLLBACK;

SELECT '07_intro_room.sql passed' AS result;
