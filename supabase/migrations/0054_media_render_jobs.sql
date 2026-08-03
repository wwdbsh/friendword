-- Motion pitch Phase 4 (DB layer): a durable lease queue for server MP4
-- renders of the APPROVED PitchScene, plus the free-first-render ledger.
--
-- SIX DECISIONS, pinned before reading the DDL:
--
-- 1. THE QUEUE IS THE 0050 INGEST QUEUE, RE-INSTANTIATED. media_render_jobs is
--    media_ingest_jobs with a different work unit: lease token + deadline,
--    FOR UPDATE SKIP LOCKED claim (precedent 0014:647), service-only
--    claim/complete RPCs, and a BEFORE trigger that is the entire state
--    machine. No new pattern is invented here.
--
-- 2. ENQUEUE IS LAZY — THE FIRST EXPORT REQUEST, NEVER APPROVAL.
--    approve_and_publish_pitch is untouched (its fourth redefinition does not
--    exist). Rendering at approval would burn 2-3 minutes of compute per
--    approval nobody exports, and — worse — would bake TODAY's placeholder
--    end-card URL into an idempotent per-revision cache that is never
--    recomputed (media-worker/render/index.ts:7 pins "render late" for the
--    same reason). Exactly-once still holds under lazy: the job is keyed
--    UNIQUE on the approved consent revision and inserted with
--    ON CONFLICT DO NOTHING, so N requests for one revision are one durable
--    job and N-1 cached reads.
--
-- 3. THE FREE RENDER IS A GRANT, NOT A PURCHASE. It lives in
--    pitch_render_unlocks (the share_kits shape, 0020:100), where the UNIQUE
--    campaign key IS the "exactly one free render per campaign" invariant —
--    enforced by the constraint, not by counting. purchase_credit_ledger
--    stays a record of money; a free grant inside it would blur refund and
--    audit semantics. Re-renders (a NEW approved revision after the free one
--    is spent) are judged against the existing Campaign Pass entitlement
--    (campaign_entitlements, product campaign_pass_30d_1999) exactly the way
--    0020's analytics gate reads it. No new SKU.
--
-- 4. THE FREE RENDER IS CONSUMED AT SUCCESS, NOT AT ENQUEUE. The unlock row
--    is written by complete_media_render_job on the 'succeeded' outcome only.
--    A render that dies three times has consumed nothing, and the next
--    request for that revision re-queues the same job for free. Idempotency
--    is a separate mechanism from the ledger: a repeat request returns the
--    stored job (done, queued or leased) and writes nothing.
--
-- 5. THE MP4 LIVES UNDER THE DRAFT PREFIX BUT OUTSIDE THE QUOTA PREDICATE.
--    Output objects are 'pitch-media/<draft>/renders/<revision>.mp4'
--    (CHECK-enforced). The quota arithmetic (0050 §7): the per-draft client
--    upload ceiling is 20 with a documented transitional peak of 17, so one
--    ~35MB MP4 per revision inside the counted set would erase the headroom
--    that ceiling exists to keep. private.pitch_media_draft_id (0003:57) only
--    parses FLAT '<uuid>/<name>' object names — a nested
--    '<uuid>/renders/<name>' returns NULL — so render outputs are invisible
--    to private.pitch_media_object_count and the 20-object policy keeps its
--    documented 14-steady / 17-peak / +3-headroom arithmetic unchanged.
--    Lifecycle is inherited rather than re-implemented: the 0037 erasure job
--    lists the draft prefix RECURSIVELY (scripts/process-deletions.mjs
--    listStoragePaths walks subfolders), so erasure removes renders with the
--    rest of the draft's media; scripts/cleanup-orphan-media.mjs protects the
--    whole draft prefix once any consent revision exists, and a render only
--    ever exists FOR a consent revision, so the sweep cannot orphan-collect a
--    live one. Campaign takedown (paused / expired / archived) stops
--    distribution structurally: claim refuses the job (decision 6) and the
--    read RPC is the only client path to the object name — the same
--    stop-serving-but-keep-media contract every other pitch object follows,
--    with the DB rows cascading if the campaign row itself is ever deleted.
--
-- 6. CAMPAIGN STATE IS CHECKED AT CLAIM TIME, AND CONCURRENCY IS CAPPED.
--    A queued job whose campaign is paused simply is not claimable (it waits;
--    pause is reversible). A queued job whose campaign is expired or archived
--    is terminalized at claim time (0033: expiry is one-way). The number of
--    simultaneously leased renders is bounded by app_config
--    'media_render_concurrency_cap' under a claim-scoped advisory lock
--    (0045/0053 pattern, fresh seed 540054), because each render is minutes
--    of CPU and an unbounded queue drain is a cost incident. The other cost
--    edge — resetting a terminally failed job re-opens a 3-attempt budget —
--    is bounded by 'media_render_retry_hourly_cap' per account (seed 540055).

-- ── 1. The job queue ─────────────────────────────────────────────────────
CREATE TABLE public.media_render_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- One durable job per approved consent revision, for the life of the
  -- revision: this UNIQUE key is what makes "request to export" exactly-once
  -- (decision 2). A retry re-queues this row; it never inserts a sibling.
  revision_id UUID NOT NULL UNIQUE REFERENCES public.consent_revisions(id) ON DELETE CASCADE,
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  pitch_draft_id UUID NOT NULL REFERENCES public.pitch_drafts(id) ON DELETE CASCADE,
  -- Frozen from the revision at enqueue so the worker can verify the scene
  -- bytes it reads are the scene that was requested (0048's hash contract).
  scene_hash TEXT NOT NULL,
  -- SET NULL, not CASCADE: the render belongs to the campaign, and must not
  -- vanish because the member who happened to click "export" erased their
  -- account while the campaign lives on.
  requested_by_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'leased', 'done', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  lease_token UUID,
  leased_at TIMESTAMPTZ,
  lease_expires_at TIMESTAMPTZ,
  last_error TEXT,
  -- The result, on the job row: unlike ingest there is no second verdict
  -- object — "this revision has been rendered" IS the job reaching 'done',
  -- and the UNIQUE revision key makes this row the idempotent cache.
  output_storage_path TEXT,
  output_bytes BIGINT CHECK (output_bytes > 0 AND output_bytes <= 209715200),
  output_duration_ms INTEGER
    CHECK (output_duration_ms > 0 AND output_duration_ms <= 600000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- A lease is a token AND a deadline, or it is nothing (0050 precedent).
  CONSTRAINT media_render_jobs_lease_is_whole CHECK (
    (status = 'leased') = (lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
  ),
  -- 'done' is a COMPLETE result or it is not done.
  CONSTRAINT media_render_jobs_done_is_complete CHECK (
    status <> 'done'
    OR (
      output_storage_path IS NOT NULL
      AND output_bytes IS NOT NULL
      AND output_duration_ms IS NOT NULL
    )
  ),
  CONSTRAINT media_render_jobs_failed_has_reason CHECK (
    status <> 'failed' OR last_error IS NOT NULL
  ),
  -- Decision 5: the output may only name this draft's own renders/ prefix,
  -- and '..' cannot walk back out of it (0051 precedent).
  CONSTRAINT media_render_jobs_output_is_own_renders_prefix CHECK (
    output_storage_path IS NULL
    OR (
      position('..' IN output_storage_path) = 0
      AND output_storage_path LIKE
        'pitch-media/' || pitch_draft_id::TEXT || '/renders/%'
    )
  )
);

COMMENT ON TABLE public.media_render_jobs IS
  'Lease queue AND idempotent result cache for MP4 renders of an approved consent revision, service-role only. One row per revision (UNIQUE): a repeat export request returns this row instead of new work. status is the job lifecycle; done rows carry the output under pitch-media/<draft>/renders/.';

COMMENT ON COLUMN public.media_render_jobs.output_storage_path IS
  'Bucket-prefixed path of the finished MP4, always pitch-media/<draft>/renders/<name> (CHECK-enforced). The nested prefix keeps it outside private.pitch_media_object_count (which only parses flat <uuid>/<name>) while the 0037 erasure job''s recursive prefix listing still removes it with the draft.';

ALTER TABLE public.media_render_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.media_render_jobs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.media_render_jobs TO service_role;

CREATE INDEX media_render_jobs_claimable_idx
  ON public.media_render_jobs (status, created_at, id);
CREATE INDEX media_render_jobs_campaign_idx
  ON public.media_render_jobs (campaign_id, created_at DESC);

CREATE TRIGGER media_render_jobs_set_updated_at
BEFORE UPDATE ON public.media_render_jobs
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- The state machine, as a BEFORE trigger so it binds every writer including a
-- hand-written service query. Legal moves:
--
--   (insert)      -> queued             request_pitch_render only
--   queued        -> leased             claim
--   queued        -> failed             retry budget spent, or the campaign
--                                       became unrenderable (claim sweep)
--   leased        -> leased             re-claim ONLY after the lease expired,
--                                       or the holder annotating its own job
--   leased        -> queued | done | failed   the worker finished or released
--   failed        -> queued             ONLY as a deliberate reset
--                                       (attempts back to 0) — the path
--                                       request_pitch_render takes when a
--                                       member re-requests a terminally
--                                       failed render
--   done          -> (nothing)          a completed render is final; the row
--                                       is the idempotent cache
CREATE FUNCTION private.enforce_media_render_job_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'queued' THEN
      RAISE EXCEPTION 'media render job must be created queued';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.revision_id IS DISTINCT FROM OLD.revision_id
     OR NEW.campaign_id IS DISTINCT FROM OLD.campaign_id
     OR NEW.pitch_draft_id IS DISTINCT FROM OLD.pitch_draft_id
     OR NEW.scene_hash IS DISTINCT FROM OLD.scene_hash THEN
    RAISE EXCEPTION 'media render job identity is immutable';
  END IF;
  IF NEW.status = OLD.status AND NEW.status <> 'leased' THEN
    RETURN NEW;
  END IF;

  CASE
    WHEN OLD.status = 'queued' AND NEW.status IN ('leased', 'failed') THEN
      NULL;
    WHEN OLD.status = 'leased' AND NEW.status IN ('queued', 'done', 'failed') THEN
      NULL;
    WHEN OLD.status = 'leased' AND NEW.status = 'leased' THEN
      -- Issuing a NEW token over a live lease is the double-worker bug this
      -- table exists to prevent (0050 precedent).
      IF NEW.lease_token IS DISTINCT FROM OLD.lease_token
         AND OLD.lease_expires_at > now() THEN
        RAISE EXCEPTION 'media render job lease is still held';
      END IF;
    WHEN OLD.status = 'failed' AND NEW.status = 'queued' THEN
      -- The only way out of terminal failure is a deliberate reset: a fresh
      -- retry budget, issued by request_pitch_render on an explicit member
      -- re-request (which re-applies the free/pass gate first). A worker
      -- cannot walk a terminal job back by accident.
      IF NEW.attempts <> 0 THEN
        RAISE EXCEPTION
          'a failed render job may only be re-queued with a fresh attempt budget';
      END IF;
    WHEN OLD.status = 'done' THEN
      RAISE EXCEPTION 'a completed render job is final';
    ELSE
      RAISE EXCEPTION 'media render job cannot move from % to %',
        OLD.status, NEW.status;
  END CASE;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.enforce_media_render_job_transition() FROM PUBLIC;

CREATE TRIGGER media_render_jobs_enforce_transition
BEFORE INSERT OR UPDATE ON public.media_render_jobs
FOR EACH ROW EXECUTE FUNCTION private.enforce_media_render_job_transition();

-- ── 2. The free-render ledger (decision 3) ───────────────────────────────
CREATE TABLE public.pitch_render_unlocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- THE invariant: one free render per campaign, as a constraint. Two
  -- concurrent completions cannot both consume it; the loser's insert is a
  -- structural no-op.
  campaign_id UUID NOT NULL UNIQUE REFERENCES public.campaigns(id) ON DELETE CASCADE,
  render_job_id UUID NOT NULL REFERENCES public.media_render_jobs(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.pitch_render_unlocks IS
  'The consumed free MP4 render of a campaign — a grant ledger in the share_kits shape (0020), deliberately NOT purchase_credit_ledger, which records money. Written only by complete_media_render_job on success (a failed render consumes nothing). Existence of a row is what makes the next render of a NEW revision require the Campaign Pass.';

ALTER TABLE public.pitch_render_unlocks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pitch_render_unlocks FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pitch_render_unlocks TO service_role;

-- ── 3. Concurrency cap configuration (decision 6) ────────────────────────
INSERT INTO public.app_config (key, value)
VALUES ('media_render_concurrency_cap', '2')
ON CONFLICT (key) DO NOTHING;

-- The cost ceiling on RESETS of a terminally failed job (Advisor correction
-- C2): each reset re-opens a 3-attempt worker budget of minutes-long renders,
-- so resets — never a campaign's first request — are capped per account per
-- hour. Default 3/h: a genuine transient failure clears within a retry or
-- two, and 3 resets bound one account to at most 9 worker attempts per hour
-- on top of the global concurrency cap.
INSERT INTO public.app_config (key, value)
VALUES ('media_render_retry_hourly_cap', '3')
ON CONFLICT (key) DO NOTHING;

-- ── 4. Membership predicate for the two client RPCs ──────────────────────
-- Who may ask for / look at a campaign's render: the campaign owner (the
-- Dater) or an active DATER_OWNER / INTRODUCER member. Relationship-derived,
-- per CLAUDE.md rule 7 — no role field anywhere.
CREATE FUNCTION private.can_manage_campaign_render(
  target_campaign_id UUID,
  target_user_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.campaigns campaign
     WHERE campaign.id = target_campaign_id
       AND campaign.owner_user_id = target_user_id
  )
  OR EXISTS (
    SELECT 1
      FROM public.campaign_memberships membership
     WHERE membership.campaign_id = target_campaign_id
       AND membership.user_id = target_user_id
       AND membership.status = 'active'
       AND membership.role IN ('DATER_OWNER', 'INTRODUCER')
  );
$$;

REVOKE ALL ON FUNCTION private.can_manage_campaign_render(UUID, UUID) FROM PUBLIC;

-- The pass predicate request/read share. Same product id and liveness test as
-- 0020/0042's get_campaign_pass_state, factored so the two callers here
-- cannot drift apart.
CREATE FUNCTION private.campaign_pass_active(target_campaign_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.campaign_entitlements entitlement
     WHERE entitlement.campaign_id = target_campaign_id
       AND entitlement.product_id = 'campaign_pass_30d_1999'
       AND entitlement.active
       AND (entitlement.expires_at IS NULL OR entitlement.expires_at > now())
  );
$$;

REVOKE ALL ON FUNCTION private.campaign_pass_active(UUID) FROM PUBLIC;

-- ── 5. request_pitch_render — the ONLY enqueue path (decision 2) ─────────
CREATE FUNCTION public.request_pitch_render(target_campaign_id UUID)
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
  --
  -- The sibling clause is the C1 gate lock ordering alone cannot provide:
  -- consumption happens at SUCCESS, so while the first render is in flight
  -- the unlock does not exist yet, and without it a newly approved revision
  -- would open a SECOND free render — two MP4s for one grant, no
  -- interleaving required. A terminally failed sibling blocks nothing (it
  -- consumed nothing); the retry of the job itself is governed in the failed
  -- branch below. An active Campaign Pass bypasses both facts: re-renders
  -- are exactly what it entitles.
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
        -- Reachable here too: approve B2 while B1 sits failed, request B2
        -- (free — a failed sibling blocks nothing), re-approve B1 and ask to
        -- reset it while B2 is live. Nothing is consumed yet, so the true
        -- fact is "in progress", never a pass demand.
        RAISE EXCEPTION 'a render for this campaign is already in progress';
      END IF;
      -- C2 (cost ceiling): each reset re-opens a 3-attempt worker budget
      -- (minutes of CPU per attempt), and while the free render is unspent
      -- the pass gate above does not bind — so resets are capped per account
      -- per hour. 0045/0053 advisory-lock pattern: lock the account bucket
      -- BEFORE counting so two concurrent resets cannot both pass the check.
      -- Seed 540055 (in use elsewhere: 0, 530001, 140039, 540054 — disjoint).
      -- A campaign's FIRST request never reaches this branch, so a normal
      -- export is never blocked; only the reset of a terminal failure is.
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
             last_error = NULL
       WHERE id = existing_job.id;
      RETURN QUERY
        SELECT existing_job.id, 'queued'::TEXT, approved.id, NULL::TEXT, true;
      RETURN;
    END IF;
    -- Idempotent cache hit: done, queued or leased — return it, write nothing.
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
    revision_id, campaign_id, pitch_draft_id, scene_hash, requested_by_user_id
  )
  VALUES (approved.id, campaign.id, campaign.pitch_draft_id, approved.scene_hash, caller)
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
      'free_render_spent', free_render_spent
    )
  );

  RETURN QUERY SELECT new_job_id, 'queued'::TEXT, approved.id, NULL::TEXT, false;
END;
$$;

REVOKE ALL ON FUNCTION public.request_pitch_render(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_pitch_render(UUID) TO authenticated;

COMMENT ON FUNCTION public.request_pitch_render(UUID) IS
  'Enqueues the MP4 render of the campaign''s current APPROVED revision, lazily, at export-request time. Idempotent per revision (the UNIQUE job is the cache). The campaign''s first render is free; once the free render is SPENT (unlock row, or a done sibling), another revision''s render — or the retry of a terminally failed one — requires an active Campaign Pass ("campaign pass required"). While a sibling render is merely queued or leased and nothing is consumed yet, the refusal is "a render for this campaign is already in progress" — never a pass demand, because waiting is free. Resets of a terminal failure are additionally capped per account per hour (media_render_retry_hourly_cap). Consumption itself happens at success, in complete_media_render_job.';

-- ── 6. get_pitch_render_state — the client read path ─────────────────────
-- The job tables are service-only, so members read through this projection:
-- the campaign's latest job (any revision), plus the two entitlement facts
-- the export UI needs. Never the queue internals, never another campaign.
CREATE FUNCTION public.get_pitch_render_state(target_campaign_id UUID)
RETURNS TABLE (
  job_id UUID,
  job_status TEXT,
  revision_id UUID,
  output_storage_path TEXT,
  last_error TEXT,
  free_render_used BOOLEAN,
  pass_active BOOLEAN,
  updated_at TIMESTAMPTZ
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
         job.updated_at
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
           NULL::TIMESTAMPTZ;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.get_pitch_render_state(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_pitch_render_state(UUID) TO authenticated;

COMMENT ON FUNCTION public.get_pitch_render_state(UUID) IS
  'One row for a campaign member: the latest render job (NULL job fields when none exists yet), whether the free render is spent, and whether the Campaign Pass is live. The only client-reachable read of the render tables.';

-- ── 7. claim / complete (service only, decisions 1, 4, 6) ────────────────
CREATE FUNCTION public.claim_media_render_job(lease_seconds INTEGER DEFAULT 900)
RETURNS TABLE (
  job_id UUID,
  lease_token UUID,
  campaign_id UUID,
  pitch_draft_id UUID,
  revision_id UUID,
  scene_hash TEXT,
  attempts INTEGER,
  lease_expires_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  -- Long enough for a 2-3 minute render plus upload on a small worker; short
  -- enough that a crashed worker's job is retried within the same sitting.
  effective_lease INTEGER := least(greatest(coalesce(lease_seconds, 900), 60), 3600);
  -- Three tries then stop (0050 precedent): a scene that fails three renders
  -- is a broken pipeline, and retrying forever hides it while burning CPU.
  max_attempts CONSTANT INTEGER := 3;
  concurrency_cap INTEGER;
  claimed media_render_jobs;
  issued_token UUID := gen_random_uuid();
  deadline TIMESTAMPTZ;
BEGIN
  -- Decision 6: the cap check and the claim are serialized, so two workers
  -- cannot both read "one slot left" and lease past the cap.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('media_render_claim', 540054)
  );
  SELECT coalesce(
           (SELECT value::INTEGER FROM app_config
             WHERE key = 'media_render_concurrency_cap'),
           2
         )
    INTO concurrency_cap;
  IF (
    SELECT count(*)
      FROM media_render_jobs job
     WHERE job.status = 'leased'
       AND job.lease_expires_at > now()
  ) >= concurrency_cap THEN
    RETURN;
  END IF;

  -- Decision 6: expiry and archive are one-way (0033), so their queued or
  -- lease-lapsed jobs are terminalized rather than left to rot. Paused
  -- campaigns are NOT touched — their jobs wait, unclaimable, for a resume.
  UPDATE media_render_jobs job
     SET status = 'failed',
         lease_token = NULL,
         leased_at = NULL,
         lease_expires_at = NULL,
         last_error = 'campaign is no longer renderable'
    FROM campaigns campaign
   WHERE campaign.id = job.campaign_id
     AND (
       job.status = 'queued'
       OR (job.status = 'leased' AND job.lease_expires_at <= now())
     )
     AND (
       campaign.status IN ('expired', 'archived')
       OR (campaign.ends_at IS NOT NULL AND campaign.ends_at <= now())
     );

  SELECT job.* INTO claimed
    FROM media_render_jobs job
    JOIN campaigns campaign ON campaign.id = job.campaign_id
   WHERE (
       job.status = 'queued'
       OR (job.status = 'leased' AND job.lease_expires_at <= now())
     )
     AND campaign.status = 'published'
     AND (campaign.ends_at IS NULL OR campaign.ends_at > now())
   ORDER BY job.created_at, job.id
   FOR UPDATE OF job SKIP LOCKED
   LIMIT 1;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF claimed.attempts >= max_attempts THEN
    -- Terminalize instead of handing it out again, and return no row: the
    -- caller loops, so the next call reaches the next claimable job. The free
    -- unlock is untouched (decision 4).
    UPDATE media_render_jobs
       SET status = 'failed',
           lease_token = NULL,
           leased_at = NULL,
           lease_expires_at = NULL,
           last_error = coalesce(claimed.last_error, 'render exceeded its retry budget')
     WHERE id = claimed.id;
    INSERT INTO ops_alerts (alert_type, campaign_id, detail)
    VALUES (
      'pitch_render_failed',
      claimed.campaign_id,
      jsonb_build_object(
        'render_job_id', claimed.id,
        'revision_id', claimed.revision_id,
        'reason', coalesce(claimed.last_error, 'render exceeded its retry budget')
      )
    );
    RETURN;
  END IF;

  deadline := now() + make_interval(secs => effective_lease);
  UPDATE media_render_jobs
     SET status = 'leased',
         attempts = claimed.attempts + 1,
         lease_token = issued_token,
         leased_at = now(),
         lease_expires_at = deadline
   WHERE id = claimed.id;

  RETURN QUERY
  SELECT claimed.id,
         issued_token,
         claimed.campaign_id,
         claimed.pitch_draft_id,
         claimed.revision_id,
         claimed.scene_hash,
         claimed.attempts + 1,
         deadline;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_media_render_job(INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_media_render_job(INTEGER) TO service_role;

COMMENT ON FUNCTION public.claim_media_render_job(INTEGER) IS
  'Leases one render job with FOR UPDATE SKIP LOCKED (precedent 0014:647) under the media_render_concurrency_cap. Only jobs of an open published campaign are claimable: paused campaigns'' jobs wait; expired/archived campaigns'' jobs are terminalized in the same call. Returns no row when nothing is claimable.';

CREATE FUNCTION public.complete_media_render_job(
  job_id UUID,
  lease_token UUID,
  outcome TEXT,
  output_storage_path TEXT DEFAULT NULL,
  output_bytes BIGINT DEFAULT NULL,
  output_duration_ms INTEGER DEFAULT NULL,
  reason TEXT DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  job media_render_jobs;
  clean_reason TEXT := nullif(btrim(coalesce(reason, '')), '');
  consumed_unlock_id UUID;
  gate_campaign_id UUID;
BEGIN
  IF outcome NOT IN ('succeeded', 'failed') THEN
    RAISE EXCEPTION 'render outcome must be succeeded or failed';
  END IF;

  -- C1 (lock order): every writer that judges or writes the free-render
  -- ledger takes the CAMPAIGN lock first — the same campaign -> job order
  -- request_pitch_render uses — so the two functions serialize. Locking only
  -- the job here would let a concurrent request read "no unlock yet" while
  -- this transaction is about to commit one, and a free render would slip
  -- past the pass gate. The job row is read WITHOUT a lock only to learn its
  -- campaign id (immutable by trigger), then both locks are taken in order
  -- and the lease is verified on the re-read, locked row.
  SELECT campaign_id INTO gate_campaign_id
    FROM media_render_jobs
   WHERE id = job_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'media render job not found';
  END IF;
  PERFORM 1 FROM campaigns WHERE id = gate_campaign_id FOR UPDATE;

  SELECT * INTO job
    FROM media_render_jobs
   WHERE id = job_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'media render job not found';
  END IF;
  -- The lease IS the authorization (0050 precedent): an expired holder's job
  -- may already belong to someone else, and must not overwrite their result.
  IF job.status <> 'leased'
     OR job.lease_token IS DISTINCT FROM complete_media_render_job.lease_token
     OR job.lease_expires_at <= now() THEN
    RAISE EXCEPTION 'media render lease is not held';
  END IF;

  IF outcome = 'succeeded' THEN
    IF complete_media_render_job.output_storage_path IS NULL
       OR complete_media_render_job.output_bytes IS NULL
       OR complete_media_render_job.output_duration_ms IS NULL THEN
      RAISE EXCEPTION 'a succeeded render must report its output path, bytes and duration';
    END IF;
    UPDATE media_render_jobs
       SET status = 'done',
           lease_token = NULL,
           leased_at = NULL,
           lease_expires_at = NULL,
           last_error = NULL,
           output_storage_path = complete_media_render_job.output_storage_path,
           output_bytes = complete_media_render_job.output_bytes,
           output_duration_ms = complete_media_render_job.output_duration_ms
     WHERE id = job.id;

    -- Decision 4: SUCCESS is the moment the free render is consumed. The
    -- UNIQUE campaign key makes a second success (a Pass-gated re-render, or
    -- a race) a structural no-op rather than a second consumption.
    INSERT INTO pitch_render_unlocks (campaign_id, render_job_id)
    VALUES (job.campaign_id, job.id)
    ON CONFLICT (campaign_id) DO NOTHING
    RETURNING id INTO consumed_unlock_id;

    INSERT INTO analytics_events (user_id, event_name, properties)
    VALUES (
      job.requested_by_user_id,
      'pitch_render_completed',
      jsonb_build_object(
        'campaign_id', job.campaign_id,
        'revision_id', job.revision_id,
        'free_render_consumed', consumed_unlock_id IS NOT NULL
      )
    );

  ELSE
    IF clean_reason IS NULL THEN
      RAISE EXCEPTION 'a failed render must carry the failure reason';
    END IF;
    -- Back to 'queued' while attempts remain: the next claim decides whether
    -- the budget is spent, so the retry rule lives in one place (0050).
    UPDATE media_render_jobs
       SET status = CASE WHEN job.attempts >= 3 THEN 'failed' ELSE 'queued' END,
           lease_token = NULL,
           leased_at = NULL,
           lease_expires_at = NULL,
           last_error = clean_reason
     WHERE id = job.id;
    IF job.attempts >= 3 THEN
      INSERT INTO ops_alerts (alert_type, campaign_id, detail)
      VALUES (
        'pitch_render_failed',
        job.campaign_id,
        jsonb_build_object(
          'render_job_id', job.id,
          'revision_id', job.revision_id,
          'reason', clean_reason
        )
      );
    END IF;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_media_render_job(
  UUID, UUID, TEXT, TEXT, BIGINT, INTEGER, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_media_render_job(
  UUID, UUID, TEXT, TEXT, BIGINT, INTEGER, TEXT
) TO service_role;

COMMENT ON FUNCTION public.complete_media_render_job(
  UUID, UUID, TEXT, TEXT, BIGINT, INTEGER, TEXT
) IS
  'Records a render result under a held lease. succeeded requires the complete output and consumes the campaign''s free render (ON CONFLICT no-op when already consumed); failed re-queues while attempts remain and terminalizes — with an ops alert and NO consumption — when the budget is spent.';
