-- Motion pitch Phase 3a (docs/MOTION_PITCH_PLAN_2026-07-29.md, 2026-07-30 user
-- caps U8-U11): a pitch may carry up to three short VIDEO CLIPS, and the
-- database owns their lifecycle — what may be registered, what a worker is
-- allowed to do with it, what makes one publishable, and what a flagged one
-- leaves behind.
--
-- SIX DECISIONS, each one a place where a reasonable reader expects something
-- else:
--
-- 1. THE DERIVATIVES LIVE IN THEIR OWN TABLE, NOT ON pitch_assets. Face boxes
--    are the reason. Face detection runs inside the ingest worker and stores
--    BOXES ONLY (no embedding, no identity, coordinates normalized 0..1), and
--    those boxes must never reach a client: they are a machine-readable map of
--    where a face is in a frame. Several read paths select pitch_assets with an
--    unqualified `select()` (packages/data consentRepo, publishedPitchRepo), so
--    a column added there would have travelled to the consent review projection
--    the day it existed. A separate table cannot leak through a projection that
--    does not name it — a structural guarantee instead of a documented promise.
--    The contract for the web worker is therefore: pitch_video_ingests is
--    service-role only, and no view or query that a browser can reach may
--    select face_boxes.
--
-- 2. ONE PREDICATE DECIDES READINESS. private.pitch_video_ingest_succeeded is
--    the only place that answers "may this clip be used?", and everything else
--    — the ready-id list the scene validator receives, the consent gate, the
--    tests — asks it. A clip is ready only at ingest_status 'succeeded', which
--    the table's own CHECK constraints tie to a silent proxy, a poster, a probe
--    result, a face-box array AND a deleted original. "Frame moderation passed"
--    is not a separate flag that could drift out of step: reaching 'succeeded'
--    is what passing means.
--
-- 3. REGISTRATION IS THE MOMENT EVERYTHING STARTS. Inserting a video
--    pitch_assets row creates its ingest row and its queue job in the same
--    statement, by trigger. Phase 1's lesson was that an object registered
--    later than it is uploaded is an object a sweep can delete; the same
--    reasoning applies to a job the client could forget to enqueue, so the
--    client cannot forget it.
--
-- 4. THE CLIP COUNT IS TWO LAYERS, AND THE PAID ONE IS SERVER-SIDE. The
--    absolute ceiling is 3 (schema, CHECK-adjacent trigger). Free tier 1 /
--    premium 3 is an entitlement read from the Campaign Pass ledger the same
--    way get_campaign_pass_state (0020) reads it. A route-level check would
--    have been a client-trusted paywall, which is exactly what rule 9 of
--    CLAUDE.md forbids. READ THE COMMENT ON
--    private.pitch_draft_video_allowance before touching it: the pass is scoped
--    to a published campaign, and a draft that has not published yet has none.
--
-- 5. A FLAGGED CLIP LEAVES A ROW A HUMAN CAN FIND. Frame moderation flagging is
--    the one outcome where the ORIGINAL is kept (review evidence) and the clip
--    can never be published. That is a moderation decision waiting to be made,
--    so it is a table with a disposition and a resolution, plus an ops_alerts
--    row on the existing alert surface — not a boolean nobody reads.
--
-- 6. v3 SHARES THE v2 VALIDATOR BRANCH. See the comment above the dispatch in
--    private.pitch_scene_violation: v3 is v2 plus one shot level, and a second
--    branch would have been a second copy of sixty bounds.
--
-- What this migration deliberately does NOT do (Phase 3b): put a clip into a
-- scene from the builder, replay one in a player, blur a face on consent, or
-- widen the include/exclude gates. approve_and_publish_pitch keeps its
-- photo-only include gate untouched.

-- ── 1. asset_type is a closed set ───────────────────────────────────────
-- pitch_assets.asset_type has been free text since 0001 while every writer in
-- the repo only ever wrote 'voice' or 'photo'. 'video' is the first new member
-- in the product's life, which makes this the moment to close the set: the
-- readiness predicate below is only meaningful if "a video asset" is a fact the
-- column can state. VALID, not NOT VALID: a hosted row carrying anything else
-- is a bug this migration should surface loudly rather than tolerate.
ALTER TABLE public.pitch_assets
  ADD CONSTRAINT pitch_assets_asset_type_check
    CHECK (asset_type IN ('voice', 'photo', 'video'));

COMMENT ON COLUMN public.pitch_assets.asset_type IS
  'voice (the Introducer original), photo, or video (a reviewed clip). For a video, storage_path names the ORIGINAL upload, which is deleted the moment ingest succeeds — read pitch_video_ingests for the paths that still exist.';

-- Shape of the face-box array, as a constraint rather than a convention: a
-- worker that wrote pixel coordinates (or a name) must fail the INSERT, because
-- nothing downstream re-checks these numbers before a blur is drawn from them.
CREATE FUNCTION private.face_boxes_are_normalized(boxes JSONB)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = public, extensions, pg_temp
AS $$
  SELECT boxes IS NULL
     OR (
       jsonb_typeof(boxes) = 'array'
       -- 15 sampled frames plus a poster cannot honestly produce hundreds of
       -- faces; a huge array is a bug or an attack, not a crowd.
       AND jsonb_array_length(boxes) <= 64
       AND NOT EXISTS (
         SELECT 1
           FROM jsonb_array_elements(boxes) AS box(value)
          WHERE NOT private.pitch_scene_keys_are(
                  box.value, ARRAY['x', 'y', 'width', 'height']
                )
             OR NOT private.pitch_scene_number_in(box.value -> 'x', 0, 1)
             OR NOT private.pitch_scene_number_in(box.value -> 'y', 0, 1)
             OR NOT private.pitch_scene_number_in(box.value -> 'width', 0, 1)
             OR NOT private.pitch_scene_number_in(box.value -> 'height', 0, 1)
       )
     );
$$;

REVOKE ALL ON FUNCTION private.face_boxes_are_normalized(JSONB) FROM PUBLIC;

COMMENT ON FUNCTION private.face_boxes_are_normalized(JSONB) IS
  'True when the value is NULL or an array of at most 64 boxes carrying exactly x, y, width and height, each between 0 and 1. Pixel coordinates, extra keys and identity fields are all refusals.';

-- ── 2. Ingest state and derivatives ─────────────────────────────────────
-- One row per video asset, created at registration. It holds the ingest verdict
-- and every path the pipeline produces; decision 1 above says why it is not
-- five more columns on pitch_assets.
--
-- THE PIPELINE, in the fixed order the worker must run it:
--   upload -> probe (mp4/mov, H264/HEVC, <=15s, <= the byte cap) -> SILENT
--   proxy (1080x1920 cover-fit, 30fps, h264, GOP 15, `-an` so the audio track is
--   structurally absent, `-map_metadata -1` so GPS never survives) -> poster
--   frame -> face detection (boxes only) -> frame moderation (1fps sample, <=15
--   frames plus the poster, through the provider budget ledger) -> success:
--   DELETE THE ORIGINAL and record the derivatives / flagged: keep the original
--   as evidence, publish nothing, open a review row.
--
-- The no-blur proxy is a PERMANENT derivative. The consent-time blur variant
-- (Phase 3b) is always generated FROM IT, never from the previous blur, so a
-- Dater who toggles blur twice does not accumulate generation loss — and it can
-- still be regenerated after the original is gone.
CREATE TABLE public.pitch_video_ingests (
  asset_id UUID PRIMARY KEY REFERENCES public.pitch_assets(id) ON DELETE CASCADE,
  -- Denormalized from the asset so the queue and the review list can be read
  -- and joined by draft without touching pitch_assets. Kept honest by the
  -- registration trigger, which is the only writer.
  pitch_draft_id UUID NOT NULL REFERENCES public.pitch_drafts(id) ON DELETE CASCADE,
  ingest_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (ingest_status IN ('pending', 'processing', 'succeeded', 'flagged', 'failed')),
  -- Derivatives. Storage paths including the bucket prefix, like
  -- pitch_assets.storage_path.
  proxy_path TEXT,
  poster_path TEXT,
  -- What the probe measured about the SOURCE. duration_ms is the authority a
  -- clip window is checked against; 15000 is the capture cap.
  duration_ms INTEGER CHECK (duration_ms > 0 AND duration_ms <= 15000),
  probe_width INTEGER CHECK (probe_width > 0),
  probe_height INTEGER CHECK (probe_height > 0),
  -- Boxes only, normalized 0..1 against the PROXY frame. No embedding, no
  -- identity, no name. Never exposed to a client (decision 1).
  face_boxes JSONB CHECK (private.face_boxes_are_normalized(face_boxes)),
  -- Set when the original upload has been deleted. Non-null is what makes
  -- "success deletes the original" auditable rather than assumed.
  original_deleted_at TIMESTAMPTZ,
  flagged_reason TEXT,
  failure_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Success is a COMPLETE result or it is not success. Every derivative the
  -- player and the consent surface need, plus the probe numbers, plus the
  -- face-box array (which may be empty — "detection ran and found no face" is a
  -- result), plus the deleted original.
  CONSTRAINT pitch_video_ingests_succeeded_is_complete CHECK (
    ingest_status <> 'succeeded'
    OR (
      proxy_path IS NOT NULL
      AND poster_path IS NOT NULL
      AND duration_ms IS NOT NULL
      AND probe_width IS NOT NULL
      AND probe_height IS NOT NULL
      AND face_boxes IS NOT NULL
      AND original_deleted_at IS NOT NULL
      AND flagged_reason IS NULL
    )
  ),
  -- A flagged clip is the ONE case where the original is kept: it is the
  -- evidence a human reviews. Deleting it would make the review a guess.
  CONSTRAINT pitch_video_ingests_flagged_keeps_evidence CHECK (
    ingest_status <> 'flagged'
    OR (flagged_reason IS NOT NULL AND original_deleted_at IS NULL)
  ),
  CONSTRAINT pitch_video_ingests_failed_has_reason CHECK (
    ingest_status <> 'failed' OR failure_reason IS NOT NULL
  )
);

COMMENT ON TABLE public.pitch_video_ingests IS
  'Ingest verdict and derivatives for one video pitch_asset. Service-role only: face_boxes must never reach a client, so no browser-reachable view or query may select from this table.';

COMMENT ON COLUMN public.pitch_video_ingests.face_boxes IS
  'Face BOXES only, normalized 0..1 against the proxy frame: [{"x":..,"y":..,"width":..,"height":..}, ...]. No embedding and no identity is computed or stored. An empty array means detection ran and found nothing.';

ALTER TABLE public.pitch_video_ingests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pitch_video_ingests FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pitch_video_ingests TO service_role;

CREATE INDEX pitch_video_ingests_draft_idx
  ON public.pitch_video_ingests (pitch_draft_id, ingest_status);

CREATE TRIGGER pitch_video_ingests_set_updated_at
BEFORE UPDATE ON public.pitch_video_ingests
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── The single readiness predicate (decision 2) ─────────────────────────
CREATE FUNCTION private.pitch_video_ingest_succeeded(target_asset_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.pitch_video_ingests ingest
     WHERE ingest.asset_id = target_asset_id
       AND ingest.ingest_status = 'succeeded'
  );
$$;

REVOKE ALL ON FUNCTION private.pitch_video_ingest_succeeded(UUID) FROM PUBLIC;

COMMENT ON FUNCTION private.pitch_video_ingest_succeeded(UUID) IS
  'THE readiness answer for a video asset. The succeeded state is reachable only through complete_media_ingest_job, which requires a passed frame-moderation verdict, a silent proxy, a poster, a probe result, face boxes and a deleted original — so this one boolean is what "this clip may be shown or published" means everywhere.';

-- Mirrors private.pitch_photos_validated (0036) for clips: every video among
-- the given asset ids has a succeeded ingest.
CREATE FUNCTION private.pitch_videos_validated(target_asset_ids UUID[])
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
  SELECT NOT EXISTS (
    SELECT 1
      FROM public.pitch_assets asset
     WHERE asset.id = ANY(target_asset_ids)
       AND asset.asset_type = 'video'
       AND NOT private.pitch_video_ingest_succeeded(asset.id)
  );
$$;

REVOKE ALL ON FUNCTION private.pitch_videos_validated(UUID[]) FROM PUBLIC;

-- The list the scene validator is handed. Ready clips of one draft, restricted
-- to a snapshot's asset ids, so a clip the Dater dropped is not in it.
CREATE FUNCTION private.pitch_ready_video_asset_ids(
  target_draft_id UUID,
  allowed_asset_ids UUID[]
)
RETURNS UUID[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
  SELECT coalesce(array_agg(asset.id ORDER BY asset.id), ARRAY[]::UUID[])
    FROM public.pitch_assets asset
   WHERE asset.pitch_draft_id = target_draft_id
     AND asset.asset_type = 'video'
     AND asset.id = ANY(coalesce(allowed_asset_ids, ARRAY[]::UUID[]))
     AND private.pitch_video_ingest_succeeded(asset.id);
$$;

REVOKE ALL ON FUNCTION private.pitch_ready_video_asset_ids(UUID, UUID[]) FROM PUBLIC;

COMMENT ON FUNCTION private.pitch_ready_video_asset_ids(UUID, UUID[]) IS
  'The clips a scene written onto this draft/snapshot may reference. A pending, flagged or failed clip is absent, which is how the scene validator refuses to store a timeline pointing at unmoderated footage.';

-- ── 4. The flagged-clip review queue (decision 5) ───────────────────────
-- A flagged clip is a moderation decision waiting for a human, so it is a row
-- with a disposition, not a boolean. The original is still in storage — that is
-- the evidence — and evidence_storage_path records exactly which object it is.
CREATE TABLE public.video_moderation_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id UUID NOT NULL UNIQUE REFERENCES public.pitch_assets(id) ON DELETE CASCADE,
  pitch_draft_id UUID NOT NULL REFERENCES public.pitch_drafts(id) ON DELETE CASCADE,
  flagged_reason TEXT NOT NULL,
  evidence_storage_path TEXT NOT NULL,
  disposition TEXT NOT NULL DEFAULT 'pending'
    CHECK (disposition IN ('pending', 'rejected', 'cleared')),
  resolved_at TIMESTAMPTZ,
  resolution_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT video_moderation_reviews_resolution_is_whole CHECK (
    (disposition = 'pending') = (resolved_at IS NULL)
  )
);

COMMENT ON TABLE public.video_moderation_reviews IS
  'One row per frame-moderation flag, service-role only. pending rows are the review queue; rejected keeps the clip unpublishable forever, cleared allows exactly one re-ingest.';

ALTER TABLE public.video_moderation_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.video_moderation_reviews FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.video_moderation_reviews TO service_role;

CREATE INDEX video_moderation_reviews_pending_idx
  ON public.video_moderation_reviews (disposition, created_at);

CREATE TRIGGER video_moderation_reviews_set_updated_at
BEFORE UPDATE ON public.video_moderation_reviews
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- The service read path. A function rather than a bare GRANT because the review
-- surface must never be able to select face_boxes along the way (decision 1).
CREATE FUNCTION public.list_pending_video_reviews(max_rows INTEGER DEFAULT 50)
RETURNS TABLE (
  review_id UUID,
  asset_id UUID,
  pitch_draft_id UUID,
  campaign_id UUID,
  draft_status TEXT,
  flagged_reason TEXT,
  evidence_storage_path TEXT,
  flagged_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
  SELECT review.id,
         review.asset_id,
         review.pitch_draft_id,
         campaign.id,
         draft.status::TEXT,
         review.flagged_reason,
         review.evidence_storage_path,
         review.created_at
    FROM public.video_moderation_reviews review
    JOIN public.pitch_drafts draft ON draft.id = review.pitch_draft_id
    LEFT JOIN public.campaigns campaign ON campaign.pitch_draft_id = review.pitch_draft_id
   WHERE review.disposition = 'pending'
   ORDER BY review.created_at, review.id
   LIMIT greatest(coalesce(max_rows, 50), 1);
$$;

REVOKE ALL ON FUNCTION public.list_pending_video_reviews(INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_pending_video_reviews(INTEGER) TO service_role;

COMMENT ON FUNCTION public.list_pending_video_reviews(INTEGER) IS
  'The flagged-clip review queue for the service moderation surface. campaign_id is non-null when the flagged clip belongs to a pitch that already published, which is the hook the existing pause/takedown actions take.';

CREATE FUNCTION public.resolve_video_moderation_review(
  review_id UUID,
  new_disposition TEXT,
  note TEXT DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  review video_moderation_reviews;
BEGIN
  IF new_disposition NOT IN ('rejected', 'cleared') THEN
    RAISE EXCEPTION 'disposition must be rejected or cleared';
  END IF;

  SELECT * INTO review
    FROM video_moderation_reviews
   WHERE id = review_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'video moderation review not found';
  END IF;
  IF review.disposition <> 'pending' THEN
    RAISE EXCEPTION 'video moderation review is already resolved';
  END IF;

  UPDATE video_moderation_reviews
     SET disposition = new_disposition,
         resolved_at = now(),
         resolution_note = nullif(btrim(note), '')
   WHERE id = review.id;

  IF new_disposition = 'cleared' THEN
    -- A human judged the frames acceptable, so the clip may be ingested once
    -- more — and only now, because the ingest transition trigger checks for
    -- exactly this row. attempts resets: the previous attempt was not a
    -- transport failure, so it should not spend the retry budget.
    UPDATE pitch_video_ingests
       SET ingest_status = 'pending',
           flagged_reason = NULL
     WHERE asset_id = review.asset_id;
    UPDATE media_ingest_jobs
       SET status = 'queued',
           attempts = 0,
           lease_token = NULL,
           leased_at = NULL,
           lease_expires_at = NULL,
           last_error = NULL
     WHERE asset_id = review.asset_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION
  public.resolve_video_moderation_review(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  public.resolve_video_moderation_review(UUID, TEXT, TEXT) TO service_role;

COMMENT ON FUNCTION public.resolve_video_moderation_review(UUID, TEXT, TEXT) IS
  'Records the human disposition of a flagged clip. rejected leaves the clip permanently unpublishable and its original retained; cleared re-queues exactly one ingest attempt. Takedown of an already published campaign stays with the existing campaign pause/moderation actions, which read campaign_id from list_pending_video_reviews.';

-- ── 3. The ingest job queue ─────────────────────────────────────────────
-- A lease queue, not a status column: ingest is minutes of ffmpeg and provider
-- calls in a worker that can die halfway. The lease follows the
-- FOR UPDATE SKIP LOCKED precedent at 0014_commerce_state_machine.sql:647, and
-- claim/complete are the only writers — both SECURITY DEFINER and granted to
-- service_role alone.
--
-- The job's status is its LIFECYCLE ('done' means the worker finished), never
-- the verdict. The verdict lives on pitch_video_ingests, so there is exactly one
-- place to read "may this clip be used?".
CREATE TABLE public.media_ingest_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- One job per asset, for the life of the asset. A retry re-queues this row
  -- rather than inserting a second one, so "how many times has this clip been
  -- attempted?" has one answer.
  asset_id UUID NOT NULL UNIQUE REFERENCES public.pitch_assets(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'leased', 'done', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  lease_token UUID,
  leased_at TIMESTAMPTZ,
  lease_expires_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- A lease is a token AND a deadline, or it is nothing. Half a lease would let
  -- two workers hold the same job.
  CONSTRAINT media_ingest_jobs_lease_is_whole CHECK (
    (status = 'leased') = (lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
  )
);

COMMENT ON TABLE public.media_ingest_jobs IS
  'Lease queue for video ingest, service-role only. status is the job lifecycle; the ingest verdict is pitch_video_ingests.ingest_status.';

ALTER TABLE public.media_ingest_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.media_ingest_jobs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.media_ingest_jobs TO service_role;

CREATE INDEX media_ingest_jobs_claimable_idx
  ON public.media_ingest_jobs (status, created_at, id);

CREATE TRIGGER media_ingest_jobs_set_updated_at
BEFORE UPDATE ON public.media_ingest_jobs
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- The state machine, as a BEFORE trigger so it holds for every writer including
-- a future RPC and a hand-written service query. Legal moves:
--
--   (insert)        -> queued            registration only
--   queued          -> leased            claim
--   leased          -> leased            re-claim, ONLY after the lease expired
--   leased          -> queued            release for retry
--   leased          -> done | failed     the worker finished
--   queued          -> failed            retry budget exhausted at claim time
--   done | failed   -> queued            ONLY behind a cleared moderation review
--
-- The last one is the only way back out of a terminal state, and it is not a
-- worker's decision: a human has to have cleared the flag first, which is what
-- stops a retry loop from grinding a refused clip through moderation again.
CREATE FUNCTION private.enforce_media_ingest_job_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'queued' THEN
      RAISE EXCEPTION 'media ingest job must be created queued';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.asset_id IS DISTINCT FROM OLD.asset_id THEN
    RAISE EXCEPTION 'media ingest job asset is immutable';
  END IF;
  IF NEW.status = OLD.status AND NEW.status <> 'leased' THEN
    RETURN NEW;
  END IF;

  CASE
    WHEN OLD.status = 'queued' AND NEW.status IN ('leased', 'failed') THEN
      NULL;
    WHEN OLD.status IN ('done', 'failed') AND NEW.status = 'queued' THEN
      IF NOT EXISTS (
        SELECT 1
          FROM public.video_moderation_reviews review
         WHERE review.asset_id = NEW.asset_id
           AND review.disposition = 'cleared'
      ) THEN
        RAISE EXCEPTION
          'a finished ingest job may only be re-queued by a cleared moderation review';
      END IF;
    WHEN OLD.status = 'leased' AND NEW.status IN ('queued', 'done', 'failed') THEN
      NULL;
    WHEN OLD.status = 'leased' AND NEW.status = 'leased' THEN
      -- Issuing a NEW token over a live lease is the double-worker bug this
      -- table exists to prevent. An update that keeps the same token is the
      -- holder annotating its own job, which is allowed.
      IF NEW.lease_token IS DISTINCT FROM OLD.lease_token
         AND OLD.lease_expires_at > now() THEN
        RAISE EXCEPTION 'media ingest job lease is still held';
      END IF;
    ELSE
      RAISE EXCEPTION 'media ingest job cannot move from % to %', OLD.status, NEW.status;
  END CASE;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.enforce_media_ingest_job_transition() FROM PUBLIC;

CREATE TRIGGER media_ingest_jobs_enforce_transition
BEFORE INSERT OR UPDATE ON public.media_ingest_jobs
FOR EACH ROW EXECUTE FUNCTION private.enforce_media_ingest_job_transition();

-- Ingest status moves under the same discipline, and for the same reason: a
-- 'succeeded' row must never be walked back to 'processing' by a late retry of
-- a worker that already reported.
CREATE FUNCTION private.enforce_pitch_video_ingest_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  IF NEW.asset_id IS DISTINCT FROM OLD.asset_id
     OR NEW.pitch_draft_id IS DISTINCT FROM OLD.pitch_draft_id THEN
    RAISE EXCEPTION 'video ingest identity is immutable';
  END IF;
  IF NEW.ingest_status = OLD.ingest_status THEN
    RETURN NEW;
  END IF;
  CASE
    WHEN OLD.ingest_status = 'pending' AND NEW.ingest_status IN ('processing', 'failed') THEN
      NULL;
    WHEN OLD.ingest_status = 'processing'
      AND NEW.ingest_status IN ('pending', 'succeeded', 'flagged', 'failed') THEN
      NULL;
    WHEN OLD.ingest_status = 'failed'
      AND NEW.ingest_status IN ('pending', 'processing') THEN
      -- A transport failure may be retried, and the retrying claim moves this
      -- row straight to 'processing'. A FLAGGED verdict may not be re-run by a
      -- worker; only a human disposition re-queues one.
      NULL;
    WHEN OLD.ingest_status = 'flagged' AND NEW.ingest_status = 'pending' THEN
      IF NOT EXISTS (
        SELECT 1
          FROM public.video_moderation_reviews review
         WHERE review.asset_id = NEW.asset_id
           AND review.disposition = 'cleared'
      ) THEN
        RAISE EXCEPTION 'a flagged clip may only be re-ingested after a review clears it';
      END IF;
    WHEN OLD.ingest_status = 'succeeded' THEN
      RAISE EXCEPTION 'a succeeded video ingest is final';
    ELSE
      RAISE EXCEPTION 'video ingest cannot move from % to %',
        OLD.ingest_status, NEW.ingest_status;
  END CASE;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.enforce_pitch_video_ingest_transition() FROM PUBLIC;

CREATE TRIGGER pitch_video_ingests_enforce_transition
BEFORE UPDATE ON public.pitch_video_ingests
FOR EACH ROW EXECUTE FUNCTION private.enforce_pitch_video_ingest_transition();

-- ── 5. claim / complete (service only) ──────────────────────────────────
CREATE FUNCTION public.claim_media_ingest_job(lease_seconds INTEGER DEFAULT 600)
RETURNS TABLE (
  job_id UUID,
  lease_token UUID,
  asset_id UUID,
  pitch_draft_id UUID,
  storage_path TEXT,
  attempts INTEGER,
  lease_expires_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  -- Long enough for a 15s clip to probe, transcode, sample and moderate on a
  -- small worker; short enough that a crashed worker's job is retried inside a
  -- consent review rather than the next day.
  effective_lease INTEGER := least(greatest(coalesce(lease_seconds, 600), 30), 3600);
  -- Three tries then stop. A clip that fails three times is a broken file or a
  -- broken pipeline, and either way retrying forever hides it.
  max_attempts CONSTANT INTEGER := 3;
  claimed media_ingest_jobs;
  issued_token UUID := gen_random_uuid();
  deadline TIMESTAMPTZ;
BEGIN
  SELECT * INTO claimed
    FROM media_ingest_jobs job
   WHERE job.status = 'queued'
      OR (job.status = 'leased' AND job.lease_expires_at <= now())
   ORDER BY job.created_at, job.id
   FOR UPDATE SKIP LOCKED
   LIMIT 1;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF claimed.attempts >= max_attempts THEN
    -- Terminalize instead of handing it out again, and return no row: the
    -- caller loops, so the next call reaches the next claimable job.
    UPDATE media_ingest_jobs
       SET status = 'failed',
           lease_token = NULL,
           leased_at = NULL,
           lease_expires_at = NULL,
           last_error = coalesce(claimed.last_error, 'ingest exceeded its retry budget')
     WHERE id = claimed.id;
    UPDATE pitch_video_ingests
       SET ingest_status = 'failed',
           failure_reason = coalesce(
             nullif(btrim(coalesce(claimed.last_error, '')), ''),
             'ingest exceeded its retry budget'
           )
     WHERE asset_id = claimed.asset_id
       AND ingest_status IN ('pending', 'processing');
    RETURN;
  END IF;

  deadline := now() + make_interval(secs => effective_lease);
  UPDATE media_ingest_jobs
     SET status = 'leased',
         attempts = claimed.attempts + 1,
         lease_token = issued_token,
         leased_at = now(),
         lease_expires_at = deadline
   WHERE id = claimed.id;
  UPDATE pitch_video_ingests
     SET ingest_status = 'processing'
   WHERE asset_id = claimed.asset_id
     AND ingest_status IN ('pending', 'failed');

  RETURN QUERY
  SELECT claimed.id,
         issued_token,
         claimed.asset_id,
         ingest.pitch_draft_id,
         asset.storage_path,
         claimed.attempts + 1,
         deadline
    FROM pitch_video_ingests ingest
    JOIN pitch_assets asset ON asset.id = ingest.asset_id
   WHERE ingest.asset_id = claimed.asset_id;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_media_ingest_job(INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_media_ingest_job(INTEGER) TO service_role;

COMMENT ON FUNCTION public.claim_media_ingest_job(INTEGER) IS
  'Leases one ingest job with FOR UPDATE SKIP LOCKED (precedent 0014:647), incrementing attempts. Returns no row when nothing is claimable, including when the job at the head of the queue has spent its three attempts — that job is terminalized in the same call.';

CREATE FUNCTION public.complete_media_ingest_job(
  job_id UUID,
  lease_token UUID,
  outcome TEXT,
  proxy_path TEXT DEFAULT NULL,
  poster_path TEXT DEFAULT NULL,
  duration_ms INTEGER DEFAULT NULL,
  probe_width INTEGER DEFAULT NULL,
  probe_height INTEGER DEFAULT NULL,
  face_boxes JSONB DEFAULT NULL,
  original_deleted BOOLEAN DEFAULT false,
  reason TEXT DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  job media_ingest_jobs;
  asset pitch_assets;
  clean_reason TEXT := nullif(btrim(coalesce(reason, '')), '');
BEGIN
  IF outcome NOT IN ('succeeded', 'flagged', 'failed') THEN
    RAISE EXCEPTION 'ingest outcome must be succeeded, flagged or failed';
  END IF;

  SELECT * INTO job
    FROM media_ingest_jobs
   WHERE id = job_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'media ingest job not found';
  END IF;
  -- The lease IS the authorization: a worker whose lease expired has had its
  -- job handed to someone else, and must not be able to overwrite that
  -- worker's result.
  IF job.status <> 'leased'
     OR job.lease_token IS DISTINCT FROM complete_media_ingest_job.lease_token
     OR job.lease_expires_at <= now() THEN
    RAISE EXCEPTION 'media ingest lease is not held';
  END IF;

  SELECT * INTO asset FROM pitch_assets WHERE id = job.asset_id;

  IF outcome = 'succeeded' THEN
    -- 2026-07-30 U9: the original is deleted the moment ingest succeeds. The
    -- worker asserts it here, and the row cannot say 'succeeded' without it, so
    -- "we delete the original" is a database invariant rather than a promise in
    -- a runbook.
    IF original_deleted IS NOT TRUE THEN
      RAISE EXCEPTION 'a succeeded ingest must have deleted the original upload';
    END IF;
    IF proxy_path IS NULL OR poster_path IS NULL OR duration_ms IS NULL
       OR probe_width IS NULL OR probe_height IS NULL OR face_boxes IS NULL THEN
      RAISE EXCEPTION 'a succeeded ingest must report every derivative it produced';
    END IF;
    UPDATE pitch_video_ingests
       SET ingest_status = 'succeeded',
           proxy_path = complete_media_ingest_job.proxy_path,
           poster_path = complete_media_ingest_job.poster_path,
           duration_ms = complete_media_ingest_job.duration_ms,
           probe_width = complete_media_ingest_job.probe_width,
           probe_height = complete_media_ingest_job.probe_height,
           face_boxes = complete_media_ingest_job.face_boxes,
           original_deleted_at = now(),
           flagged_reason = NULL,
           failure_reason = NULL
     WHERE asset_id = job.asset_id;
    UPDATE media_ingest_jobs
       SET status = 'done',
           lease_token = NULL,
           leased_at = NULL,
           lease_expires_at = NULL,
           last_error = NULL
     WHERE id = job.id;

  ELSIF outcome = 'flagged' THEN
    IF clean_reason IS NULL THEN
      RAISE EXCEPTION 'a flagged ingest must carry the moderation reason';
    END IF;
    UPDATE pitch_video_ingests
       SET ingest_status = 'flagged',
           flagged_reason = clean_reason,
           -- The derivatives of flagged footage are not kept: nothing may be
           -- published from it, and the original is the only evidence a review
           -- needs.
           proxy_path = NULL,
           poster_path = NULL,
           face_boxes = NULL,
           original_deleted_at = NULL,
           duration_ms = complete_media_ingest_job.duration_ms,
           probe_width = complete_media_ingest_job.probe_width,
           probe_height = complete_media_ingest_job.probe_height
     WHERE asset_id = job.asset_id;
    UPDATE media_ingest_jobs
       SET status = 'done',
           lease_token = NULL,
           leased_at = NULL,
           lease_expires_at = NULL,
           last_error = clean_reason
     WHERE id = job.id;
    -- §9: a flagged clip leaves a row a human can find, on both the review
    -- queue and the existing ops alert surface.
    INSERT INTO video_moderation_reviews (
      asset_id, pitch_draft_id, flagged_reason, evidence_storage_path
    )
    VALUES (job.asset_id, asset.pitch_draft_id, clean_reason, asset.storage_path)
    ON CONFLICT (asset_id) DO UPDATE
      SET flagged_reason = EXCLUDED.flagged_reason,
          evidence_storage_path = EXCLUDED.evidence_storage_path,
          disposition = 'pending',
          resolved_at = NULL,
          resolution_note = NULL;
    INSERT INTO ops_alerts (alert_type, campaign_id, detail)
    SELECT 'video_frame_moderation_flagged',
           (SELECT id FROM campaigns WHERE pitch_draft_id = asset.pitch_draft_id),
           jsonb_build_object(
             'pitch_asset_id', job.asset_id,
             'pitch_draft_id', asset.pitch_draft_id,
             'reason', clean_reason
           );

  ELSE
    IF clean_reason IS NULL THEN
      RAISE EXCEPTION 'a failed ingest must carry the failure reason';
    END IF;
    UPDATE pitch_video_ingests
       SET ingest_status = 'failed',
           failure_reason = clean_reason
     WHERE asset_id = job.asset_id;
    -- Back to 'queued' while attempts remain: the next claim decides whether
    -- the budget is spent, so the retry rule lives in one place.
    UPDATE media_ingest_jobs
       SET status = CASE WHEN job.attempts >= 3 THEN 'failed' ELSE 'queued' END,
           lease_token = NULL,
           leased_at = NULL,
           lease_expires_at = NULL,
           last_error = clean_reason
     WHERE id = job.id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION
  public.complete_media_ingest_job(
    UUID, UUID, TEXT, TEXT, TEXT, INTEGER, INTEGER, INTEGER, JSONB, BOOLEAN, TEXT
  ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  public.complete_media_ingest_job(
    UUID, UUID, TEXT, TEXT, TEXT, INTEGER, INTEGER, INTEGER, JSONB, BOOLEAN, TEXT
  ) TO service_role;

COMMENT ON FUNCTION public.complete_media_ingest_job(
  UUID, UUID, TEXT, TEXT, TEXT, INTEGER, INTEGER, INTEGER, JSONB, BOOLEAN, TEXT
) IS
  'Records an ingest result under a held lease. succeeded requires every derivative AND a deleted original; flagged requires a reason, keeps the original as evidence, drops the derivatives and opens a review row plus an ops alert; failed re-queues while attempts remain.';

-- ── 6. Registration: rows, counts, and the paid tier ────────────────────
-- Enqueue at registration (decision 3). The ingest row and the job are created
-- by the same statement that registers the asset, so an uploaded clip is never
-- an object nobody is going to process.
CREATE FUNCTION private.enqueue_video_ingest()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  IF NEW.asset_type <> 'video' THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.pitch_video_ingests (asset_id, pitch_draft_id)
  VALUES (NEW.id, NEW.pitch_draft_id);
  INSERT INTO public.media_ingest_jobs (asset_id) VALUES (NEW.id);
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.enqueue_video_ingest() FROM PUBLIC;

CREATE TRIGGER pitch_assets_enqueue_video_ingest
AFTER INSERT ON public.pitch_assets
FOR EACH ROW EXECUTE FUNCTION private.enqueue_video_ingest();

-- How many clips this draft is entitled to (decision 4).
--
-- READ THIS BEFORE CHANGING IT. The Campaign Pass is scoped to a CAMPAIGN, and
-- a campaign exists only from the moment the Dater approves and publishes —
-- while clip registration happens BEFORE that, in draft or consent review. So
-- on today's flow the paid branch is only reachable for a pitch whose campaign
-- already exists, and an ordinary first-time draft gets the free allowance of
-- one clip. That is the pinned pattern (0020 get_campaign_pass_state) applied
-- honestly rather than a paywall faked at the route, and the gap between it and
-- "premium 3" is a product decision — a draft-scoped pass, or clip registration
-- after publish — not something this function should invent.
CREATE FUNCTION private.pitch_draft_video_allowance(target_draft_id UUID)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
  SELECT CASE
    WHEN EXISTS (
      SELECT 1
        FROM public.campaigns campaign
        JOIN public.campaign_entitlements entitlement
          ON entitlement.campaign_id = campaign.id
       WHERE campaign.pitch_draft_id = target_draft_id
         AND entitlement.product_id = 'campaign_pass_30d_1999'
         AND entitlement.active
         AND (entitlement.expires_at IS NULL OR entitlement.expires_at > now())
    ) THEN 3
    ELSE 1
  END;
$$;

REVOKE ALL ON FUNCTION private.pitch_draft_video_allowance(UUID) FROM PUBLIC;

COMMENT ON FUNCTION private.pitch_draft_video_allowance(UUID) IS
  'Clips this draft may register: 3 while its campaign holds an active Campaign Pass, otherwise the free allowance of 1. A layer above the absolute ceiling of 3, never a replacement for it.';

-- Both count layers, as a BEFORE trigger so they hold on every write path —
-- the two RLS insert policies, a service-role script, and any future RPC.
CREATE FUNCTION private.enforce_pitch_video_limits()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  existing_videos INTEGER;
  allowance INTEGER;
BEGIN
  IF NEW.asset_type <> 'video' THEN
    RETURN NEW;
  END IF;
  -- The same draft lock private.can_upload_pitch_media takes, so two concurrent
  -- registrations cannot both read "one clip so far".
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(NEW.pitch_draft_id::TEXT, 0)
  );
  SELECT count(*) INTO existing_videos
    FROM public.pitch_assets
   WHERE pitch_draft_id = NEW.pitch_draft_id
     AND asset_type = 'video';

  IF existing_videos + 1 > 3 THEN
    RAISE EXCEPTION 'a pitch may carry at most 3 video clips';
  END IF;
  allowance := private.pitch_draft_video_allowance(NEW.pitch_draft_id);
  IF existing_videos + 1 > allowance THEN
    RAISE EXCEPTION 'a second video clip requires a Campaign Pass';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.enforce_pitch_video_limits() FROM PUBLIC;

CREATE TRIGGER pitch_assets_enforce_video_limits
BEFORE INSERT ON public.pitch_assets
FOR EACH ROW EXECUTE FUNCTION private.enforce_pitch_video_limits();

-- The Dater may upload their own clip during consent review, exactly as they may
-- upload their own photo (0032). The clip they add is theirs, and refusing it
-- would make the consent surface a place where only the Introducer's footage can
-- appear.
DROP POLICY pitch_assets_insert_subject ON public.pitch_assets;
CREATE POLICY pitch_assets_insert_subject ON public.pitch_assets
  FOR INSERT WITH CHECK (
    auth.uid() = uploaded_by_user_id
    AND asset_type IN ('photo', 'video')
    AND EXISTS (
      SELECT 1
        FROM public.pitch_drafts draft
       WHERE draft.id = pitch_draft_id
         AND draft.subject_user_id = auth.uid()
         AND draft.status = 'consent_pending'
    )
  );

-- A draft may not enter consent review while it carries a clip whose frames were
-- FLAGGED. Phase 3a shows clips on the consent surface (poster plus a silent
-- preview), so submitting one would show the Dater exactly the frames moderation
-- refused. Flag-independent, unlike the media_validations gates: a flagged
-- verdict is evidence that already exists, not an enforcement policy being
-- rolled out. A trigger rather than a line in the RPC, so it survives the next
-- redefinition of submit_pitch_for_consent.
CREATE FUNCTION private.reject_flagged_video_on_consent()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  IF NEW.status = 'consent_pending'
     AND OLD.status IS DISTINCT FROM 'consent_pending'
     AND EXISTS (
       SELECT 1
         FROM public.pitch_video_ingests ingest
        WHERE ingest.pitch_draft_id = NEW.id
          AND ingest.ingest_status = 'flagged'
     ) THEN
    RAISE EXCEPTION 'remove the flagged video clip before requesting consent';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.reject_flagged_video_on_consent() FROM PUBLIC;

CREATE TRIGGER pitch_drafts_reject_flagged_video
BEFORE UPDATE ON public.pitch_drafts
FOR EACH ROW EXECUTE FUNCTION private.reject_flagged_video_on_consent();

-- ── 7. The per-draft object quota: 12 -> 20 ─────────────────────────────
-- 0025 capped a draft's pitch-media prefix at 12 objects, which was one object
-- per client upload. Ingest makes the prefix hold DERIVATIVES too, and
-- private.pitch_media_object_count counts every object under the prefix
-- (service-written ones included), so the old ceiling would start refusing the
-- Dater's fifth photo as soon as three clips were processed.
--
-- THE ARITHMETIC, spelled out because a constant that happens to fit is a
-- constant nobody can re-derive later:
--
--   voice original                                        1
--   photos (four, the builder's ladder input)             4
--   silent proxies, one per clip (three clips maximum)    3
--   poster frames, one per clip                           3
--   consent blur variants, one per clip (Phase 3b)        3
--                                                       ---
--   steady state                                         14
--   plus the three originals, which exist only between
--   registration and the moment each ingest succeeds     +3
--                                                       ---
--   transitional peak                                    17
--
-- 20 is that peak plus three objects of headroom, which is the one thing 17
-- would not survive: a re-upload landing before a sweep removed the object it
-- replaced.
DROP POLICY objects_insert_pitch_creators ON storage.objects;
CREATE POLICY objects_insert_pitch_creators ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'pitch-media'
    AND private.is_active_account(auth.uid())
    AND private.can_upload_pitch_media(private.pitch_media_draft_id(name))
    AND private.pitch_media_object_count(private.pitch_media_draft_id(name)) < 20
  );

-- ── 8. Scene validation: the v3 clip shot ───────────────────────────────
-- The wordPop rules, moved verbatim out of the photo branch of
-- private.pitch_scene_violation so that the clip branch can pay exactly the
-- same ones. A clip may carry a wordPop and nothing else, and "the same rules"
-- has to be a shared implementation rather than a comment: two copies would
-- have let a clip's wordPop drift into a different range from a photo's.
--
-- Every message here is pinned by supabase/tests/25_motion_scene_v2.sql and
-- mapped to Dater-facing copy by the web and mobile clients.
CREATE FUNCTION private.pitch_scene_word_pop_violation(
  effect JSONB,
  shot_start_ms BIGINT,
  shot_end_ms BIGINT,
  segment_count INTEGER,
  word_count INTEGER
)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  easings CONSTANT TEXT[] := ARRAY['linear', 'easeIn', 'easeOut', 'easeInOut'];
  word_ref JSONB;
  effect_start_ms BIGINT;
  effect_end_ms BIGINT;
BEGIN
  IF NOT private.pitch_scene_keys_are(
       effect, ARRAY['type', 'word', 'startMs', 'endMs', 'scale', 'easing']
     ) THEN
    RETURN 'pitch scene wordPop must carry only type, word, startMs, endMs, scale and easing';
  END IF;
  IF NOT private.pitch_scene_token(effect -> 'easing', easings) THEN
    RETURN 'pitch scene easing must be linear, easeIn, easeOut or easeInOut';
  END IF;
  word_ref := effect -> 'word';
  IF NOT private.pitch_scene_keys_are(word_ref, ARRAY['segmentIndex', 'wordIndex'])
     OR NOT private.pitch_scene_integer_in(word_ref -> 'segmentIndex', 0, 999)
     OR NOT private.pitch_scene_integer_in(word_ref -> 'wordIndex', 0, 999) THEN
    RETURN 'pitch scene wordPop must reference a word by segmentIndex and wordIndex';
  END IF;
  IF NOT private.pitch_scene_integer_in(effect -> 'startMs', 0, 600000)
     OR NOT private.pitch_scene_integer_in(effect -> 'endMs', 0, 600000)
     OR NOT private.pitch_scene_number_in(effect -> 'scale', 1, 1.6) THEN
    RETURN 'pitch scene wordPop must carry whole millisecond times and a scale between 1x and 1.6x';
  END IF;
  effect_start_ms := private.pitch_scene_integer(effect -> 'startMs');
  effect_end_ms := private.pitch_scene_integer(effect -> 'endMs');
  IF effect_start_ms < shot_start_ms OR effect_end_ms > shot_end_ms THEN
    RETURN 'pitch scene wordPop must start and end inside its own shot';
  END IF;
  IF effect_end_ms - effect_start_ms < 120
     OR effect_end_ms - effect_start_ms > 1200 THEN
    RETURN 'pitch scene wordPop must last between 120ms and 1200ms';
  END IF;
  -- Gap (a): a recording transcribed before word timings existed has nothing for
  -- the player to lift, so a wordPop on it is a claim about an accent that can
  -- never land.
  IF word_count < 1 THEN
    RETURN 'pitch scene may not lift a word from a recording with no word timings';
  END IF;
  -- wordIndex counts inside its segment, so the flat word list is only an upper
  -- bound — which is all the database can prove, and enough to stop a nonsense
  -- index from being stored.
  IF private.pitch_scene_integer(word_ref -> 'segmentIndex') >= segment_count
     OR private.pitch_scene_integer(word_ref -> 'wordIndex') >= word_count THEN
    RETURN 'pitch scene wordPop references a word outside the transcript';
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION
  private.pitch_scene_word_pop_violation(JSONB, BIGINT, BIGINT, INTEGER, INTEGER)
  FROM PUBLIC;

COMMENT ON FUNCTION
  private.pitch_scene_word_pop_violation(JSONB, BIGINT, BIGINT, INTEGER, INTEGER) IS
  'NULL when the wordPop is storable, otherwise the pinned rejection message. Shared by the photo and clip branches of private.pitch_scene_violation so a word accent costs the same on both.';

-- The validator gains a v3 branch and a SIXTH argument: the clips of the row the
-- scene is being written onto. A clip reference is the third thing a scene
-- cannot prove about itself (after a transcript word and a structure field), and
-- it is the one with teeth — an unmoderated clip must not become part of an
-- approved timeline.
--
-- The 5-argument form is DROPPED rather than kept as a wrapper, for the reason
-- 0049 gives about its own predecessor: a wrapper would be a call path where a
-- v3 scene is judged with NO clip list, and every clip reference in it would
-- then be refused or, worse, waved through by a later edit to this file. Both
-- helpers are private and REVOKEd from PUBLIC, so nothing outside these
-- migrations calls them.
DROP FUNCTION private.pitch_scene_violation(JSONB, INTEGER, UUID[], JSONB, JSONB);

CREATE FUNCTION private.pitch_scene_violation(
  scene JSONB,
  duration_ms_expected INTEGER,
  photo_asset_ids UUID[],
  transcript JSONB,
  structure JSONB,
  video_asset_ids UUID[]
)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  -- Canonical dashed form only. PostgreSQL's UUID input also accepts braces and
  -- unseparated hex, which would let one asset appear under several spellings
  -- and produce different scene hashes.
  uuid_pattern CONSTANT TEXT :=
    '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  easings CONSTANT TEXT[] := ARRAY['linear', 'easeIn', 'easeOut', 'easeInOut'];
  text_sources CONSTANT TEXT[] := ARRAY[
    'hook', 'relationship_context', 'quality:0', 'quality:1', 'quality:2',
    'evidence_or_anecdote', 'good_match_for'
  ];
  slack CONSTANT NUMERIC := 1e-9;
  -- Mirrors MIN_FLASH_INTERVAL_MS = ceil(1000 / MAX_FLICKER_HZ).
  min_flash_interval_ms CONSTANT BIGINT := 334;

  canvas JSONB;
  entries JSONB;
  entry JSONB;
  entry_count INTEGER;
  entry_index INTEGER;
  start_ms BIGINT;
  end_ms BIGINT;
  previous_end BIGINT := 0;
  entry_asset_id UUID;
  seen_asset_ids UUID[] := ARRAY[]::UUID[];
  photos UUID[] := coalesce(photo_asset_ids, ARRAY[]::UUID[]);
  -- The clips this scene may reference: video assets of the row being written
  -- whose ingest SUCCEEDED. The caller builds the list, so this function stays
  -- a pure predicate over its arguments.
  videos UUID[] := coalesce(video_asset_ids, ARRAY[]::UUID[]);
  scene_version INTEGER;
  is_v3 BOOLEAN := false;
  clip_ids UUID[];
  used_clip_ids UUID[] := ARRAY[]::UUID[];
  clip_shot_count INTEGER := 0;
  clip_asset_id UUID;
  clip_key TEXT;
  clip_in_ms BIGINT;
  clip_out_ms BIGINT;
  clip_window_ms BIGINT;
  clip_held_ms BIGINT;
  clip_window JSONB;
  -- assetId -> [[clipInMs, clipOutMs], ...] and assetId -> milliseconds held.
  -- Two accumulators rather than one because they answer different questions:
  -- overlap is per pair of windows, the 10s cap is per clip.
  clip_windows JSONB := '{}'::JSONB;
  clip_usage JSONB := '{}'::JSONB;
  violation_message TEXT;

  duration BIGINT;
  shot JSONB;
  shot_level TEXT;
  shot_count INTEGER;
  shot_index INTEGER;
  text_card JSONB;
  min_size NUMERIC;
  crop_message TEXT;
  tightest NUMERIC;
  punch_scale NUMERIC;
  effect JSONB;
  effect_count INTEGER;
  effect_index INTEGER;
  effect_type TEXT;
  ken_burns_count INTEGER;
  blur_count INTEGER;
  punch_count INTEGER;
  word_pop_count INTEGER;
  effect_at_ms BIGINT;
  effect_start_ms BIGINT;
  effect_end_ms BIGINT;
  word_ref JSONB;
  segment_count INTEGER := 0;
  word_count INTEGER := 0;
  declared_ids UUID[];
  used_ids UUID[] := ARRAY[]::UUID[];
  chrome JSONB;
  wave_viz JSONB;
  overlay JSONB;
  overlay_count INTEGER;
  overlay_index INTEGER;
  overlay_type TEXT;
  last_overlay_end JSONB := '{}'::JSONB;
  -- Every instantaneous luminance or appearance event on one timeline. A pulsing
  -- light leak contributes one entry per peak, not one per overlay.
  flash_events BIGINT[] := ARRAY[]::BIGINT[];
  sorted_flashes BIGINT[];
  flash_index INTEGER;
  leak_pulse_hz BIGINT;
  leak_pulse_max_index BIGINT;
  needs_structure BOOLEAN := false;
BEGIN
  -- No scene is a legal state, not a violation: it means the published page
  -- falls back to the legacy player.
  IF scene IS NULL THEN
    RETURN NULL;
  END IF;

  -- ══ v2 and v3 ═════════════════════════════════════════════════════════
  -- Dispatch on the version the way contracts' parseAnyPitchScene does.
  -- Anything that is neither v2 nor v3 — including a v1 envelope mislabelled, a
  -- non-object, or a missing version — falls through to the v1 rules below and
  -- keeps their exact messages.
  --
  -- v3 IS v2 PLUS THE CLIP SHOT, so the two share this branch and every v3-only
  -- rule is gated on is_v3. A parallel v3 branch would have been a second copy
  -- of sixty v2 bounds, and the first one to move would have moved in only one
  -- of them; the parity the frozen contract asserts (pitchSceneV3.test.ts sweeps
  -- every numeric leaf of the v2 example against both parsers) is structural
  -- here instead.
  scene_version := CASE
    WHEN jsonb_typeof(scene) = 'object'
      THEN private.pitch_scene_integer(scene -> 'schemaVersion')
  END;
  is_v3 := coalesce(scene_version = 3, false);
  IF scene_version IN (2, 3) THEN
    IF is_v3 THEN
      -- clipAssetIds is OPTIONAL and, when present, non-empty: absent means the
      -- scene plays no clip, so "no clips" has exactly one representation and a
      -- v2 timeline is a v3 timeline with only its schemaVersion changed.
      IF NOT private.pitch_scene_keys_are(scene, ARRAY[
           'schemaVersion', 'template', 'canvas', 'durationMs', 'assetIds', 'shots',
           'look', 'chrome', 'overlays'
         ])
         AND NOT private.pitch_scene_keys_are(scene, ARRAY[
           'schemaVersion', 'template', 'canvas', 'durationMs', 'assetIds',
           'clipAssetIds', 'shots', 'look', 'chrome', 'overlays'
         ]) THEN
        RETURN 'pitch scene must carry only schemaVersion, template, canvas, durationMs, assetIds, clipAssetIds, shots, look, chrome and overlays';
      END IF;
    ELSIF NOT private.pitch_scene_keys_are(scene, ARRAY[
             'schemaVersion', 'template', 'canvas', 'durationMs', 'assetIds', 'shots',
             'look', 'chrome', 'overlays'
           ]) THEN
      RETURN 'pitch scene must carry only schemaVersion, template, canvas, durationMs, assetIds, shots, look, chrome and overlays';
    END IF;

    -- Fonts and colours live in the template, which is why no hex string or
    -- font name can appear anywhere in a scene.
    IF NOT private.pitch_scene_token(scene -> 'template', ARRAY['warm', 'hype']) THEN
      RETURN 'pitch scene template must be warm or hype';
    END IF;

    canvas := scene -> 'canvas';
    IF NOT private.pitch_scene_keys_are(canvas, ARRAY['width', 'height', 'fps'])
       OR NOT private.pitch_scene_integer_in(canvas -> 'width', 1, 4096)
       OR NOT private.pitch_scene_integer_in(canvas -> 'height', 1, 4096)
       OR NOT private.pitch_scene_integer_in(canvas -> 'fps', 1, 60) THEN
      RETURN 'pitch scene canvas must carry a width, a height and an fps in range';
    END IF;

    duration := private.pitch_scene_integer(scene -> 'durationMs');
    IF duration IS NULL OR duration < 1200 OR duration > 600000 THEN
      RETURN 'pitch scene must last between 1200ms and 600000ms';
    END IF;
    -- A scene cannot exist without transcript segments to hang it on, because
    -- there would then be no reproducible duration to agree with.
    IF duration_ms_expected IS NULL THEN
      RETURN 'pitch scene requires transcript segments';
    END IF;
    IF duration IS DISTINCT FROM duration_ms_expected::BIGINT THEN
      RETURN 'pitch scene duration must match the transcript segments';
    END IF;

    -- The header. Redundant with the shots on purpose: approval compares THIS
    -- array against the Dater's include set instead of walking nested jsonb.
    entry_count := CASE
      WHEN jsonb_typeof(scene -> 'assetIds') = 'array'
        THEN jsonb_array_length(scene -> 'assetIds')
    END;
    IF entry_count IS NULL
       OR entry_count < 1
       OR entry_count > 12
       OR EXISTS (
         SELECT 1
           FROM jsonb_array_elements(scene -> 'assetIds') AS listed(value)
          WHERE jsonb_typeof(listed.value) IS DISTINCT FROM 'string'
             OR (listed.value #>> '{}') !~* uuid_pattern
       )
       OR (
         SELECT count(DISTINCT lower(listed.value #>> '{}'))
           FROM jsonb_array_elements(scene -> 'assetIds') AS listed(value)
       ) <> entry_count THEN
      RETURN 'pitch scene assetIds must be 1 to 12 distinct photo ids';
    END IF;
    SELECT array_agg((listed.value #>> '{}')::UUID ORDER BY listed.ord)
      INTO declared_ids
      FROM jsonb_array_elements(scene -> 'assetIds')
           WITH ORDINALITY AS listed(value, ord);
    IF EXISTS (
      SELECT 1
        FROM unnest(declared_ids) AS declared(asset_id)
       WHERE NOT (declared.asset_id = ANY(photos))
    ) THEN
      RETURN 'pitch scene must reference only reviewed photo assets';
    END IF;

    -- The CLIP header (v3). Kept apart from assetIds because the two are
    -- compared against different approval lists: photos against the reviewed
    -- photo set, clips against the reviewed clip set. A clip may never stand in
    -- for a photo — the pre-publication identity and face-match review is built
    -- on the photo set the Dater approved one by one.
    IF is_v3 AND scene ? 'clipAssetIds' THEN
      entry_count := CASE
        WHEN jsonb_typeof(scene -> 'clipAssetIds') = 'array'
          THEN jsonb_array_length(scene -> 'clipAssetIds')
      END;
      IF entry_count IS NULL
         OR entry_count < 1
         OR EXISTS (
           SELECT 1
             FROM jsonb_array_elements(scene -> 'clipAssetIds') AS listed(value)
            WHERE jsonb_typeof(listed.value) IS DISTINCT FROM 'string'
               OR (listed.value #>> '{}') !~* uuid_pattern
         )
         OR (
           SELECT count(DISTINCT lower(listed.value #>> '{}'))
             FROM jsonb_array_elements(scene -> 'clipAssetIds') AS listed(value)
         ) <> entry_count THEN
        RETURN 'pitch scene clipAssetIds must be a non-empty list of distinct clip ids';
      END IF;
      -- MAX_CLIP_ASSETS_PER_SCENE. The product cap is free tier 1, premium 3;
      -- which tier a given pitch gets is an entitlement the registration gate
      -- owns, so the scene pins only the absolute ceiling.
      IF entry_count > 3 THEN
        RETURN 'pitch scene may use at most 3 clips';
      END IF;
      -- MAX_SCENE_ASSETS is SHARED: 12 covers photos and clips together, so a
      -- 12-photo scene has no room for a clip. Two separate ceilings would have
      -- let one scene reference 15 assets.
      IF coalesce(array_length(declared_ids, 1), 0) + entry_count > 12 THEN
        RETURN 'pitch scene may reference at most 12 assets, photos and clips together';
      END IF;
      SELECT array_agg((listed.value #>> '{}')::UUID ORDER BY listed.ord)
        INTO clip_ids
        FROM jsonb_array_elements(scene -> 'clipAssetIds')
             WITH ORDINALITY AS listed(value, ord);
      -- The whole point of the argument: a clip shot may only replay footage
      -- whose ingest succeeded, which includes frame moderation. A pending,
      -- flagged or failed clip is simply not in `videos`.
      IF EXISTS (
        SELECT 1
          FROM unnest(clip_ids) AS declared(asset_id)
         WHERE NOT (declared.asset_id = ANY(videos))
      ) THEN
        RETURN 'pitch scene must reference only reviewed video assets';
      END IF;
    END IF;

    -- The transcript bounds a word reference; the scene alone cannot. Read once
    -- here rather than per wordPop.
    IF jsonb_typeof(transcript -> 'segments') = 'array' THEN
      segment_count := jsonb_array_length(transcript -> 'segments');
    END IF;
    IF jsonb_typeof(transcript -> 'words') = 'array' THEN
      word_count := jsonb_array_length(transcript -> 'words');
    END IF;

    shot_count := CASE
      WHEN jsonb_typeof(scene -> 'shots') = 'array'
        THEN jsonb_array_length(scene -> 'shots')
    END;
    IF shot_count IS NULL OR shot_count < 1 OR shot_count > 300 THEN
      RETURN 'pitch scene must carry 1 to 300 shots';
    END IF;

    FOR shot_index IN 0 .. shot_count - 1 LOOP
      shot := scene -> 'shots' -> shot_index;
      IF is_v3 THEN
        IF NOT private.pitch_scene_token(shot -> 'level', ARRAY[
             'wide', 'punchIn', 'detail', 'wideAlt', 'typographic', 'clip'
           ]) THEN
          RETURN 'pitch scene shot level must be wide, punchIn, detail, wideAlt, typographic or clip';
        END IF;
      ELSIF NOT private.pitch_scene_token(shot -> 'level', ARRAY[
               'wide', 'punchIn', 'detail', 'wideAlt', 'typographic'
             ]) THEN
        RETURN 'pitch scene shot level must be wide, punchIn, detail, wideAlt or typographic';
      END IF;
      shot_level := shot ->> 'level';

      IF shot_level = 'typographic' THEN
        IF NOT private.pitch_scene_keys_are(
             shot, ARRAY['level', 'startMs', 'endMs', 'text']
           ) THEN
          RETURN 'pitch scene text card must carry only level, startMs, endMs and text';
        END IF;
      ELSIF shot_level = 'clip' THEN
        -- NO crop and NO audio field exists on a clip shot, structurally: a
        -- static rect cannot follow a moving subject, and the Introducer's
        -- original voice is the only audio a pitch has ever had.
        IF NOT private.pitch_scene_keys_are(
             shot,
             ARRAY['level', 'assetId', 'startMs', 'endMs', 'clipInMs', 'clipOutMs',
                   'effects']
           ) THEN
          RETURN 'pitch scene clip shot must carry only level, assetId, startMs, endMs, clipInMs, clipOutMs and effects';
        END IF;
      ELSIF NOT private.pitch_scene_keys_are(
              shot, ARRAY['level', 'assetId', 'startMs', 'endMs', 'crop', 'effects']
            ) THEN
        RETURN 'pitch scene shot must carry only level, assetId, startMs, endMs, crop and effects';
      END IF;

      start_ms := private.pitch_scene_integer(shot -> 'startMs');
      end_ms := private.pitch_scene_integer(shot -> 'endMs');
      IF NOT private.pitch_scene_integer_in(shot -> 'startMs', 0, 600000)
         OR NOT private.pitch_scene_integer_in(shot -> 'endMs', 0, 600000) THEN
        RETURN 'pitch scene shot must carry a whole millisecond startMs and endMs';
      END IF;
      -- Contiguity: the first shot starts at 0, each later shot starts exactly
      -- where the previous one ended. This single equality rejects gaps (black
      -- frames) and overlaps (undefined stacking order) alike.
      IF start_ms IS DISTINCT FROM previous_end THEN
        RETURN 'pitch scene shots must be contiguous from 0 to durationMs';
      END IF;
      -- THE STROBE FLOOR. "No overlap" alone still admits 30ms x 100 shots,
      -- which is a photosensitive-epilepsy hazard landing on a VIEWER who is
      -- outside the Dater's consent model entirely.
      IF end_ms - start_ms < 1200 THEN
        RETURN 'every pitch scene shot must last at least 1200ms';
      END IF;
      IF shot_level = 'clip' THEN
        -- MAX_CLIP_USAGE_MS, not MAX_SHOT_DURATION_MS: a clip is continuous
        -- change, so the 4500ms ceiling that keeps a still from stalling does
        -- not apply to it. 10s is the product cap on scene use.
        IF end_ms - start_ms > 10000 THEN
          RETURN 'pitch scene clip may not hold the screen longer than 10000ms';
        END IF;
      ELSIF end_ms - start_ms > 4500 THEN
        RETURN 'no pitch scene shot may last longer than 4500ms';
      END IF;

      IF shot_level = 'typographic' THEN
        -- A text card's reveal is momentary and cannot fill the rest, so the
        -- card may not outlast the "nothing sits visually still" bound.
        IF end_ms - start_ms > 2500 THEN
          RETURN 'a pitch scene text card may not last longer than 2500ms';
        END IF;
        text_card := shot -> 'text';
        IF NOT private.pitch_scene_keys_are(
             text_card, ARRAY['type', 'source', 'revealMs', 'easing', 'emphasis']
           )
           OR NOT private.pitch_scene_token(text_card -> 'type', ARRAY['kineticText']) THEN
          RETURN 'pitch scene text card must carry only a kineticText with type, source, revealMs, easing and emphasis';
        END IF;
        -- A token, never the text: the player reads the sentence from the
        -- approved revision, so an edited sentence cannot leave a stale copy
        -- behind in the scene.
        IF NOT private.pitch_scene_token(text_card -> 'source', text_sources) THEN
          RETURN 'pitch scene text source must name a reviewed structure field';
        END IF;
        IF NOT private.pitch_scene_integer_in(text_card -> 'revealMs', 80, 800) THEN
          RETURN 'pitch scene text reveal must last between 80ms and 800ms';
        END IF;
        IF NOT private.pitch_scene_token(text_card -> 'easing', easings) THEN
          RETURN 'pitch scene easing must be linear, easeIn, easeOut or easeInOut';
        END IF;
        IF NOT private.pitch_scene_number_in(text_card -> 'emphasis', 0, 1) THEN
          RETURN 'pitch scene emphasis must be between 0 and 1';
        END IF;
        needs_structure := true;
      ELSIF shot_level = 'clip' THEN
        -- L5, new in v3: a window into one reviewed clip, replayed at real speed
        -- with no audio, no crop and no camera move.
        IF jsonb_typeof(shot -> 'assetId') IS DISTINCT FROM 'string'
           OR (shot ->> 'assetId') !~* uuid_pattern THEN
          RETURN 'pitch scene clip shot must reference a clip by id';
        END IF;
        clip_asset_id := (shot ->> 'assetId')::UUID;
        clip_shot_count := clip_shot_count + 1;
        used_clip_ids := array_append(used_clip_ids, clip_asset_id);
        IF clip_ids IS NULL OR NOT (clip_asset_id = ANY(clip_ids)) THEN
          RETURN 'pitch scene clip shot may only use a clip listed in clipAssetIds';
        END IF;

        -- MAX_CLIP_SOURCE_MS. Capture is capped at 15s, so no legal window can
        -- reach past it; the authoritative check is the media probe, which wrote
        -- pitch_video_ingests.duration_ms.
        IF NOT private.pitch_scene_integer_in(shot -> 'clipInMs', 0, 15000)
           OR NOT private.pitch_scene_integer_in(shot -> 'clipOutMs', 0, 15000) THEN
          RETURN 'pitch scene clip shot must carry whole millisecond clipInMs and clipOutMs no later than 15000ms';
        END IF;
        clip_in_ms := private.pitch_scene_integer(shot -> 'clipInMs');
        clip_out_ms := private.pitch_scene_integer(shot -> 'clipOutMs');
        clip_window_ms := clip_out_ms - clip_in_ms;
        IF clip_window_ms < 1200 THEN
          RETURN 'pitch scene clip window must run forward and last at least 1200ms';
        END IF;
        IF clip_window_ms > 10000 THEN
          RETURN 'pitch scene clip may not hold the screen longer than 10000ms';
        END IF;
        -- 1:1 PLAYBACK, exactly. A retimed clip is a second interpretation of
        -- footage the Dater reviewed at normal speed (4x turns a walk into a
        -- stumble), and a frozen one would smuggle a still photo past the
        -- include list. Speed, if it is ever wanted, is v4 with its own
        -- approval surface.
        IF clip_window_ms IS DISTINCT FROM end_ms - start_ms THEN
          RETURN 'pitch scene clip shot must replay its source 1:1 (clipOut - clipIn must equal endMs - startMs)';
        END IF;

        -- A photo's repeat rule is a GAP; neither half of it transfers to a
        -- clip. A second window is different pixels in continuous motion, so
        -- waiting three shots buys nothing, while the SAME window replayed reads
        -- as a playback glitch however far apart it sits. So: a window may
        -- appear once, at any distance, and two windows of one clip may not
        -- overlap in source time — [0,3000) and [100,3100) replay 2900ms of the
        -- same frames a tenth of a second apart, which is a stutter.
        clip_key := clip_asset_id::TEXT;
        FOR clip_window IN
          SELECT seen.value
            FROM jsonb_array_elements(
                   coalesce(clip_windows -> clip_key, '[]'::JSONB)
                 ) AS seen(value)
        LOOP
          IF (clip_window -> 0)::TEXT::BIGINT = clip_in_ms
             AND (clip_window -> 1)::TEXT::BIGINT = clip_out_ms THEN
            RETURN 'pitch scene may not play the same clip window twice';
          END IF;
          IF clip_in_ms < (clip_window -> 1)::TEXT::BIGINT
             AND (clip_window -> 0)::TEXT::BIGINT < clip_out_ms THEN
            RETURN 'pitch scene two windows of the same clip may not overlap';
          END IF;
        END LOOP;
        clip_windows := clip_windows || jsonb_build_object(
          clip_key,
          coalesce(clip_windows -> clip_key, '[]'::JSONB)
            || jsonb_build_array(jsonb_build_array(clip_in_ms, clip_out_ms))
        );

        -- The AGGREGATE half of the 10s cap, and the half a per-shot ceiling
        -- alone waves through: three adjacent 5s windows of one clip replay 15s
        -- of footage. Both halves answer with the SAME sentence on purpose —
        -- they answer one question, and a mirror may check them in either order.
        clip_held_ms := coalesce((clip_usage -> clip_key)::TEXT::BIGINT, 0)
          + (end_ms - start_ms);
        clip_usage := clip_usage || jsonb_build_object(clip_key, clip_held_ms);
        IF clip_held_ms > 10000 THEN
          RETURN 'pitch scene clip may not hold the screen longer than 10000ms';
        END IF;

        effect_count := CASE
          WHEN jsonb_typeof(shot -> 'effects') = 'array'
            THEN jsonb_array_length(shot -> 'effects')
        END;
        IF effect_count IS NULL OR effect_count > 8 THEN
          RETURN 'pitch scene shot effects must be a list of at most 8 effects';
        END IF;
        word_pop_count := 0;
        FOR effect_index IN 0 .. effect_count - 1 LOOP
          effect := shot -> 'effects' -> effect_index;
          -- wordPop ONLY. kenBurns and punch are camera moves invented for a
          -- STILL — layering them over footage that is already moving is a
          -- double transform of pixels the Dater approved — and backdropBlur
          -- exists to seat a text card, which a clip never carries. A wordPop
          -- survives because it marks a word the Introducer SPOKE, on the voice
          -- timeline, independent of what the shot underneath is doing.
          IF NOT private.pitch_scene_token(effect -> 'type', ARRAY['wordPop']) THEN
            RETURN 'pitch scene clip shot may carry only wordPop effects';
          END IF;
          violation_message := private.pitch_scene_word_pop_violation(
            effect, start_ms, end_ms, segment_count, word_count
          );
          IF violation_message IS NOT NULL THEN
            RETURN violation_message;
          END IF;
          word_pop_count := word_pop_count + 1;
          -- A wordPop drawn ON a clip costs exactly what it costs on a photo.
          -- The clip shot itself contributes NOTHING: its boundary is a cut like
          -- any other (and cuts are already >=1200ms apart) and its own frames
          -- are continuous change, not a momentary luminance jump.
          flash_events := array_append(
            flash_events, private.pitch_scene_integer(effect -> 'startMs')
          );
        END LOOP;
        IF word_pop_count > 4 THEN
          RETURN 'pitch scene shot may carry at most 4 wordPops';
        END IF;
      ELSE
        IF jsonb_typeof(shot -> 'assetId') IS DISTINCT FROM 'string'
           OR (shot ->> 'assetId') !~* uuid_pattern THEN
          RETURN 'pitch scene shot must reference a photo by id';
        END IF;
        used_ids := array_append(used_ids, (shot ->> 'assetId')::UUID);

        min_size := private.pitch_shot_level_min_size(shot_level);
        crop_message := private.pitch_scene_crop_violation(shot -> 'crop', min_size);
        IF crop_message IS NOT NULL THEN
          RETURN crop_message;
        END IF;

        tightest := private.pitch_scene_number(shot -> 'crop' -> 'width');
        punch_scale := 1;
        ken_burns_count := 0;
        blur_count := 0;
        punch_count := 0;
        word_pop_count := 0;

        effect_count := CASE
          WHEN jsonb_typeof(shot -> 'effects') = 'array'
            THEN jsonb_array_length(shot -> 'effects')
        END;
        IF effect_count IS NULL OR effect_count > 8 THEN
          RETURN 'pitch scene shot effects must be a list of at most 8 effects';
        END IF;

        FOR effect_index IN 0 .. effect_count - 1 LOOP
          effect := shot -> 'effects' -> effect_index;
          IF NOT private.pitch_scene_token(effect -> 'type', ARRAY[
               'kenBurns', 'punch', 'wordPop', 'backdropBlur'
             ]) THEN
            RETURN 'pitch scene effect type must be kenBurns, punch, wordPop or backdropBlur';
          END IF;
          effect_type := effect ->> 'type';

          IF effect_type = 'kenBurns' THEN
            IF NOT private.pitch_scene_keys_are(effect, ARRAY['type', 'to', 'easing']) THEN
              RETURN 'pitch scene kenBurns must carry only type, to and easing';
            END IF;
            IF NOT private.pitch_scene_token(effect -> 'easing', easings) THEN
              RETURN 'pitch scene easing must be linear, easeIn, easeOut or easeInOut';
            END IF;
            crop_message := private.pitch_scene_crop_violation(effect -> 'to', min_size);
            IF crop_message IS NOT NULL THEN
              RETURN crop_message;
            END IF;
            tightest := least(tightest, private.pitch_scene_number(effect -> 'to' -> 'width'));
            ken_burns_count := ken_burns_count + 1;

          ELSIF effect_type = 'punch' THEN
            IF NOT private.pitch_scene_keys_are(
                 effect, ARRAY['type', 'atMs', 'durationMs', 'scale', 'easing']
               ) THEN
              RETURN 'pitch scene punch must carry only type, atMs, durationMs, scale and easing';
            END IF;
            IF NOT private.pitch_scene_token(effect -> 'easing', easings) THEN
              RETURN 'pitch scene easing must be linear, easeIn, easeOut or easeInOut';
            END IF;
            IF NOT private.pitch_scene_integer_in(effect -> 'atMs', 0, 600000)
               OR NOT private.pitch_scene_integer_in(effect -> 'durationMs', 80, 400)
               OR NOT private.pitch_scene_number_in(effect -> 'scale', 1.02, 1.12) THEN
              RETURN 'pitch scene punch must last 80ms to 400ms and scale between 1.02x and 1.12x';
            END IF;
            effect_at_ms := private.pitch_scene_integer(effect -> 'atMs');
            IF effect_at_ms < start_ms
               OR effect_at_ms + private.pitch_scene_integer(effect -> 'durationMs') > end_ms THEN
              RETURN 'pitch scene punch must start and end inside its own shot';
            END IF;
            punch_scale := greatest(punch_scale, private.pitch_scene_number(effect -> 'scale'));
            punch_count := punch_count + 1;
            flash_events := array_append(flash_events, effect_at_ms);

          ELSIF effect_type = 'wordPop' THEN
            -- The rules moved verbatim into
            -- private.pitch_scene_word_pop_violation so the clip branch below
            -- pays exactly the same ones. Every message they return is pinned by
            -- supabase/tests/25_motion_scene_v2.sql.
            violation_message := private.pitch_scene_word_pop_violation(
              effect, start_ms, end_ms, segment_count, word_count
            );
            IF violation_message IS NOT NULL THEN
              RETURN violation_message;
            END IF;
            effect_start_ms := private.pitch_scene_integer(effect -> 'startMs');
            word_pop_count := word_pop_count + 1;
            -- A word appearing is an appearance event: the web player ramps its
            -- opacity in, but the budget is what stops four of them arriving
            -- inside one second in the first place.
            flash_events := array_append(flash_events, effect_start_ms);

          ELSE
            IF NOT private.pitch_scene_keys_are(
                 effect, ARRAY['type', 'radiusPx', 'dim']
               )
               OR NOT private.pitch_scene_integer_in(effect -> 'radiusPx', 8, 64)
               OR NOT private.pitch_scene_number_in(effect -> 'dim', 0, 0.6) THEN
              RETURN 'pitch scene backdropBlur must carry a radiusPx of 8px to 64px and a dim of at most 0.6';
            END IF;
            blur_count := blur_count + 1;
          END IF;
        END LOOP;

        IF ken_burns_count > 1 THEN
          RETURN 'pitch scene shot may carry at most one kenBurns';
        END IF;
        IF blur_count > 1 THEN
          RETURN 'pitch scene shot may carry at most one backdropBlur';
        END IF;
        IF punch_count > 3 THEN
          RETURN 'pitch scene shot may carry at most 3 punches';
        END IF;
        IF word_pop_count > 4 THEN
          RETURN 'pitch scene shot may carry at most 4 wordPops';
        END IF;
        -- The zoom ceiling is on what the viewer actually sees: the tightest
        -- crop the shot reaches, multiplied by its loudest punch. A detail shot
        -- cannot reach 1.5x and then punch past it.
        IF (1 / tightest) * punch_scale > (1 / min_size) + slack THEN
          RETURN 'pitch scene shot may not zoom past the ceiling for its level';
        END IF;
      END IF;

      previous_end := end_ms;
    END LOOP;

    IF previous_end IS DISTINCT FROM duration THEN
      RETURN 'pitch scene shots must be contiguous from 0 to durationMs';
    END IF;

    -- Set equality, both directions: a shot may only use a listed photo, and
    -- every listed photo must appear in at least one shot. Approval compares the
    -- header against the Dater's include set, so a header that disagrees with
    -- the shots would make that comparison meaningless.
    IF (SELECT array_agg(DISTINCT declared.asset_id) FROM unnest(declared_ids) AS declared(asset_id))
       IS DISTINCT FROM
       (SELECT array_agg(DISTINCT used.asset_id) FROM unnest(used_ids) AS used(asset_id)) THEN
      RETURN 'pitch scene assetIds must be exactly the photos its shots use';
    END IF;

    -- The same set equality for clips, both directions, plus the one shape rule
    -- the header alone cannot state: clipAssetIds is ABSENT when no shot plays a
    -- clip, never an empty array.
    IF is_v3 THEN
      IF clip_ids IS NOT NULL AND clip_shot_count = 0 THEN
        RETURN 'pitch scene clipAssetIds must be absent when no shot plays a clip';
      END IF;
      IF (
        SELECT array_agg(DISTINCT declared.asset_id)
          FROM unnest(coalesce(clip_ids, ARRAY[]::UUID[])) AS declared(asset_id)
      ) IS DISTINCT FROM (
        SELECT array_agg(DISTINCT used.asset_id)
          FROM unnest(used_clip_ids) AS used(asset_id)
      ) THEN
        RETURN 'pitch scene clipAssetIds must be exactly the clips its shots use';
      END IF;
    END IF;

    -- Scene-level look. Restarting a grade or re-seeding grain at a cut is
    -- visible, which is why these are not per shot.
    IF NOT private.pitch_scene_keys_are(scene -> 'look', ARRAY['grade', 'grain']) THEN
      RETURN 'pitch scene look must carry only a grade and a grain';
    END IF;
    IF NOT private.pitch_scene_keys_are(
         scene -> 'look' -> 'grade',
         ARRAY['warmth', 'contrast', 'saturation', 'vignette']
       )
       OR NOT private.pitch_scene_number_in(scene -> 'look' -> 'grade' -> 'warmth', -1, 1)
       OR NOT private.pitch_scene_number_in(scene -> 'look' -> 'grade' -> 'contrast', 0.8, 1.4)
       OR NOT private.pitch_scene_number_in(scene -> 'look' -> 'grade' -> 'saturation', 0.6, 1.4)
       OR NOT private.pitch_scene_number_in(scene -> 'look' -> 'grade' -> 'vignette', 0, 0.6) THEN
      RETURN 'pitch scene grade must carry a warmth, a contrast, a saturation and a vignette in range';
    END IF;
    -- Grain is the one place where safety is an amplitude bound rather than a
    -- frequency bound: it is sub-pixel texture that resamples per frame in every
    -- real film emulation, so it may animate up to frame rate and its luminance
    -- swing is held under the flash threshold by the intensity ceiling instead.
    IF NOT private.pitch_scene_keys_are(
         scene -> 'look' -> 'grain',
         ARRAY['intensity', 'sizePx', 'seed', 'animationHz']
       )
       OR NOT private.pitch_scene_number_in(scene -> 'look' -> 'grain' -> 'intensity', 0, 0.25)
       OR NOT private.pitch_scene_number_in(scene -> 'look' -> 'grain' -> 'sizePx', 1, 4)
       OR NOT private.pitch_scene_integer_in(scene -> 'look' -> 'grain' -> 'seed', 0, 2147483647)
       OR NOT private.pitch_scene_number_in(scene -> 'look' -> 'grain' -> 'animationHz', 0, 30) THEN
      RETURN 'pitch scene grain must carry an intensity, a sizePx, a seed and an animationHz in range';
    END IF;

    chrome := scene -> 'chrome';
    IF jsonb_typeof(chrome) IS DISTINCT FROM 'object'
       OR EXISTS (
         SELECT 1
           FROM jsonb_object_keys(chrome) AS present(key)
          WHERE NOT (present.key = ANY(ARRAY['progressBar', 'waveViz']))
       ) THEN
      RETURN 'pitch scene chrome must carry only a progressBar and a waveViz';
    END IF;
    IF chrome ? 'progressBar' THEN
      IF NOT private.pitch_scene_keys_are(
           chrome -> 'progressBar', ARRAY['thicknessPx', 'opacity', 'anchor']
         )
         OR NOT private.pitch_scene_integer_in(chrome -> 'progressBar' -> 'thicknessPx', 2, 12)
         OR NOT private.pitch_scene_number_in(chrome -> 'progressBar' -> 'opacity', 0.2, 1)
         OR NOT private.pitch_scene_token(
              chrome -> 'progressBar' -> 'anchor', ARRAY['top', 'bottom']
            ) THEN
        RETURN 'pitch scene progressBar must carry a thicknessPx, an opacity and an anchor in range';
      END IF;
    END IF;
    IF chrome ? 'waveViz' THEN
      wave_viz := chrome -> 'waveViz';
      IF NOT private.pitch_scene_keys_are(
           wave_viz,
           ARRAY['amplitudes', 'sampleIntervalMs', 'heightPx', 'opacity', 'anchor']
         )
         OR NOT private.pitch_scene_integer_in(wave_viz -> 'sampleIntervalMs', 40, 1000)
         OR NOT private.pitch_scene_integer_in(wave_viz -> 'heightPx', 24, 240)
         OR NOT private.pitch_scene_number_in(wave_viz -> 'opacity', 0.2, 1)
         OR NOT private.pitch_scene_token(wave_viz -> 'anchor', ARRAY['top', 'bottom'])
         OR jsonb_typeof(wave_viz -> 'amplitudes') IS DISTINCT FROM 'array'
         OR jsonb_array_length(wave_viz -> 'amplitudes') NOT BETWEEN 1 AND 4096
         OR EXISTS (
           SELECT 1
             FROM jsonb_array_elements(wave_viz -> 'amplitudes') AS sample(value)
            WHERE NOT private.pitch_scene_number_in(sample.value, 0, 1)
         ) THEN
        RETURN 'pitch scene waveViz must carry amplitudes, a sampleIntervalMs, a heightPx, an opacity and an anchor in range';
      END IF;
      -- The envelope is baked, so it has to cover the whole scene exactly: a
      -- player that stretched a short envelope would be re-deriving the shape at
      -- playback time, which is what approval forbids.
      IF jsonb_array_length(wave_viz -> 'amplitudes') <> ceil(
           duration::NUMERIC / private.pitch_scene_integer(wave_viz -> 'sampleIntervalMs')
         ) THEN
        RETURN 'pitch scene waveViz must carry one amplitude per sample interval';
      END IF;
    END IF;

    overlay_count := CASE
      WHEN jsonb_typeof(scene -> 'overlays') = 'array'
        THEN jsonb_array_length(scene -> 'overlays')
    END;
    IF overlay_count IS NULL OR overlay_count > 64 THEN
      RETURN 'pitch scene overlays must be a list of at most 64 overlays';
    END IF;
    FOR overlay_index IN 0 .. overlay_count - 1 LOOP
      overlay := scene -> 'overlays' -> overlay_index;
      IF NOT private.pitch_scene_token(
           overlay -> 'type', ARRAY['lightLeak', 'countBadge']
         ) THEN
        RETURN 'pitch scene overlay type must be lightLeak or countBadge';
      END IF;
      overlay_type := overlay ->> 'type';
      IF NOT private.pitch_scene_integer_in(overlay -> 'startMs', 0, 600000)
         OR NOT private.pitch_scene_integer_in(overlay -> 'endMs', 0, 600000) THEN
        RETURN 'pitch scene overlay must carry a whole millisecond startMs and endMs';
      END IF;
      start_ms := private.pitch_scene_integer(overlay -> 'startMs');
      end_ms := private.pitch_scene_integer(overlay -> 'endMs');
      IF end_ms > duration THEN
        RETURN 'pitch scene overlay must end within the scene';
      END IF;

      IF overlay_type = 'lightLeak' THEN
        IF NOT private.pitch_scene_keys_are(
             overlay,
             ARRAY['type', 'startMs', 'endMs', 'peakIntensity', 'pulseHz', 'angleDeg']
           ) THEN
          RETURN 'pitch scene lightLeak must carry only type, startMs, endMs, peakIntensity, pulseHz and angleDeg';
        END IF;
        -- The 3Hz ceiling on oscillating luminance. It is a photosensitivity
        -- bound, not a style choice, and the viewer never consented to anything.
        -- pulseHz is a WHOLE number so that floor(k * 1000 / pulseHz) below lands
        -- on the same millisecond in PL/pgSQL NUMERIC, JavaScript float and zod:
        -- a fractional Hz can put the three divisions on either side of an
        -- integer boundary and split the peak lists the budget compares.
        IF NOT private.pitch_scene_number_in(overlay -> 'peakIntensity', 0, 0.6)
           OR NOT private.pitch_scene_integer_in(overlay -> 'pulseHz', 0, 3)
           OR NOT private.pitch_scene_number_in(overlay -> 'angleDeg', 0, 360) THEN
          RETURN 'pitch scene lightLeak must carry a peakIntensity, a whole-number pulseHz of at most 3 and an angleDeg in range';
        END IF;
        IF end_ms - start_ms < 120 OR end_ms - start_ms > 1200 THEN
          RETURN 'a pitch scene lightLeak must last between 120ms and 1200ms';
        END IF;
        -- EXPAND THE PULSE, do not count the overlay. A 3Hz leak lasting 1200ms
        -- delivers four luminance peaks; counting only its onset let three
        -- punches sit between them and put five events inside one second.
        leak_pulse_hz := private.pitch_scene_integer(overlay -> 'pulseHz');
        IF leak_pulse_hz = 0 THEN
          -- No oscillation, but the leak still appears once.
          flash_events := array_append(flash_events, start_ms);
        ELSE
          -- Bound on the series, not the rule: the half-open filter decides which
          -- peaks count. 60s x 3Hz = 180 caps the walk even if the leak length
          -- range widened later.
          leak_pulse_max_index := least(
            ceil((end_ms - start_ms)::NUMERIC * leak_pulse_hz / 1000)::BIGINT, 180
          );
          flash_events := flash_events || (
            SELECT coalesce(array_agg(peak.at_ms), ARRAY[]::BIGINT[])
              FROM (
                SELECT start_ms
                       + div(series.k::NUMERIC * 1000, leak_pulse_hz)::BIGINT AS at_ms
                  FROM generate_series(0, leak_pulse_max_index) AS series(k)
              ) AS peak
             -- [startMs, endMs): a peak landing exactly on endMs belongs to no
             -- frame the leak is still drawn on.
             WHERE peak.at_ms < end_ms
          );
        END IF;
      ELSE
        IF NOT private.pitch_scene_keys_are(
             overlay, ARRAY['type', 'source', 'startMs', 'endMs', 'emphasis']
           ) THEN
          RETURN 'pitch scene countBadge must carry only type, source, startMs, endMs and emphasis';
        END IF;
        IF NOT private.pitch_scene_token(overlay -> 'source', text_sources) THEN
          RETURN 'pitch scene text source must name a reviewed structure field';
        END IF;
        IF NOT private.pitch_scene_number_in(overlay -> 'emphasis', 0, 1) THEN
          RETURN 'pitch scene emphasis must be between 0 and 1';
        END IF;
        IF end_ms - start_ms < 400 OR end_ms - start_ms > 4000 THEN
          RETURN 'a pitch scene countBadge must last between 400ms and 4000ms';
        END IF;
        -- A badge arriving over a scrim is an appearance event too. Its scrim is
        -- the brightest thing a countBadge does, and the player ramps it, but the
        -- rate at which badges may arrive is decided here.
        flash_events := array_append(flash_events, start_ms);
        needs_structure := true;
      END IF;

      IF jsonb_typeof(last_overlay_end -> overlay_type) = 'number'
         AND start_ms < (last_overlay_end ->> overlay_type)::BIGINT THEN
        RETURN 'pitch scene overlays of one type must be ordered and must not overlap';
      END IF;
      last_overlay_end := last_overlay_end || jsonb_build_object(overlay_type, end_ms);
    END LOOP;

    -- THE FLASH BUDGET. One timeline for the UNION of every instantaneous
    -- luminance or appearance event: punch onsets, each expanded lightLeak pulse
    -- peak, wordPop appearances and countBadge appearances. Two of them 100ms
    -- apart is a 10Hz stimulus no matter which types they were, and an event a
    -- viewer perceives as a flash does not stop being one because the layer that
    -- drew it is called text. 334ms between any two means any one-second window
    -- holds at most three, which is WCAG 2.3.1's general flash threshold.
    -- Shot cuts are already >=1200ms apart, so they cannot contribute.
    SELECT array_agg(event.value ORDER BY event.value)
      INTO sorted_flashes
      FROM unnest(flash_events) AS event(value);
    FOR flash_index IN 2 .. coalesce(array_length(sorted_flashes, 1), 0) LOOP
      IF sorted_flashes[flash_index] - sorted_flashes[flash_index - 1]
         < min_flash_interval_ms THEN
        RETURN 'pitch scene flashes must be at least 334ms apart';
      END IF;
    END LOOP;

    -- Gap (b): a card prints a sentence out of the reviewed structure, so the
    -- five published fields have to exist on the same row. Without them the card
    -- would be blank, or a later structure write would silently give it words.
    IF needs_structure
       AND private.dater_pitch_published_structure(structure) IS NULL THEN
      RETURN 'pitch scene text requires the five reviewed structure fields';
    END IF;

    RETURN NULL;
  END IF;

  -- ══ v1 (0048, unchanged) ══════════════════════════════════════════════
  IF jsonb_typeof(scene) IS DISTINCT FROM 'object'
     OR jsonb_typeof(scene -> 'schemaVersion') IS DISTINCT FROM 'number'
     OR jsonb_typeof(scene -> 'canvas') IS DISTINCT FROM 'object'
     OR jsonb_typeof(scene -> 'durationMs') IS DISTINCT FROM 'number'
     OR jsonb_typeof(scene -> 'scenes') IS DISTINCT FROM 'array'
     OR (SELECT count(*) FROM jsonb_object_keys(scene)) <> 4 THEN
    RETURN 'pitch scene must carry only schemaVersion, canvas, durationMs and scenes';
  END IF;

  IF private.pitch_scene_integer(scene -> 'schemaVersion') IS DISTINCT FROM 1 THEN
    RETURN 'pitch scene schemaVersion must be 1';
  END IF;

  canvas := scene -> 'canvas';
  IF (SELECT count(*) FROM jsonb_object_keys(canvas)) <> 3
     OR coalesce(private.pitch_scene_integer(canvas -> 'width'), 0) NOT BETWEEN 16 AND 8192
     OR coalesce(private.pitch_scene_integer(canvas -> 'height'), 0) NOT BETWEEN 16 AND 8192
     OR coalesce(private.pitch_scene_integer(canvas -> 'fps'), 0) NOT BETWEEN 1 AND 120 THEN
    RETURN 'pitch scene canvas must carry a width, a height and an fps in range';
  END IF;

  -- A scene cannot exist without transcript segments to hang it on, because
  -- there would then be no reproducible duration to agree with.
  IF duration_ms_expected IS NULL THEN
    RETURN 'pitch scene requires transcript segments';
  END IF;
  IF private.pitch_scene_integer(scene -> 'durationMs')
     IS DISTINCT FROM duration_ms_expected::BIGINT THEN
    RETURN 'pitch scene duration must match the transcript segments';
  END IF;

  entries := scene -> 'scenes';
  entry_count := jsonb_array_length(entries);
  IF entry_count < 1 THEN
    RETURN 'pitch scene requires at least one photo scene';
  END IF;
  -- One scene per photo at most. More scenes than photos means a photo is
  -- reused, which the per-entry duplicate check would catch anyway, but the
  -- count is the cheaper and clearer refusal.
  IF entry_count > coalesce(array_length(photos, 1), 0) THEN
    RETURN 'pitch scene must not use more scenes than reviewed photos';
  END IF;

  FOR entry_index IN 0 .. entry_count - 1 LOOP
    entry := entries -> entry_index;
    start_ms := private.pitch_scene_integer(entry -> 'startMs');
    end_ms := private.pitch_scene_integer(entry -> 'endMs');
    IF jsonb_typeof(entry) IS DISTINCT FROM 'object'
       OR (SELECT count(*) FROM jsonb_object_keys(entry)) <> 3
       OR jsonb_typeof(entry -> 'assetId') IS DISTINCT FROM 'string'
       OR start_ms IS NULL
       OR end_ms IS NULL THEN
      RETURN 'pitch scene entry must carry only assetId, startMs and endMs';
    END IF;
    -- Canonical dashed lowercase/uppercase form only. PostgreSQL's UUID input
    -- also accepts braces and unseparated hex, which would let the same asset
    -- appear under several spellings and produce different scene hashes.
    IF (entry ->> 'assetId')
       !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RETURN 'pitch scene entry must carry only assetId, startMs and endMs';
    END IF;
    entry_asset_id := (entry ->> 'assetId')::UUID;

    -- Contiguity: the first scene starts at 0, each later scene starts exactly
    -- where the previous one ended. This single equality rejects gaps (black
    -- frames) and overlaps (undefined stacking order) alike.
    IF start_ms IS DISTINCT FROM previous_end THEN
      RETURN 'pitch scenes must be contiguous from 0 to durationMs';
    END IF;
    IF end_ms - start_ms < 1000 THEN
      RETURN 'every pitch scene must last at least 1000ms';
    END IF;

    IF NOT (entry_asset_id = ANY(photos)) THEN
      RETURN 'pitch scene must reference only reviewed photo assets';
    END IF;
    IF entry_asset_id = ANY(seen_asset_ids) THEN
      RETURN 'pitch scene must not repeat a photo';
    END IF;
    seen_asset_ids := array_append(seen_asset_ids, entry_asset_id);

    previous_end := end_ms;
  END LOOP;

  IF previous_end IS DISTINCT FROM duration_ms_expected::BIGINT THEN
    RETURN 'pitch scenes must be contiguous from 0 to durationMs';
  END IF;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION
  private.pitch_scene_violation(JSONB, INTEGER, UUID[], JSONB, JSONB, UUID[])
  FROM PUBLIC;

COMMENT ON FUNCTION
  private.pitch_scene_violation(JSONB, INTEGER, UUID[], JSONB, JSONB, UUID[]) IS
  'NULL when the PitchScene payload satisfies every mechanical safety rule for its schemaVersion, otherwise the pinned rejection message. v1 is judged exactly as 0048 judged it. v2 and v3 share one branch and resolve their references against the row being written onto: a wordPop needs word timings, a kineticText or countBadge needs the five published structure fields, and a v3 clip shot needs a video asset whose ingest succeeded. A NULL scene is acceptable and means the pitch has no motion.';

-- The canonical walk now covers v3 as well; nothing else changes.
CREATE OR REPLACE FUNCTION private.normalized_pitch_scene(scene JSONB)
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
SET search_path = public, extensions, pg_temp
AS $$
  SELECT CASE
    WHEN private.pitch_scene_integer(scene -> 'schemaVersion') IN (2, 3)
      THEN private.canonical_pitch_json(scene)
    ELSE jsonb_build_object(
      'schemaVersion', 1,
      'canvas', jsonb_build_object(
        'width', private.pitch_scene_integer(scene -> 'canvas' -> 'width'),
        'height', private.pitch_scene_integer(scene -> 'canvas' -> 'height'),
        'fps', private.pitch_scene_integer(scene -> 'canvas' -> 'fps')
      ),
      'durationMs', private.pitch_scene_integer(scene -> 'durationMs'),
      'scenes', (
        SELECT jsonb_agg(
                 jsonb_build_object(
                   'assetId', lower(entry.value ->> 'assetId'),
                   'startMs', private.pitch_scene_integer(entry.value -> 'startMs'),
                   'endMs', private.pitch_scene_integer(entry.value -> 'endMs')
                 )
                 ORDER BY entry.ord
               )
          FROM jsonb_array_elements(scene -> 'scenes')
               WITH ORDINALITY AS entry(value, ord)
      )
    )
  END
  WHERE scene IS NOT NULL;
$$;

COMMENT ON FUNCTION private.normalized_pitch_scene(JSONB) IS
  'Canonical form of a validated scene of any version: the explicit v1 rebuild from 0048, or the generic canonical walk for v2 and v3. NULL in, NULL out.';

DROP FUNCTION private.assert_scene_definition(JSONB, INTEGER, UUID[], JSONB, JSONB);

CREATE FUNCTION private.assert_scene_definition(
  scene JSONB,
  duration_ms_expected INTEGER,
  photo_asset_ids UUID[],
  transcript JSONB,
  structure JSONB,
  video_asset_ids UUID[]
)
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  violation TEXT;
BEGIN
  violation := private.pitch_scene_violation(
    scene, duration_ms_expected, photo_asset_ids, transcript, structure,
    video_asset_ids
  );
  IF violation IS NOT NULL THEN
    RAISE EXCEPTION '%', violation;
  END IF;
  RETURN private.normalized_pitch_scene(scene);
END;
$$;

REVOKE ALL ON FUNCTION
  private.assert_scene_definition(JSONB, INTEGER, UUID[], JSONB, JSONB, UUID[])
  FROM PUBLIC;

COMMENT ON FUNCTION
  private.assert_scene_definition(JSONB, INTEGER, UUID[], JSONB, JSONB, UUID[]) IS
  'Validates a client-supplied PitchScene payload of any version against the row it is being written onto and returns its canonical form, or raises the pinned rejection message. Returns NULL for a NULL scene.';

-- ── submit_pitch_for_consent (full redefinition from 0049) ───────────────
-- Signature unchanged, so CREATE OR REPLACE keeps every grant and every call
-- site. Two changes: the draft's ready clips travel with the scene, and a video
-- is no longer expected to carry a media_validations row.
CREATE OR REPLACE FUNCTION public.submit_pitch_for_consent(
  draft_id UUID,
  invite_channel TEXT DEFAULT NULL,
  invite_contact TEXT DEFAULT NULL,
  invite_friend_name TEXT DEFAULT NULL,
  new_scene JSONB DEFAULT NULL
)
RETURNS TABLE (consent_request_id UUID, consent_token TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  caller UUID := auth.uid();
  draft pitch_drafts;
  existing_request consent_requests;
  raw_token TEXT;
  contact_hash TEXT;
  snapshot_asset_ids UUID[];
  snapshot_photo_asset_ids UUID[];
  snapshot_video_asset_ids UUID[];
  snapshot_voice_asset_path TEXT;
  next_revision_number INTEGER;
  new_revision_id UUID;
  new_request_id UUID;
  canonical_content JSONB;
  final_scene JSONB;
  final_scene_hash TEXT;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;
  PERFORM private.assert_active_account(caller);

  IF (invite_channel IS NULL) <> (invite_contact IS NULL) THEN
    RAISE EXCEPTION 'invite channel and contact must be provided together';
  END IF;
  IF invite_channel IS NOT NULL THEN
    contact_hash := encode(
      digest(private.canonicalize_contact(invite_channel, invite_contact), 'sha256'),
      'hex'
    );
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(draft_id::TEXT, 0)
  );

  SELECT * INTO draft
    FROM pitch_drafts
   WHERE id = draft_id
     AND created_by_user_id = caller
     AND status IN ('draft', 'changes_requested')
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'draft not found, not owned by caller, or not submittable';
  END IF;
  IF nullif(btrim(draft.headline), '') IS NULL
     OR nullif(btrim(draft.body), '') IS NULL THEN
    RAISE EXCEPTION 'complete the AI draft or direct writing before requesting consent';
  END IF;

  IF private.media_validation_enforcement() AND EXISTS (
    SELECT 1
      FROM pitch_assets asset
     WHERE asset.pitch_draft_id = draft.id
       -- A video carries no media_validations row: its structural checks are the
       -- probe and its moderation is per frame, and both verdicts live on
       -- pitch_video_ingests. Requiring a row here would make a draft with a
       -- clip unsubmittable; the clip's own gate is the ingest verdict, which
       -- decides whether a scene may reference it at all.
       AND asset.asset_type <> 'video'
       AND NOT EXISTS (
         SELECT 1
           FROM media_validations validation
          WHERE validation.bucket_id = 'pitch-media'
            AND validation.object_name = CASE
              WHEN asset.storage_path LIKE 'pitch-media/%'
                THEN substr(asset.storage_path, length('pitch-media/') + 1)
              ELSE asset.storage_path
            END
            AND validation.mime_ok
            AND validation.magic_ok
            AND validation.size_ok
            AND validation.decode_ok
            AND validation.moderation_status = 'passed'
       )
  ) THEN
    RAISE EXCEPTION 'pitch media requires completed validation';
  END IF;

  SELECT
    coalesce(array_agg(id ORDER BY id), ARRAY[]::UUID[]),
    coalesce(
      array_agg(id ORDER BY id) FILTER (WHERE asset_type = 'photo'),
      ARRAY[]::UUID[]
    ),
    (
      array_agg(storage_path ORDER BY sort_order, id)
        FILTER (WHERE asset_type = 'voice')
    )[1]
    INTO snapshot_asset_ids, snapshot_photo_asset_ids, snapshot_voice_asset_path
    FROM pitch_assets
   WHERE pitch_draft_id = draft.id;

  -- The clips a v3 scene may reference: this draft's videos whose ingest
  -- SUCCEEDED, which includes frame moderation. One predicate decides
  -- readiness (0050), so a pending, flagged or failed clip is simply absent
  -- from the list and a scene pointing at one is refused by name.
  snapshot_video_asset_ids := private.pitch_ready_video_asset_ids(
    draft.id, snapshot_asset_ids
  );

  -- The duration comes from the draft transcript, which the insert trigger
  -- (0032) freezes onto this revision, so the scene and the captions the player
  -- derives are measured against the same segments forever.
  final_scene := private.assert_scene_definition(
    new_scene,
    private.pitch_transcript_duration_ms(draft.transcript),
    snapshot_photo_asset_ids,
    draft.transcript,
    draft.structure,
    snapshot_video_asset_ids
  );
  IF final_scene IS NOT NULL THEN
    final_scene_hash := encode(digest(final_scene::TEXT, 'sha256'), 'hex');
  END IF;

  SELECT coalesce(max(revision_number), 0) + 1 INTO next_revision_number
    FROM consent_revisions
   WHERE pitch_draft_id = draft.id;

  canonical_content := jsonb_build_object(
    'headline', draft.headline,
    'body', draft.body,
    'structure', draft.structure,
    'asset_ids', to_jsonb(snapshot_asset_ids),
    'voice_asset_path', snapshot_voice_asset_path,
    'scene', final_scene
  );

  INSERT INTO consent_revisions (
    pitch_draft_id,
    revision_number,
    headline,
    body,
    structure,
    asset_ids,
    voice_asset_path,
    scene_definition,
    scene_hash,
    content_hash
  )
  VALUES (
    draft.id,
    next_revision_number,
    draft.headline,
    draft.body,
    draft.structure,
    snapshot_asset_ids,
    snapshot_voice_asset_path,
    final_scene,
    final_scene_hash,
    encode(digest(canonical_content::TEXT, 'sha256'), 'hex')
  )
  RETURNING id INTO new_revision_id;

  SELECT * INTO existing_request
    FROM consent_requests
   WHERE pitch_draft_id = draft.id
   FOR UPDATE;

  IF existing_request.id IS NULL THEN
    raw_token := replace(replace(encode(gen_random_bytes(24), 'base64'), '+', '-'), '/', '_');
    raw_token := replace(raw_token, '=', '');

    INSERT INTO consent_requests (
      pitch_draft_id,
      token_hash,
      status,
      revision_id,
      invite_contact_channel,
      invite_contact_hash,
      invite_friend_name
    )
    VALUES (
      draft.id,
      encode(digest(raw_token, 'sha256'), 'hex'),
      'pending',
      new_revision_id,
      invite_channel,
      contact_hash,
      nullif(btrim(invite_friend_name), '')
    )
    RETURNING id INTO new_request_id;
  ELSE
    new_request_id := existing_request.id;
    UPDATE consent_requests
       SET revision_id = new_revision_id,
           status = CASE
             WHEN subject_user_id IS NULL THEN 'pending'
             ELSE 'claimed'
           END,
           response_note = NULL,
           responded_at = NULL
     WHERE id = existing_request.id;
  END IF;

  UPDATE pitch_drafts SET status = 'consent_pending' WHERE id = draft.id;

  RETURN QUERY SELECT new_request_id, raw_token;
END;
$$;

COMMENT ON FUNCTION public.submit_pitch_for_consent(UUID, TEXT, TEXT, TEXT, JSONB) IS
  'Pitch photo/audio validation is fail-closed only while media_validation_enforcement is on. new_scene attaches the Introducer-built PitchScene timeline (v1, v2 or v3) to the first revision; it is rejected unless it covers exactly the transcript duration under the mechanical rules for its version, and a v2 or v3 scene may only reference words this recording actually timed, structure fields this draft actually carries, and video clips whose ingest succeeded. Omitting it publishes without motion.';

-- ── create_dater_revision (full redefinition from 0049) ─────────────────
-- Signature unchanged. The snapshot's ready clips reach both validator calls,
-- so a clip the Dater dropped — or one that was flagged after the Introducer
-- built the timeline — demotes the carried-forward scene to no motion exactly
-- as a dropped photo does.
CREATE OR REPLACE FUNCTION public.create_dater_revision(
  draft_id UUID,
  new_headline TEXT,
  new_body TEXT,
  included_asset_ids UUID[] DEFAULT NULL,
  new_structure JSONB DEFAULT NULL,
  retained_hard_claims TEXT[] DEFAULT NULL,
  new_scene JSONB DEFAULT NULL
)
RETURNS TABLE (revision_id UUID, revision_number INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  caller UUID := auth.uid();
  draft pitch_drafts;
  request consent_requests;
  latest consent_revisions;
  snapshot_asset_ids UUID[];
  snapshot_photo_asset_ids UUID[];
  snapshot_video_asset_ids UUID[];
  next_revision_number INTEGER;
  new_revision_id UUID;
  canonical_content JSONB;
  is_dater_edited BOOLEAN;
  reviewed_structure BOOLEAN;
  normalized_structure JSONB;
  final_structure JSONB;
  published_structure JSONB;
  prior_published_structure JSONB;
  prior_hard_claims JSONB;
  final_hard_claims JSONB;
  effective_headline TEXT;
  effective_body TEXT;
  prior_headline TEXT;
  prior_body TEXT;
  moderation_text TEXT;
  scene_duration_ms INTEGER;
  final_scene JSONB;
  final_scene_hash TEXT;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;
  PERFORM private.assert_active_account(caller);

  -- Ownership is settled before any input validation, so the RPC cannot be
  -- used as a free structure validator against someone else's draft.
  SELECT * INTO draft
    FROM pitch_drafts
   WHERE id = draft_id
     AND subject_user_id = caller
     AND status = 'consent_pending'
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'draft not found, not yours to edit, or not in consent review';
  END IF;

  SELECT * INTO request
    FROM consent_requests
   WHERE pitch_draft_id = draft.id
     AND subject_user_id = caller
   FOR UPDATE;
  IF request.id IS NULL THEN
    RAISE EXCEPTION 'consent request not found for this draft';
  END IF;

  SELECT * INTO latest
    FROM consent_revisions
   WHERE id = request.revision_id;
  IF latest.id IS NULL THEN
    RAISE EXCEPTION 'current consent revision not found';
  END IF;

  -- Merge order matters: the prior structure supplies every AI-owned key and
  -- the five validated fields override it. A client-sent hard_claims value is
  -- absent from normalized_structure, so it can never win here.
  IF new_structure IS NULL THEN
    final_structure := latest.structure;
  ELSE
    normalized_structure := private.normalized_dater_pitch_structure(new_structure);
    final_structure := coalesce(latest.structure, '{}'::JSONB) || normalized_structure;
  END IF;

  -- Per-claim disposition. The Dater may drop a flagged claim they removed
  -- from their words, but may never introduce one: every retained value has to
  -- appear in the prior revision's flagged list. NULL (the default) means "no
  -- disposition given" and keeps the whole list; an empty array means "I
  -- removed all of them" and is a different, valid answer.
  prior_hard_claims := CASE
    WHEN jsonb_typeof(latest.structure -> 'hard_claims_requiring_confirmation') = 'array'
      THEN latest.structure -> 'hard_claims_requiring_confirmation'
    ELSE '[]'::JSONB
  END;
  IF retained_hard_claims IS NULL THEN
    final_hard_claims := prior_hard_claims;
  ELSE
    IF EXISTS (
      SELECT 1
        FROM unnest(retained_hard_claims) AS retained(value)
       WHERE retained.value IS NULL
          OR NOT EXISTS (
            SELECT 1
              FROM jsonb_array_elements_text(prior_hard_claims) AS flagged(value)
             WHERE flagged.value = retained.value
          )
    ) THEN
      RAISE EXCEPTION 'hard claim is not one of the flagged claims';
    END IF;
    final_hard_claims := to_jsonb(retained_hard_claims);
  END IF;
  -- A revision with no structure at all keeps none: fabricating one for a
  -- headline/body-only pitch would change what publish copies forward.
  IF final_structure IS NOT NULL THEN
    final_structure := final_structure
      || jsonb_build_object('hard_claims_requiring_confirmation', final_hard_claims);
  END IF;

  -- Whenever the revision carries the five published fields, they ARE the
  -- pitch: headline/body are derived from them on every path, so a legacy
  -- 4-argument call can no longer store client copy while publishing the AI's
  -- sentences. new_headline/new_body are consulted only for a revision that
  -- has no published structure at all.
  published_structure := private.dater_pitch_published_structure(final_structure);
  prior_published_structure := private.dater_pitch_published_structure(latest.structure);

  IF published_structure IS NULL THEN
    IF private.pitch_text_is_blank(new_headline)
       OR private.pitch_text_is_blank(new_body) THEN
      RAISE EXCEPTION 'headline and body are required';
    END IF;
    IF char_length(new_headline) > 120 OR char_length(new_body) > 2000 THEN
      RAISE EXCEPTION 'headline or body is too long';
    END IF;
    effective_headline := btrim(new_headline);
    effective_body := btrim(new_body);
  ELSE
    effective_headline := published_structure ->> 'hook';
    effective_body := private.dater_pitch_body_from_structure(published_structure);
  END IF;

  IF prior_published_structure IS NULL THEN
    prior_headline := btrim(latest.headline);
    prior_body := btrim(latest.body);
  ELSE
    prior_headline := prior_published_structure ->> 'hook';
    prior_body := private.dater_pitch_body_from_structure(prior_published_structure);
  END IF;

  IF included_asset_ids IS NULL THEN
    SELECT coalesce(array_agg(id ORDER BY id), ARRAY[]::UUID[])
      INTO snapshot_asset_ids
      FROM pitch_assets
     WHERE pitch_draft_id = draft.id;
  ELSE
    IF EXISTS (
      SELECT 1
        FROM unnest(included_asset_ids) candidate_id
        LEFT JOIN pitch_assets asset
          ON asset.id = candidate_id AND asset.pitch_draft_id = draft.id
       WHERE asset.id IS NULL
    ) THEN
      RAISE EXCEPTION 'included assets must belong to this draft';
    END IF;
    -- Auto-include the introducer's voice asset(s) so a photos-only list can
    -- never drop the original voice and have approval delete the row.
    SELECT coalesce(array_agg(DISTINCT merged_id ORDER BY merged_id), ARRAY[]::UUID[])
      INTO snapshot_asset_ids
      FROM (
        SELECT candidate_id AS merged_id FROM unnest(included_asset_ids) candidate_id
        UNION
        SELECT id AS merged_id
          FROM pitch_assets
         WHERE pitch_draft_id = draft.id
           AND asset_type = 'voice'
      ) merged;
  END IF;

  -- The photos of THIS snapshot, which is what a scene may reference. A photo
  -- the Dater just dropped is gone from here, which is what makes the
  -- carry-forward below re-validate instead of trusting the old timeline.
  SELECT coalesce(array_agg(id ORDER BY id), ARRAY[]::UUID[])
    INTO snapshot_photo_asset_ids
    FROM pitch_assets
   WHERE pitch_draft_id = draft.id
     AND asset_type = 'photo'
     AND id = ANY(snapshot_asset_ids);

  -- The clips of THIS snapshot, on the same rule as the photos above: a clip the
  -- Dater just dropped, or one whose ingest is no longer 'succeeded', is gone
  -- from here, which is what makes the carry-forward below demote a scene that
  -- still points at it instead of trusting the old timeline.
  snapshot_video_asset_ids := private.pitch_ready_video_asset_ids(
    draft.id, snapshot_asset_ids
  );

  -- The transcript is carried forward verbatim below, so the duration a scene
  -- must match never moves inside one consent review.
  scene_duration_ms := private.pitch_transcript_duration_ms(latest.transcript);

  IF new_scene IS NOT NULL THEN
    final_scene := private.assert_scene_definition(
      new_scene, scene_duration_ms, snapshot_photo_asset_ids,
      latest.transcript, final_structure, snapshot_video_asset_ids
    );
  ELSIF latest.scene_definition IS NOT NULL THEN
    -- Carry the reviewed timeline forward, but re-check it against the NEW
    -- snapshot: a save that drops a photo the scene still points at would
    -- otherwise leave a dangling reference once approval deletes that asset.
    -- Demotion to NULL (no motion) is the safe answer — refusing the save
    -- would trap a Dater who simply removed a photo.
    IF private.pitch_scene_violation(
         latest.scene_definition, scene_duration_ms, snapshot_photo_asset_ids,
         latest.transcript, final_structure, snapshot_video_asset_ids
       ) IS NULL THEN
      final_scene := private.normalized_pitch_scene(latest.scene_definition);
    END IF;
  END IF;
  IF final_scene IS NOT NULL THEN
    final_scene_hash := encode(digest(final_scene::TEXT, 'sha256'), 'hex');
  END IF;

  moderation_text := private.dater_revision_moderation_text(
    effective_headline, effective_body, published_structure
  );

  IF private.media_validation_enforcement() THEN
    IF NOT private.pitch_photos_validated(snapshot_asset_ids) THEN
      RAISE EXCEPTION 'photos must pass validation before they can enter a revision';
    END IF;
    -- Unconditional, including on a photo-only save: every revision must carry
    -- a passed verdict for the exact words it publishes. A save that repeats
    -- the prior revision's words now looks up the SAME hash the edit
    -- registered, so this no longer locks the Dater out — but text that
    -- entered while enforcement was off still has to earn a verdict on the
    -- first save after the switch is flipped. The web client must therefore
    -- moderate the string it is about to save on every save, not only when the
    -- text changed.
    IF NOT private.text_moderation_passed('pitch_content', moderation_text) THEN
      RAISE EXCEPTION 'pitch text requires a passed moderation verdict';
    END IF;
  END IF;

  is_dater_edited := (effective_headline IS DISTINCT FROM prior_headline)
    OR (effective_body IS DISTINCT FROM prior_body)
    OR (final_structure IS DISTINCT FROM latest.structure);

  -- Sticky within one consent review: once the Dater has submitted the five
  -- fields, a later photo-only save carries that same structure forward, so
  -- the structure on the page is still the one they reviewed.
  reviewed_structure := (new_structure IS NOT NULL) OR latest.structure_reviewed;

  SELECT coalesce(max(consent_revisions.revision_number), 0) + 1
    INTO next_revision_number
    FROM consent_revisions
   WHERE pitch_draft_id = draft.id;

  canonical_content := jsonb_build_object(
    'headline', effective_headline,
    'body', effective_body,
    'structure', final_structure,
    'asset_ids', to_jsonb(snapshot_asset_ids),
    'voice_asset_path', latest.voice_asset_path,
    'scene', final_scene
  );

  INSERT INTO consent_revisions (
    pitch_draft_id,
    revision_number,
    headline,
    body,
    structure,
    asset_ids,
    voice_asset_path,
    transcript,
    scene_definition,
    scene_hash,
    content_hash,
    dater_edited,
    structure_reviewed
  )
  VALUES (
    draft.id,
    next_revision_number,
    effective_headline,
    effective_body,
    final_structure,
    snapshot_asset_ids,
    latest.voice_asset_path,
    latest.transcript,
    final_scene,
    final_scene_hash,
    encode(digest(canonical_content::TEXT, 'sha256'), 'hex'),
    is_dater_edited,
    reviewed_structure
  )
  RETURNING id INTO new_revision_id;

  UPDATE consent_requests
     SET revision_id = new_revision_id
   WHERE id = request.id;

  RETURN QUERY SELECT new_revision_id, next_revision_number;
END;
$$;

COMMENT ON FUNCTION
  public.create_dater_revision(UUID, TEXT, TEXT, UUID[], JSONB, TEXT[], JSONB) IS
  'Creates the Dater-approved consent revision. Whenever the revision structure carries the five published fields, headline/body are derived from it and new_headline/new_body are ignored — on the legacy 4-argument path too. retained_hard_claims dispositions the flagged claim list: NULL keeps it, an array narrows it to exactly those claims, and a value that was not already flagged is rejected. new_scene replaces the reviewed motion timeline; omitting it carries the previous one forward only while it still validates against the new snapshot — every photo and clip it references survives, and every word or structure field it references still resolves — and otherwise stores no scene.';

-- ── approve_and_publish_pitch (full redefinition from 0049) ─────────────
-- One change: a v3 scene's photo header is read the same way a v2 one is.
CREATE OR REPLACE FUNCTION public.approve_and_publish_pitch(
  draft_id UUID,
  campaign_days INTEGER,
  revision_id UUID,
  included_asset_ids UUID[],
  hard_claims_confirmed BOOLEAN
)
RETURNS TABLE (campaign_id UUID, campaign_slug TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  caller UUID := auth.uid();
  draft pitch_drafts;
  request consent_requests;
  approved_revision consent_revisions;
  new_campaign_id UUID;
  new_slug TEXT;
  dater_name TEXT;
  dater_birth_date DATE;
  scene_photo_ids UUID[];
  approved_photo_ids UUID[];
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;
  PERFORM private.assert_active_account(caller);

  -- CP-1: publishing is adults-only. The dater's confirmed birth date must
  -- put them at 18+. Enforced here (not only in set_dater_profile) because a
  -- direct birth_date write must never bypass the gate.
  SELECT birth_date INTO dater_birth_date FROM profiles WHERE user_id = caller;
  IF dater_birth_date IS NULL
     OR date_part('year', age(dater_birth_date))::INTEGER < 18 THEN
    RAISE EXCEPTION 'confirm an adult (18+) birth date before publishing';
  END IF;

  IF campaign_days IS NULL OR campaign_days NOT IN (7, 14) THEN
    RAISE EXCEPTION 'campaign_days must be 7 or 14';
  END IF;
  IF included_asset_ids IS NULL OR coalesce(array_length(included_asset_ids, 1), 0) < 1 THEN
    RAISE EXCEPTION 'publishing requires at least one approved photo';
  END IF;

  SELECT * INTO draft
    FROM pitch_drafts
   WHERE id = draft_id
     AND subject_user_id = caller
     AND status = 'consent_pending'
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'draft not found, not yours to approve, or not awaiting consent';
  END IF;
  IF draft.publish_days IS NOT NULL AND draft.publish_days IS DISTINCT FROM campaign_days THEN
    RAISE EXCEPTION 'campaign_days must match the configured publish preference';
  END IF;

  SELECT * INTO request
    FROM consent_requests
   WHERE pitch_draft_id = draft.id
     AND subject_user_id = caller
   FOR UPDATE;
  IF request.id IS NULL OR request.revision_id IS DISTINCT FROM revision_id THEN
    RAISE EXCEPTION 'approval requires the latest consent revision';
  END IF;

  SELECT * INTO approved_revision
    FROM consent_revisions
   WHERE id = revision_id
     AND pitch_draft_id = draft.id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'approval revision does not belong to this draft';
  END IF;

  IF NOT (included_asset_ids <@ approved_revision.asset_ids)
     OR EXISTS (
       SELECT 1
         FROM unnest(included_asset_ids) included_asset_id
         LEFT JOIN pitch_assets asset
           ON asset.id = included_asset_id
          AND asset.pitch_draft_id = draft.id
        WHERE asset.id IS NULL OR asset.asset_type <> 'photo'
     ) THEN
    RAISE EXCEPTION 'included assets must be reviewed photo assets from the revision';
  END IF;

  -- Set equality, both directions. A scene photo missing from the approved set
  -- would be deleted below and leave a dangling reference; an approved photo
  -- missing from the scene would publish a photo that never appears in the
  -- motion the Dater watched.
  IF approved_revision.scene_definition IS NOT NULL THEN
    -- v2 AND v3 both carry the authoritative photo list in the assetIds
    -- header, which is the reason the header exists. A v3 scene's clips are NOT
    -- in it and are NOT deleted below: the DELETE only drops photos outside the
    -- approved set, so a reviewed clip survives approval exactly as the voice
    -- asset does.
    IF private.pitch_scene_integer(
         approved_revision.scene_definition -> 'schemaVersion'
       ) IN (2, 3) THEN
      SELECT coalesce(array_agg(asset_id ORDER BY asset_id), ARRAY[]::UUID[])
        INTO scene_photo_ids
        FROM (
          SELECT DISTINCT (listed.value #>> '{}')::UUID AS asset_id
            FROM jsonb_array_elements(
                   approved_revision.scene_definition -> 'assetIds'
                 ) AS listed(value)
        ) AS scene_photo;
    ELSE
      SELECT coalesce(array_agg(asset_id ORDER BY asset_id), ARRAY[]::UUID[])
        INTO scene_photo_ids
        FROM (
          SELECT DISTINCT (entry.value ->> 'assetId')::UUID AS asset_id
            FROM jsonb_array_elements(
                   approved_revision.scene_definition -> 'scenes'
                 ) AS entry(value)
        ) AS scene_photo;
    END IF;
    SELECT coalesce(array_agg(asset_id ORDER BY asset_id), ARRAY[]::UUID[])
      INTO approved_photo_ids
      FROM (
        SELECT DISTINCT candidate_id AS asset_id
          FROM unnest(included_asset_ids) candidate_id
      ) AS approved_photo;
    IF scene_photo_ids IS DISTINCT FROM approved_photo_ids THEN
      RAISE EXCEPTION 'approved photos must match the reviewed motion scene photos';
    END IF;
  END IF;

  IF private.media_validation_enforcement()
     AND NOT private.pitch_photos_validated(included_asset_ids) THEN
    RAISE EXCEPTION 'included photos must pass validation before publish';
  END IF;

  IF (
    coalesce(
      jsonb_array_length(
        CASE
          WHEN jsonb_typeof(
            approved_revision.structure -> 'hard_claims_requiring_confirmation'
          ) = 'array'
            THEN approved_revision.structure -> 'hard_claims_requiring_confirmation'
          ELSE '[]'::JSONB
        END
      ),
      0
    ) > 0
    OR approved_revision.dater_edited
  ) AND hard_claims_confirmed IS NOT TRUE THEN
    RAISE EXCEPTION 'hard claims require confirmation before approval';
  END IF;

  IF private.identity_enforcement() THEN
    PERFORM private.assert_identity_evidence(caller);
  END IF;

  DELETE FROM pitch_assets
   WHERE pitch_draft_id = draft.id
     AND (
       NOT (id = ANY(approved_revision.asset_ids))
       OR (asset_type = 'photo' AND NOT (id = ANY(included_asset_ids)))
     );

  UPDATE pitch_drafts
     SET headline = approved_revision.headline,
         body = approved_revision.body,
         structure = approved_revision.structure,
         transcript = approved_revision.transcript,
         structure_reviewed = approved_revision.structure_reviewed,
         scene_definition = approved_revision.scene_definition,
         scene_hash = approved_revision.scene_hash,
         status = 'published'
   WHERE id = draft.id;

  UPDATE consent_requests
     SET status = 'approved',
         responded_at = now(),
         response_note = NULL
   WHERE id = request.id;

  SELECT display_name INTO dater_name FROM profiles WHERE user_id = caller;
  new_slug := private.generate_campaign_slug(dater_name);

  INSERT INTO campaigns (
    pitch_draft_id, owner_user_id, status, published_at, slug, ends_at,
    audience_policy, location_precision
  )
  VALUES (
    draft.id, caller, 'published', now(), new_slug,
    now() + make_interval(days => campaign_days),
    draft.audience_policy, coalesce(draft.location_precision, 'city')
  )
  ON CONFLICT (pitch_draft_id) DO UPDATE
    SET status = 'published',
        published_at = now(),
        slug = coalesce(campaigns.slug, EXCLUDED.slug),
        ends_at = EXCLUDED.ends_at,
        audience_policy = EXCLUDED.audience_policy,
        location_precision = EXCLUDED.location_precision
    WHERE campaigns.owner_user_id = EXCLUDED.owner_user_id
  RETURNING id, slug INTO new_campaign_id, new_slug;

  IF new_campaign_id IS NULL THEN
    RAISE EXCEPTION 'existing campaign for this pitch belongs to another owner';
  END IF;

  INSERT INTO campaign_memberships (campaign_id, user_id, role)
  VALUES
    (new_campaign_id, caller, 'DATER_OWNER'),
    (new_campaign_id, draft.created_by_user_id, 'INTRODUCER')
  ON CONFLICT (campaign_id, user_id) DO NOTHING;

  RETURN QUERY SELECT new_campaign_id, new_slug;
END;
$$;

COMMENT ON FUNCTION
  public.approve_and_publish_pitch(UUID, INTEGER, UUID, UUID[], BOOLEAN) IS
  'Publishes exactly the approved revision, including its reviewed motion timeline. When the revision carries a scene, included_asset_ids must be the same set of photos the scene references — the assetIds header for v2 and v3, the scene entries for v1 — because this RPC deletes the photos outside that set and a mismatch would publish a timeline with dangling references.';

-- ── 9. What Phase 3b inherits ───────────────────────────────────────────
-- The v3 builder (mobile), clip playback (web and mobile), the consent-time face
-- blur toggle and the include/exclude widening all land on top of this
-- migration. Three things here are contracts they must not renegotiate:
--
--   * pitch_video_ingests.face_boxes never reaches a client. The blur variant is
--     rendered server-side from the permanent no-blur proxy.
--   * A clip is usable only at private.pitch_video_ingest_succeeded. Nothing
--     should grow a second definition of "ready".
--   * private.pitch_scene_violation is the one validator. A v4 shot level is a
--     branch in it, not a new function.

-- ── remove_pitch_draft_asset learns about video ─────────────────────────────
-- 0050's consent gate refuses a draft that carries a FLAGGED clip, but 0046's
-- removal RPC allowed only photos — so an introducer whose clip was flagged
-- had no way to detach it and was permanently locked out of consent. Video
-- removal follows the photo rules exactly (creator-owned, draft or
-- changes_requested, uploader-only); the voice recording stays irremovable.
-- Cleanup needs no code here: pitch_video_ingests and media_ingest_jobs both
-- reference pitch_assets(id) ON DELETE CASCADE, and the storage bytes go to
-- the orphan sweep (deleting storage.objects in SQL would orphan the bytes
-- beyond reclamation — 0046's reasoning, unchanged). A worker holding a lease
-- on a cascaded-away job will fail its complete call with "media ingest job
-- not found"; that is a no-op on a clip nobody references any more.
CREATE OR REPLACE FUNCTION public.remove_pitch_draft_asset(p_asset_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  caller UUID := auth.uid();
  asset pitch_assets;
  draft pitch_drafts;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;
  PERFORM private.assert_active_account(caller);

  SELECT * INTO asset FROM pitch_assets WHERE id = p_asset_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'pitch asset not found or not yours to remove';
  END IF;

  SELECT * INTO draft FROM pitch_drafts WHERE id = asset.pitch_draft_id;
  -- A non-creator gets the same message as a missing asset: the subject of a
  -- draft can read its assets, so a distinguishable refusal would only tell
  -- them which ids exist, which they can already see, but the creator check and
  -- the existence check answer alike on principle.
  IF NOT FOUND OR draft.created_by_user_id IS DISTINCT FROM caller THEN
    RAISE EXCEPTION 'pitch asset not found or not yours to remove';
  END IF;

  IF draft.status NOT IN ('draft', 'changes_requested') THEN
    RAISE EXCEPTION 'this pitch can no longer be edited';
  END IF;

  IF asset.asset_type = 'voice' THEN
    RAISE EXCEPTION 'the introducer voice recording cannot be removed';
  END IF;

  -- The subject may attach photos (and, since 0050, videos) of their own while
  -- a draft is consent_pending (policies pitch_assets_insert_subject, 0002 and
  -- 0050). Those are the subject's contribution to their own pitch; the
  -- creator does not get to delete them.
  IF asset.uploaded_by_user_id IS DISTINCT FROM caller THEN
    RAISE EXCEPTION 'only the uploader can remove this pitch asset';
  END IF;

  DELETE FROM pitch_assets WHERE id = p_asset_id;
END;
$$;

COMMENT ON FUNCTION public.remove_pitch_draft_asset(UUID) IS
  'Detaches a photo or video the caller uploaded to their own pitch draft while it is still editable (draft or changes_requested). Voice assets are never removable. Deletes the pitch_assets row only; ingest rows and jobs follow by cascade, and the storage object is left for the orphan sweep, which reclaims bytes through the Storage API.';
