ALTER TABLE public.profiles
  ADD COLUMN display_name_confirmed BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.display_name_confirmed IS
  'Existing profiles remain false because historical mobile onboarding did not preserve whether the user approved an auth metadata display name.';

CREATE OR REPLACE FUNCTION private.handle_new_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  metadata_display_name TEXT := NULLIF(btrim(COALESCE(NEW.raw_user_meta_data ->> 'display_name', '')), '');
  profile_display_name TEXT := COALESCE(
    metadata_display_name,
    NULLIF(split_part(COALESCE(NEW.email, ''), '@', 1), ''),
    'Friendword user'
  );
BEGIN
  INSERT INTO public.users (id)
  VALUES (NEW.id)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (user_id, display_name, display_name_confirmed)
  VALUES (NEW.id, profile_display_name, metadata_display_name IS NOT NULL)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'Friendword auth bootstrap failed';
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.handle_new_auth_user() FROM PUBLIC;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE CONSTRAINT TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION private.handle_new_auth_user();

INSERT INTO public.users (id)
SELECT auth_user.id
  FROM auth.users AS auth_user
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (user_id, display_name, display_name_confirmed)
SELECT auth_user.id,
       COALESCE(
         NULLIF(btrim(COALESCE(auth_user.raw_user_meta_data ->> 'display_name', '')), ''),
         NULLIF(split_part(COALESCE(auth_user.email, ''), '@', 1), ''),
         'Friendword user'
       ),
       NULLIF(btrim(COALESCE(auth_user.raw_user_meta_data ->> 'display_name', '')), '') IS NOT NULL
  FROM auth.users AS auth_user
  JOIN public.users AS public_user ON public_user.id = auth_user.id
ON CONFLICT (user_id) DO NOTHING;

GRANT INSERT (display_name_confirmed),
      UPDATE (display_name_confirmed) ON public.profiles TO authenticated;
