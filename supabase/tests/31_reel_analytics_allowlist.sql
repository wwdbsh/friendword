-- 0057: the reel funnel's first two stages reach analytics_events.
--
-- `reel_visit` (funnel entry, fired anonymously by
-- apps/web/src/components/ReferralTracker.tsx:76) and `s1_intent_created`
-- (fired signed-in by apps/web/app/p/[campaignSlug]/interest/
-- InterestFlow.tsx:261) were both absent from the track_event allowlist, so
-- every call raised and PostgREST answered 400. These guards pin that they now
-- land, that reel_visit lands WITHOUT a session while s1_intent_created still
-- requires one, and that nothing else the allowlist refuses got loosened.
--
-- Fixtures are the seed campaign 2000…0001 and seed user 0000…0003, the same
-- pair 09_analytics.sql uses. The seed campaign is inserted without a slug (a
-- slug is minted by the publish RPC), so slug-shaped assertions use the
-- 'demo-blair' literal the property validator accepts by name — this file is
-- about which event names are allowed, and campaign_slug existence is already
-- covered by 17_paid_benefits.sql.

BEGIN;

-- Scope the row assertions at the bottom to the rows THIS file inserts, so a
-- future seed row or an added case elsewhere cannot make them pass or fail for
-- the wrong reason. now() is the transaction timestamp and is constant for the
-- whole transaction, so every row inserted below carries exactly this value in
-- its created_at default while seed rows (a separate, earlier transaction)
-- carry a strictly smaller one.
SELECT set_config('friendword.test_started_at', now()::TEXT, true);

-- ── R-A: an anonymous visitor records the funnel entry ────────────────────
-- Anonymity is the point: a visit that never signs in is exactly the traffic
-- this metric exists to count.
SET LOCAL ROLE anon;
SELECT track_event('reel_visit',
  '{"campaign_id": "20000000-0000-0000-0000-000000000001", "channel": "instagram"}');

-- R-B: ReferralTracker's real property shape — a campaign slug plus a
-- `channel` that is JSON null when the URL carried no ?ch. A null must not
-- trip the slug-shape check.
SELECT track_event('reel_visit',
  '{"campaign_slug": "demo-blair", "channel": null}');

-- R-C: the new names did not become a hole in the property allowlist.
DO $$
BEGIN
  BEGIN
    PERFORM track_event('reel_visit',
      '{"campaign_slug": "demo-blair", "padding": "x"}');
    RAISE EXCEPTION 'reel_visit accepted an unlisted property';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM = 'reel_visit accepted an unlisted property' THEN
        RAISE;
      END IF;
      IF SQLERRM NOT LIKE 'analytics property % is not allowed' THEN
        RAISE EXCEPTION 'unexpected property rejection: %', SQLERRM;
      END IF;
  END;
END;
$$;

-- R-D: S1 is an authenticated conversion. An anonymous caller cannot have
-- saved a private intent, so it must still be refused without a session.
DO $$
BEGIN
  BEGIN
    PERFORM track_event('s1_intent_created',
      '{"campaign_id": "20000000-0000-0000-0000-000000000001"}');
    RAISE EXCEPTION 'anonymous s1_intent_created accepted';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM = 'anonymous s1_intent_created accepted' THEN
        RAISE;
      END IF;
      IF SQLERRM NOT LIKE '%requires authentication%' THEN
        RAISE EXCEPTION 'unexpected anonymous rejection: %', SQLERRM;
      END IF;
  END;
END;
$$;

-- ── R-E: signed in, S1 is accepted and stamped with the caller ────────────
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000003';
SELECT track_event('s1_intent_created',
  '{"campaign_id": "20000000-0000-0000-0000-000000000001"}');

-- R-F: unrelated names are still refused, so the allowlist did not turn into
-- a pass-through. `s2_interest_delivered` is a real funnel stage name that is
-- deliberately NOT client-sendable (S2 is the interest_submitted trigger).
DO $$
BEGIN
  BEGIN
    PERFORM track_event('s2_interest_delivered', '{}');
    RAISE EXCEPTION 'unlisted funnel name accepted';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM = 'unlisted funnel name accepted' THEN
        RAISE;
      END IF;
      IF SQLERRM NOT LIKE 'unknown analytics event%' THEN
        RAISE EXCEPTION 'unexpected unknown-event rejection: %', SQLERRM;
      END IF;
  END;
END;
$$;

-- R-G: the later funnel stages stay server-recorded; a client claiming one is
-- still forging growth evidence (second audit H-4).
DO $$
BEGIN
  BEGIN
    PERFORM track_event('interest_submitted',
      '{"campaign_id": "20000000-0000-0000-0000-000000000001"}');
    RAISE EXCEPTION 'client outcome event accepted';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM = 'client outcome event accepted' THEN
        RAISE;
      END IF;
      IF SQLERRM NOT LIKE '%recorded by the server%' THEN
        RAISE EXCEPTION 'unexpected outcome rejection: %', SQLERRM;
      END IF;
  END;
END;
$$;

RESET ROLE;

-- ── What actually landed ──────────────────────────────────────────────────
DO $$
DECLARE
  started_at TIMESTAMPTZ :=
    current_setting('friendword.test_started_at')::TIMESTAMPTZ;
  visit_rows INT;
  identified_visits INT;
  s1_rows INT;
  s1_user UUID;
BEGIN
  SELECT count(*) INTO visit_rows
    FROM analytics_events
   WHERE event_name = 'reel_visit' AND created_at >= started_at;
  IF visit_rows <> 2 THEN
    RAISE EXCEPTION 'expected 2 reel_visit rows from this file, got %',
      visit_rows;
  END IF;

  SELECT count(*) INTO identified_visits
    FROM analytics_events
   WHERE event_name = 'reel_visit'
     AND created_at >= started_at
     AND user_id IS NOT NULL;
  IF identified_visits <> 0 THEN
    RAISE EXCEPTION 'anonymous reel_visit carried a user id';
  END IF;

  SELECT count(*) INTO s1_rows
    FROM analytics_events
   WHERE event_name = 's1_intent_created' AND created_at >= started_at;
  IF s1_rows <> 1 THEN
    RAISE EXCEPTION 'expected 1 s1_intent_created row from this file, got %',
      s1_rows;
  END IF;

  -- Exactly one row above, so this is that row.
  SELECT user_id INTO s1_user
    FROM analytics_events
   WHERE event_name = 's1_intent_created' AND created_at >= started_at;
  IF s1_user IS DISTINCT FROM '00000000-0000-0000-0000-000000000003' THEN
    RAISE EXCEPTION 's1_intent_created missing the caller id, got %', s1_user;
  END IF;
END;
$$;

ROLLBACK;

SELECT '31_reel_analytics_allowlist.sql passed' AS result;
