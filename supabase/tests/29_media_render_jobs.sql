-- Migration 0054 regressions: the MP4 render lease queue and the free-render
-- ledger.
--
--   A. Enqueue is lazy and member-gated: request_pitch_render is the only
--      writer, idempotent per approved revision, refused for strangers, anon
--      and closed campaigns.
--   B. The render tables are invisible to client roles — proven by EXECUTING
--      the denied statements under the hosted-default ACL the auth stub
--      installs, not by assuming.
--   C. Claim honors campaign state (paused waits, expired terminalizes) and
--      the concurrency cap; the lease is a token+deadline under the 0050
--      transition discipline.
--   D. The free render is consumed exactly once, AT SUCCESS: repeat requests
--      of a rendered revision consume nothing, a second unlock row is
--      structurally impossible, and a terminal failure leaves the free render
--      unspent and re-requestable.
--   E. Re-renders of a NEW revision after consumption require the Campaign
--      Pass; a done job is final; campaign-row deletion cascades the queue
--      and the ledger. Advisor corrections C1/C2 are pinned here too: the
--      reset of a failed job is capped per account per hour (E3b), and
--      complete takes the campaign lock before the job lock (E5b).
--
-- red-first: before 0054 this file fails at the first request block (the RPC
-- does not exist); each DO block doubles as a mutation probe for one guard.
BEGIN;

-- ═══ Fixtures ══════════════════════════════════════════════════════════
INSERT INTO auth.users (id, email)
VALUES
  ('ee290000-0000-0000-0000-000000000001', 'r29-introducer@example.test'),
  ('ee290000-0000-0000-0000-000000000002', 'r29-dater-a@example.test'),
  ('ee290000-0000-0000-0000-000000000003', 'r29-dater-b@example.test'),
  ('ee290000-0000-0000-0000-000000000004', 'r29-stranger@example.test');

INSERT INTO users (id, account_status, phone_verified_at)
SELECT id, 'active', now() - INTERVAL '10 days'
  FROM auth.users
 WHERE id::TEXT LIKE 'ee290000-%';

INSERT INTO profiles (user_id, display_name, birth_date, verification_status)
VALUES
  ('ee290000-0000-0000-0000-000000000001', 'R29 Introducer', '1990-01-01', 'verified'),
  ('ee290000-0000-0000-0000-000000000002', 'R29 Dater A', '1992-02-02', 'verified'),
  ('ee290000-0000-0000-0000-000000000003', 'R29 Dater B', '1993-03-03', 'verified'),
  ('ee290000-0000-0000-0000-000000000004', 'R29 Stranger', '1994-04-04', 'verified');

INSERT INTO pitch_drafts (id, created_by_user_id, subject_user_id, status, headline, body)
VALUES
  ('ee291000-0000-0000-0000-000000000001',
   'ee290000-0000-0000-0000-000000000001', 'ee290000-0000-0000-0000-000000000002',
   'published', 'R29 draft A', 'Render queue main probe.'),
  ('ee291000-0000-0000-0000-000000000002',
   'ee290000-0000-0000-0000-000000000001', 'ee290000-0000-0000-0000-000000000003',
   'published', 'R29 draft B', 'Failure and expiry probe.');

-- Approved revisions carrying a motion scene (the render input). Directly
-- inserted as the migration owner: shape validation of scenes is owned by the
-- consent RPCs (0048/0049), not by the render path under test here.
INSERT INTO consent_revisions (
  id, pitch_draft_id, revision_number, headline, body, asset_ids, content_hash,
  scene_definition, scene_hash
)
VALUES
  ('ee292000-0000-0000-0000-000000000001', 'ee291000-0000-0000-0000-000000000001',
   1, 'R29 draft A', 'Render queue main probe.', '{}', 'r29-content-a1',
   '{"schemaVersion": 2}', 'r29-scene-a1'),
  ('ee292000-0000-0000-0000-000000000002', 'ee291000-0000-0000-0000-000000000001',
   2, 'R29 draft A', 'Render queue main probe (edited).', '{}', 'r29-content-a2',
   '{"schemaVersion": 2}', 'r29-scene-a2'),
  ('ee292000-0000-0000-0000-000000000003', 'ee291000-0000-0000-0000-000000000002',
   1, 'R29 draft B', 'Failure and expiry probe.', '{}', 'r29-content-b1',
   '{"schemaVersion": 2}', 'r29-scene-b1');

INSERT INTO consent_requests (
  id, pitch_draft_id, subject_user_id, token_hash, status, responded_at, revision_id
)
VALUES
  ('ee293000-0000-0000-0000-000000000001', 'ee291000-0000-0000-0000-000000000001',
   'ee290000-0000-0000-0000-000000000002', 'r29-consent-a', 'approved',
   now() - INTERVAL '1 day', 'ee292000-0000-0000-0000-000000000001'),
  ('ee293000-0000-0000-0000-000000000002', 'ee291000-0000-0000-0000-000000000002',
   'ee290000-0000-0000-0000-000000000003', 'r29-consent-b', 'approved',
   now() - INTERVAL '1 day', 'ee292000-0000-0000-0000-000000000003');

INSERT INTO campaigns (id, pitch_draft_id, owner_user_id, status, published_at, slug, ends_at)
VALUES
  ('ee294000-0000-0000-0000-000000000001', 'ee291000-0000-0000-0000-000000000001',
   'ee290000-0000-0000-0000-000000000002', 'published', now(), 'r29-a',
   now() + INTERVAL '30 days'),
  ('ee294000-0000-0000-0000-000000000002', 'ee291000-0000-0000-0000-000000000002',
   'ee290000-0000-0000-0000-000000000003', 'published', now(), 'r29-b',
   now() + INTERVAL '30 days');

INSERT INTO campaign_memberships (campaign_id, user_id, role)
VALUES
  ('ee294000-0000-0000-0000-000000000001', 'ee290000-0000-0000-0000-000000000002', 'DATER_OWNER'),
  ('ee294000-0000-0000-0000-000000000001', 'ee290000-0000-0000-0000-000000000001', 'INTRODUCER'),
  ('ee294000-0000-0000-0000-000000000002', 'ee290000-0000-0000-0000-000000000003', 'DATER_OWNER'),
  ('ee294000-0000-0000-0000-000000000002', 'ee290000-0000-0000-0000-000000000001', 'INTRODUCER');

-- ═══ A. Lazy, idempotent, member-gated enqueue ═════════════════════════
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'ee290000-0000-0000-0000-000000000002', true);

-- (A1) The dater requests the first export: one queued job, keyed on the
-- approved revision. A repeat request returns the SAME job and writes nothing.
DO $$
DECLARE
  first_job UUID;
  first_status TEXT;
  first_cached BOOLEAN;
  second_job UUID;
  second_cached BOOLEAN;
BEGIN
  SELECT job_id, job_status, already_requested
    INTO first_job, first_status, first_cached
    FROM public.request_pitch_render('ee294000-0000-0000-0000-000000000001');
  IF first_job IS NULL OR first_status <> 'queued' OR first_cached THEN
    RAISE EXCEPTION 'R29-ENQ: first request did not create a queued job (%, %, %)',
      first_job, first_status, first_cached;
  END IF;
  SELECT job_id, already_requested INTO second_job, second_cached
    FROM public.request_pitch_render('ee294000-0000-0000-0000-000000000001');
  IF second_job IS DISTINCT FROM first_job OR NOT second_cached THEN
    RAISE EXCEPTION 'R29-ENQ: repeat request was not idempotent (% vs %, cached %)',
      first_job, second_job, second_cached;
  END IF;
END;
$$;

-- (A2) The introducer (campaign member) may request too — same cached job.
SELECT set_config('request.jwt.claim.sub', 'ee290000-0000-0000-0000-000000000001', true);
DO $$
DECLARE
  cached BOOLEAN;
  total INTEGER;
BEGIN
  SELECT already_requested INTO cached
    FROM public.request_pitch_render('ee294000-0000-0000-0000-000000000001');
  IF NOT cached THEN
    RAISE EXCEPTION 'R29-ENQ: the introducer''s request minted a second job';
  END IF;
  SELECT count(*) INTO total FROM public.get_pitch_render_state(
    'ee294000-0000-0000-0000-000000000001'
  );
  IF total <> 1 THEN
    RAISE EXCEPTION 'R29-ENQ: get_pitch_render_state returned % rows', total;
  END IF;
END;
$$;

-- (A3) A stranger is refused on both RPCs.
SELECT set_config('request.jwt.claim.sub', 'ee290000-0000-0000-0000-000000000004', true);
DO $$
DECLARE
  message TEXT;
BEGIN
  BEGIN
    PERFORM public.request_pitch_render('ee294000-0000-0000-0000-000000000001');
    RAISE EXCEPTION 'R29-ENQ: a stranger enqueued a render';
  EXCEPTION WHEN OTHERS THEN
    message := SQLERRM;
  END;
  IF message <> 'campaign not found or not yours to render' THEN
    RAISE EXCEPTION 'R29-ENQ: stranger refused with the wrong message: %', message;
  END IF;
  BEGIN
    PERFORM public.get_pitch_render_state('ee294000-0000-0000-0000-000000000001');
    RAISE EXCEPTION 'R29-ENQ: a stranger read the render state';
  EXCEPTION WHEN OTHERS THEN
    message := SQLERRM;
  END;
  IF message <> 'campaign not found or not yours to render' THEN
    RAISE EXCEPTION 'R29-ENQ: stranger state read refused with the wrong message: %', message;
  END IF;
END;
$$;
RESET ROLE;

-- (A4) A paused campaign refuses new requests (B4 at the request edge).
UPDATE campaigns SET status = 'paused'
 WHERE id = 'ee294000-0000-0000-0000-000000000002';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'ee290000-0000-0000-0000-000000000003', true);
DO $$
DECLARE
  message TEXT;
BEGIN
  BEGIN
    PERFORM public.request_pitch_render('ee294000-0000-0000-0000-000000000002');
    RAISE EXCEPTION 'R29-ENQ: a paused campaign accepted a render request';
  EXCEPTION WHEN OTHERS THEN
    message := SQLERRM;
  END;
  IF message <> 'campaign must be open to render its pitch video' THEN
    RAISE EXCEPTION 'R29-ENQ: paused campaign refused with the wrong message: %', message;
  END IF;
END;
$$;
RESET ROLE;
UPDATE campaigns SET status = 'published'
 WHERE id = 'ee294000-0000-0000-0000-000000000002';

-- ═══ B. Client roles hold NOTHING on the render tables/RPCs ════════════
-- Executed refusals under the hosted-default ACL, per the 0052 lesson.
SET LOCAL ROLE anon;
DO $$
DECLARE
  refused INTEGER := 0;
BEGIN
  BEGIN
    PERFORM count(*) FROM media_render_jobs;
  EXCEPTION WHEN insufficient_privilege THEN
    refused := refused + 1;
  END;
  BEGIN
    INSERT INTO media_render_jobs (revision_id, campaign_id, pitch_draft_id, scene_hash)
    VALUES ('ee292000-0000-0000-0000-000000000003',
            'ee294000-0000-0000-0000-000000000002',
            'ee291000-0000-0000-0000-000000000002', 'forged');
  EXCEPTION WHEN insufficient_privilege THEN
    refused := refused + 1;
  END;
  BEGIN
    PERFORM count(*) FROM pitch_render_unlocks;
  EXCEPTION WHEN insufficient_privilege THEN
    refused := refused + 1;
  END;
  BEGIN
    INSERT INTO pitch_render_unlocks (campaign_id, render_job_id)
    SELECT 'ee294000-0000-0000-0000-000000000002', id FROM media_render_jobs LIMIT 1;
  EXCEPTION WHEN insufficient_privilege THEN
    refused := refused + 1;
  END;
  BEGIN
    PERFORM public.request_pitch_render('ee294000-0000-0000-0000-000000000001');
  EXCEPTION WHEN insufficient_privilege THEN
    refused := refused + 1;
  END;
  BEGIN
    PERFORM public.claim_media_render_job();
  EXCEPTION WHEN insufficient_privilege THEN
    refused := refused + 1;
  END;
  IF refused <> 6 THEN
    RAISE EXCEPTION 'R29-ACL: anon was refused only % of 6 render surfaces', refused;
  END IF;
END;
$$;
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'ee290000-0000-0000-0000-000000000002', true);
DO $$
DECLARE
  refused INTEGER := 0;
BEGIN
  BEGIN
    PERFORM count(*) FROM media_render_jobs;
  EXCEPTION WHEN insufficient_privilege THEN
    refused := refused + 1;
  END;
  BEGIN
    UPDATE media_render_jobs SET last_error = 'forged';
  EXCEPTION WHEN insufficient_privilege THEN
    refused := refused + 1;
  END;
  BEGIN
    PERFORM count(*) FROM pitch_render_unlocks;
  EXCEPTION WHEN insufficient_privilege THEN
    refused := refused + 1;
  END;
  BEGIN
    PERFORM public.claim_media_render_job();
  EXCEPTION WHEN insufficient_privilege THEN
    refused := refused + 1;
  END;
  BEGIN
    PERFORM public.complete_media_render_job(
      gen_random_uuid(), gen_random_uuid(), 'succeeded'
    );
  EXCEPTION WHEN insufficient_privilege THEN
    refused := refused + 1;
  END;
  IF refused <> 5 THEN
    RAISE EXCEPTION 'R29-ACL: authenticated was refused only % of 5 render surfaces', refused;
  END IF;
END;
$$;
RESET ROLE;

-- ═══ C. Claim: campaign state, cap, lease discipline ═══════════════════
-- (C1) A paused campaign's queued job WAITS (not claimable, not terminal).
UPDATE campaigns SET status = 'paused'
 WHERE id = 'ee294000-0000-0000-0000-000000000001';
DO $$
DECLARE
  claimed_id UUID;
  job_state TEXT;
BEGIN
  SELECT job_id INTO claimed_id FROM public.claim_media_render_job();
  IF claimed_id IS NOT NULL THEN
    RAISE EXCEPTION 'R29-CLAIM: a paused campaign''s job was claimed';
  END IF;
  SELECT status INTO job_state FROM media_render_jobs
   WHERE revision_id = 'ee292000-0000-0000-0000-000000000001';
  IF job_state <> 'queued' THEN
    RAISE EXCEPTION 'R29-CLAIM: pausing terminalized the job (status %)', job_state;
  END IF;
END;
$$;
UPDATE campaigns SET status = 'published'
 WHERE id = 'ee294000-0000-0000-0000-000000000001';

-- (C2) A zero cap claims nothing even with a claimable job queued.
UPDATE app_config SET value = '0' WHERE key = 'media_render_concurrency_cap';
DO $$
DECLARE
  claimed_id UUID;
BEGIN
  SELECT job_id INTO claimed_id FROM public.claim_media_render_job();
  IF claimed_id IS NOT NULL THEN
    RAISE EXCEPTION 'R29-CLAIM: the concurrency cap of 0 was ignored';
  END IF;
END;
$$;
UPDATE app_config SET value = '2' WHERE key = 'media_render_concurrency_cap';

-- (C3) Claim leases the job: token + deadline + attempts 1; a live lease
-- cannot be re-issued; a wrong token cannot complete.
DO $$
DECLARE
  claimed RECORD;
BEGIN
  SELECT * INTO claimed FROM public.claim_media_render_job();
  IF claimed.job_id IS NULL
     OR claimed.lease_token IS NULL
     OR claimed.attempts <> 1
     OR claimed.lease_expires_at <= now()
     OR claimed.revision_id <> 'ee292000-0000-0000-0000-000000000001'
     OR claimed.scene_hash <> 'r29-scene-a1' THEN
    RAISE EXCEPTION 'R29-CLAIM: claim returned an incomplete lease (%)', claimed;
  END IF;

  BEGIN
    UPDATE media_render_jobs
       SET lease_token = gen_random_uuid()
     WHERE id = claimed.job_id;
    RAISE EXCEPTION 'R29-CLAIM: a live lease was re-issued';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'media render job lease is still held' THEN
      RAISE EXCEPTION 'R29-CLAIM: live-lease overwrite refused with the wrong message: %',
        SQLERRM;
    END IF;
  END;

  BEGIN
    PERFORM public.complete_media_render_job(
      claimed.job_id, gen_random_uuid(), 'succeeded',
      'pitch-media/ee291000-0000-0000-0000-000000000001/renders/a1.mp4',
      35000000, 30000
    );
    RAISE EXCEPTION 'R29-CLAIM: a wrong token completed the job';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'media render lease is not held' THEN
      RAISE EXCEPTION 'R29-CLAIM: wrong-token completion refused with the wrong message: %',
        SQLERRM;
    END IF;
  END;

  -- Park the token for the next block.
  PERFORM set_config('r29.lease_token', claimed.lease_token::TEXT, true);
  PERFORM set_config('r29.job_id', claimed.job_id::TEXT, true);
END;
$$;

-- ═══ D. Success consumes the free render — exactly once ════════════════
-- (D1) A result outside the draft's renders/ prefix is refused by the CHECK.
DO $$
DECLARE
  refused BOOLEAN := false;
BEGIN
  BEGIN
    PERFORM public.complete_media_render_job(
      current_setting('r29.job_id')::UUID,
      current_setting('r29.lease_token')::UUID,
      'succeeded',
      'pitch-media/ee291000-0000-0000-0000-000000000002/renders/stolen.mp4',
      35000000, 30000
    );
  EXCEPTION WHEN check_violation THEN
    refused := true;
  END;
  IF NOT refused THEN
    RAISE EXCEPTION 'R29-DONE: an output under another draft''s prefix was accepted';
  END IF;
END;
$$;

-- (D2) Success stores the output and writes exactly one unlock row.
DO $$
DECLARE
  job_state TEXT;
  stored_path TEXT;
  unlock_count INTEGER;
BEGIN
  PERFORM public.complete_media_render_job(
    current_setting('r29.job_id')::UUID,
    current_setting('r29.lease_token')::UUID,
    'succeeded',
    'pitch-media/ee291000-0000-0000-0000-000000000001/renders/ee292000-0000-0000-0000-000000000001.mp4',
    35000000, 30000
  );
  SELECT status, output_storage_path INTO job_state, stored_path
    FROM media_render_jobs
   WHERE id = current_setting('r29.job_id')::UUID;
  IF job_state <> 'done' OR stored_path IS NULL THEN
    RAISE EXCEPTION 'R29-DONE: success did not store a done result (%, %)',
      job_state, stored_path;
  END IF;
  SELECT count(*) INTO unlock_count FROM pitch_render_unlocks
   WHERE campaign_id = 'ee294000-0000-0000-0000-000000000001';
  IF unlock_count <> 1 THEN
    RAISE EXCEPTION 'R29-DONE: success consumed % unlocks instead of 1', unlock_count;
  END IF;
END;
$$;

-- (D3) The free-once invariant is a CONSTRAINT: a second unlock row for the
-- same campaign is structurally impossible, even for the service role.
DO $$
DECLARE
  refused BOOLEAN := false;
BEGIN
  BEGIN
    INSERT INTO pitch_render_unlocks (campaign_id, render_job_id)
    VALUES ('ee294000-0000-0000-0000-000000000001',
            current_setting('r29.job_id')::UUID);
  EXCEPTION WHEN unique_violation THEN
    refused := true;
  END;
  IF NOT refused THEN
    RAISE EXCEPTION 'R29-FREE: a second unlock row was stored for one campaign';
  END IF;
END;
$$;

-- (D4) Re-requesting the rendered revision returns the cached done job and
-- consumes nothing (repeat request => 0 additional consumption).
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'ee290000-0000-0000-0000-000000000002', true);
DO $$
DECLARE
  returned RECORD;
  unlock_count INTEGER;
  job_count INTEGER;
BEGIN
  SELECT * INTO returned
    FROM public.request_pitch_render('ee294000-0000-0000-0000-000000000001');
  IF returned.job_status <> 'done'
     OR NOT returned.already_requested
     OR returned.output_storage_path IS NULL THEN
    RAISE EXCEPTION 'R29-FREE: re-request did not return the cached render (%)', returned;
  END IF;
  RESET ROLE;
  SELECT count(*) INTO unlock_count FROM pitch_render_unlocks
   WHERE campaign_id = 'ee294000-0000-0000-0000-000000000001';
  SELECT count(*) INTO job_count FROM media_render_jobs
   WHERE campaign_id = 'ee294000-0000-0000-0000-000000000001';
  IF unlock_count <> 1 OR job_count <> 1 THEN
    RAISE EXCEPTION 'R29-FREE: re-request consumed again (unlocks %, jobs %)',
      unlock_count, job_count;
  END IF;
END;
$$;
RESET ROLE;

-- (D5) A done job is final: no transition, not even back to queued.
DO $$
DECLARE
  refused BOOLEAN := false;
BEGIN
  BEGIN
    UPDATE media_render_jobs
       SET status = 'queued', attempts = 0
     WHERE id = current_setting('r29.job_id')::UUID;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'a completed render job is final' THEN
      refused := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT refused THEN
    RAISE EXCEPTION 'R29-DONE: a completed render job was re-queued';
  END IF;
END;
$$;

-- ═══ E. Premium re-render, terminal failure, cascade ═══════════════════
-- (E1) The dater edits: a NEW approved revision. With the free render spent
-- and no pass, the request is refused; with an active pass it enqueues.
UPDATE consent_requests
   SET revision_id = 'ee292000-0000-0000-0000-000000000002'
 WHERE id = 'ee293000-0000-0000-0000-000000000001';

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'ee290000-0000-0000-0000-000000000002', true);
DO $$
DECLARE
  message TEXT;
BEGIN
  BEGIN
    PERFORM public.request_pitch_render('ee294000-0000-0000-0000-000000000001');
    RAISE EXCEPTION 'R29-PASS: a second revision rendered free after consumption';
  EXCEPTION WHEN OTHERS THEN
    message := SQLERRM;
  END;
  IF message <> 'campaign pass required' THEN
    RAISE EXCEPTION 'R29-PASS: pass gate refused with the wrong message: %', message;
  END IF;
END;
$$;
RESET ROLE;

INSERT INTO campaign_entitlements (campaign_id, product_id, active, expires_at)
VALUES ('ee294000-0000-0000-0000-000000000001', 'campaign_pass_30d_1999', true,
        now() + INTERVAL '30 days');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'ee290000-0000-0000-0000-000000000002', true);
DO $$
DECLARE
  returned RECORD;
BEGIN
  SELECT * INTO returned
    FROM public.request_pitch_render('ee294000-0000-0000-0000-000000000001');
  IF returned.job_status <> 'queued'
     OR returned.already_requested
     OR returned.revision_id <> 'ee292000-0000-0000-0000-000000000002' THEN
    RAISE EXCEPTION 'R29-PASS: a pass-holder could not enqueue the re-render (%)', returned;
  END IF;
END;
$$;

-- (E2) Campaign B enqueues its free render...
SELECT set_config('request.jwt.claim.sub', 'ee290000-0000-0000-0000-000000000003', true);
SELECT job_id FROM public.request_pitch_render('ee294000-0000-0000-0000-000000000002');
RESET ROLE;

-- (E2b) C1, the schedule locks alone cannot close: while B's FIRST render is
-- still in flight (job queued/leased, unlock not yet consumed), a NEW
-- approved revision must not open a SECOND free render — free eligibility
-- requires no unlock AND no other live job on the campaign. Without this
-- gate the campaign ends up with two rendered MP4s and one consumed unlock,
-- no interleaving required. C3: the refusal must state the true fact — a
-- render is in progress, nothing was consumed, waiting is free — and MUST
-- NOT claim a pass is required (§12: no message may assert what the code
-- does not).
INSERT INTO consent_revisions (
  id, pitch_draft_id, revision_number, headline, body, asset_ids, content_hash,
  scene_definition, scene_hash
)
VALUES ('ee292000-0000-0000-0000-000000000004', 'ee291000-0000-0000-0000-000000000002',
        2, 'R29 draft B', 'Failure and expiry probe (edited).', '{}', 'r29-content-b2',
        '{"schemaVersion": 2}', 'r29-scene-b2');
UPDATE consent_requests
   SET revision_id = 'ee292000-0000-0000-0000-000000000004'
 WHERE id = 'ee293000-0000-0000-0000-000000000002';

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'ee290000-0000-0000-0000-000000000003', true);
DO $$
DECLARE
  message TEXT;
BEGIN
  BEGIN
    PERFORM public.request_pitch_render('ee294000-0000-0000-0000-000000000002');
    RAISE EXCEPTION 'R29-INFLIGHT: a second free render opened while the first is in flight';
  EXCEPTION WHEN OTHERS THEN
    message := SQLERRM;
  END;
  IF message <> 'a render for this campaign is already in progress' THEN
    RAISE EXCEPTION 'R29-INFLIGHT: in-flight gate refused with the wrong message: %', message;
  END IF;
END;
$$;
RESET ROLE;
DO $$
DECLARE
  b_jobs INTEGER;
BEGIN
  SELECT count(*) INTO b_jobs FROM media_render_jobs
   WHERE campaign_id = 'ee294000-0000-0000-0000-000000000002';
  IF b_jobs <> 1 THEN
    RAISE EXCEPTION 'R29-INFLIGHT: campaign B carries % jobs', b_jobs;
  END IF;
END;
$$;

-- Restore B's approved revision for the failure-path blocks below.
UPDATE consent_requests
   SET revision_id = 'ee292000-0000-0000-0000-000000000003'
 WHERE id = 'ee293000-0000-0000-0000-000000000002';

-- Inside one transaction now() is a constant, so the two queued jobs tie on
-- created_at and the id tie-break is a random UUID. Pin the FIFO order the
-- assertions below rely on.
UPDATE media_render_jobs SET created_at = now() - INTERVAL '2 minutes'
 WHERE revision_id = 'ee292000-0000-0000-0000-000000000002';
UPDATE media_render_jobs SET created_at = now() - INTERVAL '1 minute'
 WHERE revision_id = 'ee292000-0000-0000-0000-000000000003';

-- ...then the A2 job (older) is claimed and succeeds WITHOUT a second
-- consumption (the unlock insert is an ON CONFLICT no-op).
DO $$
DECLARE
  claimed RECORD;
  unlock_count INTEGER;
BEGIN
  SELECT * INTO claimed FROM public.claim_media_render_job();
  IF claimed.revision_id <> 'ee292000-0000-0000-0000-000000000002' THEN
    RAISE EXCEPTION 'R29-ORDER: expected the A2 job first, got %', claimed.revision_id;
  END IF;
  PERFORM public.complete_media_render_job(
    claimed.job_id, claimed.lease_token, 'succeeded',
    'pitch-media/ee291000-0000-0000-0000-000000000001/renders/ee292000-0000-0000-0000-000000000002.mp4',
    36000000, 31000
  );
  SELECT count(*) INTO unlock_count FROM pitch_render_unlocks
   WHERE campaign_id = 'ee294000-0000-0000-0000-000000000001';
  IF unlock_count <> 1 THEN
    RAISE EXCEPTION 'R29-ORDER: the paid re-render changed consumption to %', unlock_count;
  END IF;
END;
$$;

-- (E3) Campaign B's render fails three times: the job terminalizes, an ops
-- alert lands, and — decision 4 — NO free render was consumed.
DO $$
DECLARE
  claimed RECORD;
  round INTEGER;
  job_state TEXT;
  unlock_count INTEGER;
  alert_count INTEGER;
BEGIN
  FOR round IN 1..3 LOOP
    SELECT * INTO claimed FROM public.claim_media_render_job();
    IF claimed.job_id IS NULL
       OR claimed.revision_id <> 'ee292000-0000-0000-0000-000000000003'
       OR claimed.attempts <> round THEN
      RAISE EXCEPTION 'R29-FAIL: round % claimed the wrong job (%)', round, claimed;
    END IF;
    PERFORM public.complete_media_render_job(
      claimed.job_id, claimed.lease_token, 'failed',
      reason => 'renderer crashed (probe round ' || round || ')'
    );
  END LOOP;

  SELECT status INTO job_state FROM media_render_jobs
   WHERE revision_id = 'ee292000-0000-0000-0000-000000000003';
  IF job_state <> 'failed' THEN
    RAISE EXCEPTION 'R29-FAIL: three failures left status %', job_state;
  END IF;
  SELECT count(*) INTO unlock_count FROM pitch_render_unlocks
   WHERE campaign_id = 'ee294000-0000-0000-0000-000000000002';
  IF unlock_count <> 0 THEN
    RAISE EXCEPTION 'R29-FAIL: a terminal failure consumed the free render';
  END IF;
  SELECT count(*) INTO alert_count FROM ops_alerts
   WHERE alert_type = 'pitch_render_failed'
     AND campaign_id = 'ee294000-0000-0000-0000-000000000002';
  IF alert_count < 1 THEN
    RAISE EXCEPTION 'R29-FAIL: no ops alert for the terminal render failure';
  END IF;
END;
$$;

-- (E3-reset-gate) C3 in the failed-reset branch: the reset path CAN reach the
-- in-flight case — approve revision B2 while B1 sits failed, request B2 (free:
-- a failed sibling blocks nothing), then re-approve B1 and ask to reset it
-- while B2 is live. That reset must be refused with the in-progress fact, not
-- with a pass demand: nothing has been consumed yet.
INSERT INTO consent_revisions (
  id, pitch_draft_id, revision_number, headline, body, asset_ids, content_hash,
  scene_definition, scene_hash
)
VALUES ('ee292000-0000-0000-0000-000000000005', 'ee291000-0000-0000-0000-000000000002',
        3, 'R29 draft B', 'Failure and expiry probe (edited again).', '{}', 'r29-content-b3',
        '{"schemaVersion": 2}', 'r29-scene-b3');
UPDATE consent_requests
   SET revision_id = 'ee292000-0000-0000-0000-000000000005'
 WHERE id = 'ee293000-0000-0000-0000-000000000002';

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'ee290000-0000-0000-0000-000000000003', true);
-- B3 enqueues free: the terminally failed B1 job consumed nothing and blocks
-- nothing.
DO $$
DECLARE
  returned RECORD;
BEGIN
  SELECT * INTO returned
    FROM public.request_pitch_render('ee294000-0000-0000-0000-000000000002');
  IF returned.job_status <> 'queued' OR returned.already_requested THEN
    RAISE EXCEPTION 'R29-RESETGATE: a failed sibling blocked a free render (%)', returned;
  END IF;
END;
$$;
RESET ROLE;

-- Re-approve B1 and ask to reset it while B3 is live.
UPDATE consent_requests
   SET revision_id = 'ee292000-0000-0000-0000-000000000003'
 WHERE id = 'ee293000-0000-0000-0000-000000000002';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'ee290000-0000-0000-0000-000000000003', true);
DO $$
DECLARE
  message TEXT;
BEGIN
  BEGIN
    PERFORM public.request_pitch_render('ee294000-0000-0000-0000-000000000002');
    RAISE EXCEPTION 'R29-RESETGATE: a failed job was reset while a sibling render is live';
  EXCEPTION WHEN OTHERS THEN
    message := SQLERRM;
  END;
  IF message <> 'a render for this campaign is already in progress' THEN
    RAISE EXCEPTION 'R29-RESETGATE: reset refused with the wrong message: %', message;
  END IF;
END;
$$;
RESET ROLE;

-- Remove the B3 probe job and restore B1 as the approved revision so the
-- retry-cap and reset blocks below see the original single-job state.
DELETE FROM media_render_jobs
 WHERE revision_id = 'ee292000-0000-0000-0000-000000000005';

-- (E3b) C2: the reset of a terminally failed job is rate-limited per account
-- (0045/0053 advisory-lock hourly cap, app_config-tunable). At a cap of 0 the
-- re-request is refused with the pinned message and the job stays terminal;
-- the cap binds the RESET only — E4 below is the within-cap pass.
UPDATE app_config SET value = '0' WHERE key = 'media_render_retry_hourly_cap';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'ee290000-0000-0000-0000-000000000003', true);
DO $$
DECLARE
  message TEXT;
BEGIN
  BEGIN
    PERFORM public.request_pitch_render('ee294000-0000-0000-0000-000000000002');
    RAISE EXCEPTION 'R29-RETRYCAP: a reset beat a retry cap of 0';
  EXCEPTION WHEN OTHERS THEN
    message := SQLERRM;
  END;
  IF message <> 'render retry rate limit exceeded for this account' THEN
    RAISE EXCEPTION 'R29-RETRYCAP: cap refused with the wrong message: %', message;
  END IF;
END;
$$;
RESET ROLE;
DO $$
DECLARE
  job_state TEXT;
BEGIN
  SELECT status INTO job_state FROM media_render_jobs
   WHERE revision_id = 'ee292000-0000-0000-0000-000000000003';
  IF job_state <> 'failed' THEN
    RAISE EXCEPTION 'R29-RETRYCAP: a capped re-request still re-queued the job (%)', job_state;
  END IF;
END;
$$;
UPDATE app_config SET value = '3' WHERE key = 'media_render_retry_hourly_cap';

-- (E4) The unspent free render is re-requestable: the SAME job re-queues with
-- a fresh budget — no pass needed, no new row.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'ee290000-0000-0000-0000-000000000003', true);
DO $$
DECLARE
  returned RECORD;
BEGIN
  SELECT * INTO returned
    FROM public.request_pitch_render('ee294000-0000-0000-0000-000000000002');
  IF returned.job_status <> 'queued' OR NOT returned.already_requested THEN
    RAISE EXCEPTION 'R29-FAIL: the failed free render could not be re-requested (%)', returned;
  END IF;
  RESET ROLE;
  IF (SELECT count(*) FROM media_render_jobs
       WHERE campaign_id = 'ee294000-0000-0000-0000-000000000002') <> 1 THEN
    RAISE EXCEPTION 'R29-FAIL: the re-request minted a second job';
  END IF;
  IF (SELECT attempts FROM media_render_jobs
       WHERE revision_id = 'ee292000-0000-0000-0000-000000000003') <> 0 THEN
    RAISE EXCEPTION 'R29-FAIL: the re-request kept the spent attempt budget';
  END IF;
END;
$$;
RESET ROLE;

-- (E5) Expiry is one-way: past ends_at, claim terminalizes the queued job and
-- the request edge refuses.
UPDATE campaigns SET ends_at = now() - INTERVAL '1 day'
 WHERE id = 'ee294000-0000-0000-0000-000000000002';
DO $$
DECLARE
  claimed_id UUID;
  job_state TEXT;
BEGIN
  SELECT job_id INTO claimed_id FROM public.claim_media_render_job();
  IF claimed_id IS NOT NULL THEN
    RAISE EXCEPTION 'R29-EXPIRE: an expired campaign''s job was claimed';
  END IF;
  SELECT status INTO job_state FROM media_render_jobs
   WHERE revision_id = 'ee292000-0000-0000-0000-000000000003';
  IF job_state <> 'failed' THEN
    RAISE EXCEPTION 'R29-EXPIRE: the expired campaign''s job was not terminalized (%)',
      job_state;
  END IF;
END;
$$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'ee290000-0000-0000-0000-000000000003', true);
DO $$
DECLARE
  message TEXT;
BEGIN
  BEGIN
    PERFORM public.request_pitch_render('ee294000-0000-0000-0000-000000000002');
    RAISE EXCEPTION 'R29-EXPIRE: an expired campaign accepted a render request';
  EXCEPTION WHEN OTHERS THEN
    message := SQLERRM;
  END;
  IF message <> 'campaign must be open to render its pitch video' THEN
    RAISE EXCEPTION 'R29-EXPIRE: expired campaign refused with the wrong message: %', message;
  END IF;
END;
$$;
RESET ROLE;

-- (E5b) C1 lock-order pin: complete_media_render_job must take the CAMPAIGN
-- lock before the job lock — the same campaign -> job order request_pitch_render
-- uses — or a concurrent request can read "no unlock yet" while a completion
-- is about to commit one, and a free render slips past the pass gate. The
-- behavioral proof needs two sessions (kept as the Advisor-facing probe);
-- this pins the order structurally so a refactor cannot silently drop it.
DO $$
DECLARE
  body TEXT;
  campaign_lock_at INTEGER;
  job_lock_at INTEGER;
BEGIN
  SELECT prosrc INTO body
    FROM pg_proc
   WHERE proname = 'complete_media_render_job';
  campaign_lock_at := position('FROM campaigns' IN body);
  job_lock_at := position('SELECT * INTO job' IN body);
  IF campaign_lock_at = 0 THEN
    RAISE EXCEPTION 'R29-LOCKORDER: complete_media_render_job does not lock the campaign row';
  END IF;
  IF job_lock_at = 0 OR campaign_lock_at > job_lock_at THEN
    RAISE EXCEPTION 'R29-LOCKORDER: the campaign lock must be taken before the job lock';
  END IF;
END;
$$;

-- (E6) get_pitch_render_state projects the ledger facts for a member.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'ee290000-0000-0000-0000-000000000002', true);
DO $$
DECLARE
  state RECORD;
BEGIN
  SELECT * INTO state
    FROM public.get_pitch_render_state('ee294000-0000-0000-0000-000000000001');
  IF state.job_status <> 'done'
     OR NOT state.free_render_used
     OR NOT state.pass_active
     OR state.output_storage_path IS NULL THEN
    RAISE EXCEPTION 'R29-STATE: member state projection is wrong (%)', state;
  END IF;
END;
$$;
RESET ROLE;

-- (E7) Deleting the campaign row (the terminal takedown/erasure shape) takes
-- the queue rows AND the ledger row with it — no orphaned DB state.
DELETE FROM campaigns WHERE id = 'ee294000-0000-0000-0000-000000000001';
DO $$
DECLARE
  job_count INTEGER;
  unlock_count INTEGER;
BEGIN
  SELECT count(*) INTO job_count FROM media_render_jobs
   WHERE campaign_id = 'ee294000-0000-0000-0000-000000000001';
  SELECT count(*) INTO unlock_count FROM pitch_render_unlocks
   WHERE campaign_id = 'ee294000-0000-0000-0000-000000000001';
  IF job_count <> 0 OR unlock_count <> 0 THEN
    RAISE EXCEPTION 'R29-CASCADE: campaign deletion left % job(s), % unlock(s)',
      job_count, unlock_count;
  END IF;
END;
$$;

ROLLBACK;

SELECT '29_media_render_jobs.sql passed' AS result;
