-- Slice D acceptance: immutable consent revisions, exact-revision publication,
-- request-changes/decline responses, and preserved Slice C trust gates.

BEGIN;

INSERT INTO pitch_drafts (
  id,
  created_by_user_id,
  status,
  headline,
  body,
  structure
)
VALUES (
  'd1300000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000004',
  'draft',
  'Revision one headline',
  'Revision one body',
  '{"hard_claims_requiring_confirmation":["Owns a home"]}'::JSONB
);
INSERT INTO pitch_assets (
  id,
  pitch_draft_id,
  uploaded_by_user_id,
  asset_type,
  storage_path,
  sort_order
)
VALUES
  (
    'd1300000-0000-0000-0000-000000000011',
    'd1300000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000004',
    'photo',
    'd1300000-0000-0000-0000-000000000001/one.jpg',
    0
  ),
  (
    'd1300000-0000-0000-0000-000000000012',
    'd1300000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000004',
    'photo',
    'd1300000-0000-0000-0000-000000000001/two.jpg',
    1
  ),
  (
    'd1300000-0000-0000-0000-000000000013',
    'd1300000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000004',
    'voice',
    'd1300000-0000-0000-0000-000000000001/voice.m4a',
    0
  );

CREATE TEMP TABLE slice_d_state (
  key TEXT PRIMARY KEY,
  text_value TEXT,
  uuid_value UUID
) ON COMMIT DROP;
GRANT ALL ON slice_d_state TO authenticated;

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000004';
INSERT INTO slice_d_state (key, text_value, uuid_value)
SELECT 'initial-submit', consent_token, consent_request_id
  FROM submit_pitch_for_consent(
    'd1300000-0000-0000-0000-000000000001',
    'email',
    'introducer@example.test',
    'Alex'
  );

DO $$
DECLARE
  affected_count INTEGER;
  media_insert_rejected BOOLEAN := false;
BEGIN
  UPDATE pitch_drafts
     SET headline = 'Mutation after finalize'
   WHERE id = 'd1300000-0000-0000-0000-000000000001';
  GET DIAGNOSTICS affected_count = ROW_COUNT;
  IF affected_count <> 0 THEN
    RAISE EXCEPTION 'consent_pending draft mutation was accepted';
  END IF;

  BEGIN
    INSERT INTO storage.objects (bucket_id, name, owner_id)
    VALUES (
      'pitch-media',
      'd1300000-0000-0000-0000-000000000001/post-finalize.jpg',
      auth.uid()::TEXT
    );
  EXCEPTION
    WHEN insufficient_privilege THEN media_insert_rejected := true;
  END;
  IF NOT media_insert_rejected THEN
    RAISE EXCEPTION 'consent_pending media upload was accepted';
  END IF;
END;
$$;

RESET ROLE;
DO $$
DECLARE
  request consent_requests;
  revision consent_revisions;
  expected_hash TEXT;
BEGIN
  SELECT * INTO request
    FROM consent_requests
   WHERE id = (SELECT uuid_value FROM slice_d_state WHERE key = 'initial-submit');
  SELECT * INTO revision FROM consent_revisions WHERE id = request.revision_id;

  expected_hash := encode(
    digest(
      jsonb_build_object(
        'headline', revision.headline,
        'body', revision.body,
        'structure', revision.structure,
        'asset_ids', to_jsonb(revision.asset_ids),
        'voice_asset_path', revision.voice_asset_path
      )::TEXT,
      'sha256'
    ),
    'hex'
  );
  IF revision.revision_number <> 1
     OR revision.headline <> 'Revision one headline'
     OR revision.asset_ids <> ARRAY[
       'd1300000-0000-0000-0000-000000000011'::UUID,
       'd1300000-0000-0000-0000-000000000012'::UUID,
       'd1300000-0000-0000-0000-000000000013'::UUID
     ]
     OR revision.voice_asset_path <> 'd1300000-0000-0000-0000-000000000001/voice.m4a'
     OR revision.content_hash <> expected_hash THEN
    RAISE EXCEPTION 'initial consent revision snapshot is incomplete or non-canonical';
  END IF;
  IF request.invite_contact_channel <> 'email'
     OR request.invite_contact_hash <> encode(digest('introducer@example.test', 'sha256'), 'hex') THEN
    RAISE EXCEPTION 'Slice C invite binding was not preserved during finalize';
  END IF;

  BEGIN
    UPDATE consent_revisions SET headline = 'Mutable' WHERE id = revision.id;
    RAISE EXCEPTION 'consent revision UPDATE was accepted';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM = 'consent revision UPDATE was accepted' THEN RAISE; END IF;
      IF SQLERRM !~* 'immutable|revision' THEN RAISE; END IF;
  END;
  BEGIN
    DELETE FROM consent_revisions WHERE id = revision.id;
    RAISE EXCEPTION 'consent revision DELETE was accepted';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM = 'consent revision DELETE was accepted' THEN RAISE; END IF;
      IF SQLERRM !~* 'immutable|revision' THEN RAISE; END IF;
  END;

  INSERT INTO slice_d_state (key, text_value, uuid_value)
  VALUES ('revision-one', request.token_hash, revision.id);
END;
$$;

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000001';
DO $$
BEGIN
  PERFORM * FROM claim_consent_request(
    (SELECT text_value FROM slice_d_state WHERE key = 'initial-submit')
  );
  BEGIN
    PERFORM respond_consent_request(
      'd1300000-0000-0000-0000-000000000001',
      NULL,
      'Null action must not request changes.'
    );
    RAISE EXCEPTION 'null consent response action was accepted';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM = 'null consent response action was accepted' THEN RAISE; END IF;
      IF SQLERRM !~* 'action' THEN RAISE; END IF;
  END;
  PERFORM respond_consent_request(
    'd1300000-0000-0000-0000-000000000001',
    'request_changes',
    'Please remove the hard claim.'
  );
END;
$$;

SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000004';
UPDATE pitch_drafts
   SET headline = 'Revision two headline',
       body = 'Revision two body',
       structure = '{"hard_claims_requiring_confirmation":["Still needs confirmation"]}'::JSONB
 WHERE id = 'd1300000-0000-0000-0000-000000000001';
INSERT INTO pitch_assets (
  id,
  pitch_draft_id,
  uploaded_by_user_id,
  asset_type,
  storage_path,
  sort_order
)
VALUES (
  'd1300000-0000-0000-0000-000000000014',
  'd1300000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000004',
  'photo',
  'd1300000-0000-0000-0000-000000000001/three.jpg',
  2
);
INSERT INTO slice_d_state (key, text_value, uuid_value)
SELECT 'refinalize', consent_token, consent_request_id
  FROM submit_pitch_for_consent('d1300000-0000-0000-0000-000000000001');

RESET ROLE;
DO $$
DECLARE
  request consent_requests;
  revision_two_id UUID;
BEGIN
  SELECT * INTO request
    FROM consent_requests
   WHERE pitch_draft_id = 'd1300000-0000-0000-0000-000000000001';
  SELECT id INTO revision_two_id
    FROM consent_revisions
   WHERE pitch_draft_id = request.pitch_draft_id
     AND revision_number = 2;
  IF revision_two_id IS NULL
     OR request.revision_id <> revision_two_id
     OR request.status <> 'claimed'
     OR request.response_note IS NOT NULL
     OR request.token_hash <> (SELECT text_value FROM slice_d_state WHERE key = 'revision-one')
     OR (SELECT text_value FROM slice_d_state WHERE key = 'refinalize') IS NOT NULL
     OR request.id <> (SELECT uuid_value FROM slice_d_state WHERE key = 'refinalize') THEN
    RAISE EXCEPTION 're-finalize did not preserve request/token or advance revision';
  END IF;
  INSERT INTO slice_d_state (key, uuid_value) VALUES ('revision-two', revision_two_id);
END;
$$;

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000001';
DO $$
BEGIN
  BEGIN
    PERFORM * FROM approve_and_publish_pitch(
      'd1300000-0000-0000-0000-000000000001',
      NULL,
      (SELECT uuid_value FROM slice_d_state WHERE key = 'revision-two'),
      ARRAY['d1300000-0000-0000-0000-000000000012']::UUID[],
      true
    );
    RAISE EXCEPTION 'null campaign window was accepted';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM = 'null campaign window was accepted' THEN RAISE; END IF;
      IF SQLERRM !~* 'campaign_days' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM * FROM approve_and_publish_pitch(
      'd1300000-0000-0000-0000-000000000001',
      14,
      (SELECT uuid_value FROM slice_d_state WHERE key = 'revision-one'),
      ARRAY['d1300000-0000-0000-0000-000000000012']::UUID[],
      true
    );
    RAISE EXCEPTION 'stale revision was approved';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM = 'stale revision was approved' THEN RAISE; END IF;
      IF SQLERRM !~* 'latest|revision' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM * FROM approve_and_publish_pitch(
      'd1300000-0000-0000-0000-000000000001',
      14,
      (SELECT uuid_value FROM slice_d_state WHERE key = 'revision-two'),
      ARRAY['d1300000-0000-0000-0000-000000000099']::UUID[],
      true
    );
    RAISE EXCEPTION 'unreviewed asset was approved';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM = 'unreviewed asset was approved' THEN RAISE; END IF;
      IF SQLERRM !~* 'asset|revision' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM * FROM approve_and_publish_pitch(
      'd1300000-0000-0000-0000-000000000001',
      14,
      (SELECT uuid_value FROM slice_d_state WHERE key = 'revision-two'),
      ARRAY['d1300000-0000-0000-0000-000000000012']::UUID[],
      false
    );
    RAISE EXCEPTION 'hard claims were approved without confirmation';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM = 'hard claims were approved without confirmation' THEN RAISE; END IF;
      IF SQLERRM !~* 'claim|confirm' THEN RAISE; END IF;
  END;

  PERFORM * FROM approve_and_publish_pitch(
    'd1300000-0000-0000-0000-000000000001',
    14,
    (SELECT uuid_value FROM slice_d_state WHERE key = 'revision-two'),
    ARRAY['d1300000-0000-0000-0000-000000000012']::UUID[],
    true
  );
END;
$$;

RESET ROLE;
DO $$
DECLARE
  revision consent_revisions;
  published pitch_drafts;
  published_asset_ids UUID[];
BEGIN
  SELECT * INTO revision FROM consent_revisions
   WHERE id = (SELECT uuid_value FROM slice_d_state WHERE key = 'revision-two');
  SELECT * INTO published FROM pitch_drafts
   WHERE id = 'd1300000-0000-0000-0000-000000000001';
  SELECT coalesce(array_agg(id ORDER BY id), ARRAY[]::UUID[]) INTO published_asset_ids
    FROM pitch_assets
   WHERE pitch_draft_id = published.id;
  IF published.status <> 'published'
     OR published.headline IS DISTINCT FROM revision.headline
     OR published.body IS DISTINCT FROM revision.body
     OR published.structure IS DISTINCT FROM revision.structure
     OR published_asset_ids <> ARRAY[
       'd1300000-0000-0000-0000-000000000012'::UUID,
       'd1300000-0000-0000-0000-000000000013'::UUID
     ] THEN
    RAISE EXCEPTION 'published projection differs from approved revision and assets';
  END IF;
END;
$$;

INSERT INTO pitch_drafts (id, created_by_user_id, status, headline, body)
VALUES (
  'd1300000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000004',
  'draft',
  'Decline headline',
  'Decline body'
);
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000004';
INSERT INTO slice_d_state (key, text_value)
SELECT 'decline-token', consent_token
  FROM submit_pitch_for_consent('d1300000-0000-0000-0000-000000000002');
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000001';
DO $$
BEGIN
  PERFORM * FROM claim_consent_request(
    (SELECT text_value FROM slice_d_state WHERE key = 'decline-token')
  );
  PERFORM respond_consent_request(
    'd1300000-0000-0000-0000-000000000002',
    'decline',
    'I do not consent to publication.'
  );
END;
$$;
RESET ROLE;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pitch_drafts d
      JOIN consent_requests r ON r.pitch_draft_id = d.id
     WHERE d.id = 'd1300000-0000-0000-0000-000000000002'
       AND d.status = 'archived'
       AND r.status = 'declined'
       AND r.response_note = 'I do not consent to publication.'
  ) THEN
    RAISE EXCEPTION 'decline did not archive the draft and record the response';
  END IF;
END;
$$;

INSERT INTO pitch_drafts (id, created_by_user_id, subject_user_id, status, headline, body)
VALUES
  (
    'd1300000-0000-0000-0000-000000000003',
    '00000000-0000-0000-0000-000000000004',
    '00000000-0000-0000-0000-000000000002',
    'consent_pending',
    'Identity-gated headline',
    'Identity-gated body'
  ),
  (
    'd1300000-0000-0000-0000-000000000004',
    '00000000-0000-0000-0000-000000000004',
    '00000000-0000-0000-0000-000000000003',
    'consent_pending',
    'Suspended approval headline',
    'Suspended approval body'
  ),
  (
    'd1300000-0000-0000-0000-000000000005',
    '00000000-0000-0000-0000-000000000003',
    NULL,
    'draft',
    'Suspended finalize headline',
    'Suspended finalize body'
  );
-- The identity-gated draft carries a reviewed photo so the 0017 photo
-- floor is satisfied and the identity error stays observable.
INSERT INTO pitch_assets (id, pitch_draft_id, uploaded_by_user_id, asset_type, storage_path)
VALUES (
  'd1300000-0000-0000-0000-000000000031',
  'd1300000-0000-0000-0000-000000000003',
  '00000000-0000-0000-0000-000000000004',
  'photo',
  'd1300000-0000-0000-0000-000000000003/identity-photo.jpg'
);
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
VALUES
  (
    'd1300000-0000-0000-0000-000000000021',
    'd1300000-0000-0000-0000-000000000003',
    1,
    'Identity-gated headline',
    'Identity-gated body',
    '{}'::JSONB,
    ARRAY['d1300000-0000-0000-0000-000000000031']::UUID[],
    encode(digest('identity-gated', 'sha256'), 'hex')
  ),
  (
    'd1300000-0000-0000-0000-000000000022',
    'd1300000-0000-0000-0000-000000000004',
    1,
    'Suspended approval headline',
    'Suspended approval body',
    '{}'::JSONB,
    ARRAY[]::UUID[],
    encode(digest('suspended-approval', 'sha256'), 'hex')
  );
INSERT INTO consent_requests (
  pitch_draft_id,
  subject_user_id,
  token_hash,
  status,
  revision_id
)
VALUES
  (
    'd1300000-0000-0000-0000-000000000003',
    '00000000-0000-0000-0000-000000000002',
    encode(digest('identity-gated-token', 'sha256'), 'hex'),
    'claimed',
    'd1300000-0000-0000-0000-000000000021'
  ),
  (
    'd1300000-0000-0000-0000-000000000004',
    '00000000-0000-0000-0000-000000000003',
    encode(digest('suspended-approval-token', 'sha256'), 'hex'),
    'claimed',
    'd1300000-0000-0000-0000-000000000022'
  );
UPDATE app_config SET value = 'on' WHERE key = 'identity_enforcement';
UPDATE users SET account_status = 'suspended'
 WHERE id = '00000000-0000-0000-0000-000000000003';

SET LOCAL ROLE authenticated;
DO $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
  BEGIN
    PERFORM * FROM approve_and_publish_pitch(
      'd1300000-0000-0000-0000-000000000003',
      14,
      'd1300000-0000-0000-0000-000000000021',
      ARRAY['d1300000-0000-0000-0000-000000000031']::UUID[],
      true
    );
    RAISE EXCEPTION 'identity enforcement gate was lost';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM = 'identity enforcement gate was lost' THEN RAISE; END IF;
      IF SQLERRM <> 'identity verification required' THEN RAISE; END IF;
  END;

  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true);
  BEGIN
    PERFORM * FROM approve_and_publish_pitch(
      'd1300000-0000-0000-0000-000000000004',
      14,
      'd1300000-0000-0000-0000-000000000022',
      ARRAY[]::UUID[],
      true
    );
    RAISE EXCEPTION 'suspended account approved a revision';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM = 'suspended account approved a revision' THEN RAISE; END IF;
      IF SQLERRM <> 'account must be active' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM * FROM submit_pitch_for_consent('d1300000-0000-0000-0000-000000000005');
    RAISE EXCEPTION 'suspended account finalized a draft';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM = 'suspended account finalized a draft' THEN RAISE; END IF;
      IF SQLERRM <> 'account must be active' THEN RAISE; END IF;
  END;
END;
$$;

ROLLBACK;

SELECT '13_consent_revisions.sql passed' AS result;
