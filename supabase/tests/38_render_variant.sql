-- 38: the MP4 render job knows which video was asked for (0063 — T002 / #98).
--
--   A. The new columns exist with the shape §2.1 specifies: variant defaults to
--      'highlight', options defaults to '{}' and is a closed whitelist, cut_hash
--      is a sha256, effective_variant is the same closed set as variant.
--   B. Deploy safety: the 1-ARGUMENT call the currently deployed web bundle
--      makes still works and produces a highlight job, the 3-argument call
--      records the choice, and — the reason defaults were used instead of an
--      overload — pg_proc holds EXACTLY ONE request_pitch_render.
--   C. A request naming a variant or an option the renderer cannot honour is
--      refused before anything is written.
--   D. get_pitch_render_state answers with the three appended columns, for a
--      real job and for a campaign that has never rendered.
--   E. The free-render rule of 0054 is BYTE-FOR-BYTE unchanged: a done sibling
--      still costs a Campaign Pass, and a repeat request is still idempotent and
--      still does not re-point the job at another variant.
--   F. pitch_assets.asset_role is writable only by the uploader, at INSERT, and
--      only on a video.
--
-- red-first: on 0062 every block fails — (A) at the first ALTER-added column,
-- (B)/(C)/(D) because the arguments and columns do not exist, (F) because
-- asset_role does not exist. (E) is the regression half: it passes before and
-- after, and fails if the replicated 0054 body drifted.

BEGIN;

-- ═══ Fixtures ══════════════════════════════════════════════════════════
INSERT INTO auth.users (id, email)
VALUES
  ('ee380000-0000-0000-0000-000000000001', 'r38-introducer@example.test'),
  ('ee380000-0000-0000-0000-000000000002', 'r38-dater-a@example.test'),
  ('ee380000-0000-0000-0000-000000000003', 'r38-dater-b@example.test'),
  ('ee380000-0000-0000-0000-000000000004', 'r38-stranger@example.test');

INSERT INTO users (id, account_status, phone_verified_at)
SELECT id, 'active', now() - INTERVAL '10 days'
  FROM auth.users
 WHERE id::TEXT LIKE 'ee380000-%';

INSERT INTO profiles (user_id, display_name, birth_date, verification_status)
VALUES
  ('ee380000-0000-0000-0000-000000000001', 'R38 Introducer', '1990-01-01', 'verified'),
  ('ee380000-0000-0000-0000-000000000002', 'R38 Dater A', '1992-02-02', 'verified'),
  ('ee380000-0000-0000-0000-000000000003', 'R38 Dater B', '1993-03-03', 'verified'),
  ('ee380000-0000-0000-0000-000000000004', 'R38 Stranger', '1994-04-04', 'verified');

INSERT INTO pitch_drafts (id, created_by_user_id, subject_user_id, status, headline, body)
VALUES
  ('ee381000-0000-0000-0000-000000000001',
   'ee380000-0000-0000-0000-000000000001', 'ee380000-0000-0000-0000-000000000002',
   'published', 'R38 draft A', 'Variant probe.'),
  ('ee381000-0000-0000-0000-000000000002',
   'ee380000-0000-0000-0000-000000000001', 'ee380000-0000-0000-0000-000000000003',
   'published', 'R38 draft B', 'Free render regression probe.'),
  -- Still open for uploads: the asset_role probes in (F) need a draft whose
  -- creator may still add media.
  ('ee381000-0000-0000-0000-000000000003',
   'ee380000-0000-0000-0000-000000000001', 'ee380000-0000-0000-0000-000000000002',
   'draft', 'R38 draft C', 'Selfie role probe.'),
  -- One draft per probe: the 0050 "one free video clip" limit fires before RLS
  -- and before the CHECKs, so each asset probe needs a draft with no clip yet.
  ('ee381000-0000-0000-0000-000000000004',
   'ee380000-0000-0000-0000-000000000001', 'ee380000-0000-0000-0000-000000000002',
   'draft', 'R38 draft D', 'Stranger upload probe.'),
  ('ee381000-0000-0000-0000-000000000005',
   'ee380000-0000-0000-0000-000000000001', 'ee380000-0000-0000-0000-000000000002',
   'draft', 'R38 draft E', 'asset_role shape probe.');

INSERT INTO consent_revisions (
  id, pitch_draft_id, revision_number, headline, body, asset_ids, content_hash,
  scene_definition, scene_hash
)
VALUES
  ('ee382000-0000-0000-0000-000000000001', 'ee381000-0000-0000-0000-000000000001',
   1, 'R38 draft A', 'Variant probe.', '{}', 'r38-content-a1',
   '{"schemaVersion": 2}', 'r38-scene-a1'),
  ('ee382000-0000-0000-0000-000000000002', 'ee381000-0000-0000-0000-000000000002',
   1, 'R38 draft B', 'Free render regression probe.', '{}', 'r38-content-b1',
   '{"schemaVersion": 2}', 'r38-scene-b1'),
  ('ee382000-0000-0000-0000-000000000003', 'ee381000-0000-0000-0000-000000000002',
   2, 'R38 draft B', 'Free render regression probe (edited).', '{}', 'r38-content-b2',
   '{"schemaVersion": 2}', 'r38-scene-b2');

INSERT INTO consent_requests (
  id, pitch_draft_id, subject_user_id, token_hash, status, responded_at, revision_id
)
VALUES
  ('ee383000-0000-0000-0000-000000000001', 'ee381000-0000-0000-0000-000000000001',
   'ee380000-0000-0000-0000-000000000002', 'r38-consent-a', 'approved',
   now() - INTERVAL '2 days', 'ee382000-0000-0000-0000-000000000001'),
  ('ee383000-0000-0000-0000-000000000002', 'ee381000-0000-0000-0000-000000000002',
   'ee380000-0000-0000-0000-000000000003', 'r38-consent-b', 'approved',
   now() - INTERVAL '2 days', 'ee382000-0000-0000-0000-000000000002');

INSERT INTO campaigns (id, pitch_draft_id, owner_user_id, status, published_at, slug, ends_at)
VALUES
  ('ee384000-0000-0000-0000-000000000001', 'ee381000-0000-0000-0000-000000000001',
   'ee380000-0000-0000-0000-000000000002', 'published', now(), 'r38-a',
   now() + INTERVAL '30 days'),
  ('ee384000-0000-0000-0000-000000000002', 'ee381000-0000-0000-0000-000000000002',
   'ee380000-0000-0000-0000-000000000003', 'published', now(), 'r38-b',
   now() + INTERVAL '30 days');

INSERT INTO campaign_memberships (campaign_id, user_id, role)
VALUES
  ('ee384000-0000-0000-0000-000000000001', 'ee380000-0000-0000-0000-000000000002', 'DATER_OWNER'),
  ('ee384000-0000-0000-0000-000000000001', 'ee380000-0000-0000-0000-000000000001', 'INTRODUCER'),
  ('ee384000-0000-0000-0000-000000000002', 'ee380000-0000-0000-0000-000000000003', 'DATER_OWNER'),
  ('ee384000-0000-0000-0000-000000000002', 'ee380000-0000-0000-0000-000000000001', 'INTRODUCER');

-- ═══ A. The columns are the contract ═══════════════════════════════════
DO $$
DECLARE
  probe UUID;
  stored_variant TEXT;
  stored_options JSONB;
BEGIN
  -- Written as the owner: this block is about the COLUMN rules, which must
  -- hold no matter which writer produced the row.
  INSERT INTO media_render_jobs (
    revision_id, campaign_id, pitch_draft_id, scene_hash
  ) VALUES (
    'ee382000-0000-0000-0000-000000000003', 'ee384000-0000-0000-0000-000000000002',
    'ee381000-0000-0000-0000-000000000002', 'r38-scene-b2'
  ) RETURNING id INTO probe;

  SELECT variant, options INTO stored_variant, stored_options
    FROM media_render_jobs WHERE id = probe;
  IF stored_variant <> 'highlight' THEN
    RAISE EXCEPTION 'D38-A: variant did not default to highlight, got %', stored_variant;
  END IF;
  IF stored_options <> '{}'::jsonb THEN
    RAISE EXCEPTION 'D38-A: options did not default to an empty object, got %', stored_options;
  END IF;

  -- A closed set, both for the request and for what the worker rendered.
  BEGIN
    UPDATE media_render_jobs SET variant = 'teaser' WHERE id = probe;
    RAISE EXCEPTION 'D38-A: an unknown variant was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE media_render_jobs SET effective_variant = 'teaser' WHERE id = probe;
    RAISE EXCEPTION 'D38-A: an unknown effective_variant was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- The option object is a whitelist, by key AND by type.
  BEGIN
    UPDATE media_render_jobs SET options = '{"music": true, "watermark": true}'::jsonb
     WHERE id = probe;
    RAISE EXCEPTION 'D38-A: an unknown option key was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE media_render_jobs SET options = '{"music": "loud"}'::jsonb WHERE id = probe;
    RAISE EXCEPTION 'D38-A: a non-boolean music option was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE media_render_jobs SET options = '[]'::jsonb WHERE id = probe;
    RAISE EXCEPTION 'D38-A: a non-object options value was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  UPDATE media_render_jobs SET options = '{"music": false}'::jsonb WHERE id = probe;

  -- cut_hash is a sha256 of the plan or it is nothing.
  BEGIN
    UPDATE media_render_jobs SET cut_hash = 'not-a-hash' WHERE id = probe;
    RAISE EXCEPTION 'D38-A: a malformed cut_hash was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  UPDATE media_render_jobs
     SET cut_hash = repeat('a', 64),
         cut_plan = '{"version": 1, "windows": [], "totalMs": 0}'::jsonb,
         effective_variant = 'full'
   WHERE id = probe;

  DELETE FROM media_render_jobs WHERE id = probe;
END;
$$;

-- ═══ B. Deploy safety: one function, both call shapes ══════════════════
DO $$
DECLARE
  overloads INTEGER;
  arg_count INTEGER;
BEGIN
  SELECT count(*) INTO overloads
    FROM pg_proc proc
    JOIN pg_namespace space ON space.oid = proc.pronamespace
   WHERE space.nspname = 'public' AND proc.proname = 'request_pitch_render';
  IF overloads <> 1 THEN
    RAISE EXCEPTION 'D38-B: request_pitch_render has % signatures, must have exactly 1', overloads;
  END IF;
  SELECT proc.pronargs INTO arg_count
    FROM pg_proc proc
    JOIN pg_namespace space ON space.oid = proc.pronamespace
   WHERE space.nspname = 'public' AND proc.proname = 'request_pitch_render';
  IF arg_count <> 3 THEN
    RAISE EXCEPTION 'D38-B: request_pitch_render takes % arguments, expected 3', arg_count;
  END IF;
END;
$$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'ee380000-0000-0000-0000-000000000002', true);

-- (B1) The deployed bundle's 1-argument call still works and asks for the
-- default highlight — this is what makes "migration first, web second" safe.
DO $$
DECLARE
  first_job UUID;
  first_status TEXT;
  first_cached BOOLEAN;
  stored_variant TEXT;
  stored_options JSONB;
BEGIN
  SELECT job_id, job_status, already_requested
    INTO first_job, first_status, first_cached
    FROM public.request_pitch_render('ee384000-0000-0000-0000-000000000001');
  IF first_job IS NULL OR first_status <> 'queued' OR first_cached THEN
    RAISE EXCEPTION 'D38-B1: the 1-argument call did not queue a job (%, %, %)',
      first_job, first_status, first_cached;
  END IF;
  SELECT variant, options INTO stored_variant, stored_options
    FROM public.get_pitch_render_state('ee384000-0000-0000-0000-000000000001');
  IF stored_variant <> 'highlight' OR stored_options <> '{}'::jsonb THEN
    RAISE EXCEPTION 'D38-B1: default request stored % / %', stored_variant, stored_options;
  END IF;
END;
$$;

-- (B2) A repeat request naming ANOTHER variant is still the idempotent cache
-- hit of 0054 and does NOT re-point the in-flight render. One revision, one
-- MP4, one free grant.
DO $$
DECLARE
  cached BOOLEAN;
  repeat_job UUID;
  state_job UUID;
  stored_variant TEXT;
  stored_options JSONB;
BEGIN
  SELECT job_id, already_requested INTO repeat_job, cached
    FROM public.request_pitch_render(
      'ee384000-0000-0000-0000-000000000001', 'full', '{"music": false}'::jsonb
    );
  IF NOT cached THEN
    RAISE EXCEPTION 'D38-B2: a repeat request minted a second job';
  END IF;
  -- The member surface is the only client-reachable read of the queue (0054),
  -- so the assertions go through it rather than through the table.
  SELECT job_id, variant, options INTO state_job, stored_variant, stored_options
    FROM public.get_pitch_render_state('ee384000-0000-0000-0000-000000000001');
  IF state_job IS DISTINCT FROM repeat_job THEN
    RAISE EXCEPTION 'D38-B2: the campaign latest job is not the cached job';
  END IF;
  IF stored_variant <> 'highlight' OR stored_options <> '{}'::jsonb THEN
    RAISE EXCEPTION 'D38-B2: a cached job was re-pointed at % / %',
      stored_variant, stored_options;
  END IF;
END;
$$;

-- (B3) The 3-argument call on a FRESH request records exactly what was chosen.
SELECT set_config('request.jwt.claim.sub', 'ee380000-0000-0000-0000-000000000003', true);
DO $$
DECLARE
  job UUID;
  stored_variant TEXT;
  stored_options JSONB;
BEGIN
  SELECT job_id INTO job
    FROM public.request_pitch_render(
      'ee384000-0000-0000-0000-000000000002', 'full', '{"music": true}'::jsonb
    );
  IF job IS NULL THEN
    RAISE EXCEPTION 'D38-B3: the 3-argument call queued nothing';
  END IF;
  SELECT variant, options INTO stored_variant, stored_options
    FROM public.get_pitch_render_state('ee384000-0000-0000-0000-000000000002');
  IF stored_variant <> 'full' OR stored_options <> '{"music": true}'::jsonb THEN
    RAISE EXCEPTION 'D38-B3: the chosen variant/options were not stored (% / %)',
      stored_variant, stored_options;
  END IF;
END;
$$;

-- ═══ C. A request the renderer cannot honour is refused ════════════════
DO $$
BEGIN
  BEGIN
    PERFORM public.request_pitch_render(
      'ee384000-0000-0000-0000-000000000002', 'teaser', '{}'::jsonb
    );
    RAISE EXCEPTION 'D38-C: an unknown variant was enqueued';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'unknown render variant' THEN
      RAISE;
    END IF;
  END;
  BEGIN
    PERFORM public.request_pitch_render(
      'ee384000-0000-0000-0000-000000000002', 'highlight', '{"watermark": true}'::jsonb
    );
    RAISE EXCEPTION 'D38-C: an unknown option key was enqueued';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'unsupported render option' THEN
      RAISE;
    END IF;
  END;
  BEGIN
    PERFORM public.request_pitch_render(
      'ee384000-0000-0000-0000-000000000002', 'highlight', '{"music": 3}'::jsonb
    );
    RAISE EXCEPTION 'D38-C: a non-boolean music option was enqueued';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'unsupported render option' THEN
      RAISE;
    END IF;
  END;
END;
$$;

-- ═══ D. The state RPC answers with the appended columns ════════════════
DO $$
DECLARE
  state RECORD;
BEGIN
  SELECT * INTO state
    FROM public.get_pitch_render_state('ee384000-0000-0000-0000-000000000002');
  IF state.variant <> 'full'
     OR state.options <> '{"music": true}'::jsonb
     OR state.effective_variant IS NOT NULL THEN
    RAISE EXCEPTION 'D38-D: state returned % / % / %',
      state.variant, state.options, state.effective_variant;
  END IF;
  -- The 0054 columns are still there, in front, unchanged.
  IF state.job_id IS NULL OR state.job_status <> 'queued' OR state.free_render_used THEN
    RAISE EXCEPTION 'D38-D: the pre-existing state columns changed meaning';
  END IF;
END;
$$;

-- A campaign with no job at all still answers exactly one row, now with three
-- more NULLs rather than a missing column.
SELECT set_config('request.jwt.claim.sub', 'ee380000-0000-0000-0000-000000000004', true);
DO $$
DECLARE
  rows_returned INTEGER;
BEGIN
  BEGIN
    SELECT count(*) INTO rows_returned
      FROM public.get_pitch_render_state('ee384000-0000-0000-0000-000000000001');
    RAISE EXCEPTION 'D38-D: a stranger read another campaign''s render state';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'campaign not found or not yours to render' THEN
      RAISE;
    END IF;
  END;
END;
$$;

-- ═══ E. The free-render rule of 0054 is unchanged ══════════════════════
RESET ROLE;

-- Campaign B's first render succeeds, which consumes the campaign's one free
-- render (0054 consumes at SUCCESS).
DO $$
DECLARE
  job media_render_jobs;
  lease UUID;
BEGIN
  SELECT * INTO job
    FROM media_render_jobs
   WHERE campaign_id = 'ee384000-0000-0000-0000-000000000002';
  UPDATE media_render_jobs
     SET status = 'leased',
         lease_token = gen_random_uuid(),
         leased_at = now(),
         lease_expires_at = now() + INTERVAL '15 minutes'
   WHERE id = job.id
   RETURNING lease_token INTO lease;
  PERFORM public.complete_media_render_job(
    job.id,
    lease,
    'succeeded',
    'pitch-media/ee381000-0000-0000-0000-000000000002/renders/out.mp4',
    1048576,
    24000,
    NULL
  );
END;
$$;

-- The Dater approves a SECOND revision and asks for its MP4. The free render
-- is gone, so this costs a Campaign Pass — the variant arguments change none
-- of that, which is the whole point of this block.
UPDATE consent_requests
   SET revision_id = 'ee382000-0000-0000-0000-000000000003',
       responded_at = now()
 WHERE id = 'ee383000-0000-0000-0000-000000000002';

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'ee380000-0000-0000-0000-000000000003', true);
DO $$
DECLARE
  free_used BOOLEAN;
BEGIN
  SELECT free_render_used INTO free_used
    FROM public.get_pitch_render_state('ee384000-0000-0000-0000-000000000002');
  IF NOT free_used THEN
    RAISE EXCEPTION 'D38-E: a successful render did not consume the free render';
  END IF;
  BEGIN
    PERFORM public.request_pitch_render(
      'ee384000-0000-0000-0000-000000000002', 'highlight', '{"music": true}'::jsonb
    );
    RAISE EXCEPTION 'D38-E: a second revision rendered without a Campaign Pass';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'campaign pass required' THEN
      RAISE;
    END IF;
  END;
  -- And the 1-argument call is refused for exactly the same reason: the gate
  -- is on entitlement, not on which arguments the caller passed.
  BEGIN
    PERFORM public.request_pitch_render('ee384000-0000-0000-0000-000000000002');
    RAISE EXCEPTION 'D38-E: the 1-argument call bypassed the pass gate';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'campaign pass required' THEN
      RAISE;
    END IF;
  END;
END;
$$;

-- ═══ F. asset_role belongs to the uploader ═════════════════════════════
SELECT set_config('request.jwt.claim.sub', 'ee380000-0000-0000-0000-000000000001', true);

-- (F1) The draft's creator marks their own clip as the selfie.
-- Column by column, exactly as the client may write it: the 0052 sweep grants
-- INSERT per column, so this statement also proves asset_role is in the grant.
INSERT INTO pitch_assets (
  pitch_draft_id, uploaded_by_user_id, asset_type, storage_path, sort_order, asset_role
) VALUES (
  'ee381000-0000-0000-0000-000000000003',
  'ee380000-0000-0000-0000-000000000001',
  'video',
  'pitch-media/ee381000-0000-0000-0000-000000000003/selfie.mp4',
  1,
  'selfie'
);

DO $$
DECLARE
  role_value TEXT;
BEGIN
  SELECT asset_role INTO role_value
    FROM pitch_assets
   WHERE storage_path = 'pitch-media/ee381000-0000-0000-0000-000000000003/selfie.mp4';
  IF role_value <> 'selfie' THEN
    RAISE EXCEPTION 'D38-F1: the uploader could not mark their own clip, got %', role_value;
  END IF;
END;
$$;

-- (F2) Nobody else may write it, because nobody else may write the row: the
-- insert policies are uploader-scoped and there is no UPDATE grant at all.
SELECT set_config('request.jwt.claim.sub', 'ee380000-0000-0000-0000-000000000004', true);
DO $$
BEGIN
  BEGIN
    INSERT INTO pitch_assets (
      pitch_draft_id, uploaded_by_user_id, asset_type, storage_path, asset_role
    ) VALUES (
      'ee381000-0000-0000-0000-000000000004',
      'ee380000-0000-0000-0000-000000000004',
      'video',
      'pitch-media/ee381000-0000-0000-0000-000000000004/stranger.mp4',
      'selfie'
    );
    RAISE EXCEPTION 'D38-F2: a stranger inserted a selfie clip into another draft';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;

SELECT set_config('request.jwt.claim.sub', 'ee380000-0000-0000-0000-000000000001', true);
DO $$
BEGIN
  -- Not even the uploader may re-label an asset after the fact: asset_role is
  -- an INSERT-time fact, so a clip cannot become "the selfie" after the Dater
  -- approved it as something else.
  BEGIN
    UPDATE pitch_assets SET asset_role = NULL
     WHERE storage_path = 'pitch-media/ee381000-0000-0000-0000-000000000003/selfie.mp4';
    RAISE EXCEPTION 'D38-F3: asset_role was updatable by a client role';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;

-- (F4) Only a video can carry the role — the worker extracts frames from an
-- ingested proxy, and a photo has none.
RESET ROLE;
DO $$
BEGIN
  BEGIN
    INSERT INTO pitch_assets (
      pitch_draft_id, uploaded_by_user_id, asset_type, storage_path, asset_role
    ) VALUES (
      'ee381000-0000-0000-0000-000000000005',
      'ee380000-0000-0000-0000-000000000001',
      'photo',
      'ee381000-0000-0000-0000-000000000005/face.jpg',
      'selfie'
    );
    RAISE EXCEPTION 'D38-F4: a photo was accepted as the selfie clip';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO pitch_assets (
      pitch_draft_id, uploaded_by_user_id, asset_type, storage_path, asset_role
    ) VALUES (
      'ee381000-0000-0000-0000-000000000005',
      'ee380000-0000-0000-0000-000000000001',
      'video',
      'pitch-media/ee381000-0000-0000-0000-000000000005/other.mp4',
      'poster'
    );
    RAISE EXCEPTION 'D38-F4: an unknown asset_role was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END;
$$;

ROLLBACK;

SELECT '38_render_variant.sql passed' AS result;
