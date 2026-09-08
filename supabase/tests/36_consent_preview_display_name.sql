-- 36: the anonymous consent preview never prints an unconfirmed display name
-- (0061 — T002 / Issue #71).
--
-- `profiles.display_name` is seeded from the email local-part with
-- `display_name_confirmed = false` (0011). `get_consent_preview` is the only
-- public reader that runs inside the database, and it runs as `anon` before
-- the dater has signed in, so the gate belongs to the function itself.
--
-- Both directions are pinned here, on ONE request, so the test cannot pass by
-- returning nothing at all: unconfirmed yields NULL while the rest of the row
-- still arrives, and confirming the same profile makes the name appear.
--
-- The execute ACL is asserted too: 0061 is a CREATE OR REPLACE, and the claim
-- that it preserves the 0005 grants is checked rather than assumed.

BEGIN;

CREATE TEMP TABLE preview_token (consent_token TEXT) ON COMMIT DROP;
GRANT ALL ON preview_token TO anon, authenticated;

-- The seeded profiles predate the confirmation flag, so user4 starts exactly
-- where a bootstrapped account does: a name nobody approved.
UPDATE profiles
   SET display_name = 'drew.kim92', display_name_confirmed = false
 WHERE user_id = '00000000-0000-0000-0000-000000000004';

-- The seeded draft carries no relationship context; this test asserts that the
-- gate withholds ONLY the name, so the rest of the row has to be non-empty.
UPDATE pitch_drafts
   SET relationship_type = 'friend'
 WHERE id = '10000000-0000-0000-0000-000000000002';

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000004';
INSERT INTO pitch_assets (pitch_draft_id, uploaded_by_user_id, asset_type, storage_path)
VALUES (
  '10000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000004',
  'photo',
  '10000000-0000-0000-0000-000000000002/preview-photo.jpg'
);
INSERT INTO preview_token
SELECT consent_token
  FROM submit_pitch_for_consent(
    '10000000-0000-0000-0000-000000000002', 'email', 'introducer@example.test', 'Alex');
RESET ROLE;

SET LOCAL ROLE anon;
DO $$
DECLARE
  preview RECORD;
BEGIN
  SELECT * INTO preview
    FROM get_consent_preview((SELECT consent_token FROM preview_token));
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unconfirmed introducer produced no preview row at all';
  END IF;
  IF preview.introducer_display_name IS NOT NULL THEN
    RAISE EXCEPTION 'unconfirmed introducer name leaked to the anonymous preview: %',
      preview.introducer_display_name;
  END IF;
  -- The rest of the row must still be there: the dater needs the relationship
  -- context to recognise the invite even when the name is withheld.
  IF preview.request_status <> 'pending' THEN
    RAISE EXCEPTION 'preview status expected pending, got %', preview.request_status;
  END IF;
  IF preview.relationship_type IS NULL THEN
    RAISE EXCEPTION 'preview dropped the relationship context along with the name';
  END IF;
END;
$$;
RESET ROLE;

-- Same request, same token: only the confirmation flag changes.
UPDATE profiles
   SET display_name = 'Drew Introducer', display_name_confirmed = true
 WHERE user_id = '00000000-0000-0000-0000-000000000004';

SET LOCAL ROLE anon;
DO $$
DECLARE
  preview RECORD;
BEGIN
  SELECT * INTO preview
    FROM get_consent_preview((SELECT consent_token FROM preview_token));
  IF preview.introducer_display_name IS DISTINCT FROM 'Drew Introducer' THEN
    RAISE EXCEPTION 'confirmed introducer name did not reach the preview, got %',
      preview.introducer_display_name;
  END IF;
END;
$$;
RESET ROLE;

DO $$
BEGIN
  IF has_function_privilege('public', 'public.get_consent_preview(TEXT)', 'EXECUTE') THEN
    RAISE EXCEPTION 'PUBLIC regained EXECUTE on get_consent_preview after CREATE OR REPLACE';
  END IF;
  IF NOT has_function_privilege('anon', 'public.get_consent_preview(TEXT)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon lost EXECUTE on get_consent_preview after CREATE OR REPLACE';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.get_consent_preview(TEXT)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated lost EXECUTE on get_consent_preview after CREATE OR REPLACE';
  END IF;
END;
$$;

ROLLBACK;

SELECT '36_consent_preview_display_name.sql passed' AS result;
