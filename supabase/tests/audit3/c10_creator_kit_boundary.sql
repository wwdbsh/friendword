-- AUDIT3 REGRESSION: 3차 감사 CP-5 — Creator Launch kit(정적 9:16 share card +
-- caption pack)이 Dater 승인 snapshot의 콘텐츠만 사용하고, 별도 재승인이 필요한
-- 신규 표현을 만들지 않는다. kit-image 라우트(apps/web/app/api/kit-image/route.tsx)는
-- share_kits에 스냅샷을 저장하지 않고 발행된 draft에서 라이브로 두 값을 읽는다:
--   (a) headline  = pitch_drafts.headline
--   (b) 대표 사진  = pitch_assets 중 asset_type='photo'의 sort_order 최솟값
-- 따라서 approve_and_publish_pitch가 (a) 승인 revision의 headline을 draft로 복사하고
-- (b) 승인/포함되지 않은 사진을 pitch_assets에서 삭제해야 kit이 승인 콘텐츠 경계를
-- 벗어나지 않는다. 이 두 동작은 migration 0036에 구현돼 있으나 c04는 transcript
-- 스냅샷만 검사하고 headline 동기화·사진 프루닝은 검사하지 않아 kit 경계가 회귀에
-- 노출돼 있었다. 이 파일이 kit이 실제로 읽는 두 값에 그 경계를 고정한다.
--
-- 경계가 무는(bite) 설계: 승인에서 제외되는 사진(photo-excluded)에 가장 낮은
-- sort_order를 준다. approve가 프루닝을 멈추면 kit의 대표 사진(min sort_order)이
-- 미승인 사진이 되어 아래 (C) 검사가 RED가 된다. red-first 관점에서 0036 이전
-- 동작(프루닝·headline 복사 없음)에 대해 (A)·(B)·(C) 모두 실패한다.
BEGIN;

-- The kit unlocks only after publish; validation gating is orthogonal to this
-- content-boundary test, so exercise the enforcement-off approve path.
UPDATE public.app_config
   SET value = 'off'
 WHERE key = 'media_validation_enforcement';

-- H-7 (migration 0039): dater 0002 already owns the seed campaign; archive it
-- first so the one-active-campaign guard allows this publish.
UPDATE public.campaigns SET status = 'archived'
 WHERE owner_user_id = '00000000-0000-0000-0000-000000000002'
   AND status IN ('published', 'paused');

INSERT INTO public.pitch_drafts (
  id, created_by_user_id, subject_user_id, status, headline, body, transcript
) VALUES (
  'c1000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002',
  'consent_pending',
  'Introducer draft headline (pre-approval)',
  'Introducer body the dater will approve as-is.',
  '{"text": "Kit boundary transcript.", "segments": []}'::JSONB
);

-- voice (sort_order 0) + three photos. photo-excluded has the LOWEST photo
-- sort_order (1) so a pruning regression would make it the kit representative.
INSERT INTO public.pitch_assets (
  id, pitch_draft_id, uploaded_by_user_id, asset_type, storage_path, sort_order
) VALUES
  (
    'c1000000-0000-0000-0000-000000000200',
    'c1000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    'voice',
    'pitch-media/c1000000-0000-0000-0000-000000000001/voice.m4a',
    0
  ),
  (
    'c1000000-0000-0000-0000-000000000201',
    'c1000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    'photo',
    'pitch-media/c1000000-0000-0000-0000-000000000001/photo-excluded.jpg',
    1
  ),
  (
    'c1000000-0000-0000-0000-000000000202',
    'c1000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    'photo',
    'pitch-media/c1000000-0000-0000-0000-000000000001/photo-rep.jpg',
    2
  ),
  (
    'c1000000-0000-0000-0000-000000000203',
    'c1000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    'photo',
    'pitch-media/c1000000-0000-0000-0000-000000000001/photo-extra.jpg',
    3
  );

INSERT INTO public.consent_revisions (
  id, pitch_draft_id, revision_number, headline, body, structure,
  asset_ids, voice_asset_path, content_hash
) VALUES (
  'c1000000-0000-0000-0000-000000000301',
  'c1000000-0000-0000-0000-000000000001',
  1,
  'Introducer draft headline (pre-approval)',
  'Introducer body the dater will approve as-is.',
  NULL,
  ARRAY[
    'c1000000-0000-0000-0000-000000000200',
    'c1000000-0000-0000-0000-000000000201',
    'c1000000-0000-0000-0000-000000000202',
    'c1000000-0000-0000-0000-000000000203'
  ]::UUID[],
  'pitch-media/c1000000-0000-0000-0000-000000000001/voice.m4a',
  'c10-fixture-hash-1'
);

INSERT INTO public.consent_requests (
  id, pitch_draft_id, subject_user_id, token_hash, status, revision_id,
  invite_contact_channel, invite_contact_hash
) VALUES (
  'c1000000-0000-0000-0000-000000000401',
  'c1000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002',
  encode(digest('c10-consent-token', 'sha256'), 'hex'),
  'claimed',
  'c1000000-0000-0000-0000-000000000301',
  'email',
  encode(digest('c10-dater@example.test', 'sha256'), 'hex')
);

DO $$
DECLARE
  failures TEXT[] := ARRAY[]::TEXT[];
  draft CONSTANT UUID := 'c1000000-0000-0000-0000-000000000001';
  dater CONSTANT UUID := '00000000-0000-0000-0000-000000000002';
  photo_excluded CONSTANT UUID := 'c1000000-0000-0000-0000-000000000201';
  photo_rep CONSTANT UUID := 'c1000000-0000-0000-0000-000000000202';
  photo_extra CONSTANT UUID := 'c1000000-0000-0000-0000-000000000203';
  -- The exact headline the dater approves; the kit must render THIS, not the
  -- introducer's pre-approval draft headline.
  approved_headline CONSTANT TEXT := 'Blair, in a friend''s own words';
  rev2 UUID;
  slug TEXT;
  draft_headline TEXT;
  draft_status TEXT;
  kit_representative UUID;
  surviving_photos UUID[];
BEGIN
  PERFORM set_config('request.jwt.claim.sub', dater::text, true);

  -- The dater approves an explicit photo set: the two kept photos, leaving
  -- photo_excluded out. approve_and_publish_pitch's included_asset_ids is a
  -- photos-only set (non-photo entries are rejected), so mirror c04 and pass
  -- photos only to both the revision and the approve call. voice is dropped
  -- from the snapshot, which is fine — the kit never reads voice from
  -- pitch_assets; it only reads the headline and the min-sort_order photo.
  SELECT revision_id INTO rev2
    FROM public.create_dater_revision(
      draft,
      approved_headline,
      'Blair body the dater confirms.',
      ARRAY[photo_rep, photo_extra]
    );
  IF rev2 IS NULL THEN
    failures := array_append(failures, 'dater revision was rejected');
  END IF;

  SELECT campaign_slug INTO slug
    FROM public.approve_and_publish_pitch(
      draft, 14, rev2, ARRAY[photo_rep, photo_extra], true
    );
  IF slug IS NULL THEN
    failures := array_append(failures, 'approve returned no slug');
  END IF;

  SELECT headline, status INTO draft_headline, draft_status
    FROM public.pitch_drafts WHERE id = draft;
  IF draft_status IS DISTINCT FROM 'published' THEN
    failures := array_append(failures, 'draft was not published');
  END IF;

  -- (A) headline sync: kit reads pitch_drafts.headline, which must equal the
  -- dater-approved revision headline, never the introducer's draft headline.
  IF draft_headline IS DISTINCT FROM approved_headline THEN
    failures := array_append(failures,
      'kit headline source (pitch_drafts.headline) is not the approved revision headline: '
      || coalesce(draft_headline, '<null>'));
  END IF;

  -- (B) photo pruning: the excluded photo must be deleted; surviving photos
  -- must be exactly the approved/included set.
  SELECT array_agg(id ORDER BY sort_order, id) INTO surviving_photos
    FROM public.pitch_assets
   WHERE pitch_draft_id = draft AND asset_type = 'photo';
  IF surviving_photos IS DISTINCT FROM ARRAY[photo_rep, photo_extra]::UUID[] THEN
    failures := array_append(failures,
      'published pitch_assets photos are not exactly the approved set: '
      || coalesce(array_to_string(surviving_photos, ','), '<null>'));
  END IF;
  IF EXISTS (SELECT 1 FROM public.pitch_assets WHERE id = photo_excluded) THEN
    failures := array_append(failures,
      'the non-approved photo survived publish and can leak into the kit');
  END IF;

  -- (C) kit representative: the min-sort_order photo (exactly what
  -- kit-image/route.tsx selects) must be an approved photo. With the excluded
  -- photo owning the lowest sort_order, a pruning regression would surface it.
  SELECT id INTO kit_representative
    FROM public.pitch_assets
   WHERE pitch_draft_id = draft AND asset_type = 'photo'
   ORDER BY sort_order, id
   LIMIT 1;
  IF kit_representative IS DISTINCT FROM photo_rep THEN
    failures := array_append(failures,
      'kit representative photo (min sort_order) is not the approved photo: '
      || coalesce(kit_representative::text, '<null>'));
  END IF;

  IF cardinality(failures) > 0 THEN
    RAISE EXCEPTION 'AUDIT3-KIT: %', array_to_string(failures, '; ');
  END IF;
END;
$$;

ROLLBACK;

SELECT 'c10_creator_kit_boundary.sql passed' AS result;
