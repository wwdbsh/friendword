-- AUDIT2 REGRESSION: H-3(P0-2 동반), 감사 §4·§5 텍스트 UGC moderation 게이트.
-- Slice 2부터 그린: enforcement on에서 pitch text·bio·note는 content-addressed
-- passed verdict 없이는 제출될 수 없다.
BEGIN;

DO $$
BEGIN
  IF to_regclass('public.text_moderations') IS NULL THEN
    RAISE EXCEPTION 'AUDIT2-H3: text_moderations is missing';
  END IF;
  IF to_regprocedure('private.text_moderation_passed(text,text)') IS NULL THEN
    RAISE EXCEPTION 'AUDIT2-H3: private.text_moderation_passed(text,text) is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'pitch_drafts_text_moderation_gate'
  ) THEN
    RAISE EXCEPTION 'AUDIT2-H3: pitch text gate trigger is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'interests_text_moderation_gate'
  ) THEN
    RAISE EXCEPTION 'AUDIT2-H3: interest text gate trigger is missing';
  END IF;
END;
$$;

UPDATE app_config SET value = 'on' WHERE key = 'media_validation_enforcement';

INSERT INTO pitch_drafts (id, created_by_user_id, status, headline, body)
VALUES (
  'b1200000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000004',
  'draft',
  'Clean headline',
  'Clean body.'
);

-- 1. Without a verdict, the draft cannot enter consent review.
DO $$
DECLARE
  blocked BOOLEAN := false;
BEGIN
  BEGIN
    UPDATE pitch_drafts SET status = 'consent_pending'
     WHERE id = 'b1200000-0000-0000-0000-000000000001';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%pitch text requires completed moderation%' THEN
      RAISE EXCEPTION 'AUDIT2-H3: pitch gate failed for the wrong reason: %', SQLERRM;
    END IF;
    blocked := true;
  END;
  IF NOT blocked THEN
    RAISE EXCEPTION 'AUDIT2-H3: unmoderated pitch text entered consent review';
  END IF;
END;
$$;

-- 2. A flagged verdict for the exact content does not unlock it.
INSERT INTO text_moderations (scope, content_hash, moderation_status)
VALUES (
  'pitch_content',
  encode(digest('Clean headline' || E'\n\n' || 'Clean body.', 'sha256'), 'hex'),
  'flagged'
);

DO $$
DECLARE
  blocked BOOLEAN := false;
BEGIN
  BEGIN
    UPDATE pitch_drafts SET status = 'consent_pending'
     WHERE id = 'b1200000-0000-0000-0000-000000000001';
  EXCEPTION WHEN OTHERS THEN
    blocked := true;
  END;
  IF NOT blocked THEN
    RAISE EXCEPTION 'AUDIT2-H3: flagged pitch text entered consent review';
  END IF;
END;
$$;

-- 3. A passed verdict for the exact content unlocks it; different content
-- (edited after moderation) stays blocked.
UPDATE text_moderations SET moderation_status = 'passed'
 WHERE scope = 'pitch_content';

UPDATE pitch_drafts SET status = 'consent_pending'
 WHERE id = 'b1200000-0000-0000-0000-000000000001';

UPDATE pitch_drafts SET status = 'draft', headline = 'Edited headline'
 WHERE id = 'b1200000-0000-0000-0000-000000000001';

DO $$
DECLARE
  blocked BOOLEAN := false;
BEGIN
  BEGIN
    UPDATE pitch_drafts SET status = 'consent_pending'
     WHERE id = 'b1200000-0000-0000-0000-000000000001';
  EXCEPTION WHEN OTHERS THEN
    blocked := true;
  END;
  IF NOT blocked THEN
    RAISE EXCEPTION 'AUDIT2-H3: edited pitch text reused a stale verdict';
  END IF;
END;
$$;

-- 4. Interest note and bio gates: seed user 4 has no dating profile row;
-- give them one with a bio, then require verdicts for both texts.
INSERT INTO dating_profiles (user_id, bio, photos, dating_intent, approximate_location)
VALUES (
  '00000000-0000-0000-0000-000000000004',
  'A short bio.',
  ARRAY[]::TEXT[],
  'long-term',
  'Seoul'
)
ON CONFLICT (user_id) DO UPDATE SET bio = EXCLUDED.bio;

DO $$
DECLARE
  blocked BOOLEAN := false;
BEGIN
  BEGIN
    INSERT INTO interests (campaign_id, sender_user_id, status, note, submitted_at)
    VALUES (
      '20000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000004',
      'submitted',
      'An unmoderated note',
      now()
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%requires completed moderation%' THEN
      RAISE EXCEPTION 'AUDIT2-H3: interest gate failed for the wrong reason: %', SQLERRM;
    END IF;
    blocked := true;
  END;
  IF NOT blocked THEN
    RAISE EXCEPTION 'AUDIT2-H3: unmoderated bio/note submitted interest';
  END IF;
END;
$$;

INSERT INTO text_moderations (scope, content_hash, moderation_status)
VALUES
  ('profile_bio', encode(digest('A short bio.', 'sha256'), 'hex'), 'passed'),
  ('interest_note', encode(digest('A moderated note', 'sha256'), 'hex'), 'passed');

DO $$
BEGIN
  INSERT INTO interests (campaign_id, sender_user_id, status, note, submitted_at)
  VALUES (
    '20000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000004',
    'submitted',
    'A moderated note',
    now()
  );
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'AUDIT2-H3: moderated bio+note interest was blocked: %', SQLERRM;
END;
$$;

-- 5. Enforcement off leaves legacy behavior untouched.
UPDATE app_config SET value = 'off' WHERE key = 'media_validation_enforcement';

INSERT INTO pitch_drafts (id, created_by_user_id, status, headline, body)
VALUES (
  'b1200000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000004',
  'draft',
  'Unmoderated but allowed',
  'Enforcement is off.'
);

UPDATE pitch_drafts SET status = 'consent_pending'
 WHERE id = 'b1200000-0000-0000-0000-000000000002';

ROLLBACK;

SELECT 'b12_text_moderation_gate.sql passed' AS result;
