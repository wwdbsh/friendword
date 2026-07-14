-- AUDIT2 REGRESSION: H-4, 감사 §5 — 성장 지표는 서버가 기록한 outcome만
-- 신뢰한다. client는 interaction 이벤트만 보낼 수 있고, outcome은 상태가
-- 실제로 바뀌는 테이블의 트리거가 기록한다. (Slice 9)
BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.track_event(text,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'AUDIT2-H-4: track_event RPC missing';
  END IF;
END;
$$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true);

DO $$
DECLARE
  failures TEXT[] := ARRAY[]::TEXT[];
  rejected BOOLEAN;
  outcome TEXT;
BEGIN
  -- Every server-known outcome is rejected from clients.
  FOREACH outcome IN ARRAY ARRAY[
    'pitch_approved', 'campaign_published', 'interest_submitted',
    'interest_accepted', 'intro_room_created', 'first_message_sent',
    'creator_launch_purchased', 'campaign_pass_purchased',
    'report_submitted', 'user_blocked', 'campaign_paused',
    'campaign_expired', 'consent_sent', 'draft_changes_requested',
    'creator_launch_credit_consumed'
  ] LOOP
    rejected := false;
    BEGIN
      PERFORM public.track_event(outcome, '{}'::JSONB);
    EXCEPTION WHEN OTHERS THEN
      rejected := true;
    END;
    IF NOT rejected THEN
      failures := array_append(failures, outcome || ' was client-forgeable');
    END IF;
  END LOOP;

  -- Interaction events survive, but only with validated properties.
  PERFORM public.track_event(
    'interest_started',
    '{"campaign_id": "20000000-0000-0000-0000-000000000001", "source": "qa-check"}'::JSONB
  );

  rejected := false;
  BEGIN
    PERFORM public.track_event(
      'interest_started',
      '{"campaign_id": "99999999-9999-9999-9999-999999999999"}'::JSONB
    );
  EXCEPTION WHEN OTHERS THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    failures := array_append(failures, 'nonexistent campaign_id property accepted');
  END IF;

  rejected := false;
  BEGIN
    PERFORM public.track_event(
      'interest_started', '{"made_up_property": "x"}'::JSONB
    );
  EXCEPTION WHEN OTHERS THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    failures := array_append(failures, 'arbitrary property key accepted');
  END IF;

  rejected := false;
  BEGIN
    PERFORM public.track_event(
      'interest_started',
      ('{"source": "' || repeat('x', 90) || '"}')::JSONB
    );
  EXCEPTION WHEN OTHERS THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    failures := array_append(failures, 'oversized source slug accepted');
  END IF;

  IF cardinality(failures) > 0 THEN
    RAISE EXCEPTION 'AUDIT2-H-4: %', array_to_string(failures, '; ');
  END IF;
END;
$$;

-- Anonymous callers may only describe public-page interactions.
SELECT set_config('request.jwt.claim.sub', '', true);
SET LOCAL ROLE anon;
DO $$
DECLARE
  failures TEXT[] := ARRAY[]::TEXT[];
  rejected BOOLEAN;
BEGIN
  PERFORM public.track_event(
    'pitch_viewed_unique',
    '{"campaign_id": "20000000-0000-0000-0000-000000000001"}'::JSONB
  );

  rejected := false;
  BEGIN
    PERFORM public.track_event('introducer_started', '{}'::JSONB);
  EXCEPTION WHEN OTHERS THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    failures := array_append(failures, 'anon sent an authenticated-only interaction');
  END IF;

  rejected := false;
  BEGIN
    PERFORM public.track_event('campaign_published', '{}'::JSONB);
  EXCEPTION WHEN OTHERS THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    failures := array_append(failures, 'anon forged a server outcome');
  END IF;

  IF cardinality(failures) > 0 THEN
    RAISE EXCEPTION 'AUDIT2-H-4: %', array_to_string(failures, '; ');
  END IF;
END;
$$;
RESET ROLE;

-- The real transitions record the outcomes server-side, marked as such.
DO $$
DECLARE
  failures TEXT[] := ARRAY[]::TEXT[];
BEGIN
  -- Fixture: a fresh published campaign fires campaign_published.
  INSERT INTO public.pitch_drafts (
    id, created_by_user_id, subject_user_id, status, headline, body
  ) VALUES (
    'b1400000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000002',
    'published',
    'Server outcome fixture',
    'Server-recorded growth events.'
  );
  INSERT INTO public.consent_requests (
    id, pitch_draft_id, subject_user_id, token_hash, status, responded_at,
    invite_contact_channel, invite_contact_hash
  ) VALUES (
    'b1400000-0000-0000-0000-000000000101',
    'b1400000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000002',
    encode(digest('b14-token', 'sha256'), 'hex'),
    'approved',
    now(),
    'email',
    encode(digest('dater@example.test', 'sha256'), 'hex')
  );
  -- H-7 (migration 0039): user 0002 already owns the seed campaign; the
  -- one-active-campaign guard now allows only one published/paused campaign
  -- per owner. This suite records analytics off its own campaign below, so
  -- archive the seed campaign first (an exit transition is always allowed).
  UPDATE public.campaigns SET status = 'archived'
   WHERE owner_user_id = '00000000-0000-0000-0000-000000000002'
     AND status IN ('published', 'paused');

  INSERT INTO public.campaigns (
    id, pitch_draft_id, owner_user_id, status, published_at, slug, ends_at
  ) VALUES (
    'b1400000-0000-0000-0000-000000000201',
    'b1400000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000002',
    'published',
    now(),
    'audit2-b14-campaign',
    now() + INTERVAL '14 days'
  );

  IF NOT EXISTS (
    SELECT 1 FROM public.analytics_events
     WHERE event_name = 'campaign_published'
       AND properties ->> 'campaign_id' = 'b1400000-0000-0000-0000-000000000201'
       AND properties ->> 'recorded_by' = 'server'
  ) THEN
    failures := array_append(failures, 'publish did not record a server event');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.analytics_events
     WHERE event_name = 'pitch_approved'
       AND properties ->> 'pitch_draft_id' = 'b1400000-0000-0000-0000-000000000001'
       AND properties ->> 'recorded_by' = 'server'
  ) THEN
    failures := array_append(failures, 'approval did not record a server event');
  END IF;

  -- Interest submission and acceptance record through the same triggers.
  INSERT INTO public.interests (id, campaign_id, sender_user_id, status, submitted_at)
  VALUES (
    'b1400000-0000-0000-0000-000000000301',
    'b1400000-0000-0000-0000-000000000201',
    '00000000-0000-0000-0000-000000000003',
    'submitted',
    now()
  );
  UPDATE public.interests
     SET status = 'accepted', decided_at = now()
   WHERE id = 'b1400000-0000-0000-0000-000000000301';

  IF NOT EXISTS (
    SELECT 1 FROM public.analytics_events
     WHERE event_name = 'interest_submitted'
       AND properties ->> 'interest_id' = 'b1400000-0000-0000-0000-000000000301'
       AND properties ->> 'recorded_by' = 'server'
  ) THEN
    failures := array_append(failures, 'interest submission was not server-recorded');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.analytics_events
     WHERE event_name = 'interest_accepted'
       AND properties ->> 'interest_id' = 'b1400000-0000-0000-0000-000000000301'
       AND properties ->> 'recorded_by' = 'server'
  ) THEN
    failures := array_append(failures, 'interest acceptance was not server-recorded');
  END IF;

  IF cardinality(failures) > 0 THEN
    RAISE EXCEPTION 'AUDIT2-H-4: %', array_to_string(failures, '; ');
  END IF;
END;
$$;

ROLLBACK;

SELECT 'b14_server_authoritative_analytics.sql passed' AS result;
