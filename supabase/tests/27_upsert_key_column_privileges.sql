-- 27: PostgREST merge upserts need UPDATE on the conflict-key column.
--
-- supabase-js .upsert without ignoreDuplicates sends
-- Prefer: resolution=merge-duplicates, which PostgREST compiles to
--   ON CONFLICT (key) DO UPDATE SET key = EXCLUDED.key, <payload columns...>
-- so the key column itself needs UPDATE privilege — PostgreSQL checks the
-- DO UPDATE arm's column privileges at plan time, even when no conflict fires.
-- The 0052 privilege sweep must therefore keep UPDATE (user_id) granted for
-- every table the client merge-upserts into:
--   * profiles        — auth.ts confirmed-display-name bootstrap upsert
--   * dating_profiles — interestRepo.saveDatingProfile upsert
-- This file replays the exact SQL shape PostgREST generates, as the
-- authenticated role, so a future grant sweep that drops the key column
-- breaks here instead of in production onboarding.

INSERT INTO auth.users (id, email, raw_user_meta_data)
VALUES
  ('00000000-0000-0000-0000-000000002701', 'merge.upsert@example.com', '{}'::JSONB),
  ('00000000-0000-0000-0000-000000002702', 'merge.bystander@example.com', '{}'::JSONB);

-- The bystander only anchors the FK in the re-point attempt below; drop the
-- bootstrapped profile row so that attempt cannot hit a unique violation
-- before the RLS WITH CHECK error this test pins.
DELETE FROM public.profiles
 WHERE user_id = '00000000-0000-0000-0000-000000002702';

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000002701';

-- profiles: bootstrap already created the row, so this exercises the
-- conflict (DO UPDATE) path of auth.ts:134's confirmed-name upsert.
INSERT INTO public.profiles (user_id, display_name, display_name_confirmed)
VALUES ('00000000-0000-0000-0000-000000002701', 'Merge Upsert', true)
ON CONFLICT (user_id) DO UPDATE
SET user_id = EXCLUDED.user_id,
    display_name = EXCLUDED.display_name,
    display_name_confirmed = EXCLUDED.display_name_confirmed;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM public.profiles
     WHERE user_id = '00000000-0000-0000-0000-000000002701'
       AND display_name = 'Merge Upsert'
       AND display_name_confirmed = true
  ) THEN
    RAISE EXCEPTION 'profiles merge upsert did not update the existing row';
  END IF;
END;
$$;

-- dating_profiles: no row yet, so this exercises the insert path of
-- interestRepo.saveDatingProfile — the DO UPDATE arm's privileges are
-- still checked even though no conflict fires.
INSERT INTO public.dating_profiles (user_id, bio, dating_intent, approximate_location, photos)
VALUES (
  '00000000-0000-0000-0000-000000002701',
  'first bio',
  'long_term',
  'Seoul',
  ARRAY['dating-photos/00000000-0000-0000-0000-000000002701/a.jpg']
)
ON CONFLICT (user_id) DO UPDATE
SET user_id = EXCLUDED.user_id,
    bio = EXCLUDED.bio,
    dating_intent = EXCLUDED.dating_intent,
    approximate_location = EXCLUDED.approximate_location,
    photos = EXCLUDED.photos;

-- Second run hits the conflict path and must merge the new payload.
INSERT INTO public.dating_profiles (user_id, bio, dating_intent, approximate_location, photos)
VALUES (
  '00000000-0000-0000-0000-000000002701',
  'second bio',
  'casual',
  'Busan',
  ARRAY['dating-photos/00000000-0000-0000-0000-000000002701/b.jpg']
)
ON CONFLICT (user_id) DO UPDATE
SET user_id = EXCLUDED.user_id,
    bio = EXCLUDED.bio,
    dating_intent = EXCLUDED.dating_intent,
    approximate_location = EXCLUDED.approximate_location,
    photos = EXCLUDED.photos;

DO $$
DECLARE
  row_count INTEGER;
BEGIN
  SELECT count(*) INTO row_count
    FROM public.dating_profiles
   WHERE user_id = '00000000-0000-0000-0000-000000002701';
  IF row_count <> 1 THEN
    RAISE EXCEPTION 'dating_profiles merge upsert duplicated the row';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM public.dating_profiles
     WHERE user_id = '00000000-0000-0000-0000-000000002701'
       AND bio = 'second bio'
       AND dating_intent = 'casual'
       AND approximate_location = 'Busan'
  ) THEN
    RAISE EXCEPTION 'dating_profiles merge upsert did not merge the second payload';
  END IF;
END;
$$;

-- Safety bound of the key-column grant: UPDATE (user_id) must not let a
-- client re-point their row at someone else — the RLS update policy's
-- WITH CHECK (auth.uid() = user_id) has to reject the new row.
DO $$
BEGIN
  UPDATE public.profiles
     SET user_id = '00000000-0000-0000-0000-000000002702'
   WHERE user_id = '00000000-0000-0000-0000-000000002701';
  RAISE EXCEPTION 'authenticated user re-pointed their profile at another user';
EXCEPTION
  WHEN insufficient_privilege THEN
    IF position('row-level security' IN SQLERRM) = 0 THEN
      RAISE;
    END IF;
END;
$$;

ROLLBACK;
