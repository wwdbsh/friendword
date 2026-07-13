-- Second audit Slice 1 (P0-1, H-1): anonymous reports can no longer
-- auto-pause a campaign single-handedly, repeat reports dedupe per
-- reporter identity, and suspended/deletion-requested accounts lose
-- read access to sensitive data (their mutations were already blocked).

-- 1. Reporter identity dedupe: the same identity (user id, or salted IP
-- hash for anonymous reports) reporting the same target for the same
-- reason within 24 hours does not create another row. Authenticated
-- reporters get an honest error; the anonymous path skips silently so
-- the public endpoint stays a non-oracle.
CREATE FUNCTION private.dedupe_repeat_reports()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.reporter_user_id IS NULL AND NEW.reporter_ip_hash IS NULL THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.reports existing
     WHERE existing.target_type = NEW.target_type
       AND existing.target_id = NEW.target_id
       AND existing.reason = NEW.reason
       AND existing.created_at >= now() - INTERVAL '24 hours'
       AND (
         (NEW.reporter_user_id IS NOT NULL
          AND existing.reporter_user_id = NEW.reporter_user_id)
         OR
         (NEW.reporter_user_id IS NULL
          AND existing.reporter_user_id IS NULL
          AND existing.reporter_ip_hash = NEW.reporter_ip_hash)
       )
  ) THEN
    IF NEW.reporter_user_id IS NOT NULL THEN
      RAISE EXCEPTION 'you already reported this recently';
    END IF;
    RETURN NULL;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.dedupe_repeat_reports() FROM PUBLIC;

CREATE TRIGGER reports_dedupe_repeat
BEFORE INSERT ON public.reports
FOR EACH ROW EXECUTE FUNCTION private.dedupe_repeat_reports();

-- 2. Auto-pause counts distinct trusted reporter identities, not report
-- rows. An anonymous report is only a distinct identity through its
-- salted IP hash; legacy anonymous rows without a hash never count.
CREATE OR REPLACE FUNCTION private.pause_campaign_after_high_severity_report()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  paused_campaign_id UUID;
BEGIN
  IF NEW.severity <> 'high' OR NEW.campaign_id IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(NEW.campaign_id::TEXT, 160016)
  );

  IF (
    SELECT count(DISTINCT coalesce(reporter_user_id::TEXT, 'ip:' || reporter_ip_hash))
      FROM public.reports
     WHERE campaign_id = NEW.campaign_id
       AND severity = 'high'
       AND created_at >= now() - INTERVAL '24 hours'
       AND (reporter_user_id IS NOT NULL OR reporter_ip_hash IS NOT NULL)
  ) < 2 THEN
    RETURN NEW;
  END IF;

  UPDATE public.campaigns
     SET status = 'paused'
   WHERE id = NEW.campaign_id
     AND status = 'published'
  RETURNING id INTO paused_campaign_id;

  IF paused_campaign_id IS NOT NULL THEN
    INSERT INTO public.ops_alerts (alert_type, campaign_id, report_id, detail)
    VALUES (
      'campaign_auto_paused',
      paused_campaign_id,
      NEW.id,
      jsonb_build_object(
        'window_hours', 24,
        'threshold', 2,
        'distinct_identities', true
      )
    );
  END IF;

  RETURN NEW;
END;
$$;

-- 3. Suspended, deletion-requested, or deleted accounts lose sensitive
-- reads. One restrictive policy per table ANDs with the existing
-- permissive policies, so ownership rules stay untouched. users,
-- profiles, and deletion_requests stay readable: the client needs them
-- to show the account state honestly.
CREATE FUNCTION private.account_is_active(target_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
     WHERE id = target_user_id AND account_status = 'active'
  );
$$;

REVOKE ALL ON FUNCTION private.account_is_active(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.account_is_active(UUID) TO authenticated;

DO $$
DECLARE
  sensitive_table TEXT;
BEGIN
  FOREACH sensitive_table IN ARRAY ARRAY[
    'pitch_drafts',
    'pitch_assets',
    'consent_requests',
    'consent_revisions',
    'campaigns',
    'campaign_memberships',
    'vouches',
    'interests',
    'intro_rooms',
    'messages',
    'reports',
    'blocks',
    'dating_profiles',
    'introducer_profiles',
    'purchase_intents',
    'purchase_credit_ledger',
    'campaign_entitlements'
  ] LOOP
    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR SELECT TO authenticated
        USING (private.account_is_active(auth.uid()))',
      sensitive_table || '_active_account_read',
      sensitive_table
    );
  END LOOP;
END;
$$;
