-- AUDIT3 REGRESSION: 3차 감사 §3 P0-NEW-4 — public_beta_enabled=off는 interest
-- 제출뿐 아니라 campaign publish도 서버에서 authoritative하게 차단해야 하고,
-- 명시적 QA preview allowlist에 오른 draft만 예외가 된다. (Slice 0)
--
-- red-first 주의: 아래 블록 순서는 존재 검사보다 "게이트가 닫혔는데 publish가
-- 성공하는가"라는 행동 검사를 먼저 돌려, migration 0034 이전 RED 실행에서
-- 그 결함이 그대로 메시지로 드러나게 한다.
BEGIN;

-- Fresh pitch_draft fixtures for the campaigns we mint below (campaigns.
-- pitch_draft_id is UNIQUE, so seed drafts already tied to a campaign are
-- unavailable). Drafts are published + their subject == the campaign owner
-- (0002) with an approved consent request, so the pre-existing 0001 publish
-- validator (campaigns_validate_publication) is satisfied and the ONLY thing
-- that can block a publish is the public beta gate. Drafts are never
-- publish-gated, so these inserts are safe regardless of the gate state.
-- H-7 (migration 0039): the one-active-campaign guard now allows only one
-- published/paused campaign per owner. This suite keeps the SEED campaign
-- (20000000-…-0001, owner 0002) active for its own ends_at-renewal and
-- published->paused probes, and simultaneously mints a paused (B) plus two
-- published (C, D) probe campaigns that would coexist. So each probe campaign
-- gets its OWN campaign-free owner (subject == owner, per the publish
-- validator): A→0001, B→0003, C→0004, D→0001 (A is always rolled back by the
-- gate, so it may share 0001 with D without ever coexisting). This changes
-- only WHO owns each probe, not WHAT the beta gate is asserted to do.
INSERT INTO pitch_drafts (id, created_by_user_id, subject_user_id, status, headline, body)
VALUES
  ('c0100000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001',
   'published', 'Audit3 draft A', 'Direct publish INSERT probe.'),
  ('c0100000-0000-0000-0000-000000000002',
   '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000003',
   'published', 'Audit3 draft B', 'Paused->published transition probe.'),
  ('c0100000-0000-0000-0000-000000000003',
   '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000004',
   'published', 'Audit3 draft C', 'Allowlisted preview probe.'),
  ('c0100000-0000-0000-0000-000000000004',
   '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001',
   'published', 'Audit3 draft D', 'Gate-on publish probe.');

INSERT INTO consent_requests (id, pitch_draft_id, subject_user_id, token_hash, status, responded_at)
VALUES
  ('c1100000-0000-0000-0000-000000000001', 'c0100000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000001', 'audit3-consent-a', 'approved', now() - INTERVAL '1 day'),
  ('c1100000-0000-0000-0000-000000000002', 'c0100000-0000-0000-0000-000000000002',
   '00000000-0000-0000-0000-000000000003', 'audit3-consent-b', 'approved', now() - INTERVAL '1 day'),
  ('c1100000-0000-0000-0000-000000000003', 'c0100000-0000-0000-0000-000000000003',
   '00000000-0000-0000-0000-000000000004', 'audit3-consent-c', 'approved', now() - INTERVAL '1 day'),
  ('c1100000-0000-0000-0000-000000000004', 'c0100000-0000-0000-0000-000000000004',
   '00000000-0000-0000-0000-000000000001', 'audit3-consent-d', 'approved', now() - INTERVAL '1 day');

-- Close both gates (seed.sql opened them for the other local suites).
UPDATE app_config SET value = 'off'
 WHERE key IN ('real_payments_enabled', 'public_beta_enabled');

-- ── 1. Publish transitions are authoritatively gated while the beta is closed ──
-- This block references no 0034-only object, so the pre-0034 RED run reaches
-- it and reports the core defect: the publish INSERT succeeds unguarded.
DO $$
DECLARE
  failures TEXT[] := ARRAY[]::TEXT[];
  blocked BOOLEAN;
  seed_camp CONSTANT UUID := '20000000-0000-0000-0000-000000000001';
BEGIN
  -- (a) A direct INSERT of a published campaign must be blocked.
  blocked := false;
  BEGIN
    INSERT INTO campaigns (id, pitch_draft_id, owner_user_id, status, published_at)
    VALUES (
      'c0100000-0000-0000-0000-0000000000a1',
      'c0100000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000001',
      'published',
      now()
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%private beta%' THEN
      failures := array_append(failures, 'publish INSERT blocked for the wrong reason: ' || SQLERRM);
    END IF;
    blocked := true;
  END;
  IF NOT blocked THEN
    failures := array_append(
      failures,
      'campaign publish INSERT succeeded while the public beta gate is closed'
    );
  END IF;

  -- (b) A paused campaign cannot be promoted to published. The paused INSERT
  -- itself is not a publish transition, so it is allowed even while gated.
  INSERT INTO campaigns (id, pitch_draft_id, owner_user_id, status)
  VALUES (
    'c0100000-0000-0000-0000-0000000000a2',
    'c0100000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000003',
    'paused'
  );
  blocked := false;
  BEGIN
    UPDATE campaigns
       SET status = 'published', published_at = now()
     WHERE id = 'c0100000-0000-0000-0000-0000000000a2';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%private beta%' THEN
      failures := array_append(failures, 'paused->published blocked for the wrong reason: ' || SQLERRM);
    END IF;
    blocked := true;
  END;
  IF NOT blocked THEN
    failures := array_append(
      failures,
      'paused campaign was promoted to published while the gate is closed'
    );
  END IF;

  -- (c) Renewing ends_at on an already published campaign is NOT a transition
  -- into published and must stay allowed.
  BEGIN
    UPDATE campaigns
       SET ends_at = now() + INTERVAL '3 days'
     WHERE id = seed_camp;
  EXCEPTION WHEN OTHERS THEN
    failures := array_append(failures, 'ends_at renewal on a published campaign was blocked: ' || SQLERRM);
  END;

  -- (d) Leaving published (published->paused) must never be blocked.
  BEGIN
    UPDATE campaigns SET status = 'paused' WHERE id = seed_camp;
  EXCEPTION WHEN OTHERS THEN
    failures := array_append(failures, 'published->paused was blocked: ' || SQLERRM);
  END;

  IF cardinality(failures) > 0 THEN
    RAISE EXCEPTION 'AUDIT3-GATE: %', array_to_string(failures, '; ');
  END IF;
END;
$$;

-- ── 2. The 0034 structure exists ──
DO $$
BEGIN
  IF to_regclass('public.qa_preview_allowlist') IS NULL THEN
    RAISE EXCEPTION 'AUDIT3-STRUCT: public.qa_preview_allowlist table is missing';
  END IF;
  IF to_regprocedure('private.public_beta_or_preview_allowed(uuid)') IS NULL THEN
    RAISE EXCEPTION 'AUDIT3-STRUCT: private.public_beta_or_preview_allowed(uuid) is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'campaigns_public_beta_gate'
  ) THEN
    RAISE EXCEPTION 'AUDIT3-STRUCT: campaigns_public_beta_gate trigger is missing';
  END IF;
END;
$$;

-- ── 3. The QA preview allowlist is the only gate-off exception ──
DO $$
DECLARE
  failures TEXT[] := ARRAY[]::TEXT[];
  blocked BOOLEAN;
  seed_camp CONSTANT UUID := '20000000-0000-0000-0000-000000000001';
  draft_c CONSTANT UUID := 'c0100000-0000-0000-0000-000000000003';
  camp_c CONSTANT UUID := 'c0100000-0000-0000-0000-0000000000a3';
BEGIN
  -- Interest into a campaign whose draft is NOT allowlisted stays blocked.
  blocked := false;
  BEGIN
    INSERT INTO interests (campaign_id, sender_user_id, status, note, submitted_at)
    VALUES (seed_camp, '00000000-0000-0000-0000-000000000004', 'submitted',
            'audit3 non-allowlisted probe', now());
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%private beta%' THEN
      failures := array_append(failures, 'non-allowlisted interest blocked for the wrong reason: ' || SQLERRM);
    END IF;
    blocked := true;
  END;
  IF NOT blocked THEN
    failures := array_append(
      failures,
      'interest into a non-allowlisted campaign was accepted while the gate is closed'
    );
  END IF;

  -- Allowlisting the draft opens exactly that campaign's publish + interest.
  INSERT INTO qa_preview_allowlist (pitch_draft_id, note)
  VALUES (draft_c, 'audit3 c01 preview surface');

  BEGIN
    INSERT INTO campaigns (id, pitch_draft_id, owner_user_id, status, published_at, slug)
    VALUES (camp_c, draft_c, '00000000-0000-0000-0000-000000000004',
            'published', now(), 'audit3-preview-camp');
  EXCEPTION WHEN OTHERS THEN
    failures := array_append(failures, 'allowlisted draft could not publish while the gate is closed: ' || SQLERRM);
  END;

  BEGIN
    INSERT INTO interests (campaign_id, sender_user_id, status, note, submitted_at)
    VALUES (camp_c, '00000000-0000-0000-0000-000000000003', 'submitted',
            'audit3 allowlisted probe', now());
  EXCEPTION WHEN OTHERS THEN
    failures := array_append(failures, 'interest into an allowlisted campaign was blocked while the gate is closed: ' || SQLERRM);
  END;

  IF cardinality(failures) > 0 THEN
    RAISE EXCEPTION 'AUDIT3-ALLOWLIST: %', array_to_string(failures, '; ');
  END IF;
END;
$$;

-- ── 4. Opening the public beta restores publish + interest with no allowlist ──
UPDATE app_config SET value = 'on'
 WHERE key IN ('real_payments_enabled', 'public_beta_enabled');

DO $$
DECLARE
  failures TEXT[] := ARRAY[]::TEXT[];
  draft_d CONSTANT UUID := 'c0100000-0000-0000-0000-000000000004';
  camp_d CONSTANT UUID := 'c0100000-0000-0000-0000-0000000000a4';
BEGIN
  BEGIN
    INSERT INTO campaigns (id, pitch_draft_id, owner_user_id, status, published_at, slug)
    VALUES (camp_d, draft_d, '00000000-0000-0000-0000-000000000001',
            'published', now(), 'audit3-gate-on-camp');
  EXCEPTION WHEN OTHERS THEN
    failures := array_append(failures, 'publish transition was blocked while the gate is open: ' || SQLERRM);
  END;

  BEGIN
    INSERT INTO interests (campaign_id, sender_user_id, status, note, submitted_at)
    VALUES (camp_d, '00000000-0000-0000-0000-000000000003', 'submitted',
            'audit3 gate-on probe', now());
  EXCEPTION WHEN OTHERS THEN
    failures := array_append(failures, 'interest was blocked while the gate is open: ' || SQLERRM);
  END;

  IF cardinality(failures) > 0 THEN
    RAISE EXCEPTION 'AUDIT3-GATE-ON: %', array_to_string(failures, '; ');
  END IF;
END;
$$;

-- NOTE: the approve_and_publish_pitch RPC path is intentionally NOT probed
-- here. Its publish step is an INSERT ... ON CONFLICT DO UPDATE on campaigns,
-- so the campaigns_public_beta_gate BEFORE INSERT/UPDATE trigger governs it on
-- exactly the same code path the direct INSERT probe above exercises. Standing
-- up a consent_pending draft + consent request + revision + assets purely to
-- re-cross the same trigger would add fixture surface without new coverage.

ROLLBACK;

SELECT 'c01_public_beta_gate.sql passed' AS result;
