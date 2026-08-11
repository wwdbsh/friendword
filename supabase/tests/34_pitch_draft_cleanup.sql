-- Migration 0059 regressions: delete_my_pitch_draft lets an Introducer clear a
-- pitch of theirs that never became a campaign, and refuses everything else.
--
-- Same shape as 22_pitch_asset_removal.sql: every refusal pins the EXACT server
-- message, and every guard carries a positive control in which the identical
-- call succeeds once the single disqualifying fact is undone — so a fixture
-- that stops reaching a guard fails instead of passing vacuously.
--
-- ONE STRUCTURAL NOTE. The call is made as `authenticated` and the assertions
-- are made after RESET ROLE, through pg_temp.outcome. That is not tidiness: a
-- client role sees pitch_drafts through RLS and cannot read the service-only
-- tables (media_validations, media_ingest_jobs, ops_alerts) at all, so
-- "the row is gone" and "the row is invisible to me" would be the same
-- observation, and a guard that deleted everything would read as green.
--
-- The file also pins the decision that made this a new RPC rather than a reuse
-- of erase_pitch_draft: cleanup must leave the moderation trace that erasure
-- deliberately suppresses (GUARD-C9).
BEGIN;

-- ═══ Fixture ══════════════════════════════════════════════════════════
-- Drew (…0004) is an Introducer. D1 is the shape ACC-5 is about: an invite that
-- went out and was never answered, with a voice recording, a photo, a clip, a
-- consent request and the revision the friend was asked to look at. It has no
-- campaign, because nobody ever approved it.
INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
VALUES
  ('pitch-media', '34000000-0000-0000-0000-000000000001/voice.m4a',
   '00000000-0000-0000-0000-000000000004', '{"mimetype":"audio/mp4"}'),
  ('pitch-media', '34000000-0000-0000-0000-000000000001/photo-1.jpg',
   '00000000-0000-0000-0000-000000000004', '{"mimetype":"image/jpeg"}'),
  ('pitch-media', '34000000-0000-0000-0000-000000000001/clip-1.mp4',
   '00000000-0000-0000-0000-000000000004', '{"mimetype":"video/mp4"}'),
  ('pitch-media', '34000000-0000-0000-0000-000000000002/voice.m4a',
   '00000000-0000-0000-0000-000000000004', '{"mimetype":"audio/mp4"}');

INSERT INTO pitch_drafts (id, created_by_user_id, subject_user_id, status, headline, body)
VALUES
  -- D1: consent_pending, unanswered. The main subject of this file.
  ('34000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000004',
   NULL, 'consent_pending', 'A pitch nobody answered', 'Body.'),
  -- D2: Drew's other draft. Never named by a successful call; it is the
  -- collateral-damage control.
  ('34000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000004',
   NULL, 'draft', 'Another draft of Drew''s', 'Body.'),
  -- D3: Alex's draft, used for the not-yours guard.
  ('34000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001',
   NULL, 'draft', 'Alex''s draft', 'Body.'),
  -- D4: campaign-less but marked published — the status half of guard (1),
  -- provable on its own because no campaigns row points at it.
  ('34000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000004',
   NULL, 'published', 'Published with no campaign row', 'Body.'),
  -- D5: the purchase guard.
  ('34000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000004',
   NULL, 'draft', 'A draft somebody paid for', 'Body.'),
  -- D6: the render-job guard.
  ('34000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000004',
   NULL, 'draft', 'A draft with a render job', 'Body.'),
  -- D7 and D8: the cleanup/erasure contrast in GUARD-C9.
  ('34000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000004',
   NULL, 'draft', 'A flagged draft cleaned up', 'Body.'),
  ('34000000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-000000000004',
   NULL, 'draft', 'A flagged draft erased', 'Body.');

INSERT INTO pitch_assets (id, pitch_draft_id, uploaded_by_user_id, asset_type, storage_path, sort_order)
VALUES
  ('34100000-0000-0000-0000-000000000001', '34000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000004', 'voice',
   'pitch-media/34000000-0000-0000-0000-000000000001/voice.m4a', 0),
  ('34100000-0000-0000-0000-000000000002', '34000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000004', 'photo',
   'pitch-media/34000000-0000-0000-0000-000000000001/photo-1.jpg', 0),
  ('34100000-0000-0000-0000-000000000003', '34000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000004', 'video',
   'pitch-media/34000000-0000-0000-0000-000000000001/clip-1.mp4', 1),
  ('34100000-0000-0000-0000-000000000004', '34000000-0000-0000-0000-000000000002',
   '00000000-0000-0000-0000-000000000004', 'voice',
   'pitch-media/34000000-0000-0000-0000-000000000002/voice.m4a', 0),
  ('34100000-0000-0000-0000-000000000007', '34000000-0000-0000-0000-000000000007',
   '00000000-0000-0000-0000-000000000004', 'video',
   'pitch-media/34000000-0000-0000-0000-000000000007/clip-1.mp4', 0),
  ('34100000-0000-0000-0000-000000000008', '34000000-0000-0000-0000-000000000008',
   '00000000-0000-0000-0000-000000000004', 'video',
   'pitch-media/34000000-0000-0000-0000-000000000008/clip-1.mp4', 0);

-- Registering a video asset enqueues its ingest job in the same statement
-- (0050 private.enqueue_video_ingest), so the three clips above already carry
-- one. D1's stays queued — that IS the C4 fixture, arrived at the way a real
-- draft arrives at it. The two flagged-clip drafts are settled here so C9 tests
-- the moderation trace rather than re-testing C4.
-- Walked through 'leased', because the state machine (0050) has no queued->done
-- edge and a fixture that fakes one would be testing a state the product cannot
-- reach.
UPDATE media_ingest_jobs
   SET status = 'leased', lease_token = gen_random_uuid(),
       leased_at = now(), lease_expires_at = now() + INTERVAL '5 minutes'
 WHERE asset_id IN (
   '34100000-0000-0000-0000-000000000007',
   '34100000-0000-0000-0000-000000000008'
 );
UPDATE media_ingest_jobs
   SET status = 'done', lease_token = NULL, leased_at = NULL, lease_expires_at = NULL
 WHERE asset_id IN (
   '34100000-0000-0000-0000-000000000007',
   '34100000-0000-0000-0000-000000000008'
 );

INSERT INTO consent_revisions (
  id, pitch_draft_id, revision_number, headline, body, asset_ids, voice_asset_path, content_hash
)
VALUES
  ('34200000-0000-0000-0000-000000000001', '34000000-0000-0000-0000-000000000001', 1,
   'A pitch nobody answered', 'Body.',
   ARRAY['34100000-0000-0000-0000-000000000002']::UUID[],
   'pitch-media/34000000-0000-0000-0000-000000000001/voice.m4a', 'hash-34-1'),
  ('34200000-0000-0000-0000-000000000006', '34000000-0000-0000-0000-000000000006', 1,
   'A draft with a render job', 'Body.', '{}'::UUID[], NULL, 'hash-34-6'),
  -- On D2, which survives every call in this file, so C10 has a revision to
  -- try to mutate after the deletions have run.
  ('34200000-0000-0000-0000-000000000002', '34000000-0000-0000-0000-000000000002', 1,
   'Another draft of Drew''s', 'Body.', '{}'::UUID[], NULL, 'hash-34-2');

-- The invite binding is mandatory for a pending request (0029), which is
-- exactly right for this fixture: the dead draft is the one whose invite went
-- out to a real contact and was never opened.
INSERT INTO consent_requests (
  id, pitch_draft_id, subject_user_id, token_hash, status, revision_id,
  invite_contact_hash, invite_contact_channel
)
VALUES (
  '34300000-0000-0000-0000-000000000001', '34000000-0000-0000-0000-000000000001',
  NULL, 'cleanup-test-consent-token-hash', 'pending',
  '34200000-0000-0000-0000-000000000001',
  'cleanup-test-invite-contact-hash', 'email'
);

-- The validation ledger for D1's prefix. Nothing cascades these — the RPC has
-- to name them, the way scripts/lib/accountErasure.mjs does.
INSERT INTO media_validations (
  bucket_id, object_name, validated_at, mime_ok, magic_ok, size_ok, decode_ok, moderation_status
)
VALUES
  ('pitch-media', '34000000-0000-0000-0000-000000000001/voice.m4a',
   now(), true, true, true, true, 'passed'),
  ('pitch-media', '34000000-0000-0000-0000-000000000001/photo-1.jpg',
   now(), true, true, true, true, 'passed'),
  -- Nested, the way a render output is named. A prefix rule has to reach it.
  ('pitch-media', '34000000-0000-0000-0000-000000000001/renders/34200000-0000-0000-0000-000000000001.mp4',
   now(), true, true, true, true, 'passed'),
  -- D2's, which must survive every call below.
  ('pitch-media', '34000000-0000-0000-0000-000000000002/voice.m4a',
   now(), true, true, true, true, 'passed');

-- Each call records its server answer here, so the assertions can run with full
-- visibility instead of through the caller's RLS. NULL means "the call
-- succeeded"; the `succeeded` column keeps that distinguishable from a missing
-- step, which would otherwise read as a silent pass.
CREATE TABLE pg_temp.outcome (
  step TEXT PRIMARY KEY,
  message TEXT,
  succeeded BOOLEAN NOT NULL
);
GRANT ALL ON pg_temp.outcome TO authenticated, anon;

CREATE FUNCTION pg_temp.try_delete(step TEXT, draft_id UUID)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  failure TEXT := NULL;
  ok BOOLEAN := true;
BEGIN
  BEGIN
    PERFORM public.delete_my_pitch_draft(draft_id);
  EXCEPTION WHEN OTHERS THEN
    failure := SQLERRM;
    ok := false;
  END;
  INSERT INTO pg_temp.outcome (step, message, succeeded) VALUES (step, failure, ok);
END;
$$;
GRANT EXECUTE ON FUNCTION pg_temp.try_delete(TEXT, UUID) TO authenticated, anon;

-- Reads one recorded answer and raises unless it is the expected refusal.
-- A missing step is a failure, not a pass.
CREATE FUNCTION pg_temp.expect_refusal(step TEXT, expected TEXT)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  row_found pg_temp.outcome;
BEGIN
  SELECT * INTO row_found FROM pg_temp.outcome WHERE outcome.step = expect_refusal.step;
  IF NOT FOUND THEN
    RAISE EXCEPTION '% was never attempted', step;
  END IF;
  IF row_found.succeeded THEN
    RAISE EXCEPTION '% was allowed through', step;
  END IF;
  IF row_found.message IS DISTINCT FROM expected THEN
    RAISE EXCEPTION '% refused with "%"', step, row_found.message;
  END IF;
END;
$$;

CREATE FUNCTION pg_temp.expect_success(step TEXT)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  row_found pg_temp.outcome;
BEGIN
  SELECT * INTO row_found FROM pg_temp.outcome WHERE outcome.step = expect_success.step;
  IF NOT FOUND THEN
    RAISE EXCEPTION '% was never attempted', step;
  END IF;
  IF NOT row_found.succeeded THEN
    RAISE EXCEPTION '% was refused with "%"', step, row_found.message;
  END IF;
END;
$$;

-- ═══ Guard C1: no session, no deletion ════════════════════════════════
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT pg_temp.try_delete('C1-anonymous', '34000000-0000-0000-0000-000000000001');
RESET ROLE;
DO $$
BEGIN
  PERFORM pg_temp.expect_refusal('C1-anonymous', 'authentication required');
  IF NOT EXISTS (SELECT 1 FROM pitch_drafts WHERE id = '34000000-0000-0000-0000-000000000001') THEN
    RAISE EXCEPTION 'GUARD-C1: the draft went away despite the refusal';
  END IF;
END;
$$;

-- ═══ Guard C2: only the creator, and no existence oracle ══════════════
-- Alex is not the creator of D1. A draft that exists and an id that does not
-- must answer alike, so a caller cannot enumerate other people's drafts.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
SELECT pg_temp.try_delete('C2-existing', '34000000-0000-0000-0000-000000000001');
SELECT pg_temp.try_delete('C2-missing', '34000000-0000-0000-0000-0000000000ff');
RESET ROLE;
DO $$
DECLARE
  existing TEXT;
  missing TEXT;
BEGIN
  PERFORM pg_temp.expect_refusal('C2-existing', 'pitch not found or not yours to delete');
  PERFORM pg_temp.expect_refusal('C2-missing', 'pitch not found or not yours to delete');
  SELECT message INTO existing FROM pg_temp.outcome WHERE step = 'C2-existing';
  SELECT message INTO missing FROM pg_temp.outcome WHERE step = 'C2-missing';
  IF existing IS DISTINCT FROM missing THEN
    RAISE EXCEPTION 'GUARD-C2: the RPC is an existence oracle ("%" vs "%")', existing, missing;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pitch_drafts WHERE id = '34000000-0000-0000-0000-000000000001') THEN
    RAISE EXCEPTION 'GUARD-C2: the draft went away despite the refusal';
  END IF;
END;
$$;

-- The SUBJECT of a draft can read it (policy pitch_drafts_select_participants)
-- and still cannot delete it: authorization is authorship, not participation.
UPDATE pitch_drafts SET subject_user_id = '00000000-0000-0000-0000-000000000001'
 WHERE id = '34000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
SELECT pg_temp.try_delete('C2-subject', '34000000-0000-0000-0000-000000000001');
RESET ROLE;
DO $$
BEGIN
  PERFORM pg_temp.expect_refusal('C2-subject', 'pitch not found or not yours to delete');
  IF NOT EXISTS (SELECT 1 FROM pitch_drafts WHERE id = '34000000-0000-0000-0000-000000000001') THEN
    RAISE EXCEPTION 'GUARD-C2: the subject deleted a draft they only appear in';
  END IF;
END;
$$;
UPDATE pitch_drafts SET subject_user_id = NULL
 WHERE id = '34000000-0000-0000-0000-000000000001';

-- ═══ Guard C3: a pitch with a campaign is not the Introducer's to delete ══
-- Gate rule (1). The seed draft …0002 is Drew's and carries campaign …0002.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);
SELECT pg_temp.try_delete('C3-campaign', '10000000-0000-0000-0000-000000000002');
SELECT pg_temp.try_delete('C3-published', '34000000-0000-0000-0000-000000000004');
RESET ROLE;
DO $$
BEGIN
  PERFORM pg_temp.expect_refusal(
    'C3-campaign', 'a published pitch is taken down by the person it is about'
  );
  IF NOT EXISTS (SELECT 1 FROM campaigns WHERE id = '20000000-0000-0000-0000-000000000002')
     OR NOT EXISTS (SELECT 1 FROM pitch_drafts WHERE id = '10000000-0000-0000-0000-000000000002') THEN
    RAISE EXCEPTION 'GUARD-C3: the campaign or its draft went away despite the refusal';
  END IF;
  -- The status half, proved on its own: D4 is 'published' with NO campaigns
  -- row, so this refusal cannot be coming from the foreign key.
  IF EXISTS (
    SELECT 1 FROM campaigns WHERE pitch_draft_id = '34000000-0000-0000-0000-000000000004'
  ) THEN
    RAISE EXCEPTION 'GUARD-C3: the fixture grew a campaign, so the status half is untested';
  END IF;
  PERFORM pg_temp.expect_refusal(
    'C3-published', 'a published pitch is taken down by the person it is about'
  );
END;
$$;

-- Positive control: the only change is the status, and the identical call
-- succeeds. So C3 refused for the status, not for anything else about D4.
UPDATE pitch_drafts SET status = 'archived' WHERE id = '34000000-0000-0000-0000-000000000004';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);
SELECT pg_temp.try_delete('C3-archived', '34000000-0000-0000-0000-000000000004');
RESET ROLE;
DO $$
BEGIN
  PERFORM pg_temp.expect_success('C3-archived');
END;
$$;

-- ═══ Guard C4: a queued or leased ingest job blocks the delete ════════
-- Gate rule (2), in the form that actually occurs: media_ingest_jobs hangs off
-- pitch_assets ON DELETE CASCADE, so deleting the draft under a live lease
-- would pull the job row out from under the worker holding it. The job is the
-- one registration created; nothing in this file manufactures it.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM media_ingest_jobs
     WHERE asset_id = '34100000-0000-0000-0000-000000000003' AND status = 'queued'
  ) THEN
    RAISE EXCEPTION 'GUARD-C4: registering a clip no longer enqueues a job, so C4 is vacuous';
  END IF;
END;
$$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);
SELECT pg_temp.try_delete('C4-queued', '34000000-0000-0000-0000-000000000001');
RESET ROLE;
DO $$
BEGIN
  PERFORM pg_temp.expect_refusal(
    'C4-queued', 'this pitch is still being processed and cannot be deleted yet'
  );
END;
$$;

-- Leased is refused for the same reason.
UPDATE media_ingest_jobs
   SET status = 'leased', lease_token = gen_random_uuid(),
       leased_at = now(), lease_expires_at = now() + INTERVAL '5 minutes'
 WHERE asset_id = '34100000-0000-0000-0000-000000000003';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);
SELECT pg_temp.try_delete('C4-leased', '34000000-0000-0000-0000-000000000001');
RESET ROLE;
DO $$
BEGIN
  PERFORM pg_temp.expect_refusal(
    'C4-leased', 'this pitch is still being processed and cannot be deleted yet'
  );
  IF NOT EXISTS (SELECT 1 FROM pitch_drafts WHERE id = '34000000-0000-0000-0000-000000000001') THEN
    RAISE EXCEPTION 'GUARD-C4: the draft went away despite the refusal';
  END IF;
END;
$$;

-- A terminal job does NOT block: the refusal has to be temporary, or it is the
-- dead end this migration exists to remove. (The positive control is C8, which
-- deletes this very draft once the job is done.)
UPDATE media_ingest_jobs
   SET status = 'done', lease_token = NULL, leased_at = NULL, lease_expires_at = NULL
 WHERE asset_id = '34100000-0000-0000-0000-000000000003';

-- ═══ Guard C5: a queued render job blocks the delete ══════════════════
-- The clause the gate rule names. It cannot be reached through ordinary data
-- today — media_render_jobs.campaign_id is NOT NULL, so a render implies a
-- campaign, which C3 already refuses — so the fixture is deliberately
-- inconsistent: the job names D6 as its draft and the seed's campaign as its
-- campaign. That is the point of a defence-in-depth clause: it must hold on
-- the day the other table's constraint changes.
INSERT INTO media_render_jobs (id, revision_id, campaign_id, pitch_draft_id, scene_hash, status)
VALUES (
  '34500000-0000-0000-0000-000000000001', '34200000-0000-0000-0000-000000000006',
  '20000000-0000-0000-0000-000000000001', '34000000-0000-0000-0000-000000000006',
  'scene-hash-34-6', 'queued'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);
SELECT pg_temp.try_delete('C5-queued', '34000000-0000-0000-0000-000000000006');
RESET ROLE;
DO $$
BEGIN
  PERFORM pg_temp.expect_refusal(
    'C5-queued', 'this pitch is still being processed and cannot be deleted yet'
  );
END;
$$;

-- Positive control: only the job status moves, and the identical call succeeds.
UPDATE media_render_jobs
   SET status = 'failed', last_error = 'test'
 WHERE id = '34500000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);
SELECT pg_temp.try_delete('C5-failed', '34000000-0000-0000-0000-000000000006');
RESET ROLE;
DO $$
BEGIN
  PERFORM pg_temp.expect_success('C5-failed');
  IF EXISTS (SELECT 1 FROM media_render_jobs WHERE id = '34500000-0000-0000-0000-000000000001') THEN
    RAISE EXCEPTION 'GUARD-C5: the render job survived its draft';
  END IF;
END;
$$;

-- ═══ Guard C6: a purchase on the draft is not deleted by a tidy-up ════
INSERT INTO purchase_credit_ledger (
  id, user_id, credit_state, product_id, pitch_draft_id, idempotency_key
)
VALUES (
  '34600000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000004',
  'available', 'creator_launch_credit_499', '34000000-0000-0000-0000-000000000005',
  'cleanup-test-credit-1'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);
SELECT pg_temp.try_delete('C6-paid', '34000000-0000-0000-0000-000000000005');
RESET ROLE;
DO $$
BEGIN
  PERFORM pg_temp.expect_refusal(
    'C6-paid', 'this pitch has a purchase attached and cannot be deleted here'
  );
  IF NOT EXISTS (
    SELECT 1 FROM purchase_credit_ledger WHERE id = '34600000-0000-0000-0000-000000000001'
  ) THEN
    RAISE EXCEPTION 'GUARD-C6: the ledger row went away despite the refusal';
  END IF;
END;
$$;

-- Positive control: support voids the credit off the draft, and the identical
-- call succeeds.
DELETE FROM purchase_credit_ledger WHERE id = '34600000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);
SELECT pg_temp.try_delete('C6-unpaid', '34000000-0000-0000-0000-000000000005');
RESET ROLE;
DO $$
BEGIN
  PERFORM pg_temp.expect_success('C6-unpaid');
END;
$$;

-- ═══ Guard C7: an inactive creator cannot clean up ════════════════════
-- Both non-active states, because they fail for different reasons and only one
-- of them is obvious. 'suspended' is the moderation hold: a suspended account
-- must not be able to destroy its own evidence while a decision is pending.
-- 'deleted' is the account already queued for erasure, and it is the sharper
-- case — the deletion job walks that account's drafts with erase_pitch_draft
-- (0018) under friendword.erasure, and a client call racing it here would run
-- the SAME destruction under friendword.cleanup instead, writing the very
-- moderation trace erasure suppresses on purpose. private.assert_active_account
-- refuses both with one sentence; this pins that neither is special-cased.
UPDATE users SET account_status = 'suspended'
 WHERE id = '00000000-0000-0000-0000-000000000004';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);
SELECT pg_temp.try_delete('C7-suspended', '34000000-0000-0000-0000-000000000001');
RESET ROLE;
UPDATE users SET account_status = 'deleted'
 WHERE id = '00000000-0000-0000-0000-000000000004';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);
SELECT pg_temp.try_delete('C7-deleted', '34000000-0000-0000-0000-000000000001');
RESET ROLE;
DO $$
BEGIN
  PERFORM pg_temp.expect_refusal('C7-suspended', 'account must be active');
  PERFORM pg_temp.expect_refusal('C7-deleted', 'account must be active');
  IF NOT EXISTS (SELECT 1 FROM pitch_drafts WHERE id = '34000000-0000-0000-0000-000000000001') THEN
    RAISE EXCEPTION 'GUARD-C7: an inactive creator deleted a draft';
  END IF;
END;
$$;
UPDATE users SET account_status = 'active'
 WHERE id = '00000000-0000-0000-0000-000000000004';

-- ═══ Guard C8: the happy path, and exactly what it destroys ═══════════
-- D1 still has its unanswered consent request, its revision, three assets, its
-- validation rows and its storage objects. Every guard above has now been
-- undone one at a time; this is the call they were each blocking.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);
SELECT pg_temp.try_delete('C8-cleanup', '34000000-0000-0000-0000-000000000001');
RESET ROLE;
DO $$
DECLARE
  failures TEXT[] := ARRAY[]::TEXT[];
BEGIN
  PERFORM pg_temp.expect_success('C8-cleanup');
  -- The flag is put back before the function returns, and this is the assertion
  -- that says so. `friendword.cleanup` is NOT in the function's SET clause, so
  -- unlike search_path nothing restores it on exit: if the RPC only ever turned
  -- it on, it would stay on for the WHOLE remaining transaction, and every
  -- later statement in that transaction — the next RPC in a PostgREST request,
  -- anything a future batching path runs — would carry a standing licence to
  -- cascade consent revisions away. That is exactly the trap left behind by
  -- erase_pitch_draft (0018), which this file has to neutralise by hand at C9.
  -- Checked here rather than at C3/C5/C6 because a successful call is the only
  -- one that ever sets it.
  IF coalesce(current_setting('friendword.cleanup', true), '') = 'on' THEN
    failures := array_append(
      failures, 'the cleanup flag was left on after the call returned'
    );
  END IF;
  IF EXISTS (SELECT 1 FROM pitch_drafts WHERE id = '34000000-0000-0000-0000-000000000001') THEN
    failures := array_append(failures, 'the draft survived');
  END IF;
  IF EXISTS (
    SELECT 1 FROM pitch_assets WHERE pitch_draft_id = '34000000-0000-0000-0000-000000000001'
  ) THEN
    failures := array_append(failures, 'assets survived');
  END IF;
  IF EXISTS (
    SELECT 1 FROM consent_requests WHERE pitch_draft_id = '34000000-0000-0000-0000-000000000001'
  ) THEN
    failures := array_append(failures, 'the consent request survived');
  END IF;
  IF EXISTS (
    SELECT 1 FROM consent_revisions WHERE pitch_draft_id = '34000000-0000-0000-0000-000000000001'
  ) THEN
    failures := array_append(failures, 'the consent revision survived');
  END IF;
  IF EXISTS (
    SELECT 1 FROM media_ingest_jobs WHERE asset_id = '34100000-0000-0000-0000-000000000003'
  ) THEN
    failures := array_append(failures, 'the ingest job survived its asset');
  END IF;
  -- Named by the RPC, cascaded by nothing. Includes the NESTED renders/ row: a
  -- rule that only matched flat names would leave it.
  IF EXISTS (
    SELECT 1 FROM media_validations
     WHERE bucket_id = 'pitch-media'
       AND object_name LIKE '34000000-0000-0000-0000-000000000001/%'
  ) THEN
    failures := array_append(failures, 'media_validations rows survived');
  END IF;
  -- The storage objects are deliberately LEFT: deleting storage.objects in SQL
  -- drops Storage's metadata while the bytes stay, manufacturing an object
  -- nothing can reclaim. Dropping the DB rows is what hands the prefix to
  -- scripts/cleanup-orphan-media.mjs, which reclaims bytes through the API.
  IF (
    SELECT count(*) FROM storage.objects
     WHERE bucket_id = 'pitch-media'
       AND name LIKE '34000000-0000-0000-0000-000000000001/%'
  ) <> 3 THEN
    failures := array_append(failures, 'the RPC deleted storage.objects rows itself');
  END IF;
  -- And nothing else went. D2 is Drew's other draft; it was never named.
  IF NOT EXISTS (SELECT 1 FROM pitch_drafts WHERE id = '34000000-0000-0000-0000-000000000002')
     OR NOT EXISTS (
       SELECT 1 FROM pitch_assets WHERE pitch_draft_id = '34000000-0000-0000-0000-000000000002'
     )
     OR NOT EXISTS (
       SELECT 1 FROM media_validations
        WHERE bucket_id = 'pitch-media'
          AND object_name = '34000000-0000-0000-0000-000000000002/voice.m4a'
     ) THEN
    failures := array_append(failures, 'the call reached Drew''s other draft');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pitch_drafts WHERE id = '34000000-0000-0000-0000-000000000003') THEN
    failures := array_append(failures, 'the call reached Alex''s draft');
  END IF;
  IF cardinality(failures) > 0 THEN
    RAISE EXCEPTION 'GUARD-C8: %', array_to_string(failures, '; ');
  END IF;
END;
$$;

-- ═══ Guard C9: cleanup keeps the moderation trace erasure suppresses ══
-- The reason 0059 is a new RPC rather than a call to erase_pitch_draft. 0051's
-- private.record_video_moderation_review_deletion writes an ops_alerts row when
-- a flagged-clip review is deleted, UNLESS friendword.erasure is on — silence
-- that exists so a right-to-erasure request does not preserve the identifiers
-- it was made to remove. A voluntary tidy-up is not erasure and must not
-- inherit that silence, or any account could make a pending review vanish.
INSERT INTO video_moderation_reviews (
  id, asset_id, pitch_draft_id, flagged_reason, evidence_storage_path
)
VALUES
  ('34700000-0000-0000-0000-000000000007', '34100000-0000-0000-0000-000000000007',
   '34000000-0000-0000-0000-000000000007', 'nudity',
   'pitch-media/34000000-0000-0000-0000-000000000007/clip-1.mp4'),
  ('34700000-0000-0000-0000-000000000008', '34100000-0000-0000-0000-000000000008',
   '34000000-0000-0000-0000-000000000008', 'nudity',
   'pitch-media/34000000-0000-0000-0000-000000000008/clip-1.mp4');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);
SELECT pg_temp.try_delete('C9-cleanup', '34000000-0000-0000-0000-000000000007');
RESET ROLE;
-- The contrast, so C9 is a statement about cleanup and not about the trigger
-- always firing: the SAME shape erased through erase_pitch_draft leaves no
-- alert, because erasure sets friendword.erasure.
SELECT public.erase_pitch_draft('34000000-0000-0000-0000-000000000008');
-- erase_pitch_draft (0018) sets friendword.erasure and never clears it. In
-- production that is harmless — the deletion job calls it one RPC per
-- transaction — but this file keeps running in the same transaction, and a
-- leftover 'on' would make C10's unflagged DELETE succeed and read as a pass
-- for the very guard it is testing.
SELECT set_config('friendword.erasure', 'off', true);
DO $$
BEGIN
  PERFORM pg_temp.expect_success('C9-cleanup');
  IF NOT EXISTS (
    SELECT 1 FROM ops_alerts
     WHERE alert_type = 'video_moderation_review_deleted'
       AND detail ->> 'pitch_draft_id' = '34000000-0000-0000-0000-000000000007'
  ) THEN
    RAISE EXCEPTION 'GUARD-C9: cleanup destroyed a pending moderation review without a trace';
  END IF;
  IF EXISTS (
    SELECT 1 FROM ops_alerts
     WHERE alert_type = 'video_moderation_review_deleted'
       AND detail ->> 'pitch_draft_id' = '34000000-0000-0000-0000-000000000008'
  ) THEN
    RAISE EXCEPTION
      'GUARD-C9: erasure wrote a moderation trace, so the cleanup flag is not the difference';
  END IF;
END;
$$;

-- ═══ Guard C10: consent revisions are still immutable ════════════════
-- 0059 widened private.reject_consent_revision_mutation to honour a second
-- server flag. It must not have widened anything else. Two walls, tested
-- separately, because only one of them is the trigger:
--
--   (a) the client roles hold no DELETE or UPDATE grant on consent_revisions
--       at all (0052), so a client never reaches the trigger; and
--   (b) a caller that DOES hold the privilege — anything running as the table
--       owner, which is every migration and every SECURITY DEFINER body — is
--       still refused unless one of the two named flags is set.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);
DO $$
DECLARE
  failures TEXT[] := ARRAY[]::TEXT[];
  refused BOOLEAN;
BEGIN
  refused := false;
  BEGIN
    DELETE FROM consent_revisions WHERE id = '34200000-0000-0000-0000-000000000002';
  EXCEPTION WHEN OTHERS THEN
    refused := true;
  END;
  IF NOT refused THEN
    failures := array_append(failures, 'a client deleted a consent revision');
  END IF;
  refused := false;
  BEGIN
    UPDATE consent_revisions SET headline = 'rewritten'
     WHERE id = '34200000-0000-0000-0000-000000000002';
  EXCEPTION WHEN OTHERS THEN
    refused := true;
  END;
  IF NOT refused THEN
    failures := array_append(failures, 'a client rewrote a consent revision');
  END IF;
  IF cardinality(failures) > 0 THEN
    RAISE EXCEPTION 'GUARD-C10: %', array_to_string(failures, '; ');
  END IF;
END;
$$;
RESET ROLE;

-- (b) The trigger itself, reached by a privileged caller with no flag set.
DO $$
DECLARE
  failures TEXT[] := ARRAY[]::TEXT[];
  refusal TEXT;
BEGIN
  refusal := NULL;
  BEGIN
    DELETE FROM consent_revisions WHERE id = '34200000-0000-0000-0000-000000000002';
  EXCEPTION WHEN OTHERS THEN
    refusal := SQLERRM;
  END;
  IF refusal IS DISTINCT FROM 'consent revisions are immutable' THEN
    failures := array_append(
      failures, 'unflagged delete answered "' || coalesce(refusal, 'deleted') || '"'
    );
  END IF;
  refusal := NULL;
  BEGIN
    UPDATE consent_revisions SET headline = 'rewritten'
     WHERE id = '34200000-0000-0000-0000-000000000002';
  EXCEPTION WHEN OTHERS THEN
    refusal := SQLERRM;
  END;
  -- Even WITH the cleanup flag: it authorizes DELETE only, never a rewrite.
  IF refusal IS DISTINCT FROM 'consent revisions are immutable' THEN
    failures := array_append(
      failures, 'unflagged update answered "' || coalesce(refusal, 'rewritten') || '"'
    );
  END IF;
  PERFORM set_config('friendword.cleanup', 'on', true);
  refusal := NULL;
  BEGIN
    UPDATE consent_revisions SET headline = 'rewritten'
     WHERE id = '34200000-0000-0000-0000-000000000002';
  EXCEPTION WHEN OTHERS THEN
    refusal := SQLERRM;
  END;
  PERFORM set_config('friendword.cleanup', 'off', true);
  IF refusal IS DISTINCT FROM 'consent revisions are immutable' THEN
    failures := array_append(
      failures, 'the cleanup flag allowed an UPDATE: "' || coalesce(refusal, 'rewritten') || '"'
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM consent_revisions WHERE id = '34200000-0000-0000-0000-000000000002') THEN
    failures := array_append(failures, 'the revision went away despite the refusals');
  END IF;
  IF cardinality(failures) > 0 THEN
    RAISE EXCEPTION 'GUARD-C10: %', array_to_string(failures, '; ');
  END IF;
END;
$$;

-- The flag is not a client capability either: it is a transaction-local GUC
-- written only inside SECURITY DEFINER bodies, and a client that sets it by
-- hand still cannot delete, because it holds no DELETE grant on pitch_drafts
-- (C11).
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);
DO $$
DECLARE
  refusal TEXT := NULL;
BEGIN
  PERFORM set_config('friendword.cleanup', 'on', true);
  BEGIN
    DELETE FROM pitch_drafts WHERE id = '34000000-0000-0000-0000-000000000002';
  EXCEPTION WHEN OTHERS THEN
    refusal := SQLERRM;
  END;
  IF refusal IS NULL THEN
    RAISE EXCEPTION 'GUARD-C10: setting the cleanup flag let a client delete a draft directly';
  END IF;
END;
$$;
RESET ROLE;
SELECT set_config('friendword.cleanup', 'off', true);

-- ═══ Guard C11: the grant is EXECUTE-only, and never anonymous ════════
-- The RPC exists because authenticated has no DELETE on pitch_drafts (0052).
-- If a future migration hands out the table grant instead, this file must fail.
-- anon must not hold EXECUTE: hosted default privileges grant it on creation
-- and only `REVOKE ... FROM PUBLIC, anon` takes it back (0051).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_privileges
     WHERE table_schema = 'public'
       AND table_name = 'pitch_drafts'
       AND grantee IN ('authenticated', 'anon')
       AND privilege_type = 'DELETE'
  ) THEN
    RAISE EXCEPTION 'GUARD-C11: a client role holds DELETE on pitch_drafts directly';
  END IF;
  IF NOT has_function_privilege(
    'authenticated', 'public.delete_my_pitch_draft(uuid)', 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'GUARD-C11: authenticated cannot execute delete_my_pitch_draft';
  END IF;
  IF has_function_privilege('anon', 'public.delete_my_pitch_draft(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'GUARD-C11: anon holds EXECUTE on delete_my_pitch_draft';
  END IF;
END;
$$;

ROLLBACK;

SELECT '34_pitch_draft_cleanup.sql passed' AS result;
