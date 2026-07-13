-- Slice C acceptance: contact-bound claims, staged evidence enforcement,
-- and active-account guards across every mutating trust surface.

BEGIN;

DO $$
BEGIN
  IF private.canonicalize_contact('email', '  Mixed.Case@Example.TEST ') <> 'mixed.case@example.test' THEN
    RAISE EXCEPTION 'email contact canonicalization is incorrect';
  END IF;
  IF private.canonicalize_contact('phone', '+82 (010) 1234-5678') <> '8201012345678' THEN
    RAISE EXCEPTION 'phone contact canonicalization is incorrect';
  END IF;
END;
$$;

INSERT INTO pitch_drafts (id, created_by_user_id, status, headline, body)
VALUES
  ('c1200000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000004', 'draft', 'Email-bound pitch', 'Only the invited email may claim.'),
  ('c1200000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000004', 'draft', 'Phone-bound pitch', 'Phone claims fail closed for now.'),
  ('c1200000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000004', 'draft', 'Legacy pitch', 'Legacy invitations remain claimable.'),
  ('c1200000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000004', 'draft', 'Verification pitch', 'Publishing is provider-gated when enforcement is on.'),
  ('c1200000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000004', 'draft', 'Suspended claim pitch', 'Suspended accounts cannot claim.');

-- Publishing requires at least one reviewed photo (0017); give every
-- finalizable fixture draft a photo so revisions snapshot it.
INSERT INTO pitch_assets (id, pitch_draft_id, uploaded_by_user_id, asset_type, storage_path)
SELECT
  ('c1200000-0000-0000-0000-00000000030' || draft_ordinal)::UUID,
  ('c1200000-0000-0000-0000-00000000000' || draft_ordinal)::UUID,
  '00000000-0000-0000-0000-000000000004',
  'photo',
  'c1200000-0000-0000-0000-00000000000' || draft_ordinal || '/fixture-photo.jpg'
FROM generate_series(1, 5) AS draft_ordinal;

CREATE TEMP TABLE slice_c_tokens (kind TEXT PRIMARY KEY, raw_token TEXT NOT NULL) ON COMMIT DROP;
GRANT ALL ON slice_c_tokens TO authenticated;

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000004';
INSERT INTO slice_c_tokens
SELECT 'email', consent_token FROM submit_pitch_for_consent(
  'c1200000-0000-0000-0000-000000000001',
  'email',
  '  INTERESTED@EXAMPLE.TEST ',
  'Casey'
);
INSERT INTO slice_c_tokens
SELECT 'phone', consent_token FROM submit_pitch_for_consent(
  'c1200000-0000-0000-0000-000000000002',
  'phone',
  '+82 (010) 1234-5678',
  'Phone Invite'
);
-- Second-audit contract (0029): a first submission without a contact is
-- rejected outright, so the "legacy" state can only exist for rows that
-- predate the trigger — recreated below with the trigger disabled.
DO $$
DECLARE
  rejected BOOLEAN := false;
BEGIN
  BEGIN
    PERFORM * FROM submit_pitch_for_consent('c1200000-0000-0000-0000-000000000003');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%verified invite contact%' THEN RAISE; END IF;
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'contactless first submission was accepted';
  END IF;
END;
$$;
RESET ROLE;
ALTER TABLE consent_requests DISABLE TRIGGER consent_requests_contact_binding;
INSERT INTO consent_requests (pitch_draft_id, token_hash, status)
VALUES (
  'c1200000-0000-0000-0000-000000000003',
  encode(digest('slice-c-legacy-token', 'sha256'), 'hex'),
  'pending'
);
ALTER TABLE consent_requests ENABLE TRIGGER consent_requests_contact_binding;
UPDATE pitch_drafts SET status = 'consent_pending'
 WHERE id = 'c1200000-0000-0000-0000-000000000003';
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000004';
INSERT INTO slice_c_tokens VALUES ('legacy', 'slice-c-legacy-token');
INSERT INTO slice_c_tokens
SELECT 'verification', consent_token FROM submit_pitch_for_consent(
  'c1200000-0000-0000-0000-000000000004',
  'email',
  'introducer@example.test',
  'Alex'
);
INSERT INTO slice_c_tokens
SELECT 'suspended', consent_token FROM submit_pitch_for_consent(
  'c1200000-0000-0000-0000-000000000005',
  'email',
  'suspended-claim@example.test',
  'Suspended Claim'
);

RESET ROLE;
DO $$
DECLARE
  request consent_requests;
BEGIN
  SELECT * INTO request FROM consent_requests
   WHERE pitch_draft_id = 'c1200000-0000-0000-0000-000000000001';
  IF request.invite_contact_channel <> 'email'
     OR request.invite_friend_name <> 'Casey'
     OR request.invite_contact_hash <> encode(digest('interested@example.test', 'sha256'), 'hex') THEN
    RAISE EXCEPTION 'email invite binding was not stored canonically';
  END IF;
  IF request.invite_contact_hash IN ('  INTERESTED@EXAMPLE.TEST ', 'interested@example.test') THEN
    RAISE EXCEPTION 'raw invite contact was stored';
  END IF;
END;
$$;

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000001';
DO $$
BEGIN
  BEGIN
    UPDATE app_config SET value = 'on' WHERE key = 'identity_enforcement';
    RAISE EXCEPTION 'authenticated user changed identity enforcement';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
    WHEN raise_exception THEN
      IF SQLERRM = 'authenticated user changed identity enforcement' THEN RAISE; END IF;
  END;
  BEGIN
    INSERT INTO verification_checks (user_id, provider, provider_reference, status, verified_at)
    VALUES (auth.uid(), 'forged', 'forged-provider-reference', 'passed', now());
    RAISE EXCEPTION 'authenticated user forged verification evidence';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
    WHEN raise_exception THEN
      IF SQLERRM = 'authenticated user forged verification evidence' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM * FROM claim_consent_request((SELECT raw_token FROM slice_c_tokens WHERE kind = 'email'));
    RAISE EXCEPTION 'mismatched email claimed consent';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM = 'mismatched email claimed consent' THEN RAISE; END IF;
      IF SQLERRM <> 'consent invite was sent to a different contact' THEN RAISE; END IF;
  END;
END;
$$;

SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000003';
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM claim_consent_request((SELECT raw_token FROM slice_c_tokens WHERE kind = 'email'))
     WHERE pitch_draft_id = 'c1200000-0000-0000-0000-000000000001'
  ) THEN
    RAISE EXCEPTION 'matching email could not claim consent';
  END IF;
END;
$$;

SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000001';
DO $$
DECLARE
  legacy_revision_id UUID;
  legacy_asset_ids UUID[];
BEGIN
  BEGIN
    PERFORM * FROM claim_consent_request((SELECT raw_token FROM slice_c_tokens WHERE kind = 'phone'));
    RAISE EXCEPTION 'phone invite was claimable without provider verification';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM = 'phone invite was claimable without provider verification' THEN RAISE; END IF;
      IF SQLERRM <> 'phone invite verification is not available' THEN RAISE; END IF;
  END;

  -- Second-audit contract (0029): token possession alone never claims a
  -- contact-less legacy request; it must be reissued.
  BEGIN
    PERFORM * FROM claim_consent_request(
      (SELECT raw_token FROM slice_c_tokens WHERE kind = 'legacy')
    );
    RAISE EXCEPTION 'legacy contactless request was claimable';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM = 'legacy contactless request was claimable' THEN RAISE; END IF;
      IF SQLERRM NOT LIKE '%reissued with a verified contact%' THEN RAISE; END IF;
  END;

  IF NOT EXISTS (
    SELECT 1 FROM claim_consent_request((SELECT raw_token FROM slice_c_tokens WHERE kind = 'verification'))
     WHERE pitch_draft_id = 'c1200000-0000-0000-0000-000000000004'
  ) THEN
    RAISE EXCEPTION 'verification fixture could not be claimed';
  END IF;
END;
$$;

RESET ROLE;
INSERT INTO auth.users (id, email)
VALUES ('c1200000-0000-0000-0000-000000000100', 'enforcement-off-photo@example.test');
INSERT INTO users (id)
VALUES ('c1200000-0000-0000-0000-000000000100');
INSERT INTO profiles (user_id, display_name, birth_date)
VALUES (
  'c1200000-0000-0000-0000-000000000100',
  'Enforcement Off Photo',
  CURRENT_DATE - INTERVAL '25 years'
);
INSERT INTO dating_profiles (user_id, bio, photos, dating_intent)
VALUES (
  'c1200000-0000-0000-0000-000000000100',
  'Missing storage objects while identity enforcement is off.',
  ARRAY[
    'c1200000-0000-0000-0000-000000000100/one.jpg',
    'c1200000-0000-0000-0000-000000000100/two.jpg'
  ],
  'long-term'
);

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = 'c1200000-0000-0000-0000-000000000100';
DO $$
BEGIN
  BEGIN
    PERFORM * FROM submit_interest('20000000-0000-0000-0000-000000000001');
    RAISE EXCEPTION 'missing photo objects were accepted while identity enforcement was off';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM = 'missing photo objects were accepted while identity enforcement was off' THEN RAISE; END IF;
      IF SQLERRM !~* 'profile photos|storage|MIME' THEN RAISE; END IF;
  END;
END;
$$;

RESET ROLE;
UPDATE app_config SET value = 'on' WHERE key = 'identity_enforcement';

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000001';
DO $$
DECLARE
  verification_revision_id UUID;
  verification_asset_ids UUID[];
BEGIN
  SELECT r.id, r.asset_ids INTO verification_revision_id, verification_asset_ids
    FROM consent_requests cr
    JOIN consent_revisions r ON r.id = cr.revision_id
   WHERE cr.pitch_draft_id = 'c1200000-0000-0000-0000-000000000004';
  BEGIN
    PERFORM * FROM approve_and_publish_pitch(
      'c1200000-0000-0000-0000-000000000004',
      14,
      verification_revision_id,
      verification_asset_ids,
      true
    );
    RAISE EXCEPTION 'publish succeeded without provider verification';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM = 'publish succeeded without provider verification' THEN RAISE; END IF;
      IF SQLERRM NOT LIKE '%identity evidence required%' THEN RAISE; END IF;
  END;
END;
$$;

RESET ROLE;
INSERT INTO verification_checks (
  user_id, provider, provider_reference, status, verified_at,
  check_type, provider_ref, photo_object_name, result, checked_at, expires_at
) VALUES
  ('00000000-0000-0000-0000-000000000001', 'audit', 'slice-c-publish-adult', 'passed', now(),
   'adult_18plus', 'slice-c-publish-adult', NULL, 'passed', now(), now() + INTERVAL '30 days'),
  ('00000000-0000-0000-0000-000000000001', 'audit', 'slice-c-publish-liveness', 'passed', now(),
   'liveness', 'slice-c-publish-liveness', NULL, 'passed', now(), now() + INTERVAL '30 days'),
  ('00000000-0000-0000-0000-000000000001', 'audit', 'slice-c-publish-face', 'passed', now(),
   'face_match', 'slice-c-publish-face',
   'c1200000-0000-0000-0000-000000000004/fixture-photo.jpg',
   'passed', now(), now() + INTERVAL '30 days');

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000001';
DO $$
DECLARE
  verification_revision_id UUID;
  verification_asset_ids UUID[];
BEGIN
  SELECT r.id, r.asset_ids INTO verification_revision_id, verification_asset_ids
    FROM consent_requests cr
    JOIN consent_revisions r ON r.id = cr.revision_id
   WHERE cr.pitch_draft_id = 'c1200000-0000-0000-0000-000000000004';
  PERFORM * FROM approve_and_publish_pitch(
    'c1200000-0000-0000-0000-000000000004',
    14,
    verification_revision_id,
    verification_asset_ids,
    true
  );
END;
$$;

RESET ROLE;
INSERT INTO auth.users (id, email)
VALUES
  ('c1200000-0000-0000-0000-000000000101', 'missing-photo@example.test'),
  ('c1200000-0000-0000-0000-000000000102', 'foreign-photo@example.test'),
  ('c1200000-0000-0000-0000-000000000103', 'bad-mime@example.test'),
  ('c1200000-0000-0000-0000-000000000104', 'valid-evidence@example.test'),
  ('c1200000-0000-0000-0000-000000000105', 'suspended-claim@example.test');
INSERT INTO users (id, phone_verified_at)
SELECT id, now() FROM auth.users
 WHERE id::TEXT LIKE 'c1200000-0000-0000-0000-0000000001%'
ON CONFLICT (id) DO UPDATE SET phone_verified_at = EXCLUDED.phone_verified_at;
INSERT INTO profiles (user_id, display_name, birth_date)
SELECT id, 'Slice C ' || right(id::TEXT, 3), CURRENT_DATE - INTERVAL '25 years'
  FROM auth.users
 WHERE id::TEXT LIKE 'c1200000-0000-0000-0000-0000000001%'
ON CONFLICT (user_id) DO NOTHING;
INSERT INTO dating_profiles (user_id, bio, photos, dating_intent)
VALUES
  ('c1200000-0000-0000-0000-000000000101', 'Missing objects.', ARRAY['c1200000-0000-0000-0000-000000000101/one.jpg', 'c1200000-0000-0000-0000-000000000101/two.jpg'], 'long-term'),
  ('c1200000-0000-0000-0000-000000000102', 'Foreign objects.', ARRAY['c1200000-0000-0000-0000-000000000104/one.jpg', 'c1200000-0000-0000-0000-000000000104/two.png'], 'long-term'),
  ('c1200000-0000-0000-0000-000000000103', 'Bad MIME objects.', ARRAY['c1200000-0000-0000-0000-000000000103/one.bin', 'c1200000-0000-0000-0000-000000000103/two.bin'], 'long-term'),
  ('c1200000-0000-0000-0000-000000000104', 'Valid evidence.', ARRAY['profile-media/c1200000-0000-0000-0000-000000000104/one.jpg', 'profile-media/c1200000-0000-0000-0000-000000000104/two.png'], 'long-term');
INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
VALUES
  ('profile-media', 'c1200000-0000-0000-0000-000000000104/one.jpg', 'c1200000-0000-0000-0000-000000000104', '{"mimetype":"image/jpeg"}'),
  ('profile-media', 'c1200000-0000-0000-0000-000000000104/two.png', 'c1200000-0000-0000-0000-000000000104', '{"mimetype":"image/png"}'),
  ('profile-media', 'c1200000-0000-0000-0000-000000000103/one.bin', 'c1200000-0000-0000-0000-000000000103', '{"mimetype":"application/octet-stream"}'),
  ('profile-media', 'c1200000-0000-0000-0000-000000000103/two.bin', 'c1200000-0000-0000-0000-000000000103', '{"mimetype":"application/octet-stream"}');
INSERT INTO verification_checks (
  user_id, provider, provider_reference, status, verified_at,
  check_type, provider_ref, result, checked_at, expires_at
)
SELECT u.id, 'audit', 'slice-c-' || right(u.id::TEXT, 3) || '-' || kind.check_type, 'passed', now(),
       kind.check_type, 'slice-c-' || right(u.id::TEXT, 3) || '-' || kind.check_type,
       'passed', now(), now() + INTERVAL '30 days'
  FROM (VALUES
    ('c1200000-0000-0000-0000-000000000101'::UUID),
    ('c1200000-0000-0000-0000-000000000102'::UUID),
    ('c1200000-0000-0000-0000-000000000103'::UUID),
    ('c1200000-0000-0000-0000-000000000104'::UUID)
  ) AS u(id)
 CROSS JOIN (VALUES ('adult_18plus'), ('liveness')) AS kind(check_type);

SET LOCAL ROLE authenticated;
DO $$
DECLARE
  test_user UUID;
  valid_interest_id UUID;
BEGIN
  FOREACH test_user IN ARRAY ARRAY[
    'c1200000-0000-0000-0000-000000000101'::UUID,
    'c1200000-0000-0000-0000-000000000102'::UUID,
    'c1200000-0000-0000-0000-000000000103'::UUID
  ] LOOP
    PERFORM set_config('request.jwt.claim.sub', test_user::TEXT, true);
    BEGIN
      PERFORM * FROM submit_interest('20000000-0000-0000-0000-000000000001');
      RAISE EXCEPTION 'invalid photo evidence was accepted';
    EXCEPTION
      WHEN raise_exception THEN
        IF SQLERRM = 'invalid photo evidence was accepted' THEN RAISE; END IF;
        IF SQLERRM !~* 'profile photos|storage|MIME' THEN RAISE; END IF;
    END;
  END LOOP;

  PERFORM set_config('request.jwt.claim.sub', 'c1200000-0000-0000-0000-000000000104', true);
  SELECT interest_id INTO valid_interest_id
    FROM submit_interest('20000000-0000-0000-0000-000000000001');
  IF valid_interest_id IS NULL THEN
    RAISE EXCEPTION 'valid evidence did not submit interest';
  END IF;
END;
$$;

RESET ROLE;
INSERT INTO pitch_drafts (id, created_by_user_id, status, headline, body)
VALUES
  ('c1200000-0000-0000-0000-000000000201', 'c1200000-0000-0000-0000-000000000103', 'draft', 'Suspended submit', 'Suspended accounts cannot submit.'),
  ('c1200000-0000-0000-0000-000000000202', '00000000-0000-0000-0000-000000000004', 'consent_pending', 'Suspended approve', 'Suspended accounts cannot approve.');
UPDATE pitch_drafts
   SET subject_user_id = 'c1200000-0000-0000-0000-000000000103'
 WHERE id = 'c1200000-0000-0000-0000-000000000202';
INSERT INTO consent_revisions (
  id,
  pitch_draft_id,
  revision_number,
  headline,
  body,
  structure,
  asset_ids,
  content_hash
)
VALUES (
  'c1200000-0000-0000-0000-000000000204',
  'c1200000-0000-0000-0000-000000000202',
  1,
  'Suspended approve',
  'Suspended accounts cannot approve.',
  '{}'::JSONB,
  ARRAY[]::UUID[],
  encode(digest('slice-c-suspended-approve-revision', 'sha256'), 'hex')
);
INSERT INTO consent_requests (
  pitch_draft_id,
  subject_user_id,
  token_hash,
  status,
  revision_id,
  invite_contact_channel,
  invite_contact_hash
)
VALUES (
  'c1200000-0000-0000-0000-000000000202',
  'c1200000-0000-0000-0000-000000000103',
  encode(digest('slice-c-suspended-approve', 'sha256'), 'hex'),
  'claimed',
  'c1200000-0000-0000-0000-000000000204',
  'email',
  encode(digest('email:bad-mime@example.test', 'sha256'), 'hex')
);
INSERT INTO interests (id, campaign_id, sender_user_id, status, submitted_at)
VALUES (
  'c1200000-0000-0000-0000-000000000203',
  '20000000-0000-0000-0000-000000000001',
  'c1200000-0000-0000-0000-000000000101',
  'submitted',
  now()
);
UPDATE users SET account_status = 'suspended'
 WHERE id IN (
   'c1200000-0000-0000-0000-000000000103',
   'c1200000-0000-0000-0000-000000000105',
   '00000000-0000-0000-0000-000000000002'
 );

SET LOCAL ROLE authenticated;
DO $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', 'c1200000-0000-0000-0000-000000000105', true);
  BEGIN
    PERFORM * FROM claim_consent_request((SELECT raw_token FROM slice_c_tokens WHERE kind = 'suspended'));
    RAISE EXCEPTION 'suspended account claimed consent';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM = 'suspended account claimed consent' THEN RAISE; END IF;
      IF SQLERRM <> 'account must be active' THEN RAISE; END IF;
  END;

  PERFORM set_config('request.jwt.claim.sub', 'c1200000-0000-0000-0000-000000000103', true);
  BEGIN
    PERFORM * FROM submit_pitch_for_consent('c1200000-0000-0000-0000-000000000201');
    RAISE EXCEPTION 'suspended account submitted draft';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM = 'suspended account submitted draft' THEN RAISE; END IF;
      IF SQLERRM <> 'account must be active' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM * FROM approve_and_publish_pitch(
      'c1200000-0000-0000-0000-000000000202',
      14,
      'c1200000-0000-0000-0000-000000000204',
      ARRAY[]::UUID[],
      true
    );
    RAISE EXCEPTION 'suspended account approved pitch';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM = 'suspended account approved pitch' THEN RAISE; END IF;
      IF SQLERRM <> 'account must be active' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM * FROM submit_interest('20000000-0000-0000-0000-000000000001');
    RAISE EXCEPTION 'suspended account submitted interest';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM = 'suspended account submitted interest' THEN RAISE; END IF;
      IF SQLERRM <> 'account must be active' THEN RAISE; END IF;
  END;

  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
  BEGIN
    INSERT INTO messages (intro_room_id, sender_user_id, body)
    VALUES ('40000000-0000-0000-0000-000000000001', auth.uid(), 'Suspended message');
    RAISE EXCEPTION 'suspended account sent message';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM = 'suspended account sent message' THEN RAISE; END IF;
      IF SQLERRM <> 'account must be active' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM * FROM decide_interest('c1200000-0000-0000-0000-000000000203', 'declined');
    RAISE EXCEPTION 'suspended account decided interest';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM = 'suspended account decided interest' THEN RAISE; END IF;
      IF SQLERRM <> 'account must be active' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM * FROM set_campaign_status('20000000-0000-0000-0000-000000000001', 'paused');
    RAISE EXCEPTION 'suspended account changed campaign status';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM = 'suspended account changed campaign status' THEN RAISE; END IF;
      IF SQLERRM <> 'account must be active' THEN RAISE; END IF;
  END;
END;
$$;

RESET ROLE;
SET LOCAL ROLE anon;
DO $$
BEGIN
  BEGIN
    PERFORM track_event('dater_verified', '{}');
    RAISE EXCEPTION 'client logged dater_verified';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM = 'client logged dater_verified' THEN RAISE; END IF;
      -- 0033: verification outcomes are server-recorded, not client events.
      IF SQLERRM NOT LIKE 'unknown analytics event:%'
         AND SQLERRM NOT LIKE '%recorded by the server%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM track_event('interest_verified', '{}');
    RAISE EXCEPTION 'client logged interest_verified';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM = 'client logged interest_verified' THEN RAISE; END IF;
      IF SQLERRM NOT LIKE 'unknown analytics event:%'
         AND SQLERRM NOT LIKE '%recorded by the server%' THEN RAISE; END IF;
  END;
END;
$$;

ROLLBACK;

SELECT '12_claim_binding.sql passed' AS result;
