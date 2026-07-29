-- Migration 0046 regressions: remove_pitch_draft_asset lets an Introducer
-- detach a photo from an editable draft, and refuses everything else.
--
-- Every refusal pins the EXACT server message, and every guard carries a
-- positive control in which the same call succeeds once the single
-- disqualifying fact is undone — so a fixture that stops reaching the guard
-- fails instead of passing vacuously.
BEGIN;

-- ═══ Fixture ══════════════════════════════════════════════════════════
-- Drew (0004) is the creator of the seed DRAFT pitch about Alex (0001). Every
-- asset below is registered the way the mobile client registers it: straight
-- after upload, while the draft is still editable.
INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
VALUES
  ('pitch-media', '10000000-0000-0000-0000-000000000002/photo-1.jpg',
   '00000000-0000-0000-0000-000000000004', '{"mimetype":"image/jpeg"}'),
  ('pitch-media', '10000000-0000-0000-0000-000000000002/photo-2.jpg',
   '00000000-0000-0000-0000-000000000004', '{"mimetype":"image/jpeg"}'),
  ('pitch-media', '10000000-0000-0000-0000-000000000002/voice.m4a',
   '00000000-0000-0000-0000-000000000004', '{"mimetype":"audio/mp4"}');

INSERT INTO pitch_assets (id, pitch_draft_id, uploaded_by_user_id, asset_type, storage_path, sort_order)
VALUES
  ('22000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002',
   '00000000-0000-0000-0000-000000000004', 'photo',
   '10000000-0000-0000-0000-000000000002/photo-1.jpg', 0),
  ('22000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002',
   '00000000-0000-0000-0000-000000000004', 'photo',
   '10000000-0000-0000-0000-000000000002/photo-2.jpg', 1),
  ('22000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002',
   '00000000-0000-0000-0000-000000000004', 'voice',
   '10000000-0000-0000-0000-000000000002/voice.m4a', 0),
  -- The published seed draft, created by Alex (0001): used for the
  -- "no longer editable" guard.
  ('22000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000001', 'photo',
   '10000000-0000-0000-0000-000000000001/photo-1.jpg', 0);

CREATE FUNCTION pg_temp.try_remove(asset_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM public.remove_pitch_draft_asset(asset_id);
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM;
END;
$$;
GRANT EXECUTE ON FUNCTION pg_temp.try_remove(UUID) TO authenticated;

-- ═══ Guard P1: the creator can detach a photo from an editable draft ══
-- The whole point of the RPC. Without this the rest of the file could pass with
-- a function that refuses everything.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);
DO $$
DECLARE
  actual TEXT := pg_temp.try_remove('22000000-0000-0000-0000-000000000001');
BEGIN
  IF actual IS NOT NULL THEN
    RAISE EXCEPTION 'GUARD-P1: the creator could not remove their own photo: "%"', actual;
  END IF;
  IF EXISTS (SELECT 1 FROM pitch_assets WHERE id = '22000000-0000-0000-0000-000000000001') THEN
    RAISE EXCEPTION 'GUARD-P1: the row survived a successful call';
  END IF;
  -- Only that row goes. The sibling photo and the voice asset are untouched, so
  -- the RPC is not a draft-wide wipe.
  IF (
    SELECT count(*) FROM pitch_assets
     WHERE pitch_draft_id = '10000000-0000-0000-0000-000000000002'
  ) <> 2 THEN
    RAISE EXCEPTION 'GUARD-P1: the call removed more than the requested asset';
  END IF;
  -- The storage object is deliberately left behind for the orphan sweep, which
  -- reclaims bytes through the Storage API. If this ever starts deleting
  -- storage.objects rows directly it manufactures unreclaimable bytes.
  IF NOT EXISTS (
    SELECT 1 FROM storage.objects
     WHERE bucket_id = 'pitch-media'
       AND name = '10000000-0000-0000-0000-000000000002/photo-1.jpg'
  ) THEN
    RAISE EXCEPTION 'GUARD-P1: the RPC deleted the storage object row itself';
  END IF;
END;
$$;
RESET ROLE;

-- ═══ Guard P2: the Introducer voice recording is never removable ══════
-- A server invariant (decision 2026-07-14), not a client convention.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);
DO $$
DECLARE
  actual TEXT := pg_temp.try_remove('22000000-0000-0000-0000-000000000003');
BEGIN
  IF actual IS NULL THEN
    RAISE EXCEPTION 'GUARD-P2: the Introducer voice recording was removed';
  END IF;
  IF actual <> 'the introducer voice recording cannot be removed' THEN
    RAISE EXCEPTION 'GUARD-P2: refused with "%"', actual;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pitch_assets WHERE id = '22000000-0000-0000-0000-000000000003') THEN
    RAISE EXCEPTION 'GUARD-P2: the voice row went away despite the refusal';
  END IF;
END;
$$;
RESET ROLE;

-- Positive control: the SAME asset id, same caller, same draft — only the
-- asset_type changes — and it is removable. So the refusal came from the voice
-- invariant, not from anything else about that row.
UPDATE pitch_assets SET asset_type = 'photo'
 WHERE id = '22000000-0000-0000-0000-000000000003';
SET LOCAL ROLE authenticated;
DO $$
DECLARE
  actual TEXT := pg_temp.try_remove('22000000-0000-0000-0000-000000000003');
BEGIN
  IF actual IS NOT NULL THEN
    RAISE EXCEPTION 'GUARD-P2: the same row as a photo was still refused with "%"', actual;
  END IF;
END;
$$;
RESET ROLE;

-- ═══ Guard P3: consent_pending and later are refused ══════════════════
-- From consent_pending on, the subject is looking at (or has approved) a
-- specific set of media. Removing one afterwards changes what was consented to.
UPDATE pitch_drafts SET status = 'consent_pending'
 WHERE id = '10000000-0000-0000-0000-000000000002';

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);
DO $$
DECLARE
  actual TEXT := pg_temp.try_remove('22000000-0000-0000-0000-000000000002');
BEGIN
  IF actual IS NULL THEN
    RAISE EXCEPTION 'GUARD-P3: a photo was removed from a consent_pending draft';
  END IF;
  IF actual <> 'this pitch can no longer be edited' THEN
    RAISE EXCEPTION 'GUARD-P3: consent_pending refused with "%"', actual;
  END IF;
END;
$$;
RESET ROLE;

-- The published seed draft is refused the same way, by its own creator.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
DO $$
DECLARE
  actual TEXT := pg_temp.try_remove('22000000-0000-0000-0000-000000000004');
BEGIN
  IF actual IS NULL THEN
    RAISE EXCEPTION 'GUARD-P3: a photo was removed from a published draft';
  END IF;
  IF actual <> 'this pitch can no longer be edited' THEN
    RAISE EXCEPTION 'GUARD-P3: published refused with "%"', actual;
  END IF;
END;
$$;
RESET ROLE;

-- Positive control: 'changes_requested' is the other editable status, and the
-- identical call now succeeds. Only the draft status moved.
UPDATE pitch_drafts SET status = 'changes_requested'
 WHERE id = '10000000-0000-0000-0000-000000000002';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);
DO $$
DECLARE
  actual TEXT := pg_temp.try_remove('22000000-0000-0000-0000-000000000002');
BEGIN
  IF actual IS NOT NULL THEN
    RAISE EXCEPTION 'GUARD-P3: a changes_requested draft refused removal with "%"', actual;
  END IF;
END;
$$;
RESET ROLE;

-- ═══ Guard P4: only the uploader removes an asset ═════════════════════
-- The subject may attach photos of their own while a draft is consent_pending
-- (policy pitch_assets_insert_subject, 0002). The creator does not get to
-- delete the subject's contribution to their own pitch.
INSERT INTO pitch_assets (id, pitch_draft_id, uploaded_by_user_id, asset_type, storage_path, sort_order)
VALUES (
  '22000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000001', 'photo',
  '10000000-0000-0000-0000-000000000002/subject-photo.jpg', 2
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);
DO $$
DECLARE
  actual TEXT := pg_temp.try_remove('22000000-0000-0000-0000-000000000005');
BEGIN
  IF actual IS NULL THEN
    RAISE EXCEPTION 'GUARD-P4: the creator removed an asset the subject uploaded';
  END IF;
  IF actual <> 'only the uploader can remove this pitch asset' THEN
    RAISE EXCEPTION 'GUARD-P4: refused with "%"', actual;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pitch_assets WHERE id = '22000000-0000-0000-0000-000000000005') THEN
    RAISE EXCEPTION 'GUARD-P4: the row went away despite the refusal';
  END IF;
END;
$$;
RESET ROLE;

-- Positive control: reassigning the same row to the caller — the only change —
-- makes the identical call succeed.
UPDATE pitch_assets SET uploaded_by_user_id = '00000000-0000-0000-0000-000000000004'
 WHERE id = '22000000-0000-0000-0000-000000000005';
SET LOCAL ROLE authenticated;
DO $$
DECLARE
  actual TEXT := pg_temp.try_remove('22000000-0000-0000-0000-000000000005');
BEGIN
  IF actual IS NOT NULL THEN
    RAISE EXCEPTION 'GUARD-P4: the caller''s own asset was refused with "%"', actual;
  END IF;
END;
$$;
RESET ROLE;

-- ═══ Guard P5: a non-creator cannot remove, and cannot enumerate ══════
-- Alex (0001) is the SUBJECT of this draft, so they can read its assets, but
-- they are not the creator. A missing id and someone else's id answer alike.
INSERT INTO pitch_assets (id, pitch_draft_id, uploaded_by_user_id, asset_type, storage_path, sort_order)
VALUES (
  '22000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000004', 'photo',
  '10000000-0000-0000-0000-000000000002/photo-6.jpg', 3
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
DO $$
DECLARE
  failures TEXT[] := ARRAY[]::TEXT[];
  existing TEXT := pg_temp.try_remove('22000000-0000-0000-0000-000000000006');
  missing TEXT := pg_temp.try_remove('22000000-0000-0000-0000-0000000000ff');
BEGIN
  IF existing IS NULL THEN
    failures := array_append(failures, 'P5: the subject removed the creator''s asset');
  ELSIF existing <> 'pitch asset not found or not yours to remove' THEN
    failures := array_append(failures, 'P5: refused with "' || existing || '"');
  END IF;
  -- Same answer for an id that does not exist at all: the RPC is not an
  -- existence oracle.
  IF missing IS DISTINCT FROM existing THEN
    failures := array_append(
      failures,
      'P5: a real asset answered "' || coalesce(existing, 'removed')
      || '" and a missing one answered "' || coalesce(missing, 'removed') || '"'
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pitch_assets WHERE id = '22000000-0000-0000-0000-000000000006') THEN
    failures := array_append(failures, 'P5: the row went away despite the refusal');
  END IF;
  IF cardinality(failures) > 0 THEN
    RAISE EXCEPTION 'GUARD-P5: %', array_to_string(failures, '; ');
  END IF;
END;
$$;
RESET ROLE;

-- Positive control: the creator removes that very row, so P5's refusal was
-- about who called and not about the row being undeletable.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);
DO $$
DECLARE
  actual TEXT := pg_temp.try_remove('22000000-0000-0000-0000-000000000006');
BEGIN
  IF actual IS NOT NULL THEN
    RAISE EXCEPTION 'GUARD-P5: the creator was refused with "%"', actual;
  END IF;
END;
$$;
RESET ROLE;

-- ═══ Guard P6: a suspended creator cannot remove ══════════════════════
-- This pins the INVARIANT, not one line: it is held twice over, by the RPC's
-- own assert_active_account precondition and by the pitch_assets_enforce_active_
-- account BEFORE DELETE trigger (0024), which fires for any authenticated
-- caller and raises the same message. Deleting the RPC's check alone therefore
-- leaves this guard green — verified by mutation. The RPC keeps its check to
-- fail fast and to match every other mutating RPC in the repo, but the trigger
-- is what makes the property hold for callers that never reach this function.
INSERT INTO pitch_assets (id, pitch_draft_id, uploaded_by_user_id, asset_type, storage_path, sort_order)
VALUES (
  '22000000-0000-0000-0000-000000000007', '10000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000004', 'photo',
  '10000000-0000-0000-0000-000000000002/photo-7.jpg', 4
);
UPDATE users SET account_status = 'suspended'
 WHERE id = '00000000-0000-0000-0000-000000000004';

SET LOCAL ROLE authenticated;
DO $$
DECLARE
  actual TEXT := pg_temp.try_remove('22000000-0000-0000-0000-000000000007');
BEGIN
  IF actual IS NULL THEN
    RAISE EXCEPTION 'GUARD-P6: a suspended creator removed an asset';
  END IF;
  IF actual <> 'account must be active' THEN
    RAISE EXCEPTION 'GUARD-P6: refused with "%"', actual;
  END IF;
END;
$$;
RESET ROLE;

UPDATE users SET account_status = 'active'
 WHERE id = '00000000-0000-0000-0000-000000000004';
SET LOCAL ROLE authenticated;
DO $$
DECLARE
  actual TEXT := pg_temp.try_remove('22000000-0000-0000-0000-000000000007');
BEGIN
  IF actual IS NOT NULL THEN
    RAISE EXCEPTION 'GUARD-P6: the reinstated creator was refused with "%"', actual;
  END IF;
END;
$$;
RESET ROLE;

-- ═══ Guard P7: the grant is EXECUTE-only, not a table DELETE ══════════
-- The RPC exists because authenticated has no DELETE on pitch_assets. If a
-- future migration hands out the table grant instead, this file must fail.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_privileges
     WHERE table_schema = 'public'
       AND table_name = 'pitch_assets'
       AND grantee = 'authenticated'
       AND privilege_type = 'DELETE'
  ) THEN
    RAISE EXCEPTION 'GUARD-P7: authenticated holds DELETE on pitch_assets directly';
  END IF;
  IF NOT has_function_privilege(
    'authenticated', 'public.remove_pitch_draft_asset(uuid)', 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'GUARD-P7: authenticated cannot execute remove_pitch_draft_asset';
  END IF;
END;
$$;

ROLLBACK;

SELECT '22_pitch_asset_removal.sql passed' AS result;
