INSERT INTO auth.users (id, email, raw_user_meta_data)
VALUES (
  '00000000-0000-0000-0000-000000000011',
  'fresh.magic@example.com',
  '{}'::JSONB
);

DO $$
DECLARE
  public_user_count INTEGER;
  profile_name TEXT;
  profile_confirmed BOOLEAN;
BEGIN
  SELECT count(*) INTO public_user_count
    FROM public.users
   WHERE id = '00000000-0000-0000-0000-000000000011';

  SELECT display_name, display_name_confirmed
    INTO profile_name, profile_confirmed
    FROM public.profiles
   WHERE user_id = '00000000-0000-0000-0000-000000000011';

  IF public_user_count <> 1 THEN
    RAISE EXCEPTION 'auth insert did not create exactly one public user';
  END IF;
  IF profile_name IS DISTINCT FROM 'fresh.magic' OR profile_confirmed IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'email fallback profile was not created as unconfirmed';
  END IF;
END;
$$;

CREATE TRIGGER test_duplicate_auth_user_bootstrap
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION private.handle_new_auth_user();

INSERT INTO auth.users (id, email, raw_user_meta_data)
VALUES (
  '00000000-0000-0000-0000-000000000012',
  'metadata@example.com',
  '{"display_name": "  Chosen Name  "}'::JSONB
);

DROP TRIGGER test_duplicate_auth_user_bootstrap ON auth.users;

DO $$
DECLARE
  public_user_count INTEGER;
  profile_count INTEGER;
  profile_name TEXT;
  profile_confirmed BOOLEAN;
BEGIN
  SELECT count(*) INTO public_user_count
    FROM public.users
   WHERE id = '00000000-0000-0000-0000-000000000012';
  SELECT count(*), min(display_name), bool_and(display_name_confirmed)
    INTO profile_count, profile_name, profile_confirmed
    FROM public.profiles
   WHERE user_id = '00000000-0000-0000-0000-000000000012';

  IF public_user_count <> 1 OR profile_count <> 1 THEN
    RAISE EXCEPTION 'duplicate bootstrap was not idempotent';
  END IF;
  IF profile_name IS DISTINCT FROM 'Chosen Name' OR profile_confirmed IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'metadata display name was not created as confirmed';
  END IF;
END;
$$;

CREATE FUNCTION public.test_reject_bootstrap_user()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.id = '00000000-0000-0000-0000-000000000013' THEN
    RAISE EXCEPTION 'forced public user failure';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER test_reject_bootstrap_user
BEFORE INSERT ON public.users
FOR EACH ROW EXECUTE FUNCTION public.test_reject_bootstrap_user();

INSERT INTO auth.users (id, email, raw_user_meta_data)
VALUES (
  '00000000-0000-0000-0000-000000000013',
  'survives@example.com',
  '{}'::JSONB
);

DROP TRIGGER test_reject_bootstrap_user ON public.users;
DROP FUNCTION public.test_reject_bootstrap_user();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM auth.users WHERE id = '00000000-0000-0000-0000-000000000013'
  ) THEN
    RAISE EXCEPTION 'bootstrap exception rolled back auth user creation';
  END IF;
END;
$$;

INSERT INTO auth.users (id, email, raw_user_meta_data)
VALUES (
  '00000000-0000-0000-0000-000000000014',
  'fallback-repair@example.com',
  '{}'::JSONB
);
DELETE FROM public.profiles
 WHERE user_id = '00000000-0000-0000-0000-000000000014';

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000014';
INSERT INTO public.profiles (user_id, display_name, display_name_confirmed)
VALUES (
  '00000000-0000-0000-0000-000000000014',
  'Fallback Repair',
  true
);
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000011';

UPDATE public.profiles
   SET display_name = 'Approved Name',
       display_name_confirmed = true
 WHERE user_id = '00000000-0000-0000-0000-000000000011';

DO $$
DECLARE
  updated_count INTEGER;
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM public.profiles
     WHERE user_id = '00000000-0000-0000-0000-000000000011'
       AND display_name = 'Approved Name'
       AND display_name_confirmed = true
  ) THEN
    RAISE EXCEPTION 'authenticated user cannot confirm their own display name';
  END IF;

  UPDATE public.profiles
     SET display_name_confirmed = false
   WHERE user_id = '00000000-0000-0000-0000-000000000012';
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  IF updated_count <> 0 THEN
    RAISE EXCEPTION 'authenticated user can change another profile confirmation';
  END IF;
END;
$$;
ROLLBACK;
