-- Analytics ingestion: whitelisted names only, size-capped properties,
-- server-stamped user ids, and anonymous events allowed.

BEGIN;

-- 1. Anonymous viewers can log a whitelisted event.
SET LOCAL ROLE anon;
SELECT track_event('pitch_viewed_unique', '{"campaign_slug": "demo", "source": "instagram"}');

-- 2. Unknown event names are rejected.
DO $$
BEGIN
  BEGIN
    PERFORM track_event('made_up_event', '{}');
    RAISE EXCEPTION 'unknown event accepted';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM = 'unknown event accepted' THEN
        RAISE;
      END IF;
  END;
END;
$$;

-- 3. Oversized properties are rejected.
DO $$
BEGIN
  BEGIN
    PERFORM track_event('pitch_viewed_unique',
      jsonb_build_object('padding', repeat('x', 4000)));
    RAISE EXCEPTION 'oversized properties accepted';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM = 'oversized properties accepted' THEN
        RAISE;
      END IF;
  END;
END;
$$;

-- 4. Signed-in events are stamped with the caller's user id.
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000003';
SELECT track_event('interest_submitted', '{"campaign_id": "20000000-0000-0000-0000-000000000001"}');

RESET ROLE;
DO $$
DECLARE
  anon_user UUID;
  signed_user UUID;
BEGIN
  SELECT user_id INTO anon_user
    FROM analytics_events
   WHERE event_name = 'pitch_viewed_unique'
   ORDER BY created_at DESC LIMIT 1;
  IF anon_user IS NOT NULL THEN
    RAISE EXCEPTION 'anonymous event carried a user id';
  END IF;

  SELECT user_id INTO signed_user
    FROM analytics_events
   WHERE event_name = 'interest_submitted'
   ORDER BY created_at DESC LIMIT 1;
  IF signed_user IS DISTINCT FROM '00000000-0000-0000-0000-000000000003' THEN
    RAISE EXCEPTION 'signed-in event missing the caller id, got %', signed_user;
  END IF;
END;
$$;

ROLLBACK;

SELECT '09_analytics.sql passed' AS result;
