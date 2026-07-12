DO $$
DECLARE
  bucket_is_public BOOLEAN;
BEGIN
  SELECT public
    INTO bucket_is_public
    FROM storage.buckets
   WHERE id = 'pitch-media';

  IF bucket_is_public IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'pitch-media bucket is missing or public';
  END IF;
END;
$$;

INSERT INTO storage.objects (bucket_id, name, owner_id)
VALUES (
  'pitch-media',
  '10000000-0000-0000-0000-000000000002/seeded-voice.m4a',
  '00000000-0000-0000-0000-000000000004'
);

INSERT INTO storage.buckets (id, name, public)
VALUES ('other-private', 'other-private', false);

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000004';
DO $$
DECLARE
  visible_count INTEGER;
  invalid_name TEXT;
BEGIN
  INSERT INTO storage.objects (bucket_id, name, owner_id)
  VALUES (
    'pitch-media',
    '10000000-0000-0000-0000-000000000002/creator-upload.m4a',
    auth.uid()::TEXT
  );

  SELECT count(*) INTO visible_count
    FROM storage.objects
   WHERE bucket_id = 'pitch-media';
  IF visible_count <> 2 THEN
    RAISE EXCEPTION 'pitch creator cannot insert and select pitch media';
  END IF;

  BEGIN
    INSERT INTO storage.objects (bucket_id, name, owner_id)
    VALUES (
      'pitch-media',
      '10000000-0000-0000-0000-000000000001/other-creator-upload.m4a',
      auth.uid()::TEXT
    );
    RAISE EXCEPTION 'creator can upload to another creator pitch path';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    INSERT INTO storage.objects (bucket_id, name, owner_id)
    VALUES (
      'other-private',
      '10000000-0000-0000-0000-000000000002/wrong-bucket.m4a',
      auth.uid()::TEXT
    );
    RAISE EXCEPTION 'creator can upload pitch media to another bucket';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;

  FOREACH invalid_name IN ARRAY ARRAY[
    'not-a-uuid/file.m4a',
    '10000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000002/extra/file.m4a',
    '10000000-0000-0000-0000-000000000002/..'
  ]
  LOOP
    BEGIN
      INSERT INTO storage.objects (bucket_id, name, owner_id)
      VALUES ('pitch-media', invalid_name, auth.uid()::TEXT);
      RAISE EXCEPTION 'creator can upload malformed object name %', invalid_name;
    EXCEPTION
      WHEN insufficient_privilege THEN NULL;
    END;
  END LOOP;
END;
$$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000001';
DO $$
DECLARE
  visible_count INTEGER;
BEGIN
  SELECT count(*) INTO visible_count
    FROM storage.objects
   WHERE bucket_id = 'pitch-media';
  IF visible_count <> 1 THEN
    RAISE EXCEPTION 'pitch subject cannot select pitch media';
  END IF;

  BEGIN
    INSERT INTO storage.objects (bucket_id, name, owner_id)
    VALUES (
      'pitch-media',
      '10000000-0000-0000-0000-000000000002/subject-upload.m4a',
      auth.uid()::TEXT
    );
    RAISE EXCEPTION 'pitch subject can upload creator-owned pitch media';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    INSERT INTO storage.objects (bucket_id, name, owner_id)
    VALUES (
      'pitch-media',
      '10000000-0000-0000-0000-000000000001/published-upload.m4a',
      auth.uid()::TEXT
    );
    RAISE EXCEPTION 'creator can upload media after pitch publication';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000003';
DO $$
DECLARE
  visible_count INTEGER;
BEGIN
  SELECT count(*) INTO visible_count
    FROM storage.objects
   WHERE bucket_id = 'pitch-media';
  IF visible_count <> 0 THEN
    RAISE EXCEPTION 'unrelated user can select pitch media';
  END IF;

  BEGIN
    INSERT INTO storage.objects (bucket_id, name, owner_id)
    VALUES (
      'pitch-media',
      '10000000-0000-0000-0000-000000000002/unrelated-upload.m4a',
      auth.uid()::TEXT
    );
    RAISE EXCEPTION 'unrelated user can insert pitch media';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000004';
DO $$
DECLARE
  affected_count INTEGER;
BEGIN
  INSERT INTO pitch_drafts (
    created_by_user_id,
    relationship_type,
    relationship_duration
  )
  VALUES (auth.uid(), 'coworker', 'y1to3');
  GET DIAGNOSTICS affected_count = ROW_COUNT;
  IF affected_count <> 1 THEN
    RAISE EXCEPTION 'creator cannot insert draft relationship context';
  END IF;

  UPDATE pitch_drafts
     SET relationship_type = 'family', relationship_duration = 'gt10y'
   WHERE id = '10000000-0000-0000-0000-000000000002';
  GET DIAGNOSTICS affected_count = ROW_COUNT;
  IF affected_count <> 1 THEN
    RAISE EXCEPTION 'creator cannot update draft relationship context';
  END IF;

  BEGIN
    UPDATE pitch_drafts
       SET status = 'consent_pending'
     WHERE id = '10000000-0000-0000-0000-000000000002';
    RAISE EXCEPTION 'creator can directly change server-owned draft status';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    UPDATE pitch_drafts
       SET subject_user_id = '00000000-0000-0000-0000-000000000003'
     WHERE id = '10000000-0000-0000-0000-000000000002';
    RAISE EXCEPTION 'creator can directly change server-owned draft subject';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    INSERT INTO pitch_drafts (created_by_user_id, status)
    VALUES (auth.uid(), 'approved');
    RAISE EXCEPTION 'creator can insert a draft with server-owned status';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000001';
DO $$
DECLARE
  affected_count INTEGER;
BEGIN
  UPDATE pitch_drafts
     SET relationship_type = 'friend', relationship_duration = 'lt1y'
   WHERE id = '10000000-0000-0000-0000-000000000002';
  GET DIAGNOSTICS affected_count = ROW_COUNT;
  IF affected_count <> 0 THEN
    RAISE EXCEPTION 'pitch subject can update creator relationship context';
  END IF;
END;
$$;
ROLLBACK;

SELECT '03_storage.sql passed' AS result;
