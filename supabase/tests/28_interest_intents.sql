-- Migration 0053 regressions: staged interest (S1 intent) and the referral
-- channel argument.
--
--   A. An S1 intent is storable with ONLY an account while the public beta
--      gate is CLOSED — the funnel's terminal step no longer discards reel
--      arrivals — yet it reaches no Dater/Introducer surface: not by direct
--      SELECT, not through the owner inbox RPC.
--   B. Promotion (S1 -> S2) is submit_interest wholesale, so every existing
--      gate fires unchanged: profile completeness, and the 0023/0034 beta
--      gate whose refusal while the beta is closed is pinned as CORRECT
--      behavior. Only a delivered interest consumes the intent.
--   C. Volume is bounded per account (0045 advisory-lock pattern), duplicates
--      are structural (unique), lifetime is campaign-linked (ends_at + 7d),
--      and account erasure covers the table via the users FK cascade.
--   D. claim_referral gains a channel: allowlist-validated, first-touch
--      preserved, 1-arg call sites keep working, and exactly one overload
--      exists (the repo's known CREATE OR REPLACE ambiguity failure mode).
--
-- red-first: before 0053 this file fails at the first block (the table does
-- not exist); the behavior assertions double as mutation probes — removing
-- the guard trigger, the cap, the promotion delete, or the channel validation
-- each flips a specific DO block red.
BEGIN;

-- ═══ Fixtures ══════════════════════════════════════════════════════════
-- Fresh identities: a sender with an account + profile but NO dating profile
-- (that absence is itself under test), one draft author, and four campaign
-- owners (H-7 allows one active campaign per owner).
INSERT INTO auth.users (id, email)
VALUES
  ('ee280000-0000-0000-0000-000000000001', 'i28-sender@example.test'),
  ('ee280000-0000-0000-0000-000000000002', 'i28-author@example.test'),
  ('ee280000-0000-0000-0000-000000000003', 'i28-owner-a@example.test'),
  ('ee280000-0000-0000-0000-000000000004', 'i28-owner-b@example.test'),
  ('ee280000-0000-0000-0000-000000000005', 'i28-owner-c@example.test'),
  ('ee280000-0000-0000-0000-000000000006', 'i28-owner-d@example.test');

INSERT INTO users (id, account_status, phone_verified_at)
SELECT id, 'active', now() - INTERVAL '10 days'
  FROM auth.users
 WHERE id::TEXT LIKE 'ee280000-%';

INSERT INTO profiles (user_id, display_name, birth_date, verification_status)
VALUES
  ('ee280000-0000-0000-0000-000000000001', 'I28 Sender', '1994-05-05', 'verified'),
  ('ee280000-0000-0000-0000-000000000002', 'I28 Author', '1990-01-01', 'verified'),
  ('ee280000-0000-0000-0000-000000000003', 'I28 Owner A', '1990-01-01', 'verified'),
  ('ee280000-0000-0000-0000-000000000004', 'I28 Owner B', '1990-01-01', 'verified'),
  ('ee280000-0000-0000-0000-000000000005', 'I28 Owner C', '1990-01-01', 'verified'),
  ('ee280000-0000-0000-0000-000000000006', 'I28 Owner D', '1990-01-01', 'verified');

INSERT INTO pitch_drafts (id, created_by_user_id, subject_user_id, status, headline, body)
VALUES
  ('ee281000-0000-0000-0000-000000000001',
   'ee280000-0000-0000-0000-000000000002', 'ee280000-0000-0000-0000-000000000003',
   'published', 'I28 draft A', 'Main S1 probe campaign.'),
  ('ee281000-0000-0000-0000-000000000002',
   'ee280000-0000-0000-0000-000000000002', 'ee280000-0000-0000-0000-000000000004',
   'published', 'I28 draft B', 'Second campaign for cap and cascade probes.'),
  ('ee281000-0000-0000-0000-000000000003',
   'ee280000-0000-0000-0000-000000000002', 'ee280000-0000-0000-0000-000000000005',
   'published', 'I28 draft C', 'Third campaign for cap window and expiry probes.'),
  ('ee281000-0000-0000-0000-000000000004',
   'ee280000-0000-0000-0000-000000000002', 'ee280000-0000-0000-0000-000000000006',
   'published', 'I28 draft D', 'Blocked-pair probe campaign.'),
  ('ee281000-0000-0000-0000-000000000005',
   'ee280000-0000-0000-0000-000000000002', 'ee280000-0000-0000-0000-000000000003',
   'published', 'I28 draft E', 'Unpublished campaign probe.');

INSERT INTO consent_requests (id, pitch_draft_id, subject_user_id, token_hash, status, responded_at)
VALUES
  ('ee281100-0000-0000-0000-000000000001', 'ee281000-0000-0000-0000-000000000001',
   'ee280000-0000-0000-0000-000000000003', 'i28-consent-a', 'approved', now() - INTERVAL '1 day'),
  ('ee281100-0000-0000-0000-000000000002', 'ee281000-0000-0000-0000-000000000002',
   'ee280000-0000-0000-0000-000000000004', 'i28-consent-b', 'approved', now() - INTERVAL '1 day'),
  ('ee281100-0000-0000-0000-000000000003', 'ee281000-0000-0000-0000-000000000003',
   'ee280000-0000-0000-0000-000000000005', 'i28-consent-c', 'approved', now() - INTERVAL '1 day'),
  ('ee281100-0000-0000-0000-000000000004', 'ee281000-0000-0000-0000-000000000004',
   'ee280000-0000-0000-0000-000000000006', 'i28-consent-d', 'approved', now() - INTERVAL '1 day'),
  ('ee281100-0000-0000-0000-000000000005', 'ee281000-0000-0000-0000-000000000005',
   'ee280000-0000-0000-0000-000000000003', 'i28-consent-e', 'approved', now() - INTERVAL '1 day');

-- Campaigns are minted while the seed keeps the beta open (publish is gated).
-- E stays 'draft' (a draft campaign is never publish-validated and does not
-- occupy owner A's single active slot).
INSERT INTO campaigns (id, pitch_draft_id, owner_user_id, status, published_at, slug, ends_at)
VALUES
  ('ee282000-0000-0000-0000-000000000001', 'ee281000-0000-0000-0000-000000000001',
   'ee280000-0000-0000-0000-000000000003', 'published', now(), 'i28-a', now() + INTERVAL '30 days'),
  ('ee282000-0000-0000-0000-000000000002', 'ee281000-0000-0000-0000-000000000002',
   'ee280000-0000-0000-0000-000000000004', 'published', now(), 'i28-b', now() + INTERVAL '30 days'),
  ('ee282000-0000-0000-0000-000000000003', 'ee281000-0000-0000-0000-000000000003',
   'ee280000-0000-0000-0000-000000000005', 'published', now(), 'i28-c', now() + INTERVAL '30 days'),
  ('ee282000-0000-0000-0000-000000000004', 'ee281000-0000-0000-0000-000000000004',
   'ee280000-0000-0000-0000-000000000006', 'published', now(), 'i28-d', now() + INTERVAL '30 days'),
  ('ee282000-0000-0000-0000-000000000005', 'ee281000-0000-0000-0000-000000000005',
   'ee280000-0000-0000-0000-000000000003', 'draft', NULL, NULL, NULL);

-- Owner D has blocked the sender.
INSERT INTO blocks (blocker_user_id, blocked_user_id)
VALUES ('ee280000-0000-0000-0000-000000000006', 'ee280000-0000-0000-0000-000000000001');

-- ═══ A. S1 saves while the beta gate is CLOSED ═════════════════════════
UPDATE app_config SET value = 'off' WHERE key = 'public_beta_enabled';

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'ee280000-0000-0000-0000-000000000001', true);

-- (A1) The RPC stores an intent with no dating profile and the beta off, and
-- re-saving is an idempotent no-op returning the same row.
DO $$
DECLARE
  first_id UUID;
  second_id UUID;
  total INTEGER;
BEGIN
  SELECT intent_id INTO first_id
    FROM public.create_interest_intent('ee282000-0000-0000-0000-000000000001');
  IF first_id IS NULL THEN
    RAISE EXCEPTION 'I28-S1: saving an intent with beta off returned no row';
  END IF;
  SELECT intent_id INTO second_id
    FROM public.create_interest_intent('ee282000-0000-0000-0000-000000000001');
  IF second_id IS DISTINCT FROM first_id THEN
    RAISE EXCEPTION 'I28-S1: re-save was not idempotent (% vs %)', first_id, second_id;
  END IF;
  SELECT count(*) INTO total FROM interest_intents
   WHERE campaign_id = 'ee282000-0000-0000-0000-000000000001'
     AND interested_user_id = 'ee280000-0000-0000-0000-000000000001';
  IF total <> 1 THEN
    RAISE EXCEPTION 'I28-S1: expected exactly one stored intent, got %', total;
  END IF;
END;
$$;

-- (A2) The RLS direct-insert path also works for one's own row...
INSERT INTO interest_intents (campaign_id, interested_user_id)
VALUES ('ee282000-0000-0000-0000-000000000002', 'ee280000-0000-0000-0000-000000000001');

-- ...but a duplicate direct insert is refused by the unique key, and forging
-- an intent for ANOTHER user is refused by RLS.
DO $$
DECLARE
  refused BOOLEAN := false;
BEGIN
  BEGIN
    INSERT INTO interest_intents (campaign_id, interested_user_id)
    VALUES ('ee282000-0000-0000-0000-000000000002', 'ee280000-0000-0000-0000-000000000001');
  EXCEPTION WHEN unique_violation THEN
    refused := true;
  END;
  IF NOT refused THEN
    RAISE EXCEPTION 'I28-S1: a duplicate direct insert created a second row';
  END IF;

  refused := false;
  BEGIN
    INSERT INTO interest_intents (campaign_id, interested_user_id)
    VALUES ('ee282000-0000-0000-0000-000000000003', 'ee280000-0000-0000-0000-000000000006');
  EXCEPTION WHEN OTHERS THEN
    refused := true;
  END;
  IF NOT refused THEN
    RAISE EXCEPTION 'I28-S1: a caller inserted an intent on behalf of another user';
  END IF;
END;
$$;

-- (A3) Guards: an unpublished campaign, your own campaign, and a blocked pair
-- are refused with the pinned messages (blocked == closed, indistinguishable).
DO $$
DECLARE
  message TEXT;
BEGIN
  BEGIN
    PERFORM public.create_interest_intent('ee282000-0000-0000-0000-000000000005');
    RAISE EXCEPTION 'I28-S1: an intent was saved on an unpublished campaign';
  EXCEPTION WHEN OTHERS THEN
    message := SQLERRM;
  END;
  IF message <> 'campaign is not open for interest' THEN
    RAISE EXCEPTION 'I28-S1: unpublished campaign refused with the wrong message: %', message;
  END IF;

  BEGIN
    PERFORM public.create_interest_intent('ee282000-0000-0000-0000-000000000004');
    RAISE EXCEPTION 'I28-S1: a blocked sender saved an intent';
  EXCEPTION WHEN OTHERS THEN
    message := SQLERRM;
  END;
  IF message <> 'campaign is not open for interest' THEN
    RAISE EXCEPTION 'I28-S1: blocked pair refused with the wrong message: %', message;
  END IF;
END;
$$;

SELECT set_config('request.jwt.claim.sub', 'ee280000-0000-0000-0000-000000000003', true);
DO $$
DECLARE
  message TEXT;
BEGIN
  BEGIN
    PERFORM public.create_interest_intent('ee282000-0000-0000-0000-000000000001');
    RAISE EXCEPTION 'I28-S1: an owner saved interest in their own campaign';
  EXCEPTION WHEN OTHERS THEN
    message := SQLERRM;
  END;
  IF message <> 'you cannot save interest in your own campaign' THEN
    RAISE EXCEPTION 'I28-S1: own-campaign refused with the wrong message: %', message;
  END IF;
END;
$$;

-- ═══ B. No Dater/Introducer surface sees an S1 row (§8 guard) ══════════
-- Owner A: zero rows by direct SELECT, zero rows in the inbox RPC — the
-- sender holds a stored intent on owner A's campaign right now.
DO $$
DECLARE
  visible INTEGER;
BEGIN
  SELECT count(*) INTO visible FROM interest_intents;
  IF visible <> 0 THEN
    RAISE EXCEPTION 'I28-RLS: campaign owner can read % interest intent row(s)', visible;
  END IF;
  SELECT count(*) INTO visible
    FROM public.list_campaign_interests('ee282000-0000-0000-0000-000000000001');
  IF visible <> 0 THEN
    RAISE EXCEPTION 'I28-RLS: an undelivered S1 intent appeared in the owner inbox';
  END IF;
  -- get_my_interest_intent is self-scoped: the owner asking about their OWN
  -- campaign still sees nothing, because the stored intent is not theirs.
  SELECT count(*) INTO visible
    FROM public.get_my_interest_intent('ee282000-0000-0000-0000-000000000001');
  IF visible <> 0 THEN
    RAISE EXCEPTION 'I28-RLS: get_my_interest_intent leaked another user''s intent to the owner';
  END IF;
END;
$$;

-- The draft author (Introducer role surface) sees nothing either.
SELECT set_config('request.jwt.claim.sub', 'ee280000-0000-0000-0000-000000000002', true);
DO $$
DECLARE
  visible INTEGER;
BEGIN
  SELECT count(*) INTO visible FROM interest_intents;
  IF visible <> 0 THEN
    RAISE EXCEPTION 'I28-RLS: introducer can read % interest intent row(s)', visible;
  END IF;
END;
$$;

-- The sender still sees exactly their own two intents, and the read RPC
-- returns their saved intent for the campaign.
SELECT set_config('request.jwt.claim.sub', 'ee280000-0000-0000-0000-000000000001', true);
DO $$
DECLARE
  visible INTEGER;
  own_intent UUID;
BEGIN
  SELECT count(*) INTO visible FROM interest_intents;
  IF visible <> 2 THEN
    RAISE EXCEPTION 'I28-RLS: sender sees % of their 2 intents', visible;
  END IF;
  SELECT intent_id INTO own_intent
    FROM public.get_my_interest_intent('ee282000-0000-0000-0000-000000000001');
  IF own_intent IS NULL THEN
    RAISE EXCEPTION 'I28-RLS: get_my_interest_intent did not return the caller''s own intent';
  END IF;
END;
$$;
RESET ROLE;

-- anon holds no privilege on the table at all.
SET LOCAL ROLE anon;
DO $$
DECLARE
  refused BOOLEAN := false;
BEGIN
  BEGIN
    PERFORM count(*) FROM interest_intents;
  EXCEPTION WHEN insufficient_privilege THEN
    refused := true;
  END;
  IF NOT refused THEN
    RAISE EXCEPTION 'I28-RLS: anon can select from interest_intents';
  END IF;
END;
$$;
RESET ROLE;

-- ═══ C. Per-account hourly cap (0045 advisory-lock pattern) ════════════
-- The sender holds 2 intents this hour (A, B). Cap 2 refuses the third; aging
-- one out of the window frees headroom; the duplicate short-circuit never
-- consumes or trips the cap.
UPDATE app_config SET value = '2' WHERE key = 'interest_intent_hourly_cap';

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'ee280000-0000-0000-0000-000000000001', true);
DO $$
DECLARE
  message TEXT;
  returned UUID;
BEGIN
  BEGIN
    PERFORM public.create_interest_intent('ee282000-0000-0000-0000-000000000003');
    RAISE EXCEPTION 'I28-CAP: a third intent inside the hour beat a cap of 2';
  EXCEPTION WHEN OTHERS THEN
    message := SQLERRM;
  END;
  IF message <> 'interest intent rate limit exceeded for this account' THEN
    RAISE EXCEPTION 'I28-CAP: cap refused with the wrong message: %', message;
  END IF;

  -- A duplicate save at a full cap stays a silent no-op (idempotency first).
  SELECT intent_id INTO returned
    FROM public.create_interest_intent('ee282000-0000-0000-0000-000000000001');
  IF returned IS NULL THEN
    RAISE EXCEPTION 'I28-CAP: duplicate save errored at a full cap instead of no-op';
  END IF;
END;
$$;
RESET ROLE;

-- Age the first intent out of the hour window: the cap counts stored volume
-- in the window, so the third campaign now fits.
UPDATE interest_intents
   SET created_at = now() - INTERVAL '2 hours'
 WHERE campaign_id = 'ee282000-0000-0000-0000-000000000001'
   AND interested_user_id = 'ee280000-0000-0000-0000-000000000001';

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'ee280000-0000-0000-0000-000000000001', true);
SELECT intent_id FROM public.create_interest_intent('ee282000-0000-0000-0000-000000000003');
RESET ROLE;

UPDATE app_config SET value = '10' WHERE key = 'interest_intent_hourly_cap';

-- ═══ D. Promotion runs every existing S2 gate ══════════════════════════
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'ee280000-0000-0000-0000-000000000001', true);

-- (D1) Without a dating profile, promotion is refused by submit_interest's
-- own completeness rule (beta still off; the profile check fires first).
DO $$
DECLARE
  message TEXT;
BEGIN
  BEGIN
    PERFORM public.promote_interest_intent('ee282000-0000-0000-0000-000000000001');
    RAISE EXCEPTION 'I28-PROMOTE: promotion succeeded without a dating profile';
  EXCEPTION WHEN OTHERS THEN
    message := SQLERRM;
  END;
  IF message <> 'complete your dating profile (bio, intent, and at least 2 photos) first' THEN
    RAISE EXCEPTION 'I28-PROMOTE: profile gate refused with the wrong message: %', message;
  END IF;
END;
$$;

-- (D2) Promotion without a saved intent is refused before any gate.
DO $$
DECLARE
  message TEXT;
BEGIN
  BEGIN
    PERFORM public.promote_interest_intent('ee282000-0000-0000-0000-000000000004');
    RAISE EXCEPTION 'I28-PROMOTE: promotion ran without a stored intent';
  EXCEPTION WHEN OTHERS THEN
    message := SQLERRM;
  END;
  IF message <> 'no saved interest intent for this campaign' THEN
    RAISE EXCEPTION 'I28-PROMOTE: missing-intent refused with the wrong message: %', message;
  END IF;
END;
$$;
RESET ROLE;

-- Complete the sender's dating profile with owned storage objects (the 0044
-- submit-time provenance assertions are part of the gate under test).
INSERT INTO dating_profiles (user_id, bio, photos, dating_intent, approximate_location)
VALUES (
  'ee280000-0000-0000-0000-000000000001',
  'Gallery weekends and long bike rides.',
  ARRAY[
    'ee280000-0000-0000-0000-000000000001/one.jpg',
    'ee280000-0000-0000-0000-000000000001/two.jpg'
  ],
  'long-term',
  'Seoul'
);
INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
VALUES
  ('profile-media', 'ee280000-0000-0000-0000-000000000001/one.jpg',
   'ee280000-0000-0000-0000-000000000001', '{"mimetype":"image/jpeg"}'),
  ('profile-media', 'ee280000-0000-0000-0000-000000000001/two.jpg',
   'ee280000-0000-0000-0000-000000000001', '{"mimetype":"image/jpeg"}');

-- (D3) With a complete profile but the beta CLOSED, promotion is refused by
-- the 0023 launch gate — pinned as the CORRECT outcome — and the intent
-- survives for when the gate opens.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'ee280000-0000-0000-0000-000000000001', true);
DO $$
DECLARE
  message TEXT;
  kept INTEGER;
BEGIN
  BEGIN
    PERFORM public.promote_interest_intent('ee282000-0000-0000-0000-000000000001');
    RAISE EXCEPTION 'I28-PROMOTE: promotion delivered an interest while the beta gate is closed';
  EXCEPTION WHEN OTHERS THEN
    message := SQLERRM;
  END;
  IF message <> 'Friendword is in a private beta; interest submissions are not open yet' THEN
    RAISE EXCEPTION 'I28-PROMOTE: beta gate refused with the wrong message: %', message;
  END IF;
  SELECT count(*) INTO kept FROM interest_intents
   WHERE campaign_id = 'ee282000-0000-0000-0000-000000000001'
     AND interested_user_id = 'ee280000-0000-0000-0000-000000000001';
  IF kept <> 1 THEN
    RAISE EXCEPTION 'I28-PROMOTE: a refused promotion consumed the intent';
  END IF;
END;
$$;
RESET ROLE;

-- (D4) Beta open: promotion delivers through submit_interest, consumes the
-- intent, and the interest NOW appears in the owner inbox (S2 delivered).
UPDATE app_config SET value = 'on' WHERE key = 'public_beta_enabled';

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'ee280000-0000-0000-0000-000000000001', true);
DO $$
DECLARE
  delivered_id UUID;
  delivered_status TEXT;
  kept INTEGER;
BEGIN
  SELECT interest_id, interest_status INTO delivered_id, delivered_status
    FROM public.promote_interest_intent(
      'ee282000-0000-0000-0000-000000000001', 'Saved this from your reel — hi!'
    );
  IF delivered_id IS NULL OR delivered_status <> 'submitted' THEN
    RAISE EXCEPTION 'I28-PROMOTE: promotion did not deliver a submitted interest (%, %)',
      delivered_id, delivered_status;
  END IF;
  SELECT count(*) INTO kept FROM interest_intents
   WHERE campaign_id = 'ee282000-0000-0000-0000-000000000001'
     AND interested_user_id = 'ee280000-0000-0000-0000-000000000001';
  IF kept <> 0 THEN
    RAISE EXCEPTION 'I28-PROMOTE: a delivered promotion left the intent row behind';
  END IF;
END;
$$;

SELECT set_config('request.jwt.claim.sub', 'ee280000-0000-0000-0000-000000000003', true);
DO $$
DECLARE
  visible INTEGER;
BEGIN
  SELECT count(*) INTO visible
    FROM public.list_campaign_interests('ee282000-0000-0000-0000-000000000001');
  IF visible <> 1 THEN
    RAISE EXCEPTION 'I28-PROMOTE: the delivered interest is not in the owner inbox (got %)', visible;
  END IF;
END;
$$;
RESET ROLE;

-- ═══ E. Campaign-lifetime-linked expiry (ends_at + 7 days) ═════════════
-- Campaign C lapsed 8 days ago -> its intent is swept; campaign B is live ->
-- its intent survives. Client roles cannot run the sweep.
UPDATE campaigns SET ends_at = now() - INTERVAL '8 days'
 WHERE id = 'ee282000-0000-0000-0000-000000000003';

DO $$
DECLARE
  removed INTEGER;
  b_kept INTEGER;
  c_kept INTEGER;
BEGIN
  SELECT public.expire_stale_interest_intents() INTO removed;
  IF removed <> 1 THEN
    RAISE EXCEPTION 'I28-EXPIRY: expected the sweep to remove exactly 1 intent, got %', removed;
  END IF;
  SELECT count(*) INTO c_kept FROM interest_intents
   WHERE campaign_id = 'ee282000-0000-0000-0000-000000000003';
  IF c_kept <> 0 THEN
    RAISE EXCEPTION 'I28-EXPIRY: the lapsed campaign kept % intent(s)', c_kept;
  END IF;
  SELECT count(*) INTO b_kept FROM interest_intents
   WHERE campaign_id = 'ee282000-0000-0000-0000-000000000002';
  IF b_kept <> 1 THEN
    RAISE EXCEPTION 'I28-EXPIRY: the live campaign lost its intent';
  END IF;
END;
$$;

SET LOCAL ROLE authenticated;
DO $$
DECLARE
  refused BOOLEAN := false;
BEGIN
  BEGIN
    PERFORM public.expire_stale_interest_intents();
  EXCEPTION WHEN insufficient_privilege THEN
    refused := true;
  END;
  IF NOT refused THEN
    RAISE EXCEPTION 'I28-EXPIRY: authenticated may run the sweep directly';
  END IF;
END;
$$;
RESET ROLE;

-- ═══ F. claim_referral channel ═════════════════════════════════════════
-- (F1) Exactly one overload exists: the 2-arg function, and no lingering
-- 1-arg twin that would make deployed calls ambiguous.
DO $$
BEGIN
  IF to_regprocedure('public.claim_referral(text,text)') IS NULL THEN
    RAISE EXCEPTION 'I28-REFERRAL: claim_referral(text,text) is missing';
  END IF;
  IF to_regprocedure('public.claim_referral(text)') IS NOT NULL THEN
    RAISE EXCEPTION 'I28-REFERRAL: the 1-arg claim_referral overload still exists (ambiguous calls)';
  END IF;
END;
$$;

-- (F2) The deployed 1-arg call shape still works (DEFAULT NULL channel).
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'ee280000-0000-0000-0000-000000000004', true);
SELECT public.claim_referral('i28-a');

-- (F3) A channel is stored, allowlist-validated, and first-touch is never
-- overwritten by a later claim.
SELECT set_config('request.jwt.claim.sub', 'ee280000-0000-0000-0000-000000000005', true);
SELECT public.claim_referral('i28-a', 'reels');
SELECT public.claim_referral('i28-b', 'stories');

SELECT set_config('request.jwt.claim.sub', 'ee280000-0000-0000-0000-000000000006', true);
DO $$
DECLARE
  message TEXT;
BEGIN
  BEGIN
    PERFORM public.claim_referral('i28-a', 'Bad Channel!');
    RAISE EXCEPTION 'I28-REFERRAL: a malformed channel was accepted';
  EXCEPTION WHEN OTHERS THEN
    message := SQLERRM;
  END;
  IF message <> 'channel must be a short lowercase slug' THEN
    RAISE EXCEPTION 'I28-REFERRAL: malformed channel refused with the wrong message: %', message;
  END IF;

  BEGIN
    PERFORM public.claim_referral('i28-a', 'Reels');
    RAISE EXCEPTION 'I28-REFERRAL: an uppercase channel beat the allowlist';
  EXCEPTION WHEN OTHERS THEN
    message := SQLERRM;
  END;
  IF message <> 'channel must be a short lowercase slug' THEN
    RAISE EXCEPTION 'I28-REFERRAL: uppercase channel refused with the wrong message: %', message;
  END IF;
END;
$$;
RESET ROLE;

DO $$
DECLARE
  stored_channel TEXT;
  stored_source UUID;
BEGIN
  SELECT channel INTO stored_channel FROM referral_claims
   WHERE claimed_by_user_id = 'ee280000-0000-0000-0000-000000000004';
  IF stored_channel IS NOT NULL THEN
    RAISE EXCEPTION 'I28-REFERRAL: a 1-arg claim stored a channel (%)', stored_channel;
  END IF;

  SELECT source_campaign_id, channel INTO stored_source, stored_channel
    FROM referral_claims
   WHERE claimed_by_user_id = 'ee280000-0000-0000-0000-000000000005';
  IF stored_source IS DISTINCT FROM 'ee282000-0000-0000-0000-000000000001'
     OR stored_channel IS DISTINCT FROM 'reels' THEN
    RAISE EXCEPTION 'I28-REFERRAL: first-touch source/channel not preserved (%, %)',
      stored_source, stored_channel;
  END IF;

  IF EXISTS (
    SELECT 1 FROM referral_claims
     WHERE claimed_by_user_id = 'ee280000-0000-0000-0000-000000000006'
  ) THEN
    RAISE EXCEPTION 'I28-REFERRAL: a refused claim still stored a row';
  END IF;
END;
$$;

-- (F4) The CHECK keeps the shape true even for a direct (service) write.
DO $$
DECLARE
  refused BOOLEAN := false;
BEGIN
  BEGIN
    INSERT INTO referral_claims (source_campaign_id, claimed_by_user_id, channel)
    VALUES ('ee282000-0000-0000-0000-000000000001',
            'ee280000-0000-0000-0000-000000000006', 'BAD');
  EXCEPTION WHEN check_violation THEN
    refused := true;
  END;
  IF NOT refused THEN
    RAISE EXCEPTION 'I28-REFERRAL: the channel CHECK constraint is missing or lax';
  END IF;
END;
$$;

-- ═══ G. Account erasure covers interest_intents via the users cascade ══
-- The 0037 deletion job's final stage deletes the auth user; everything the
-- job removes explicitly is cleared here first (interests/blocks FKs are
-- NO ACTION), and the intent rows must then vanish through the cascade with
-- no per-table step in the job.
DELETE FROM interests WHERE sender_user_id = 'ee280000-0000-0000-0000-000000000001';
DELETE FROM blocks WHERE blocked_user_id = 'ee280000-0000-0000-0000-000000000001';
DELETE FROM auth.users WHERE id = 'ee280000-0000-0000-0000-000000000001';

DO $$
DECLARE
  remaining INTEGER;
BEGIN
  SELECT count(*) INTO remaining FROM interest_intents
   WHERE interested_user_id = 'ee280000-0000-0000-0000-000000000001';
  IF remaining <> 0 THEN
    RAISE EXCEPTION 'I28-ERASURE: % intent row(s) survived account deletion', remaining;
  END IF;
END;
$$;

ROLLBACK;

SELECT '28_interest_intents.sql passed' AS result;
