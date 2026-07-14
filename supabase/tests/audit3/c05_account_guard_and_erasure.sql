-- AUDIT3 REGRESSION: P0-NEW Slice 3 (third audit H-1, H-2, H-5).
-- Encodes the *fixed* behavior; red-first, so it FAILS until migration
-- 0037_account_guard_and_erasure.sql lands.
--
-- H-1: every authenticated-executable SECURITY DEFINER RPC that reads private
--      data or mutates state through auth.uid() must pass
--      private.assert_active_account(caller). b11 only covered direct SELECT
--      RLS; suspended/deleted callers could still read through read RPCs.
-- H-2: deleting an introducer erases their voice (personal data), archives the
--      published/paused campaigns that lose that voice, preserves dater-owned
--      data; resolved purchase-review payloads are PII-scrubbed after 90 days
--      while open reviews stay intact.
-- H-5: authenticated users may DELETE only their own profile-media objects.
BEGIN;

-- ========================================================================
-- H-1 GUARD MATRIX.
-- Baseline: active callers succeed through the guarded read/mutate RPCs.
-- ========================================================================
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
DO $$
DECLARE
  interest_rows INTEGER;
BEGIN
  SELECT count(*) INTO interest_rows
    FROM list_campaign_interests('20000000-0000-0000-0000-000000000001');
  IF interest_rows < 1 THEN
    RAISE EXCEPTION 'c05 H-1: active owner lost list_campaign_interests';
  END IF;
  PERFORM * FROM get_campaign_pass_state('20000000-0000-0000-0000-000000000001');
END;
$$;
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true);
DO $$
DECLARE
  room_rows INTEGER;
BEGIN
  SELECT count(*) INTO room_rows FROM list_my_intro_rooms();
  IF room_rows < 1 THEN
    RAISE EXCEPTION 'c05 H-1: active user lost list_my_intro_rooms';
  END IF;
  -- Authenticated active analytics still records.
  PERFORM track_event('voice_recorded');
END;
$$;
RESET ROLE;

-- Anonymous public-page analytics must remain open (guard skips NULL caller).
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '', true);
DO $$
BEGIN
  PERFORM track_event('pitch_viewed_unique');
END;
$$;
RESET ROLE;

-- Suspend the campaign owner (…02): guarded read RPCs must now reject them.
UPDATE users SET account_status = 'suspended'
 WHERE id = '00000000-0000-0000-0000-000000000002';

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
DO $$
DECLARE
  blocked BOOLEAN;
BEGIN
  blocked := false;
  BEGIN
    PERFORM * FROM list_campaign_interests('20000000-0000-0000-0000-000000000001');
  EXCEPTION WHEN others THEN blocked := true;
  END;
  IF NOT blocked THEN
    RAISE EXCEPTION 'c05 H-1: suspended caller read list_campaign_interests';
  END IF;

  blocked := false;
  BEGIN
    PERFORM * FROM get_campaign_pass_state('20000000-0000-0000-0000-000000000001');
  EXCEPTION WHEN others THEN blocked := true;
  END;
  IF NOT blocked THEN
    RAISE EXCEPTION 'c05 H-1: suspended caller read get_campaign_pass_state';
  END IF;
END;
$$;
RESET ROLE;

-- Suspend the interested user (…03): their read/mutate/analytics RPCs reject.
UPDATE users SET account_status = 'suspended'
 WHERE id = '00000000-0000-0000-0000-000000000003';

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true);
DO $$
DECLARE
  blocked BOOLEAN;
BEGIN
  blocked := false;
  BEGIN
    PERFORM * FROM list_my_intro_rooms();
  EXCEPTION WHEN others THEN blocked := true;
  END;
  IF NOT blocked THEN
    RAISE EXCEPTION 'c05 H-1: suspended caller read list_my_intro_rooms';
  END IF;

  blocked := false;
  BEGIN
    PERFORM leave_intro_room('40000000-0000-0000-0000-000000000001');
  EXCEPTION WHEN others THEN blocked := true;
  END;
  IF NOT blocked THEN
    RAISE EXCEPTION 'c05 H-1: suspended caller ran leave_intro_room';
  END IF;

  blocked := false;
  BEGIN
    PERFORM track_event('voice_recorded');
  EXCEPTION WHEN others THEN blocked := true;
  END;
  IF NOT blocked THEN
    RAISE EXCEPTION 'c05 H-1: suspended caller recorded analytics via track_event';
  END IF;
END;
$$;
RESET ROLE;

-- Restore statuses so the erasure fixtures below start from a clean state.
UPDATE users SET account_status = 'active'
 WHERE id IN (
   '00000000-0000-0000-0000-000000000002',
   '00000000-0000-0000-0000-000000000003'
 );

-- ========================================================================
-- H-2 INTRODUCER ERASURE.
-- Introducer …01 authored published draft/campaign …0001 (owned by dater …02).
-- Seed a voice asset (introducer) and a photo asset (dater's own upload).
-- ========================================================================
INSERT INTO pitch_assets (pitch_draft_id, uploaded_by_user_id, asset_type, storage_path)
VALUES
  ('10000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000001', 'voice',
   '10000000-0000-0000-0000-000000000001/voice.m4a'),
  ('10000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000002', 'photo',
   '10000000-0000-0000-0000-000000000001/dater-photo.jpg');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
SELECT * FROM request_account_deletion();
RESET ROLE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pitch_assets
     WHERE asset_type = 'voice'
       AND uploaded_by_user_id = '00000000-0000-0000-0000-000000000001'
  ) THEN
    RAISE EXCEPTION 'c05 H-2: introducer voice asset was not erased';
  END IF;
  IF (SELECT status FROM campaigns WHERE id = '20000000-0000-0000-0000-000000000001')
       <> 'archived' THEN
    RAISE EXCEPTION 'c05 H-2: voiceless published campaign was not archived';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pitch_assets
     WHERE asset_type = 'photo'
       AND uploaded_by_user_id = '00000000-0000-0000-0000-000000000002'
       AND pitch_draft_id = '10000000-0000-0000-0000-000000000001'
  ) THEN
    RAISE EXCEPTION 'c05 H-2: dater-owned photo asset was wrongly erased';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pitch_drafts WHERE id = '10000000-0000-0000-0000-000000000001'
  ) THEN
    RAISE EXCEPTION 'c05 H-2: dater-preserved draft was wrongly removed';
  END IF;
  IF (SELECT account_status FROM users WHERE id = '00000000-0000-0000-0000-000000000001')
       <> 'deleted' THEN
    RAISE EXCEPTION 'c05 H-2: introducer account was not marked deleted';
  END IF;
END;
$$;

-- ========================================================================
-- H-2 PURCHASE-REVIEW PAYLOAD SCRUB.
-- Resolved > 90d ago is PII-scrubbed; open review is untouched.
-- ========================================================================
DO $$
BEGIN
  IF to_regprocedure('public.scrub_resolved_purchase_review_payloads(integer)') IS NULL THEN
    RAISE EXCEPTION 'c05: scrub_resolved_purchase_review_payloads(integer) is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'purchase_event_reviews'
       AND column_name = 'payload_scrubbed_at'
  ) THEN
    RAISE EXCEPTION 'c05: purchase_event_reviews.payload_scrubbed_at is missing';
  END IF;
END;
$$;

INSERT INTO purchase_event_reviews (provider_event_id, event_type, reason, payload, status, resolved_at)
VALUES
  ('evt-resolved-old', 'TRANSFER', 'transfer_requires_ops_review',
   jsonb_build_object(
     'id', 'evt-resolved-old', 'type', 'TRANSFER', 'product_id', 'campaign_30d_1999',
     'environment', 'PRODUCTION', 'app_user_id', 'user-abc-123',
     'transaction_id', 'txn-999', 'original_transaction_id', 'otxn-999',
     'subscriber_attributes', jsonb_build_object('$email', jsonb_build_object('value', 'someone@example.test'))
   ),
   'resolved', now() - INTERVAL '91 days'),
  ('evt-open-new', 'UNKNOWN', 'unhandled_event_type',
   jsonb_build_object(
     'id', 'evt-open-new', 'type', 'UNKNOWN', 'app_user_id', 'user-open-777'
   ),
   'open', NULL);

SELECT scrub_resolved_purchase_review_payloads();

DO $$
DECLARE
  resolved_payload JSONB;
  open_payload JSONB;
  scrubbed_at TIMESTAMPTZ;
  open_scrubbed_at TIMESTAMPTZ;
BEGIN
  SELECT payload, payload_scrubbed_at INTO resolved_payload, scrubbed_at
    FROM purchase_event_reviews WHERE provider_event_id = 'evt-resolved-old';
  SELECT payload, payload_scrubbed_at INTO open_payload, open_scrubbed_at
    FROM purchase_event_reviews WHERE provider_event_id = 'evt-open-new';

  IF scrubbed_at IS NULL THEN
    RAISE EXCEPTION 'c05 H-2: resolved review was not marked scrubbed';
  END IF;
  IF resolved_payload ? 'app_user_id'
     OR resolved_payload ? 'subscriber_attributes'
     OR resolved_payload ? 'transaction_id'
     OR resolved_payload ? 'original_transaction_id' THEN
    RAISE EXCEPTION 'c05 H-2: resolved review payload still carries PII';
  END IF;
  -- Non-PII operational summary is retained.
  IF (resolved_payload ->> 'type') <> 'TRANSFER'
     OR (resolved_payload ->> 'product_id') <> 'campaign_30d_1999' THEN
    RAISE EXCEPTION 'c05 H-2: resolved review lost its operational summary';
  END IF;
  -- Open review is untouched.
  IF open_scrubbed_at IS NOT NULL
     OR NOT (open_payload ? 'app_user_id') THEN
    RAISE EXCEPTION 'c05 H-2: open review was scrubbed but must stay intact';
  END IF;
END;
$$;

-- ========================================================================
-- H-5 PROFILE-MEDIA CLIENT DELETE POLICY.
-- Owner prefix may delete its own object; another user's object is protected.
-- ========================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'storage'
       AND tablename = 'objects'
       AND policyname = 'objects_delete_own_profile_media'
  ) THEN
    RAISE EXCEPTION 'c05: profile-media DELETE policy is missing';
  END IF;
END;
$$;

INSERT INTO storage.objects (bucket_id, name, owner_id)
VALUES
  ('profile-media', '00000000-0000-0000-0000-000000000003/casey-1.jpg',
   '00000000-0000-0000-0000-000000000003'),
  ('profile-media', '00000000-0000-0000-0000-000000000002/blair-1.jpg',
   '00000000-0000-0000-0000-000000000002');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true);
-- Attempt to remove another user's object (RLS filters it out silently).
DELETE FROM storage.objects
 WHERE bucket_id = 'profile-media'
   AND name = '00000000-0000-0000-0000-000000000002/blair-1.jpg';
-- Remove own object (permitted).
DELETE FROM storage.objects
 WHERE bucket_id = 'profile-media'
   AND name = '00000000-0000-0000-0000-000000000003/casey-1.jpg';
RESET ROLE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM storage.objects
     WHERE bucket_id = 'profile-media'
       AND name = '00000000-0000-0000-0000-000000000003/casey-1.jpg'
  ) THEN
    RAISE EXCEPTION 'c05 H-5: owner could not delete their own profile media';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM storage.objects
     WHERE bucket_id = 'profile-media'
       AND name = '00000000-0000-0000-0000-000000000002/blair-1.jpg'
  ) THEN
    RAISE EXCEPTION 'c05 H-5: a user deleted another user''s profile media';
  END IF;
END;
$$;

ROLLBACK;
