-- AUDIT2 REGRESSION: H-1, 감사 §5 "계정 상태 enforcement가 read path에서 불완전하다".
-- Slice 1부터 그린: suspended/deleted 계정은 민감 테이블 SELECT가 0행이 된다.
BEGIN;

DO $$
BEGIN
  IF to_regprocedure('private.account_is_active(uuid)') IS NULL THEN
    RAISE EXCEPTION 'AUDIT2-H1: private.account_is_active(uuid) is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'messages'
       AND policyname = 'messages_active_account_read'
  ) THEN
    RAISE EXCEPTION 'AUDIT2-H1: messages restrictive read policy is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'interests'
       AND policyname = 'interests_active_account_read'
  ) THEN
    RAISE EXCEPTION 'AUDIT2-H1: interests restrictive read policy is missing';
  END IF;
END;
$$;

-- Baseline: the active interested user (…03) can read their interest,
-- room, and messages from seed data.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true);

DO $$
BEGIN
  IF (SELECT count(*) FROM interests
       WHERE sender_user_id = '00000000-0000-0000-0000-000000000003') < 1 THEN
    RAISE EXCEPTION 'AUDIT2-H1: active account lost its interest read';
  END IF;
  IF (SELECT count(*) FROM messages
       WHERE intro_room_id = '40000000-0000-0000-0000-000000000001') < 1 THEN
    RAISE EXCEPTION 'AUDIT2-H1: active account lost its message read';
  END IF;
END;
$$;

RESET ROLE;

-- Suspend the account: every sensitive read must drop to zero rows.
UPDATE users
   SET account_status = 'suspended'
 WHERE id = '00000000-0000-0000-0000-000000000003';

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true);

DO $$
BEGIN
  IF (SELECT count(*) FROM interests) <> 0 THEN
    RAISE EXCEPTION 'AUDIT2-H1: suspended account can still read interests';
  END IF;
  IF (SELECT count(*) FROM messages) <> 0 THEN
    RAISE EXCEPTION 'AUDIT2-H1: suspended account can still read messages';
  END IF;
  IF (SELECT count(*) FROM intro_rooms) <> 0 THEN
    RAISE EXCEPTION 'AUDIT2-H1: suspended account can still read intro rooms';
  END IF;
  IF (SELECT count(*) FROM dating_profiles) <> 0 THEN
    RAISE EXCEPTION 'AUDIT2-H1: suspended account can still read dating profiles';
  END IF;
  IF (SELECT count(*) FROM campaigns) <> 0 THEN
    RAISE EXCEPTION 'AUDIT2-H1: suspended account can still read campaigns';
  END IF;
  -- The account itself stays readable so the client can show the state.
  IF (SELECT count(*) FROM users
       WHERE id = '00000000-0000-0000-0000-000000000003') <> 1 THEN
    RAISE EXCEPTION 'AUDIT2-H1: suspended account cannot see its own users row';
  END IF;
END;
$$;

RESET ROLE;

-- Deleted accounts (deletion requests flip status to deleted immediately)
-- are blocked the same way.
UPDATE users
   SET account_status = 'deleted'
 WHERE id = '00000000-0000-0000-0000-000000000003';

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true);

DO $$
BEGIN
  IF (SELECT count(*) FROM messages) <> 0 THEN
    RAISE EXCEPTION 'AUDIT2-H1: deleted account can still read messages';
  END IF;
END;
$$;

RESET ROLE;

ROLLBACK;
