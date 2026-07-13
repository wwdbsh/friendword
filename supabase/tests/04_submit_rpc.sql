-- Tests for submit_pitch_for_consent (see 0004_submit_rpc.sql).
-- Uses the seeded draft pitch 10000000-...-0002 created by user ...-0004.

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000001';
DO $$
BEGIN
  -- Not the creator of draft ...-0002 → must fail.
  BEGIN
    PERFORM * FROM submit_pitch_for_consent('10000000-0000-0000-0000-000000000002', 'email', 'dater@example.test', 'Blair');
    RAISE EXCEPTION 'non-creator was able to submit a draft for consent';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM = 'non-creator was able to submit a draft for consent' THEN
        RAISE;
      END IF;
  END;
END;
$$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000004';
DO $$
DECLARE
  returned_request_id UUID;
  returned_token TEXT;
  stored_hash TEXT;
  draft_status pitch_draft_status;
BEGIN
  SELECT consent_request_id, consent_token
    INTO returned_request_id, returned_token
    FROM submit_pitch_for_consent('10000000-0000-0000-0000-000000000002', 'email', 'dater@example.test', 'Blair');

  IF returned_token IS NULL OR length(returned_token) < 24 THEN
    RAISE EXCEPTION 'submit did not return a usable consent token';
  END IF;

  SELECT status INTO draft_status
    FROM pitch_drafts
   WHERE id = '10000000-0000-0000-0000-000000000002';
  IF draft_status <> 'consent_pending' THEN
    RAISE EXCEPTION 'submit did not transition draft to consent_pending';
  END IF;

  SELECT token_hash INTO stored_hash
    FROM consent_requests
   WHERE id = returned_request_id;
  IF stored_hash = returned_token THEN
    RAISE EXCEPTION 'raw consent token must not be stored';
  END IF;
  IF stored_hash <> encode(digest(returned_token, 'sha256'), 'hex') THEN
    RAISE EXCEPTION 'stored token hash does not match returned token';
  END IF;

  -- Second submit of the same draft → must fail (no longer in draft status).
  BEGIN
    PERFORM * FROM submit_pitch_for_consent('10000000-0000-0000-0000-000000000002', 'email', 'dater@example.test', 'Blair');
    RAISE EXCEPTION 'double submit was accepted';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM = 'double submit was accepted' THEN
        RAISE;
      END IF;
  END;
END;
$$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE anon;
DO $$
BEGIN
  BEGIN
    PERFORM * FROM submit_pitch_for_consent('10000000-0000-0000-0000-000000000002', 'email', 'dater@example.test', 'Blair');
    RAISE EXCEPTION 'anon was able to call submit RPC';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
    WHEN raise_exception THEN
      IF SQLERRM = 'anon was able to call submit RPC' THEN
        RAISE;
      END IF;
  END;
END;
$$;
ROLLBACK;

SELECT '04_submit_rpc.sql passed' AS result;
