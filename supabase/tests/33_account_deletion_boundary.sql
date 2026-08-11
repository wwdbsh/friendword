-- ACCOUNT DELETION BOUNDARY (T007, fcp Issue #44).
--
-- Deleting an account is the one operation in this product that destroys data
-- on purpose, and until now nothing in the DB harness described its edges. Two
-- things are pinned here:
--
--  A. SHARED RESOURCES. An introducer who deletes their account gives up their
--     voice; they do not get to take the dater's campaign, the dater's own
--     photo uploads, the interests strangers sent that dater, or the intro room
--     and messages that came out of them. Migration 0037 archives the campaign
--     that just lost its voice — archiving is not deleting, and the difference
--     is the whole point.
--
--  B. THE HANDLED-REFERENCE CONTRACT. `scripts/process-deletions.mjs` clears a
--     hard-coded list of tables before deleting the auth user. Every FK column
--     pointing at public.users must be accounted for in that list, either
--     because the job clears it or because the FK itself is CASCADE/SET NULL.
--     A new migration that adds an unhandled NO ACTION reference fails here,
--     which is the only place it can fail cheaply: in production it fails as a
--     half-finished erasure that leaves the account's rows standing.
--
-- The replay below performs exactly what the contract table declares, then
-- scans every user reference for leftovers — so the contract cannot claim
-- coverage it does not have.
BEGIN;

-- ========================================================================
-- FIXTURES. Three people who share one campaign.
--   …a1 introducer  — authored the pitch, recorded the voice, then deletes.
--   …a2 dater       — owns the campaign, uploaded a photo, gets the interest.
--   …a3 stranger    — sent the interest and is in the intro room.
-- ========================================================================
INSERT INTO auth.users (id, email) VALUES
  ('aaaaaaaa-0000-4000-8000-0000000000a1', 'erasure-introducer@example.test'),
  ('aaaaaaaa-0000-4000-8000-0000000000a2', 'erasure-dater@example.test'),
  ('aaaaaaaa-0000-4000-8000-0000000000a3', 'erasure-stranger@example.test');

INSERT INTO users (id, phone_verified_at) VALUES
  ('aaaaaaaa-0000-4000-8000-0000000000a1', now() - INTERVAL '20 days'),
  ('aaaaaaaa-0000-4000-8000-0000000000a2', now() - INTERVAL '20 days'),
  ('aaaaaaaa-0000-4000-8000-0000000000a3', now() - INTERVAL '20 days');

INSERT INTO profiles (user_id, display_name, birth_date, verification_status) VALUES
  ('aaaaaaaa-0000-4000-8000-0000000000a1', 'Erasure Introducer', '1990-01-01', 'verified'),
  ('aaaaaaaa-0000-4000-8000-0000000000a2', 'Erasure Dater', '1991-01-01', 'verified'),
  ('aaaaaaaa-0000-4000-8000-0000000000a3', 'Erasure Stranger', '1992-01-01', 'verified');

INSERT INTO dating_profiles (user_id, bio, photos, approximate_location) VALUES
  ('aaaaaaaa-0000-4000-8000-0000000000a1', 'Introducer bio.', ARRAY['aaaaaaaa-0000-4000-8000-0000000000a1/me.jpg'], 'Seoul'),
  ('aaaaaaaa-0000-4000-8000-0000000000a2', 'Dater bio.', ARRAY['aaaaaaaa-0000-4000-8000-0000000000a2/me.jpg'], 'Seoul'),
  ('aaaaaaaa-0000-4000-8000-0000000000a3', 'Stranger bio.', ARRAY['aaaaaaaa-0000-4000-8000-0000000000a3/me.jpg'], 'Seoul');

INSERT INTO pitch_drafts (id, created_by_user_id, subject_user_id, status, headline, body)
VALUES ('bbbbbbbb-0000-4000-8000-0000000000b1',
        'aaaaaaaa-0000-4000-8000-0000000000a1',
        'aaaaaaaa-0000-4000-8000-0000000000a2',
        'published', 'Meet my friend', 'Years of knowing them.');

INSERT INTO consent_revisions (id, pitch_draft_id, revision_number, headline, body,
                               voice_asset_path, content_hash)
VALUES ('cccccccc-0000-4000-8000-0000000000c1',
        'bbbbbbbb-0000-4000-8000-0000000000b1', 1, 'Meet my friend',
        'Years of knowing them.',
        'bbbbbbbb-0000-4000-8000-0000000000b1/voice.m4a', 'hash-erasure-1');

INSERT INTO consent_requests (id, pitch_draft_id, subject_user_id, token_hash, status,
                              responded_at, revision_id)
VALUES ('cccccccc-0000-4000-8000-0000000000c9',
        'bbbbbbbb-0000-4000-8000-0000000000b1',
        'aaaaaaaa-0000-4000-8000-0000000000a2',
        'erasure-boundary-consent-token-hash', 'approved', now() - INTERVAL '3 days',
        'cccccccc-0000-4000-8000-0000000000c1');

INSERT INTO campaigns (id, pitch_draft_id, owner_user_id, status, slug, published_at, ends_at)
VALUES ('dddddddd-0000-4000-8000-0000000000d1',
        'bbbbbbbb-0000-4000-8000-0000000000b1',
        'aaaaaaaa-0000-4000-8000-0000000000a2',
        'published', 'erasure-boundary', now() - INTERVAL '2 days', now() + INTERVAL '5 days');

INSERT INTO campaign_memberships (campaign_id, user_id, role) VALUES
  ('dddddddd-0000-4000-8000-0000000000d1', 'aaaaaaaa-0000-4000-8000-0000000000a2', 'DATER_OWNER'),
  ('dddddddd-0000-4000-8000-0000000000d1', 'aaaaaaaa-0000-4000-8000-0000000000a1', 'INTRODUCER');

-- The introducer's voice and the dater's own photo share one draft prefix.
INSERT INTO pitch_assets (pitch_draft_id, uploaded_by_user_id, asset_type, storage_path) VALUES
  ('bbbbbbbb-0000-4000-8000-0000000000b1', 'aaaaaaaa-0000-4000-8000-0000000000a1', 'voice',
   'bbbbbbbb-0000-4000-8000-0000000000b1/voice.m4a'),
  ('bbbbbbbb-0000-4000-8000-0000000000b1', 'aaaaaaaa-0000-4000-8000-0000000000a2', 'photo',
   'bbbbbbbb-0000-4000-8000-0000000000b1/dater-photo.jpg');

-- A finished export. The encoder copies the introducer's audio stream into the
-- MP4 untouched, so this object IS a second copy of the voice above.
INSERT INTO media_render_jobs (id, revision_id, campaign_id, pitch_draft_id, scene_hash,
                               requested_by_user_id, status)
VALUES ('eeeeeeee-0000-4000-8000-0000000000e1',
        'cccccccc-0000-4000-8000-0000000000c1',
        'dddddddd-0000-4000-8000-0000000000d1',
        'bbbbbbbb-0000-4000-8000-0000000000b1',
        'scene-hash-erasure',
        'aaaaaaaa-0000-4000-8000-0000000000a1',
        'queued');
UPDATE media_render_jobs
   SET status = 'leased', lease_token = gen_random_uuid(),
       leased_at = now(), lease_expires_at = now() + INTERVAL '5 minutes'
 WHERE id = 'eeeeeeee-0000-4000-8000-0000000000e1';
UPDATE media_render_jobs
   SET status = 'done', lease_token = NULL, leased_at = NULL, lease_expires_at = NULL,
       output_storage_path =
         'pitch-media/bbbbbbbb-0000-4000-8000-0000000000b1/renders/cccccccc-0000-4000-8000-0000000000c1.mp4',
       output_bytes = 1024, output_duration_ms = 45000
 WHERE id = 'eeeeeeee-0000-4000-8000-0000000000e1';

-- The campaign's consumed free render (0054). It carries NO user reference: it
-- hangs off the campaign and off the render job. The render job is the
-- introducer's, and the deletion job removes it — so this row goes with it, by
-- cascade, even though the campaign it belongs to is the dater's.
INSERT INTO pitch_render_unlocks (id, campaign_id, render_job_id)
VALUES ('77777777-0000-4000-8000-000000000071',
        'dddddddd-0000-4000-8000-0000000000d1',
        'eeeeeeee-0000-4000-8000-0000000000e1');

-- The Creator Launch kit on the shared draft, paid for by the INTRODUCER — the
-- person about to delete their account. `share_kits.credit_ledger_id` is a
-- RESTRICT FK, so the kit row has to go before the credit it consumed can.
INSERT INTO purchase_credit_ledger (id, user_id, credit_state, product_id,
                                    pitch_draft_id, idempotency_key)
VALUES ('66666666-0000-4000-8000-000000000061',
        'aaaaaaaa-0000-4000-8000-0000000000a1',
        'consumed', 'creator_launch_credit_499',
        'bbbbbbbb-0000-4000-8000-0000000000b1',
        '33-erasure-share-kit-credit');

INSERT INTO share_kits (id, pitch_draft_id, unlocked_by_user_id, credit_ledger_id)
VALUES ('55555555-0000-4000-8000-000000000051',
        'bbbbbbbb-0000-4000-8000-0000000000b1',
        'aaaaaaaa-0000-4000-8000-0000000000a1',
        '66666666-0000-4000-8000-000000000061');

INSERT INTO storage.objects (bucket_id, name, owner_id) VALUES
  ('pitch-media', 'bbbbbbbb-0000-4000-8000-0000000000b1/voice.m4a',
   'aaaaaaaa-0000-4000-8000-0000000000a1'),
  ('pitch-media', 'bbbbbbbb-0000-4000-8000-0000000000b1/dater-photo.jpg',
   'aaaaaaaa-0000-4000-8000-0000000000a2'),
  ('pitch-media', 'bbbbbbbb-0000-4000-8000-0000000000b1/renders/cccccccc-0000-4000-8000-0000000000c1.mp4',
   'aaaaaaaa-0000-4000-8000-0000000000a1'),
  ('profile-media', 'aaaaaaaa-0000-4000-8000-0000000000a1/me.jpg',
   'aaaaaaaa-0000-4000-8000-0000000000a1'),
  ('profile-media', 'aaaaaaaa-0000-4000-8000-0000000000a2/me.jpg',
   'aaaaaaaa-0000-4000-8000-0000000000a2');

INSERT INTO media_validations (bucket_id, object_name, validated_at, mime_ok, magic_ok,
                               size_ok, decode_ok, moderation_status) VALUES
  ('pitch-media', 'bbbbbbbb-0000-4000-8000-0000000000b1/voice.m4a', now(), true, true, true, true, 'passed'),
  ('pitch-media', 'bbbbbbbb-0000-4000-8000-0000000000b1/renders/cccccccc-0000-4000-8000-0000000000c1.mp4',
   now(), true, true, true, true, 'passed'),
  ('pitch-media', 'bbbbbbbb-0000-4000-8000-0000000000b1/dater-photo.jpg', now(), true, true, true, true, 'passed');

INSERT INTO interests (id, campaign_id, sender_user_id, status, note, submitted_at, decided_at)
VALUES ('ffffffff-0000-4000-8000-0000000000f1',
        'dddddddd-0000-4000-8000-0000000000d1',
        'aaaaaaaa-0000-4000-8000-0000000000a3',
        'accepted', 'I would love an introduction.',
        now() - INTERVAL '1 day', now() - INTERVAL '12 hours');

INSERT INTO intro_rooms (id, campaign_id, dater_user_id, interested_user_id, status)
VALUES ('99999999-0000-4000-8000-000000000091',
        'dddddddd-0000-4000-8000-0000000000d1',
        'aaaaaaaa-0000-4000-8000-0000000000a2',
        'aaaaaaaa-0000-4000-8000-0000000000a3', 'open');

INSERT INTO messages (intro_room_id, sender_user_id, body) VALUES
  ('99999999-0000-4000-8000-000000000091', 'aaaaaaaa-0000-4000-8000-0000000000a2', 'Hello!'),
  ('99999999-0000-4000-8000-000000000091', 'aaaaaaaa-0000-4000-8000-0000000000a3', 'Hi back!');

-- ========================================================================
-- A. The synchronous request: 0037's introducer erasure.
-- ========================================================================
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-4000-8000-0000000000a1', true);
SELECT deletion_status FROM request_account_deletion();
RESET ROLE;

DO $$
BEGIN
  IF (SELECT account_status FROM users WHERE id = 'aaaaaaaa-0000-4000-8000-0000000000a1')
       <> 'deleted' THEN
    RAISE EXCEPTION '33: the requesting account was not marked deleted';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pitch_assets
     WHERE uploaded_by_user_id = 'aaaaaaaa-0000-4000-8000-0000000000a1'
       AND asset_type = 'voice'
  ) THEN
    RAISE EXCEPTION '33: the introducer voice asset row survived the request';
  END IF;

  -- Shared resources: archived, not destroyed.
  IF (SELECT status FROM campaigns WHERE id = 'dddddddd-0000-4000-8000-0000000000d1')
       <> 'archived' THEN
    RAISE EXCEPTION '33: the voiceless campaign was not archived';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM campaigns WHERE id = 'dddddddd-0000-4000-8000-0000000000d1') THEN
    RAISE EXCEPTION '33: the dater lost their campaign to someone else''s deletion';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pitch_assets
     WHERE uploaded_by_user_id = 'aaaaaaaa-0000-4000-8000-0000000000a2'
       AND asset_type = 'photo'
  ) THEN
    RAISE EXCEPTION '33: the dater''s own photo asset was erased';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM interests WHERE id = 'ffffffff-0000-4000-8000-0000000000f1') THEN
    RAISE EXCEPTION '33: a stranger''s interest was erased with the introducer';
  END IF;
  IF (SELECT count(*) FROM messages
       WHERE intro_room_id = '99999999-0000-4000-8000-000000000091') <> 2 THEN
    RAISE EXCEPTION '33: the dater''s intro room conversation was destroyed';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM dating_profiles WHERE user_id = 'aaaaaaaa-0000-4000-8000-0000000000a2'
  ) THEN
    RAISE EXCEPTION '33: the dater''s profile was erased';
  END IF;

  -- Guards against a vacuous post-replay assertion: the two paid-benefit rows
  -- whose disposal section C pins must actually be here before it runs.
  IF NOT EXISTS (SELECT 1 FROM pitch_render_unlocks
                  WHERE campaign_id = 'dddddddd-0000-4000-8000-0000000000d1') THEN
    RAISE EXCEPTION '33: the free-render ledger fixture is missing before the replay';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM share_kits
                  WHERE pitch_draft_id = 'bbbbbbbb-0000-4000-8000-0000000000b1') THEN
    RAISE EXCEPTION '33: the share kit fixture is missing before the replay';
  END IF;
END;
$$;

-- ========================================================================
-- B. The handled-reference contract.
--
-- `strategy` says HOW the deletion job disposes of each reference:
--   job_delete   — the job deletes the rows outright.
--   job_scope    — the job deletes the owning object (campaign/room/draft), so
--                  the reference goes with it.
--   job_transfer — the job hands the row to the surviving campaign owner.
--   job_anonymize— the row is kept for safety audit with the user detached.
--   fk_cascade   — the FK removes it when the auth user goes.
--   fk_set_null  — the FK detaches it when the auth user goes.
-- The last two are also verified against the live catalog, so a migration that
-- downgrades one to NO ACTION cannot keep claiming automatic disposal.
-- ========================================================================
CREATE TEMP TABLE erasure_contract (tbl TEXT, col TEXT, strategy TEXT) ON COMMIT DROP;
INSERT INTO erasure_contract (tbl, col, strategy) VALUES
  ('public.ai_processing_consents', 'user_id', 'fk_cascade'),
  ('public.analytics_events', 'user_id', 'fk_set_null'),
  ('public.blocks', 'blocked_user_id', 'job_delete'),
  ('public.blocks', 'blocker_user_id', 'job_delete'),
  ('public.campaign_memberships', 'user_id', 'job_delete'),
  ('public.campaigns', 'owner_user_id', 'job_scope'),
  ('public.consent_requests', 'subject_user_id', 'job_scope'),
  ('public.dating_profiles', 'user_id', 'fk_cascade'),
  ('public.interest_intents', 'interested_user_id', 'fk_cascade'),
  ('public.interests', 'sender_user_id', 'job_delete'),
  ('public.intro_rooms', 'dater_user_id', 'job_scope'),
  ('public.intro_rooms', 'interested_user_id', 'job_scope'),
  ('public.introducer_profiles', 'user_id', 'fk_cascade'),
  ('public.media_render_jobs', 'requested_by_user_id', 'fk_set_null'),
  ('public.messages', 'sender_user_id', 'job_delete'),
  ('public.notification_outbox', 'recipient_user_id', 'fk_cascade'),
  ('public.pitch_assets', 'uploaded_by_user_id', 'job_delete'),
  ('public.pitch_drafts', 'created_by_user_id', 'job_transfer'),
  ('public.pitch_drafts', 'subject_user_id', 'job_scope'),
  ('public.profiles', 'user_id', 'fk_cascade'),
  ('public.provider_usage_events', 'user_id', 'fk_set_null'),
  ('public.purchase_credit_ledger', 'user_id', 'job_delete'),
  ('public.purchase_events', 'purchaser_user_id', 'job_delete'),
  ('public.purchase_intents', 'user_id', 'job_delete'),
  ('public.referral_claims', 'claimed_by_user_id', 'fk_cascade'),
  ('public.reports', 'reported_user_id', 'job_anonymize'),
  ('public.reports', 'reporter_user_id', 'job_anonymize'),
  -- 0060: enrolment is an ops-held test marker, not user content. It carries
  -- nothing but the id, so the FK cascade is the whole cleanup.
  ('public.sandbox_test_accounts', 'user_id', 'fk_cascade'),
  ('public.share_kits', 'unlocked_by_user_id', 'job_delete'),
  ('public.text_moderations', 'subject_user_id', 'fk_set_null'),
  ('public.verification_checks', 'user_id', 'job_delete'),
  ('public.video_moderation_reviews', 'uploaded_by_user_id', 'fk_set_null'),
  ('public.vouches', 'author_user_id', 'job_delete');

-- The live catalog, schema-qualified so it lines up with the contract above.
CREATE TEMP TABLE live_user_refs AS
SELECT n.nspname || '.' || cl.relname AS tbl,
       a.attname::TEXT AS col,
       CASE c.confdeltype WHEN 'c' THEN 'fk_cascade' WHEN 'n' THEN 'fk_set_null'
                          ELSE 'job' END AS catalog_strategy
  FROM pg_constraint c
  JOIN pg_class cl ON cl.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = cl.relnamespace
  JOIN unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
 WHERE c.contype = 'f' AND c.confrelid = 'public.users'::regclass;

DO $$
DECLARE
  unhandled TEXT;
  stale TEXT;
  mismatched TEXT;
BEGIN
  SELECT string_agg(l.tbl || '.' || l.col, ', ' ORDER BY l.tbl, l.col)
    INTO unhandled
    FROM live_user_refs l
    LEFT JOIN erasure_contract e ON e.tbl = l.tbl AND e.col = l.col
   WHERE e.tbl IS NULL;
  IF unhandled IS NOT NULL THEN
    RAISE EXCEPTION
      '33: user reference(s) with no account-deletion strategy: %. Add the cleanup to scripts/process-deletions.mjs and the entry here.',
      unhandled;
  END IF;

  SELECT string_agg(e.tbl || '.' || e.col, ', ' ORDER BY e.tbl, e.col)
    INTO stale
    FROM erasure_contract e
    LEFT JOIN live_user_refs l ON l.tbl = e.tbl AND l.col = e.col
   WHERE l.tbl IS NULL;
  IF stale IS NOT NULL THEN
    RAISE EXCEPTION '33: the contract still claims reference(s) that no longer exist: %', stale;
  END IF;

  SELECT string_agg(e.tbl || '.' || e.col || ' claims ' || e.strategy, ', ')
    INTO mismatched
    FROM erasure_contract e
    JOIN live_user_refs l ON l.tbl = e.tbl AND l.col = e.col
   WHERE (e.strategy LIKE 'fk%' AND e.strategy <> l.catalog_strategy)
      OR (e.strategy LIKE 'job%' AND l.catalog_strategy <> 'job');
  IF mismatched IS NOT NULL THEN
    RAISE EXCEPTION '33: contract disagrees with the live FK behavior: %', mismatched;
  END IF;
END;
$$;

-- ========================================================================
-- C. Replay the job's relational stages for the deleted introducer and prove
--    the contract is sufficient: nothing may still point at them afterwards.
--    The voice-derived object purge (T007) is replayed too — a preserved draft
--    keeps its prefix, so voice.m4a AND the render that copies the same audio
--    stream have to be named explicitly.
-- ========================================================================
SET LOCAL ROLE service_role;
DO $$
DECLARE
  target UUID := 'aaaaaaaa-0000-4000-8000-0000000000a1';
  preserved UUID := 'bbbbbbbb-0000-4000-8000-0000000000b1';
  new_owner UUID := 'aaaaaaaa-0000-4000-8000-0000000000a2';
BEGIN
  -- job_anonymize
  UPDATE reports SET reporter_user_id = NULL, anon_report = true WHERE reporter_user_id = target;
  UPDATE reports SET reported_user_id = NULL WHERE reported_user_id = target;

  -- Voice-derived object purge on the preserved prefix. This runs BEFORE the
  -- transfer, and the order is the contract, not a detail: the transfer is what
  -- makes the draft invisible to the job's scope query
  -- (`created_by_user_id = target OR subject_user_id = target`), so a run that
  -- died between the two would leave the recording in storage with every retry
  -- converging on "nothing to do". Within the purge, the render job row goes
  -- first: `output_storage_path` must never outlive the object it advertises.
  DELETE FROM media_render_jobs WHERE pitch_draft_id = preserved;
  DELETE FROM storage.objects
   WHERE bucket_id = 'pitch-media'
     AND (name = preserved::TEXT || '/voice.m4a'
          OR name LIKE preserved::TEXT || '/renders/%');
  DELETE FROM media_validations
   WHERE bucket_id = 'pitch-media'
     AND (object_name = preserved::TEXT || '/voice.m4a'
          OR object_name LIKE preserved::TEXT || '/renders/%');

  -- job_transfer (the draft stays alive for the campaign owner)
  PERFORM reassign_pitch_storage_owner(preserved, new_owner);
  UPDATE pitch_assets SET uploaded_by_user_id = new_owner
   WHERE pitch_draft_id = preserved AND uploaded_by_user_id = target;
  UPDATE pitch_drafts SET created_by_user_id = new_owner
   WHERE id = preserved AND created_by_user_id = target;

  -- job_delete (own profile-media prefix goes with the account)
  DELETE FROM storage.objects
   WHERE bucket_id = 'profile-media' AND name LIKE target::TEXT || '/%';
  DELETE FROM media_validations
   WHERE bucket_id = 'profile-media' AND object_name LIKE target::TEXT || '/%';
  DELETE FROM share_kits WHERE unlocked_by_user_id = target;
  DELETE FROM messages WHERE sender_user_id = target;
  DELETE FROM interests WHERE sender_user_id = target;
  DELETE FROM vouches WHERE author_user_id = target;
  DELETE FROM campaign_memberships WHERE user_id = target;
  DELETE FROM blocks WHERE blocker_user_id = target OR blocked_user_id = target;
  DELETE FROM verification_checks WHERE user_id = target;
  DELETE FROM purchase_credit_ledger WHERE user_id = target;
  DELETE FROM purchase_intents WHERE user_id = target;
  DELETE FROM purchase_events WHERE purchaser_user_id = target;
  DELETE FROM pitch_assets WHERE uploaded_by_user_id = target;
END;
$$;
RESET ROLE;

-- The GoTrue admin delete is the last stage; it runs outside the service_role
-- table grants, so the harness performs it as the owner.
DELETE FROM auth.users WHERE id = 'aaaaaaaa-0000-4000-8000-0000000000a1';

DO $$
DECLARE
  leftovers TEXT;
  r RECORD;
  n BIGINT;
BEGIN
  leftovers := NULL;
  FOR r IN SELECT tbl, col FROM erasure_contract LOOP
    EXECUTE format('SELECT count(*) FROM %s WHERE %I = $1', r.tbl, r.col)
       INTO n USING 'aaaaaaaa-0000-4000-8000-0000000000a1'::UUID;
    IF n > 0 THEN
      leftovers := concat_ws(', ', leftovers, r.tbl || '.' || r.col || '=' || n);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM users WHERE id = 'aaaaaaaa-0000-4000-8000-0000000000a1') THEN
    leftovers := concat_ws(', ', leftovers, 'public.users.id');
  END IF;
  IF leftovers IS NOT NULL THEN
    RAISE EXCEPTION '33: rows still reference the erased account: %', leftovers;
  END IF;

  -- The voice, and everything that carries it, is gone from storage.
  IF EXISTS (
    SELECT 1 FROM storage.objects
     WHERE bucket_id = 'pitch-media'
       AND name = 'bbbbbbbb-0000-4000-8000-0000000000b1/voice.m4a'
  ) THEN
    RAISE EXCEPTION '33: the introducer voice object survived on the preserved draft';
  END IF;
  IF EXISTS (
    SELECT 1 FROM storage.objects
     WHERE bucket_id = 'pitch-media'
       AND name LIKE 'bbbbbbbb-0000-4000-8000-0000000000b1/renders/%'
  ) THEN
    RAISE EXCEPTION
      '33: a rendered MP4 carrying the erased voice survived on the preserved draft';
  END IF;
  IF EXISTS (SELECT 1 FROM media_render_jobs
              WHERE pitch_draft_id = 'bbbbbbbb-0000-4000-8000-0000000000b1') THEN
    RAISE EXCEPTION '33: a render job still advertises an erased output object';
  END IF;

  -- INTENDED CONSEQUENCE, pinned rather than discovered later. The free-render
  -- ledger row belongs to the DATER's campaign, but it hangs off the
  -- introducer's render job by `ON DELETE CASCADE` (0054), so deleting the job
  -- takes it. The dater's campaign therefore gets its one free render back. We
  -- accept that: the render it had paid for no longer exists (its audio was the
  -- erased voice), so charging them for the replacement would be charging twice
  -- for a deletion they did not ask for. If this ever needs to change, it is a
  -- deliberate product decision, not a cascade to tidy away.
  IF EXISTS (SELECT 1 FROM pitch_render_unlocks
              WHERE campaign_id = 'dddddddd-0000-4000-8000-0000000000d1') THEN
    RAISE EXCEPTION
      '33: the free-render ledger row outlived the render job it cascades from';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM campaigns WHERE id = 'dddddddd-0000-4000-8000-0000000000d1') THEN
    RAISE EXCEPTION '33: the unlock cascade took the campaign with it';
  END IF;

  -- INTENDED CONSEQUENCE #2: the deleted account was the PAYER of the share kit
  -- on a draft that survives for someone else. `share_kits.unlocked_by_user_id`
  -- is a plain NO ACTION FK, so the job deletes the kit row by payer — the
  -- preserved draft loses a paid benefit that was never the dater's to begin
  -- with. The alternative (transferring the kit to the new owner) would hand
  -- one person's purchase to another, so the kit goes. The RESTRICT FK on
  -- `credit_ledger_id` is what forces this to happen before the credit row,
  -- which is the ordering the job's `purchase reference cleanup` stage encodes.
  IF EXISTS (SELECT 1 FROM share_kits
              WHERE pitch_draft_id = 'bbbbbbbb-0000-4000-8000-0000000000b1') THEN
    RAISE EXCEPTION '33: the deleted payer''s share kit outlived their account';
  END IF;
  IF EXISTS (SELECT 1 FROM purchase_credit_ledger
              WHERE id = '66666666-0000-4000-8000-000000000061') THEN
    RAISE EXCEPTION '33: the credit the erased share kit consumed was left behind';
  END IF;
  IF EXISTS (
    SELECT 1 FROM storage.objects
     WHERE bucket_id = 'profile-media'
       AND name LIKE 'aaaaaaaa-0000-4000-8000-0000000000a1/%'
  ) THEN
    RAISE EXCEPTION '33: the erased account''s profile media survived';
  END IF;

  -- …and the people who shared the campaign still have theirs.
  IF NOT EXISTS (
    SELECT 1 FROM storage.objects
     WHERE bucket_id = 'pitch-media'
       AND name = 'bbbbbbbb-0000-4000-8000-0000000000b1/dater-photo.jpg'
  ) THEN
    RAISE EXCEPTION '33: the dater''s own photo object was erased';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM storage.objects
     WHERE bucket_id = 'profile-media'
       AND name = 'aaaaaaaa-0000-4000-8000-0000000000a2/me.jpg'
  ) THEN
    RAISE EXCEPTION '33: the dater''s profile media was erased';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pitch_drafts WHERE id = 'bbbbbbbb-0000-4000-8000-0000000000b1') THEN
    RAISE EXCEPTION '33: the preserved draft was erased instead of transferred';
  END IF;
  IF (SELECT created_by_user_id FROM pitch_drafts
       WHERE id = 'bbbbbbbb-0000-4000-8000-0000000000b1')
       <> 'aaaaaaaa-0000-4000-8000-0000000000a2' THEN
    RAISE EXCEPTION '33: the preserved draft was not transferred to the campaign owner';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM campaigns WHERE id = 'dddddddd-0000-4000-8000-0000000000d1') THEN
    RAISE EXCEPTION '33: the dater''s campaign was deleted by someone else''s erasure';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM interests WHERE id = 'ffffffff-0000-4000-8000-0000000000f1') THEN
    RAISE EXCEPTION '33: a stranger''s interest was deleted by the introducer''s erasure';
  END IF;
  IF (SELECT count(*) FROM messages
       WHERE intro_room_id = '99999999-0000-4000-8000-000000000091') <> 2 THEN
    RAISE EXCEPTION '33: the dater''s conversation was deleted by the introducer''s erasure';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE user_id = 'aaaaaaaa-0000-4000-8000-0000000000a3') THEN
    RAISE EXCEPTION '33: the stranger''s profile was deleted by the introducer''s erasure';
  END IF;
END;
$$;

-- The deletion request itself outlives the account on purpose: it is the
-- operator's record that the erasure ran. It carries no FK to users (nothing to
-- cascade) and no personal data beyond the identifier.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM deletion_requests
     WHERE user_id = 'aaaaaaaa-0000-4000-8000-0000000000a1' AND scope = 'account'
  ) THEN
    RAISE EXCEPTION '33: the deletion request record was lost with the account';
  END IF;
END;
$$;

ROLLBACK;
