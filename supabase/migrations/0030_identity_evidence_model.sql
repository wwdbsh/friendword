-- Second audit Slice 5 (P0-8): identity evidence is typed, provider-bound,
-- expiring, and — for publishing — bound to the exact approved photo.
-- A generic "some check passed once" row no longer authorizes anything.
--
-- Requirements while identity_enforcement is on:
-- - Dater publish (campaign becomes published, including resume):
--   verified phone + unexpired passed adult_18plus + liveness +
--   face_match whose photo_object_name equals the approved primary photo.
-- - Interest submission: verified phone + unexpired passed adult_18plus
--   + liveness (asserted by private.assert_identity_evidence, which
--   submit_interest already calls).
-- Providers stay Unconfigured and fail loudly; the switch stays off
-- until a vendor is wired (user gate), but the contract is enforced and
-- regression-tested with the switch on.

ALTER TABLE public.verification_checks
  ADD COLUMN check_type TEXT
    CHECK (check_type IN ('phone', 'adult_18plus', 'liveness', 'face_match')),
  ADD COLUMN provider_ref TEXT,
  ADD COLUMN photo_object_name TEXT,
  ADD COLUMN result TEXT
    CHECK (result IN ('passed', 'failed', 'inconclusive')),
  ADD COLUMN checked_at TIMESTAMPTZ,
  ADD COLUMN expires_at TIMESTAMPTZ;

CREATE INDEX verification_checks_user_type_idx
  ON public.verification_checks (user_id, check_type)
  WHERE result = 'passed';

CREATE FUNCTION private.has_identity_evidence(target_user_id UUID, target_check_type TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.verification_checks
     WHERE user_id = target_user_id
       AND check_type = target_check_type
       AND result = 'passed'
       AND (expires_at IS NULL OR expires_at > now())
  );
$$;

REVOKE ALL ON FUNCTION private.has_identity_evidence(UUID, TEXT) FROM PUBLIC;

-- Replaces the 0012 version: legacy status/verified_at rows without a
-- typed, unexpired result no longer authorize (second audit P0-8: "오래
-- 됐거나 다른 사진에 대한 pass row는 현재 제출을 승인하지 못한다").
CREATE OR REPLACE FUNCTION private.assert_identity_evidence(target_user_id UUID)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.users
     WHERE id = target_user_id AND phone_verified_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'phone verification required';
  END IF;

  IF NOT private.has_identity_evidence(target_user_id, 'adult_18plus') THEN
    RAISE EXCEPTION 'current adult (18+) identity evidence required';
  END IF;

  IF NOT private.has_identity_evidence(target_user_id, 'liveness') THEN
    RAISE EXCEPTION 'current liveness evidence required';
  END IF;
END;
$$;

-- Publish-time gate: runs on every transition into 'published' (initial
-- approve and any resume), so stale or wrong-photo evidence cannot keep
-- a campaign publishable.
CREATE FUNCTION private.require_publish_identity_evidence()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  primary_photo_object TEXT;
BEGIN
  IF NEW.status <> 'published'
     OR (TG_OP = 'UPDATE' AND OLD.status = 'published')
     OR NOT private.identity_enforcement() THEN
    RETURN NEW;
  END IF;

  PERFORM private.assert_identity_evidence(NEW.owner_user_id);

  SELECT CASE
           WHEN asset.storage_path LIKE 'pitch-media/%'
             THEN substr(asset.storage_path, length('pitch-media/') + 1)
           ELSE asset.storage_path
         END
    INTO primary_photo_object
    FROM public.pitch_assets asset
   WHERE asset.pitch_draft_id = NEW.pitch_draft_id
     AND asset.asset_type = 'photo'
   ORDER BY asset.sort_order NULLS LAST, asset.id
   LIMIT 1;
  IF primary_photo_object IS NULL THEN
    RAISE EXCEPTION 'publishing requires an approved photo for face evidence';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.verification_checks
     WHERE user_id = NEW.owner_user_id
       AND check_type = 'face_match'
       AND result = 'passed'
       AND (expires_at IS NULL OR expires_at > now())
       AND photo_object_name = primary_photo_object
  ) THEN
    RAISE EXCEPTION 'face match evidence for the approved photo is required';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.require_publish_identity_evidence() FROM PUBLIC;

CREATE TRIGGER campaigns_publish_identity_gate
BEFORE INSERT OR UPDATE ON public.campaigns
FOR EACH ROW EXECUTE FUNCTION private.require_publish_identity_evidence();
