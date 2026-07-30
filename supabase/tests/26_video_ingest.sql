-- Motion pitch Phase 3a (migration 0050): the database owns a video clip's
-- whole life — what may be registered, who is allowed to process it, what makes
-- one publishable, what a flagged one leaves behind, and what a v3 scene may say
-- about it.
--
-- red-first: on 0049 none of pitch_video_ingests, media_ingest_jobs,
-- video_moderation_reviews, claim_media_ingest_job or the 6-argument
-- private.pitch_scene_violation exists, and pitch_assets.asset_type has no
-- CHECK, so the pin block below raises immediately and every probe fails.
--
-- The rejection strings asserted here are a contract: the web and mobile clients
-- map them to Introducer- and Dater-facing copy, so a message change is a
-- product change. The v3 clip messages are additionally pinned by
-- PITCH_SCENE_V3_GOLDEN_VECTORS in packages/contracts, whose generated block is
-- inlined verbatim in section (I) and run against the same parser by that
-- package's vitest suite.
--
-- WHAT THIS SUITE IS NOT ABOUT: the pitch-media object quota moved 12 -> 20 in
-- the same migration and is asserted where it already lived,
-- supabase/tests/18_ugc_limits.sql, with the object arithmetic written out.

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.pitch_video_ingests') IS NULL THEN
    RAISE EXCEPTION 'D26: public.pitch_video_ingests missing';
  END IF;
  IF to_regclass('public.media_ingest_jobs') IS NULL THEN
    RAISE EXCEPTION 'D26: public.media_ingest_jobs missing';
  END IF;
  IF to_regclass('public.video_moderation_reviews') IS NULL THEN
    RAISE EXCEPTION 'D26: public.video_moderation_reviews missing';
  END IF;
  IF to_regprocedure('public.claim_media_ingest_job(integer)') IS NULL THEN
    RAISE EXCEPTION 'D26: public.claim_media_ingest_job(integer) missing';
  END IF;
  IF to_regprocedure(
    'public.complete_media_ingest_job(uuid,uuid,text,text,text,integer,integer,integer,jsonb,boolean,text)'
  ) IS NULL THEN
    RAISE EXCEPTION 'D26: public.complete_media_ingest_job(...) missing';
  END IF;
  IF to_regprocedure('public.list_pending_video_reviews(integer)') IS NULL THEN
    RAISE EXCEPTION 'D26: public.list_pending_video_reviews(integer) missing';
  END IF;
  IF to_regprocedure(
    'public.resolve_video_moderation_review(uuid,text,text)'
  ) IS NULL THEN
    RAISE EXCEPTION 'D26: public.resolve_video_moderation_review(...) missing';
  END IF;
  IF to_regprocedure(
    'private.pitch_scene_violation(jsonb,integer,uuid[],jsonb,jsonb,uuid[])'
  ) IS NULL THEN
    RAISE EXCEPTION
      'D26: private.pitch_scene_violation(jsonb,integer,uuid[],jsonb,jsonb,uuid[]) missing';
  END IF;
  IF to_regprocedure('private.pitch_video_ingest_succeeded(uuid)') IS NULL THEN
    RAISE EXCEPTION 'D26: private.pitch_video_ingest_succeeded(uuid) missing';
  END IF;
  IF to_regprocedure('private.pitch_draft_video_allowance(uuid)') IS NULL THEN
    RAISE EXCEPTION 'D26: private.pitch_draft_video_allowance(uuid) missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'public.pitch_assets'::REGCLASS
       AND conname = 'pitch_assets_asset_type_check'
  ) THEN
    RAISE EXCEPTION 'D26: pitch_assets.asset_type has no closed-set CHECK';
  END IF;
END;
$$;

-- ── Probe helpers ───────────────────────────────────────────────────────
-- Returns the error message, or NULL when the statement was accepted. The
-- sentinel raise rolls the subtransaction back, so probing an accepted
-- statement leaves nothing behind.
CREATE FUNCTION pg_temp.rejected(statement TEXT)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
BEGIN
  BEGIN
    EXECUTE statement;
    RAISE EXCEPTION 'D26-ACCEPTED';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'D26-ACCEPTED' THEN
      RETURN NULL;
    END IF;
    RETURN SQLERRM;
  END;
END;
$$;

-- Brings one asset's job to the head of the lease queue so that a claim is
-- deterministic. claim_media_ingest_job orders by (created_at, id) and skips a
-- live lease, and this suite drives several assets through it, so each section
-- says out loud which job it means.
CREATE FUNCTION pg_temp.queue_head(target_asset UUID)
RETURNS void
LANGUAGE sql
AS $$
  UPDATE public.media_ingest_jobs
     SET created_at = CASE
           WHEN asset_id = target_asset THEN now() - INTERVAL '1 hour'
           ELSE now() + INTERVAL '1 hour'
         END;
$$;

CREATE FUNCTION pg_temp.ingest_status(target_asset UUID)
RETURNS TEXT
LANGUAGE sql
AS $$
  SELECT ingest_status FROM public.pitch_video_ingests WHERE asset_id = target_asset;
$$;

CREATE FUNCTION pg_temp.job_status(target_asset UUID)
RETURNS TEXT
LANGUAGE sql
AS $$
  SELECT status FROM public.media_ingest_jobs WHERE asset_id = target_asset;
$$;

-- ── Fixtures ────────────────────────────────────────────────────────────
-- Three drafts, because the two count layers pull in opposite directions:
--
--   A  no Campaign Pass  -> the free allowance of one clip
--   B  active pass       -> three clips, which is where the absolute ceiling of
--                           three and the scene probes live
--   C  no pass           -> one clip, driven to a FLAGGED verdict
--
-- Every transcript ends at 6.0s, so a scene on any of them must declare exactly
-- 6000ms and nothing in the scene probes is about the duration.
INSERT INTO public.pitch_drafts (
  id, created_by_user_id, status, headline, body, structure, transcript
)
SELECT
  draft.id,
  '00000000-0000-0000-0000-000000000001',
  'draft',
  draft.headline,
  'Video ingest fixture body.',
  '{"hook": "Meet my friend Blair",
    "relationship_context": "We have been friends since college.",
    "three_specific_qualities": ["kind", "curious", "cooks constantly"],
    "evidence_or_anecdote": "Blair drove four hours to help me move.",
    "good_match_for": "someone who likes long dinners",
    "hard_claims_requiring_confirmation": []}'::JSONB,
  '{"text": "Blair is kind and always cooking.",
    "language": "en",
    "segments": [
      {"start": 0, "end": 3.0, "text": "Blair is kind"},
      {"start": 3.0, "end": 6.0, "text": "and always cooking"}
    ],
    "words": [
      {"start": 0.0, "end": 0.5, "word": "Blair"},
      {"start": 0.5, "end": 0.9, "word": "is"},
      {"start": 0.9, "end": 1.4, "word": "kind"},
      {"start": 3.0, "end": 3.4, "word": "and"},
      {"start": 3.4, "end": 4.0, "word": "always"},
      {"start": 4.0, "end": 4.8, "word": "cooking"}
    ]}'::JSONB
FROM (
  VALUES
    ('26000000-0000-0000-0000-000000000001'::UUID, 'Free tier draft'),
    ('26000000-0000-0000-0000-000000000002'::UUID, 'Campaign Pass draft'),
    ('26000000-0000-0000-0000-000000000003'::UUID, 'Flagged clip draft')
) AS draft(id, headline);

-- The pass lives on draft B's campaign row, which is how
-- private.pitch_draft_video_allowance reads it (0020 get_campaign_pass_state
-- pattern).
--
-- The campaign is status 'draft' here for a reason worth writing down: a
-- PUBLISHED campaign requires an already-published, consented draft
-- (validate_campaign_publication, 0001), and draft B has to stay unpublished so
-- the registration and scene probes can run at all. In production a Campaign
-- Pass is only ever sold against a published campaign, so the paid branch of the
-- allowance is not reachable on today's flow — the gap is recorded on
-- private.pitch_draft_video_allowance and is a product decision, not something
-- this suite can paper over. What is asserted here is what the database owns:
-- the allowance is read from the entitlement ledger, and it is read on the
-- server at registration time.
INSERT INTO public.campaigns (
  id, pitch_draft_id, owner_user_id, status, slug
) VALUES (
  '26000000-0000-0000-0000-0000000000c2',
  '26000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000004',
  'draft',
  'video-ingest-pass-fixture'
);

INSERT INTO public.campaign_entitlements (campaign_id, product_id, active, expires_at)
VALUES (
  '26000000-0000-0000-0000-0000000000c2',
  'campaign_pass_30d_1999',
  true,
  now() + INTERVAL '30 days'
);

INSERT INTO public.pitch_assets (
  id, pitch_draft_id, uploaded_by_user_id, asset_type, storage_path, sort_order,
  width, height
) VALUES
  ('26000000-0000-0000-0000-0000000001a0',
   '26000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000001', 'voice',
   'pitch-media/26000000-0000-0000-0000-000000000001/voice.m4a', 0, NULL, NULL),
  ('26000000-0000-0000-0000-0000000001a1',
   '26000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000001', 'photo',
   'pitch-media/26000000-0000-0000-0000-000000000001/photo-1.jpg', 1, 1200, 1600),
  ('26000000-0000-0000-0000-0000000002b0',
   '26000000-0000-0000-0000-000000000002',
   '00000000-0000-0000-0000-000000000001', 'voice',
   'pitch-media/26000000-0000-0000-0000-000000000002/voice.m4a', 0, NULL, NULL),
  ('26000000-0000-0000-0000-0000000002b8',
   '26000000-0000-0000-0000-000000000002',
   '00000000-0000-0000-0000-000000000001', 'photo',
   'pitch-media/26000000-0000-0000-0000-000000000002/photo-1.jpg', 1, 1200, 1600),
  ('26000000-0000-0000-0000-0000000002b9',
   '26000000-0000-0000-0000-000000000002',
   '00000000-0000-0000-0000-000000000001', 'photo',
   'pitch-media/26000000-0000-0000-0000-000000000002/photo-2.jpg', 2, 1600, 1200),
  ('26000000-0000-0000-0000-0000000003c0',
   '26000000-0000-0000-0000-000000000003',
   '00000000-0000-0000-0000-000000000001', 'photo',
   'pitch-media/26000000-0000-0000-0000-000000000003/photo-1.jpg', 1, 1200, 1600);

-- ── (A) asset_type is a closed set ──────────────────────────────────────
DO $$
DECLARE
  failures TEXT[] := ARRAY[]::TEXT[];
  reason TEXT;
BEGIN
  -- 'video' is now a member, and nothing else is. A tolerated fourth type would
  -- be an asset no readiness predicate knows how to judge.
  reason := pg_temp.rejected($sql$
    INSERT INTO public.pitch_assets (
      pitch_draft_id, uploaded_by_user_id, asset_type, storage_path
    ) VALUES (
      '26000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000001',
      'gif',
      'pitch-media/26000000-0000-0000-0000-000000000001/loop.gif'
    )
  $sql$);
  IF reason IS NULL OR reason NOT LIKE '%pitch_assets_asset_type_check%' THEN
    failures := array_append(failures,
      'asset_type gif was not rejected by the CHECK: ' || coalesce(reason, 'ACCEPTED'));
  END IF;

  IF array_length(failures, 1) IS NOT NULL THEN
    RAISE EXCEPTION '26_video_ingest (A) failures: %', array_to_string(failures, ' | ');
  END IF;
END;
$$;

-- ── (B) Registration creates the ingest row and the job ─────────────────
INSERT INTO public.pitch_assets (
  id, pitch_draft_id, uploaded_by_user_id, asset_type, storage_path, sort_order
) VALUES (
  '26000000-0000-0000-0000-0000000001a2',
  '26000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001', 'video',
  'pitch-media/26000000-0000-0000-0000-000000000001/clip-1.mp4', 2
);

DO $$
DECLARE
  failures TEXT[] := ARRAY[]::TEXT[];
  ingest public.pitch_video_ingests;
  job public.media_ingest_jobs;
BEGIN
  -- Phase 1's lesson: an object registered later than it is uploaded is an
  -- object a sweep can delete. The same applies to a job the client could
  -- forget, so registration enqueues it in the same statement.
  SELECT * INTO ingest
    FROM public.pitch_video_ingests
   WHERE asset_id = '26000000-0000-0000-0000-0000000001a2';
  IF ingest.asset_id IS NULL THEN
    failures := array_append(failures, 'registering a video created no ingest row');
  ELSIF ingest.ingest_status <> 'pending' THEN
    failures := array_append(failures,
      'a fresh ingest row is ' || ingest.ingest_status || ', not pending');
  ELSIF ingest.pitch_draft_id IS DISTINCT FROM '26000000-0000-0000-0000-000000000001' THEN
    failures := array_append(failures, 'the ingest row denormalized the wrong draft');
  END IF;

  SELECT * INTO job
    FROM public.media_ingest_jobs
   WHERE asset_id = '26000000-0000-0000-0000-0000000001a2';
  IF job.id IS NULL THEN
    failures := array_append(failures, 'registering a video enqueued no job');
  ELSIF job.status <> 'queued' OR job.attempts <> 0 THEN
    failures := array_append(failures,
      'a fresh job is ' || job.status || ' with ' || job.attempts || ' attempts');
  END IF;

  -- A photo must NOT enqueue anything: ingest is video-only, and a job pointing
  -- at a jpeg would fail the probe and burn provider budget.
  IF EXISTS (
    SELECT 1 FROM public.media_ingest_jobs
     WHERE asset_id = '26000000-0000-0000-0000-0000000001a1'
  ) THEN
    failures := array_append(failures, 'registering a photo enqueued an ingest job');
  END IF;

  -- A fresh clip is not usable. This is the predicate everything else asks.
  IF private.pitch_video_ingest_succeeded('26000000-0000-0000-0000-0000000001a2') THEN
    failures := array_append(failures, 'a pending clip reported itself ready');
  END IF;
  IF private.pitch_videos_validated(
       ARRAY['26000000-0000-0000-0000-0000000001a2'::UUID]
     ) THEN
    failures := array_append(failures, 'pitch_videos_validated passed a pending clip');
  END IF;

  IF array_length(failures, 1) IS NOT NULL THEN
    RAISE EXCEPTION '26_video_ingest (B) failures: %', array_to_string(failures, ' | ');
  END IF;
END;
$$;

-- ── (C) Two count layers: the absolute ceiling and the paid tier ────────
DO $$
DECLARE
  failures TEXT[] := ARRAY[]::TEXT[];
  reason TEXT;
BEGIN
  IF private.pitch_draft_video_allowance('26000000-0000-0000-0000-000000000001') <> 1 THEN
    failures := array_append(failures, 'a draft with no pass was not on the free allowance');
  END IF;
  IF private.pitch_draft_video_allowance('26000000-0000-0000-0000-000000000002') <> 3 THEN
    failures := array_append(failures, 'an active Campaign Pass did not raise the allowance');
  END IF;

  -- Draft A already carries its one free clip.
  reason := pg_temp.rejected($sql$
    INSERT INTO public.pitch_assets (
      pitch_draft_id, uploaded_by_user_id, asset_type, storage_path
    ) VALUES (
      '26000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000001',
      'video',
      'pitch-media/26000000-0000-0000-0000-000000000001/clip-2.mp4'
    )
  $sql$);
  IF reason IS DISTINCT FROM 'a second video clip requires a Campaign Pass' THEN
    failures := array_append(failures,
      'a second free-tier clip was not refused: ' || coalesce(reason, 'ACCEPTED'));
  END IF;

  IF array_length(failures, 1) IS NOT NULL THEN
    RAISE EXCEPTION '26_video_ingest (C1) failures: %', array_to_string(failures, ' | ');
  END IF;
END;
$$;

-- Draft B's three clips, and the fourth that no entitlement can buy.
INSERT INTO public.pitch_assets (
  id, pitch_draft_id, uploaded_by_user_id, asset_type, storage_path, sort_order
) VALUES
  ('26000000-0000-0000-0000-0000000002b1',
   '26000000-0000-0000-0000-000000000002',
   '00000000-0000-0000-0000-000000000001', 'video',
   'pitch-media/26000000-0000-0000-0000-000000000002/clip-1.mp4', 3),
  ('26000000-0000-0000-0000-0000000002b2',
   '26000000-0000-0000-0000-000000000002',
   '00000000-0000-0000-0000-000000000001', 'video',
   'pitch-media/26000000-0000-0000-0000-000000000002/clip-2.mp4', 4),
  ('26000000-0000-0000-0000-0000000002b3',
   '26000000-0000-0000-0000-000000000002',
   '00000000-0000-0000-0000-000000000001', 'video',
   'pitch-media/26000000-0000-0000-0000-000000000002/clip-3.mp4', 5);

INSERT INTO public.pitch_assets (
  id, pitch_draft_id, uploaded_by_user_id, asset_type, storage_path, sort_order
) VALUES (
  '26000000-0000-0000-0000-0000000003c1',
  '26000000-0000-0000-0000-000000000003',
  '00000000-0000-0000-0000-000000000001', 'video',
  'pitch-media/26000000-0000-0000-0000-000000000003/clip-1.mp4', 2
);

DO $$
DECLARE
  failures TEXT[] := ARRAY[]::TEXT[];
  reason TEXT;
BEGIN
  reason := pg_temp.rejected($sql$
    INSERT INTO public.pitch_assets (
      pitch_draft_id, uploaded_by_user_id, asset_type, storage_path
    ) VALUES (
      '26000000-0000-0000-0000-000000000002',
      '00000000-0000-0000-0000-000000000001',
      'video',
      'pitch-media/26000000-0000-0000-0000-000000000002/clip-4.mp4'
    )
  $sql$);
  IF reason IS DISTINCT FROM 'a pitch may carry at most 3 video clips' THEN
    failures := array_append(failures,
      'a fourth clip was not refused: ' || coalesce(reason, 'ACCEPTED'));
  END IF;

  -- The paid layer is not the ceiling. An expired pass falls back to free, which
  -- is what stops a lapsed purchase from continuing to buy capacity.
  UPDATE public.campaign_entitlements
     SET expires_at = now() - INTERVAL '1 day'
   WHERE campaign_id = '26000000-0000-0000-0000-0000000000c2';
  IF private.pitch_draft_video_allowance('26000000-0000-0000-0000-000000000002') <> 1 THEN
    failures := array_append(failures, 'an expired pass still granted three clips');
  END IF;
  UPDATE public.campaign_entitlements
     SET active = false, expires_at = now() + INTERVAL '30 days'
   WHERE campaign_id = '26000000-0000-0000-0000-0000000000c2';
  IF private.pitch_draft_video_allowance('26000000-0000-0000-0000-000000000002') <> 1 THEN
    failures := array_append(failures, 'a deactivated pass still granted three clips');
  END IF;
  UPDATE public.campaign_entitlements
     SET active = true
   WHERE campaign_id = '26000000-0000-0000-0000-0000000000c2';

  IF array_length(failures, 1) IS NOT NULL THEN
    RAISE EXCEPTION '26_video_ingest (C2) failures: %', array_to_string(failures, ' | ');
  END IF;
END;
$$;

-- The Dater may add their own clip during consent review (0032 extended). Draft
-- C is claimed by Blair and put into review for this probe alone.
UPDATE public.pitch_drafts
   SET subject_user_id = '00000000-0000-0000-0000-000000000002',
       status = 'consent_pending'
 WHERE id = '26000000-0000-0000-0000-000000000003';

DO $$
DECLARE
  failures TEXT[] := ARRAY[]::TEXT[];
  reason TEXT;
BEGIN
  PERFORM set_config(
    'request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true
  );
  SET LOCAL ROLE authenticated;
  -- Accepted apart from the allowance, which draft C has already spent: the
  -- policy let the row through and the count trigger refused it, which is
  -- exactly the layering under test. A policy still rejecting videos would fail
  -- with insufficient_privilege instead.
  reason := pg_temp.rejected($sql$
    INSERT INTO public.pitch_assets (
      pitch_draft_id, uploaded_by_user_id, asset_type, storage_path
    ) VALUES (
      '26000000-0000-0000-0000-000000000003',
      '00000000-0000-0000-0000-000000000002',
      'video',
      'pitch-media/26000000-0000-0000-0000-000000000003/dater-clip.mp4'
    )
  $sql$);
  IF reason IS DISTINCT FROM 'a second video clip requires a Campaign Pass' THEN
    failures := array_append(failures,
      'the dater clip upload policy did not admit a video: '
      || coalesce(reason, 'ACCEPTED'));
  END IF;
  RESET ROLE;

  IF array_length(failures, 1) IS NOT NULL THEN
    RAISE EXCEPTION '26_video_ingest (C3) failures: %', array_to_string(failures, ' | ');
  END IF;
END;
$$;

UPDATE public.pitch_drafts
   SET status = 'draft', subject_user_id = NULL
 WHERE id = '26000000-0000-0000-0000-000000000003';

-- ── (D) The lease queue ─────────────────────────────────────────────────
SELECT pg_temp.queue_head('26000000-0000-0000-0000-0000000001a2');

DO $$
DECLARE
  failures TEXT[] := ARRAY[]::TEXT[];
  first_claim RECORD;
  second_claim RECORD;
  reason TEXT;
BEGIN
  SELECT * INTO first_claim FROM public.claim_media_ingest_job(600);
  IF first_claim.asset_id IS DISTINCT FROM '26000000-0000-0000-0000-0000000001a2' THEN
    failures := array_append(failures,
      'the head of the queue was not claimed: ' || coalesce(first_claim.asset_id::TEXT, 'NOTHING'));
  END IF;
  IF first_claim.attempts <> 1 THEN
    failures := array_append(failures, 'claiming did not count the attempt');
  END IF;
  IF first_claim.storage_path IS DISTINCT FROM
     'pitch-media/26000000-0000-0000-0000-000000000001/clip-1.mp4' THEN
    failures := array_append(failures, 'the claim did not hand over the original path');
  END IF;
  IF pg_temp.ingest_status('26000000-0000-0000-0000-0000000001a2') <> 'processing' THEN
    failures := array_append(failures, 'claiming did not move the ingest row to processing');
  END IF;

  -- A LIVE lease is invisible to the next claim. This is the whole point of the
  -- table: two workers transcoding one clip would both delete the original.
  SELECT * INTO second_claim FROM public.claim_media_ingest_job(600);
  IF second_claim.asset_id IS NOT DISTINCT FROM '26000000-0000-0000-0000-0000000001a2' THEN
    failures := array_append(failures, 'a live lease was handed out twice');
  END IF;

  -- Completing without the token is completing someone else's job.
  reason := pg_temp.rejected(format($sql$
    SELECT public.complete_media_ingest_job(
      %L::UUID, gen_random_uuid(), 'failed', reason => 'probe'
    )
  $sql$, first_claim.job_id));
  IF reason IS DISTINCT FROM 'media ingest lease is not held' THEN
    failures := array_append(failures,
      'a wrong lease token was accepted: ' || coalesce(reason, 'ACCEPTED'));
  END IF;

  -- An EXPIRED lease is also not held. The job has been handed to another
  -- worker by then, and a late report would overwrite that worker's result.
  UPDATE public.media_ingest_jobs
     SET lease_expires_at = now() - INTERVAL '1 second'
   WHERE id = first_claim.job_id;
  reason := pg_temp.rejected(format($sql$
    SELECT public.complete_media_ingest_job(
      %L::UUID, %L::UUID, 'failed', reason => 'probe'
    )
  $sql$, first_claim.job_id, first_claim.lease_token));
  IF reason IS DISTINCT FROM 'media ingest lease is not held' THEN
    failures := array_append(failures,
      'an expired lease was accepted: ' || coalesce(reason, 'ACCEPTED'));
  END IF;

  -- Release the second claim so later sections start from a clean queue.
  PERFORM public.complete_media_ingest_job(
    second_claim.job_id, second_claim.lease_token, 'failed',
    reason => 'released by the (D) probes'
  );

  IF array_length(failures, 1) IS NOT NULL THEN
    RAISE EXCEPTION '26_video_ingest (D1) failures: %', array_to_string(failures, ' | ');
  END IF;
END;
$$;

DO $$
DECLARE
  failures TEXT[] := ARRAY[]::TEXT[];
  reason TEXT;
  target_job UUID;
BEGIN
  SELECT id INTO target_job
    FROM public.media_ingest_jobs
   WHERE asset_id = '26000000-0000-0000-0000-0000000002b3';

  -- A job is born queued. A row inserted straight into 'leased' would be a
  -- lease no worker holds, and nothing would ever expire it.
  reason := pg_temp.rejected($sql$
    INSERT INTO public.media_ingest_jobs (asset_id, status, lease_token, lease_expires_at)
    VALUES (
      '26000000-0000-0000-0000-0000000002b8', 'leased', gen_random_uuid(),
      now() + INTERVAL '10 minutes'
    )
  $sql$);
  IF reason IS DISTINCT FROM 'media ingest job must be created queued' THEN
    failures := array_append(failures,
      'a job inserted as leased was accepted: ' || coalesce(reason, 'ACCEPTED'));
  END IF;

  -- queued -> done skips the lease entirely, which is how a result gets written
  -- by something that never held the job.
  reason := pg_temp.rejected(format(
    $sql$UPDATE public.media_ingest_jobs SET status = 'done' WHERE id = %L$sql$,
    target_job
  ));
  IF reason IS DISTINCT FROM 'media ingest job cannot move from queued to done' THEN
    failures := array_append(failures,
      'queued -> done was accepted: ' || coalesce(reason, 'ACCEPTED'));
  END IF;

  -- Half a lease would let two workers hold one job.
  reason := pg_temp.rejected(format($sql$
    UPDATE public.media_ingest_jobs
       SET status = 'leased', lease_token = gen_random_uuid()
     WHERE id = %L
  $sql$, target_job));
  IF reason IS NULL OR reason NOT LIKE '%media_ingest_jobs_lease_is_whole%' THEN
    failures := array_append(failures,
      'a lease with no deadline was accepted: ' || coalesce(reason, 'ACCEPTED'));
  END IF;

  IF array_length(failures, 1) IS NOT NULL THEN
    RAISE EXCEPTION '26_video_ingest (D2) failures: %', array_to_string(failures, ' | ');
  END IF;
END;
$$;

-- Three attempts, then the job stops. A clip that fails three times is a broken
-- file or a broken pipeline, and retrying it forever hides both.
SELECT pg_temp.queue_head('26000000-0000-0000-0000-0000000001a2');

DO $$
DECLARE
  failures TEXT[] := ARRAY[]::TEXT[];
  claimed RECORD;
  attempt INTEGER;
  final_claim RECORD;
BEGIN
  FOR attempt IN 1 .. 2 LOOP
    SELECT * INTO claimed FROM public.claim_media_ingest_job(600);
    IF claimed.asset_id IS DISTINCT FROM '26000000-0000-0000-0000-0000000001a2' THEN
      failures := array_append(failures,
        'retry ' || attempt || ' claimed the wrong job');
      EXIT;
    END IF;
    PERFORM public.complete_media_ingest_job(
      claimed.job_id, claimed.lease_token, 'failed', reason => 'probe transcode failure'
    );
  END LOOP;

  -- attempts is now 3 (one in (D1), two here), so the next claim terminalizes
  -- the job and hands out nothing.
  IF (SELECT attempts FROM public.media_ingest_jobs
       WHERE asset_id = '26000000-0000-0000-0000-0000000001a2') <> 3 THEN
    failures := array_append(failures, 'the retry budget was not spent as expected');
  END IF;
  SELECT * INTO final_claim FROM public.claim_media_ingest_job(600);
  IF final_claim.asset_id IS NOT DISTINCT FROM '26000000-0000-0000-0000-0000000001a2' THEN
    failures := array_append(failures, 'a fourth attempt was handed out');
  END IF;
  IF pg_temp.job_status('26000000-0000-0000-0000-0000000001a2') <> 'failed' THEN
    failures := array_append(failures, 'the exhausted job was not terminalized');
  END IF;
  IF pg_temp.ingest_status('26000000-0000-0000-0000-0000000001a2') <> 'failed' THEN
    failures := array_append(failures, 'the exhausted ingest row was not marked failed');
  END IF;
  IF final_claim.job_id IS NOT NULL THEN
    -- Whatever else came out, release it.
    PERFORM public.complete_media_ingest_job(
      final_claim.job_id, final_claim.lease_token, 'failed', reason => 'released'
    );
  END IF;

  IF array_length(failures, 1) IS NOT NULL THEN
    RAISE EXCEPTION '26_video_ingest (D3) failures: %', array_to_string(failures, ' | ');
  END IF;
END;
$$;

-- ── (E) Completing: succeeded, flagged, failed ──────────────────────────
SELECT pg_temp.queue_head('26000000-0000-0000-0000-0000000002b1');

DO $$
DECLARE
  failures TEXT[] := ARRAY[]::TEXT[];
  claimed RECORD;
  ingest public.pitch_video_ingests;
  reason TEXT;
BEGIN
  SELECT * INTO claimed FROM public.claim_media_ingest_job(600);
  IF claimed.asset_id IS DISTINCT FROM '26000000-0000-0000-0000-0000000002b1' THEN
    RAISE EXCEPTION '26_video_ingest (E) could not claim the success fixture';
  END IF;

  -- 2026-07-30 U9: the original is deleted the moment ingest succeeds. A worker
  -- that has not deleted it cannot report success at all.
  reason := pg_temp.rejected(format($sql$
    SELECT public.complete_media_ingest_job(
      %L::UUID, %L::UUID, 'succeeded',
      proxy_path => 'pitch-media/x/proxy.mp4',
      poster_path => 'pitch-media/x/poster.jpg',
      duration_ms => 9000, probe_width => 1080, probe_height => 1920,
      face_boxes => '[]'::JSONB,
      original_deleted => false
    )
  $sql$, claimed.job_id, claimed.lease_token));
  IF reason IS DISTINCT FROM 'a succeeded ingest must have deleted the original upload' THEN
    failures := array_append(failures,
      'success without deleting the original was accepted: '
      || coalesce(reason, 'ACCEPTED'));
  END IF;

  -- Success is a COMPLETE result: no poster means no consent preview, and a
  -- missing probe result means nothing bounds a clip window.
  reason := pg_temp.rejected(format($sql$
    SELECT public.complete_media_ingest_job(
      %L::UUID, %L::UUID, 'succeeded',
      proxy_path => 'pitch-media/x/proxy.mp4',
      original_deleted => true
    )
  $sql$, claimed.job_id, claimed.lease_token));
  IF reason IS DISTINCT FROM 'a succeeded ingest must report every derivative it produced' THEN
    failures := array_append(failures,
      'an incomplete success was accepted: ' || coalesce(reason, 'ACCEPTED'));
  END IF;

  PERFORM public.complete_media_ingest_job(
    claimed.job_id, claimed.lease_token, 'succeeded',
    proxy_path => 'pitch-media/26000000-0000-0000-0000-000000000002/clip-1.proxy.mp4',
    poster_path => 'pitch-media/26000000-0000-0000-0000-000000000002/clip-1.poster.jpg',
    duration_ms => 9000, probe_width => 1080, probe_height => 1920,
    face_boxes => '[{"x": 0.31, "y": 0.18, "width": 0.24, "height": 0.24}]'::JSONB,
    original_deleted => true
  );

  SELECT * INTO ingest
    FROM public.pitch_video_ingests
   WHERE asset_id = '26000000-0000-0000-0000-0000000002b1';
  IF ingest.ingest_status <> 'succeeded' THEN
    failures := array_append(failures, 'the ingest row did not reach succeeded');
  END IF;
  IF ingest.original_deleted_at IS NULL THEN
    failures := array_append(failures, 'success did not record the original deletion');
  END IF;
  IF pg_temp.job_status('26000000-0000-0000-0000-0000000002b1') <> 'done' THEN
    failures := array_append(failures, 'the job did not finish');
  END IF;
  IF NOT private.pitch_video_ingest_succeeded('26000000-0000-0000-0000-0000000002b1') THEN
    failures := array_append(failures, 'a succeeded clip did not report itself ready');
  END IF;

  -- A succeeded ingest is FINAL. A late duplicate report from a worker that
  -- already finished must not walk a published clip back to processing.
  reason := pg_temp.rejected($sql$
    UPDATE public.pitch_video_ingests
       SET ingest_status = 'processing'
     WHERE asset_id = '26000000-0000-0000-0000-0000000002b1'
  $sql$);
  IF reason IS DISTINCT FROM 'a succeeded video ingest is final' THEN
    failures := array_append(failures,
      'a succeeded ingest was reopened: ' || coalesce(reason, 'ACCEPTED'));
  END IF;

  IF array_length(failures, 1) IS NOT NULL THEN
    RAISE EXCEPTION '26_video_ingest (E1) failures: %', array_to_string(failures, ' | ');
  END IF;
END;
$$;

-- The completeness CHECK guards the same invariant one layer down, for a writer
-- that does not go through the RPC at all.
DO $$
DECLARE
  failures TEXT[] := ARRAY[]::TEXT[];
  reason TEXT;
BEGIN
  UPDATE public.pitch_video_ingests
     SET ingest_status = 'processing'
   WHERE asset_id = '26000000-0000-0000-0000-0000000002b3';
  reason := pg_temp.rejected($sql$
    UPDATE public.pitch_video_ingests
       SET ingest_status = 'succeeded'
     WHERE asset_id = '26000000-0000-0000-0000-0000000002b3'
  $sql$);
  IF reason IS NULL OR reason NOT LIKE '%pitch_video_ingests_succeeded_is_complete%' THEN
    failures := array_append(failures,
      'a bare succeeded row was accepted: ' || coalesce(reason, 'ACCEPTED'));
  END IF;
  UPDATE public.pitch_video_ingests
     SET ingest_status = 'pending'
   WHERE asset_id = '26000000-0000-0000-0000-0000000002b3';

  IF array_length(failures, 1) IS NOT NULL THEN
    RAISE EXCEPTION '26_video_ingest (E2) failures: %', array_to_string(failures, ' | ');
  END IF;
END;
$$;

-- The flagged path: draft C's clip.
SELECT pg_temp.queue_head('26000000-0000-0000-0000-0000000003c1');

DO $$
DECLARE
  failures TEXT[] := ARRAY[]::TEXT[];
  claimed RECORD;
  ingest public.pitch_video_ingests;
  review public.video_moderation_reviews;
  reason TEXT;
BEGIN
  SELECT * INTO claimed FROM public.claim_media_ingest_job(600);
  IF claimed.asset_id IS DISTINCT FROM '26000000-0000-0000-0000-0000000003c1' THEN
    RAISE EXCEPTION '26_video_ingest (E3) could not claim the flagged fixture';
  END IF;

  -- A flag with no reason is a flag nobody can review.
  reason := pg_temp.rejected(format($sql$
    SELECT public.complete_media_ingest_job(%L::UUID, %L::UUID, 'flagged')
  $sql$, claimed.job_id, claimed.lease_token));
  IF reason IS DISTINCT FROM 'a flagged ingest must carry the moderation reason' THEN
    failures := array_append(failures,
      'a reasonless flag was accepted: ' || coalesce(reason, 'ACCEPTED'));
  END IF;

  PERFORM public.complete_media_ingest_job(
    claimed.job_id, claimed.lease_token, 'flagged',
    duration_ms => 8000, probe_width => 1080, probe_height => 1920,
    reason => 'frame moderation: sexual content'
  );

  SELECT * INTO ingest
    FROM public.pitch_video_ingests
   WHERE asset_id = '26000000-0000-0000-0000-0000000003c1';
  IF ingest.ingest_status <> 'flagged' THEN
    failures := array_append(failures, 'the flagged verdict was not recorded');
  END IF;
  -- The ONE case where the original survives: it is the evidence a human
  -- reviews, and deleting it would make the review a guess.
  IF ingest.original_deleted_at IS NOT NULL THEN
    failures := array_append(failures, 'a flagged clip deleted its own evidence');
  END IF;
  IF ingest.proxy_path IS NOT NULL OR ingest.poster_path IS NOT NULL THEN
    failures := array_append(failures, 'a flagged clip kept publishable derivatives');
  END IF;
  IF private.pitch_video_ingest_succeeded('26000000-0000-0000-0000-0000000003c1') THEN
    failures := array_append(failures, 'a flagged clip reported itself ready');
  END IF;

  -- §9: the row exists and a human can find it, on the review queue and on the
  -- existing ops alert surface.
  SELECT * INTO review
    FROM public.video_moderation_reviews
   WHERE asset_id = '26000000-0000-0000-0000-0000000003c1';
  IF review.id IS NULL THEN
    failures := array_append(failures, 'flagging opened no review row');
  ELSE
    IF review.disposition <> 'pending' THEN
      failures := array_append(failures, 'the review row was not pending');
    END IF;
    IF review.evidence_storage_path IS DISTINCT FROM
       'pitch-media/26000000-0000-0000-0000-000000000003/clip-1.mp4' THEN
      failures := array_append(failures, 'the review row does not name the retained evidence');
    END IF;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.ops_alerts
     WHERE alert_type = 'video_frame_moderation_flagged'
       AND detail ->> 'pitch_asset_id' = '26000000-0000-0000-0000-0000000003c1'
  ) THEN
    failures := array_append(failures, 'flagging raised no ops alert');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.list_pending_video_reviews(50)
     WHERE asset_id = '26000000-0000-0000-0000-0000000003c1'
  ) THEN
    failures := array_append(failures, 'the flagged clip is not on the service review queue');
  END IF;

  -- A worker may not re-run a flagged clip: only a human disposition re-queues
  -- one, which is what stops a retry loop from grinding past moderation.
  reason := pg_temp.rejected($sql$
    UPDATE public.pitch_video_ingests
       SET ingest_status = 'pending', flagged_reason = NULL
     WHERE asset_id = '26000000-0000-0000-0000-0000000003c1'
  $sql$);
  IF reason IS DISTINCT FROM
     'a flagged clip may only be re-ingested after a review clears it' THEN
    failures := array_append(failures,
      'a flagged clip was re-queued without a review: ' || coalesce(reason, 'ACCEPTED'));
  END IF;

  IF array_length(failures, 1) IS NOT NULL THEN
    RAISE EXCEPTION '26_video_ingest (E3) failures: %', array_to_string(failures, ' | ');
  END IF;
END;
$$;

-- ── (F) Face boxes ──────────────────────────────────────────────────────
DO $$
DECLARE
  failures TEXT[] := ARRAY[]::TEXT[];
  reason TEXT;
  visible BIGINT;
BEGIN
  -- Pixel coordinates. Nothing downstream re-checks these numbers before a blur
  -- is drawn from them, so a worker that wrote pixels must fail here.
  reason := pg_temp.rejected($sql$
    UPDATE public.pitch_video_ingests
       SET face_boxes = '[{"x": 420, "y": 160, "width": 200, "height": 200}]'::JSONB
     WHERE asset_id = '26000000-0000-0000-0000-0000000002b2'
  $sql$);
  IF reason IS NULL OR reason NOT LIKE '%face_boxes%' THEN
    failures := array_append(failures,
      'pixel face boxes were accepted: ' || coalesce(reason, 'ACCEPTED'));
  END IF;

  -- An extra key is where an identity field would arrive.
  reason := pg_temp.rejected($sql$
    UPDATE public.pitch_video_ingests
       SET face_boxes =
         '[{"x": 0.1, "y": 0.1, "width": 0.2, "height": 0.2, "name": "blair"}]'::JSONB
     WHERE asset_id = '26000000-0000-0000-0000-0000000002b2'
  $sql$);
  IF reason IS NULL OR reason NOT LIKE '%face_boxes%' THEN
    failures := array_append(failures,
      'a named face box was accepted: ' || coalesce(reason, 'ACCEPTED'));
  END IF;

  -- "Detection ran and found nothing" is a result, not a missing value.
  UPDATE public.pitch_video_ingests
     SET face_boxes = '[]'::JSONB
   WHERE asset_id = '26000000-0000-0000-0000-0000000002b2';

  -- The exposure contract with the web worker: nothing a browser session can
  -- reach may read this table at all.
  PERFORM set_config(
    'request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true
  );
  SET LOCAL ROLE authenticated;
  reason := pg_temp.rejected(
    $sql$SELECT count(*) FROM public.pitch_video_ingests$sql$
  );
  IF reason IS NULL OR reason NOT LIKE '%permission denied%' THEN
    failures := array_append(failures,
      'an authenticated session could read pitch_video_ingests: '
      || coalesce(reason, 'ACCEPTED'));
  END IF;
  RESET ROLE;

  -- And no browser-reachable view selects it either.
  SELECT count(*) INTO visible
    FROM pg_class view_class
    JOIN pg_namespace view_schema ON view_schema.oid = view_class.relnamespace
   WHERE view_class.relkind IN ('v', 'm')
     AND view_schema.nspname = 'public'
     AND pg_get_viewdef(view_class.oid) LIKE '%face_boxes%';
  IF visible <> 0 THEN
    failures := array_append(failures, 'a public view selects face_boxes');
  END IF;

  IF array_length(failures, 1) IS NOT NULL THEN
    RAISE EXCEPTION '26_video_ingest (F) failures: %', array_to_string(failures, ' | ');
  END IF;
END;
$$;

-- ── (G) The consent gate ────────────────────────────────────────────────
-- Phase 3a shows clips on the consent surface, so a draft carrying FLAGGED
-- frames may not enter review: submitting it would show the Dater exactly the
-- frames moderation refused.
DO $$
DECLARE
  failures TEXT[] := ARRAY[]::TEXT[];
  reason TEXT;
BEGIN
  PERFORM set_config(
    'request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true
  );
  reason := pg_temp.rejected($sql$
    SELECT * FROM public.submit_pitch_for_consent(
      '26000000-0000-0000-0000-000000000003', 'email', 'dater@example.test', 'Blair'
    )
  $sql$);
  IF reason IS DISTINCT FROM 'remove the flagged video clip before requesting consent' THEN
    failures := array_append(failures,
      'a draft with flagged frames entered consent: ' || coalesce(reason, 'ACCEPTED'));
  END IF;

  -- Draft B carries a succeeded clip and two pending ones, and submits fine: a
  -- clip still being processed is not an error, it is just not usable yet.
  reason := pg_temp.rejected($sql$
    SELECT * FROM public.submit_pitch_for_consent(
      '26000000-0000-0000-0000-000000000002', 'email', 'dater@example.test', 'Blair'
    )
  $sql$);
  IF reason IS NOT NULL THEN
    failures := array_append(failures,
      'a draft with a pending clip could not enter consent: ' || reason);
  END IF;

  IF array_length(failures, 1) IS NOT NULL THEN
    RAISE EXCEPTION '26_video_ingest (G) failures: %', array_to_string(failures, ' | ');
  END IF;
END;
$$;

-- Resolving the review is what re-opens a flagged clip, exactly once.
DO $$
DECLARE
  failures TEXT[] := ARRAY[]::TEXT[];
  review_id UUID;
  reason TEXT;
BEGIN
  SELECT id INTO review_id
    FROM public.video_moderation_reviews
   WHERE asset_id = '26000000-0000-0000-0000-0000000003c1';

  reason := pg_temp.rejected(format($sql$
    SELECT public.resolve_video_moderation_review(%L::UUID, 'maybe')
  $sql$, review_id));
  IF reason IS DISTINCT FROM 'disposition must be rejected or cleared' THEN
    failures := array_append(failures,
      'an unknown disposition was accepted: ' || coalesce(reason, 'ACCEPTED'));
  END IF;

  -- The only way back out of a terminal job is a cleared review. Without one, a
  -- retry loop would grind a refused clip through moderation again.
  reason := pg_temp.rejected($sql$
    UPDATE public.media_ingest_jobs
       SET status = 'queued'
     WHERE asset_id = '26000000-0000-0000-0000-0000000003c1'
  $sql$);
  IF reason IS DISTINCT FROM
     'a finished ingest job may only be re-queued by a cleared moderation review' THEN
    failures := array_append(failures,
      'a finished job was re-queued with no review: ' || coalesce(reason, 'ACCEPTED'));
  END IF;

  PERFORM public.resolve_video_moderation_review(
    review_id, 'cleared', 'reviewed: a false positive on a beach photo'
  );
  IF pg_temp.ingest_status('26000000-0000-0000-0000-0000000003c1') <> 'pending' THEN
    failures := array_append(failures, 'clearing a review did not re-open the clip');
  END IF;
  IF pg_temp.job_status('26000000-0000-0000-0000-0000000003c1') <> 'queued' THEN
    failures := array_append(failures, 'clearing a review did not re-queue the job');
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.list_pending_video_reviews(50)
     WHERE asset_id = '26000000-0000-0000-0000-0000000003c1'
  ) THEN
    failures := array_append(failures, 'a resolved review is still on the queue');
  END IF;

  reason := pg_temp.rejected(format($sql$
    SELECT public.resolve_video_moderation_review(%L::UUID, 'rejected')
  $sql$, review_id));
  IF reason IS DISTINCT FROM 'video moderation review is already resolved' THEN
    failures := array_append(failures,
      'a review was resolved twice: ' || coalesce(reason, 'ACCEPTED'));
  END IF;

  IF array_length(failures, 1) IS NOT NULL THEN
    RAISE EXCEPTION '26_video_ingest (G2) failures: %', array_to_string(failures, ' | ');
  END IF;
END;
$$;

-- ── (H) A v3 scene through the RPCs ─────────────────────────────────────
-- Draft B: one photo, one ready clip (2b1), two clips still pending. Its
-- transcript ends at 6.0s, so every scene here declares 6000ms.
CREATE FUNCTION pg_temp.canon_v3()
RETURNS JSONB
LANGUAGE sql
AS $fn$
  SELECT $json$
{
  "schemaVersion": 3,
  "template": "warm",
  "canvas": {"width":1080,"height":1920,"fps":30},
  "durationMs": 6000,
  "assetIds": ["26000000-0000-0000-0000-0000000002b8"],
  "clipAssetIds": ["26000000-0000-0000-0000-0000000002b1"],
  "shots": [
    {
      "level": "wide",
      "assetId": "26000000-0000-0000-0000-0000000002b8",
      "startMs": 0,
      "endMs": 2000,
      "crop": {"x":0,"y":0,"width":1,"height":1},
      "effects": []
    },
    {
      "level": "clip",
      "assetId": "26000000-0000-0000-0000-0000000002b1",
      "startMs": 2000,
      "endMs": 6000,
      "clipInMs": 0,
      "clipOutMs": 4000,
      "effects": []
    }
  ],
  "look": {
    "grade": {"warmth":0.3,"contrast":1.1,"saturation":1.05,"vignette":0.25},
    "grain": {"intensity":0.12,"sizePx":2,"seed":1234567,"animationHz":24}
  },
  "chrome": {"progressBar": {"thicknessPx":4,"opacity":0.6,"anchor":"bottom"}},
  "overlays": []
}
  $json$::JSONB;
$fn$;

CREATE FUNCTION pg_temp.submit_reject_reason(target_draft UUID, candidate JSONB)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
BEGIN
  BEGIN
    PERFORM * FROM public.submit_pitch_for_consent(
      target_draft, 'email', 'dater@example.test', 'Blair', candidate
    );
    RAISE EXCEPTION 'D26-ACCEPTED';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'D26-ACCEPTED' THEN
      RETURN NULL;
    END IF;
    RETURN SQLERRM;
  END;
END;
$$;

DO $$
DECLARE
  failures TEXT[] := ARRAY[]::TEXT[];
  draft CONSTANT UUID := '26000000-0000-0000-0000-000000000002';
  ready_clip CONSTANT TEXT := '"26000000-0000-0000-0000-0000000002b1"';
  pending_clip CONSTANT TEXT := '"26000000-0000-0000-0000-0000000002b2"';
  second_photo CONSTANT TEXT := '"26000000-0000-0000-0000-0000000002b9"';
  reason TEXT;
  candidate JSONB;
BEGIN
  PERFORM set_config(
    'request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true
  );

  -- Positive control: a photo and a reviewed clip, replayed 1:1.
  reason := pg_temp.submit_reject_reason(draft, pg_temp.canon_v3());
  IF reason IS NOT NULL THEN
    failures := array_append(failures, 'the canonical v3 scene was rejected: ' || reason);
  END IF;

  -- THE GATE THIS MIGRATION EXISTS FOR: a clip whose frames have not been
  -- moderated may not enter an approved timeline.
  candidate := jsonb_set(
    jsonb_set(pg_temp.canon_v3(), '{clipAssetIds}', jsonb_build_array(pending_clip::JSONB)),
    '{shots,1,assetId}', pending_clip::JSONB
  );
  reason := pg_temp.submit_reject_reason(draft, candidate);
  IF reason IS DISTINCT FROM 'pitch scene must reference only reviewed video assets' THEN
    failures := array_append(failures,
      'a pending clip was accepted into a scene: ' || coalesce(reason, 'ACCEPTED'));
  END IF;

  -- A clip belonging to another draft is not this row's clip either.
  candidate := jsonb_set(
    jsonb_set(
      pg_temp.canon_v3(), '{clipAssetIds}',
      jsonb_build_array('"26000000-0000-0000-0000-0000000003c1"'::JSONB)
    ),
    '{shots,1,assetId}', '"26000000-0000-0000-0000-0000000003c1"'::JSONB
  );
  reason := pg_temp.submit_reject_reason(draft, candidate);
  IF reason IS DISTINCT FROM 'pitch scene must reference only reviewed video assets' THEN
    failures := array_append(failures,
      'another draft''s clip was accepted: ' || coalesce(reason, 'ACCEPTED'));
  END IF;

  -- 1:1 playback. A 3000ms window stretched over 4000ms of screen time is slow
  -- motion, which is a second interpretation of reviewed footage.
  reason := pg_temp.submit_reject_reason(
    draft, jsonb_set(pg_temp.canon_v3(), '{shots,1,clipOutMs}', '3000'::JSONB)
  );
  IF reason IS DISTINCT FROM
     'pitch scene clip shot must replay its source 1:1 (clipOut - clipIn must equal endMs - startMs)' THEN
    failures := array_append(failures,
      'a retimed clip was accepted: ' || coalesce(reason, 'ACCEPTED'));
  END IF;

  -- A reversed window is not a window.
  candidate := jsonb_set(
    jsonb_set(pg_temp.canon_v3(), '{shots,1,clipInMs}', '4000'::JSONB),
    '{shots,1,clipOutMs}', '0'::JSONB
  );
  reason := pg_temp.submit_reject_reason(draft, candidate);
  IF reason IS DISTINCT FROM
     'pitch scene clip window must run forward and last at least 1200ms' THEN
    failures := array_append(failures,
      'a reversed clip window was accepted: ' || coalesce(reason, 'ACCEPTED'));
  END IF;

  -- The header and the shots have to agree, both directions.
  reason := pg_temp.submit_reject_reason(draft, pg_temp.canon_v3() - 'clipAssetIds');
  IF reason IS DISTINCT FROM
     'pitch scene clip shot may only use a clip listed in clipAssetIds' THEN
    failures := array_append(failures,
      'a clip shot with no header was accepted: ' || coalesce(reason, 'ACCEPTED'));
  END IF;

  -- clipAssetIds is ABSENT when no clip plays, never an empty array and never a
  -- list of clips the timeline does not show.
  candidate := jsonb_set(
    jsonb_set(
      pg_temp.canon_v3(),
      '{shots,1}',
      jsonb_build_object(
        'level', 'wideAlt',
        'assetId', second_photo::JSONB,
        'startMs', 2000,
        'endMs', 6000,
        'crop', '{"x":0.05,"y":0.05,"width":0.9,"height":0.9}'::JSONB,
        'effects',
        '[{"type":"kenBurns","to":{"x":0.02,"y":0.02,"width":0.96,"height":0.96},"easing":"easeInOut"}]'::JSONB
      )
    ),
    '{assetIds}',
    jsonb_build_array('"26000000-0000-0000-0000-0000000002b8"'::JSONB, second_photo::JSONB)
  );
  reason := pg_temp.submit_reject_reason(draft, candidate);
  IF reason IS DISTINCT FROM
     'pitch scene clipAssetIds must be absent when no shot plays a clip' THEN
    failures := array_append(failures,
      'a clip header with no clip shot was accepted: ' || coalesce(reason, 'ACCEPTED'));
  END IF;
  reason := pg_temp.submit_reject_reason(
    draft, jsonb_set(pg_temp.canon_v3(), '{clipAssetIds}', '[]'::JSONB)
  );
  IF reason IS DISTINCT FROM
     'pitch scene clipAssetIds must be a non-empty list of distinct clip ids' THEN
    failures := array_append(failures,
      'an empty clipAssetIds was accepted: ' || coalesce(reason, 'ACCEPTED'));
  END IF;
  reason := pg_temp.submit_reject_reason(
    draft,
    jsonb_set(
      pg_temp.canon_v3(), '{clipAssetIds}',
      jsonb_build_array(ready_clip::JSONB, ready_clip::JSONB)
    )
  );
  IF reason IS DISTINCT FROM
     'pitch scene clipAssetIds must be a non-empty list of distinct clip ids' THEN
    failures := array_append(failures,
      'a repeated clip id was accepted: ' || coalesce(reason, 'ACCEPTED'));
  END IF;

  -- A clip shot has no crop and carries only wordPops.
  reason := pg_temp.submit_reject_reason(
    draft,
    jsonb_set(
      pg_temp.canon_v3(), '{shots,1,effects}',
      '[{"type":"kenBurns","to":{"x":0.02,"y":0.02,"width":0.96,"height":0.96},"easing":"easeInOut"}]'::JSONB
    )
  );
  IF reason IS DISTINCT FROM 'pitch scene clip shot may carry only wordPop effects' THEN
    failures := array_append(failures,
      'a kenBurns on a clip was accepted: ' || coalesce(reason, 'ACCEPTED'));
  END IF;
  reason := pg_temp.submit_reject_reason(
    draft,
    jsonb_set(
      pg_temp.canon_v3(), '{shots,1,crop}', '{"x":0,"y":0,"width":1,"height":1}'::JSONB
    )
  );
  IF reason IS DISTINCT FROM
     'pitch scene clip shot must carry only level, assetId, startMs, endMs, clipInMs, clipOutMs and effects' THEN
    failures := array_append(failures,
      'a cropped clip shot was accepted: ' || coalesce(reason, 'ACCEPTED'));
  END IF;

  -- A wordPop on a clip is legal and pays exactly the rules a photo's pays: the
  -- two branches call one shared implementation.
  reason := pg_temp.submit_reject_reason(
    draft,
    jsonb_set(
      pg_temp.canon_v3(), '{shots,1,effects}',
      '[{"type":"wordPop","word":{"segmentIndex":1,"wordIndex":5},"startMs":2400,"endMs":2800,"scale":1.25,"easing":"easeOut"}]'::JSONB
    )
  );
  IF reason IS NOT NULL THEN
    failures := array_append(failures, 'a wordPop on a clip was rejected: ' || reason);
  END IF;
  reason := pg_temp.submit_reject_reason(
    draft,
    jsonb_set(
      pg_temp.canon_v3(), '{shots,1,effects}',
      '[{"type":"wordPop","word":{"segmentIndex":1,"wordIndex":5},"startMs":2400,"endMs":2440,"scale":1.25,"easing":"easeOut"}]'::JSONB
    )
  );
  IF reason IS DISTINCT FROM 'pitch scene wordPop must last between 120ms and 1200ms' THEN
    failures := array_append(failures,
      'a 40ms wordPop on a clip was accepted: ' || coalesce(reason, 'ACCEPTED'));
  END IF;
  reason := pg_temp.submit_reject_reason(
    draft,
    jsonb_set(
      pg_temp.canon_v3(), '{shots,1,effects}',
      '[{"type":"wordPop","word":{"segmentIndex":1,"wordIndex":99},"startMs":2400,"endMs":2800,"scale":1.25,"easing":"easeOut"}]'::JSONB
    )
  );
  IF reason IS DISTINCT FROM 'pitch scene wordPop references a word outside the transcript' THEN
    failures := array_append(failures,
      'a wordPop on a clip escaped the transcript: ' || coalesce(reason, 'ACCEPTED'));
  END IF;

  IF array_length(failures, 1) IS NOT NULL THEN
    RAISE EXCEPTION '26_video_ingest (H) failures: %', array_to_string(failures, ' | ');
  END IF;
END;
$$;

-- The clip a Dater drops, or one that is flagged after the Introducer built the
-- timeline, demotes the carried-forward scene to no motion — exactly as a
-- dropped photo does, and never a refusal that would trap the Dater.
DO $$
DECLARE
  failures TEXT[] := ARRAY[]::TEXT[];
  draft CONSTANT UUID := '26000000-0000-0000-0000-000000000002';
  submitted RECORD;
  revision RECORD;
  carried JSONB;
BEGIN
  PERFORM set_config(
    'request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true
  );
  SELECT * INTO submitted
    FROM public.submit_pitch_for_consent(
      draft, 'email', 'dater@example.test', 'Blair', pg_temp.canon_v3()
    );
  IF (SELECT scene_definition FROM public.consent_revisions
       WHERE pitch_draft_id = draft ORDER BY revision_number DESC LIMIT 1) IS NULL THEN
    failures := array_append(failures, 'the v3 scene was not stored on the revision');
  END IF;

  UPDATE public.consent_requests
     SET subject_user_id = '00000000-0000-0000-0000-000000000002'
   WHERE pitch_draft_id = draft;
  UPDATE public.pitch_drafts
     SET subject_user_id = '00000000-0000-0000-0000-000000000002'
   WHERE id = draft;

  PERFORM set_config(
    'request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true
  );
  -- A photo-only save carries the timeline forward while the clip is still
  -- reviewed.
  SELECT * INTO revision
    FROM public.create_dater_revision(
      draft, 'probe headline', 'probe body',
      ARRAY['26000000-0000-0000-0000-0000000002b8'::UUID,
            '26000000-0000-0000-0000-0000000002b1'::UUID],
      NULL, NULL, NULL
    );
  SELECT scene_definition INTO carried
    FROM public.consent_revisions WHERE id = revision.revision_id;
  IF carried IS NULL THEN
    failures := array_append(failures, 'a reviewed clip did not survive a photo-only save');
  END IF;

  -- Drop the clip from the include set: the scene must demote, not dangle.
  SELECT * INTO revision
    FROM public.create_dater_revision(
      draft, 'probe headline', 'probe body',
      ARRAY['26000000-0000-0000-0000-0000000002b8'::UUID],
      NULL, NULL, NULL
    );
  SELECT scene_definition INTO carried
    FROM public.consent_revisions WHERE id = revision.revision_id;
  IF carried IS NOT NULL THEN
    failures := array_append(failures,
      'a scene survived losing the clip it plays');
  END IF;

  IF array_length(failures, 1) IS NOT NULL THEN
    RAISE EXCEPTION '26_video_ingest (H2) failures: %', array_to_string(failures, ' | ');
  END IF;
END;
$$;

-- The shared 12-asset ceiling, built rather than typed: photos and clips draw on
-- ONE budget, so a 12-photo scene has no room for a clip.
CREATE FUNCTION pg_temp.wide_photo_id(index INTEGER)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT '40000000-0000-0000-0000-' || lpad(index::TEXT, 12, '0');
$$;

CREATE FUNCTION pg_temp.wide_clip_id(index INTEGER)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT '50000000-0000-0000-0000-' || lpad(index::TEXT, 12, '0');
$$;

CREATE FUNCTION pg_temp.wide_scene(photo_count INTEGER, clip_count INTEGER)
RETURNS JSONB
LANGUAGE sql
AS $$
  SELECT jsonb_build_object(
    'schemaVersion', 3,
    'template', 'warm',
    'canvas', '{"width":1080,"height":1920,"fps":30}'::JSONB,
    'durationMs', (photo_count + clip_count) * 1200,
    'assetIds', (
      SELECT jsonb_agg(to_jsonb(pg_temp.wide_photo_id(index)) ORDER BY index)
        FROM generate_series(1, photo_count) AS index
    ),
    'clipAssetIds', (
      SELECT jsonb_agg(to_jsonb(pg_temp.wide_clip_id(index)) ORDER BY index)
        FROM generate_series(1, clip_count) AS index
    ),
    'shots', (
      SELECT jsonb_agg(shot ORDER BY ord)
        FROM (
          SELECT index AS ord,
                 jsonb_build_object(
                   'level', 'wide',
                   'assetId', pg_temp.wide_photo_id(index),
                   'startMs', (index - 1) * 1200,
                   'endMs', index * 1200,
                   'crop', '{"x":0,"y":0,"width":1,"height":1}'::JSONB,
                   'effects', '[]'::JSONB
                 ) AS shot
            FROM generate_series(1, photo_count) AS index
          UNION ALL
          SELECT photo_count + index AS ord,
                 jsonb_build_object(
                   'level', 'clip',
                   'assetId', pg_temp.wide_clip_id(index),
                   'startMs', (photo_count + index - 1) * 1200,
                   'endMs', (photo_count + index) * 1200,
                   'clipInMs', 0,
                   'clipOutMs', 1200,
                   'effects', '[]'::JSONB
                 ) AS shot
            FROM generate_series(1, clip_count) AS index
        ) AS shots
    ),
    'look', '{"grade":{"warmth":0.3,"contrast":1.1,"saturation":1.05,"vignette":0.25},
              "grain":{"intensity":0.12,"sizePx":2,"seed":1234567,"animationHz":24}}'::JSONB,
    'chrome', '{"progressBar":{"thicknessPx":4,"opacity":0.6,"anchor":"bottom"}}'::JSONB,
    'overlays', '[]'::JSONB
  );
$$;

DO $$
DECLARE
  failures TEXT[] := ARRAY[]::TEXT[];
  reason TEXT;
  scene JSONB;
BEGIN
  -- Eleven photos and one clip is twelve assets: the ceiling, not past it.
  scene := pg_temp.wide_scene(11, 1);
  reason := private.pitch_scene_violation(
    scene,
    (scene ->> 'durationMs')::INTEGER,
    (SELECT array_agg((listed.value #>> '{}')::UUID)
       FROM jsonb_array_elements(scene -> 'assetIds') AS listed(value)),
    '{"segments": [{"start": 0, "end": 14.4}], "words": []}'::JSONB,
    NULL,
    (SELECT array_agg((listed.value #>> '{}')::UUID)
       FROM jsonb_array_elements(scene -> 'clipAssetIds') AS listed(value))
  );
  IF reason IS NOT NULL THEN
    failures := array_append(failures, '11 photos and 1 clip was rejected: ' || reason);
  END IF;

  -- Twelve photos and one clip is thirteen. Two separate ceilings would have let
  -- one scene reference fifteen assets.
  scene := pg_temp.wide_scene(12, 1);
  reason := private.pitch_scene_violation(
    scene,
    (scene ->> 'durationMs')::INTEGER,
    (SELECT array_agg((listed.value #>> '{}')::UUID)
       FROM jsonb_array_elements(scene -> 'assetIds') AS listed(value)),
    '{"segments": [{"start": 0, "end": 15.6}], "words": []}'::JSONB,
    NULL,
    (SELECT array_agg((listed.value #>> '{}')::UUID)
       FROM jsonb_array_elements(scene -> 'clipAssetIds') AS listed(value))
  );
  IF reason IS DISTINCT FROM
     'pitch scene may reference at most 12 assets, photos and clips together' THEN
    failures := array_append(failures,
      '13 assets were accepted: ' || coalesce(reason, 'ACCEPTED'));
  END IF;

  IF array_length(failures, 1) IS NOT NULL THEN
    RAISE EXCEPTION '26_video_ingest (H3) failures: %', array_to_string(failures, ' | ');
  END IF;
END;
$$;

-- ── (I) Golden vectors: one list of clip scenes, three implementations ──
-- The clip rules are enforced independently by the zod parser in
-- packages/contracts/src/pitchSceneV3.ts, by the PL/pgSQL mirror in migration
-- 0050, and (in Phase 3b) by the builder that emits clips. Agreement between
-- them is forced by DATA, not by a comment: the rows below are GENERATED from
-- PITCH_SCENE_V3_GOLDEN_VECTORS and the contracts vitest suite runs the SAME
-- rows against the parser. Editing the generated block by hand would put the two
-- suites back on separate data, which is the state finding F1 was found in.
--
-- These probes call private.pitch_scene_violation directly: each vector carries
-- its own durationMs, its own photo and its own clips, so no single fixture
-- draft could host all of them, and the RPC path down to this validator is what
-- section (H) exercises.

-- ── GOLDEN VECTORS, v3 CLIP SHOT (GENERATED — DO NOT EDIT) ───────────────
-- Source: packages/contracts/src/pitchSceneGoldenVectors.ts
--         (PITCH_SCENE_V3_GOLDEN_VECTORS, printed by pitchSceneV3GoldenVectorsSql)
-- The same rows run against the zod parser in that package’s vitest suite.
-- expected_reason NULL means the scene must be ACCEPTED.
CREATE TEMPORARY TABLE pitch_scene_golden_vector_v3 (
  name TEXT PRIMARY KEY,
  requires_structure BOOLEAN NOT NULL,
  expected_reason TEXT,
  scene JSONB NOT NULL
);
INSERT INTO pitch_scene_golden_vector_v3 (name, requires_structure, expected_reason, scene)
VALUES
  ('v3-one-clip-after-a-photo',
   false,
   NULL,
   $vector${"schemaVersion":3,"template":"hype","canvas":{"width":1080,"height":1920,"fps":30},"durationMs":6000,"assetIds":["40000000-0000-0000-0000-000000000001"],"clipAssetIds":["50000000-0000-0000-0000-000000000001"],"shots":[{"level":"wide","assetId":"40000000-0000-0000-0000-000000000001","startMs":0,"endMs":2000,"crop":{"x":0,"y":0,"width":1,"height":1},"effects":[]},{"level":"clip","assetId":"50000000-0000-0000-0000-000000000001","startMs":2000,"endMs":6000,"clipInMs":0,"clipOutMs":4000,"effects":[]}],"look":{"grade":{"warmth":0.12,"contrast":1.28,"saturation":1.22,"vignette":0.18},"grain":{"intensity":0.1,"sizePx":2,"seed":1234567,"animationHz":30}},"chrome":{"progressBar":{"thicknessPx":5,"opacity":0.8,"anchor":"top"}},"overlays":[]}$vector$::JSONB),
  ('v3-three-clips-at-every-cap',
   false,
   NULL,
   $vector${"schemaVersion":3,"template":"hype","canvas":{"width":1080,"height":1920,"fps":30},"durationMs":19000,"assetIds":["40000000-0000-0000-0000-000000000001"],"clipAssetIds":["50000000-0000-0000-0000-000000000001","50000000-0000-0000-0000-000000000002","50000000-0000-0000-0000-000000000003"],"shots":[{"level":"wide","assetId":"40000000-0000-0000-0000-000000000001","startMs":0,"endMs":2000,"crop":{"x":0,"y":0,"width":1,"height":1},"effects":[]},{"level":"clip","assetId":"50000000-0000-0000-0000-000000000001","startMs":2000,"endMs":5000,"clipInMs":0,"clipOutMs":3000,"effects":[]},{"level":"clip","assetId":"50000000-0000-0000-0000-000000000002","startMs":5000,"endMs":9000,"clipInMs":1000,"clipOutMs":5000,"effects":[]},{"level":"clip","assetId":"50000000-0000-0000-0000-000000000003","startMs":9000,"endMs":19000,"clipInMs":5000,"clipOutMs":15000,"effects":[]}],"look":{"grade":{"warmth":0.12,"contrast":1.28,"saturation":1.22,"vignette":0.18},"grain":{"intensity":0.1,"sizePx":2,"seed":1234567,"animationHz":30}},"chrome":{"progressBar":{"thicknessPx":5,"opacity":0.8,"anchor":"top"}},"overlays":[]}$vector$::JSONB),
  ('v3-clip-card-and-wordpop-mixed',
   true,
   NULL,
   $vector${"schemaVersion":3,"template":"hype","canvas":{"width":1080,"height":1920,"fps":30},"durationMs":8200,"assetIds":["40000000-0000-0000-0000-000000000001"],"clipAssetIds":["50000000-0000-0000-0000-000000000001","50000000-0000-0000-0000-000000000002"],"shots":[{"level":"wide","assetId":"40000000-0000-0000-0000-000000000001","startMs":0,"endMs":2000,"crop":{"x":0,"y":0,"width":1,"height":1},"effects":[]},{"level":"clip","assetId":"50000000-0000-0000-0000-000000000001","startMs":2000,"endMs":5000,"clipInMs":2000,"clipOutMs":5000,"effects":[{"type":"wordPop","word":{"segmentIndex":0,"wordIndex":2},"startMs":2200,"endMs":2600,"scale":1.25,"easing":"easeOut"}]},{"level":"typographic","startMs":5000,"endMs":7000,"text":{"type":"kineticText","source":"hook","revealMs":300,"easing":"easeOut","emphasis":0.8}},{"level":"clip","assetId":"50000000-0000-0000-0000-000000000002","startMs":7000,"endMs":8200,"clipInMs":0,"clipOutMs":1200,"effects":[]}],"look":{"grade":{"warmth":0.12,"contrast":1.28,"saturation":1.22,"vignette":0.18},"grain":{"intensity":0.1,"sizePx":2,"seed":1234567,"animationHz":30}},"chrome":{"progressBar":{"thicknessPx":5,"opacity":0.8,"anchor":"top"}},"overlays":[]}$vector$::JSONB),
  ('v3-clip-retimed-not-1to1',
   false,
   'pitch scene clip shot must replay its source 1:1 (clipOut - clipIn must equal endMs - startMs)',
   $vector${"schemaVersion":3,"template":"hype","canvas":{"width":1080,"height":1920,"fps":30},"durationMs":4000,"assetIds":["40000000-0000-0000-0000-000000000001"],"clipAssetIds":["50000000-0000-0000-0000-000000000001"],"shots":[{"level":"wide","assetId":"40000000-0000-0000-0000-000000000001","startMs":0,"endMs":2000,"crop":{"x":0,"y":0,"width":1,"height":1},"effects":[]},{"level":"clip","assetId":"50000000-0000-0000-0000-000000000001","startMs":2000,"endMs":4000,"clipInMs":0,"clipOutMs":3000,"effects":[]}],"look":{"grade":{"warmth":0.12,"contrast":1.28,"saturation":1.22,"vignette":0.18},"grain":{"intensity":0.1,"sizePx":2,"seed":1234567,"animationHz":30}},"chrome":{"progressBar":{"thicknessPx":5,"opacity":0.8,"anchor":"top"}},"overlays":[]}$vector$::JSONB),
  ('v3-clip-window-past-ten-seconds',
   false,
   'pitch scene clip may not hold the screen longer than 10000ms',
   $vector${"schemaVersion":3,"template":"hype","canvas":{"width":1080,"height":1920,"fps":30},"durationMs":12001,"assetIds":["40000000-0000-0000-0000-000000000001"],"clipAssetIds":["50000000-0000-0000-0000-000000000001"],"shots":[{"level":"wide","assetId":"40000000-0000-0000-0000-000000000001","startMs":0,"endMs":2000,"crop":{"x":0,"y":0,"width":1,"height":1},"effects":[]},{"level":"clip","assetId":"50000000-0000-0000-0000-000000000001","startMs":2000,"endMs":12001,"clipInMs":0,"clipOutMs":10001,"effects":[]}],"look":{"grade":{"warmth":0.12,"contrast":1.28,"saturation":1.22,"vignette":0.18},"grain":{"intensity":0.1,"sizePx":2,"seed":1234567,"animationHz":30}},"chrome":{"progressBar":{"thicknessPx":5,"opacity":0.8,"anchor":"top"}},"overlays":[]}$vector$::JSONB),
  ('v3-clip-total-past-ten-seconds-across-windows',
   false,
   'pitch scene clip may not hold the screen longer than 10000ms',
   $vector${"schemaVersion":3,"template":"hype","canvas":{"width":1080,"height":1920,"fps":30},"durationMs":12001,"assetIds":["40000000-0000-0000-0000-000000000001"],"clipAssetIds":["50000000-0000-0000-0000-000000000001"],"shots":[{"level":"wide","assetId":"40000000-0000-0000-0000-000000000001","startMs":0,"endMs":2000,"crop":{"x":0,"y":0,"width":1,"height":1},"effects":[]},{"level":"clip","assetId":"50000000-0000-0000-0000-000000000001","startMs":2000,"endMs":8000,"clipInMs":0,"clipOutMs":6000,"effects":[]},{"level":"clip","assetId":"50000000-0000-0000-0000-000000000001","startMs":8000,"endMs":12001,"clipInMs":6000,"clipOutMs":10001,"effects":[]}],"look":{"grade":{"warmth":0.12,"contrast":1.28,"saturation":1.22,"vignette":0.18},"grain":{"intensity":0.1,"sizePx":2,"seed":1234567,"animationHz":30}},"chrome":{"progressBar":{"thicknessPx":5,"opacity":0.8,"anchor":"top"}},"overlays":[]}$vector$::JSONB),
  ('v3-four-distinct-clips',
   false,
   'pitch scene may use at most 3 clips',
   $vector${"schemaVersion":3,"template":"hype","canvas":{"width":1080,"height":1920,"fps":30},"durationMs":6800,"assetIds":["40000000-0000-0000-0000-000000000001"],"clipAssetIds":["50000000-0000-0000-0000-000000000001","50000000-0000-0000-0000-000000000002","50000000-0000-0000-0000-000000000003","50000000-0000-0000-0000-000000000004"],"shots":[{"level":"wide","assetId":"40000000-0000-0000-0000-000000000001","startMs":0,"endMs":2000,"crop":{"x":0,"y":0,"width":1,"height":1},"effects":[]},{"level":"clip","assetId":"50000000-0000-0000-0000-000000000001","startMs":2000,"endMs":3200,"clipInMs":0,"clipOutMs":1200,"effects":[]},{"level":"clip","assetId":"50000000-0000-0000-0000-000000000002","startMs":3200,"endMs":4400,"clipInMs":0,"clipOutMs":1200,"effects":[]},{"level":"clip","assetId":"50000000-0000-0000-0000-000000000003","startMs":4400,"endMs":5600,"clipInMs":0,"clipOutMs":1200,"effects":[]},{"level":"clip","assetId":"50000000-0000-0000-0000-000000000004","startMs":5600,"endMs":6800,"clipInMs":0,"clipOutMs":1200,"effects":[]}],"look":{"grade":{"warmth":0.12,"contrast":1.28,"saturation":1.22,"vignette":0.18},"grain":{"intensity":0.1,"sizePx":2,"seed":1234567,"animationHz":30}},"chrome":{"progressBar":{"thicknessPx":5,"opacity":0.8,"anchor":"top"}},"overlays":[]}$vector$::JSONB),
  ('v3-overlapping-windows-of-one-clip',
   false,
   'pitch scene two windows of the same clip may not overlap',
   $vector${"schemaVersion":3,"template":"hype","canvas":{"width":1080,"height":1920,"fps":30},"durationMs":8000,"assetIds":["40000000-0000-0000-0000-000000000001"],"clipAssetIds":["50000000-0000-0000-0000-000000000001"],"shots":[{"level":"wide","assetId":"40000000-0000-0000-0000-000000000001","startMs":0,"endMs":2000,"crop":{"x":0,"y":0,"width":1,"height":1},"effects":[]},{"level":"clip","assetId":"50000000-0000-0000-0000-000000000001","startMs":2000,"endMs":5000,"clipInMs":0,"clipOutMs":3000,"effects":[]},{"level":"clip","assetId":"50000000-0000-0000-0000-000000000001","startMs":5000,"endMs":8000,"clipInMs":2900,"clipOutMs":5900,"effects":[]}],"look":{"grade":{"warmth":0.12,"contrast":1.28,"saturation":1.22,"vignette":0.18},"grain":{"intensity":0.1,"sizePx":2,"seed":1234567,"animationHz":30}},"chrome":{"progressBar":{"thicknessPx":5,"opacity":0.8,"anchor":"top"}},"overlays":[]}$vector$::JSONB),
  ('v3-kenburns-on-a-clip',
   false,
   'pitch scene clip shot may carry only wordPop effects',
   $vector${"schemaVersion":3,"template":"hype","canvas":{"width":1080,"height":1920,"fps":30},"durationMs":5000,"assetIds":["40000000-0000-0000-0000-000000000001"],"clipAssetIds":["50000000-0000-0000-0000-000000000001"],"shots":[{"level":"wide","assetId":"40000000-0000-0000-0000-000000000001","startMs":0,"endMs":2000,"crop":{"x":0,"y":0,"width":1,"height":1},"effects":[]},{"level":"clip","assetId":"50000000-0000-0000-0000-000000000001","startMs":2000,"endMs":5000,"clipInMs":0,"clipOutMs":3000,"effects":[{"type":"kenBurns","to":{"x":0.02,"y":0.02,"width":0.96,"height":0.96},"easing":"easeInOut"}]}],"look":{"grade":{"warmth":0.12,"contrast":1.28,"saturation":1.22,"vignette":0.18},"grain":{"intensity":0.1,"sizePx":2,"seed":1234567,"animationHz":30}},"chrome":{"progressBar":{"thicknessPx":5,"opacity":0.8,"anchor":"top"}},"overlays":[]}$vector$::JSONB);
-- ── END GOLDEN VECTORS, v3 ───────────────────────────────────────────────

DO $$
DECLARE
  failures TEXT[] := ARRAY[]::TEXT[];
  -- The five published fields, for the vector whose scene prints a card.
  reviewed_structure CONSTANT JSONB := $structure${
    "hook": "Meet my friend Blair",
    "relationship_context": "We have been friends since college.",
    "three_specific_qualities": ["kind", "curious", "cooks constantly"],
    "evidence_or_anecdote": "Blair drove four hours to help me move.",
    "good_match_for": "someone who likes long dinners",
    "hard_claims_requiring_confirmation": []
  }$structure$::JSONB;
  -- Two segments and six word timings: the smallest transcript that bounds every
  -- word reference the vectors make. Only the two array lengths reach the
  -- validator, but writing real times keeps the fixture readable.
  vector_transcript CONSTANT JSONB := $transcript${
    "text": "Blair is kind and curious and always cooking.",
    "language": "en",
    "segments": [
      {"start": 0, "end": 7.3, "text": "Blair is kind"},
      {"start": 7.7, "end": 15, "text": "and curious and always cooking"}
    ],
    "words": [
      {"start": 0, "end": 1.946, "word": "Blair"},
      {"start": 2.433, "end": 4.379, "word": "is"},
      {"start": 4.866, "end": 6.812, "word": "kind"},
      {"start": 7.7, "end": 9.646, "word": "and"},
      {"start": 10.133, "end": 12.079, "word": "curious"},
      {"start": 12.566, "end": 14.512, "word": "cooking"}
    ]
  }$transcript$::JSONB;
  vector RECORD;
  reason TEXT;
  accept_count INTEGER;
  reject_count INTEGER;
BEGIN
  -- A generator that emitted nothing, or only rejections, would leave every
  -- assertion below vacuously true.
  SELECT count(*) FILTER (WHERE expected_reason IS NULL),
         count(*) FILTER (WHERE expected_reason IS NOT NULL)
    INTO accept_count, reject_count
    FROM pitch_scene_golden_vector_v3;
  IF accept_count < 3 OR reject_count < 4 THEN
    RAISE EXCEPTION
      'D26: the v3 golden vector block carries % accept and % reject rows',
      accept_count, reject_count;
  END IF;
  -- Asserted by name because a rename on the contracts side must break this
  -- suite rather than silently drop the coverage it was added for.
  IF NOT EXISTS (
    SELECT 1 FROM pitch_scene_golden_vector_v3
     WHERE name = 'v3-three-clips-at-every-cap' AND expected_reason IS NULL
  ) THEN
    RAISE EXCEPTION 'D26: v3-three-clips-at-every-cap is missing or is not an acceptance';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pitch_scene_golden_vector_v3
     WHERE name = 'v3-clip-total-past-ten-seconds-across-windows'
       AND expected_reason IS NOT NULL
  ) THEN
    RAISE EXCEPTION
      'D26: v3-clip-total-past-ten-seconds-across-windows is missing or is not a rejection';
  END IF;

  FOR vector IN SELECT * FROM pitch_scene_golden_vector_v3 ORDER BY name LOOP
    reason := private.pitch_scene_violation(
      vector.scene,
      (vector.scene ->> 'durationMs')::INTEGER,
      (SELECT array_agg((listed.value #>> '{}')::UUID)
         FROM jsonb_array_elements(vector.scene -> 'assetIds') AS listed(value)),
      vector_transcript,
      CASE WHEN vector.requires_structure THEN reviewed_structure END,
      -- Every clip the vector declares is treated as reviewed, so each rejection
      -- below is about the clip RULE under test and never about readiness.
      (SELECT coalesce(array_agg((listed.value #>> '{}')::UUID), ARRAY[]::UUID[])
         FROM jsonb_array_elements(
                coalesce(vector.scene -> 'clipAssetIds', '[]'::JSONB)
              ) AS listed(value))
    );
    IF reason IS DISTINCT FROM vector.expected_reason THEN
      failures := array_append(
        failures,
        vector.name || ': expected ' || coalesce(vector.expected_reason, 'ACCEPTED')
          || ', got ' || coalesce(reason, 'ACCEPTED')
      );
    END IF;
  END LOOP;

  IF array_length(failures, 1) IS NOT NULL THEN
    RAISE EXCEPTION '26_video_ingest golden vector failures: %',
      array_to_string(failures, ' | ');
  END IF;
END;
$$;


-- ── (K) The flagged-clip dead end is open ───────────────────────────────────
-- 0050's consent gate refuses a draft carrying a flagged clip; before this
-- migration the removal RPC allowed only photos, so the introducer was stuck.
-- A fresh flagged fixture is built here (the review block above already
-- cleared draft C's original), the removal is executed FOR REAL (rejected()
-- rolls accepted statements back, so it cannot carry this probe), and the
-- cascade plus the gate's answer are pinned on both sides of it.
DO $$
DECLARE
  failures TEXT[] := ARRAY[]::TEXT[];
  claimed RECORD;
  reason TEXT;
  leftover INTEGER;
BEGIN
  -- Draft C sits at its free allowance (one clip), so the entitlement trigger
  -- would refuse a second. The owner removes the review-cleared clip first —
  -- which is itself the first proof that video removal works.
  PERFORM set_config(
    'request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true
  );
  PERFORM public.remove_pitch_draft_asset('26000000-0000-0000-0000-0000000003c1');

  INSERT INTO public.pitch_assets (
    id, pitch_draft_id, uploaded_by_user_id, asset_type, storage_path, sort_order
  ) VALUES (
    '26000000-0000-0000-0000-0000000003c9',
    '26000000-0000-0000-0000-000000000003',
    '00000000-0000-0000-0000-000000000001', 'video',
    'pitch-media/26000000-0000-0000-0000-000000000003/clip-9.mp4', 3
  );
  PERFORM pg_temp.queue_head('26000000-0000-0000-0000-0000000003c9');

  SELECT * INTO claimed FROM public.claim_media_ingest_job(600);
  IF claimed.asset_id IS DISTINCT FROM '26000000-0000-0000-0000-0000000003c9' THEN
    RAISE EXCEPTION '26_video_ingest (K) could not claim its flagged fixture';
  END IF;
  PERFORM public.complete_media_ingest_job(
    claimed.job_id, claimed.lease_token, 'flagged',
    duration_ms => 8000, probe_width => 1080, probe_height => 1920,
    reason => 'frame moderation: violence'
  );

  PERFORM set_config(
    'request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true
  );

  -- Before the removal, the gate names the flagged clip.
  reason := pg_temp.rejected($sql$
    SELECT * FROM public.submit_pitch_for_consent(
      '26000000-0000-0000-0000-000000000003', 'email', 'dater@example.test', 'Blair'
    )
  $sql$);
  IF reason IS DISTINCT FROM 'remove the flagged video clip before requesting consent' THEN
    failures := array_append(failures,
      'the fresh flagged clip did not gate consent: ' || coalesce(reason, 'ACCEPTED'));
  END IF;

  -- The owner detaches it. Executed directly so the effect PERSISTS.
  PERFORM public.remove_pitch_draft_asset('26000000-0000-0000-0000-0000000003c9');

  -- Cascade took the ingest row, the review row and the job with it.
  SELECT count(*) INTO leftover FROM public.pitch_video_ingests
   WHERE asset_id = '26000000-0000-0000-0000-0000000003c9';
  IF leftover <> 0 THEN
    failures := array_append(failures, 'the ingest row survived the removal');
  END IF;
  SELECT count(*) INTO leftover FROM public.media_ingest_jobs
   WHERE asset_id = '26000000-0000-0000-0000-0000000003c9';
  IF leftover <> 0 THEN
    failures := array_append(failures, 'the ingest job survived the removal');
  END IF;
  SELECT count(*) INTO leftover FROM public.video_moderation_reviews
   WHERE asset_id = '26000000-0000-0000-0000-0000000003c9';
  IF leftover <> 0 THEN
    failures := array_append(failures, 'the review row survived the removal');
  END IF;

  -- And the gate no longer names it: whatever this minimal fixture still
  -- lacks, the introducer is no longer locked out by a clip they cannot touch.
  reason := pg_temp.rejected($sql$
    SELECT * FROM public.submit_pitch_for_consent(
      '26000000-0000-0000-0000-000000000003', 'email', 'dater@example.test', 'Blair'
    )
  $sql$);
  IF reason IS NOT DISTINCT FROM 'remove the flagged video clip before requesting consent' THEN
    failures := array_append(failures,
      'the consent gate still names a clip that was removed');
  END IF;

  -- The voice recording stays irremovable, with 0046 exact sentence.
  reason := pg_temp.rejected($sql$
    SELECT public.remove_pitch_draft_asset('26000000-0000-0000-0000-0000000001a0')
  $sql$);
  IF reason IS DISTINCT FROM 'the introducer voice recording cannot be removed' THEN
    failures := array_append(failures,
      'the voice recording was removable: ' || coalesce(reason, 'ACCEPTED'));
  END IF;

  -- A consent_pending draft is closed to edits: draft B entered consent in (G).
  reason := pg_temp.rejected($sql$
    SELECT public.remove_pitch_draft_asset('26000000-0000-0000-0000-0000000002b8')
  $sql$);
  IF reason IS DISTINCT FROM 'this pitch can no longer be edited' THEN
    failures := array_append(failures,
      'a consent_pending asset was removable: ' || coalesce(reason, 'ACCEPTED'));
  END IF;

  -- A non-creator gets the indistinguishable refusal.
  PERFORM set_config(
    'request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true
  );
  reason := pg_temp.rejected($sql$
    SELECT public.remove_pitch_draft_asset('26000000-0000-0000-0000-0000000001a1')
  $sql$);
  IF reason IS DISTINCT FROM 'pitch asset not found or not yours to remove' THEN
    failures := array_append(failures,
      'a non-creator removal was not refused alike: ' || coalesce(reason, 'ACCEPTED'));
  END IF;

  IF array_length(failures, 1) IS NOT NULL THEN
    RAISE EXCEPTION '26_video_ingest (K) failures: %', array_to_string(failures, ' | ');
  END IF;
END;
$$;

-- ── (L) The ingest RPCs are service-role only, on a REAL Supabase ACL ────
-- 0050 wrote `REVOKE ALL ... FROM PUBLIC` on the four ingest RPCs, which is not
-- what it looks like: hosted Supabase's default privileges GRANT EXECUTE on every
-- new public function to anon and authenticated EXPLICITLY, and an explicit grant
-- survives a revoke aimed at PUBLIC. Reproduced 2026-07-30 against the local
-- Supabase stack — an anonymous caller could claim another worker's job, report a
-- forged 'succeeded' with no ffmpeg run at all, read the moderation review queue
-- and resolve a human decision. 0051 revokes the two roles by name (0035:430
-- precedent) and this section is what keeps the next migration honest.
--
-- supabase/tests/helpers/auth_stub.sql now installs those default privileges, so
-- the harness grants what production grants; without that line the probes below
-- would pass on a bug that ships.
DO $$
DECLARE
  failures TEXT[] := ARRAY[]::TEXT[];
  -- Every public function whose migration grants EXECUTE to service_role alone.
  -- The four ingest RPCs are why this list exists; the rest were written with the
  -- same `FROM PUBLIC` revoke and were anon-callable for the same reason —
  -- including the RevenueCat webhook sink and the erasure RPC.
  service_only CONSTANT TEXT[] := ARRAY[
    'public.claim_media_ingest_job(integer)',
    'public.complete_media_ingest_job(uuid,uuid,text,text,text,integer,integer,integer,jsonb,boolean,text)',
    'public.list_pending_video_reviews(integer)',
    'public.resolve_video_moderation_review(uuid,text,text)',
    'public.record_revenuecat_event(jsonb)',
    'public.scrub_resolved_purchase_review_payloads(integer)',
    'public.reassign_pitch_storage_owner(uuid,uuid)',
    'public.consume_creator_credit(uuid)',
    'public.erase_pitch_draft(uuid)'
  ];
  signature TEXT;
BEGIN
  FOREACH signature IN ARRAY service_only LOOP
    IF has_function_privilege('anon', signature, 'EXECUTE') THEN
      failures := array_append(failures, 'anon holds EXECUTE on ' || signature);
    END IF;
    IF has_function_privilege('authenticated', signature, 'EXECUTE') THEN
      failures := array_append(failures, 'authenticated holds EXECUTE on ' || signature);
    END IF;
    -- The revoke must not have taken the worker down with it.
    IF NOT has_function_privilege('service_role', signature, 'EXECUTE') THEN
      failures := array_append(failures, 'service_role lost EXECUTE on ' || signature);
    END IF;
  END LOOP;

  -- Granted to authenticated on purpose (0039), never to anon: a credit belongs
  -- to a signed-in creator.
  IF has_function_privilege('anon', 'public.reserve_creator_credit(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.release_creator_credit(uuid)', 'EXECUTE') THEN
    failures := array_append(failures, 'anon holds EXECUTE on a creator credit RPC');
  END IF;
  IF NOT has_function_privilege(
       'authenticated', 'public.reserve_creator_credit(uuid)', 'EXECUTE'
     ) THEN
    failures := array_append(failures, 'authenticated lost EXECUTE on reserve_creator_credit');
  END IF;

  IF array_length(failures, 1) IS NOT NULL THEN
    RAISE EXCEPTION '26_video_ingest (L1) failures: %', array_to_string(failures, ' | ');
  END IF;
END;
$$;

-- The same claim again, made the way the attacker made it: switch to the role and
-- call the function. A catalog assertion can be satisfied by a grant that is
-- shadowed somewhere else; a refused call cannot.
DO $$
DECLARE
  failures TEXT[] := ARRAY[]::TEXT[];
  reason TEXT;
  probes CONSTANT TEXT[] := ARRAY[
    $sql$SELECT * FROM public.claim_media_ingest_job(600)$sql$,
    $sql$SELECT public.complete_media_ingest_job(
           gen_random_uuid(), gen_random_uuid(), 'succeeded',
           proxy_path => 'pitch-media/x/p.mp4', poster_path => 'pitch-media/x/p.jpg',
           duration_ms => 9000, probe_width => 1080, probe_height => 1920,
           face_boxes => '[]'::JSONB, original_deleted => true
         )$sql$,
    $sql$SELECT * FROM public.list_pending_video_reviews(50)$sql$,
    $sql$SELECT public.resolve_video_moderation_review(
           gen_random_uuid(), 'cleared'
         )$sql$
  ];
  probe TEXT;
BEGIN
  SET LOCAL ROLE anon;
  FOREACH probe IN ARRAY probes LOOP
    reason := pg_temp.rejected(probe);
    IF reason IS NULL OR reason NOT LIKE '%permission denied%' THEN
      failures := array_append(failures,
        'anon was not refused by the ACL: ' || coalesce(reason, 'ACCEPTED'));
    END IF;
  END LOOP;
  RESET ROLE;

  PERFORM set_config(
    'request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true
  );
  SET LOCAL ROLE authenticated;
  FOREACH probe IN ARRAY probes LOOP
    reason := pg_temp.rejected(probe);
    IF reason IS NULL OR reason NOT LIKE '%permission denied%' THEN
      failures := array_append(failures,
        'a signed-in session was not refused by the ACL: ' || coalesce(reason, 'ACCEPTED'));
    END IF;
  END LOOP;
  RESET ROLE;

  IF array_length(failures, 1) IS NOT NULL THEN
    RAISE EXCEPTION '26_video_ingest (L2) failures: %', array_to_string(failures, ' | ');
  END IF;
END;
$$;

-- ── (M) A clip's bytes live under its own draft's prefix ────────────────
-- pitch_assets.storage_path was free text, so a creator could register a row on
-- THEIR draft naming SOMEONE ELSE'S prefix. The ingest worker trusts that path:
-- it downloads it, writes the derivatives under the attacker's prefix and — on
-- success — deletes the original. That is a private clip stolen and destroyed
-- through an ordinary insert, reproduced 2026-07-30. 0051 makes the path prove it
-- belongs to the draft that owns the row.
INSERT INTO public.pitch_drafts (id, created_by_user_id, status, headline, body)
VALUES (
  '26000000-0000-0000-0000-000000000004',
  '00000000-0000-0000-0000-000000000001',
  'draft',
  'Storage prefix draft',
  'Video ingest prefix fixture body.'
);

DO $$
DECLARE
  failures TEXT[] := ARRAY[]::TEXT[];
  reason TEXT;
  own CONSTANT TEXT := '26000000-0000-0000-0000-000000000004';
  victim CONSTANT TEXT := '26000000-0000-0000-0000-000000000001';
BEGIN
  -- The exploit itself: draft D's row, draft A's clip.
  reason := pg_temp.rejected(format($sql$
    INSERT INTO public.pitch_assets (
      pitch_draft_id, uploaded_by_user_id, asset_type, storage_path
    ) VALUES (%L, '00000000-0000-0000-0000-000000000001', 'video', %L)
  $sql$, own, 'pitch-media/' || victim || '/clip-1.mp4'));
  IF reason IS NULL OR reason NOT LIKE '%pitch_assets_storage_path_is_own_draft%' THEN
    failures := array_append(failures,
      'a clip pointing at another draft was registered: ' || coalesce(reason, 'ACCEPTED'));
  END IF;

  -- The same theft written as a traversal inside an allowed prefix. Supabase
  -- object keys are literal, but the path also reaches ffmpeg and a filesystem.
  reason := pg_temp.rejected(format($sql$
    INSERT INTO public.pitch_assets (
      pitch_draft_id, uploaded_by_user_id, asset_type, storage_path
    ) VALUES (%L, '00000000-0000-0000-0000-000000000001', 'video', %L)
  $sql$, own, 'pitch-media/' || own || '/../' || victim || '/clip-1.mp4'));
  IF reason IS NULL OR reason NOT LIKE '%pitch_assets_storage_path_is_own_draft%' THEN
    failures := array_append(failures,
      'a traversal path was registered: ' || coalesce(reason, 'ACCEPTED'));
  END IF;

  -- A photo is signed and handed to the consent surface by storage_path, so the
  -- same row can be a read of someone else's private photo.
  reason := pg_temp.rejected(format($sql$
    INSERT INTO public.pitch_assets (
      pitch_draft_id, uploaded_by_user_id, asset_type, storage_path
    ) VALUES (%L, '00000000-0000-0000-0000-000000000001', 'photo', %L)
  $sql$, own, 'pitch-media/' || victim || '/photo-1.jpg'));
  IF reason IS NULL OR reason NOT LIKE '%pitch_assets_storage_path_is_own_draft%' THEN
    failures := array_append(failures,
      'a photo pointing at another draft was registered: ' || coalesce(reason, 'ACCEPTED'));
  END IF;

  -- A clip must additionally carry the bucket prefix: the worker refuses a path
  -- it cannot split into bucket and object, so a bare path is a job that can only
  -- fail three times.
  reason := pg_temp.rejected(format($sql$
    INSERT INTO public.pitch_assets (
      pitch_draft_id, uploaded_by_user_id, asset_type, storage_path
    ) VALUES (%L, '00000000-0000-0000-0000-000000000001', 'video', %L)
  $sql$, own, own || '/clip-1.mp4'));
  IF reason IS NULL OR reason NOT LIKE '%pitch_assets_storage_path_is_own_draft%' THEN
    failures := array_append(failures,
      'a bucket-less clip path was registered: ' || coalesce(reason, 'ACCEPTED'));
  END IF;

  -- ...while a bucket-less path is still accepted for the older asset types. The
  -- form predates buildPitchMediaPath and 05, 12, 13 and 22 are written in it;
  -- what matters for those rows is that the draft prefix is their OWN.
  reason := pg_temp.rejected(format($sql$
    INSERT INTO public.pitch_assets (
      pitch_draft_id, uploaded_by_user_id, asset_type, storage_path
    ) VALUES (%L, '00000000-0000-0000-0000-000000000001', 'photo', %L)
  $sql$, own, own || '/legacy-photo.jpg'));
  IF reason IS NOT NULL THEN
    failures := array_append(failures,
      'the legacy bucket-less photo path was refused: ' || reason);
  END IF;

  -- Positive control: the canonical path buildPitchMediaPath produces.
  reason := pg_temp.rejected(format($sql$
    INSERT INTO public.pitch_assets (
      pitch_draft_id, uploaded_by_user_id, asset_type, storage_path
    ) VALUES (%L, '00000000-0000-0000-0000-000000000001', 'video', %L)
  $sql$, own, 'pitch-media/' || own || '/clip-1.mp4'));
  IF reason IS NOT NULL THEN
    failures := array_append(failures, 'the canonical clip path was refused: ' || reason);
  END IF;

  IF array_length(failures, 1) IS NOT NULL THEN
    RAISE EXCEPTION '26_video_ingest (M) failures: %', array_to_string(failures, ' | ');
  END IF;
END;
$$;

-- ── (N) A deleted review still leaves the flag on the ops surface ───────
-- video_moderation_reviews cascades with its asset, so an introducer who removes
-- a flagged clip (which (K) proves they can, and should be able to) also removes
-- the only record that the clip was ever flagged. Repeat violations by the same
-- account would be invisible. 0051 writes the row's identifiers to ops_alerts as
-- it disappears; (K) above performed exactly that removal.
DO $$
DECLARE
  failures TEXT[] := ARRAY[]::TEXT[];
  alert public.ops_alerts;
BEGIN
  SELECT * INTO alert
    FROM public.ops_alerts
   WHERE alert_type = 'video_moderation_review_deleted'
     AND detail ->> 'pitch_asset_id' = '26000000-0000-0000-0000-0000000003c9';
  IF alert.id IS NULL THEN
    failures := array_append(failures,
      'removing a flagged clip left no trace of its review on ops_alerts');
  ELSE
    IF alert.detail ->> 'pitch_draft_id'
       IS DISTINCT FROM '26000000-0000-0000-0000-000000000003' THEN
      failures := array_append(failures, 'the deletion trace names no draft');
    END IF;
    -- The account is the point: a flag with no person behind it cannot be a
    -- second strike.
    IF alert.detail ->> 'uploaded_by_user_id'
       IS DISTINCT FROM '00000000-0000-0000-0000-000000000001' THEN
      failures := array_append(failures,
        'the deletion trace names no uploader: '
        || coalesce(alert.detail ->> 'uploaded_by_user_id', 'NULL'));
    END IF;
    IF alert.detail ->> 'flagged_reason' IS DISTINCT FROM 'frame moderation: violence' THEN
      failures := array_append(failures, 'the deletion trace lost the moderation reason');
    END IF;
    IF alert.detail ->> 'disposition' IS NULL THEN
      failures := array_append(failures, 'the deletion trace lost the disposition');
    END IF;
  END IF;

  IF array_length(failures, 1) IS NOT NULL THEN
    RAISE EXCEPTION '26_video_ingest (N) failures: %', array_to_string(failures, ' | ');
  END IF;
END;
$$;

-- ...and the trace stops at erasure. erase_pitch_draft (0018) reaches this same
-- cascade, and a moderation note naming the account and the object it uploaded is
-- exactly what an erasure request removes. Draft D is flagged and then erased.
INSERT INTO public.pitch_assets (
  id, pitch_draft_id, uploaded_by_user_id, asset_type, storage_path, sort_order
) VALUES (
  '26000000-0000-0000-0000-0000000004d1',
  '26000000-0000-0000-0000-000000000004',
  '00000000-0000-0000-0000-000000000001', 'video',
  'pitch-media/26000000-0000-0000-0000-000000000004/clip-1.mp4', 0
);

DO $$
DECLARE
  failures TEXT[] := ARRAY[]::TEXT[];
  claimed RECORD;
  leftover INTEGER;
BEGIN
  PERFORM pg_temp.queue_head('26000000-0000-0000-0000-0000000004d1');
  SELECT * INTO claimed FROM public.claim_media_ingest_job(600);
  IF claimed.asset_id IS DISTINCT FROM '26000000-0000-0000-0000-0000000004d1' THEN
    RAISE EXCEPTION '26_video_ingest (N2) could not claim its erasure fixture';
  END IF;
  PERFORM public.complete_media_ingest_job(
    claimed.job_id, claimed.lease_token, 'flagged',
    duration_ms => 7000, probe_width => 1080, probe_height => 1920,
    reason => 'frame moderation: nudity'
  );
  IF NOT EXISTS (
    SELECT 1 FROM public.video_moderation_reviews
     WHERE asset_id = '26000000-0000-0000-0000-0000000004d1'
       AND uploaded_by_user_id = '00000000-0000-0000-0000-000000000001'
  ) THEN
    failures := array_append(failures,
      'the review row did not record who uploaded the flagged clip');
  END IF;

  PERFORM public.erase_pitch_draft('26000000-0000-0000-0000-000000000004');

  SELECT count(*) INTO leftover FROM public.video_moderation_reviews
   WHERE asset_id = '26000000-0000-0000-0000-0000000004d1';
  IF leftover <> 0 THEN
    failures := array_append(failures, 'erasure left the review row behind');
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.ops_alerts
     WHERE alert_type = 'video_moderation_review_deleted'
       AND detail ->> 'pitch_asset_id' = '26000000-0000-0000-0000-0000000004d1'
  ) THEN
    failures := array_append(failures,
      'erasure copied the uploader and the evidence path into ops_alerts');
  END IF;

  IF array_length(failures, 1) IS NOT NULL THEN
    RAISE EXCEPTION '26_video_ingest (N2) failures: %', array_to_string(failures, ' | ');
  END IF;
END;
$$;

ROLLBACK;

SELECT '26_video_ingest.sql passed' AS result;
