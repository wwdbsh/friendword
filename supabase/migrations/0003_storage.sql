ALTER TABLE public.pitch_drafts
  ADD COLUMN relationship_type TEXT
    CHECK (relationship_type IN ('friend', 'coworker', 'family', 'roommate', 'other')),
  ADD COLUMN relationship_duration TEXT
    CHECK (relationship_duration IN ('lt1y', 'y1to3', 'y3to10', 'gt10y'));

REVOKE INSERT, UPDATE ON public.pitch_drafts FROM authenticated;
GRANT INSERT (
  created_by_user_id,
  headline,
  body,
  relationship_type,
  relationship_duration
) ON public.pitch_drafts TO authenticated;
GRANT UPDATE (
  headline,
  body,
  relationship_type,
  relationship_duration
) ON public.pitch_drafts TO authenticated;

INSERT INTO storage.buckets (id, name, public)
VALUES ('pitch-media', 'pitch-media', false)
ON CONFLICT (id) DO UPDATE SET public = false;

CREATE FUNCTION private.can_access_pitch_media(draft_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.pitch_drafts
     WHERE id = draft_id
       AND auth.uid() IN (created_by_user_id, subject_user_id)
  );
$$;

CREATE FUNCTION private.can_upload_pitch_media(draft_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
     FROM public.pitch_drafts
     WHERE id = draft_id
       AND created_by_user_id = auth.uid()
       AND status IN ('draft', 'consent_pending')
  );
$$;

CREATE FUNCTION private.pitch_media_draft_id(object_name TEXT)
RETURNS UUID
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN object_name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[a-z0-9][a-z0-9._-]{0,254}$'
      THEN (storage.foldername(object_name))[1]::UUID
    ELSE NULL
  END;
$$;

REVOKE ALL ON FUNCTION private.can_access_pitch_media(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.can_upload_pitch_media(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.pitch_media_draft_id(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.can_access_pitch_media(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.can_upload_pitch_media(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.pitch_media_draft_id(TEXT) TO authenticated, service_role;

CREATE POLICY objects_insert_pitch_creators ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'pitch-media'
    AND private.can_upload_pitch_media(private.pitch_media_draft_id(name))
  );

CREATE POLICY objects_select_pitch_participants ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'pitch-media'
    AND private.can_access_pitch_media(private.pitch_media_draft_id(name))
  );
