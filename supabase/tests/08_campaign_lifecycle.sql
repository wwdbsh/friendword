-- Campaign lifecycle: only the owner moves published ⇄ paused → archived
-- through the RPC, and direct client status writes are gone.

BEGIN;

-- 1. Direct status writes are revoked for clients.
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000002';
DO $$
BEGIN
  BEGIN
    UPDATE campaigns SET status = 'paused'
     WHERE id = '20000000-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'direct client status write succeeded';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
    WHEN raise_exception THEN
      IF SQLERRM = 'direct client status write succeeded' THEN
        RAISE;
      END IF;
  END;
END;
$$;

-- 2. A non-owner cannot drive the lifecycle.
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000003';
DO $$
BEGIN
  BEGIN
    PERFORM * FROM set_campaign_status('20000000-0000-0000-0000-000000000001', 'paused');
    RAISE EXCEPTION 'non-owner paused the campaign';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM = 'non-owner paused the campaign' THEN
        RAISE;
      END IF;
  END;
END;
$$;

-- 3. The owner pauses, resumes, and archives; invalid moves fail.
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000002';
DO $$
DECLARE
  new_status TEXT;
BEGIN
  SELECT campaign_status INTO new_status
    FROM set_campaign_status('20000000-0000-0000-0000-000000000001', 'paused');
  IF new_status <> 'paused' THEN
    RAISE EXCEPTION 'pause returned %', new_status;
  END IF;

  SELECT campaign_status INTO new_status
    FROM set_campaign_status('20000000-0000-0000-0000-000000000001', 'published');
  IF new_status <> 'published' THEN
    RAISE EXCEPTION 'resume returned %', new_status;
  END IF;

  SELECT campaign_status INTO new_status
    FROM set_campaign_status('20000000-0000-0000-0000-000000000001', 'archived');
  IF new_status <> 'archived' THEN
    RAISE EXCEPTION 'archive returned %', new_status;
  END IF;

  -- Archived is terminal.
  BEGIN
    PERFORM * FROM set_campaign_status('20000000-0000-0000-0000-000000000001', 'published');
    RAISE EXCEPTION 'archived campaign was republished';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM = 'archived campaign was republished' THEN
        RAISE;
      END IF;
  END;
END;
$$;

-- 4. Archived campaigns stop accepting interest.
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000004';
INSERT INTO dating_profiles (user_id, bio, photos, dating_intent, approximate_location)
VALUES (
  '00000000-0000-0000-0000-000000000004',
  'Weekend hikes and jazz bars.',
  ARRAY['local/drew-1.jpg', 'local/drew-2.jpg'],
  'long-term',
  'Seoul'
);
DO $$
BEGIN
  BEGIN
    PERFORM * FROM submit_interest('20000000-0000-0000-0000-000000000001');
    RAISE EXCEPTION 'interest accepted on an archived campaign';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM = 'interest accepted on an archived campaign' THEN
        RAISE;
      END IF;
  END;
END;
$$;

ROLLBACK;

SELECT '08_campaign_lifecycle.sql passed' AS result;
