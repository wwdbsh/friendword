-- Second audit Slice 2 (P0-2 companion, H-3): server-authoritative text
-- moderation. Verdicts are content-addressed (scope + sha256 of the exact
-- text) and written only by the service-role moderation API. While
-- media_validation_enforcement is on, pitch text cannot enter consent and
-- interest bio/notes cannot be submitted without a passed verdict for the
-- exact content being published. Gates are BEFORE triggers so they survive
-- later RPC redefinitions and catch every write path.

CREATE TABLE public.text_moderations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope TEXT NOT NULL
    CHECK (scope IN ('pitch_content', 'profile_bio', 'interest_note')),
  content_hash TEXT NOT NULL,
  moderation_status TEXT NOT NULL
    CHECK (moderation_status IN ('passed', 'flagged')),
  moderation_ref TEXT,
  subject_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  pitch_draft_id UUID REFERENCES public.pitch_drafts(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (scope, content_hash)
);

ALTER TABLE public.text_moderations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.text_moderations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.text_moderations TO service_role;

CREATE FUNCTION private.text_moderation_passed(target_scope TEXT, content TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.text_moderations
     WHERE scope = target_scope
       AND content_hash = encode(digest(content, 'sha256'), 'hex')
       AND moderation_status = 'passed'
  );
$$;

REVOKE ALL ON FUNCTION private.text_moderation_passed(TEXT, TEXT) FROM PUBLIC;

-- Gate 1: a draft may only enter consent review when its exact
-- headline+body carry a passed verdict (enforcement on).
CREATE FUNCTION private.require_pitch_text_moderation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  IF NEW.status = 'consent_pending'
     AND OLD.status IS DISTINCT FROM 'consent_pending'
     AND private.media_validation_enforcement()
     AND NOT private.text_moderation_passed(
       'pitch_content',
       coalesce(NEW.headline, '') || E'\n\n' || coalesce(NEW.body, '')
     ) THEN
    RAISE EXCEPTION 'pitch text requires completed moderation';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.require_pitch_text_moderation() FROM PUBLIC;

CREATE TRIGGER pitch_drafts_text_moderation_gate
BEFORE UPDATE OF status ON public.pitch_drafts
FOR EACH ROW EXECUTE FUNCTION private.require_pitch_text_moderation();

-- Gate 2: interest submissions require passed verdicts for the sender's
-- bio and for a non-empty note (enforcement on).
CREATE FUNCTION private.require_interest_text_moderation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  sender_bio TEXT;
BEGIN
  IF NOT private.media_validation_enforcement() THEN
    RETURN NEW;
  END IF;

  SELECT bio INTO sender_bio
    FROM public.dating_profiles
   WHERE user_id = NEW.sender_user_id;
  IF nullif(btrim(coalesce(sender_bio, '')), '') IS NOT NULL
     AND NOT private.text_moderation_passed('profile_bio', sender_bio) THEN
    RAISE EXCEPTION 'profile bio requires completed moderation';
  END IF;

  IF nullif(btrim(coalesce(NEW.note, '')), '') IS NOT NULL
     AND NOT private.text_moderation_passed('interest_note', NEW.note) THEN
    RAISE EXCEPTION 'interest note requires completed moderation';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.require_interest_text_moderation() FROM PUBLIC;

CREATE TRIGGER interests_text_moderation_gate
BEFORE INSERT ON public.interests
FOR EACH ROW EXECUTE FUNCTION private.require_interest_text_moderation();
