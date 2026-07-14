-- Third audit (docs/FRIENDWORD_THIRD_AUDIT_HANDOFF_2026-07-14.md §3
-- P0-NEW-1, P0-NEW-2) Slice 1: the 0031 provider ledger granted
-- reserve_provider_usage / reconcile_provider_usage to `authenticated`
-- and let the caller pick usage_kind, estimated_cents, request_ref and
-- final_status. That is not a hard cap:
--
--   Threat model closed here
--   - A signed-in user could burn the global monthly cap with a single
--     direct RPC (estimated_cents = 20000) — no provider call needed.
--   - A user could reconcile their own reservation to actual_cents = 0,
--     'released' and erase spend from the cap.
--   - Concurrent requests with the same request_ref each got a live
--     reservation and could call the provider more than once.
--   - A failed/timeout attempt reconciled to actual_cents = 0 dropped
--     provider charges the vendor already billed off the cap.
--   - Consent was gated only on ('transcribe','structure') and accepted
--     any non-empty revision string, so a photo could reach OpenAI with
--     no current-revision consent, and a stale revision consented once
--     authorized processing forever.
--
--   Contract after this migration
--   - reserve/reconcile are service_role ONLY. The API route (never the
--     client) supplies the authoritative user, kind, scope and estimate.
--   - Every request_ref carries an atomic lease + owner + attempt state.
--     Exactly one active attempt may call the provider; concurrent and
--     replayed calls are told granted = false.
--   - 'succeeded' replays return the stored result and never re-arm.
--   - failed/timeout reconciles keep GREATEST(actual, estimated) on the
--     cap (conservative accounting — decision §3.5). Only 'released'
--     (a path that made no provider call at all) zeroes the cost.
--   - A single reconcile requires the matching lease_token, so a stale
--     attempt cannot overwrite the winner's outcome.
--   - AI-processing consent is gated for EVERY kind, bound to the server's
--     current disclosure revision, for the draft scope or the caller's own
--     content. Stale-revision or arbitrary-string consent is rejected.

-- ── Lease / attempt state on the ledger ──────────────────────────────
ALTER TABLE public.provider_usage_events
  ADD COLUMN lease_token UUID,
  ADD COLUMN lease_expires_at TIMESTAMPTZ,
  ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 1;

-- ── Disclosure revision the server currently accepts ─────────────────
INSERT INTO public.app_config (key, value)
VALUES ('ai_disclosure_current_revision', '2026-07-14')
ON CONFLICT (key) DO NOTHING;

-- ── Consent scope: draft-scoped OR the caller's own content ──────────
-- own_content covers reservations with no pitch draft (e.g. a media
-- moderation reservation the owner makes over their own upload before a
-- draft exists). pitch_draft rows keep pointing at a specific draft.
ALTER TABLE public.ai_processing_consents
  ADD COLUMN scope_kind TEXT NOT NULL DEFAULT 'pitch_draft'
    CHECK (scope_kind IN ('pitch_draft', 'own_content'));

ALTER TABLE public.ai_processing_consents
  ALTER COLUMN pitch_draft_id DROP NOT NULL;

ALTER TABLE public.ai_processing_consents
  ADD CONSTRAINT ai_processing_consents_scope_draft_agree
    CHECK ((scope_kind = 'pitch_draft') = (pitch_draft_id IS NOT NULL));

-- Replace the single UNIQUE(user_id, pitch_draft_id, consent_revision)
-- with one partial unique index per scope (own_content has no draft).
DO $$
DECLARE
  cname TEXT;
BEGIN
  SELECT conname INTO cname
    FROM pg_constraint
   WHERE conrelid = 'public.ai_processing_consents'::regclass
     AND contype = 'u';
  IF cname IS NOT NULL THEN
    EXECUTE format(
      'ALTER TABLE public.ai_processing_consents DROP CONSTRAINT %I', cname
    );
  END IF;
END;
$$;

CREATE UNIQUE INDEX ai_processing_consents_draft_scope_key
  ON public.ai_processing_consents (user_id, pitch_draft_id, consent_revision)
  WHERE scope_kind = 'pitch_draft';

CREATE UNIQUE INDEX ai_processing_consents_own_scope_key
  ON public.ai_processing_consents (user_id, consent_revision)
  WHERE scope_kind = 'own_content';

-- ── Server-owned disclosure revision reader ──────────────────────────
CREATE FUNCTION public.get_ai_disclosure_revision()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
  SELECT value FROM public.app_config
   WHERE key = 'ai_disclosure_current_revision';
$$;

REVOKE ALL ON FUNCTION public.get_ai_disclosure_revision() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_ai_disclosure_revision()
  TO anon, authenticated;

-- ── Consent recorders (client-facing, still authenticated) ───────────
-- Draft-scoped consent. Rejects any revision that is not the server's
-- current disclosure revision (arbitrary strings can no longer authorize
-- processing forever — audit acceptance).
CREATE OR REPLACE FUNCTION public.record_ai_processing_consent(
  target_draft_id UUID,
  target_consent_revision TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  caller UUID := auth.uid();
  current_revision TEXT;
  consent_id UUID;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;
  PERFORM private.assert_active_account(caller);

  current_revision := (
    SELECT value FROM public.app_config
     WHERE key = 'ai_disclosure_current_revision'
  );
  IF current_revision IS NULL THEN
    RAISE EXCEPTION 'AI disclosure revision is not configured';
  END IF;
  IF nullif(btrim(target_consent_revision), '') IS NULL
     OR btrim(target_consent_revision) IS DISTINCT FROM current_revision THEN
    RAISE EXCEPTION 'consent revision % is not the current disclosure revision',
      target_consent_revision;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.pitch_drafts
     WHERE id = target_draft_id AND created_by_user_id = caller
  ) THEN
    RAISE EXCEPTION 'draft not found or not owned by caller';
  END IF;

  INSERT INTO public.ai_processing_consents
    (user_id, pitch_draft_id, consent_revision, scope_kind)
  VALUES (caller, target_draft_id, current_revision, 'pitch_draft')
  ON CONFLICT (user_id, pitch_draft_id, consent_revision)
    WHERE scope_kind = 'pitch_draft'
  DO UPDATE SET consented_at = ai_processing_consents.consented_at
  RETURNING id INTO consent_id;

  RETURN consent_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_ai_processing_consent(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_ai_processing_consent(UUID, TEXT)
  TO authenticated;

-- Own-content consent (no draft). Same current-revision enforcement.
CREATE FUNCTION public.record_own_content_ai_consent(
  target_consent_revision TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  caller UUID := auth.uid();
  current_revision TEXT;
  consent_id UUID;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;
  PERFORM private.assert_active_account(caller);

  current_revision := (
    SELECT value FROM public.app_config
     WHERE key = 'ai_disclosure_current_revision'
  );
  IF current_revision IS NULL THEN
    RAISE EXCEPTION 'AI disclosure revision is not configured';
  END IF;
  IF nullif(btrim(target_consent_revision), '') IS NULL
     OR btrim(target_consent_revision) IS DISTINCT FROM current_revision THEN
    RAISE EXCEPTION 'consent revision % is not the current disclosure revision',
      target_consent_revision;
  END IF;

  INSERT INTO public.ai_processing_consents
    (user_id, pitch_draft_id, consent_revision, scope_kind)
  VALUES (caller, NULL, current_revision, 'own_content')
  ON CONFLICT (user_id, consent_revision)
    WHERE scope_kind = 'own_content'
  DO UPDATE SET consented_at = ai_processing_consents.consented_at
  RETURNING id INTO consent_id;

  RETURN consent_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_own_content_ai_consent(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_own_content_ai_consent(TEXT)
  TO authenticated;

-- ── Provider reservation (service_role ONLY) ─────────────────────────
-- Rewritten in full from the 0031 body (no partial patch). The caller is
-- the trusted API route, which passes the authoritative target_user_id;
-- auth.uid() is never consulted here.
DROP FUNCTION IF EXISTS public.reserve_provider_usage(TEXT, TEXT, INTEGER, UUID);

CREATE FUNCTION public.reserve_provider_usage(
  target_user_id UUID,
  usage_kind TEXT,
  request_ref TEXT,
  estimated_cents INTEGER,
  scope_draft_id UUID DEFAULT NULL
)
RETURNS TABLE(
  reservation_id UUID,
  prior_status TEXT,
  granted BOOLEAN,
  lease_token UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  current_revision TEXT;
  monthly_cap_cents INTEGER;
  hourly_limit INTEGER;
  spent_cents BIGINT;
  existing public.provider_usage_events;
  v_reservation_id UUID;
  v_prior_status TEXT;
  v_lease UUID;
BEGIN
  IF target_user_id IS NULL THEN
    RAISE EXCEPTION 'target_user_id is required';
  END IF;
  PERFORM private.assert_active_account(target_user_id);
  IF EXISTS (
    SELECT 1 FROM public.deletion_requests
     WHERE user_id = target_user_id AND status IN ('queued', 'processing')
  ) THEN
    RAISE EXCEPTION 'account deletion is in progress';
  END IF;

  IF usage_kind IS NULL
     OR usage_kind NOT IN ('transcribe', 'structure', 'moderate_text', 'media_validate') THEN
    RAISE EXCEPTION 'unknown provider usage kind %', usage_kind;
  END IF;
  IF nullif(btrim(reserve_provider_usage.request_ref), '') IS NULL THEN
    RAISE EXCEPTION 'request_ref is required';
  END IF;
  -- estimated_cents must be a real, bounded per-call estimate. 0 is
  -- forbidden (a zero-cost reservation could farm provider calls off the
  -- cap — audit finding) and 50 caps any single attempt.
  IF reserve_provider_usage.estimated_cents IS NULL
     OR reserve_provider_usage.estimated_cents < 1
     OR reserve_provider_usage.estimated_cents > 50 THEN
    RAISE EXCEPTION 'estimated_cents must be between 1 and 50';
  END IF;

  -- Kill switch: fail closed before a single provider byte is planned.
  IF coalesce(
    (SELECT value = 'on' FROM public.app_config WHERE key = 'provider_kill_switch'),
    false
  ) THEN
    RAISE EXCEPTION 'provider usage is disabled by the kill switch';
  END IF;

  -- External-AI consent gate for EVERY kind (P0-NEW-2). Bound to the
  -- server's current disclosure revision; a stale revision no longer
  -- qualifies.
  current_revision := (
    SELECT value FROM public.app_config
     WHERE key = 'ai_disclosure_current_revision'
  );
  IF current_revision IS NULL THEN
    RAISE EXCEPTION 'external AI processing consent is required — disclosure revision is not configured';
  END IF;

  IF scope_draft_id IS NOT NULL THEN
    -- Draft-scoped: the target user must own the draft. (Slice 2 will
    -- extend ownership to the dater subject; today only the draft creator
    -- may reserve draft-scoped provider work.)
    IF NOT EXISTS (
      SELECT 1 FROM public.pitch_drafts
       WHERE id = scope_draft_id AND created_by_user_id = target_user_id
    ) THEN
      RAISE EXCEPTION 'draft not found or not owned by target user';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.ai_processing_consents
       WHERE user_id = target_user_id
         AND pitch_draft_id = scope_draft_id
         AND scope_kind = 'pitch_draft'
         AND consent_revision = current_revision
    ) THEN
      RAISE EXCEPTION 'external AI processing consent is required for this draft';
    END IF;
  ELSE
    IF NOT EXISTS (
      SELECT 1 FROM public.ai_processing_consents
       WHERE user_id = target_user_id
         AND scope_kind = 'own_content'
         AND consent_revision = current_revision
    ) THEN
      RAISE EXCEPTION 'external AI processing consent is required for own content';
    END IF;
  END IF;

  -- Serialize the whole reservation window so cap accounting and the
  -- request_ref lease decision are atomic against concurrent callers.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('provider_usage_cap'));

  SELECT * INTO existing
    FROM public.provider_usage_events
   WHERE request_ref = reserve_provider_usage.request_ref
   FOR UPDATE;

  IF existing.id IS NOT NULL THEN
    IF existing.user_id IS DISTINCT FROM target_user_id THEN
      RAISE EXCEPTION 'request_ref belongs to another account';
    END IF;
    -- A completed call is never re-run; the route replays the stored result.
    IF existing.status = 'succeeded' THEN
      RETURN QUERY SELECT existing.id, 'succeeded'::TEXT, false, NULL::UUID;
      RETURN;
    END IF;
    -- A live reservation holds the call right; concurrent duplicates lose.
    IF existing.status = 'reserved' AND existing.lease_expires_at > now() THEN
      RETURN QUERY SELECT existing.id, 'reserved'::TEXT, false, NULL::UUID;
      RETURN;
    END IF;
    -- Otherwise re-arm: an expired reserved lease (crash recovery) or a
    -- failed/timeout/released prior attempt. Re-arm must re-pass the cap.
    v_prior_status := existing.status;
    monthly_cap_cents := coalesce(
      (SELECT value::INTEGER FROM public.app_config WHERE key = 'provider_monthly_cap_cents'),
      20000
    );
    SELECT coalesce(sum(coalesce(actual_cents, estimated_cents, 0)), 0)
      INTO spent_cents
      FROM public.provider_usage_events
     WHERE created_at >= date_trunc('month', now())
       AND status <> 'released'
       AND id <> existing.id;
    IF spent_cents + reserve_provider_usage.estimated_cents > monthly_cap_cents THEN
      RAISE EXCEPTION 'monthly provider cost cap reached';
    END IF;

    hourly_limit := coalesce(
      (SELECT value::INTEGER FROM public.app_config WHERE key = 'provider_user_hourly_limit'),
      60
    );
    IF (
      SELECT count(*) FROM public.provider_usage_events
       WHERE user_id = target_user_id AND created_at >= now() - INTERVAL '1 hour'
    ) >= hourly_limit THEN
      RAISE EXCEPTION 'provider usage quota exceeded — try again later';
    END IF;

    v_lease := gen_random_uuid();
    UPDATE public.provider_usage_events
       SET status = 'reserved',
           estimated_cents = reserve_provider_usage.estimated_cents,
           actual_cents = NULL,
           lease_token = v_lease,
           lease_expires_at = now() + INTERVAL '5 minutes',
           attempt_count = existing.attempt_count + 1,
           reconciled_at = NULL
     WHERE id = existing.id;
    RETURN QUERY SELECT existing.id, v_prior_status, true, v_lease;
    RETURN;
  END IF;

  -- Fresh reservation.
  monthly_cap_cents := coalesce(
    (SELECT value::INTEGER FROM public.app_config WHERE key = 'provider_monthly_cap_cents'),
    20000
  );
  SELECT coalesce(sum(coalesce(actual_cents, estimated_cents, 0)), 0)
    INTO spent_cents
    FROM public.provider_usage_events
   WHERE created_at >= date_trunc('month', now())
     AND status <> 'released';
  IF spent_cents + reserve_provider_usage.estimated_cents > monthly_cap_cents THEN
    RAISE EXCEPTION 'monthly provider cost cap reached';
  END IF;

  hourly_limit := coalesce(
    (SELECT value::INTEGER FROM public.app_config WHERE key = 'provider_user_hourly_limit'),
    60
  );
  IF (
    SELECT count(*) FROM public.provider_usage_events
     WHERE user_id = target_user_id AND created_at >= now() - INTERVAL '1 hour'
  ) >= hourly_limit THEN
    RAISE EXCEPTION 'provider usage quota exceeded — try again later';
  END IF;

  v_lease := gen_random_uuid();
  INSERT INTO public.provider_usage_events (
    user_id, provider, operation, units,
    usage_kind, request_ref, estimated_cents, status, pitch_draft_id,
    lease_token, lease_expires_at, attempt_count
  )
  VALUES (
    target_user_id, 'openai', usage_kind, 1,
    usage_kind, btrim(reserve_provider_usage.request_ref),
    reserve_provider_usage.estimated_cents, 'reserved', scope_draft_id,
    v_lease, now() + INTERVAL '5 minutes', 1
  )
  RETURNING id INTO v_reservation_id;

  RETURN QUERY SELECT v_reservation_id, NULL::TEXT, true, v_lease;
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_provider_usage(UUID, TEXT, TEXT, INTEGER, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_provider_usage(UUID, TEXT, TEXT, INTEGER, UUID)
  TO service_role;

-- ── Provider reconcile (service_role ONLY) ───────────────────────────
DROP FUNCTION IF EXISTS public.reconcile_provider_usage(UUID, INTEGER, TEXT);

CREATE FUNCTION public.reconcile_provider_usage(
  target_reservation_id UUID,
  target_lease_token UUID,
  actual_cents INTEGER,
  final_status TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  existing public.provider_usage_events;
  stored_cents INTEGER;
BEGIN
  IF final_status NOT IN ('succeeded', 'failed', 'timeout', 'released') THEN
    RAISE EXCEPTION 'invalid final status %', final_status;
  END IF;

  SELECT * INTO existing
    FROM public.provider_usage_events
   WHERE id = target_reservation_id
   FOR UPDATE;
  -- Only the reservation still holding the matching lease may be
  -- reconciled. A stale attempt (wrong/cleared lease) cannot overwrite
  -- the winner's outcome.
  IF existing.id IS NULL
     OR existing.status <> 'reserved'
     OR existing.lease_token IS DISTINCT FROM target_lease_token THEN
    RAISE EXCEPTION 'reservation not found, not leased, or lease token mismatch';
  END IF;

  IF final_status = 'succeeded' THEN
    IF reconcile_provider_usage.actual_cents IS NULL
       OR reconcile_provider_usage.actual_cents < 0 THEN
      RAISE EXCEPTION 'actual_cents is required for a succeeded reconcile';
    END IF;
    stored_cents := reconcile_provider_usage.actual_cents;
  ELSIF final_status IN ('failed', 'timeout') THEN
    -- The provider may already have billed a failed/timed-out call, so
    -- keep at least the estimate on the cap (conservative — decision §3.5).
    stored_cents := GREATEST(
      coalesce(reconcile_provider_usage.actual_cents, 0),
      existing.estimated_cents
    );
  ELSE
    -- 'released' is only for a path that made NO provider call at all.
    stored_cents := 0;
  END IF;

  UPDATE public.provider_usage_events
     SET status = final_status,
         actual_cents = stored_cents,
         lease_token = NULL,
         lease_expires_at = NULL,
         reconciled_at = now()
   WHERE id = target_reservation_id;
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_provider_usage(UUID, UUID, INTEGER, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_provider_usage(UUID, UUID, INTEGER, TEXT)
  TO service_role;
