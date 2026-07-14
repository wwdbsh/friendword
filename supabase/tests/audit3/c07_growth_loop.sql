-- AUDIT3 REGRESSION: 3차 감사 Slice 5 — 핵심 성장 루프를 서버 권위로 강제한다.
--   H-7      소유자당 무료 활성 캠페인 1개(published/paused). 두 번째 활성
--            전이는 거부하고, expired/archived 이후에는 새 캠페인을 허용하며,
--            가드는 소유자별로만 작동한다.
--   GP-P0-2  first-touch referral chain(claim + publish 시 서버가 new_campaign
--            연결, 직접 위조 거부)과 anon 도달 가능한 waitlist(형식·중복·시간당
--            cap·slug 귀속).
--   GP-P0-1  Introducer가 자기가 소개한 캠페인 목록과 published/paused slug를
--            받고, 비공개 상태 slug는 NULL로 가려지며, suspended는 거부된다.
--
-- red-first 주의: §1(H-7)의 행동 검사를 맨 앞에 두어, migration 0039 이전 RED
-- 실행에서 "두 번째 활성 캠페인이 그대로 published 되는" 핵심 결함이 곧바로
-- 메시지로 드러나게 한다(0039 랜딩 후 GREEN 전환). 이후 섹션이 참조하는
-- referral/waitlist/list 객체도 0039에서만 생기므로 전체 c07은 RED에서 FAIL,
-- GREEN에서 PASS 한다.
BEGIN;

-- ── Fresh identities (seed 소유자는 이미 활성 캠페인을 가져 가드와 충돌하므로
--    전용 픽스처를 직접 구성한다; c01 패턴). ────────────────────────────────
INSERT INTO auth.users (id, email)
VALUES
  ('c7000000-0000-0000-0000-000000000001', 'c7-gale@example.test'),
  ('c7000000-0000-0000-0000-000000000002', 'c7-introducer@example.test'),
  ('c7000000-0000-0000-0000-000000000003', 'c7-remy@example.test'),
  ('c7000000-0000-0000-0000-000000000004', 'c7-sam@example.test'),
  ('c7000000-0000-0000-0000-000000000005', 'c7-xan@example.test'),
  ('c7000000-0000-0000-0000-000000000006', 'c7-suspended@example.test');

INSERT INTO users (id, account_status, phone_verified_at)
VALUES
  ('c7000000-0000-0000-0000-000000000001', 'active', now() - INTERVAL '10 days'),
  ('c7000000-0000-0000-0000-000000000002', 'active', now() - INTERVAL '10 days'),
  ('c7000000-0000-0000-0000-000000000003', 'active', now() - INTERVAL '10 days'),
  ('c7000000-0000-0000-0000-000000000004', 'active', now() - INTERVAL '10 days'),
  ('c7000000-0000-0000-0000-000000000005', 'active', now() - INTERVAL '10 days'),
  ('c7000000-0000-0000-0000-000000000006', 'suspended', now() - INTERVAL '10 days');

INSERT INTO profiles (user_id, display_name, birth_date, verification_status)
VALUES
  ('c7000000-0000-0000-0000-000000000001', 'Gale Owner', '1990-01-01', 'verified'),
  ('c7000000-0000-0000-0000-000000000003', 'Remy Claimer', '1990-01-01', 'verified'),
  ('c7000000-0000-0000-0000-000000000004', 'Sam Source', '1990-01-01', 'verified'),
  ('c7000000-0000-0000-0000-000000000005', 'Xan Other', '1990-01-01', 'verified');

-- Each campaign we mint is published, so its draft must be published, its
-- subject must equal the campaign owner, and it must carry an approved consent
-- request (the 0001 publish validator). Drafts are never publish-gated.
INSERT INTO pitch_drafts (id, created_by_user_id, subject_user_id, status, headline, body)
VALUES
  ('c7100000-0000-0000-0000-000000000001',
   'c7000000-0000-0000-0000-000000000002', 'c7000000-0000-0000-0000-000000000001',
   'published', 'Gale draft 1', 'H-7 first active campaign probe.'),
  ('c7100000-0000-0000-0000-000000000002',
   'c7000000-0000-0000-0000-000000000002', 'c7000000-0000-0000-0000-000000000001',
   'published', 'Gale draft 2', 'H-7 second active campaign probe.'),
  ('c7100000-0000-0000-0000-000000000003',
   'c7000000-0000-0000-0000-000000000002', 'c7000000-0000-0000-0000-000000000003',
   'published', 'Remy draft', 'Referral new-campaign linkage probe.'),
  ('c7100000-0000-0000-0000-000000000004',
   'c7000000-0000-0000-0000-000000000002', 'c7000000-0000-0000-0000-000000000004',
   'published', 'Sam draft', 'Referral source campaign probe.'),
  ('c7100000-0000-0000-0000-000000000005',
   'c7000000-0000-0000-0000-000000000002', 'c7000000-0000-0000-0000-000000000005',
   'published', 'Xan draft', 'Guard independence probe.');

INSERT INTO consent_requests (id, pitch_draft_id, subject_user_id, token_hash, status, responded_at)
VALUES
  ('c7110000-0000-0000-0000-000000000001', 'c7100000-0000-0000-0000-000000000001',
   'c7000000-0000-0000-0000-000000000001', 'c7-consent-g1', 'approved', now() - INTERVAL '1 day'),
  ('c7110000-0000-0000-0000-000000000002', 'c7100000-0000-0000-0000-000000000002',
   'c7000000-0000-0000-0000-000000000001', 'c7-consent-g2', 'approved', now() - INTERVAL '1 day'),
  ('c7110000-0000-0000-0000-000000000003', 'c7100000-0000-0000-0000-000000000003',
   'c7000000-0000-0000-0000-000000000003', 'c7-consent-r', 'approved', now() - INTERVAL '1 day'),
  ('c7110000-0000-0000-0000-000000000004', 'c7100000-0000-0000-0000-000000000004',
   'c7000000-0000-0000-0000-000000000004', 'c7-consent-s', 'approved', now() - INTERVAL '1 day'),
  ('c7110000-0000-0000-0000-000000000005', 'c7100000-0000-0000-0000-000000000005',
   'c7000000-0000-0000-0000-000000000005', 'c7-consent-x', 'approved', now() - INTERVAL '1 day');

-- The seed opened both launch gates; keep the beta open so the ONLY thing that
-- can block a publish transition here is the H-7 one-active-campaign guard.

-- ── 1. H-7: one free active campaign per owner ─────────────────────────
-- References no 0039-only object, so the pre-0039 RED run reaches it and
-- reports the core defect: the second publish succeeds unguarded.
DO $$
DECLARE
  failures TEXT[] := ARRAY[]::TEXT[];
  blocked BOOLEAN;
  gale CONSTANT UUID := 'c7000000-0000-0000-0000-000000000001';
  xan CONSTANT UUID := 'c7000000-0000-0000-0000-000000000005';
BEGIN
  -- (a) The first active campaign publishes fine.
  BEGIN
    INSERT INTO campaigns (id, pitch_draft_id, owner_user_id, status, published_at, slug, ends_at)
    VALUES ('c7200000-0000-0000-0000-000000000001', 'c7100000-0000-0000-0000-000000000001',
            gale, 'published', now(), 'c7-g1', now() + INTERVAL '30 days');
  EXCEPTION WHEN OTHERS THEN
    failures := array_append(failures, 'the first active campaign for an owner was blocked: ' || SQLERRM);
  END;

  -- (b) CORE RED: a SECOND active campaign for the same owner must be refused.
  blocked := false;
  BEGIN
    INSERT INTO campaigns (id, pitch_draft_id, owner_user_id, status, published_at, slug, ends_at)
    VALUES ('c7200000-0000-0000-0000-000000000002', 'c7100000-0000-0000-0000-000000000002',
            gale, 'published', now(), 'c7-g2', now() + INTERVAL '30 days');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%active campaign%' THEN
      failures := array_append(failures, 'second publish blocked for the wrong reason: ' || SQLERRM);
    END IF;
    blocked := true;
  END;
  IF NOT blocked THEN
    failures := array_append(
      failures,
      'owner published a SECOND active campaign while one was already active (H-7 unenforced)'
    );
  END IF;

  -- (c) A merely paused first campaign still occupies the single active slot.
  UPDATE campaigns SET status = 'paused' WHERE id = 'c7200000-0000-0000-0000-000000000001';
  blocked := false;
  BEGIN
    INSERT INTO campaigns (id, pitch_draft_id, owner_user_id, status, published_at, slug, ends_at)
    VALUES ('c7200000-0000-0000-0000-000000000002', 'c7100000-0000-0000-0000-000000000002',
            gale, 'published', now(), 'c7-g2', now() + INTERVAL '30 days');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%active campaign%' THEN
      failures := array_append(failures, 'publish-with-paused blocked for the wrong reason: ' || SQLERRM);
    END IF;
    blocked := true;
  END;
  IF NOT blocked THEN
    failures := array_append(
      failures,
      'owner published a second campaign while the first was only paused'
    );
  END IF;

  -- (d) Expiring the first campaign frees the slot: a new publish is allowed.
  UPDATE campaigns SET status = 'expired' WHERE id = 'c7200000-0000-0000-0000-000000000001';
  BEGIN
    INSERT INTO campaigns (id, pitch_draft_id, owner_user_id, status, published_at, slug, ends_at)
    VALUES ('c7200000-0000-0000-0000-000000000002', 'c7100000-0000-0000-0000-000000000002',
            gale, 'published', now(), 'c7-g2', now() + INTERVAL '30 days');
  EXCEPTION WHEN OTHERS THEN
    failures := array_append(
      failures, 'owner could not publish after the prior campaign expired: ' || SQLERRM);
  END;

  -- (e) The guard is per-owner: a different owner is never affected.
  BEGIN
    INSERT INTO campaigns (id, pitch_draft_id, owner_user_id, status, published_at, slug, ends_at)
    VALUES ('c7200000-0000-0000-0000-000000000005', 'c7100000-0000-0000-0000-000000000005',
            xan, 'published', now(), 'c7-x1', now() + INTERVAL '30 days');
  EXCEPTION WHEN OTHERS THEN
    failures := array_append(
      failures, 'a different owner was blocked by another owner''s active campaign: ' || SQLERRM);
  END;

  IF cardinality(failures) > 0 THEN
    RAISE EXCEPTION 'AUDIT3-H7: %', array_to_string(failures, '; ');
  END IF;
END;
$$;

-- ── 2. GP-P0-2: durable first-touch referral chain ─────────────────────
-- A referral source campaign with a shareable slug (owner Sam).
INSERT INTO campaigns (id, pitch_draft_id, owner_user_id, status, published_at, slug, ends_at)
VALUES ('c7200000-0000-0000-0000-000000000004', 'c7100000-0000-0000-0000-000000000004',
        'c7000000-0000-0000-0000-000000000004', 'published', now(), 'c7-source-a',
        now() + INTERVAL '30 days');

-- Remy claims Sam's campaign as their first-touch source, then a later claim
-- (Xan's live campaign) must be a no-op that keeps the first source.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'c7000000-0000-0000-0000-000000000003', true);
SELECT public.claim_referral('c7-source-a');
SELECT public.claim_referral('c7-x1');
RESET ROLE;

DO $$
DECLARE
  src UUID;
  linked UUID;
  claim_rows INTEGER;
BEGIN
  SELECT source_campaign_id, new_campaign_id INTO src, linked
    FROM public.referral_claims
   WHERE claimed_by_user_id = 'c7000000-0000-0000-0000-000000000003';
  GET DIAGNOSTICS claim_rows = ROW_COUNT;
  IF claim_rows <> 1 THEN
    RAISE EXCEPTION 'AUDIT3-REFERRAL: expected exactly one first-touch claim for Remy, got %', claim_rows;
  END IF;
  IF src <> 'c7200000-0000-0000-0000-000000000004' THEN
    RAISE EXCEPTION 'AUDIT3-REFERRAL: re-claim overwrote the first-touch source';
  END IF;
  IF linked IS NOT NULL THEN
    RAISE EXCEPTION 'AUDIT3-REFERRAL: new_campaign_id was set before the claimer published anything';
  END IF;
END;
$$;

-- Claiming your OWN campaign is ignored (no self-referential first touch).
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'c7000000-0000-0000-0000-000000000004', true);
SELECT public.claim_referral('c7-source-a');
RESET ROLE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.referral_claims
     WHERE claimed_by_user_id = 'c7000000-0000-0000-0000-000000000004'
  ) THEN
    RAISE EXCEPTION 'AUDIT3-REFERRAL: an owner recorded a claim on their own campaign';
  END IF;
END;
$$;

-- When Remy later publishes their own campaign, the server closes the loop:
-- the open claim is stamped with the new campaign id (client cannot forge it).
INSERT INTO campaigns (id, pitch_draft_id, owner_user_id, status, published_at, slug, ends_at)
VALUES ('c7200000-0000-0000-0000-000000000003', 'c7100000-0000-0000-0000-000000000003',
        'c7000000-0000-0000-0000-000000000003', 'published', now(), 'c7-r-new',
        now() + INTERVAL '30 days');

DO $$
DECLARE
  linked UUID;
BEGIN
  SELECT new_campaign_id INTO linked
    FROM public.referral_claims
   WHERE claimed_by_user_id = 'c7000000-0000-0000-0000-000000000003';
  IF linked IS DISTINCT FROM 'c7200000-0000-0000-0000-000000000003' THEN
    RAISE EXCEPTION 'AUDIT3-REFERRAL: publish did not record the server-authoritative new_campaign_id (got %)', linked;
  END IF;
END;
$$;

-- A client attempting to forge the linkage by writing referral_claims directly
-- is denied (no table privilege for authenticated; RLS has no policy).
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'c7000000-0000-0000-0000-000000000003', true);
DO $$
DECLARE
  denied BOOLEAN := false;
BEGIN
  BEGIN
    UPDATE public.referral_claims
       SET new_campaign_id = 'c7200000-0000-0000-0000-000000000004'
     WHERE claimed_by_user_id = 'c7000000-0000-0000-0000-000000000003';
  EXCEPTION WHEN OTHERS THEN
    denied := true;
  END;
  IF NOT denied THEN
    RAISE EXCEPTION 'AUDIT3-REFERRAL: authenticated forged a direct UPDATE on referral_claims';
  END IF;
END;
$$;
RESET ROLE;

-- ── 3. GP-P0-2: anon-reachable waitlist acquisition surface ────────────
-- A normal signup, executed as anon, is stored and slug-attributed.
SET LOCAL ROLE anon;
SELECT public.join_waitlist('Person@Example.com', 'c7-source-a', 'web_landing');
RESET ROLE;

DO $$
DECLARE
  row_count INTEGER;
  camp UUID;
  src TEXT;
BEGIN
  SELECT count(*) INTO row_count FROM public.waitlist_signups
   WHERE lower(email) = 'person@example.com';
  IF row_count <> 1 THEN
    RAISE EXCEPTION 'AUDIT3-WAITLIST: anon signup did not persist exactly one row (got %)', row_count;
  END IF;
  SELECT source_campaign_id, source INTO camp, src FROM public.waitlist_signups
   WHERE lower(email) = 'person@example.com';
  IF camp IS DISTINCT FROM 'c7200000-0000-0000-0000-000000000004' THEN
    RAISE EXCEPTION 'AUDIT3-WAITLIST: signup was not attributed to the source campaign slug';
  END IF;
  IF src IS DISTINCT FROM 'web_landing' THEN
    RAISE EXCEPTION 'AUDIT3-WAITLIST: signup source label was not recorded';
  END IF;
END;
$$;

-- A duplicate (different case) is a silent no-op — still one row.
SET LOCAL ROLE anon;
SELECT public.join_waitlist('PERSON@example.com');
RESET ROLE;

DO $$
DECLARE
  row_count INTEGER;
BEGIN
  SELECT count(*) INTO row_count FROM public.waitlist_signups
   WHERE lower(email) = 'person@example.com';
  IF row_count <> 1 THEN
    RAISE EXCEPTION 'AUDIT3-WAITLIST: a case-variant duplicate created a second row (got %)', row_count;
  END IF;
END;
$$;

-- A malformed email is rejected.
DO $$
DECLARE
  rejected BOOLEAN := false;
BEGIN
  BEGIN
    PERFORM public.join_waitlist('not-an-email');
  EXCEPTION WHEN OTHERS THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'AUDIT3-WAITLIST: a malformed email was accepted';
  END IF;
END;
$$;

-- The hourly cap is enforced. Lower it to 2; there is already 1 recent row.
UPDATE app_config SET value = '2' WHERE key = 'waitlist_hourly_cap';

SELECT public.join_waitlist('c7-cap-2@example.com');  -- recent count was 1 -> allowed (total 2)

DO $$
DECLARE
  rejected BOOLEAN := false;
BEGIN
  BEGIN
    PERFORM public.join_waitlist('c7-cap-3@example.com');  -- recent count 2 >= cap 2
  EXCEPTION WHEN OTHERS THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'AUDIT3-WAITLIST: the hourly signup cap was not enforced';
  END IF;
END;
$$;

-- Even over the cap, a duplicate of an existing email stays a silent no-op
-- (idempotency short-circuits before the cap check).
DO $$
DECLARE
  ok BOOLEAN := true;
BEGIN
  BEGIN
    PERFORM public.join_waitlist('person@example.com');
  EXCEPTION WHEN OTHERS THEN
    ok := false;
  END;
  IF NOT ok THEN
    RAISE EXCEPTION 'AUDIT3-WAITLIST: an already-listed email errored under a full cap instead of no-op';
  END IF;
END;
$$;

-- ── 4. GP-P0-1: an Introducer sees their campaigns + shareable slugs ───
-- The introducer (Alex fixture user 2) introduced Gale's published campaign
-- (public -> slug returned) and Gale's now-expired campaign (private -> slug
-- masked NULL).
INSERT INTO campaign_memberships (campaign_id, user_id, role)
VALUES
  ('c7200000-0000-0000-0000-000000000002', 'c7000000-0000-0000-0000-000000000002', 'INTRODUCER'),
  ('c7200000-0000-0000-0000-000000000001', 'c7000000-0000-0000-0000-000000000002', 'INTRODUCER');

SELECT set_config('request.jwt.claim.sub', 'c7000000-0000-0000-0000-000000000002', true);
CREATE TEMP TABLE c7_intro_list ON COMMIT DROP AS
  SELECT * FROM public.list_my_introduced_campaigns();

DO $$
DECLARE
  published_slug TEXT;
  published_name TEXT;
  expired_slug TEXT;
  expired_status TEXT;
  total INTEGER;
BEGIN
  SELECT count(*) INTO total FROM c7_intro_list;
  IF total <> 2 THEN
    RAISE EXCEPTION 'AUDIT3-INTRO-LIST: expected the two introduced campaigns, got %', total;
  END IF;

  SELECT campaign_slug, dater_display_name INTO published_slug, published_name
    FROM c7_intro_list WHERE campaign_id = 'c7200000-0000-0000-0000-000000000002';
  IF published_slug IS DISTINCT FROM 'c7-g2' THEN
    RAISE EXCEPTION 'AUDIT3-INTRO-LIST: a published campaign did not expose its shareable slug (got %)', published_slug;
  END IF;
  IF published_name IS DISTINCT FROM 'Gale Owner' THEN
    RAISE EXCEPTION 'AUDIT3-INTRO-LIST: the dater display name was not returned (got %)', published_name;
  END IF;

  SELECT campaign_slug, campaign_status INTO expired_slug, expired_status
    FROM c7_intro_list WHERE campaign_id = 'c7200000-0000-0000-0000-000000000001';
  IF expired_status IS DISTINCT FROM 'expired' THEN
    RAISE EXCEPTION 'AUDIT3-INTRO-LIST: expected the private campaign row to report its status';
  END IF;
  IF expired_slug IS NOT NULL THEN
    RAISE EXCEPTION 'AUDIT3-INTRO-LIST: a non-public campaign leaked its slug (%)', expired_slug;
  END IF;
END;
$$;

-- A non-introducer gets an empty result (owner-only membership does not count).
SELECT set_config('request.jwt.claim.sub', 'c7000000-0000-0000-0000-000000000005', true);
DO $$
DECLARE
  total INTEGER;
BEGIN
  SELECT count(*) INTO total FROM public.list_my_introduced_campaigns();
  IF total <> 0 THEN
    RAISE EXCEPTION 'AUDIT3-INTRO-LIST: a non-introducer received % rows', total;
  END IF;
END;
$$;

-- A suspended account is refused (0037 active-account guard).
SELECT set_config('request.jwt.claim.sub', 'c7000000-0000-0000-0000-000000000006', true);
DO $$
DECLARE
  rejected BOOLEAN := false;
BEGIN
  BEGIN
    PERFORM 1 FROM public.list_my_introduced_campaigns();
  EXCEPTION WHEN OTHERS THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'AUDIT3-INTRO-LIST: a suspended account was allowed to list campaigns';
  END IF;
END;
$$;

ROLLBACK;

SELECT 'c07_growth_loop.sql passed' AS result;
