-- AUDIT3 REGRESSION — P0-NEW-4 follow-up (interest RE-submission gate)
-- submit_interest (0016) upserts with INSERT ... ON CONFLICT DO UPDATE. The
-- concern raised was that the ON CONFLICT DO UPDATE branch might skip the
-- BEFORE INSERT launch gate and let a holder of an existing interest row
-- re-submit into a non-allowlisted campaign while public_beta_enabled='off'.
--
-- FINDING (proven by this test): PostgreSQL fires the BEFORE INSERT trigger for
-- the row PROPOSED for insertion even when the statement resolves to ON CONFLICT
-- DO UPDATE, so `interests_launch_gate` (0023/0034, BEFORE INSERT) already blocks
-- the re-submit — there is NO bypass, and no new migration is needed. This suite
-- LOCKS that guarantee: re-submission is gated exactly like a fresh submission —
-- blocked when the campaign is not allowlisted, allowed when it is — while owner
-- decision UPDATEs (accept/decline) stay ungated so the internal state machine
-- keeps working. (Verified to pass on migrations 0001–0039 as well, confirming
-- the guarantee predates any follow-up migration.)
BEGIN;

-- Fixtures minted while the seed's beta is still open (publish succeeds).
--   CX = non-allowlisted (owner Alex 0001)
--   CY = allowlisted     (owner Drew 0004)
INSERT INTO pitch_drafts (id, created_by_user_id, subject_user_id, status, headline, body)
VALUES
  ('c1100000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001',
   'published', 'Audit3 resubmit CX', 'Non-allowlisted resubmit probe.'),
  ('c1100000-0000-0000-0000-000000000002',
   '00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000004',
   'published', 'Audit3 resubmit CY', 'Allowlisted resubmit probe.');

INSERT INTO consent_requests (id, pitch_draft_id, subject_user_id, token_hash, status, responded_at)
VALUES
  ('c1110000-0000-0000-0000-000000000001', 'c1100000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000001', 'audit3-c11-consent-x', 'approved', now() - INTERVAL '1 day'),
  ('c1110000-0000-0000-0000-000000000002', 'c1100000-0000-0000-0000-000000000002',
   '00000000-0000-0000-0000-000000000004', 'audit3-c11-consent-y', 'approved', now() - INTERVAL '1 day');

INSERT INTO campaigns (id, pitch_draft_id, owner_user_id, status, published_at, slug)
VALUES
  ('c1120000-0000-0000-0000-000000000001', 'c1100000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000001', 'published', now(), 'audit3-c11-cx'),
  ('c1120000-0000-0000-0000-000000000002', 'c1100000-0000-0000-0000-000000000002',
   '00000000-0000-0000-0000-000000000004', 'published', now(), 'audit3-c11-cy');

-- Casey (0003) is the sender throughout. The interest rows below are INSERTed
-- directly, so they carry no submitted_photo_digest, and since 0055 a NULL
-- digest forces the accept-time photo provenance and 2-photo re-check that 0044
-- grandfathered away. §3 accepts one of those rows with a raw UPDATE to prove
-- the beta gate does NOT reach the owner's decision, so Casey is made genuinely
-- eligible here: the accept must succeed because it is ungated, not because a
-- digest happened to match. The ROLLBACK at the end of the file undoes this.
INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
VALUES
  (
    'profile-media',
    '00000000-0000-0000-0000-000000000003/c11-casey-1.jpg',
    '00000000-0000-0000-0000-000000000003',
    '{"mimetype":"image/jpeg"}'
  ),
  (
    'profile-media',
    '00000000-0000-0000-0000-000000000003/c11-casey-2.jpg',
    '00000000-0000-0000-0000-000000000003',
    '{"mimetype":"image/jpeg"}'
  );

UPDATE dating_profiles
   SET bio = 'Museum fan and weekend cyclist.',
       dating_intent = 'long-term',
       photos = ARRAY[
         '00000000-0000-0000-0000-000000000003/c11-casey-1.jpg',
         '00000000-0000-0000-0000-000000000003/c11-casey-2.jpg'
       ]
 WHERE user_id = '00000000-0000-0000-0000-000000000003';

-- Existing interest rows from Casey (0003), created while the beta is open.
INSERT INTO interests (id, campaign_id, sender_user_id, status, note, submitted_at)
VALUES
  ('c1130000-0000-0000-0000-000000000001', 'c1120000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000003', 'submitted', 'cx first', now()),
  ('c1130000-0000-0000-0000-000000000002', 'c1120000-0000-0000-0000-000000000002',
   '00000000-0000-0000-0000-000000000003', 'submitted', 'cy first', now());

-- Close the beta. Allowlist ONLY CY's draft.
UPDATE app_config SET value = 'off'
 WHERE key IN ('real_payments_enabled', 'public_beta_enabled');
INSERT INTO qa_preview_allowlist (pitch_draft_id, note)
VALUES ('c1100000-0000-0000-0000-000000000002', 'audit3 c11 allowlisted');

-- ── 1. Re-submit into a NON-allowlisted campaign is blocked (the core case) ──
-- Exercises submit_interest's exact ON CONFLICT DO UPDATE path.
DO $$
DECLARE
  blocked BOOLEAN := false;
BEGIN
  BEGIN
    INSERT INTO interests (campaign_id, sender_user_id, status, note, submitted_at)
    VALUES ('c1120000-0000-0000-0000-000000000001',
            '00000000-0000-0000-0000-000000000003', 'submitted', 'cx resubmit', now())
    ON CONFLICT (campaign_id, sender_user_id) DO UPDATE
      SET status = 'submitted', note = EXCLUDED.note, submitted_at = now()
      WHERE interests.status IN ('started', 'verification_pending', 'submitted', 'withdrawn');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%private beta%' THEN
      RAISE EXCEPTION 'AUDIT3-C11: resubmit blocked for the wrong reason: %', SQLERRM;
    END IF;
    blocked := true;
  END;
  IF NOT blocked THEN
    RAISE EXCEPTION 'AUDIT3-C11: re-submit into a non-allowlisted campaign slipped past the gate while beta off';
  END IF;
END;
$$;

-- ── 2. Re-submit into an ALLOWLISTED campaign still succeeds ──
DO $$
BEGIN
  BEGIN
    INSERT INTO interests (campaign_id, sender_user_id, status, note, submitted_at)
    VALUES ('c1120000-0000-0000-0000-000000000002',
            '00000000-0000-0000-0000-000000000003', 'submitted', 'cy resubmit', now())
    ON CONFLICT (campaign_id, sender_user_id) DO UPDATE
      SET status = 'submitted', note = EXCLUDED.note, submitted_at = now()
      WHERE interests.status IN ('started', 'verification_pending', 'submitted', 'withdrawn');
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'AUDIT3-C11: re-submit into an allowlisted campaign was blocked while beta off: %', SQLERRM;
  END;
END;
$$;

-- ── 3. An owner decision UPDATE (accept) is NOT gated (state machine intact) ──
DO $$
BEGIN
  BEGIN
    UPDATE interests SET status = 'accepted', decided_at = now()
     WHERE id = 'c1130000-0000-0000-0000-000000000001';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%private beta%' THEN
      RAISE EXCEPTION 'AUDIT3-C11: an accept UPDATE was wrongly beta-gated (over-gating the state machine)';
    END IF;
    RAISE;
  END;
END;
$$;

-- ── 4. A fresh INSERT into a non-allowlisted campaign stays blocked ──
DO $$
DECLARE
  blocked BOOLEAN := false;
BEGIN
  BEGIN
    INSERT INTO interests (campaign_id, sender_user_id, status, note, submitted_at)
    VALUES ('c1120000-0000-0000-0000-000000000001',
            '00000000-0000-0000-0000-000000000002', 'submitted', 'cx fresh', now());
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%private beta%' THEN
      RAISE EXCEPTION 'AUDIT3-C11: fresh insert blocked for the wrong reason: %', SQLERRM;
    END IF;
    blocked := true;
  END;
  IF NOT blocked THEN
    RAISE EXCEPTION 'AUDIT3-C11: a fresh interest into a non-allowlisted campaign was accepted while beta off';
  END IF;
END;
$$;

ROLLBACK;

SELECT 'c11_interest_resubmit_gate.sql passed' AS result;
