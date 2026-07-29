-- 0044: two invariants that only the user-facing RPC path was enforcing.
--
-- S1 (fourth audit P0-3 / E2E run N-G): accepting an interest re-checks the
--   SENDER. submit_interest (0016) gates a submission on the sender's account
--   state, an adult birth date, dating-profile completeness, the campaign
--   window, profile-photo evidence and — behind the ops switches — media
--   validation and identity evidence. decide_interest (0012) re-checked none of
--   that: it verified only that the calling dater's own account was active, that
--   the interest belonged to a campaign they own, and that its status was still
--   'submitted'. Everything between submit and accept was therefore a TOCTOU
--   window, and the dater's inbox (list_campaign_interests, 0037) renders the
--   sender's CURRENT profile, so the sender could change what the dater is
--   judging. A suspended, erased or evidence-expired sender — or one who
--   repointed their photos at objects they do not own — could still be accepted
--   into an intro room. Blocking was the single exception, re-checked
--   indirectly: the intro_rooms INSERT trigger (0001) refuses blocked parties
--   and rolls the accept back in the same transaction.
--
--   The submit-path predicates move into private helpers that BOTH paths call,
--   so submit and accept cannot drift. submit_interest is redefined (0016 body,
--   reproduced whole) to call them; its refusal messages are unchanged.
--
--   The invariant is enforced by a BEFORE UPDATE trigger, not only by the RPC.
--   authenticated already holds GRANT UPDATE (status, decided_at) ON interests
--   (0006) under policy interests_update_owners, and GRANT INSERT on intro_rooms
--   (0002), and validate_intro_room_parties (0001) only checks owner + an
--   'accepted' interest + no block. So a campaign owner could reproduce the
--   whole accept with two ordinary PostgREST writes. The trigger makes the
--   predicate hold for every caller, including service_role.
--
--   Deliberately NOT closed here: the inbox still joins the sender's live
--   profile instead of a submission snapshot, so the bio/photo *content* a
--   dater judged can still change under them between render and accept. What
--   this migration adds is a photo-set DIGEST on the interest, which is enough
--   to detect that a change happened but not to show the dater what they
--   originally saw. A real snapshot table remains the rest of P0-3.
--
-- S2 (E2E run O-1): the expired -> published invariant becomes a trigger.
--   set_campaign_status (0033) refuses a free resume, but a direct service-role
--   UPDATE walked straight past it, while every comparable invariant here is
--   trigger-enforced (launch gates 0023/0034, one-active-campaign 0039,
--   publish identity 0030). expire_due_campaigns() (0033) and its pg_cron job
--   (0043) move in the opposite direction and are untouched.

-- ── S1a: the submission photo-evidence digest ──────────────────────────
-- The digest covers the whole evidence chain, not just the paths: for each
-- photo, in order, the stored path, the owner private.profile_media_owner
-- derives from the resolved storage object, and that object's MIME type. Paths
-- alone would miss the sender re-uploading different content over the SAME
-- path after submitting — that is a change in exactly the evidence
-- assert_profile_photo_objects judges, and it must reopen the re-check.
--
-- Why a digest and not the values: it is only ever compared for equality, and
-- it is not granted to anon/authenticated (the column grants on interests are
-- per-column, 0002/0006), so it adds no new read surface on the sender's
-- storage layout.
--
-- NULL means "no submission-time evidence is recorded": rows written before
-- this migration, and rows inserted straight into the table rather than through
-- submit_interest. Those rows are grandfathered out of the photo-PROVENANCE
-- re-check below — see private.assert_interest_sender_acceptable for why.
ALTER TABLE public.interests
  ADD COLUMN submitted_photo_digest TEXT;

COMMENT ON COLUMN public.interests.submitted_photo_digest IS
  'md5 over (photo path, resolved storage-object owner, MIME) for each dating_profiles.photos entry as it stood when submit_interest accepted this interest. NULL for rows not written by that RPC. Compared for equality only, to detect that the sender changed their photo evidence after submitting.';

CREATE FUNCTION private.profile_photo_digest(target_user_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT md5(
    coalesce(
      (
        SELECT array_agg(
                 ARRAY[
                   photo.storage_path,
                   coalesce(private.profile_media_owner(object.name)::TEXT, ''),
                   coalesce(object.metadata ->> 'mimetype', '')
                 ]::TEXT
                 ORDER BY photo.ordinality
               )
          FROM unnest(profile.photos) WITH ORDINALITY AS photo(storage_path, ordinality)
          LEFT JOIN storage.objects object
            ON object.bucket_id = 'profile-media'
           AND object.name = private.profile_photo_object_name(photo.storage_path)
      )::TEXT,
      ''
    )
  )
    FROM public.dating_profiles profile
   WHERE profile.user_id = target_user_id;
$$;

REVOKE ALL ON FUNCTION private.profile_photo_digest(UUID) FROM PUBLIC;

-- ── S1b: submit-path predicates, extracted so accept can reuse them ────
-- The bodies are the 0016 submit_interest blocks verbatim, re-expressed against
-- a user id instead of a local `sender_profile` record. The predicates that
-- submit_interest raises its own worded message for are exposed as BOOLEAN so
-- neither caller has to duplicate the logic to keep its own message.

CREATE FUNCTION private.adult_birth_date(target_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT coalesce(
    (
      SELECT profile.birth_date IS NOT NULL
         AND profile.birth_date <= (CURRENT_DATE - INTERVAL '18 years')
        FROM public.profiles profile
       WHERE profile.user_id = target_user_id
    ),
    false
  );
$$;

-- The full submit-time completeness rule: bio, intent, and at least 2 photos.
CREATE FUNCTION private.dating_profile_complete(target_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT coalesce(
    (
      SELECT nullif(btrim(profile.bio), '') IS NOT NULL
         AND nullif(btrim(profile.dating_intent), '') IS NOT NULL
         AND coalesce(array_length(profile.photos, 1), 0) >= 2
        FROM public.dating_profiles profile
       WHERE profile.user_id = target_user_id
    ),
    false
  );
$$;

-- The floor: there is still a real profile behind this interest. Weaker than
-- dating_profile_complete on purpose — it demands one photo rather than two —
-- because it is asserted at accept time against rows that predate the strict
-- rule, while still refusing the empty profile that would make every photo
-- assertion below vacuous.
CREATE FUNCTION private.dating_profile_present(target_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT coalesce(
    (
      SELECT nullif(btrim(profile.bio), '') IS NOT NULL
         AND nullif(btrim(profile.dating_intent), '') IS NOT NULL
         AND coalesce(array_length(profile.photos, 1), 0) >= 1
        FROM public.dating_profiles profile
       WHERE profile.user_id = target_user_id
    ),
    false
  );
$$;

-- Both photo assertions are EXISTS over unnest(photos), so an EMPTY photos
-- array asserts nothing here. Every caller must therefore assert
-- dating_profile_present first; the accept path does, and submit_interest's
-- completeness check subsumes it.
CREATE FUNCTION private.assert_profile_photo_objects(target_user_id UUID)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public.dating_profiles profile
      CROSS JOIN LATERAL unnest(profile.photos) AS photo(storage_path)
     WHERE profile.user_id = target_user_id
       AND NOT EXISTS (
         SELECT 1
           FROM storage.objects object
          WHERE object.bucket_id = 'profile-media'
            AND object.name = private.profile_photo_object_name(photo.storage_path)
            AND private.profile_media_owner(object.name) = target_user_id
            AND object.metadata ->> 'mimetype' IN ('image/jpeg', 'image/png', 'image/webp')
       )
  ) THEN
    RAISE EXCEPTION 'profile photos require owned storage objects with an allowed image MIME type';
  END IF;
END;
$$;

CREATE FUNCTION private.assert_profile_photo_validations(target_user_id UUID)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF private.media_validation_enforcement() AND EXISTS (
    SELECT 1
      FROM public.dating_profiles profile
      CROSS JOIN LATERAL unnest(profile.photos) AS photo(storage_path)
     WHERE profile.user_id = target_user_id
       AND NOT EXISTS (
         SELECT 1
           FROM public.media_validations validation
          WHERE validation.bucket_id = 'profile-media'
            AND validation.object_name = private.profile_photo_object_name(photo.storage_path)
            AND validation.mime_ok
            AND validation.magic_ok
            AND validation.size_ok
            AND validation.decode_ok
            AND validation.moderation_status = 'passed'
       )
  ) THEN
    RAISE EXCEPTION 'profile photos require completed validation';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION private.adult_birth_date(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.dating_profile_complete(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.dating_profile_present(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.assert_profile_photo_objects(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.assert_profile_photo_validations(UUID) FROM PUBLIC;

-- ── S1c: the accept-time predicate, shared by the RPC and the trigger ──
-- Refusal messages are raised bare here. decide_interest re-attributes them for
-- the dater; the trigger surfaces them as-is to whoever wrote the row directly.
--
-- WHAT IS ALWAYS RE-ASSERTED
--   account status, queued/processing erasure, an adult birth date, the profile
--   floor, media validation verdicts (ops-gated) and identity evidence
--   (ops-gated). None of these depend on the sender touching anything: an
--   account is suspended by moderation, a moderation verdict flips on its own,
--   identity evidence expires on its own. A minor is never accepted under any
--   condition.
--
-- WHAT IS RE-ASSERTED ONLY WHEN THE SENDER CHANGED THEIR PHOTO EVIDENCE
--   photo provenance (owned profile-media object, allowed MIME) and the strict
--   "at least 2 photos" completeness rule, gated on
--   submitted_photo_digest <> the current digest.
--
--   Why this grandfathering is safe. After this migration submit_interest
--   asserts photo provenance before it writes the row, so every interest
--   submitted from now on had resolvable photos at submission and records the
--   digest of exactly that evidence — paths, owners and MIME types. The ONLY
--   way such an interest can hold unresolvable photos at accept time is if one
--   of those three changed afterwards, which is precisely the comparison above.
--   Nothing is lost for post-0044 data.
--
--   What reopens. Rows with a NULL digest — everything submitted before this
--   migration, plus rows inserted straight into the table — skip the
--   provenance re-check entirely. Their photo paths are trusted as they stand.
--   Concretely: a sender whose stored paths do not resolve to a caller-owned
--   profile-media object (supabase/seed.sql's 'local/alex.jpg' shape, and any
--   production row predating the owned-object convention) can still be accepted
--   with those paths. That is the pre-0044 status quo, not a new hole, and it
--   is bounded: no NEW interest can be created in that shape.
--
--   Why grandfathering rather than enforcing it anyway. Enforcing it turns
--   every already-submitted interest from such a sender permanently
--   un-acceptable, with the refusal shown to the DATER, blaming the sender, and
--   no recovery except the sender re-uploading. Verified: with the check
--   unconditional, the unmodified supabase/tests/audit3/c09_judge_safe_flow.sql
--   fails at the accept, because all three seeded dating profiles carry
--   placeholder paths. Shipping that would break live inboxes on deploy.
CREATE FUNCTION private.assert_interest_sender_acceptable(
  sender_user_id UUID,
  submitted_photo_digest TEXT
)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM private.assert_active_account(sender_user_id);

  IF EXISTS (
    SELECT 1
      FROM public.deletion_requests
     WHERE user_id = sender_user_id
       AND scope = 'account'
       AND status IN ('queued', 'processing')
  ) THEN
    RAISE EXCEPTION 'the sender has requested account deletion';
  END IF;

  IF NOT private.adult_birth_date(sender_user_id) THEN
    RAISE EXCEPTION 'verified interest requires an adult birth date on your profile';
  END IF;

  IF NOT private.dating_profile_present(sender_user_id) THEN
    RAISE EXCEPTION 'the sender no longer has a bio, an intent, and at least one photo';
  END IF;

  IF submitted_photo_digest IS NOT NULL
     AND submitted_photo_digest IS DISTINCT FROM private.profile_photo_digest(sender_user_id) THEN
    IF NOT private.dating_profile_complete(sender_user_id) THEN
      RAISE EXCEPTION 'complete your dating profile (bio, intent, and at least 2 photos) first';
    END IF;
    PERFORM private.assert_profile_photo_objects(sender_user_id);
  END IF;

  PERFORM private.assert_profile_photo_validations(sender_user_id);

  IF private.identity_enforcement() THEN
    PERFORM private.assert_identity_evidence(sender_user_id);
  END IF;
END;
$$;

-- The dater's own side of the accept: an intro room may only open out of a
-- campaign that is still publishable, the same window submit_interest requires.
CREATE FUNCTION private.assert_interest_acceptable(
  target_campaign_id UUID,
  sender_user_id UUID,
  submitted_photo_digest TEXT
)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM public.campaigns
     WHERE id = target_campaign_id
       AND status = 'published'
       AND (ends_at IS NULL OR ends_at > now())
  ) THEN
    RAISE EXCEPTION 'campaign must be published and inside its window to accept interest';
  END IF;

  PERFORM private.assert_interest_sender_acceptable(sender_user_id, submitted_photo_digest);
END;
$$;

REVOKE ALL ON FUNCTION private.assert_interest_sender_acceptable(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.assert_interest_acceptable(UUID, UUID, TEXT) FROM PUBLIC;

-- ── S1d: submit_interest delegates the shared predicates ───────────────
-- 0016 body reproduced whole; only the inline predicate blocks are replaced by
-- the helpers above, plus the digest write. Check order and every refusal
-- message are unchanged, so the messages pinned by 06/16/19/a08/b06 still hold.
CREATE OR REPLACE FUNCTION public.submit_interest(
  target_campaign_id UUID,
  interest_note TEXT DEFAULT NULL
)
RETURNS TABLE (interest_id UUID, interest_status TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  caller UUID := auth.uid();
  campaign campaigns;
  upserted interests;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;
  PERFORM private.assert_active_account(caller);

  SELECT * INTO campaign
    FROM campaigns
   WHERE id = target_campaign_id
     AND status = 'published'
     AND (ends_at IS NULL OR ends_at > now());
  IF NOT FOUND THEN
    RAISE EXCEPTION 'campaign is not open for interest';
  END IF;
  IF campaign.owner_user_id = caller THEN
    RAISE EXCEPTION 'you cannot send interest to your own campaign';
  END IF;
  IF EXISTS (
    SELECT 1 FROM blocks
     WHERE (blocker_user_id = campaign.owner_user_id AND blocked_user_id = caller)
        OR (blocker_user_id = caller AND blocked_user_id = campaign.owner_user_id)
  ) THEN
    RAISE EXCEPTION 'campaign is not open for interest';
  END IF;

  IF NOT private.adult_birth_date(caller) THEN
    RAISE EXCEPTION 'verified interest requires an adult birth date on your profile';
  END IF;

  IF NOT private.dating_profile_complete(caller) THEN
    RAISE EXCEPTION 'complete your dating profile (bio, intent, and at least 2 photos) first';
  END IF;

  PERFORM private.assert_profile_photo_objects(caller);
  PERFORM private.assert_profile_photo_validations(caller);

  IF private.identity_enforcement() THEN
    PERFORM private.assert_identity_evidence(caller);
  END IF;

  INSERT INTO interests (
    campaign_id, sender_user_id, status, note, submitted_at, submitted_photo_digest
  )
  VALUES (
    target_campaign_id, caller, 'submitted', interest_note, now(),
    private.profile_photo_digest(caller)
  )
  ON CONFLICT (campaign_id, sender_user_id) DO UPDATE
    SET status = 'submitted',
        note = EXCLUDED.note,
        submitted_at = now(),
        submitted_photo_digest = EXCLUDED.submitted_photo_digest
    WHERE interests.status IN ('started', 'verification_pending', 'submitted', 'withdrawn')
  RETURNING * INTO upserted;

  IF upserted.id IS NULL THEN
    RAISE EXCEPTION 'this interest was already answered';
  END IF;

  RETURN QUERY SELECT upserted.id, upserted.status::TEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_interest(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_interest(UUID, TEXT) TO authenticated;

-- ── S1e: decide_interest re-asserts sender eligibility before accepting ─
-- 0012 body reproduced whole, plus the accept-time re-checks.
--
-- Declining is never gated. The dater must be able to clear an inbox entry
-- whatever happened to the sender, so the re-checks guard only the accepting
-- branch.
--
-- An interest that can no longer be accepted RAISES; it is not auto-declined
-- or moved to a terminal state. Reasons:
--   - 'declined' is a social signal the sender sees in list_my_interests
--     (0033); attributing a refusal the dater never made to the dater is a
--     lie about who decided.
--   - Every condition here is recoverable and often transient — a suspension
--     lifted, a paid pass reviving the window, refreshed identity evidence,
--     a re-uploaded photo. A terminal transition would destroy an interest
--     that becomes legitimately acceptable minutes later; leaving it
--     'submitted' keeps it acceptable the moment the condition clears.
--   - It matches the one re-check that already existed: a blocked pair makes
--     the intro_rooms INSERT trigger (0001) raise and roll the accept back in
--     the same transaction, leaving the interest 'submitted'.
-- The dater keeps a way out: declining always works.
CREATE OR REPLACE FUNCTION public.decide_interest(target_interest_id UUID, decision TEXT)
RETURNS TABLE (intro_room_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  caller UUID := auth.uid();
  interest interests;
  campaign campaigns;
  new_room_id UUID;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;
  PERFORM private.assert_active_account(caller);

  IF decision NOT IN ('accepted', 'declined') THEN
    RAISE EXCEPTION 'decision must be accepted or declined';
  END IF;
  SELECT i.* INTO interest FROM interests i WHERE i.id = target_interest_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'interest not found or not yours to decide';
  END IF;
  SELECT * INTO campaign FROM campaigns WHERE id = interest.campaign_id;
  IF NOT FOUND OR campaign.owner_user_id IS DISTINCT FROM caller THEN
    RAISE EXCEPTION 'interest not found or not yours to decide';
  END IF;
  IF interest.status <> 'submitted' THEN
    RAISE EXCEPTION 'interest is not awaiting a decision';
  END IF;

  IF decision = 'accepted' THEN
    -- The campaign window is asserted first and unwrapped: it is a verdict on
    -- the DATER's own campaign, not on the sender.
    IF campaign.status <> 'published'
       OR (campaign.ends_at IS NOT NULL AND campaign.ends_at <= now()) THEN
      RAISE EXCEPTION 'campaign must be published and inside its window to accept interest';
    END IF;

    -- The sender's state. Those messages are phrased for the sender ("your
    -- profile"), hence the re-attributing wrapper: without it a dater would
    -- read them as a verdict on their own account, which decide_interest
    -- already asserted above. The underlying reason is kept rather than
    -- flattened, because the dater already sees this sender's profile and
    -- otherwise cannot tell a recoverable refusal from a permanent one. WHEN
    -- raise_exception (P0001) catches only these deliberate refusals; a genuine
    -- internal error propagates unwrapped.
    BEGIN
      PERFORM private.assert_interest_sender_acceptable(
        interest.sender_user_id,
        interest.submitted_photo_digest
      );
    EXCEPTION WHEN raise_exception THEN
      RAISE EXCEPTION 'this interest can no longer be accepted: %', SQLERRM;
    END;
  END IF;

  UPDATE interests SET status = decision::interest_status, decided_at = now()
   WHERE id = interest.id;
  IF decision = 'accepted' THEN
    INSERT INTO intro_rooms (campaign_id, dater_user_id, interested_user_id)
    VALUES (interest.campaign_id, caller, interest.sender_user_id)
    ON CONFLICT (campaign_id, dater_user_id, interested_user_id) DO NOTHING;
    SELECT id INTO new_room_id FROM intro_rooms
     WHERE campaign_id = interest.campaign_id
       AND dater_user_id = caller
       AND interested_user_id = interest.sender_user_id;
  END IF;

  RETURN QUERY SELECT new_room_id;
END;
$$;

REVOKE ALL ON FUNCTION public.decide_interest(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.decide_interest(UUID, TEXT) TO authenticated;

COMMENT ON FUNCTION public.decide_interest(UUID, TEXT) IS
  'Owner decision on an interest. Accepting asserts the campaign window and re-asserts the sender''s account status, erasure state, adult birth date, dating-profile floor and — under the ops switches — media validation and identity evidence; photo provenance and the strict 2-photo rule are re-asserted only when the sender changed their photo set after submitting (see 0044). Declining is never gated. Refusals raise and leave the interest submitted so it stays acceptable once the condition clears.';

-- ── S1f: the same predicate as a trigger, so the RPC is not the boundary ─
-- Fires only on the submitted/started -> accepted transition, so declining,
-- withdrawing and note edits are untouched, and re-writing 'accepted' over
-- 'accepted' is a no-op. decide_interest validates the identical predicate
-- immediately before its own UPDATE, so on the RPC path this trigger can only
-- pass; it exists for PATCH /rest/v1/interests and for service_role writers.
--
-- Trigger name sorts after interests_enforce_active_account and
-- interests_set_updated_at on purpose: a caller whose OWN account is inactive
-- should read that refusal, not a verdict about the sender.
CREATE FUNCTION private.enforce_interest_accept_invariants()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.status = 'accepted' AND OLD.status IS DISTINCT FROM 'accepted' THEN
    PERFORM private.assert_interest_acceptable(
      NEW.campaign_id,
      NEW.sender_user_id,
      NEW.submitted_photo_digest
    );
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.enforce_interest_accept_invariants() FROM PUBLIC;

CREATE TRIGGER interests_verify_accept_invariants
BEFORE UPDATE ON public.interests
FOR EACH ROW EXECUTE FUNCTION private.enforce_interest_accept_invariants();

-- ── S2: expired exits, and entering 'published' with a dead window ─────
-- Fires on UPDATE only; a campaign is never INSERTed expired.
--
-- Clause 1 — allowed exits from 'expired':
--   expired -> expired    ends_at / metadata maintenance (0042 parks the paid
--                         window here when a publish gate blocks the revival)
--   expired -> archived   the owner's legitimate exit (set_campaign_status)
--   expired -> published  ONLY when the same statement moves ends_at into the
--                         future — i.e. the paid Campaign Pass revival in
--                         record_revenuecat_event (0042), which sets status and
--                         ends_at together.
-- expired -> paused is refused too: paused is not public, but it would launder
-- a lapsed campaign into a state from which the RPC's own resume path applies,
-- and nothing in the product performs that transition.
--
-- Clause 2 — a campaign may not ENTER 'published' with a window that has
-- already ended, whatever it was before. Without this, clause 1 was trivially
-- bypassed in two statements through a status it whitelists:
--   expired -> archived (allowed) -> published (OLD.status='archived', so
--   clause 1 does not look at it) leaving ends_at in the past.
--
-- WHAT THIS TRIGGER DOES NOT DO.
--   * It does not check entitlements. A writer with no campaign_entitlements
--     row can still republish with a future ends_at in one statement; that is
--     the shape the paid revival uses and the trigger cannot tell them apart.
--     Payment is enforced by set_campaign_status (0033) and
--     record_revenuecat_event (0042), not here. Any claim that this guard makes
--     a revival cost money would be false.
--   * It does not forbid a campaign that is ALREADY published from having its
--     ends_at moved into the past. "published with a lapsed window" is a normal
--     clock-produced state — it is exactly what expire_due_campaigns() exists
--     to clean up, and four existing suites (10, b10, c06) simulate scheduler
--     lag that way. Refusing it would forbid writing a state the clock produces
--     on its own. It is also not an escalation: the end state is closed to
--     interest (submit_interest and decide_interest both require a live
--     window), and it is reachable anyway by republishing with a one-second
--     window and waiting. The security boundary is ENTERING 'published'.
--
-- expire_due_campaigns() (0033) and the pg_cron job (0043) only move
-- published/paused -> expired, so neither is affected.
--
-- Trigger name sorts after campaigns_one_active_campaign_guard and
-- campaigns_public_beta_gate on purpose: 0039 relies on those two refusals
-- surfacing first, because the 0042 revival handler matches on their text.
CREATE FUNCTION private.enforce_expired_campaign_exits()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF OLD.status = 'expired' AND NEW.status NOT IN ('expired', 'archived') THEN
    IF NEW.status <> 'published'
       OR NEW.ends_at IS NULL
       OR NEW.ends_at <= now() THEN
      RAISE EXCEPTION
        'an expired campaign can only be archived, or republished with a window that has not ended'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF NEW.status = 'published'
     AND OLD.status IS DISTINCT FROM 'published'
     AND NEW.ends_at IS NOT NULL
     AND NEW.ends_at <= now() THEN
    RAISE EXCEPTION
      'a campaign cannot become published with a window that has already ended'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.enforce_expired_campaign_exits() FROM PUBLIC;

CREATE TRIGGER campaigns_status_expired_guard
BEFORE UPDATE ON public.campaigns
FOR EACH ROW EXECUTE FUNCTION private.enforce_expired_campaign_exits();
