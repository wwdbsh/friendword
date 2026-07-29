-- AUDIT2 REGRESSION: CP-1, 감사 §4 — Dater가 최종 snapshot(문구·사진·audience·
-- 기간·위치 정밀도)을 통제하고, publish RPC는 정확히 그 snapshot만 발행하며,
-- audience policy가 interest 경계에서 서버로 강제된다. (Slice 7)
BEGIN;

DO $$
BEGIN
  -- 0047 replaced the 4-arg function with a 6-arg one whose new_structure and
  -- retained_hard_claims default to NULL; 0048 widened it again with new_scene.
  -- The 4-arg call sites below still resolve to it.
  IF to_regprocedure(
    'public.create_dater_revision(uuid,text,text,uuid[],jsonb,text[],jsonb)'
  ) IS NULL THEN
    RAISE EXCEPTION
      'AUDIT2-CP-1: create_dater_revision(uuid,text,text,uuid[],jsonb,text[],jsonb) RPC missing';
  END IF;
  IF to_regprocedure('public.set_publish_preferences(uuid,jsonb,text,integer)') IS NULL THEN
    RAISE EXCEPTION 'AUDIT2-CP-1: set_publish_preferences(uuid,jsonb,text,integer) RPC missing';
  END IF;
  IF to_regprocedure(
    'public.approve_and_publish_pitch(uuid,integer,uuid,uuid[],boolean)'
  ) IS NULL THEN
    RAISE EXCEPTION 'AUDIT2-CP-1: approve_and_publish_pitch RPC missing';
  END IF;
END;
$$;

-- Fixture: a claimed consent review in flight. Introducer 0001 pitched
-- dater 0002 (Blair); the draft holds the provider transcript that every
-- revision must freeze.
INSERT INTO auth.users (id, email)
VALUES ('b1300000-0000-0000-0000-000000000005', 'b13-no-profile@example.test');
INSERT INTO public.users (id)
VALUES ('b1300000-0000-0000-0000-000000000005');

INSERT INTO public.pitch_drafts (
  id, created_by_user_id, subject_user_id, status, headline, body, transcript
) VALUES (
  'b1300000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002',
  'consent_pending',
  'Introducer headline',
  'Introducer body that the dater will rewrite.',
  '{"text": "Blair is the kindest person I know.",
    "segments": [{"start": 0, "end": 2.4, "text": "Blair is the kindest"},
                 {"start": 2.4, "end": 4.1, "text": "person I know."}]}'::JSONB
);

INSERT INTO public.pitch_assets (
  id, pitch_draft_id, uploaded_by_user_id, asset_type, storage_path, sort_order
) VALUES
  (
    'b1300000-0000-0000-0000-000000000201',
    'b1300000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    'voice',
    'pitch-media/b1300000-0000-0000-0000-000000000001/voice.m4a',
    0
  ),
  (
    'b1300000-0000-0000-0000-000000000202',
    'b1300000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    'photo',
    'pitch-media/b1300000-0000-0000-0000-000000000001/photo-1.jpg',
    0
  ),
  (
    'b1300000-0000-0000-0000-000000000203',
    'b1300000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    'photo',
    'pitch-media/b1300000-0000-0000-0000-000000000001/photo-2.jpg',
    1
  );

-- transcript is intentionally NULL: the 0032 snapshot trigger must freeze
-- the draft transcript into the revision at insert time.
INSERT INTO public.consent_revisions (
  id, pitch_draft_id, revision_number, headline, body, structure,
  asset_ids, voice_asset_path, content_hash
) VALUES (
  'b1300000-0000-0000-0000-000000000301',
  'b1300000-0000-0000-0000-000000000001',
  1,
  'Introducer headline',
  'Introducer body that the dater will rewrite.',
  NULL,
  ARRAY[
    'b1300000-0000-0000-0000-000000000201',
    'b1300000-0000-0000-0000-000000000202',
    'b1300000-0000-0000-0000-000000000203'
  ]::UUID[],
  'pitch-media/b1300000-0000-0000-0000-000000000001/voice.m4a',
  'b13-fixture-hash-1'
);

INSERT INTO public.consent_requests (
  id, pitch_draft_id, subject_user_id, token_hash, status, revision_id,
  invite_contact_channel, invite_contact_hash
) VALUES (
  'b1300000-0000-0000-0000-000000000401',
  'b1300000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002',
  encode(digest('b13-consent-token', 'sha256'), 'hex'),
  'claimed',
  'b1300000-0000-0000-0000-000000000301',
  'email',
  encode(digest('dater@example.test', 'sha256'), 'hex')
);

-- H-7 (migration 0039): the dater 0002 already owns the seed campaign
-- (20000000-…-0001). The one-active-campaign guard now permits only one
-- published/paused campaign per owner, and this suite publishes its own draft
-- below. Archive the seed campaign first (an exit transition is always
-- allowed); b13 never reads the seed campaign.
UPDATE campaigns SET status = 'archived'
 WHERE owner_user_id = '00000000-0000-0000-0000-000000000002'
   AND status IN ('published', 'paused');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);

DO $$
DECLARE
  failures TEXT[] := ARRAY[]::TEXT[];
  rejected BOOLEAN;
  draft CONSTANT UUID := 'b1300000-0000-0000-0000-000000000001';
  stale_revision CONSTANT UUID := 'b1300000-0000-0000-0000-000000000301';
  voice_asset CONSTANT UUID := 'b1300000-0000-0000-0000-000000000201';
  kept_photo CONSTANT UUID := 'b1300000-0000-0000-0000-000000000202';
  dropped_photo CONSTANT UUID := 'b1300000-0000-0000-0000-000000000203';
  frozen_transcript JSONB;
  dater_revision UUID;
  dater_revision_number INTEGER;
  linked_revision UUID;
  revision_row public.consent_revisions;
  published_slug TEXT;
BEGIN
  -- The fixture revision froze the draft transcript via the 0032 trigger.
  SELECT transcript INTO frozen_transcript
    FROM public.consent_revisions
   WHERE id = stale_revision;
  IF frozen_transcript IS NULL
     OR frozen_transcript ->> 'text' IS DISTINCT FROM 'Blair is the kindest person I know.' THEN
    failures := array_append(failures, 'revision did not snapshot the draft transcript');
  END IF;

  -- Only the claimed dater may cut a revision.
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
  rejected := false;
  BEGIN
    PERFORM * FROM public.create_dater_revision(
      draft, 'Hijacked headline', 'Hijacked body', NULL
    );
  EXCEPTION WHEN OTHERS THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    failures := array_append(failures, 'introducer could cut a dater revision');
  END IF;
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);

  -- The dater rewrites the copy and drops one photo (keeping the voice).
  SELECT revision_id, revision_number
    INTO dater_revision, dater_revision_number
    FROM public.create_dater_revision(
      draft,
      'Blair approved headline',
      'Blair approved body, in Blair''s own words.',
      ARRAY[voice_asset, kept_photo]
    );
  IF dater_revision IS NULL OR dater_revision_number IS DISTINCT FROM 2 THEN
    failures := array_append(failures, 'create_dater_revision did not return revision 2');
  END IF;

  SELECT cr.revision_id INTO linked_revision
    FROM public.consent_requests cr
   WHERE cr.pitch_draft_id = draft;
  IF linked_revision IS DISTINCT FROM dater_revision THEN
    failures := array_append(failures, 'consent request does not point at the dater revision');
  END IF;

  SELECT * INTO revision_row
    FROM public.consent_revisions
   WHERE id = dater_revision;
  IF revision_row.transcript IS DISTINCT FROM frozen_transcript THEN
    failures := array_append(failures, 'dater revision lost the frozen transcript');
  END IF;
  IF revision_row.voice_asset_path IS DISTINCT FROM
     'pitch-media/b1300000-0000-0000-0000-000000000001/voice.m4a' THEN
    failures := array_append(failures, 'dater revision lost the voice asset path');
  END IF;
  IF revision_row.asset_ids IS DISTINCT FROM ARRAY[voice_asset, kept_photo]::UUID[] THEN
    failures := array_append(failures, 'dater revision asset snapshot is wrong');
  END IF;

  -- Assets outside the draft cannot enter the snapshot.
  rejected := false;
  BEGIN
    PERFORM * FROM public.create_dater_revision(
      draft, 'Bad assets', 'Bad assets body',
      ARRAY['b1300000-0000-0000-0000-000000000999']::UUID[]
    );
  EXCEPTION WHEN OTHERS THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    failures := array_append(failures, 'foreign asset id entered a revision snapshot');
  END IF;

  -- Publish preferences validate server-side.
  rejected := false;
  BEGIN
    PERFORM public.set_publish_preferences(draft, '{"min_age": 17}'::JSONB, 'city', 14);
  EXCEPTION WHEN OTHERS THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    failures := array_append(failures, 'audience min_age under 18 was accepted');
  END IF;

  rejected := false;
  BEGIN
    PERFORM public.set_publish_preferences(
      draft, '{"min_age": 30, "max_age": 25}'::JSONB, 'city', 14
    );
  EXCEPTION WHEN OTHERS THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    failures := array_append(failures, 'max_age below min_age was accepted');
  END IF;

  rejected := false;
  BEGIN
    PERFORM public.set_publish_preferences(draft, NULL, 'city', 10);
  EXCEPTION WHEN OTHERS THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    failures := array_append(failures, 'publish_days outside 7/14 was accepted');
  END IF;

  rejected := false;
  BEGIN
    PERFORM public.set_publish_preferences(draft, '["not-an-object"]'::JSONB, 'city', 14);
  EXCEPTION WHEN OTHERS THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    failures := array_append(failures, 'non-object audience policy was accepted');
  END IF;

  PERFORM public.set_publish_preferences(draft, '{"min_age": 35}'::JSONB, 'hidden', 7);

  -- Publishing must match the stored duration preference…
  rejected := false;
  BEGIN
    PERFORM * FROM public.approve_and_publish_pitch(
      draft, 14, dater_revision, ARRAY[kept_photo], false
    );
  EXCEPTION WHEN OTHERS THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    failures := array_append(failures, 'campaign_days ignored the stored 7-day preference');
  END IF;

  -- …and must reject a stale (pre-edit) revision.
  rejected := false;
  BEGIN
    PERFORM * FROM public.approve_and_publish_pitch(
      draft, 7, stale_revision, ARRAY[kept_photo], false
    );
  EXCEPTION WHEN OTHERS THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    failures := array_append(failures, 'stale revision was publishable after the dater edit');
  END IF;

  -- Exactly the dater snapshot publishes. The dater rewrote the copy, so
  -- 0036 requires hard-claim confirmation (dater_edited is flag-independent).
  SELECT campaign_slug INTO published_slug
    FROM public.approve_and_publish_pitch(
      draft, 7, dater_revision, ARRAY[kept_photo], true
    );
  IF published_slug IS NULL THEN
    failures := array_append(failures, 'approve_and_publish_pitch returned no slug');
  END IF;

  -- Revisions stay immutable even for the dater who created them.
  rejected := false;
  BEGIN
    UPDATE public.consent_revisions
       SET headline = 'Post-approval tamper'
     WHERE id = dater_revision;
  EXCEPTION WHEN OTHERS THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    failures := array_append(failures, 'approved revision was mutable');
  END IF;

  IF cardinality(failures) > 0 THEN
    RAISE EXCEPTION 'AUDIT2-CP-1: %', array_to_string(failures, '; ');
  END IF;
END;
$$;

RESET ROLE;

-- Published state must equal the dater snapshot, and the audience policy
-- must gate interest submissions server-side (trigger, so direct inserts
-- are covered too).
DO $$
DECLARE
  failures TEXT[] := ARRAY[]::TEXT[];
  rejected BOOLEAN;
  draft CONSTANT UUID := 'b1300000-0000-0000-0000-000000000001';
  campaign public.campaigns;
  draft_row public.pitch_drafts;
BEGIN
  SELECT * INTO campaign FROM public.campaigns WHERE pitch_draft_id = draft;
  IF campaign.id IS NULL OR campaign.status IS DISTINCT FROM 'published' THEN
    failures := array_append(failures, 'campaign is not published');
  END IF;
  IF campaign.audience_policy IS DISTINCT FROM '{"min_age": 35}'::JSONB THEN
    failures := array_append(failures, 'campaign did not copy the audience policy');
  END IF;
  IF campaign.location_precision IS DISTINCT FROM 'hidden' THEN
    failures := array_append(failures, 'campaign did not copy the location precision');
  END IF;
  IF campaign.ends_at IS NULL
     OR abs(extract(epoch FROM campaign.ends_at - (now() + INTERVAL '7 days'))) > 60 THEN
    failures := array_append(failures, 'campaign duration is not the chosen 7 days');
  END IF;

  SELECT * INTO draft_row FROM public.pitch_drafts WHERE id = draft;
  IF draft_row.headline IS DISTINCT FROM 'Blair approved headline'
     OR draft_row.body IS DISTINCT FROM 'Blair approved body, in Blair''s own words.' THEN
    failures := array_append(failures, 'published draft text is not the dater snapshot');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.pitch_assets
     WHERE id = 'b1300000-0000-0000-0000-000000000203'
  ) THEN
    failures := array_append(failures, 'excluded photo survived publication');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.pitch_assets
     WHERE id = 'b1300000-0000-0000-0000-000000000201'
  ) THEN
    failures := array_append(failures, 'voice asset was deleted at publication');
  END IF;

  -- min_age 35 rejects a 32-year-old sender (Casey, born 1994).
  rejected := false;
  BEGIN
    INSERT INTO public.interests (campaign_id, sender_user_id, status)
    VALUES (campaign.id, '00000000-0000-0000-0000-000000000003', 'started');
  EXCEPTION WHEN OTHERS THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    failures := array_append(failures, 'audience min_age did not gate interest');
  END IF;

  -- Intent filter rejects a long-term sender when only short-term is allowed.
  UPDATE public.campaigns
     SET audience_policy = '{"min_age": 18, "intents": ["short-term"]}'::JSONB
   WHERE id = campaign.id;
  rejected := false;
  BEGIN
    INSERT INTO public.interests (campaign_id, sender_user_id, status)
    VALUES (campaign.id, '00000000-0000-0000-0000-000000000003', 'started');
  EXCEPTION WHEN OTHERS THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    failures := array_append(failures, 'audience intent filter did not gate interest');
  END IF;

  -- A policy with an age band requires the sender to have a profile age.
  UPDATE public.campaigns
     SET audience_policy = '{"min_age": 18}'::JSONB
   WHERE id = campaign.id;
  rejected := false;
  BEGIN
    INSERT INTO public.interests (campaign_id, sender_user_id, status)
    VALUES (campaign.id, 'b1300000-0000-0000-0000-000000000005', 'started');
  EXCEPTION WHEN OTHERS THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    failures := array_append(failures, 'ageless sender passed an age-banded policy');
  END IF;

  -- A sender inside the policy passes.
  UPDATE public.campaigns
     SET audience_policy = '{"min_age": 18, "max_age": 40, "intents": ["long-term"]}'::JSONB
   WHERE id = campaign.id;
  INSERT INTO public.interests (campaign_id, sender_user_id, status)
  VALUES (campaign.id, '00000000-0000-0000-0000-000000000003', 'started');
  DELETE FROM public.interests
   WHERE campaign_id = campaign.id
     AND sender_user_id = '00000000-0000-0000-0000-000000000003';

  -- No policy means no audience filter (age unknown is fine).
  UPDATE public.campaigns SET audience_policy = NULL WHERE id = campaign.id;
  INSERT INTO public.interests (campaign_id, sender_user_id, status)
  VALUES (campaign.id, 'b1300000-0000-0000-0000-000000000005', 'started');

  IF cardinality(failures) > 0 THEN
    RAISE EXCEPTION 'AUDIT2-CP-1: %', array_to_string(failures, '; ');
  END IF;
END;
$$;

ROLLBACK;

SELECT 'b13_dater_snapshot_control.sql passed' AS result;
