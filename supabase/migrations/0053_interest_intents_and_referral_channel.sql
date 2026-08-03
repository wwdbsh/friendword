-- 0053: staged interest (S1 intent) + referral channel attribution.
--
-- Viral-loop slice, D2/D1. The funnel's terminal step is closed on purpose:
-- 0023's interests launch gate refuses every INSERT while public_beta_enabled
-- is off, so reel-driven visitors currently bounce with nothing stored. This
-- migration adds the S1 stage — a PRIVATE "I'm interested" record that needs
-- only an account — as a SEPARATE table, deliberately NOT a status column on
-- interests: every consumer of interests (0026 moderation gate, 0023 beta
-- gate, the owner inbox reads) assumes "row == delivered interest", and a
-- separate table makes that invariant structural instead of filter-discipline.
--
-- Competitive boundary (CLAUDE.md rule 8, "verified interest") reading pinned
-- for this slice: the protected object is what the DATER RECEIVES. An S1 row
-- reaches no Dater/Introducer surface, count, or analytics — delivery still
-- happens only through the fully gated interests INSERT (S2, promotion below).
--
-- S1 rows carry NO free text (unverified-text storage is refused by shape) and
-- no channel column: channel attribution lives on referral_claims (first-touch,
-- below) and in page-view analytics, so the intent table stays PII-minimal and
-- there is no second attribution store to drift.

-- ── S1: interest_intents ───────────────────────────────────────────────
CREATE TABLE public.interest_intents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  -- ON DELETE CASCADE is the erasure path: the 0037 deletion job's final stage
  -- deletes the auth user, which cascades auth.users -> public.users -> here,
  -- so scripts/process-deletions.mjs needs no per-table step (unlike interests,
  -- whose sender FK has no cascade and is removed explicitly by the job).
  interested_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, interested_user_id)
);

ALTER TABLE public.interest_intents ENABLE ROW LEVEL SECURITY;

-- Only the person themself can see or create their intent. There is no policy
-- and no grant that lets a campaign owner or introducer read these rows: an S1
-- row must be invisible to every Dater/Introducer surface until promotion.
CREATE POLICY interest_intents_select_own ON public.interest_intents
  FOR SELECT USING (auth.uid() = interested_user_id);
CREATE POLICY interest_intents_insert_own ON public.interest_intents
  FOR INSERT WITH CHECK (auth.uid() = interested_user_id);

-- The hosted default privileges would grant ALL here (see 0052); narrow to
-- exactly what the client path uses. No UPDATE/DELETE: an intent is immutable
-- and is consumed by the promotion RPC or the lifecycle sweep only.
REVOKE ALL ON TABLE public.interest_intents FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.interest_intents TO authenticated;
GRANT INSERT (campaign_id, interested_user_id) ON public.interest_intents TO authenticated;

-- Per-account cap for S1 volume. An S1 costs the sender nothing (no profile,
-- no moderation), and uniqueness makes the abuse shape a fan-out across many
-- campaigns, so the cap is per account per hour. 10 leaves any genuine
-- reel-driven visit (one target campaign, a little browsing) untouched while
-- bounding bulk fan-out.
INSERT INTO public.app_config (key, value)
VALUES ('interest_intent_hourly_cap', '10')
ON CONFLICT (key) DO NOTHING;

-- Invariants as a BEFORE INSERT trigger so they hold on every path (RPC and
-- the RLS direct insert alike): active account, an open published campaign,
-- not your own campaign, no blocked pair, and the hourly cap. The cap uses the
-- 0045 pattern — transaction-scoped advisory lock on the bucket key BEFORE the
-- count, so two concurrent inserts for one account cannot both pass the check.
CREATE FUNCTION private.enforce_interest_intent_rules()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  hourly_cap INTEGER;
BEGIN
  PERFORM private.assert_active_account(NEW.interested_user_id);

  -- Same refusal wording as submit_interest: a closed window and a blocked
  -- pair are indistinguishable to the caller on purpose.
  IF NOT EXISTS (
    SELECT 1
      FROM public.campaigns
     WHERE id = NEW.campaign_id
       AND status = 'published'
       AND (ends_at IS NULL OR ends_at > now())
  ) THEN
    RAISE EXCEPTION 'campaign is not open for interest';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM public.campaigns
     WHERE id = NEW.campaign_id
       AND owner_user_id = NEW.interested_user_id
  ) THEN
    RAISE EXCEPTION 'you cannot save interest in your own campaign';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM public.campaigns campaign
      JOIN public.blocks b
        ON (b.blocker_user_id = campaign.owner_user_id
            AND b.blocked_user_id = NEW.interested_user_id)
        OR (b.blocker_user_id = NEW.interested_user_id
            AND b.blocked_user_id = campaign.owner_user_id)
     WHERE campaign.id = NEW.campaign_id
  ) THEN
    RAISE EXCEPTION 'campaign is not open for interest';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(NEW.interested_user_id::TEXT, 530001)
  );
  SELECT coalesce(
           (SELECT value::INTEGER FROM public.app_config
             WHERE key = 'interest_intent_hourly_cap'),
           10
         )
    INTO hourly_cap;
  IF (
    SELECT count(*)
      FROM public.interest_intents existing
     WHERE existing.interested_user_id = NEW.interested_user_id
       AND existing.created_at >= now() - INTERVAL '1 hour'
  ) >= hourly_cap THEN
    RAISE EXCEPTION 'interest intent rate limit exceeded for this account';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.enforce_interest_intent_rules() FROM PUBLIC;

CREATE TRIGGER interest_intents_guard
BEFORE INSERT ON public.interest_intents
FOR EACH ROW EXECUTE FUNCTION private.enforce_interest_intent_rules();

-- The client entry (pinned contract with packages/data interestIntentRepo):
-- idempotent save. The duplicate short-circuit runs BEFORE the insert
-- (join_waitlist pattern) so re-saving an already stored intent never
-- consumes cap headroom and never fails at a full cap.
CREATE FUNCTION public.create_interest_intent(target_campaign_id UUID)
RETURNS TABLE (intent_id UUID, created_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  caller UUID := auth.uid();
  existing interest_intents;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;

  SELECT * INTO existing
    FROM interest_intents
   WHERE campaign_id = target_campaign_id
     AND interested_user_id = caller;
  IF FOUND THEN
    RETURN QUERY SELECT existing.id, existing.created_at;
    RETURN;
  END IF;

  -- ON CONFLICT covers the race two concurrent saves can win past the check
  -- above; the guard trigger's advisory lock serializes them, so the loser
  -- lands here after commit and returns the stored row instead of raising.
  RETURN QUERY
    INSERT INTO interest_intents (campaign_id, interested_user_id)
    VALUES (target_campaign_id, caller)
    ON CONFLICT (campaign_id, interested_user_id) DO NOTHING
    RETURNING interest_intents.id, interest_intents.created_at;
  IF NOT FOUND THEN
    RETURN QUERY
      SELECT i.id, i.created_at
        FROM interest_intents i
       WHERE i.campaign_id = target_campaign_id
         AND i.interested_user_id = caller;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.create_interest_intent(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_interest_intent(UUID) TO authenticated;

-- The caller's own intent for one campaign — never anyone else's. The web
-- surface uses this to show the "saved" state; a Dater/Introducer calling it
-- sees only intents THEY saved as an interested person, which is the same
-- self-only visibility the RLS SELECT policy grants.
CREATE FUNCTION public.get_my_interest_intent(target_campaign_id UUID)
RETURNS TABLE (intent_id UUID, created_at TIMESTAMPTZ)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  caller UUID := auth.uid();
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;
  RETURN QUERY
    SELECT i.id, i.created_at
      FROM interest_intents i
     WHERE i.campaign_id = target_campaign_id
       AND i.interested_user_id = caller;
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_interest_intent(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_interest_intent(UUID) TO authenticated;

-- ── S1 -> S2 promotion ─────────────────────────────────────────────────
-- Promotion IS submit_interest: delegating wholesale means every existing gate
-- fires on its own code path — the 0023/0034 beta gate (BEFORE INSERT on
-- interests), 0026 text moderation, the 0044 profile/photo/identity
-- assertions. While the beta is closed the gate's own raise ('private beta')
-- aborts the transaction, so the intent row is untouched and promotion is
-- correctly refused — that refusal is the intended launch-gate behavior, not
-- an error to handle away. Only a delivered interest consumes the intent.
CREATE FUNCTION public.promote_interest_intent(
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
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM interest_intents
     WHERE campaign_id = target_campaign_id
       AND interested_user_id = caller
  ) THEN
    RAISE EXCEPTION 'no saved interest intent for this campaign';
  END IF;

  RETURN QUERY SELECT * FROM public.submit_interest(target_campaign_id, interest_note);

  -- Reached only when submit_interest delivered (any refusal raised above).
  DELETE FROM interest_intents
   WHERE campaign_id = target_campaign_id
     AND interested_user_id = caller;
END;
$$;

REVOKE ALL ON FUNCTION public.promote_interest_intent(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.promote_interest_intent(UUID, TEXT) TO authenticated;

-- ── Lifecycle-linked cleanup ───────────────────────────────────────────
-- An intent lives as long as its campaign might still deliver it: campaign
-- ends_at + 7 days grace, NOT a fixed shelf life — a fixed N days would let
-- live-campaign intents evaporate while the beta stays closed. Campaign row
-- deletion (account erasure) cascades immediately regardless.
CREATE FUNCTION public.expire_stale_interest_intents()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  removed_count INTEGER;
BEGIN
  DELETE FROM interest_intents intent
   USING campaigns campaign
   WHERE campaign.id = intent.campaign_id
     AND campaign.ends_at IS NOT NULL
     AND campaign.ends_at + INTERVAL '7 days' < now();
  GET DIAGNOSTICS removed_count = ROW_COUNT;
  RETURN removed_count;
END;
$$;

REVOKE ALL ON FUNCTION public.expire_stale_interest_intents() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.expire_stale_interest_intents() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_stale_interest_intents() TO service_role;

-- 0043 pattern: hosted schedules the pure-SQL pass in pg_cron; the local
-- harness (no pg_cron) no-ops. The function is owned by the migration role, so
-- the cron job may execute it without widening the service_role-only grant.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'expire-stale-interest-intents',
      '20 4 * * *',
      $job$SELECT public.expire_stale_interest_intents();$job$
    );
  ELSE
    RAISE NOTICE 'pg_cron unavailable; expire-stale-interest-intents not scheduled (local harness)';
  END IF;
END;
$$;

-- ── D1: claim_referral learns the acquisition channel ──────────────────
-- First-touch attribution gains WHERE the touch came from (?ch= on the shared
-- link). Stored on the claim row itself so the exporter reads one table; the
-- CHECK keeps the shape true even for future non-RPC writers.
ALTER TABLE public.referral_claims
  ADD COLUMN channel TEXT
    CONSTRAINT referral_claims_channel_format
    CHECK (channel IS NULL OR channel ~ '^[a-z0-9_-]{1,64}$');

-- DROP + recreate rather than CREATE OR REPLACE: adding a parameter via
-- CREATE OR REPLACE would leave the old 1-arg function as a second overload
-- and make every 1-arg call ambiguous (confirmed failure mode in this repo).
-- The DEFAULT keeps the deployed 1-arg call sites working against the single
-- 2-arg function. Body is the 0039 body plus channel validation/storage;
-- first-touch no-overwrite semantics are unchanged (ON CONFLICT DO NOTHING).
DROP FUNCTION public.claim_referral(TEXT);

CREATE FUNCTION public.claim_referral(
  source_campaign_slug TEXT,
  channel TEXT DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  caller UUID := auth.uid();
  source_campaign public.campaigns;
  normalized_channel TEXT := nullif(btrim(coalesce(channel, '')), '');
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;
  PERFORM private.assert_active_account(caller);

  IF source_campaign_slug IS NULL OR btrim(source_campaign_slug) = '' THEN
    RAISE EXCEPTION 'a source campaign slug is required';
  END IF;
  IF normalized_channel IS NOT NULL
     AND normalized_channel !~ '^[a-z0-9_-]{1,64}$' THEN
    RAISE EXCEPTION 'channel must be a short lowercase slug';
  END IF;

  SELECT * INTO source_campaign
    FROM public.campaigns
   WHERE slug = source_campaign_slug;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'referral source campaign not found';
  END IF;

  -- A user is never attributed to their own campaign.
  IF source_campaign.owner_user_id = caller THEN
    RETURN;
  END IF;

  INSERT INTO public.referral_claims (source_campaign_id, claimed_by_user_id, channel)
  VALUES (source_campaign.id, caller, normalized_channel)
  ON CONFLICT (claimed_by_user_id) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_referral(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_referral(TEXT, TEXT) TO authenticated;
