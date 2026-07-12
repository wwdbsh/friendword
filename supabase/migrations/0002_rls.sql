CREATE SCHEMA private;

REVOKE ALL ON SCHEMA private FROM PUBLIC;

CREATE FUNCTION private.is_campaign_member(target_campaign_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
     FROM campaign_memberships
     WHERE campaign_id = target_campaign_id
       AND user_id = auth.uid()
       AND status = 'active'
  );
$$;

CREATE FUNCTION private.is_campaign_owner(target_campaign_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM campaigns
     WHERE id = target_campaign_id
       AND owner_user_id = auth.uid()
  );
$$;

CREATE FUNCTION private.is_intro_room_participant(target_room_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM intro_rooms
     WHERE id = target_room_id
       AND auth.uid() IN (dater_user_id, interested_user_id)
       AND status = 'open'
       AND NOT EXISTS (
         SELECT 1
           FROM blocks
          WHERE (blocker_user_id = intro_rooms.dater_user_id
                 AND blocked_user_id = intro_rooms.interested_user_id)
             OR (blocker_user_id = intro_rooms.interested_user_id
                 AND blocked_user_id = intro_rooms.dater_user_id)
       )
  );
$$;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA private TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.is_campaign_member(UUID) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.is_campaign_owner(UUID) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.is_intro_room_participant(UUID) TO anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION validate_intro_room_parties() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION validate_message_sender() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION validate_campaign_publication() FROM PUBLIC;

GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO service_role;
GRANT INSERT (id, preferences), UPDATE (preferences) ON users TO authenticated;
GRANT INSERT (user_id, display_name, birth_date, locale),
      UPDATE (display_name, birth_date, locale) ON profiles TO authenticated;
GRANT INSERT (user_id, bio, photos, dating_intent, approximate_location),
      UPDATE (bio, photos, dating_intent, approximate_location) ON dating_profiles TO authenticated;
GRANT INSERT (user_id, pseudonym), UPDATE (pseudonym) ON introducer_profiles TO authenticated;
GRANT INSERT, UPDATE ON pitch_drafts TO authenticated;
GRANT INSERT ON pitch_assets TO authenticated;
GRANT UPDATE (status, published_at) ON campaigns TO authenticated;
GRANT INSERT (campaign_id, author_user_id, body), UPDATE (body) ON vouches TO authenticated;
GRANT INSERT (campaign_id, sender_user_id, note),
      UPDATE (status, decided_at) ON interests TO authenticated;
GRANT INSERT (campaign_id, dater_user_id, interested_user_id) ON intro_rooms TO authenticated;
GRANT INSERT (intro_room_id, sender_user_id, body) ON messages TO authenticated;
GRANT INSERT (reporter_user_id, reported_user_id, campaign_id, reason) ON reports TO authenticated;
GRANT INSERT (blocker_user_id, blocked_user_id) ON blocks TO authenticated;

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE dating_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE introducer_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE pitch_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE pitch_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE consent_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE vouches ENABLE ROW LEVEL SECURITY;
ALTER TABLE interests ENABLE ROW LEVEL SECURITY;
ALTER TABLE intro_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE verification_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_credit_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_usage_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE cost_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY users_select_own ON users
  FOR SELECT USING (auth.uid() = id);
CREATE POLICY users_insert_own ON users
  FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY users_update_own ON users
  FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

CREATE POLICY profiles_select_own ON profiles
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY profiles_insert_own ON profiles
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY profiles_update_own ON profiles
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY dating_profiles_select_own ON dating_profiles
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY dating_profiles_insert_own ON dating_profiles
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY dating_profiles_update_own ON dating_profiles
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY introducer_profiles_select_own ON introducer_profiles
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY introducer_profiles_insert_own ON introducer_profiles
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY introducer_profiles_update_own ON introducer_profiles
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY pitch_drafts_select_participants ON pitch_drafts
  FOR SELECT USING (auth.uid() IN (created_by_user_id, subject_user_id));
CREATE POLICY pitch_drafts_insert_creators ON pitch_drafts
  FOR INSERT WITH CHECK (auth.uid() = created_by_user_id AND status = 'draft');
CREATE POLICY pitch_drafts_update_creators ON pitch_drafts
  FOR UPDATE
  USING (auth.uid() = created_by_user_id AND status IN ('draft', 'consent_pending'))
  WITH CHECK (auth.uid() = created_by_user_id AND status IN ('draft', 'consent_pending'));

CREATE POLICY pitch_assets_select_participants ON pitch_assets
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM pitch_drafts
       WHERE pitch_drafts.id = pitch_assets.pitch_draft_id
         AND auth.uid() IN (pitch_drafts.created_by_user_id, pitch_drafts.subject_user_id)
    )
  );
CREATE POLICY pitch_assets_insert_creators ON pitch_assets
  FOR INSERT WITH CHECK (
    auth.uid() = uploaded_by_user_id
    AND EXISTS (
      SELECT 1 FROM pitch_drafts
       WHERE pitch_drafts.id = pitch_assets.pitch_draft_id
         AND pitch_drafts.created_by_user_id = auth.uid()
         AND pitch_drafts.status IN ('draft', 'consent_pending')
    )
  );

CREATE POLICY consent_requests_select_participants ON consent_requests
  FOR SELECT USING (
    auth.uid() = subject_user_id
    OR EXISTS (
      SELECT 1 FROM pitch_drafts
       WHERE pitch_drafts.id = consent_requests.pitch_draft_id
         AND pitch_drafts.created_by_user_id = auth.uid()
    )
  );
CREATE POLICY campaigns_select_members ON campaigns
  FOR SELECT USING (private.is_campaign_member(id));
CREATE POLICY campaigns_update_owners ON campaigns
  FOR UPDATE
  USING (owner_user_id = auth.uid())
  WITH CHECK (owner_user_id = auth.uid());

CREATE POLICY campaign_memberships_select_own ON campaign_memberships
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY vouches_select_members ON vouches
  FOR SELECT USING (private.is_campaign_member(campaign_id));
CREATE POLICY vouches_insert_authors ON vouches
  FOR INSERT WITH CHECK (
    author_user_id = auth.uid()
    AND private.is_campaign_member(campaign_id)
  );
CREATE POLICY vouches_update_authors ON vouches
  FOR UPDATE
  USING (author_user_id = auth.uid() AND private.is_campaign_member(campaign_id))
  WITH CHECK (author_user_id = auth.uid() AND private.is_campaign_member(campaign_id));

CREATE POLICY interests_select_parties ON interests
  FOR SELECT USING (
    sender_user_id = auth.uid()
    OR private.is_campaign_owner(campaign_id)
  );
CREATE POLICY interests_insert_senders ON interests
  FOR INSERT WITH CHECK (
    sender_user_id = auth.uid()
    AND status = 'started'
    AND submitted_at IS NULL
    AND decided_at IS NULL
  );
CREATE POLICY interests_update_owners ON interests
  FOR UPDATE
  USING (private.is_campaign_owner(campaign_id) AND status = 'submitted')
  WITH CHECK (
    private.is_campaign_owner(campaign_id)
    AND status IN ('accepted', 'declined')
    AND decided_at IS NOT NULL
  );

CREATE POLICY intro_rooms_select_participants ON intro_rooms
  FOR SELECT USING (private.is_intro_room_participant(id));
CREATE POLICY intro_rooms_insert_participants ON intro_rooms
  FOR INSERT WITH CHECK (
    status = 'open'
    AND auth.uid() IN (dater_user_id, interested_user_id)
  );

CREATE POLICY messages_select_participants ON messages
  FOR SELECT USING (private.is_intro_room_participant(intro_room_id));
CREATE POLICY messages_insert_participants ON messages
  FOR INSERT WITH CHECK (
    sender_user_id = auth.uid()
    AND private.is_intro_room_participant(intro_room_id)
  );

CREATE POLICY reports_select_reporters ON reports
  FOR SELECT USING (reporter_user_id = auth.uid());
CREATE POLICY reports_insert_reporters ON reports
  FOR INSERT WITH CHECK (reporter_user_id = auth.uid());

CREATE POLICY blocks_select_blockers ON blocks
  FOR SELECT USING (blocker_user_id = auth.uid());
CREATE POLICY blocks_insert_blockers ON blocks
  FOR INSERT WITH CHECK (blocker_user_id = auth.uid());
