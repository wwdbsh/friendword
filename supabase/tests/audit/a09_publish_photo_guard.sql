-- AUDIT REGRESSION: P0-9, 감사 문서 §5 "실제 캠페인 사진 guard".
-- 현재 실패 이유: 포함된 photo pitch_asset이 0장이어도 approve/publish가 성공한다.

BEGIN;

INSERT INTO pitch_drafts (
  id,
  created_by_user_id,
  subject_user_id,
  status,
  headline,
  body
)
VALUES (
  'a0900000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000004',
  NULL,
  'draft',
  'No-photo audit pitch',
  'Publishing this would make the real page use a misleading fixture.'
);
INSERT INTO pitch_assets (
  id,
  pitch_draft_id,
  uploaded_by_user_id,
  asset_type,
  storage_path
)
VALUES (
  'a0900000-0000-0000-0000-000000000003',
  'a0900000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000004',
  'photo',
  'a0900000-0000-0000-0000-000000000001/reviewed-photo.jpg'
);

SET LOCAL ROLE authenticated;
DO $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);
  PERFORM * FROM submit_pitch_for_consent(
    'a0900000-0000-0000-0000-000000000001',
    'email',
    'dater@example.test',
    'Blair'
  );
END;
$$;
RESET ROLE;

UPDATE pitch_drafts
   SET subject_user_id = '00000000-0000-0000-0000-000000000002'
 WHERE id = 'a0900000-0000-0000-0000-000000000001';
UPDATE consent_requests
   SET subject_user_id = '00000000-0000-0000-0000-000000000002'
 WHERE pitch_draft_id = 'a0900000-0000-0000-0000-000000000001';
DELETE FROM pitch_assets
 WHERE id = 'a0900000-0000-0000-0000-000000000003';
INSERT INTO campaigns (
  id,
  pitch_draft_id,
  owner_user_id,
  status
)
VALUES (
  'a0900000-0000-0000-0000-000000000002',
  'a0900000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002',
  'draft'
);
INSERT INTO campaign_memberships (campaign_id, user_id, role)
VALUES
  (
    'a0900000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000002',
    'DATER_OWNER'
  ),
  (
    'a0900000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000004',
    'INTRODUCER'
  );
INSERT INTO campaign_entitlements (campaign_id, product_id, active, expires_at)
VALUES (
  'a0900000-0000-0000-0000-000000000002',
  'campaign_30d_1999',
  true,
  now() + INTERVAL '30 days'
);
INSERT INTO verification_checks (
  user_id,
  provider,
  provider_reference,
  status,
  verified_at
)
VALUES (
  '00000000-0000-0000-0000-000000000002',
  'audit',
  'audit-p09-success',
  'passed',
  now()
);

SET LOCAL ROLE authenticated;
DO $$
DECLARE
  photo_less_publish_rejected BOOLEAN := false;
  approved_revision_id UUID;
BEGIN
  PERFORM set_config(
    'request.jwt.claim.sub',
    '00000000-0000-0000-0000-000000000002',
    true
  );
  BEGIN
    IF to_regprocedure(
      'public.approve_and_publish_pitch(uuid,integer,uuid,uuid[],boolean)'
    ) IS NOT NULL THEN
      SELECT revision_id INTO approved_revision_id
        FROM consent_requests
       WHERE pitch_draft_id = 'a0900000-0000-0000-0000-000000000001';
      PERFORM * FROM approve_and_publish_pitch(
        'a0900000-0000-0000-0000-000000000001',
        14,
        approved_revision_id,
        ARRAY[]::UUID[],
        true
      );
    ELSE
      PERFORM * FROM approve_and_publish_pitch(
        'a0900000-0000-0000-0000-000000000001',
        30
      );
    END IF;
    RAISE EXCEPTION 'audit_photo_less_pitch_was_published';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM = 'audit_photo_less_pitch_was_published' THEN
        photo_less_publish_rejected := false;
      ELSIF SQLERRM ~* 'photo' THEN
        photo_less_publish_rejected := true;
      ELSE
        RAISE;
      END IF;
  END;

  IF NOT photo_less_publish_rejected THEN
    RAISE EXCEPTION 'AUDIT-P09: pitch with zero included photos was published';
  END IF;
END;
$$;

ROLLBACK;

SELECT 'a09_publish_photo_guard.sql passed' AS result;
