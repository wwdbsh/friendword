-- Full Flow B journey: submit (introducer) → preview (anon) → claim (dater)
-- → approve & publish. Uses seeded draft 10..02 (creator user4, subject user1).

BEGIN;

-- 1. Introducer (user4) submits the seeded draft; capture the raw token.
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000004';
RESET ROLE;
CREATE TEMP TABLE consent_journey (consent_token TEXT) ON COMMIT DROP;
GRANT ALL ON consent_journey TO anon, authenticated;
SET LOCAL ROLE authenticated;
INSERT INTO consent_journey
SELECT consent_token FROM submit_pitch_for_consent('10000000-0000-0000-0000-000000000002');

-- 2. Anonymous preview shows introducer context but nothing sensitive.
SET LOCAL ROLE anon;
DO $$
DECLARE
  preview RECORD;
  bad_count INTEGER;
BEGIN
  SELECT * INTO preview
    FROM get_consent_preview((SELECT consent_token FROM consent_journey));
  IF preview.introducer_display_name IS DISTINCT FROM 'Drew Introducer' THEN
    RAISE EXCEPTION 'preview did not expose introducer display name, got %',
      preview.introducer_display_name;
  END IF;
  IF preview.request_status <> 'pending' THEN
    RAISE EXCEPTION 'preview status expected pending, got %', preview.request_status;
  END IF;

  SELECT count(*) INTO bad_count FROM get_consent_preview('not-a-real-token');
  IF bad_count <> 0 THEN
    RAISE EXCEPTION 'invalid token produced a preview';
  END IF;
END;
$$;

-- 3. The introducer cannot claim their own request.
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000004';
DO $$
BEGIN
  BEGIN
    PERFORM * FROM claim_consent_request((SELECT consent_token FROM consent_journey));
    RAISE EXCEPTION 'introducer claimed their own consent request';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM = 'introducer claimed their own consent request' THEN
        RAISE;
      END IF;
  END;
END;
$$;

-- 4. A stranger (user3) cannot claim a request linked to user1.
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000003';
DO $$
BEGIN
  BEGIN
    PERFORM * FROM claim_consent_request((SELECT consent_token FROM consent_journey));
    RAISE EXCEPTION 'stranger claimed a request linked to another account';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM = 'stranger claimed a request linked to another account' THEN
        RAISE;
      END IF;
  END;
END;
$$;

-- 5. The linked dater (user1) claims, approves, and publishes.
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000001';
DO $$
DECLARE
  claimed_draft UUID;
  approved_revision_id UUID;
  approved_asset_ids UUID[];
  publish RECORD;
  membership_count INTEGER;
  final_status pitch_draft_status;
BEGIN
  SELECT pitch_draft_id INTO claimed_draft
    FROM claim_consent_request((SELECT consent_token FROM consent_journey));
  IF claimed_draft <> '10000000-0000-0000-0000-000000000002' THEN
    RAISE EXCEPTION 'claim returned the wrong draft';
  END IF;

  SELECT r.id, r.asset_ids
    INTO approved_revision_id, approved_asset_ids
    FROM consent_requests cr
    JOIN consent_revisions r ON r.id = cr.revision_id
   WHERE cr.pitch_draft_id = claimed_draft;
  SELECT * INTO publish FROM approve_and_publish_pitch(
    claimed_draft,
    14,
    approved_revision_id,
    approved_asset_ids,
    true
  );
  IF publish.campaign_slug IS NULL OR length(publish.campaign_slug) < 8 THEN
    RAISE EXCEPTION 'publish did not produce a usable slug, got %', publish.campaign_slug;
  END IF;

  SELECT status INTO final_status
    FROM pitch_drafts WHERE id = claimed_draft;
  IF final_status <> 'published' THEN
    RAISE EXCEPTION 'draft status expected published, got %', final_status;
  END IF;

  -- Approving twice must fail (no longer consent_pending).
  BEGIN
    PERFORM * FROM approve_and_publish_pitch(
      claimed_draft,
      14,
      approved_revision_id,
      approved_asset_ids,
      true
    );
    RAISE EXCEPTION 'double publish was accepted';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM = 'double publish was accepted' THEN
        RAISE;
      END IF;
  END;
END;
$$;

-- 6. Verify the published state without RLS filtering.
RESET ROLE;
DO $$
DECLARE
  membership_count INTEGER;
  campaign_status TEXT;
BEGIN
  SELECT count(*) INTO membership_count
    FROM campaign_memberships cm
    JOIN campaigns c ON c.id = cm.campaign_id
   WHERE c.pitch_draft_id = '10000000-0000-0000-0000-000000000002'
     AND cm.role IN ('DATER_OWNER', 'INTRODUCER');
  IF membership_count <> 2 THEN
    RAISE EXCEPTION 'expected DATER_OWNER + INTRODUCER memberships, got %', membership_count;
  END IF;

  SELECT status INTO campaign_status
    FROM campaigns
   WHERE pitch_draft_id = '10000000-0000-0000-0000-000000000002';
  IF campaign_status <> 'published' THEN
    RAISE EXCEPTION 'campaign expected published, got %', campaign_status;
  END IF;
END;
$$;

ROLLBACK;

SELECT '05_consent_flow.sql passed' AS result;
