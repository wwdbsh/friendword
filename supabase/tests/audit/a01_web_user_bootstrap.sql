-- AUDIT REGRESSION: P0-1, 감사 문서 §5 "신규 웹 사용자".
-- 초기 실패 이유: bootstrap 트리거가 없었으며, 현재는 Slice B의 0011 migration으로 PASS한다.

BEGIN;

INSERT INTO auth.users (id, email)
VALUES ('a0100000-0000-0000-0000-000000000001', 'audit-bootstrap@example.test');
SET CONSTRAINTS ALL IMMEDIATE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.users
     WHERE id = 'a0100000-0000-0000-0000-000000000001'
  ) THEN
    RAISE EXCEPTION 'AUDIT-P01: auth signup did not bootstrap public.users';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
     WHERE user_id = 'a0100000-0000-0000-0000-000000000001'
  ) THEN
    RAISE EXCEPTION 'AUDIT-P01: auth signup did not bootstrap profiles';
  END IF;
END;
$$;

INSERT INTO pitch_drafts (
  id,
  created_by_user_id,
  status,
  headline,
  body
)
VALUES (
  'a0100000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000004',
  'consent_pending',
  'Audit bootstrap pitch',
  'A fresh web user must be able to claim this pitch.'
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'consent_requests'
       AND column_name = 'invite_contact_hash'
  ) THEN
    EXECUTE $sql$
      INSERT INTO consent_requests (
        id,
        pitch_draft_id,
        token_hash,
        invite_contact_channel,
        invite_contact_hash,
        status
      )
      VALUES (
        'a0100000-0000-0000-0000-000000000003',
        'a0100000-0000-0000-0000-000000000002',
        encode(digest('audit-bootstrap-token', 'sha256'), 'hex'),
        'email',
        encode(digest('audit-bootstrap@example.test', 'sha256'), 'hex'),
        'pending'
      )
    $sql$;
  ELSE
    INSERT INTO consent_requests (
      id,
      pitch_draft_id,
      token_hash,
      status
    )
    VALUES (
      'a0100000-0000-0000-0000-000000000003',
      'a0100000-0000-0000-0000-000000000002',
      encode(digest('audit-bootstrap-token', 'sha256'), 'hex'),
      'pending'
    );
  END IF;
END;
$$;

SET LOCAL ROLE authenticated;
DO $$
DECLARE
  claimed_draft UUID;
BEGIN
  PERFORM set_config(
    'request.jwt.claim.sub',
    'a0100000-0000-0000-0000-000000000001',
    true
  );

  SELECT pitch_draft_id INTO claimed_draft
    FROM claim_consent_request('audit-bootstrap-token');

  IF claimed_draft IS DISTINCT FROM 'a0100000-0000-0000-0000-000000000002' THEN
    RAISE EXCEPTION 'AUDIT-P01: bootstrapped user could not claim consent request';
  END IF;
END;
$$;

ROLLBACK;

SELECT 'a01_web_user_bootstrap.sql passed' AS result;
