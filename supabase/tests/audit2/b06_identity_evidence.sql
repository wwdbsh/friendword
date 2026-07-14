-- AUDIT2 REGRESSION: P0-8, 감사 §3 만료·종류·사진에 결합된 identity evidence.
BEGIN;

DO $$
DECLARE
  missing_column TEXT;
BEGIN
  SELECT required.column_name INTO missing_column
    FROM unnest(ARRAY[
      'check_type',
      'provider',
      'provider_ref',
      'photo_object_name',
      'result',
      'checked_at',
      'expires_at'
    ]) AS required(column_name)
   WHERE NOT EXISTS (
     SELECT 1
       FROM information_schema.columns actual
      WHERE actual.table_schema = 'public'
        AND actual.table_name = 'verification_checks'
        AND actual.column_name = required.column_name
   )
   LIMIT 1;

  IF missing_column IS NOT NULL THEN
    RAISE EXCEPTION 'AUDIT2-P0-8: verification_checks.% is missing', missing_column;
  END IF;
  IF to_regprocedure(
    'public.approve_and_publish_pitch(uuid,integer,uuid,uuid[],boolean)'
  ) IS NULL THEN
    RAISE EXCEPTION 'AUDIT2-P0-8: approve_and_publish_pitch evidence gate RPC missing';
  END IF;
  IF to_regprocedure('public.submit_interest(uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'AUDIT2-P0-8: submit_interest(uuid,text) RPC missing';
  END IF;
END;
$$;

UPDATE public.app_config SET value = 'on' WHERE key = 'identity_enforcement';
UPDATE public.app_config SET value = 'off' WHERE key = 'media_validation_enforcement';

INSERT INTO public.pitch_drafts (
  id, created_by_user_id, subject_user_id, status, headline, body
) VALUES (
  'b0600000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000004',
  '00000000-0000-0000-0000-000000000002',
  'consent_pending',
  'Identity-bound publish',
  'Only current evidence for the approved representative photo can publish.'
);
INSERT INTO public.pitch_assets (
  id, pitch_draft_id, uploaded_by_user_id, asset_type, storage_path
) VALUES (
  'b0600000-0000-0000-0000-000000000011',
  'b0600000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000004',
  'photo',
  'b0600000-0000-0000-0000-000000000001/representative.jpg'
);
INSERT INTO public.consent_revisions (
  id,
  pitch_draft_id,
  revision_number,
  headline,
  body,
  structure,
  asset_ids,
  content_hash
) VALUES (
  'b0600000-0000-0000-0000-000000000012',
  'b0600000-0000-0000-0000-000000000001',
  1,
  'Identity-bound publish',
  'Only current evidence for the approved representative photo can publish.',
  '{}'::JSONB,
  ARRAY['b0600000-0000-0000-0000-000000000011']::UUID[],
  repeat('6', 64)
);
INSERT INTO public.consent_requests (
  id,
  pitch_draft_id,
  subject_user_id,
  token_hash,
  status,
  revision_id,
  invite_contact_channel,
  invite_contact_hash
) VALUES (
  'b0600000-0000-0000-0000-000000000013',
  'b0600000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002',
  encode(digest('audit2-identity-publish', 'sha256'), 'hex'),
  'claimed',
  'b0600000-0000-0000-0000-000000000012',
  'email',
  encode(digest('dater@example.test', 'sha256'), 'hex')
);

CREATE FUNCTION pg_temp.publish_is_blocked()
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM * FROM public.approve_and_publish_pitch(
    'b0600000-0000-0000-0000-000000000001',
    14,
    'b0600000-0000-0000-0000-000000000012',
    ARRAY['b0600000-0000-0000-0000-000000000011']::UUID[],
    true
  );
  RETURN false;
EXCEPTION WHEN OTHERS THEN
  RETURN true;
END;
$$;

-- H-7 (migration 0039): dater 0002 already owns the seed campaign
-- (20000000-…-0001). The one-active-campaign guard fires BEFORE the identity
-- gate, so leaving the seed campaign active would let the guard — not the
-- identity gate this suite is asserting — block every publish probe. Archive
-- it first so the identity gate stays the authoritative blocker, and so the
-- final evidenced publish (dater 0002's single active campaign) succeeds. The
-- interest probes below are retargeted to that freshly published campaign.
UPDATE campaigns SET status = 'archived'
 WHERE owner_user_id = '00000000-0000-0000-0000-000000000002'
   AND status IN ('published', 'paused');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);

DO $$
BEGIN
  IF NOT pg_temp.publish_is_blocked() THEN
    RAISE EXCEPTION 'AUDIT2-P0-8: self-declared DOB published without evidence rows';
  END IF;
END;
$$;
RESET ROLE;

-- Keep legacy columns populated while the second-audit evidence columns
-- become the authoritative contract.
INSERT INTO public.verification_checks (
  user_id,
  provider,
  provider_reference,
  status,
  verified_at,
  check_type,
  provider_ref,
  photo_object_name,
  result,
  checked_at,
  expires_at
) VALUES
  (
    '00000000-0000-0000-0000-000000000002',
    'audit2',
    'audit2-publish-adult',
    'passed',
    now(),
    'adult_18plus',
    'audit2-publish-adult',
    NULL,
    'passed',
    now() - INTERVAL '40 days',
    now() - INTERVAL '1 day'
  ),
  (
    '00000000-0000-0000-0000-000000000002',
    'audit2',
    'audit2-publish-liveness',
    'passed',
    now(),
    'liveness',
    'audit2-publish-liveness',
    NULL,
    'passed',
    now(),
    now() + INTERVAL '30 days'
  ),
  (
    '00000000-0000-0000-0000-000000000002',
    'audit2',
    'audit2-publish-face',
    'passed',
    now(),
    'face_match',
    'audit2-publish-face',
    'b0600000-0000-0000-0000-000000000001/representative.jpg',
    'passed',
    now(),
    now() + INTERVAL '30 days'
  );

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
DO $$
BEGIN
  IF NOT pg_temp.publish_is_blocked() THEN
    RAISE EXCEPTION 'AUDIT2-P0-8: expired adult evidence published';
  END IF;
END;
$$;
RESET ROLE;

UPDATE public.verification_checks
   SET result = 'failed',
       status = 'failed',
       checked_at = now(),
       verified_at = now(),
       expires_at = now() + INTERVAL '30 days'
 WHERE provider_ref = 'audit2-publish-adult';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
DO $$
BEGIN
  IF NOT pg_temp.publish_is_blocked() THEN
    RAISE EXCEPTION 'AUDIT2-P0-8: failed adult evidence published';
  END IF;
END;
$$;
RESET ROLE;

UPDATE public.verification_checks
   SET result = 'inconclusive', status = 'inconclusive'
 WHERE provider_ref = 'audit2-publish-adult';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
DO $$
BEGIN
  IF NOT pg_temp.publish_is_blocked() THEN
    RAISE EXCEPTION 'AUDIT2-P0-8: inconclusive adult evidence published';
  END IF;
END;
$$;
RESET ROLE;

UPDATE public.verification_checks
   SET result = 'passed', status = 'passed'
 WHERE provider_ref = 'audit2-publish-adult';
UPDATE public.verification_checks
   SET photo_object_name = 'another-draft/wrong-photo.jpg'
 WHERE provider_ref = 'audit2-publish-face';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
DO $$
BEGIN
  IF NOT pg_temp.publish_is_blocked() THEN
    RAISE EXCEPTION 'AUDIT2-P0-8: face evidence for a different photo published';
  END IF;
END;
$$;
RESET ROLE;

UPDATE public.verification_checks
   SET photo_object_name =
         'b0600000-0000-0000-0000-000000000001/representative.jpg'
 WHERE provider_ref = 'audit2-publish-face';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.approve_and_publish_pitch(
      'b0600000-0000-0000-0000-000000000001',
      14,
      'b0600000-0000-0000-0000-000000000012',
      ARRAY['b0600000-0000-0000-0000-000000000011']::UUID[],
      true
    )
  ) THEN
    RAISE EXCEPTION 'AUDIT2-P0-8: current evidence could not publish';
  END IF;
END;
$$;
RESET ROLE;

-- Capture the campaign just published for dater 0002 so the interest probes
-- below can target it (the seed campaign was archived for the H-7 guard).
SELECT set_config(
  'b06.published_campaign',
  (SELECT id::text FROM public.campaigns
    WHERE pitch_draft_id = 'b0600000-0000-0000-0000-000000000001'),
  true
);

-- Interest requires server evidence in addition to a self-declared adult profile.
INSERT INTO auth.users (id, email)
VALUES ('b0600000-0000-0000-0000-000000000101', 'audit2-interest@example.test');
INSERT INTO public.users (id, phone_verified_at)
VALUES ('b0600000-0000-0000-0000-000000000101', now());
INSERT INTO public.profiles (user_id, display_name, birth_date)
VALUES (
  'b0600000-0000-0000-0000-000000000101',
  'Audit2 Interest',
  CURRENT_DATE - INTERVAL '25 years'
);
INSERT INTO public.dating_profiles (user_id, bio, photos, dating_intent)
VALUES (
  'b0600000-0000-0000-0000-000000000101',
  'Complete profile but no identity evidence yet.',
  ARRAY[
    'b0600000-0000-0000-0000-000000000101/one.jpg',
    'b0600000-0000-0000-0000-000000000101/two.jpg'
  ],
  'long-term'
);
INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
VALUES
  (
    'profile-media',
    'b0600000-0000-0000-0000-000000000101/one.jpg',
    'b0600000-0000-0000-0000-000000000101',
    '{"mimetype":"image/jpeg"}'::JSONB
  ),
  (
    'profile-media',
    'b0600000-0000-0000-0000-000000000101/two.jpg',
    'b0600000-0000-0000-0000-000000000101',
    '{"mimetype":"image/jpeg"}'::JSONB
  );

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'b0600000-0000-0000-0000-000000000101', true);
DO $$
DECLARE
  rejected BOOLEAN := false;
BEGIN
  BEGIN
    PERFORM * FROM public.submit_interest(
      current_setting('b06.published_campaign')::uuid,
      'Self-declared DOB is not evidence.'
    );
  EXCEPTION WHEN OTHERS THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'AUDIT2-P0-8: interest submitted without adult+liveness evidence';
  END IF;
END;
$$;
RESET ROLE;

INSERT INTO public.verification_checks (
  user_id,
  provider,
  provider_reference,
  status,
  verified_at,
  check_type,
  provider_ref,
  result,
  checked_at,
  expires_at
) VALUES
  (
    'b0600000-0000-0000-0000-000000000101',
    'audit2',
    'audit2-interest-adult',
    'passed',
    now(),
    'adult_18plus',
    'audit2-interest-adult',
    'passed',
    now(),
    now() + INTERVAL '30 days'
  ),
  (
    'b0600000-0000-0000-0000-000000000101',
    'audit2',
    'audit2-interest-liveness',
    'passed',
    now(),
    'liveness',
    'audit2-interest-liveness',
    'passed',
    now(),
    now() + INTERVAL '30 days'
  );

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'b0600000-0000-0000-0000-000000000101', true);
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.submit_interest(
      current_setting('b06.published_campaign')::uuid,
      'Current adult and liveness evidence exists.'
    )
  ) THEN
    RAISE EXCEPTION 'AUDIT2-P0-8: fully evidenced interest was not submitted';
  END IF;
END;
$$;

ROLLBACK;

SELECT 'b06_identity_evidence.sql passed' AS result;
