-- AUDIT2 REGRESSION: P0-2, 감사 §3 asset-kind별 media enforcement.
BEGIN;

DO $$
BEGIN
  IF to_regclass('public.media_validations') IS NULL THEN
    RAISE EXCEPTION 'AUDIT2-P0-2: media_validations is missing';
  END IF;
  IF to_regprocedure('public.submit_pitch_for_consent(uuid,text,text,text)') IS NULL THEN
    RAISE EXCEPTION 'AUDIT2-P0-2: submit_pitch_for_consent(uuid,text,text,text) RPC missing';
  END IF;
END;
$$;

UPDATE public.app_config
   SET value = 'on'
 WHERE key = 'media_validation_enforcement';

CREATE FUNCTION pg_temp.add_media_case(
  target_draft_id UUID,
  photo_mime_ok BOOLEAN,
  photo_magic_ok BOOLEAN,
  photo_size_ok BOOLEAN,
  photo_decode_ok BOOLEAN,
  photo_moderation TEXT,
  voice_mime_ok BOOLEAN,
  voice_magic_ok BOOLEAN,
  voice_size_ok BOOLEAN,
  voice_decode_ok BOOLEAN,
  voice_moderation TEXT
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  photo_path TEXT := target_draft_id::TEXT || '/photo.jpg';
  voice_path TEXT := target_draft_id::TEXT || '/voice.mp4';
BEGIN
  INSERT INTO public.pitch_drafts (
    id, created_by_user_id, status, headline, body
  ) VALUES (
    target_draft_id,
    '00000000-0000-0000-0000-000000000004',
    'draft',
    'Audit2 validated pitch',
    'Both the image and voice must have authoritative validation evidence.'
  );
  INSERT INTO public.pitch_assets (
    pitch_draft_id, uploaded_by_user_id, asset_type, storage_path, sort_order
  ) VALUES
    (
      target_draft_id,
      '00000000-0000-0000-0000-000000000004',
      'photo',
      photo_path,
      0
    ),
    (
      target_draft_id,
      '00000000-0000-0000-0000-000000000004',
      'voice',
      voice_path,
      1
    );
  INSERT INTO public.media_validations (
    bucket_id,
    object_name,
    validated_at,
    mime_ok,
    magic_ok,
    size_ok,
    decode_ok,
    moderation_status,
    moderation_ref
  ) VALUES
    (
      'pitch-media', photo_path, now(), photo_mime_ok, photo_magic_ok,
      photo_size_ok, photo_decode_ok, photo_moderation, 'audit2-image-moderation'
    ),
    (
      'pitch-media', voice_path, now(), voice_mime_ok, voice_magic_ok,
      voice_size_ok, voice_decode_ok, voice_moderation, 'audit2-transcript-moderation'
    );
END;
$$;

CREATE FUNCTION pg_temp.submission_is_blocked(target_draft_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM * FROM public.submit_pitch_for_consent(
    target_draft_id,
    'email',
    'media-audit@example.test',
    'Media Audit'
  );
  RETURN false;
EXCEPTION WHEN OTHERS THEN
  RETURN true;
END;
$$;

-- Slice 2 text gate (0026): all b02 drafts share one headline/body, so a
-- single passed pitch_content verdict keeps this file focused on media.
INSERT INTO public.text_moderations (scope, content_hash, moderation_status)
VALUES (
  'pitch_content',
  encode(digest(
    'Audit2 validated pitch' || E'\n\n'
      || 'Both the image and voice must have authoritative validation evidence.',
    'sha256'
  ), 'hex'),
  'passed'
)
ON CONFLICT (scope, content_hash) DO NOTHING;

SELECT pg_temp.add_media_case(
  'b0200000-0000-0000-0000-000000000001',
  true, true, true, true, 'passed',
  true, true, true, true, 'passed'
);
SELECT pg_temp.add_media_case(
  'b0200000-0000-0000-0000-000000000002',
  false, true, true, true, 'passed',
  true, true, true, true, 'passed'
);
SELECT pg_temp.add_media_case(
  'b0200000-0000-0000-0000-000000000003',
  true, true, true, true, 'passed',
  true, false, true, true, 'passed'
);
SELECT pg_temp.add_media_case(
  'b0200000-0000-0000-0000-000000000004',
  true, true, false, true, 'passed',
  true, true, true, true, 'passed'
);
SELECT pg_temp.add_media_case(
  'b0200000-0000-0000-0000-000000000005',
  true, true, true, true, 'passed',
  true, true, true, false, 'passed'
);
SELECT pg_temp.add_media_case(
  'b0200000-0000-0000-0000-000000000006',
  true, true, true, true, 'flagged',
  true, true, true, true, 'passed'
);
SELECT pg_temp.add_media_case(
  'b0200000-0000-0000-0000-000000000007',
  true, true, true, true, 'passed',
  true, true, true, true, 'flagged'
);
SELECT pg_temp.add_media_case(
  'b0200000-0000-0000-0000-000000000008',
  true, true, true, true, 'passed',
  true, true, true, true, 'skipped'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);

DO $$
DECLARE
  failures TEXT[] := ARRAY[]::TEXT[];
BEGIN
  IF pg_temp.submission_is_blocked('b0200000-0000-0000-0000-000000000001') THEN
    failures := array_append(failures, 'valid image+passed transcript voice was blocked');
  END IF;
  IF NOT pg_temp.submission_is_blocked('b0200000-0000-0000-0000-000000000002') THEN
    failures := array_append(failures, 'mime_ok=false was accepted');
  END IF;
  IF NOT pg_temp.submission_is_blocked('b0200000-0000-0000-0000-000000000003') THEN
    failures := array_append(failures, 'magic_ok=false was accepted');
  END IF;
  IF NOT pg_temp.submission_is_blocked('b0200000-0000-0000-0000-000000000004') THEN
    failures := array_append(failures, 'size_ok=false was accepted');
  END IF;
  IF NOT pg_temp.submission_is_blocked('b0200000-0000-0000-0000-000000000005') THEN
    failures := array_append(failures, 'decode_ok=false was accepted');
  END IF;
  IF NOT pg_temp.submission_is_blocked('b0200000-0000-0000-0000-000000000006') THEN
    failures := array_append(failures, 'flagged image was accepted');
  END IF;
  IF NOT pg_temp.submission_is_blocked('b0200000-0000-0000-0000-000000000007') THEN
    failures := array_append(failures, 'flagged voice transcript was accepted');
  END IF;
  IF NOT pg_temp.submission_is_blocked('b0200000-0000-0000-0000-000000000008') THEN
    failures := array_append(failures, 'skipped voice moderation was accepted');
  END IF;

  IF cardinality(failures) > 0 THEN
    RAISE EXCEPTION 'AUDIT2-P0-2: %', array_to_string(failures, '; ');
  END IF;
END;
$$;

ROLLBACK;

SELECT 'b02_media_voice_enforcement.sql passed' AS result;
