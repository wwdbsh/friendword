-- Slice 2: UGC length/rate limits and per-prefix Storage quotas.
BEGIN;

CREATE FUNCTION pg_temp.expect_check_violation(statement TEXT, label TEXT)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  EXECUTE statement;
  RAISE EXCEPTION '% was accepted', label;
EXCEPTION
  WHEN check_violation THEN NULL;
END;
$$;

SELECT pg_temp.expect_check_violation(
  $sql$UPDATE public.pitch_drafts
          SET headline = repeat('h', 121)
        WHERE id = '10000000-0000-0000-0000-000000000002'$sql$,
  '121-character pitch headline'
);
SELECT pg_temp.expect_check_violation(
  $sql$UPDATE public.pitch_drafts
          SET body = repeat('b', 2001)
        WHERE id = '10000000-0000-0000-0000-000000000002'$sql$,
  '2001-character pitch body'
);
SELECT pg_temp.expect_check_violation(
  $sql$UPDATE public.dating_profiles
          SET bio = repeat('b', 501)
        WHERE user_id = '00000000-0000-0000-0000-000000000003'$sql$,
  '501-character dating bio'
);
SELECT pg_temp.expect_check_violation(
  $sql$UPDATE public.interests
          SET note = repeat('n', 501)
        WHERE id = '30000000-0000-0000-0000-000000000001'$sql$,
  '501-character interest note'
);
SELECT pg_temp.expect_check_violation(
  $sql$UPDATE public.messages
          SET body = repeat('m', 2001)
        WHERE id = '50000000-0000-0000-0000-000000000001'$sql$,
  '2001-character message body'
);
SELECT pg_temp.expect_check_violation(
  $sql$UPDATE public.profiles
          SET display_name = repeat('d', 61)
        WHERE user_id = '00000000-0000-0000-0000-000000000003'$sql$,
  '61-character display name'
);

INSERT INTO public.messages (intro_room_id, sender_user_id, body)
SELECT
  '40000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000003',
  'rate-limit message ' || sequence_number
FROM generate_series(1, 20) AS sequence_number;

DO $$
BEGIN
  BEGIN
    INSERT INTO public.messages (intro_room_id, sender_user_id, body)
    VALUES (
      '40000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000003',
      'twenty-first message'
    );
    RAISE EXCEPTION 'twenty-first message was accepted';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM = 'twenty-first message was accepted' THEN
        RAISE;
      END IF;
      IF SQLERRM <> 'sending too fast — wait a moment' THEN
        RAISE;
      END IF;
  END;
END;
$$;

UPDATE public.messages
   SET created_at = now() - INTERVAL '61 seconds'
 WHERE intro_room_id = '40000000-0000-0000-0000-000000000001'
   AND sender_user_id = '00000000-0000-0000-0000-000000000003'
   AND body LIKE 'rate-limit message %';

INSERT INTO public.messages (intro_room_id, sender_user_id, body)
VALUES (
  '40000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000003',
  'allowed after the rolling window'
);

INSERT INTO public.pitch_drafts (
  id, created_by_user_id, status, headline, body
) VALUES (
  '18000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000004',
  'draft',
  'Storage quota fixture',
  'The twenty-first object in one draft prefix must be rejected.'
);

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000004';

-- 0050 raised the pitch-media prefix ceiling from 12 to 20 because ingest puts
-- DERIVATIVES in the same prefix and private.pitch_media_object_count counts
-- them: voice 1 + photos 4 + proxies 3 + posters 3 + blur variants 3 = 14 in the
-- steady state, plus the three originals that exist between registration and
-- ingest success = 17 at the transitional peak. The profile-media ceiling below
-- is untouched at 12 — nothing derives from a profile photo.
INSERT INTO storage.objects (bucket_id, name, owner_id)
SELECT
  'pitch-media',
  '18000000-0000-0000-0000-000000000002/quota-' || sequence_number || '.jpg',
  auth.uid()::TEXT
FROM generate_series(1, 20) AS sequence_number;

DO $$
BEGIN
  BEGIN
    INSERT INTO storage.objects (bucket_id, name, owner_id)
    VALUES (
      'pitch-media',
      '18000000-0000-0000-0000-000000000002/quota-21.jpg',
      auth.uid()::TEXT
    );
    RAISE EXCEPTION 'twenty-first pitch-media object was accepted';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
    WHEN raise_exception THEN
      IF SQLERRM = 'twenty-first pitch-media object was accepted' THEN
        RAISE;
      END IF;
  END;
END;
$$;

INSERT INTO storage.objects (bucket_id, name, owner_id)
SELECT
  'profile-media',
  auth.uid()::TEXT || '/quota-' || sequence_number || '.jpg',
  auth.uid()::TEXT
FROM generate_series(1, 12) AS sequence_number;

DO $$
BEGIN
  BEGIN
    INSERT INTO storage.objects (bucket_id, name, owner_id)
    VALUES (
      'profile-media',
      auth.uid()::TEXT || '/quota-13.jpg',
      auth.uid()::TEXT
    );
    RAISE EXCEPTION 'thirteenth profile-media object was accepted';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
    WHEN raise_exception THEN
      IF SQLERRM = 'thirteenth profile-media object was accepted' THEN
        RAISE;
      END IF;
  END;
END;
$$;

RESET ROLE;
ROLLBACK;

SELECT '18_ugc_limits.sql passed' AS result;
