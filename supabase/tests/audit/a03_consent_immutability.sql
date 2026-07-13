-- AUDIT REGRESSION: P0-3, 감사 문서 §5 "동의 snapshot 불변성".
-- 초기 실패 원인은 mutable consent content였고, Slice D 0013으로 PASS한다.

BEGIN;

INSERT INTO pitch_drafts (
  id,
  created_by_user_id,
  status,
  headline,
  body
)
VALUES (
  'a0300000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000004',
  'draft',
  'Immutable headline',
  'Immutable body'
);
INSERT INTO pitch_assets (
  id,
  pitch_draft_id,
  uploaded_by_user_id,
  asset_type,
  storage_path
)
VALUES (
  'a0300000-0000-0000-0000-000000000002',
  'a0300000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000004',
  'photo',
  'a0300000-0000-0000-0000-000000000001/approved-photo.jpg'
);

CREATE TEMP TABLE audit_consent_token (raw_token TEXT) ON COMMIT DROP;
GRANT ALL ON audit_consent_token TO authenticated;

SET LOCAL ROLE authenticated;
DO $$
BEGIN
  PERFORM set_config(
    'request.jwt.claim.sub',
    '00000000-0000-0000-0000-000000000004',
    true
  );
  INSERT INTO audit_consent_token
  SELECT consent_token
    FROM submit_pitch_for_consent(
      'a0300000-0000-0000-0000-000000000001',
      'email',
      'introducer@example.test',
      'Alex'
    );
END;
$$;

DO $$
DECLARE
  copy_mutation_rejected BOOLEAN := false;
  media_mutation_rejected BOOLEAN := false;
  revision_mutation_rejected BOOLEAN := false;
  affected_count INTEGER;
  revision_count INTEGER := 0;
BEGIN
  PERFORM set_config(
    'request.jwt.claim.sub',
    '00000000-0000-0000-0000-000000000004',
    true
  );

  BEGIN
    UPDATE pitch_drafts
       SET headline = 'Changed after consent', body = 'Changed after consent'
     WHERE id = 'a0300000-0000-0000-0000-000000000001';
    GET DIAGNOSTICS affected_count = ROW_COUNT;
    copy_mutation_rejected := affected_count = 0;
  EXCEPTION
    WHEN insufficient_privilege THEN
      copy_mutation_rejected := true;
    WHEN raise_exception THEN
      IF SQLERRM ~* 'consent|immutable|revision' THEN
        copy_mutation_rejected := true;
      ELSE
        RAISE;
      END IF;
  END;

  BEGIN
    INSERT INTO storage.objects (bucket_id, name, owner_id)
    VALUES (
      'pitch-media',
      'a0300000-0000-0000-0000-000000000001/post-consent.jpg',
      auth.uid()::TEXT
    );
  EXCEPTION
    WHEN insufficient_privilege THEN
      media_mutation_rejected := true;
    WHEN raise_exception THEN
      IF SQLERRM ~* 'consent|immutable|upload' THEN
        media_mutation_rejected := true;
      ELSE
        RAISE;
      END IF;
  END;

  IF to_regclass('public.consent_revisions') IS NOT NULL THEN
    EXECUTE $sql$
      SELECT count(*)
        FROM consent_revisions
       WHERE pitch_draft_id = 'a0300000-0000-0000-0000-000000000001'
    $sql$ INTO revision_count;

    IF revision_count > 0 THEN
      BEGIN
        EXECUTE $sql$
          UPDATE consent_revisions
             SET created_at = created_at
           WHERE pitch_draft_id = 'a0300000-0000-0000-0000-000000000001'
        $sql$;
        GET DIAGNOSTICS affected_count = ROW_COUNT;
        revision_mutation_rejected := affected_count = 0;
      EXCEPTION
        WHEN insufficient_privilege THEN
          revision_mutation_rejected := true;
        WHEN raise_exception THEN
          IF SQLERRM ~* 'immutable|revision' THEN
            revision_mutation_rejected := true;
          ELSE
            RAISE;
          END IF;
      END;
    END IF;
  END IF;

  IF NOT copy_mutation_rejected THEN
    RAISE EXCEPTION 'AUDIT-P03: introducer changed copy during consent_pending';
  END IF;
  IF NOT media_mutation_rejected THEN
    RAISE EXCEPTION 'AUDIT-P03: introducer uploaded media during consent_pending';
  END IF;
  IF revision_count = 0 THEN
    RAISE EXCEPTION 'AUDIT-P03: immutable consent revision was not created';
  END IF;
  IF NOT revision_mutation_rejected THEN
    RAISE EXCEPTION 'AUDIT-P03: consent revision UPDATE was accepted';
  END IF;
END;
$$;

RESET ROLE;
UPDATE pitch_drafts
   SET subject_user_id = '00000000-0000-0000-0000-000000000001',
       headline = 'Tampered after review'
 WHERE id = 'a0300000-0000-0000-0000-000000000001';
UPDATE consent_requests
   SET subject_user_id = '00000000-0000-0000-0000-000000000001'
 WHERE pitch_draft_id = 'a0300000-0000-0000-0000-000000000001';
INSERT INTO verification_checks (
  user_id,
  provider,
  provider_reference,
  status,
  verified_at
)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'audit',
  'audit-p03-success',
  'passed',
  now()
);

SET LOCAL ROLE authenticated;
DO $$
DECLARE
  approved_revision_id UUID;
  approved_asset_ids UUID[];
  approved_headline TEXT;
  approved_body TEXT;
  approved_structure JSONB;
  published_headline TEXT;
  published_body TEXT;
  published_structure JSONB;
  published_asset_ids UUID[];
BEGIN
  PERFORM set_config(
    'request.jwt.claim.sub',
    '00000000-0000-0000-0000-000000000001',
    true
  );
  SELECT cr.revision_id, r.asset_ids, r.headline, r.body, r.structure
    INTO approved_revision_id,
         approved_asset_ids,
         approved_headline,
         approved_body,
         approved_structure
    FROM consent_requests cr
    JOIN consent_revisions r ON r.id = cr.revision_id
   WHERE cr.pitch_draft_id = 'a0300000-0000-0000-0000-000000000001';

  PERFORM * FROM approve_and_publish_pitch(
    'a0300000-0000-0000-0000-000000000001',
    14,
    approved_revision_id,
    approved_asset_ids,
    true
  );

  SELECT headline, body, structure
    INTO published_headline, published_body, published_structure
    FROM pitch_drafts
   WHERE id = 'a0300000-0000-0000-0000-000000000001';
  SELECT coalesce(array_agg(id ORDER BY id), ARRAY[]::UUID[]) INTO published_asset_ids
    FROM pitch_assets
   WHERE pitch_draft_id = 'a0300000-0000-0000-0000-000000000001';
  IF published_headline IS DISTINCT FROM approved_headline
     OR published_body IS DISTINCT FROM approved_body
     OR published_structure IS DISTINCT FROM approved_structure
     OR published_asset_ids IS DISTINCT FROM approved_asset_ids THEN
    RAISE EXCEPTION 'AUDIT-P03: published projection differs from the approved revision';
  END IF;
END;
$$;

ROLLBACK;

SELECT 'a03_consent_immutability.sql passed' AS result;
