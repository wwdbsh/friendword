-- Third audit (docs/FRIENDWORD_THIRD_AUDIT_HANDOFF_2026-07-14.md §3
-- P0-NEW-3) Slice 2: the dater's revision/publish path is now as
-- authoritative about photos and text as the introducer's submit path.
--
--   Threat model closed here
--   - create_dater_revision (0032) only checked that assets belonged to the
--     draft. A dater could put an unvalidated or moderation-flagged photo
--     into a revision and publish it, and could rewrite headline/body with
--     no passed text-moderation verdict — the 0026 trigger fires only on the
--     first consent_pending transition, never on a later revision.
--   - A dater who rewrote the copy inherited the prior structure's
--     hard-claims list verbatim; new factual claims never re-surfaced a
--     confirmation gate.
--   - approve_and_publish_pitch published the reviewed snapshot but never
--     copied the approved revision's transcript into pitch_drafts.transcript,
--     the row public readers actually read — the approval snapshot was
--     incomplete.
--   - Slice 1's draft-scoped reserve/consent authorization only recognized
--     the draft creator, so a dater (subject) could not reserve their own
--     media validation or record their own AI-processing consent.
--
--   Contract after this migration
--   - consent_revisions.dater_edited records whether the dater changed the
--     copy. When true, approval requires hard_claims_confirmed = true — a
--     conservative superset of the hard-claims gate (no new AI extraction is
--     run on the dater path; changing the words is treated as asserting the
--     claims). This gate is flag-independent.
--   - While media_validation_enforcement is on, every photo entering a
--     revision — and every included photo at publish — must carry the same
--     passed media_validations evidence submit_for_consent requires (0016),
--     and the exact headline+body must carry a passed pitch_content verdict
--     (0026 hash formula, reused verbatim). Enforcement off keeps the prior
--     behavior (internal beta).
--   - approve_and_publish_pitch copies the approved revision transcript into
--     pitch_drafts.transcript unconditionally (flag-independent).
--   - reserve_provider_usage / record_ai_processing_consent recognize the
--     dater subject of a consent_pending draft, not just its creator.

-- ── Dater-edit flag on the immutable revision ────────────────────────
ALTER TABLE public.consent_revisions
  ADD COLUMN dater_edited BOOLEAN NOT NULL DEFAULT false;

-- ── Shared photo-validation predicate ────────────────────────────────
-- Byte-identical to the submit_for_consent gate (0016): every photo among
-- the given asset ids must carry passed structural + moderation evidence in
-- media_validations, keyed by the storage path with the 'pitch-media/'
-- prefix stripped. Voice assets are out of scope here (the photo set is what
-- the dater curates for publish).
CREATE FUNCTION private.pitch_photos_validated(target_asset_ids UUID[])
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
       AND asset.asset_type = 'photo'
       AND NOT EXISTS (
         SELECT 1
           FROM public.media_validations validation
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
  );
$$;

REVOKE ALL ON FUNCTION private.pitch_photos_validated(UUID[]) FROM PUBLIC;

-- ── create_dater_revision (full redefinition from 0032) ──────────────
CREATE OR REPLACE FUNCTION public.create_dater_revision(
  draft_id UUID,
  new_headline TEXT,
  new_body TEXT,
  included_asset_ids UUID[] DEFAULT NULL
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
  next_revision_number INTEGER;
  new_revision_id UUID;
  canonical_content JSONB;
  is_dater_edited BOOLEAN;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;
  PERFORM private.assert_active_account(caller);

  IF nullif(btrim(new_headline), '') IS NULL OR nullif(btrim(new_body), '') IS NULL THEN
    RAISE EXCEPTION 'headline and body are required';
  END IF;
  IF char_length(new_headline) > 120 OR char_length(new_body) > 2000 THEN
    RAISE EXCEPTION 'headline or body is too long';
  END IF;

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
    SELECT coalesce(array_agg(DISTINCT candidate_id ORDER BY candidate_id), ARRAY[]::UUID[])
      INTO snapshot_asset_ids
      FROM unnest(included_asset_ids) candidate_id;
  END IF;

  -- Authoritative photo + text gates (fail-closed only while enforcement is
  -- on; internal beta keeps the prior behavior). Both mirror the introducer
  -- submit path (0016 photo predicate, 0026 text verdict) so a revision can
  -- never smuggle unreviewed media or copy past publish.
  IF private.media_validation_enforcement() THEN
    IF NOT private.pitch_photos_validated(snapshot_asset_ids) THEN
      RAISE EXCEPTION 'photos must pass validation before they can enter a revision';
    END IF;
    -- Hash formula is byte-identical to 0026's trigger and the
    -- /api/moderate-text route: raw headline + E'\n\n' + body, UTF-8 sha256.
    IF NOT private.text_moderation_passed(
      'pitch_content',
      coalesce(new_headline, '') || E'\n\n' || coalesce(new_body, '')
    ) THEN
      RAISE EXCEPTION 'pitch text requires a passed moderation verdict';
    END IF;
  END IF;

  -- The dater changed the copy when the trimmed headline or body differs
  -- from the revision they are editing. Recorded so approval can demand
  -- hard-claim confirmation (no AI re-extraction runs on this path).
  is_dater_edited := (btrim(new_headline) IS DISTINCT FROM btrim(latest.headline))
    OR (btrim(new_body) IS DISTINCT FROM btrim(latest.body));

  SELECT coalesce(max(consent_revisions.revision_number), 0) + 1
    INTO next_revision_number
    FROM consent_revisions
   WHERE pitch_draft_id = draft.id;

  canonical_content := jsonb_build_object(
    'headline', btrim(new_headline),
    'body', btrim(new_body),
    'structure', latest.structure,
    'asset_ids', to_jsonb(snapshot_asset_ids),
    'voice_asset_path', latest.voice_asset_path
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
    content_hash,
    dater_edited
  )
  VALUES (
    draft.id,
    next_revision_number,
    btrim(new_headline),
    btrim(new_body),
    latest.structure,
    snapshot_asset_ids,
    latest.voice_asset_path,
    latest.transcript,
    encode(digest(canonical_content::TEXT, 'sha256'), 'hex'),
    is_dater_edited
  )
  RETURNING id INTO new_revision_id;

  UPDATE consent_requests
     SET revision_id = new_revision_id
   WHERE id = request.id;

  RETURN QUERY SELECT new_revision_id, next_revision_number;
END;
$$;

REVOKE ALL ON FUNCTION public.create_dater_revision(UUID, TEXT, TEXT, UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_dater_revision(UUID, TEXT, TEXT, UUID[])
  TO authenticated;

-- ── approve_and_publish_pitch (full redefinition from 0032) ──────────
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
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;
  PERFORM private.assert_active_account(caller);

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

  -- Defense in depth: re-check the published photos against media_validations
  -- at approval time (fail-closed only while enforcement is on).
  IF private.media_validation_enforcement()
     AND NOT private.pitch_photos_validated(included_asset_ids) THEN
    RAISE EXCEPTION 'included photos must pass validation before publish';
  END IF;

  -- Hard-claim confirmation is required either when the structure lists hard
  -- claims OR when the dater rewrote the copy (dater_edited). Flag-independent.
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

  -- Publish the exact reviewed snapshot, including the approved transcript
  -- the public reader renders (approval snapshot invariant — unconditional).
  UPDATE pitch_drafts
     SET headline = approved_revision.headline,
         body = approved_revision.body,
         structure = approved_revision.structure,
         transcript = approved_revision.transcript,
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

-- ── reserve_provider_usage (full redefinition from 0035) ─────────────
-- Only the draft-scope authorization predicate changes: the dater subject of
-- a consent_pending draft may now reserve draft-scoped provider work (their
-- own media validation), not only the draft creator. Everything else — the
-- lease/attempt state machine, cap accounting, consent gate — is unchanged.
CREATE OR REPLACE FUNCTION public.reserve_provider_usage(
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
  IF reserve_provider_usage.estimated_cents IS NULL
     OR reserve_provider_usage.estimated_cents < 1
     OR reserve_provider_usage.estimated_cents > 50 THEN
    RAISE EXCEPTION 'estimated_cents must be between 1 and 50';
  END IF;

  IF coalesce(
    (SELECT value = 'on' FROM public.app_config WHERE key = 'provider_kill_switch'),
    false
  ) THEN
    RAISE EXCEPTION 'provider usage is disabled by the kill switch';
  END IF;

  current_revision := (
    SELECT value FROM public.app_config
     WHERE key = 'ai_disclosure_current_revision'
  );
  IF current_revision IS NULL THEN
    RAISE EXCEPTION 'external AI processing consent is required — disclosure revision is not configured';
  END IF;

  IF scope_draft_id IS NOT NULL THEN
    -- Draft-scoped: the target user must own the draft as its creator, or be
    -- the dater subject of a draft still in consent review (Slice 2).
    IF NOT EXISTS (
      SELECT 1 FROM public.pitch_drafts
       WHERE id = scope_draft_id
         AND (
           created_by_user_id = target_user_id
           OR (subject_user_id = target_user_id AND status = 'consent_pending')
         )
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

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('provider_usage_cap'));

  SELECT * INTO existing
    FROM public.provider_usage_events
   WHERE request_ref = reserve_provider_usage.request_ref
   FOR UPDATE;

  IF existing.id IS NOT NULL THEN
    IF existing.user_id IS DISTINCT FROM target_user_id THEN
      RAISE EXCEPTION 'request_ref belongs to another account';
    END IF;
    IF existing.status = 'succeeded' THEN
      RETURN QUERY SELECT existing.id, 'succeeded'::TEXT, false, NULL::UUID;
      RETURN;
    END IF;
    IF existing.status = 'reserved' AND existing.lease_expires_at > now() THEN
      RETURN QUERY SELECT existing.id, 'reserved'::TEXT, false, NULL::UUID;
      RETURN;
    END IF;
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

-- ── record_ai_processing_consent (full redefinition from 0035) ───────
-- The dater subject of a consent_pending draft may record their own
-- draft-scoped consent, not only the draft creator. Everything else — the
-- current-disclosure-revision binding — is unchanged.
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
     WHERE id = target_draft_id
       AND (
         created_by_user_id = caller
         OR (subject_user_id = caller AND status = 'consent_pending')
       )
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
