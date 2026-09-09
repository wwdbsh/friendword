-- 0063 — the MP4 gets a VARIANT (T002 / issue #98, docs/REEL_V3_DESIGN.md §2.1)
--
-- What changes, and what deliberately does not:
--
-- 1. THE SCENE IS UNTOUCHED. The highlight cut, the chrome, the captions and
--    the end card are renderer-only (§0). No scene schema, no scene_hash, no
--    consent snapshot rule moves here. This migration only teaches the JOB row
--    what kind of MP4 was asked for.
--
-- 2. ONE MP4 PER REVISION, STILL. media_render_jobs.revision_id stays NOT NULL
--    UNIQUE (0054:79) and every idempotency, free-render and retry judgment in
--    request_pitch_render is replicated below VERBATIM. The variant is picked
--    BEFORE the render and recorded on that one row; there is no "render it
--    again the other way", because that would hand out two MP4s for one free
--    grant.
--
-- 3. NO OVERLOAD. request_pitch_render gains two arguments WITH DEFAULTS, and
--    the 1-argument function is DROPped in the same statement block. A
--    Postgres overload would make `request_pitch_render(uuid)` ambiguous to
--    PostgREST; a single function with defaults keeps the currently deployed
--    web bundle (which passes only target_campaign_id) working through the
--    deploy window (§6 deploy order), and 38_render_variant.sql asserts that
--    exactly one signature exists.
--
-- 4. THE FIRST ARGUMENT KEEPS ITS NAME. §2.1 of the design sketches the
--    signature as `request_pitch_render(p_revision_id ...)`, but the deployed
--    function takes `target_campaign_id` (0054:325) and DERIVES the approved
--    revision from the campaign — that is what the membership and pass gates
--    are written against. PostgREST passes arguments BY NAME, so renaming it
--    would break every existing caller for no gain. The design's intent (a
--    variant and options on the request) is honoured; the parameter name is
--    not changed.
--
-- 5. effective_variant IS THE WORKER'S ANSWER, NOT THE USER'S REQUEST. A
--    transcript with fewer than two segments has no highlight to cut (§1 rule
--    5), so the worker falls back to Full and records that here. Keeping the
--    request and the outcome in two columns is what lets us tell "they asked
--    for Full" apart from "we could not give them Highlight".
--
-- 6. asset_role MARKS THE SELFIE CLIP, and nothing else. The render worker must
--    know which approved video is the 3-second opener (§2.2-4, §3) without
--    inferring it from a storage path — paths are user-influenced input, and
--    0051 already had to close a path-walking hole. Writable only at INSERT and
--    only by the uploader: the existing column-level GRANT is extended to the
--    new column, authenticated still holds no UPDATE on pitch_assets (0052:88),
--    and the insert policies still require auth.uid() = uploaded_by_user_id.

-- ── 1. What kind of MP4 was requested ────────────────────────────────────
ALTER TABLE public.media_render_jobs
  ADD COLUMN variant TEXT NOT NULL DEFAULT 'highlight'
    CHECK (variant IN ('full', 'highlight')),
  -- Render options the requester chose. A closed, tiny object: see
  -- private.render_options_are_valid.
  ADD COLUMN options JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- The computed cut (contracts/highlightPlan.ts), stored so a re-run of the
  -- same job produces the same video and so support can see what was cut.
  ADD COLUMN cut_plan JSONB,
  -- sha256 over the plan's windows — the cut's identity, and the music bed's
  -- seed (§2.6).
  ADD COLUMN cut_hash TEXT CHECK (cut_hash ~ '^[0-9a-f]{64}$'),
  -- What the worker actually rendered. NULL until it decides.
  ADD COLUMN effective_variant TEXT
    CHECK (effective_variant IN ('full', 'highlight'));

COMMENT ON COLUMN public.media_render_jobs.variant IS
  'The MP4 the requester asked for: highlight (a 15-30s cut of the approved sentences, the default) or full (the whole approved recording). Chosen before the render and never changed for a job that has run — one MP4 per revision.';
COMMENT ON COLUMN public.media_render_jobs.options IS
  'Render options, whitelisted by private.render_options_are_valid. Today: {"music": boolean}.';
COMMENT ON COLUMN public.media_render_jobs.cut_plan IS
  'The HighlightPlan the worker computed (version, windows, totalMs, hash), or NULL for a full render.';
COMMENT ON COLUMN public.media_render_jobs.cut_hash IS
  'sha256 of the cut plan windows: the cut''s identity and the deterministic seed for the music bed.';
COMMENT ON COLUMN public.media_render_jobs.effective_variant IS
  'What the worker rendered. Differs from variant when a highlight was impossible (fewer than two transcript segments) and it fell back to full.';

-- The option object is a closed set, checked in ONE place so the column
-- constraint and the RPC cannot drift apart. IMMUTABLE because a CHECK
-- constraint may only call immutable code.
CREATE FUNCTION private.render_options_are_valid(candidate JSONB)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = public, extensions, pg_temp
AS $$
  SELECT candidate IS NOT NULL
     AND jsonb_typeof(candidate) = 'object'
     AND NOT EXISTS (
       SELECT 1
         FROM jsonb_each(candidate) AS entry(key, value)
        WHERE entry.key <> 'music'
           OR jsonb_typeof(entry.value) <> 'boolean'
     );
$$;

REVOKE ALL ON FUNCTION private.render_options_are_valid(JSONB) FROM PUBLIC;

ALTER TABLE public.media_render_jobs
  ADD CONSTRAINT media_render_jobs_options_are_known
    CHECK (private.render_options_are_valid(options));

-- ── 2. The selfie clip is marked as such ─────────────────────────────────
ALTER TABLE public.pitch_assets
  ADD COLUMN asset_role TEXT
    CHECK (asset_role IS NULL OR asset_role = 'selfie');

-- Only a video can be the selfie opener: the worker extracts frames from the
-- ingested proxy of this row (§2.2-4), and a photo has no proxy. Written as a
-- second constraint rather than folded into the first so the failure message
-- names the actual mistake.
ALTER TABLE public.pitch_assets
  ADD CONSTRAINT pitch_assets_selfie_role_is_video
    CHECK (asset_role IS NULL OR asset_type = 'video');

COMMENT ON COLUMN public.pitch_assets.asset_role IS
  'selfie for the optional 3-second front-camera opener (a video asset), NULL for everything else. Set by the uploader at INSERT; there is no UPDATE grant, so it cannot be changed afterwards. The renderer uses it instead of parsing storage paths.';

-- The 0052 sweep grants pitch_assets INSERT column by column, so a new column
-- is NOT writable by clients until it is named here. The uploader identity is
-- still enforced by RLS (pitch_assets_insert_creators / _insert_subject).
GRANT INSERT (asset_role) ON public.pitch_assets TO authenticated;

-- ── 3. request_pitch_render, with a variant ──────────────────────────────
-- The body below is 0054:325-533 unchanged except for the three marked spots
-- (validate / store on insert / store on reset). Replicated in full rather
-- than patched, because CREATE OR REPLACE cannot change a function's argument
-- list and every gate here is load-bearing.
DROP FUNCTION public.request_pitch_render(UUID);

CREATE FUNCTION public.request_pitch_render(
  target_campaign_id UUID,
  p_variant TEXT DEFAULT 'highlight',
  p_options JSONB DEFAULT '{}'::jsonb
)
RETURNS TABLE (
  job_id UUID,
  job_status TEXT,
  revision_id UUID,
  output_storage_path TEXT,
  already_requested BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  caller UUID := auth.uid();
  campaign campaigns;
  consent consent_requests;
  approved consent_revisions;
  existing_job media_render_jobs;
  new_job_id UUID;
  free_render_spent BOOLEAN;
  sibling_render_live BOOLEAN;
  retry_cap INTEGER;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;
  PERFORM private.assert_active_account(caller);

  -- NEW (0063): the request is refused before any work when it names a video
  -- this renderer cannot make. Both messages are facts about the request, not
  -- about entitlement.
  IF p_variant IS NULL OR p_variant NOT IN ('full', 'highlight') THEN
    RAISE EXCEPTION 'unknown render variant';
  END IF;
  IF NOT private.render_options_are_valid(p_options) THEN
    RAISE EXCEPTION 'unsupported render option';
  END IF;

  -- FOR UPDATE serializes concurrent requests for one campaign, so the
  -- free/pass judgment below cannot be raced from two sessions.
  SELECT * INTO campaign
    FROM campaigns
   WHERE id = target_campaign_id
   FOR UPDATE;
  IF NOT FOUND OR NOT private.can_manage_campaign_render(campaign.id, caller) THEN
    RAISE EXCEPTION 'campaign not found or not yours to render';
  END IF;
  IF campaign.status <> 'published'
     OR (campaign.ends_at IS NOT NULL AND campaign.ends_at <= now()) THEN
    RAISE EXCEPTION 'campaign must be open to render its pitch video';
  END IF;

  SELECT * INTO consent
    FROM consent_requests
   WHERE pitch_draft_id = campaign.pitch_draft_id
     AND status = 'approved'
   ORDER BY responded_at DESC NULLS LAST, id
   LIMIT 1;
  IF consent.revision_id IS NULL THEN
    RAISE EXCEPTION 'no approved consent revision to render';
  END IF;
  SELECT * INTO approved
    FROM consent_revisions
   WHERE id = consent.revision_id;
  IF approved.scene_definition IS NULL OR approved.scene_hash IS NULL THEN
    RAISE EXCEPTION 'this pitch has no approved motion scene to render';
  END IF;

  -- Two DISTINCT facts gate the free path, and each earns its own refusal
  -- (C3): a message may only assert what the code makes true (CLAUDE.md §12),
  -- and telling a user to buy a pass when waiting is free would be a payment
  -- prompt built on a false claim.
  --
  --   free_render_spent    the grant is genuinely gone: the unlock row
  --                        exists, or a sibling revision already reached
  --                        'done' (its second-success unlock insert is an
  --                        ON CONFLICT no-op, so 'done' implies consumption
  --                        even if the row were ever absent). Refusal:
  --                        'campaign pass required' — true.
  --   sibling_render_live  another revision's render is queued or leased.
  --                        NOTHING has been consumed; if that render dies,
  --                        the next request is free. Refusal must state the
  --                        in-progress fact and may not mention the pass.
  free_render_spent := EXISTS (
    SELECT 1 FROM pitch_render_unlocks unlock WHERE unlock.campaign_id = campaign.id
  ) OR EXISTS (
    SELECT 1
      FROM media_render_jobs sibling
     WHERE sibling.campaign_id = campaign.id
       AND sibling.revision_id <> approved.id
       AND sibling.status = 'done'
  );
  sibling_render_live := EXISTS (
    SELECT 1
      FROM media_render_jobs sibling
     WHERE sibling.campaign_id = campaign.id
       AND sibling.revision_id <> approved.id
       AND sibling.status IN ('queued', 'leased')
  );

  SELECT * INTO existing_job
    FROM media_render_jobs job
   WHERE job.revision_id = approved.id;
  IF FOUND THEN
    IF existing_job.status = 'failed' THEN
      -- Consumed nothing (decision 4), so a re-request may retry — behind the
      -- same gate a fresh request would face, in case the pass lapsed since.
      IF free_render_spent THEN
        IF NOT private.campaign_pass_active(campaign.id) THEN
          RAISE EXCEPTION 'campaign pass required';
        END IF;
      ELSIF sibling_render_live
        AND NOT private.campaign_pass_active(campaign.id) THEN
        RAISE EXCEPTION 'a render for this campaign is already in progress';
      END IF;
      -- C2 (cost ceiling): each reset re-opens a 3-attempt worker budget
      -- (minutes of CPU per attempt), and while the free render is unspent
      -- the pass gate above does not bind — so resets are capped per account
      -- per hour. 0045/0053 advisory-lock pattern: lock the account bucket
      -- BEFORE counting so two concurrent resets cannot both pass the check.
      PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(caller::TEXT, 540055)
      );
      SELECT coalesce(
               (SELECT value::INTEGER FROM app_config
                 WHERE key = 'media_render_retry_hourly_cap'),
               3
             )
        INTO retry_cap;
      IF (
        SELECT count(*)
          FROM analytics_events event
         WHERE event.user_id = caller
           AND event.event_name = 'pitch_render_retry_requested'
           AND event.created_at >= now() - INTERVAL '1 hour'
      ) >= retry_cap THEN
        RAISE EXCEPTION 'render retry rate limit exceeded for this account';
      END IF;
      INSERT INTO analytics_events (user_id, event_name, properties)
      VALUES (
        caller,
        'pitch_render_retry_requested',
        jsonb_build_object('campaign_id', campaign.id, 'revision_id', approved.id)
      );
      UPDATE media_render_jobs
         SET status = 'queued',
             attempts = 0,
             lease_token = NULL,
             leased_at = NULL,
             lease_expires_at = NULL,
             last_error = NULL,
             -- NEW (0063): a reset is a NEW render of the same revision, and
             -- nothing was delivered, so the requester may choose the variant
             -- again. The results of the failed attempt are cleared with it.
             variant = p_variant,
             options = p_options,
             cut_plan = NULL,
             cut_hash = NULL,
             effective_variant = NULL
       WHERE id = existing_job.id;
      RETURN QUERY
        SELECT existing_job.id, 'queued'::TEXT, approved.id, NULL::TEXT, true;
      RETURN;
    END IF;
    -- Idempotent cache hit: done, queued or leased — return it, write nothing.
    -- Including the variant: the job that exists is the MP4 this revision
    -- gets, and silently re-pointing an in-flight or delivered render at a
    -- different variant is exactly the "two MP4s for one grant" this table's
    -- UNIQUE key exists to prevent. The kit locks the choice once a render is
    -- under way (§4).
    RETURN QUERY
      SELECT existing_job.id,
             existing_job.status,
             approved.id,
             existing_job.output_storage_path,
             true;
    RETURN;
  END IF;

  -- First request for this revision. The first render of a CAMPAIGN is the
  -- free one; every later revision's render needs the Campaign Pass.
  IF free_render_spent THEN
    IF NOT private.campaign_pass_active(campaign.id) THEN
      RAISE EXCEPTION 'campaign pass required';
    END IF;
  ELSIF sibling_render_live AND NOT private.campaign_pass_active(campaign.id) THEN
    RAISE EXCEPTION 'a render for this campaign is already in progress';
  END IF;

  INSERT INTO media_render_jobs (
    revision_id, campaign_id, pitch_draft_id, scene_hash, requested_by_user_id,
    -- NEW (0063).
    variant, options
  )
  VALUES (
    approved.id, campaign.id, campaign.pitch_draft_id, approved.scene_hash, caller,
    p_variant, p_options
  )
  ON CONFLICT (revision_id) DO NOTHING
  RETURNING id INTO new_job_id;
  IF new_job_id IS NULL THEN
    -- Race loser behind the campaign lock's release: hand back the winner's job.
    RETURN QUERY
      SELECT job.id, job.status, job.revision_id, job.output_storage_path, true
        FROM media_render_jobs job
       WHERE job.revision_id = approved.id;
    RETURN;
  END IF;

  INSERT INTO analytics_events (user_id, event_name, properties)
  VALUES (
    caller,
    'pitch_render_requested',
    jsonb_build_object(
      'campaign_id', campaign.id,
      'revision_id', approved.id,
      'free_render_spent', free_render_spent,
      'variant', p_variant
    )
  );

  RETURN QUERY SELECT new_job_id, 'queued'::TEXT, approved.id, NULL::TEXT, false;
END;
$$;

REVOKE ALL ON FUNCTION public.request_pitch_render(UUID, TEXT, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_pitch_render(UUID, TEXT, JSONB) TO authenticated;

COMMENT ON FUNCTION public.request_pitch_render(UUID, TEXT, JSONB) IS
  'Enqueues the MP4 render of the campaign''s current APPROVED revision, lazily, at export-request time, in the requested variant (highlight by default) with whitelisted options ({"music": boolean}). Idempotent per revision (the UNIQUE job is the cache) — a repeat request returns the stored job WITHOUT changing its variant, because one revision gets one MP4; only the reset of a terminally failed job may choose again. The campaign''s first render is free; once the free render is SPENT (unlock row, or a done sibling), another revision''s render — or the retry of a terminally failed one — requires an active Campaign Pass ("campaign pass required"). While a sibling render is merely queued or leased and nothing is consumed yet, the refusal is "a render for this campaign is already in progress" — never a pass demand, because waiting is free. Resets of a terminal failure are additionally capped per account per hour (media_render_retry_hourly_cap). Consumption itself happens at success, in complete_media_render_job.';

-- ── 4. get_pitch_render_state, with the variant appended ─────────────────
-- The three new columns are APPENDED, so a client bundle that reads the 0054
-- columns positionally or by name is unaffected during the deploy window.
DROP FUNCTION public.get_pitch_render_state(UUID);

CREATE FUNCTION public.get_pitch_render_state(target_campaign_id UUID)
RETURNS TABLE (
  job_id UUID,
  job_status TEXT,
  revision_id UUID,
  output_storage_path TEXT,
  last_error TEXT,
  free_render_used BOOLEAN,
  pass_active BOOLEAN,
  updated_at TIMESTAMPTZ,
  variant TEXT,
  effective_variant TEXT,
  options JSONB
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  caller UUID := auth.uid();
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;
  IF NOT private.can_manage_campaign_render(target_campaign_id, caller) THEN
    RAISE EXCEPTION 'campaign not found or not yours to render';
  END IF;

  RETURN QUERY
  SELECT job.id,
         job.status,
         job.revision_id,
         job.output_storage_path,
         job.last_error,
         EXISTS (
           SELECT 1 FROM pitch_render_unlocks unlock
            WHERE unlock.campaign_id = target_campaign_id
         ),
         private.campaign_pass_active(target_campaign_id),
         job.updated_at,
         job.variant,
         job.effective_variant,
         job.options
    FROM media_render_jobs job
   WHERE job.campaign_id = target_campaign_id
   ORDER BY job.created_at DESC, job.id DESC
   LIMIT 1;
  IF NOT FOUND THEN
    RETURN QUERY
    SELECT NULL::UUID,
           NULL::TEXT,
           NULL::UUID,
           NULL::TEXT,
           NULL::TEXT,
           EXISTS (
             SELECT 1 FROM pitch_render_unlocks unlock
              WHERE unlock.campaign_id = target_campaign_id
           ),
           private.campaign_pass_active(target_campaign_id),
           NULL::TIMESTAMPTZ,
           NULL::TEXT,
           NULL::TEXT,
           NULL::JSONB;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.get_pitch_render_state(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_pitch_render_state(UUID) TO authenticated;

COMMENT ON FUNCTION public.get_pitch_render_state(UUID) IS
  'One row for a campaign member: the latest render job (NULL job fields when none exists yet), whether the free render is spent, whether the Campaign Pass is live, and which MP4 variant was requested / actually rendered with which options. The only client-reachable read of the render tables.';
