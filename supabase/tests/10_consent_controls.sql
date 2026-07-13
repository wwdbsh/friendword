-- Consent controls: atomic photo selection by the claimed subject and the
-- dater's visibility window on approve. Reuses the Flow B journey on seeded draft
-- 10..02 (creator user4, subject claimed by user1).

BEGIN;

-- Setup: user4 registers two suggested photos before finalizing, then user1 claims.
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000004';
INSERT INTO pitch_assets (pitch_draft_id, uploaded_by_user_id, asset_type, storage_path, sort_order)
VALUES
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000004', 'photo',
   'pitch-media/10000000-0000-0000-0000-000000000002/photo-1.jpg', 0),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000004', 'photo',
   'pitch-media/10000000-0000-0000-0000-000000000002/photo-2.jpg', 1),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000004', 'voice',
   'pitch-media/10000000-0000-0000-0000-000000000002/voice.m4a', 0);

CREATE TEMP TABLE controls_journey (consent_token TEXT) ON COMMIT DROP;
GRANT ALL ON controls_journey TO anon, authenticated;
INSERT INTO controls_journey
SELECT consent_token FROM submit_pitch_for_consent('10000000-0000-0000-0000-000000000002', 'email', 'introducer@example.test', 'Alex');

SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000001';
CREATE TEMP TABLE controls_claim (pitch_draft_id UUID) ON COMMIT DROP;
GRANT ALL ON controls_claim TO anon, authenticated;
INSERT INTO controls_claim
SELECT pitch_draft_id FROM claim_consent_request((SELECT consent_token FROM controls_journey));

-- 1. Legacy per-asset exclusion is removed; selection is part of approval.
DO $$
BEGIN
  IF to_regprocedure('public.exclude_pitch_asset(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'legacy exclude_pitch_asset function still exists';
  END IF;
END;
$$;

SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000001';

-- 2. Approve with an invalid window fails; with 14 days it stamps ends_at.
DO $$
DECLARE
  approved_revision_id UUID;
  included_photo_id UUID;
  new_slug TEXT;
  remaining INTEGER;
  remaining_voice INTEGER;
  window_ends TIMESTAMPTZ;
BEGIN
  SELECT revision_id INTO approved_revision_id
    FROM consent_requests
   WHERE pitch_draft_id = '10000000-0000-0000-0000-000000000002';
  SELECT id INTO included_photo_id FROM pitch_assets
   WHERE pitch_draft_id = '10000000-0000-0000-0000-000000000002'
     AND storage_path LIKE '%photo-1.jpg';

  BEGIN
    PERFORM * FROM approve_and_publish_pitch(
      '10000000-0000-0000-0000-000000000002',
      15,
      approved_revision_id,
      ARRAY[included_photo_id],
      true
    );
    RAISE EXCEPTION 'invalid campaign window accepted';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM = 'invalid campaign window accepted' THEN
        RAISE;
      END IF;
  END;

  SELECT campaign_slug INTO new_slug
    FROM approve_and_publish_pitch(
      '10000000-0000-0000-0000-000000000002',
      14,
      approved_revision_id,
      ARRAY[included_photo_id],
      true
    );
  IF new_slug IS NULL THEN
    RAISE EXCEPTION 'approve with window returned no slug';
  END IF;

  SELECT count(*) INTO remaining FROM pitch_assets
   WHERE pitch_draft_id = '10000000-0000-0000-0000-000000000002'
     AND asset_type = 'photo';
  IF remaining <> 1 THEN
    RAISE EXCEPTION 'expected 1 photo after exclusion, got %', remaining;
  END IF;

  SELECT count(*) INTO remaining_voice FROM pitch_assets
   WHERE pitch_draft_id = '10000000-0000-0000-0000-000000000002'
     AND asset_type = 'voice';
  IF remaining_voice <> 1 THEN
    RAISE EXCEPTION 'voice track was excluded';
  END IF;

  SELECT ends_at INTO window_ends
    FROM campaigns
   WHERE pitch_draft_id = '10000000-0000-0000-0000-000000000002';
  IF window_ends IS NULL
     OR window_ends < now() + INTERVAL '13 days'
     OR window_ends > now() + INTERVAL '15 days' THEN
    RAISE EXCEPTION 'ends_at not stamped to ~14 days, got %', window_ends;
  END IF;
END;
$$;

-- 3. An expired window refuses interest even while status is published.
RESET ROLE;
UPDATE campaigns
   SET ends_at = now() - INTERVAL '1 hour'
 WHERE pitch_draft_id = '10000000-0000-0000-0000-000000000002';

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000003';
DO $$
BEGIN
  BEGIN
    PERFORM * FROM submit_interest(
      (SELECT id FROM campaigns WHERE pitch_draft_id = '10000000-0000-0000-0000-000000000002'));
    RAISE EXCEPTION 'expired campaign accepted interest';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM = 'expired campaign accepted interest' THEN
        RAISE;
      END IF;
  END;
END;
$$;

ROLLBACK;

SELECT '10_consent_controls.sql passed' AS result;
