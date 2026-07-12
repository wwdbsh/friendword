CREATE SCHEMA IF NOT EXISTS storage;

CREATE TABLE IF NOT EXISTS storage.buckets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  public BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS storage.objects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id TEXT NOT NULL REFERENCES storage.buckets(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  owner_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (bucket_id, name)
);

ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION storage.foldername(name TEXT)
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT (string_to_array(name, '/'))[
    1:GREATEST(cardinality(string_to_array(name, '/')) - 1, 0)
  ];
$$;

GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;
GRANT SELECT ON storage.buckets TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO anon, authenticated, service_role;
