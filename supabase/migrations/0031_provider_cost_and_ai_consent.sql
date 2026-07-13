-- Second audit Slice 6 (P0-9, P0-10): provider spending is reserved,
-- reconciled, capped, and kill-switchable server-side, and no draft
-- media reaches an external AI provider without the introducer's
-- recorded affirmative consent.

INSERT INTO public.app_config (key, value)
VALUES
  ('provider_kill_switch', 'off'),
  ('provider_monthly_cap_cents', '20000'),
  ('provider_user_hourly_limit', '60')
ON CONFLICT (key) DO NOTHING;

ALTER TABLE public.provider_usage_events
  ADD COLUMN usage_kind TEXT,
  ADD COLUMN request_ref TEXT,
  ADD COLUMN estimated_cents INTEGER CHECK (estimated_cents >= 0),
  ADD COLUMN actual_cents INTEGER CHECK (actual_cents >= 0),
  ADD COLUMN status TEXT NOT NULL DEFAULT 'reserved'
    CHECK (status IN ('reserved', 'succeeded', 'failed', 'timeout', 'released')),
  ADD COLUMN pitch_draft_id UUID REFERENCES public.pitch_drafts(id) ON DELETE SET NULL,
  ADD COLUMN reconciled_at TIMESTAMPTZ;

CREATE UNIQUE INDEX provider_usage_events_request_ref_key
  ON public.provider_usage_events (request_ref)
  WHERE request_ref IS NOT NULL;

CREATE INDEX provider_usage_events_month_idx
  ON public.provider_usage_events (created_at);

-- Affirmative external-AI processing consent (P0-10). One row per
-- owner + draft + disclosure revision; recorded before any provider
-- reservation for that draft is possible.
CREATE TABLE public.ai_processing_consents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  pitch_draft_id UUID NOT NULL REFERENCES public.pitch_drafts(id) ON DELETE CASCADE,
  consent_revision TEXT NOT NULL,
  consented_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, pitch_draft_id, consent_revision)
);

ALTER TABLE public.ai_processing_consents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_processing_consents FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.ai_processing_consents TO authenticated;
GRANT SELECT, INSERT ON public.ai_processing_consents TO service_role;

CREATE POLICY ai_processing_consents_select_own ON public.ai_processing_consents
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE FUNCTION public.record_ai_processing_consent(
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
  consent_id UUID;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;
  PERFORM private.assert_active_account(caller);
  IF nullif(btrim(target_consent_revision), '') IS NULL THEN
    RAISE EXCEPTION 'consent revision is required';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.pitch_drafts
     WHERE id = target_draft_id AND created_by_user_id = caller
  ) THEN
    RAISE EXCEPTION 'draft not found or not owned by caller';
  END IF;

  INSERT INTO public.ai_processing_consents (user_id, pitch_draft_id, consent_revision)
  VALUES (caller, target_draft_id, btrim(target_consent_revision))
  ON CONFLICT (user_id, pitch_draft_id, consent_revision) DO UPDATE
    SET consented_at = ai_processing_consents.consented_at
  RETURNING id INTO consent_id;

  RETURN consent_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_ai_processing_consent(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_ai_processing_consent(UUID, TEXT)
  TO authenticated;

-- Atomic reservation before any provider call. Fail-closed on: kill
-- switch, monthly hard cap, per-user hourly quota, inactive or
-- deletion-requested accounts, and missing AI consent for draft-scoped
-- transcription/structuring work. Replays of the same request_ref
-- return the same reservation (re-armed if the previous attempt failed).
CREATE FUNCTION public.reserve_provider_usage(
  usage_kind TEXT,
  request_ref TEXT,
  estimated_cents INTEGER,
  scope_draft_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  caller UUID := auth.uid();
  monthly_cap_cents INTEGER;
  hourly_limit INTEGER;
  spent_cents BIGINT;
  existing public.provider_usage_events;
  reservation_id UUID;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;
  PERFORM private.assert_active_account(caller);
  IF EXISTS (
    SELECT 1 FROM public.deletion_requests
     WHERE user_id = caller AND status IN ('queued', 'processing')
  ) THEN
    RAISE EXCEPTION 'account deletion is in progress';
  END IF;

  IF usage_kind IS NULL
     OR usage_kind NOT IN ('transcribe', 'structure', 'moderate_text', 'media_validate') THEN
    RAISE EXCEPTION 'unknown provider usage kind %', usage_kind;
  END IF;
  IF nullif(btrim(request_ref), '') IS NULL THEN
    RAISE EXCEPTION 'request_ref is required';
  END IF;
  IF estimated_cents IS NULL OR estimated_cents < 0 THEN
    RAISE EXCEPTION 'estimated_cents must be non-negative';
  END IF;

  IF coalesce(
    (SELECT value = 'on' FROM public.app_config WHERE key = 'provider_kill_switch'),
    false
  ) THEN
    RAISE EXCEPTION 'provider usage is disabled by the kill switch';
  END IF;

  -- External-AI consent gate (P0-10): draft-scoped AI work needs the
  -- owner's recorded consent before a single provider cent is reserved.
  IF usage_kind IN ('transcribe', 'structure') THEN
    IF scope_draft_id IS NULL THEN
      RAISE EXCEPTION 'draft-scoped usage requires scope_draft_id';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.pitch_drafts
       WHERE id = scope_draft_id AND created_by_user_id = caller
    ) THEN
      RAISE EXCEPTION 'draft not found or not owned by caller';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.ai_processing_consents
       WHERE pitch_draft_id = scope_draft_id
    ) THEN
      RAISE EXCEPTION 'external AI processing consent is required first';
    END IF;
  END IF;

  -- Idempotent replay / re-arm.
  SELECT * INTO existing
    FROM public.provider_usage_events
   WHERE request_ref = reserve_provider_usage.request_ref
   FOR UPDATE;
  IF existing.id IS NOT NULL THEN
    IF existing.user_id IS DISTINCT FROM caller THEN
      RAISE EXCEPTION 'request_ref belongs to another account';
    END IF;
    IF existing.status IN ('failed', 'timeout', 'released') THEN
      UPDATE public.provider_usage_events
         SET status = 'reserved',
             estimated_cents = reserve_provider_usage.estimated_cents,
             reconciled_at = NULL
       WHERE id = existing.id;
    END IF;
    RETURN existing.id;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('provider_usage_cap'));

  monthly_cap_cents := coalesce(
    (SELECT value::INTEGER FROM public.app_config WHERE key = 'provider_monthly_cap_cents'),
    20000
  );
  SELECT coalesce(sum(coalesce(actual_cents, estimated_cents, 0)), 0)
    INTO spent_cents
    FROM public.provider_usage_events
   WHERE created_at >= date_trunc('month', now())
     AND status <> 'released';
  IF spent_cents + estimated_cents > monthly_cap_cents THEN
    RAISE EXCEPTION 'monthly provider cost cap reached';
  END IF;

  hourly_limit := coalesce(
    (SELECT value::INTEGER FROM public.app_config WHERE key = 'provider_user_hourly_limit'),
    60
  );
  IF (
    SELECT count(*) FROM public.provider_usage_events
     WHERE user_id = caller AND created_at >= now() - INTERVAL '1 hour'
  ) >= hourly_limit THEN
    RAISE EXCEPTION 'provider usage quota exceeded — try again later';
  END IF;

  INSERT INTO public.provider_usage_events (
    user_id, provider, operation, units,
    usage_kind, request_ref, estimated_cents, status, pitch_draft_id
  )
  VALUES (
    caller, 'openai', usage_kind, 1,
    usage_kind, btrim(request_ref), estimated_cents, 'reserved', scope_draft_id
  )
  RETURNING id INTO reservation_id;

  RETURN reservation_id;
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_provider_usage(TEXT, TEXT, INTEGER, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reserve_provider_usage(TEXT, TEXT, INTEGER, UUID)
  TO authenticated, service_role;

CREATE FUNCTION public.reconcile_provider_usage(
  reservation_id UUID,
  actual_cents INTEGER,
  final_status TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  caller UUID := auth.uid();
BEGIN
  IF final_status NOT IN ('succeeded', 'failed', 'timeout', 'released') THEN
    RAISE EXCEPTION 'invalid final status %', final_status;
  END IF;
  IF actual_cents IS NULL OR actual_cents < 0 THEN
    RAISE EXCEPTION 'actual_cents must be non-negative';
  END IF;

  UPDATE public.provider_usage_events
     SET status = final_status,
         actual_cents = reconcile_provider_usage.actual_cents,
         reconciled_at = now()
   WHERE id = reservation_id
     AND (caller IS NULL OR user_id = caller);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reservation not found or not yours';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_provider_usage(UUID, INTEGER, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reconcile_provider_usage(UUID, INTEGER, TEXT)
  TO authenticated, service_role;
