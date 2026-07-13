-- AUDIT REGRESSION: P0-8, 감사 문서 §5 "Verified Interest 서버 증거".
-- 현재 실패 이유: 과거 birth_date와 photos 문자열 배열 길이만으로 submit_interest가 성공한다.

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.app_config') IS NULL THEN
    RAISE EXCEPTION 'AUDIT-P08: identity enforcement config is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'storage'
       AND table_name = 'objects'
       AND column_name = 'metadata'
  ) THEN
    RAISE EXCEPTION 'AUDIT-P08: storage object evidence metadata is missing';
  END IF;
END;
$$;

UPDATE app_config SET value = 'on' WHERE key = 'identity_enforcement';

INSERT INTO auth.users (id, email)
VALUES
  ('a0800000-0000-0000-0000-000000000001', 'audit-storage@example.test'),
  ('a0800000-0000-0000-0000-000000000002', 'audit-phone@example.test'),
  ('a0800000-0000-0000-0000-000000000003', 'audit-verification@example.test'),
  ('a0800000-0000-0000-0000-000000000004', 'audit-valid@example.test');
INSERT INTO users (id, phone_verified_at)
VALUES
  ('a0800000-0000-0000-0000-000000000001', now()),
  ('a0800000-0000-0000-0000-000000000002', NULL),
  ('a0800000-0000-0000-0000-000000000003', now()),
  ('a0800000-0000-0000-0000-000000000004', now())
ON CONFLICT (id) DO UPDATE SET phone_verified_at = EXCLUDED.phone_verified_at;
INSERT INTO profiles (user_id, display_name, birth_date)
VALUES
  ('a0800000-0000-0000-0000-000000000001', 'Audit Storage', CURRENT_DATE - INTERVAL '25 years'),
  ('a0800000-0000-0000-0000-000000000002', 'Audit Phone', CURRENT_DATE - INTERVAL '25 years'),
  ('a0800000-0000-0000-0000-000000000003', 'Audit Verification', CURRENT_DATE - INTERVAL '25 years'),
  ('a0800000-0000-0000-0000-000000000004', 'Audit Valid', CURRENT_DATE - INTERVAL '25 years')
ON CONFLICT (user_id) DO UPDATE
  SET birth_date = EXCLUDED.birth_date;
INSERT INTO dating_profiles (user_id, bio, photos, dating_intent)
VALUES
  (
    'a0800000-0000-0000-0000-000000000001',
    'This profile has arbitrary strings instead of storage evidence.',
    ARRAY['not-a-storage-object-one', 'not-a-storage-object-two'],
    'long-term'
  ),
  (
    'a0800000-0000-0000-0000-000000000002',
    'This profile has photos and verification but no verified phone.',
    ARRAY[
      'a0800000-0000-0000-0000-000000000002/one.jpg',
      'a0800000-0000-0000-0000-000000000002/two.jpg'
    ],
    'long-term'
  ),
  (
    'a0800000-0000-0000-0000-000000000003',
    'This profile has photos and phone but no provider verification.',
    ARRAY[
      'a0800000-0000-0000-0000-000000000003/one.jpg',
      'a0800000-0000-0000-0000-000000000003/two.jpg'
    ],
    'long-term'
  ),
  (
    'a0800000-0000-0000-0000-000000000004',
    'This positive control has every required server-owned evidence.',
    ARRAY[
      'a0800000-0000-0000-0000-000000000004/one.jpg',
      'a0800000-0000-0000-0000-000000000004/two.jpg'
    ],
    'long-term'
  );

INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
VALUES
  ('profile-media', 'a0800000-0000-0000-0000-000000000002/one.jpg', 'a0800000-0000-0000-0000-000000000002', '{"mimetype":"image/jpeg"}'),
  ('profile-media', 'a0800000-0000-0000-0000-000000000002/two.jpg', 'a0800000-0000-0000-0000-000000000002', '{"mimetype":"image/jpeg"}'),
  ('profile-media', 'a0800000-0000-0000-0000-000000000003/one.jpg', 'a0800000-0000-0000-0000-000000000003', '{"mimetype":"image/jpeg"}'),
  ('profile-media', 'a0800000-0000-0000-0000-000000000003/two.jpg', 'a0800000-0000-0000-0000-000000000003', '{"mimetype":"image/jpeg"}'),
  ('profile-media', 'a0800000-0000-0000-0000-000000000004/one.jpg', 'a0800000-0000-0000-0000-000000000004', '{"mimetype":"image/jpeg"}'),
  ('profile-media', 'a0800000-0000-0000-0000-000000000004/two.jpg', 'a0800000-0000-0000-0000-000000000004', '{"mimetype":"image/jpeg"}');

INSERT INTO verification_checks (user_id, provider, provider_reference, status, verified_at)
VALUES
  ('a0800000-0000-0000-0000-000000000001', 'audit', 'audit-p08-storage', 'passed', now()),
  ('a0800000-0000-0000-0000-000000000002', 'audit', 'audit-p08-phone', 'passed', now()),
  ('a0800000-0000-0000-0000-000000000004', 'audit', 'audit-p08-valid', 'passed', now());

SET LOCAL ROLE authenticated;
DO $$
DECLARE
  storage_rejected BOOLEAN := false;
  phone_rejected BOOLEAN := false;
  verification_rejected BOOLEAN := false;
  valid_interest UUID;
BEGIN
  PERFORM set_config(
    'request.jwt.claim.sub',
    'a0800000-0000-0000-0000-000000000001',
    true
  );
  BEGIN
    PERFORM * FROM submit_interest(
      '20000000-0000-0000-0000-000000000001',
      'Missing storage evidence must be rejected.'
    );
    RAISE EXCEPTION 'audit_unverified_interest_was_accepted';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM = 'audit_unverified_interest_was_accepted' THEN
        storage_rejected := false;
      ELSIF SQLERRM ~* 'storage|photo' THEN
        storage_rejected := true;
      ELSE
        RAISE;
      END IF;
  END;

  IF NOT storage_rejected THEN
    RAISE EXCEPTION 'AUDIT-P08: arbitrary photo strings and self-asserted DOB passed submit_interest';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', 'a0800000-0000-0000-0000-000000000002', true);
  BEGIN
    PERFORM * FROM submit_interest('20000000-0000-0000-0000-000000000001');
    RAISE EXCEPTION 'audit_unverified_phone_was_accepted';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM = 'audit_unverified_phone_was_accepted' THEN
        phone_rejected := false;
      ELSIF SQLERRM ~* 'phone' THEN
        phone_rejected := true;
      ELSE
        RAISE;
      END IF;
  END;
  IF NOT phone_rejected THEN
    RAISE EXCEPTION 'AUDIT-P08: interest without verified phone was accepted';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', 'a0800000-0000-0000-0000-000000000003', true);
  BEGIN
    PERFORM * FROM submit_interest('20000000-0000-0000-0000-000000000001');
    RAISE EXCEPTION 'audit_provider_verification_was_accepted';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM = 'audit_provider_verification_was_accepted' THEN
        verification_rejected := false;
      ELSIF SQLERRM ~* 'verification' THEN
        verification_rejected := true;
      ELSE
        RAISE;
      END IF;
  END;
  IF NOT verification_rejected THEN
    RAISE EXCEPTION 'AUDIT-P08: interest without provider verification was accepted';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', 'a0800000-0000-0000-0000-000000000004', true);
  SELECT interest_id INTO valid_interest
    FROM submit_interest('20000000-0000-0000-0000-000000000001');
  IF valid_interest IS NULL THEN
    RAISE EXCEPTION 'AUDIT-P08: valid server-owned evidence did not submit interest';
  END IF;
END;
$$;

ROLLBACK;

SELECT 'a08_verified_interest_evidence.sql passed' AS result;
