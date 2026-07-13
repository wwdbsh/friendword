-- AUDIT REGRESSION: 감사 문서 §10, suspended account enforcement.
-- 현재 실패 이유: 주요 RPC와 messages RLS/trigger가 users.account_status를 검사하지 않는다.

BEGIN;

INSERT INTO pitch_drafts (
  id,
  created_by_user_id,
  status,
  headline,
  body
)
VALUES (
  'a1000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000004',
  'draft',
  'Suspended introducer audit',
  'A suspended introducer must not submit this draft.'
);
INSERT INTO auth.users (id, email)
VALUES
  ('a1000000-0000-0000-0000-000000000002', 'audit-suspended@example.test'),
  ('a1000000-0000-0000-0000-000000000003', 'audit-active@example.test');
INSERT INTO users (id, phone_verified_at, account_status)
VALUES
  ('a1000000-0000-0000-0000-000000000002', now(), 'suspended'),
  ('a1000000-0000-0000-0000-000000000003', now(), 'active')
ON CONFLICT (id) DO UPDATE
  SET phone_verified_at = EXCLUDED.phone_verified_at,
      account_status = EXCLUDED.account_status;
INSERT INTO profiles (user_id, display_name, birth_date)
VALUES
  (
    'a1000000-0000-0000-0000-000000000002',
    'Suspended Interest',
    CURRENT_DATE - INTERVAL '25 years'
  ),
  (
    'a1000000-0000-0000-0000-000000000003',
    'Active Interest',
    CURRENT_DATE - INTERVAL '25 years'
  )
ON CONFLICT (user_id) DO NOTHING;
INSERT INTO dating_profiles (user_id, bio, photos, dating_intent)
VALUES
  (
    'a1000000-0000-0000-0000-000000000002',
    'This complete-looking profile belongs to a suspended account.',
    ARRAY[
      'a1000000-0000-0000-0000-000000000002/audit-one.jpg',
      'a1000000-0000-0000-0000-000000000002/audit-two.jpg'
    ],
    'long-term'
  ),
  (
    'a1000000-0000-0000-0000-000000000003',
    'This complete-looking profile is the active control.',
    ARRAY[
      'a1000000-0000-0000-0000-000000000003/audit-one.jpg',
      'a1000000-0000-0000-0000-000000000003/audit-two.jpg'
    ],
    'long-term'
  );
INSERT INTO storage.objects (bucket_id, name, owner_id)
VALUES
  (
    'profile-media',
    'a1000000-0000-0000-0000-000000000002/audit-one.jpg',
    'a1000000-0000-0000-0000-000000000002'
  ),
  (
    'profile-media',
    'a1000000-0000-0000-0000-000000000002/audit-two.jpg',
    'a1000000-0000-0000-0000-000000000002'
  ),
  (
    'profile-media',
    'a1000000-0000-0000-0000-000000000003/audit-one.jpg',
    'a1000000-0000-0000-0000-000000000003'
  ),
  (
    'profile-media',
    'a1000000-0000-0000-0000-000000000003/audit-two.jpg',
    'a1000000-0000-0000-0000-000000000003'
  );
INSERT INTO verification_checks (
  user_id,
  provider,
  provider_reference,
  status,
  verified_at
)
VALUES
  (
    'a1000000-0000-0000-0000-000000000002',
    'audit',
    'audit-account-status-suspended',
    'passed',
    now()
  ),
  (
    'a1000000-0000-0000-0000-000000000003',
    'audit',
    'audit-account-status-active',
    'passed',
    now()
  );
INSERT INTO pitch_drafts (
  id,
  created_by_user_id,
  status,
  headline,
  body
)
VALUES (
  'a1000000-0000-0000-0000-000000000004',
  'a1000000-0000-0000-0000-000000000003',
  'draft',
  'Active account control',
  'This control proves the RPC still accepts an active account.'
);

UPDATE users
   SET account_status = 'suspended'
 WHERE id IN (
   '00000000-0000-0000-0000-000000000002',
   '00000000-0000-0000-0000-000000000004'
 );

SET LOCAL ROLE authenticated;
DO $$
DECLARE
  draft_submit_rejected BOOLEAN := false;
  interest_submit_rejected BOOLEAN := false;
  message_send_rejected BOOLEAN := false;
  active_request UUID;
  active_interest UUID;
  active_message UUID;
BEGIN
  PERFORM set_config(
    'request.jwt.claim.sub',
    'a1000000-0000-0000-0000-000000000003',
    true
  );
  SELECT consent_request_id INTO active_request
    FROM submit_pitch_for_consent('a1000000-0000-0000-0000-000000000004');
  SELECT interest_id INTO active_interest
    FROM submit_interest('20000000-0000-0000-0000-000000000001');
  IF active_request IS NULL OR active_interest IS NULL THEN
    RAISE EXCEPTION 'AUDIT-ACCOUNT-STATUS: active control mutation failed';
  END IF;

  PERFORM set_config(
    'request.jwt.claim.sub',
    '00000000-0000-0000-0000-000000000003',
    true
  );
  INSERT INTO messages (intro_room_id, sender_user_id, body)
  VALUES (
    '40000000-0000-0000-0000-000000000001',
    auth.uid(),
    'Active control message.'
  )
  RETURNING id INTO active_message;
  IF active_message IS NULL THEN
    RAISE EXCEPTION 'AUDIT-ACCOUNT-STATUS: active control message failed';
  END IF;

  PERFORM set_config(
    'request.jwt.claim.sub',
    '00000000-0000-0000-0000-000000000004',
    true
  );
  BEGIN
    PERFORM * FROM submit_pitch_for_consent('a1000000-0000-0000-0000-000000000001');
    RAISE EXCEPTION 'audit_suspended_draft_submit_was_accepted';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM = 'audit_suspended_draft_submit_was_accepted' THEN
        draft_submit_rejected := false;
      ELSIF SQLERRM ~* 'suspend|account.*active' THEN
        draft_submit_rejected := true;
      ELSE
        RAISE;
      END IF;
  END;

  PERFORM set_config(
    'request.jwt.claim.sub',
    'a1000000-0000-0000-0000-000000000002',
    true
  );
  BEGIN
    PERFORM * FROM submit_interest(
      '20000000-0000-0000-0000-000000000001',
      'Suspended accounts cannot submit interest.'
    );
    RAISE EXCEPTION 'audit_suspended_interest_was_accepted';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM = 'audit_suspended_interest_was_accepted' THEN
        interest_submit_rejected := false;
      ELSIF SQLERRM ~* 'suspend|account.*active' THEN
        interest_submit_rejected := true;
      ELSE
        RAISE;
      END IF;
  END;

  PERFORM set_config(
    'request.jwt.claim.sub',
    '00000000-0000-0000-0000-000000000002',
    true
  );
  BEGIN
    INSERT INTO messages (intro_room_id, sender_user_id, body)
    VALUES (
      '40000000-0000-0000-0000-000000000001',
      auth.uid(),
      'Suspended accounts cannot send chat messages.'
    );
    RAISE EXCEPTION 'audit_suspended_message_was_accepted';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM = 'audit_suspended_message_was_accepted' THEN
        message_send_rejected := false;
      ELSIF SQLERRM ~* 'suspend|account.*active' THEN
        message_send_rejected := true;
      ELSE
        RAISE;
      END IF;
    WHEN insufficient_privilege THEN
      message_send_rejected := true;
  END;

  IF NOT draft_submit_rejected THEN
    RAISE EXCEPTION 'AUDIT-ACCOUNT-STATUS: suspended user submitted a draft';
  END IF;
  IF NOT interest_submit_rejected THEN
    RAISE EXCEPTION 'AUDIT-ACCOUNT-STATUS: suspended user submitted interest';
  END IF;
  IF NOT message_send_rejected THEN
    RAISE EXCEPTION 'AUDIT-ACCOUNT-STATUS: suspended user sent a chat message';
  END IF;
END;
$$;

ROLLBACK;

SELECT 'a10_account_status_enforcement.sql passed' AS result;
