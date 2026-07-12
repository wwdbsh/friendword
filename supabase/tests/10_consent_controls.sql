-- Consent controls: photo exclusion by the claimed subject and the dater's
-- visibility window on approve. Reuses the Flow B journey on seeded draft
-- 10..02 (creator user4, subject claimed by user1).

BEGIN;

-- Setup: user4 submits, user1 claims (as in suite 05), and user4 registers
-- two suggested photos.
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000004';
CREATE TEMP TABLE controls_journey (consent_token TEXT) ON COMMIT DROP;
GRANT ALL ON controls_journey TO anon, authenticated;
INSERT INTO controls_journey
SELECT consent_token FROM submit_pitch_for_consent('10000000-0000-0000-0000-000000000002');

INSERT INTO pitch_assets (pitch_draft_id, uploaded_by_user_id, asset_type, storage_path, sort_order)
VALUES
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000004', 'photo',
   'pitch-media/10000000-0000-0000-0000-000000000002/photo-1.jpg', 0),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000004', 'photo',
   'pitch-media/10000000-0000-0000-0000-000000000002/photo-2.jpg', 1),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000004', 'voice',
   'pitch-media/10000000-0000-0000-0000-000000000002/voice.m4a', 0);

SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000001';
CREATE TEMP TABLE controls_claim (pitch_draft_id UUID) ON COMMIT DROP;
GRANT ALL ON controls_claim TO anon, authenticated;
INSERT INTO controls_claim
SELECT pitch_draft_id FROM claim_consent_request((SELECT consent_token FROM controls_journey));

-- 1. The introducer cannot exclude; the subject can — photos only.
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000004';
DO $$
DECLARE
  photo_id UUID;
BEGIN
  SELECT id INTO photo_id FROM pitch_assets
   WHERE storage_path LIKE '%photo-2.jpg' LIMIT 1;
  BEGIN
    PERFORM exclude_pitch_asset(photo_id);
    RAISE EXCEPTION 'introducer excluded a photo';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM = 'introducer excluded a photo' THEN
        RAISE;
      END IF;
  END;
END;
$$;

SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000001';
DO $$
DECLARE
  photo_id UUID;
  voice_id UUID;
  remaining INTEGER;
BEGIN
  SELECT id INTO photo_id FROM pitch_assets
   WHERE storage_path LIKE '%photo-2.jpg' LIMIT 1;
  PERFORM exclude_pitch_asset(photo_id);

  SELECT count(*) INTO remaining FROM pitch_assets
   WHERE pitch_draft_id = '10000000-0000-0000-0000-000000000002'
     AND asset_type = 'photo';
  IF remaining <> 1 THEN
    RAISE EXCEPTION 'expected 1 photo after exclusion, got %', remaining;
  END IF;

  SELECT id INTO voice_id FROM pitch_assets
   WHERE pitch_draft_id = '10000000-0000-0000-0000-000000000002'
     AND asset_type = 'voice' LIMIT 1;
  BEGIN
    PERFORM exclude_pitch_asset(voice_id);
    RAISE EXCEPTION 'voice track was excluded';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM = 'voice track was excluded' THEN
        RAISE;
      END IF;
  END;
END;
$$;

-- 2. Approve with an invalid window fails; with 7 days it stamps ends_at.
DO $$
DECLARE
  new_slug TEXT;
  window_ends TIMESTAMPTZ;
BEGIN
  BEGIN
    PERFORM * FROM approve_and_publish_pitch('10000000-0000-0000-0000-000000000002', 14);
    RAISE EXCEPTION 'invalid campaign window accepted';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM = 'invalid campaign window accepted' THEN
        RAISE;
      END IF;
  END;

  SELECT campaign_slug INTO new_slug
    FROM approve_and_publish_pitch('10000000-0000-0000-0000-000000000002', 7);
  IF new_slug IS NULL THEN
    RAISE EXCEPTION 'approve with window returned no slug';
  END IF;

  SELECT ends_at INTO window_ends
    FROM campaigns
   WHERE pitch_draft_id = '10000000-0000-0000-0000-000000000002';
  IF window_ends IS NULL
     OR window_ends < now() + INTERVAL '6 days'
     OR window_ends > now() + INTERVAL '8 days' THEN
    RAISE EXCEPTION 'ends_at not stamped to ~7 days, got %', window_ends;
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
