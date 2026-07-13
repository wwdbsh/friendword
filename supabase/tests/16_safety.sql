BEGIN;

INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
VALUES
  (
    'profile-media',
    '00000000-0000-0000-0000-000000000003/safety-a.jpg',
    '00000000-0000-0000-0000-000000000003',
    '{"mimetype":"image/jpeg"}'::JSONB
  ),
  (
    'profile-media',
    '00000000-0000-0000-0000-000000000003/safety-b.jpg',
    '00000000-0000-0000-0000-000000000003',
    '{"mimetype":"image/webp"}'::JSONB
  );

UPDATE dating_profiles
   SET photos = ARRAY[
     'profile-media/00000000-0000-0000-0000-000000000003/safety-a.jpg',
     'profile-media/00000000-0000-0000-0000-000000000003/safety-b.jpg'
   ]
 WHERE user_id = '00000000-0000-0000-0000-000000000003';

UPDATE interests
   SET status = 'withdrawn'
 WHERE id = '30000000-0000-0000-0000-000000000001';

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true);

DO $$
DECLARE
  submitted_status TEXT;
BEGIN
  SELECT interest_status INTO submitted_status
    FROM submit_interest('20000000-0000-0000-0000-000000000001', 'validation off');
  IF submitted_status IS DISTINCT FROM 'submitted' THEN
    RAISE EXCEPTION 'media enforcement off changed existing interest behavior';
  END IF;
END;
$$;

RESET ROLE;
UPDATE interests
   SET status = 'withdrawn'
 WHERE id = '30000000-0000-0000-0000-000000000001';
UPDATE app_config SET value = 'on' WHERE key = 'media_validation_enforcement';

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true);

DO $$
BEGIN
  BEGIN
    PERFORM * FROM submit_interest('20000000-0000-0000-0000-000000000001', 'missing validation');
    RAISE EXCEPTION 'interest accepted profile photos without validation';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM = 'interest accepted profile photos without validation' THEN
        RAISE;
      END IF;
  END;
END;
$$;

RESET ROLE;
SET LOCAL ROLE service_role;
INSERT INTO media_validations (
  bucket_id,
  object_name,
  validated_at,
  mime_ok,
  magic_ok,
  size_ok,
  decode_ok,
  moderation_status
)
VALUES
  (
    'profile-media',
    '00000000-0000-0000-0000-000000000003/safety-a.jpg',
    now(),
    true,
    true,
    true,
    true,
    'skipped'
  ),
  (
    'profile-media',
    '00000000-0000-0000-0000-000000000003/safety-b.jpg',
    now(),
    true,
    true,
    true,
    true,
    'passed'
  );

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true);

DO $$
BEGIN
  BEGIN
    PERFORM * FROM submit_interest('20000000-0000-0000-0000-000000000001', 'skipped moderation');
    RAISE EXCEPTION 'interest accepted skipped moderation';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM = 'interest accepted skipped moderation' THEN
        RAISE;
      END IF;
  END;
END;
$$;

RESET ROLE;
SET LOCAL ROLE service_role;
UPDATE media_validations
   SET moderation_status = 'passed'
 WHERE bucket_id = 'profile-media'
   AND object_name = '00000000-0000-0000-0000-000000000003/safety-a.jpg';

-- Slice 2 text gates (0026): the enforcement-on success path also needs
-- passed verdicts for the sender's bio and the interest note.
INSERT INTO text_moderations (scope, content_hash, moderation_status)
VALUES
  ('profile_bio', encode(digest('Museum fan and weekend cyclist.', 'sha256'), 'hex'), 'passed'),
  ('interest_note', encode(digest('validated profile', 'sha256'), 'hex'), 'passed')
ON CONFLICT (scope, content_hash) DO NOTHING;

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true);

DO $$
DECLARE
  submitted_status TEXT;
BEGIN
  SELECT interest_status INTO submitted_status
    FROM submit_interest('20000000-0000-0000-0000-000000000001', 'validated profile');
  IF submitted_status IS DISTINCT FROM 'submitted' THEN
    RAISE EXCEPTION 'validated profile photos did not permit interest';
  END IF;
END;
$$;

RESET ROLE;
INSERT INTO pitch_drafts (
  id,
  created_by_user_id,
  status,
  headline,
  body
)
VALUES
  (
    '16000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000004',
    'draft',
    'Safety off fixture',
    'This draft proves enforcement off preserves the existing path.'
  ),
  (
    '16000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000004',
    'draft',
    'Safety on fixture',
    'This draft proves validation is required when enforcement is on.'
  );

INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
VALUES
  (
    'pitch-media',
    '16000000-0000-0000-0000-000000000001/photo.jpg',
    '00000000-0000-0000-0000-000000000004',
    '{"mimetype":"image/jpeg"}'::JSONB
  ),
  (
    'pitch-media',
    '16000000-0000-0000-0000-000000000002/photo.jpg',
    '00000000-0000-0000-0000-000000000004',
    '{"mimetype":"image/jpeg"}'::JSONB
  );

INSERT INTO pitch_assets (pitch_draft_id, uploaded_by_user_id, asset_type, storage_path)
VALUES
  (
    '16000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000004',
    'photo',
    'pitch-media/16000000-0000-0000-0000-000000000001/photo.jpg'
  ),
  (
    '16000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000004',
    'photo',
    'pitch-media/16000000-0000-0000-0000-000000000002/photo.jpg'
  );

UPDATE app_config SET value = 'off' WHERE key = 'media_validation_enforcement';

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);

DO $$
DECLARE
  request_id UUID;
BEGIN
  SELECT consent_request_id INTO request_id
    FROM submit_pitch_for_consent('16000000-0000-0000-0000-000000000001', 'email', 'dater@example.test', 'Blair');
  IF request_id IS NULL THEN
    RAISE EXCEPTION 'media enforcement off changed existing finalize behavior';
  END IF;
END;
$$;

RESET ROLE;
UPDATE app_config SET value = 'on' WHERE key = 'media_validation_enforcement';

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);

DO $$
BEGIN
  BEGIN
    PERFORM * FROM submit_pitch_for_consent('16000000-0000-0000-0000-000000000002', 'email', 'dater@example.test', 'Blair');
    RAISE EXCEPTION 'finalize accepted pitch media without validation';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM = 'finalize accepted pitch media without validation' THEN
        RAISE;
      END IF;
  END;
END;
$$;

RESET ROLE;
SET LOCAL ROLE service_role;
INSERT INTO media_validations (
  bucket_id,
  object_name,
  validated_at,
  mime_ok,
  magic_ok,
  size_ok,
  decode_ok,
  moderation_status
)
VALUES (
  'pitch-media',
  '16000000-0000-0000-0000-000000000002/photo.jpg',
  now(),
  true,
  true,
  true,
  true,
  'skipped'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);

DO $$
BEGIN
  BEGIN
    PERFORM * FROM submit_pitch_for_consent('16000000-0000-0000-0000-000000000002', 'email', 'dater@example.test', 'Blair');
    RAISE EXCEPTION 'finalize accepted skipped pitch moderation';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM = 'finalize accepted skipped pitch moderation' THEN
        RAISE;
      END IF;
  END;
END;
$$;

RESET ROLE;
SET LOCAL ROLE service_role;
UPDATE media_validations
   SET moderation_status = 'passed'
 WHERE bucket_id = 'pitch-media'
   AND object_name = '16000000-0000-0000-0000-000000000002/photo.jpg';

INSERT INTO text_moderations (scope, content_hash, moderation_status)
VALUES (
  'pitch_content',
  encode(digest(
    'Safety on fixture' || E'\n\n' || 'This draft proves validation is required when enforcement is on.',
    'sha256'
  ), 'hex'),
  'passed'
)
ON CONFLICT (scope, content_hash) DO NOTHING;

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);

DO $$
DECLARE
  request_id UUID;
BEGIN
  SELECT consent_request_id INTO request_id
    FROM submit_pitch_for_consent('16000000-0000-0000-0000-000000000002', 'email', 'dater@example.test', 'Blair');
  IF request_id IS NULL THEN
    RAISE EXCEPTION 'validated pitch media did not permit finalize';
  END IF;
END;
$$;

DO $$
BEGIN
  BEGIN
    INSERT INTO media_validations (
      bucket_id,
      object_name,
      validated_at,
      mime_ok,
      magic_ok,
      size_ok,
      decode_ok,
      moderation_status
    )
    VALUES ('pitch-media', 'forbidden.jpg', now(), true, true, true, true, 'passed');
    RAISE EXCEPTION 'authenticated user wrote media validation';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;

RESET ROLE;
INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
VALUES (
  'pitch-media',
  '10000000-0000-0000-0000-000000000001/safety-owner-transfer.jpg',
  '00000000-0000-0000-0000-000000000001',
  '{"mimetype":"image/jpeg"}'::JSONB
);

SET LOCAL ROLE service_role;
SELECT reassign_pitch_storage_owner(
  '10000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002'
);

DO $$
BEGIN
  BEGIN
    PERFORM reassign_pitch_storage_owner(
      '10000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000003'
    );
    RAISE EXCEPTION 'storage ownership accepted a non-owner target';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM = 'storage ownership accepted a non-owner target' THEN
        RAISE;
      END IF;
  END;
END;
$$;

RESET ROLE;
DO $$
BEGIN
  IF (
    SELECT owner_id
      FROM storage.objects
     WHERE bucket_id = 'pitch-media'
       AND name = '10000000-0000-0000-0000-000000000001/safety-owner-transfer.jpg'
  ) IS DISTINCT FROM '00000000-0000-0000-0000-000000000002' THEN
    RAISE EXCEPTION 'shared campaign storage ownership was not reassigned';
  END IF;
END;
$$;

SET LOCAL ROLE service_role;

DO $$
BEGIN
  IF to_regprocedure('public.erase_pitch_draft(uuid)') IS NULL THEN
    DELETE FROM consent_requests
     WHERE pitch_draft_id = '16000000-0000-0000-0000-000000000001';
    DELETE FROM pitch_drafts
     WHERE id = '16000000-0000-0000-0000-000000000001';
  ELSE
    PERFORM erase_pitch_draft('16000000-0000-0000-0000-000000000001');
  END IF;

  IF EXISTS (
    SELECT 1
      FROM consent_revisions
     WHERE pitch_draft_id = '16000000-0000-0000-0000-000000000001'
  ) THEN
    RAISE EXCEPTION 'service-role draft erasure retained immutable consent revisions';
  END IF;
END;
$$;

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);

DO $$
BEGIN
  BEGIN
    INSERT INTO reports (
      reporter_user_id,
      reported_user_id,
      campaign_id,
      reason
    )
    VALUES (
      auth.uid(),
      '00000000-0000-0000-0000-000000000002',
      '20000000-0000-0000-0000-000000000001',
      'spam'
    );
    RAISE EXCEPTION 'unrelated user inserted a legacy room report';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;

SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true);

DO $$
DECLARE
  campaign_report UUID;
  interest_report UUID;
  room_report UUID;
  message_report UUID;
BEGIN
  campaign_report := report_content(
    'campaign',
    '20000000-0000-0000-0000-000000000001',
    'spam',
    'Campaign report detail'
  );
  message_report := report_content(
    'message',
    '50000000-0000-0000-0000-000000000001',
    'harassment',
    'Message report detail'
  );

  IF campaign_report IS NULL OR message_report IS NULL THEN
    RAISE EXCEPTION 'campaign or message report returned no id';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
  interest_report := report_content(
    'interest',
    '30000000-0000-0000-0000-000000000001',
    'other',
    'Interest report detail'
  );
  room_report := report_content(
    'intro_room',
    '40000000-0000-0000-0000-000000000001',
    'other',
    'Room report detail'
  );

  IF interest_report IS NULL OR room_report IS NULL THEN
    RAISE EXCEPTION 'interest or intro room report returned no id';
  END IF;
END;
$$;

DO $$
BEGIN
  BEGIN
    PERFORM report_content(
      'campaign',
      'ffffffff-ffff-ffff-ffff-ffffffffffff',
      'spam',
      NULL
    );
    RAISE EXCEPTION 'nonexistent report target accepted';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM = 'nonexistent report target accepted' THEN
        RAISE;
      END IF;
  END;
END;
$$;

RESET ROLE;
UPDATE users
   SET account_status = 'suspended'
 WHERE id = '00000000-0000-0000-0000-000000000004';

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);

DO $$
BEGIN
  BEGIN
    PERFORM report_content(
      'campaign',
      '20000000-0000-0000-0000-000000000001',
      'spam',
      NULL
    );
    RAISE EXCEPTION 'suspended account submitted report';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM = 'suspended account submitted report' THEN
        RAISE;
      END IF;
  END;
END;
$$;

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
SELECT report_content(
  'campaign',
  '20000000-0000-0000-0000-000000000001',
  'safety_risk',
  'First high-severity report'
);

DO $$
BEGIN
  IF (SELECT status FROM campaigns WHERE id = '20000000-0000-0000-0000-000000000001') <> 'published' THEN
    RAISE EXCEPTION 'one high-severity report paused campaign';
  END IF;
END;
$$;

SELECT report_content(
  'campaign',
  '20000000-0000-0000-0000-000000000001',
  'impersonation',
  'Same reporter duplicate'
);

DO $$
BEGIN
  IF (SELECT status FROM campaigns WHERE id = '20000000-0000-0000-0000-000000000001') <> 'published' THEN
    RAISE EXCEPTION 'duplicate high-severity reports from one account paused campaign';
  END IF;
END;
$$;

SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true);
SELECT report_content(
  'campaign',
  '20000000-0000-0000-0000-000000000001',
  'minor',
  'Second distinct high-severity reporter'
);

RESET ROLE;
DO $$
BEGIN
  IF (SELECT status FROM campaigns WHERE id = '20000000-0000-0000-0000-000000000001') <> 'paused' THEN
    RAISE EXCEPTION 'two high-severity reports did not pause campaign';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM ops_alerts
     WHERE campaign_id = '20000000-0000-0000-0000-000000000001'
       AND alert_type = 'campaign_auto_paused'
  ) THEN
    RAISE EXCEPTION 'campaign auto-pause did not create ops alert';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM reports
     WHERE reason IN ('spam', 'harassment', 'other')
       AND severity <> 'low'
  ) THEN
    RAISE EXCEPTION 'low-severity reason was promoted';
  END IF;
END;
$$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);

DO $$
DECLARE
  first_request_id UUID;
  second_request_id UUID;
BEGIN
  SELECT deletion_request_id INTO first_request_id FROM request_account_deletion();
  SELECT deletion_request_id INTO second_request_id FROM request_account_deletion();

  IF first_request_id IS NULL OR second_request_id IS DISTINCT FROM first_request_id THEN
    RAISE EXCEPTION 'account deletion request was not idempotent';
  END IF;
  IF (SELECT account_status FROM users WHERE id = auth.uid()) <> 'deleted' THEN
    RAISE EXCEPTION 'account deletion did not mark account deleted';
  END IF;

  BEGIN
    PERFORM report_content(
      'campaign',
      '20000000-0000-0000-0000-000000000001',
      'spam',
      NULL
    );
    RAISE EXCEPTION 'deleted account used active-account RPC';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM = 'deleted account used active-account RPC' THEN
        RAISE;
      END IF;
  END;

  BEGIN
    UPDATE profiles
       SET display_name = display_name
     WHERE user_id = auth.uid();
    RAISE EXCEPTION 'deleted account mutated profile directly';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM = 'deleted account mutated profile directly' THEN
        RAISE;
      END IF;
  END;

  BEGIN
    INSERT INTO blocks (blocker_user_id, blocked_user_id)
    VALUES (auth.uid(), '00000000-0000-0000-0000-000000000001');
    RAISE EXCEPTION 'deleted account inserted block directly';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM = 'deleted account inserted block directly' THEN
        RAISE;
      END IF;
  END;

  BEGIN
    INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
    VALUES (
      'profile-media',
      auth.uid()::TEXT || '/after-deletion.jpg',
      auth.uid(),
      '{"mimetype":"image/jpeg"}'::JSONB
    );
    RAISE EXCEPTION 'deleted account uploaded profile media';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;

RESET ROLE;
DO $$
BEGIN
  IF (SELECT count(*) FROM deletion_requests WHERE user_id = '00000000-0000-0000-0000-000000000004') <> 1 THEN
    RAISE EXCEPTION 'account deletion created duplicate queue rows';
  END IF;
END;
$$;

ROLLBACK;

SELECT '16_safety.sql passed' AS result;
