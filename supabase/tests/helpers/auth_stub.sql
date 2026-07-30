CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
  id UUID PRIMARY KEY,
  email TEXT UNIQUE,
  raw_user_meta_data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS UUID
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::UUID;
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
  END IF;
END;
$$;

GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;

-- Hosted Supabase ships default privileges that GRANT every newly created
-- object in schema public to anon, authenticated and service_role. Plain
-- PostgreSQL does not, so without this line the harness gives every function a
-- stricter ACL than production and `REVOKE ALL ... FROM PUBLIC` reads as
-- sufficient here while anon can still call the function on a real project
-- (reproduced 2026-07-30 against the local Supabase stack: anon held EXECUTE on
-- claim_media_ingest_job). An ACL assertion is only worth writing against the
-- grants production actually applies.
--
-- TABLES and SEQUENCES get the same hosted default grants as FUNCTIONS
-- (reproduced 2026-07-30: has_table_privilege('anon','public.users','UPDATE')
-- is true on the local Supabase stack). Emulating them here is what lets
-- 02_rls.sql and 22_pitch_asset_removal.sql assert against the ACL production
-- actually applies; 0052_table_privilege_sweep.sql is the remediation.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;

\ir storage_stub.sql
