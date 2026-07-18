-- AUDIT REGRESSION: P0-2, 감사 문서 §5 "Fake 소개 방어와 verified 의미".
-- 초기 실패 이유는 contact binding과 verification gate 부재였고, Slice C 0012로 PASS한다.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'consent_requests'
       AND column_name = 'invite_contact_hash'
  ) THEN
    RAISE EXCEPTION 'AUDIT-P02: consent_requests.invite_contact_hash is missing';
  END IF;
  IF to_regclass('public.app_config') IS NULL THEN
    RAISE EXCEPTION 'AUDIT-P02: identity enforcement config is missing';
  END IF;
END;
$$;

UPDATE app_config SET value = 'on' WHERE key = 'identity_enforcement';

INSERT INTO pitch_drafts (
  id,
  created_by_user_id,
  status,
  headline,
  body
)
VALUES
  (
    'a0200000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000004',
    'consent_pending',
    'Contact-bound audit pitch',
    'Only the invited contact may claim this pitch.'
  ),
  (
    'a0200000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000004',
    'consent_pending',
    'Verification-gated audit pitch',
    'Publishing requires provider-owned verification evidence.'
  );

INSERT INTO consent_requests (
  id,
  pitch_draft_id,
  subject_user_id,
  token_hash,
  status,
  invite_contact_channel,
  invite_contact_hash
)
VALUES
  (
    'a0200000-0000-0000-0000-000000000011',
    'a0200000-0000-0000-0000-000000000001',
    NULL,
    encode(digest('audit-forwarded-token', 'sha256'), 'hex'),
    'pending',
    'email',
    encode(digest('invited-person@example.test', 'sha256'), 'hex')
  ),
  (
    'a0200000-0000-0000-0000-000000000012',
    'a0200000-0000-0000-0000-000000000002',
    NULL,
    encode(digest('audit-unverified-token', 'sha256'), 'hex'),
    'pending',
    'email',
    encode(digest('dater@example.test', 'sha256'), 'hex')
  );

INSERT INTO pitch_assets (id, pitch_draft_id, uploaded_by_user_id, asset_type, storage_path)
VALUES (
  'a0200000-0000-0000-0000-000000000004',
  'a0200000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000004',
  'photo',
  'a0200000-0000-0000-0000-000000000002/approved-photo.jpg'
);
INSERT INTO campaigns (id, pitch_draft_id, owner_user_id, status)
VALUES (
  'a0200000-0000-0000-0000-000000000003',
  'a0200000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000002',
  'draft'
);
INSERT INTO campaign_memberships (campaign_id, user_id, role)
VALUES
  (
    'a0200000-0000-0000-0000-000000000003',
    '00000000-0000-0000-0000-000000000002',
    'DATER_OWNER'
  ),
  (
    'a0200000-0000-0000-0000-000000000003',
    '00000000-0000-0000-0000-000000000004',
    'INTRODUCER'
  );
INSERT INTO campaign_entitlements (campaign_id, product_id, active, expires_at)
VALUES (
  'a0200000-0000-0000-0000-000000000003',
  'campaign_pass_30d_1999',
  true,
  now() + INTERVAL '30 days'
);

DO $$
BEGIN
  IF to_regclass('public.consent_revisions') IS NOT NULL THEN
    EXECUTE $sql$
      INSERT INTO consent_revisions (
        id,
        pitch_draft_id,
        revision_number,
        headline,
        body,
        structure,
        asset_ids,
        voice_asset_path,
        content_hash
      )
      VALUES (
        'a0200000-0000-0000-0000-000000000005',
        'a0200000-0000-0000-0000-000000000002',
        1,
        'Verification-gated audit pitch',
        'Publishing requires provider-owned verification evidence.',
        '{}'::JSONB,
        ARRAY['a0200000-0000-0000-0000-000000000004']::UUID[],
        NULL,
        encode(digest('audit-p02-revision', 'sha256'), 'hex')
      );
      UPDATE consent_requests
         SET revision_id = 'a0200000-0000-0000-0000-000000000005'
       WHERE id = 'a0200000-0000-0000-0000-000000000012'
    $sql$;
  END IF;
END;
$$;

DELETE FROM verification_checks
 WHERE user_id = '00000000-0000-0000-0000-000000000002';

SET LOCAL ROLE authenticated;
DO $$
DECLARE
  forwarded_claim_rejected BOOLEAN := false;
  unverified_publish_rejected BOOLEAN := false;
  approved_revision_id UUID;
  approved_asset_ids UUID[];
BEGIN
  PERFORM set_config(
    'request.jwt.claim.sub',
    '00000000-0000-0000-0000-000000000003',
    true
  );
  BEGIN
    PERFORM * FROM claim_consent_request('audit-forwarded-token');
    RAISE EXCEPTION 'audit_forwarded_claim_was_accepted';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM = 'audit_forwarded_claim_was_accepted' THEN
        forwarded_claim_rejected := false;
      ELSIF SQLERRM ~* 'different contact|invite contact' THEN
        forwarded_claim_rejected := true;
      ELSE
        RAISE;
      END IF;
  END;

  PERFORM set_config(
    'request.jwt.claim.sub',
    '00000000-0000-0000-0000-000000000002',
    true
  );
  IF NOT EXISTS (
    SELECT 1 FROM claim_consent_request('audit-unverified-token')
     WHERE pitch_draft_id = 'a0200000-0000-0000-0000-000000000002'
  ) THEN
    RAISE EXCEPTION 'AUDIT-P02: matching invited contact could not claim';
  END IF;
  BEGIN
    IF to_regprocedure(
      'public.approve_and_publish_pitch(uuid,integer,uuid,uuid[],boolean)'
    ) IS NOT NULL THEN
      EXECUTE $sql$
        SELECT cr.revision_id, r.asset_ids
          FROM consent_requests cr
          JOIN consent_revisions r ON r.id = cr.revision_id
         WHERE cr.id = 'a0200000-0000-0000-0000-000000000012'
      $sql$ INTO approved_revision_id, approved_asset_ids;
      PERFORM * FROM approve_and_publish_pitch(
        'a0200000-0000-0000-0000-000000000002',
        14,
        approved_revision_id,
        approved_asset_ids,
        true
      );
    ELSE
      PERFORM * FROM approve_and_publish_pitch(
        'a0200000-0000-0000-0000-000000000002',
        30
      );
    END IF;
    RAISE EXCEPTION 'audit_unverified_publish_was_accepted';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM = 'audit_unverified_publish_was_accepted' THEN
        unverified_publish_rejected := false;
      ELSIF SQLERRM ~* 'verification|evidence' THEN
        unverified_publish_rejected := true;
      ELSE
        RAISE;
      END IF;
  END;

  IF NOT forwarded_claim_rejected THEN
    RAISE EXCEPTION 'AUDIT-P02: unrelated account claimed a forwarded token';
  END IF;
  IF NOT unverified_publish_rejected THEN
    RAISE EXCEPTION 'AUDIT-P02: subject without a successful verification check published';
  END IF;
END;
$$;

ROLLBACK;

SELECT 'a02_claim_and_verification.sql passed' AS result;
