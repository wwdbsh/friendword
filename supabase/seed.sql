-- Local development only: these rows directly seed Supabase Auth with fixed identities.
BEGIN;

-- Local test databases opt into the launch gates (0023) so the suites can
-- exercise interest and purchase flows. Hosted never runs seed.sql: there
-- the gates stay 'off' until the second-audit Slice 10 release gate.
UPDATE app_config
   SET value = 'on'
 WHERE key IN ('real_payments_enabled', 'public_beta_enabled');

INSERT INTO auth.users (id, email)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'introducer@example.test'),
  ('00000000-0000-0000-0000-000000000002', 'dater@example.test'),
  ('00000000-0000-0000-0000-000000000003', 'interested@example.test'),
  ('00000000-0000-0000-0000-000000000004', 'draft-introducer@example.test');

INSERT INTO users (id, phone_verified_at)
VALUES
  ('00000000-0000-0000-0000-000000000001', now() - INTERVAL '30 days'),
  ('00000000-0000-0000-0000-000000000002', now() - INTERVAL '29 days'),
  ('00000000-0000-0000-0000-000000000003', now() - INTERVAL '10 days'),
  ('00000000-0000-0000-0000-000000000004', now() - INTERVAL '2 days');

INSERT INTO profiles (user_id, display_name, birth_date, locale, verification_status)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'Alex Introducer', '1992-04-12', 'en', 'verified'),
  ('00000000-0000-0000-0000-000000000002', 'Blair Dater', '1993-08-20', 'en', 'verified'),
  ('00000000-0000-0000-0000-000000000003', 'Casey Interested', '1994-01-15', 'en', 'verified'),
  ('00000000-0000-0000-0000-000000000004', 'Drew Introducer', '1991-11-02', 'en', 'verified');

INSERT INTO dating_profiles (user_id, bio, photos, dating_intent, approximate_location)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'Coffee and long walks.', ARRAY['local/alex.jpg'], 'long-term', 'Seoul'),
  ('00000000-0000-0000-0000-000000000002', 'Kind, curious, and always cooking.', ARRAY['local/blair.jpg'], 'long-term', 'Seoul'),
  ('00000000-0000-0000-0000-000000000003', 'Museum fan and weekend cyclist.', ARRAY['local/casey.jpg'], 'long-term', 'Seoul');

INSERT INTO introducer_profiles (user_id, pseudonym, completed_introduction_count)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'Friend A', 1),
  ('00000000-0000-0000-0000-000000000004', 'Friend D', 0);

INSERT INTO pitch_drafts (
  id,
  created_by_user_id,
  subject_user_id,
  status,
  headline,
  body
)
VALUES
  (
    '10000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000002',
    'published',
    'Meet my wonderful friend Blair',
    'I have known Blair for years and trust their kindness.'
  ),
  (
    '10000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000004',
    '00000000-0000-0000-0000-000000000001',
    'draft',
    'Draft introduction for Alex',
    'Still gathering the best stories.'
  );

INSERT INTO consent_requests (
  id,
  pitch_draft_id,
  subject_user_id,
  token_hash,
  status,
  responded_at
)
VALUES (
  '11000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002',
  'local-approved-consent-token-hash',
  'approved',
  now() - INTERVAL '7 days'
);

INSERT INTO campaigns (id, pitch_draft_id, owner_user_id, status, published_at)
VALUES
  (
    '20000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000002',
    'published',
    now() - INTERVAL '6 days'
  ),
  (
    '20000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000001',
    'draft',
    NULL
  );

INSERT INTO campaign_memberships (campaign_id, user_id, role)
VALUES
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', 'DATER_OWNER'),
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'INTRODUCER'),
  ('20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'DATER_OWNER'),
  ('20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000004', 'INTRODUCER');

INSERT INTO interests (
  id,
  campaign_id,
  sender_user_id,
  status,
  note,
  submitted_at,
  decided_at
)
VALUES (
  '30000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000003',
  'accepted',
  'I would love an introduction.',
  now() - INTERVAL '3 days',
  now() - INTERVAL '2 days'
);

INSERT INTO intro_rooms (
  id,
  campaign_id,
  dater_user_id,
  interested_user_id,
  status
)
VALUES (
  '40000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000003',
  'open'
);

INSERT INTO messages (id, intro_room_id, sender_user_id, body, created_at)
VALUES
  (
    '50000000-0000-0000-0000-000000000001',
    '40000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000002',
    'Hi Casey, nice to meet you!',
    now() - INTERVAL '1 day'
  ),
  (
    '50000000-0000-0000-0000-000000000002',
    '40000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000003',
    'Hi Blair, likewise!',
    now() - INTERVAL '23 hours'
  );

COMMIT;
