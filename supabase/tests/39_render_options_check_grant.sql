-- 39: the media_render_jobs options CHECK must be evaluable by the writing role.
-- Red before 0064: `permission denied for function render_options_are_valid`
-- for service_role (reproduced on hosted, 2026-09-09). Green after.
\set ON_ERROR_STOP on
BEGIN;

SET ROLE service_role;
DO $$
BEGIN
  IF NOT private.render_options_are_valid('{"music": true}'::jsonb) THEN
    RAISE EXCEPTION 'service_role: valid options judged invalid';
  END IF;
  IF private.render_options_are_valid('{"tempo": 1}'::jsonb) THEN
    RAISE EXCEPTION 'service_role: unknown option key accepted';
  END IF;
END $$;
RESET ROLE;

SET ROLE authenticated;
DO $$
BEGIN
  IF NOT private.render_options_are_valid('{}'::jsonb) THEN
    RAISE EXCEPTION 'authenticated: empty options judged invalid';
  END IF;
END $$;
RESET ROLE;

SET ROLE anon;
DO $$
BEGIN
  BEGIN
    PERFORM private.render_options_are_valid('{}'::jsonb);
    RAISE EXCEPTION 'anon must not be able to execute render_options_are_valid';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

ROLLBACK;
