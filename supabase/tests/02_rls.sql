INSERT INTO analytics_events (event_name, properties)
VALUES ('rls_hidden_event', '{"test": true}'::JSONB);

INSERT INTO cost_ledger (provider, amount_minor, currency)
VALUES ('rls-test-provider', 100, 'USD');

INSERT INTO interests (
  id,
  campaign_id,
  sender_user_id,
  status,
  submitted_at
)
VALUES (
  '30000000-0000-0000-0000-000000000002',
  '20000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  'submitted',
  now()
);
-- The probe used to sit on the DRAFT campaign 20000000-...-0002. submit_interest
-- can never produce that shape (it requires a published campaign inside its
-- window), and since 0044 the accept invariant is a trigger rather than an RPC
-- check, so accepting into a draft is refused for every caller. The probe moves
-- to the published seed campaign — owner Blair (0002), sender Alex (0001), who
-- has a seeded dating profile — which is what the RLS assertions below actually
-- mean to exercise.

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000001';
DO $$
DECLARE
  visible_count INTEGER;
BEGIN
  SELECT count(*) INTO visible_count
    FROM dating_profiles
   WHERE user_id = '00000000-0000-0000-0000-000000000001';
  IF visible_count <> 1 THEN
    RAISE EXCEPTION 'User A cannot read their dating profile';
  END IF;

  SELECT count(*) INTO visible_count
    FROM dating_profiles
   WHERE user_id = '00000000-0000-0000-0000-000000000002';
  IF visible_count <> 0 THEN
    RAISE EXCEPTION 'User A can read User B dating profile';
  END IF;

  SELECT count(*) INTO visible_count
    FROM campaigns
   WHERE id = '20000000-0000-0000-0000-000000000001';
  IF visible_count <> 1 THEN
    RAISE EXCEPTION 'campaign member cannot read campaign';
  END IF;

  SELECT count(*) INTO visible_count FROM messages;
  IF visible_count <> 0 THEN
    RAISE EXCEPTION 'intro room nonparticipant can read messages';
  END IF;

  SELECT count(*) INTO visible_count FROM cost_ledger;
  IF visible_count <> 0 THEN
    RAISE EXCEPTION 'authenticated user can read cost ledger';
  END IF;

  SELECT count(*) INTO visible_count FROM analytics_events;
  IF visible_count <> 0 THEN
    RAISE EXCEPTION 'authenticated user can read analytics events';
  END IF;
END;
$$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000003';
DO $$
DECLARE
  visible_count INTEGER;
BEGIN
  SELECT count(*) INTO visible_count
    FROM campaigns
   WHERE id = '20000000-0000-0000-0000-000000000001';
  IF visible_count <> 0 THEN
    RAISE EXCEPTION 'campaign nonmember can read campaign';
  END IF;

  SELECT count(*) INTO visible_count FROM messages;
  IF visible_count <> 2 THEN
    RAISE EXCEPTION 'intro room participant cannot read both messages';
  END IF;
END;
$$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000001';
DO $$
DECLARE
  updated_count INTEGER;
BEGIN
  UPDATE users
     SET preferences = '{"theme": "dark"}'::JSONB
   WHERE id = '00000000-0000-0000-0000-000000000001';
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  IF updated_count <> 1 THEN
    RAISE EXCEPTION 'user cannot update own preferences';
  END IF;

  UPDATE users
     SET preferences = '{"theme": "dark"}'::JSONB
   WHERE id = '00000000-0000-0000-0000-000000000002';
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  IF updated_count <> 0 THEN
    RAISE EXCEPTION 'user can update another user preferences';
  END IF;

  BEGIN
    UPDATE users
       SET phone_verified_at = '2099-01-01'
     WHERE id = '00000000-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'user can self-assert phone verification';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    UPDATE profiles
       SET verification_status = 'self-verified'
     WHERE user_id = '00000000-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'user can self-assert profile verification';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    UPDATE introducer_profiles
       SET completed_introduction_count = 999
     WHERE user_id = '00000000-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'user can self-assert introduction count';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    UPDATE campaigns
       SET status = 'published', published_at = now()
     WHERE id = '20000000-0000-0000-0000-000000000002';
    RAISE EXCEPTION 'owner can publish draft content without approved consent';
  EXCEPTION
    -- 0008 revokes the client UPDATE grant outright; the 0001 trigger
    -- remains as defense in depth if that grant ever returns.
    WHEN insufficient_privilege THEN NULL;
    WHEN raise_exception THEN
      IF SQLERRM <> 'published campaign requires published consented pitch content' THEN
        RAISE;
      END IF;
  END;

  BEGIN
    UPDATE interests
       SET sender_user_id = '00000000-0000-0000-0000-000000000004'
     WHERE id = '30000000-0000-0000-0000-000000000002';
    RAISE EXCEPTION 'campaign owner can rewrite interest attribution';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    INSERT INTO consent_requests (
      pitch_draft_id,
      subject_user_id,
      token_hash,
      status,
      responded_at
    )
    VALUES (
      '10000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000004',
      'forged-consent-token',
      'approved',
      now()
    );
    RAISE EXCEPTION 'pitch creator can forge approved consent';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;
ROLLBACK;

-- The campaign owner may accept a submitted interest with a plain table UPDATE:
-- the column grant and interests_update_owners still permit it, and the 0044
-- accept-invariant trigger passes because the campaign is published and the
-- sender is eligible. Blair (0002) owns the seed campaign.
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000002';
DO $$
DECLARE
  updated_count INTEGER;
BEGIN
  UPDATE interests
     SET status = 'accepted', decided_at = now()
   WHERE id = '30000000-0000-0000-0000-000000000002';
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  IF updated_count <> 1 THEN
    RAISE EXCEPTION 'campaign owner cannot accept a submitted interest';
  END IF;
END;
$$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000002';
DO $$
BEGIN
  BEGIN
    INSERT INTO interests (
      campaign_id,
      sender_user_id,
      status,
      decided_at
    )
    VALUES (
      '20000000-0000-0000-0000-000000000002',
      '00000000-0000-0000-0000-000000000002',
      'accepted',
      now()
    );
    RAISE EXCEPTION 'interest sender can forge an accepted interest';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000004';
DO $$
BEGIN
  BEGIN
    INSERT INTO intro_rooms (campaign_id, dater_user_id, interested_user_id)
    VALUES (
      '20000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000004',
      '00000000-0000-0000-0000-000000000002'
    );
    RAISE EXCEPTION 'nonowner can forge an intro room';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM <> 'intro room requires the campaign owner, an accepted interest, and unblocked parties' THEN
        RAISE;
      END IF;
  END;
END;
$$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000002';
DO $$
DECLARE
  visible_count INTEGER;
BEGIN
  INSERT INTO blocks (blocker_user_id, blocked_user_id)
  VALUES (
    '00000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000003'
  );

  SELECT count(*) INTO visible_count FROM messages;
  IF visible_count <> 0 THEN
    RAISE EXCEPTION 'blocked room messages remain visible';
  END IF;

  BEGIN
    INSERT INTO messages (intro_room_id, sender_user_id, body)
    VALUES (
      '40000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000002',
      'blocked message'
    );
    RAISE EXCEPTION 'blocked room still accepts messages';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM <> 'message sender must be an unblocked participant in an open intro room' THEN
        RAISE;
      END IF;
  END;
END;
$$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE anon;
DO $$
DECLARE
  visible_count INTEGER;
BEGIN
  SELECT count(*) INTO visible_count FROM users;
  IF visible_count <> 0 THEN
    RAISE EXCEPTION 'anonymous user can read users';
  END IF;
END;
$$;
ROLLBACK;

SELECT '02_rls.sql passed' AS result;
