-- AUDIT2 REGRESSION: P0-7, 감사 §3 invite contact 서버 invariant.
BEGIN;

DO $$
BEGIN
  -- 0048 replaced the 4-arg function with a 5-arg one whose new_scene defaults
  -- to NULL; the shorter call sites below still resolve to it.
  IF to_regprocedure('public.submit_pitch_for_consent(uuid,text,text,text,jsonb)') IS NULL THEN
    RAISE EXCEPTION
      'AUDIT2-P0-7: submit_pitch_for_consent(uuid,text,text,text,jsonb) RPC missing';
  END IF;
  IF to_regprocedure('public.claim_consent_request(text)') IS NULL THEN
    RAISE EXCEPTION 'AUDIT2-P0-7: claim_consent_request(text) RPC missing';
  END IF;
END;
$$;

INSERT INTO public.pitch_drafts (
  id, created_by_user_id, status, headline, body
) VALUES
  (
    'b0500000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000004',
    'draft',
    'Missing contact',
    'A first consent request must bind a verified contact.'
  ),
  (
    'b0500000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000004',
    'draft',
    'Partial contact A',
    'Channel without contact must fail.'
  ),
  (
    'b0500000-0000-0000-0000-000000000003',
    '00000000-0000-0000-0000-000000000004',
    'draft',
    'Partial contact B',
    'Contact without channel must fail.'
  ),
  (
    'b0500000-0000-0000-0000-000000000004',
    '00000000-0000-0000-0000-000000000004',
    'consent_pending',
    'Legacy unbound request',
    'Token possession alone must not claim this request.'
  ),
  (
    'b0500000-0000-0000-0000-000000000005',
    '00000000-0000-0000-0000-000000000004',
    'consent_pending',
    'Phone request',
    'Phone claim stays fail-closed until verified phone binding exists.'
  ),
  (
    'b0500000-0000-0000-0000-000000000006',
    '00000000-0000-0000-0000-000000000004',
    'changes_requested',
    'Bound resubmission',
    'A bound changes request can preserve its existing contact.'
  ),
  (
    'b0500000-0000-0000-0000-000000000007',
    '00000000-0000-0000-0000-000000000004',
    'changes_requested',
    'Unbound resubmission',
    'An unbound legacy request cannot bypass the new invariant.'
  ),
  (
    'b0500000-0000-0000-0000-000000000008',
    '00000000-0000-0000-0000-000000000004',
    'draft',
    'Canonical email request',
    'Email matching is case-insensitive and whitespace-normalized.'
  );

-- Legacy rows predate the 0029 binding trigger; recreate that state by
-- inserting with the trigger disabled (superuser test harness only).
ALTER TABLE public.consent_requests DISABLE TRIGGER consent_requests_contact_binding;
INSERT INTO public.consent_requests (
  id,
  pitch_draft_id,
  token_hash,
  status,
  invite_contact_channel,
  invite_contact_hash
) VALUES
  (
    'b0500000-0000-0000-0000-000000000104',
    'b0500000-0000-0000-0000-000000000004',
    encode(digest('audit2-legacy-token', 'sha256'), 'hex'),
    'pending',
    NULL,
    NULL
  ),
  (
    'b0500000-0000-0000-0000-000000000105',
    'b0500000-0000-0000-0000-000000000005',
    encode(digest('audit2-phone-token', 'sha256'), 'hex'),
    'pending',
    'phone',
    encode(digest('01012345678', 'sha256'), 'hex')
  ),
  (
    'b0500000-0000-0000-0000-000000000106',
    'b0500000-0000-0000-0000-000000000006',
    encode(digest('audit2-bound-resubmit', 'sha256'), 'hex'),
    'claimed',
    'email',
    encode(digest('dater@example.test', 'sha256'), 'hex')
  ),
  (
    'b0500000-0000-0000-0000-000000000107',
    'b0500000-0000-0000-0000-000000000007',
    encode(digest('audit2-unbound-resubmit', 'sha256'), 'hex'),
    'pending',
    NULL,
    NULL
  );
ALTER TABLE public.consent_requests ENABLE TRIGGER consent_requests_contact_binding;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);

DO $$
DECLARE
  failures TEXT[] := ARRAY[]::TEXT[];
  rejected BOOLEAN;
  preserved_hash TEXT;
  canonical_token TEXT;
BEGIN
  rejected := false;
  BEGIN
    PERFORM * FROM public.submit_pitch_for_consent(
      'b0500000-0000-0000-0000-000000000001', NULL, NULL, NULL
    );
  EXCEPTION WHEN OTHERS THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    failures := array_append(failures, 'first submit accepted null channel+contact');
  END IF;

  rejected := false;
  BEGIN
    PERFORM * FROM public.submit_pitch_for_consent(
      'b0500000-0000-0000-0000-000000000002', 'email', NULL, NULL
    );
  EXCEPTION WHEN OTHERS THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    failures := array_append(failures, 'channel without contact was accepted');
  END IF;

  rejected := false;
  BEGIN
    PERFORM * FROM public.submit_pitch_for_consent(
      'b0500000-0000-0000-0000-000000000003', NULL, 'dater@example.test', NULL
    );
  EXCEPTION WHEN OTHERS THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    failures := array_append(failures, 'contact without channel was accepted');
  END IF;

  -- A contact-bound changes request may omit contact and preserve the binding.
  PERFORM * FROM public.submit_pitch_for_consent(
    'b0500000-0000-0000-0000-000000000006', NULL, NULL, NULL
  );
  SELECT invite_contact_hash INTO preserved_hash
    FROM public.consent_requests
   WHERE id = 'b0500000-0000-0000-0000-000000000106';
  IF preserved_hash IS DISTINCT FROM encode(digest('dater@example.test', 'sha256'), 'hex') THEN
    failures := array_append(failures, 'bound resubmission did not preserve contact hash');
  END IF;

  rejected := false;
  BEGIN
    PERFORM * FROM public.submit_pitch_for_consent(
      'b0500000-0000-0000-0000-000000000007', NULL, NULL, NULL
    );
  EXCEPTION WHEN OTHERS THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    failures := array_append(failures, 'unbound changes request omitted contact');
  END IF;

  SELECT consent_token INTO canonical_token
    FROM public.submit_pitch_for_consent(
      'b0500000-0000-0000-0000-000000000008',
      'email',
      '  DATER@EXAMPLE.TEST  ',
      'Canonical Dater'
    );

  PERFORM set_config(
    'request.jwt.claim.sub',
    '00000000-0000-0000-0000-000000000003',
    true
  );
  rejected := false;
  BEGIN
    PERFORM * FROM public.claim_consent_request('audit2-legacy-token');
  EXCEPTION WHEN OTHERS THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    failures := array_append(failures, 'legacy contactless token was claimable');
  END IF;

  rejected := false;
  BEGIN
    PERFORM * FROM public.claim_consent_request('audit2-phone-token');
  EXCEPTION WHEN OTHERS THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    failures := array_append(failures, 'phone invite claim did not fail closed');
  END IF;

  PERFORM set_config(
    'request.jwt.claim.sub',
    '00000000-0000-0000-0000-000000000002',
    true
  );
  IF NOT EXISTS (
    SELECT 1 FROM public.claim_consent_request(canonical_token)
     WHERE pitch_draft_id = 'b0500000-0000-0000-0000-000000000008'
  ) THEN
    failures := array_append(failures, 'canonical-equivalent email could not claim');
  END IF;

  IF cardinality(failures) > 0 THEN
    RAISE EXCEPTION 'AUDIT2-P0-7: %', array_to_string(failures, '; ');
  END IF;
END;
$$;

ROLLBACK;

SELECT 'b05_contact_binding_invariant.sql passed' AS result;
