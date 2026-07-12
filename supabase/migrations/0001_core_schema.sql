CREATE TYPE membership_role AS ENUM (
  'DATER_OWNER',
  'INTRODUCER',
  'ADDITIONAL_VOUCHER'
);

CREATE TYPE pitch_draft_status AS ENUM (
  'draft',
  'consent_pending',
  'changes_requested',
  'approved',
  'published',
  'paused',
  'expired',
  'archived',
  'deleted'
);

CREATE TYPE interest_status AS ENUM (
  'started',
  'verification_pending',
  'submitted',
  'accepted',
  'declined',
  'withdrawn',
  'blocked'
);

CREATE TYPE intro_room_status AS ENUM ('open', 'left', 'blocked', 'closed');
CREATE TYPE purchase_scope AS ENUM ('PITCH_DRAFT', 'CAMPAIGN');
CREATE TYPE credit_state AS ENUM ('available', 'reserved', 'consumed', 'refunded');
CREATE TYPE account_status AS ENUM ('active', 'suspended', 'deleted');

CREATE TABLE users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  phone_verified_at TIMESTAMPTZ,
  account_status account_status NOT NULL DEFAULT 'active',
  preferences JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE profiles (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  birth_date DATE,
  locale TEXT NOT NULL DEFAULT 'en',
  verification_status TEXT NOT NULL DEFAULT 'unverified',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE dating_profiles (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  bio TEXT,
  photos TEXT[] NOT NULL DEFAULT '{}',
  dating_intent TEXT,
  approximate_location TEXT,
  profile_updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE introducer_profiles (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  pseudonym TEXT NOT NULL,
  completed_introduction_count INTEGER NOT NULL DEFAULT 0 CHECK (completed_introduction_count >= 0),
  unlocked_customizations JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE pitch_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by_user_id UUID NOT NULL REFERENCES users(id),
  subject_user_id UUID REFERENCES users(id),
  status pitch_draft_status NOT NULL DEFAULT 'draft',
  headline TEXT,
  body TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE pitch_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pitch_draft_id UUID NOT NULL REFERENCES pitch_drafts(id) ON DELETE CASCADE,
  uploaded_by_user_id UUID NOT NULL REFERENCES users(id),
  asset_type TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (pitch_draft_id, storage_path)
);

CREATE TABLE consent_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pitch_draft_id UUID NOT NULL REFERENCES pitch_drafts(id) ON DELETE CASCADE,
  subject_user_id UUID REFERENCES users(id),
  token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending',
  responded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pitch_draft_id UUID NOT NULL UNIQUE REFERENCES pitch_drafts(id),
  owner_user_id UUID NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'paused', 'expired', 'archived')),
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE campaign_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id),
  role membership_role NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'removed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- A relationship supplies the role; one user cannot hold two roles in one campaign.
  UNIQUE (campaign_id, user_id)
);

-- At most one active owner is possible; the deferred ownership trigger below requires one.
CREATE UNIQUE INDEX campaign_memberships_one_active_owner
  ON campaign_memberships (campaign_id)
  WHERE role = 'DATER_OWNER' AND status = 'active';

CREATE TABLE vouches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  author_user_id UUID NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'published',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, author_user_id)
);

CREATE TABLE interests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  sender_user_id UUID NOT NULL REFERENCES users(id),
  status interest_status NOT NULL DEFAULT 'started',
  note TEXT,
  submitted_at TIMESTAMPTZ,
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, sender_user_id)
);

CREATE TABLE intro_rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  dater_user_id UUID NOT NULL REFERENCES users(id),
  interested_user_id UUID NOT NULL REFERENCES users(id),
  status intro_room_status NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (dater_user_id <> interested_user_id),
  UNIQUE (campaign_id, dater_user_id, interested_user_id)
);

CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  intro_room_id UUID NOT NULL REFERENCES intro_rooms(id) ON DELETE CASCADE,
  sender_user_id UUID NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_user_id UUID NOT NULL REFERENCES users(id),
  reported_user_id UUID REFERENCES users(id),
  campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (reported_user_id IS NULL OR reporter_user_id <> reported_user_id)
);

CREATE TABLE blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  blocker_user_id UUID NOT NULL REFERENCES users(id),
  blocked_user_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (blocker_user_id <> blocked_user_id),
  UNIQUE (blocker_user_id, blocked_user_id)
);

CREATE TABLE verification_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  provider TEXT NOT NULL,
  provider_reference TEXT NOT NULL,
  status TEXT NOT NULL,
  risk_signals JSONB NOT NULL DEFAULT '{}'::JSONB,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_reference)
);

CREATE TABLE purchase_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchaser_user_id UUID NOT NULL REFERENCES users(id),
  product_id TEXT NOT NULL,
  scope_type purchase_scope NOT NULL,
  scope_id UUID NOT NULL,
  provider_event_id TEXT NOT NULL UNIQUE,
  purchased_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE purchase_credit_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  credit_state credit_state NOT NULL DEFAULT 'available',
  product_id TEXT NOT NULL,
  pitch_draft_id UUID REFERENCES pitch_drafts(id),
  campaign_id UUID REFERENCES campaigns(id),
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(pitch_draft_id, campaign_id) <= 1)
);

CREATE TABLE campaign_entitlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, product_id)
);

CREATE TABLE analytics_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  event_name TEXT NOT NULL,
  properties JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE provider_usage_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  provider TEXT NOT NULL,
  operation TEXT NOT NULL,
  units NUMERIC(12, 4) NOT NULL DEFAULT 1 CHECK (units >= 0),
  provider_reference TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE cost_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_usage_event_id UUID REFERENCES provider_usage_events(id) ON DELETE SET NULL,
  provider TEXT NOT NULL,
  amount_minor BIGINT NOT NULL CHECK (amount_minor >= 0),
  currency TEXT NOT NULL DEFAULT 'USD',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE FUNCTION validate_campaign_publication()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status = 'published' AND (
    NEW.published_at IS NULL
    OR NOT EXISTS (
      SELECT 1
        FROM pitch_drafts
       WHERE id = NEW.pitch_draft_id
         AND subject_user_id = NEW.owner_user_id
         AND status = 'published'
    )
    OR NOT EXISTS (
      SELECT 1
        FROM consent_requests
       WHERE pitch_draft_id = NEW.pitch_draft_id
         AND subject_user_id = NEW.owner_user_id
         AND status = 'approved'
         AND responded_at IS NOT NULL
    )
  ) THEN
    RAISE EXCEPTION 'published campaign requires published consented pitch content';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER campaigns_validate_publication
BEFORE INSERT OR UPDATE OF status, published_at, pitch_draft_id, owner_user_id ON campaigns
FOR EACH ROW EXECUTE FUNCTION validate_campaign_publication();

CREATE FUNCTION set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'users', 'profiles', 'dating_profiles', 'introducer_profiles',
    'pitch_drafts', 'pitch_assets', 'consent_requests', 'campaigns',
    'campaign_memberships', 'vouches', 'interests', 'intro_rooms',
    'messages', 'reports', 'verification_checks', 'purchase_events',
    'purchase_credit_ledger', 'campaign_entitlements'
  ]
  LOOP
    EXECUTE format(
      'CREATE TRIGGER %I_set_updated_at BEFORE UPDATE ON %I '
      'FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
      table_name,
      table_name
    );
  END LOOP;
END;
$$;

CREATE FUNCTION validate_campaign_owner()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  target_campaign_id UUID;
  second_campaign_id UUID;
  expected_owner_id UUID;
BEGIN
  IF TG_TABLE_NAME = 'campaigns' THEN
    target_campaign_id := COALESCE(NEW.id, OLD.id);
  ELSIF TG_OP = 'INSERT' THEN
    target_campaign_id := NEW.campaign_id;
  ELSIF TG_OP = 'DELETE' THEN
    target_campaign_id := OLD.campaign_id;
  ELSE
    target_campaign_id := OLD.campaign_id;
    IF NEW.campaign_id IS DISTINCT FROM OLD.campaign_id THEN
      second_campaign_id := NEW.campaign_id;
    END IF;
  END IF;

  LOOP
    SELECT owner_user_id
      INTO expected_owner_id
      FROM campaigns
     WHERE id = target_campaign_id;

    IF expected_owner_id IS NOT NULL AND NOT EXISTS (
      SELECT 1
        FROM campaign_memberships
       WHERE campaign_id = target_campaign_id
         AND user_id = expected_owner_id
         AND role = 'DATER_OWNER'
         AND status = 'active'
    ) THEN
      RAISE EXCEPTION 'campaign % owner must match its active DATER_OWNER membership', target_campaign_id;
    END IF;

    EXIT WHEN second_campaign_id IS NULL;
    target_campaign_id := second_campaign_id;
    second_campaign_id := NULL;
  END LOOP;

  RETURN NULL;
END;
$$;

-- Deferred checks let a campaign and its required owner membership be created atomically.
CREATE CONSTRAINT TRIGGER campaigns_validate_owner
AFTER INSERT OR UPDATE OF owner_user_id ON campaigns
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_campaign_owner();

CREATE CONSTRAINT TRIGGER campaign_memberships_validate_owner
AFTER INSERT OR UPDATE OR DELETE ON campaign_memberships
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_campaign_owner();

CREATE FUNCTION validate_purchase_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.scope_type = 'PITCH_DRAFT' AND NOT EXISTS (
    SELECT 1 FROM pitch_drafts
     WHERE id = NEW.scope_id
       AND created_by_user_id = NEW.purchaser_user_id
  ) THEN
    RAISE EXCEPTION 'pitch draft purchase must be made by its creator';
  ELSIF NEW.scope_type = 'CAMPAIGN' AND NOT EXISTS (
    SELECT 1 FROM campaigns
     WHERE id = NEW.scope_id
       AND owner_user_id = NEW.purchaser_user_id
  ) THEN
    RAISE EXCEPTION 'campaign purchase must be made by its owner';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER purchase_events_validate_scope
BEFORE INSERT OR UPDATE OF purchaser_user_id, scope_type, scope_id ON purchase_events
FOR EACH ROW EXECUTE FUNCTION validate_purchase_scope();

CREATE FUNCTION validate_message_sender()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM intro_rooms
     WHERE id = NEW.intro_room_id
       AND NEW.sender_user_id IN (dater_user_id, interested_user_id)
       AND status = 'open'
  ) OR EXISTS (
    SELECT 1
      FROM intro_rooms
      JOIN blocks
        ON (blocks.blocker_user_id = intro_rooms.dater_user_id
            AND blocks.blocked_user_id = intro_rooms.interested_user_id)
        OR (blocks.blocker_user_id = intro_rooms.interested_user_id
            AND blocks.blocked_user_id = intro_rooms.dater_user_id)
     WHERE intro_rooms.id = NEW.intro_room_id
  ) THEN
    RAISE EXCEPTION 'message sender must be an unblocked participant in an open intro room';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER messages_validate_sender
BEFORE INSERT OR UPDATE OF intro_room_id, sender_user_id ON messages
FOR EACH ROW EXECUTE FUNCTION validate_message_sender();

CREATE FUNCTION validate_intro_room_parties()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM campaigns
     WHERE id = NEW.campaign_id
       AND owner_user_id = NEW.dater_user_id
  ) OR NOT EXISTS (
    SELECT 1
      FROM interests
     WHERE campaign_id = NEW.campaign_id
       AND sender_user_id = NEW.interested_user_id
       AND status = 'accepted'
  ) OR EXISTS (
    SELECT 1
      FROM blocks
     WHERE (blocker_user_id = NEW.dater_user_id AND blocked_user_id = NEW.interested_user_id)
        OR (blocker_user_id = NEW.interested_user_id AND blocked_user_id = NEW.dater_user_id)
  ) THEN
    RAISE EXCEPTION 'intro room requires the campaign owner, an accepted interest, and unblocked parties';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER intro_rooms_validate_parties
BEFORE INSERT OR UPDATE OF campaign_id, dater_user_id, interested_user_id ON intro_rooms
FOR EACH ROW EXECUTE FUNCTION validate_intro_room_parties();
