-- 0052: revoke the hosted blanket table ACL and re-state the client grants.
--
-- Hosted Supabase ships ALTER DEFAULT PRIVILEGES that GRANT ALL on every table
-- in schema public to anon and authenticated. No migration ever revoked that,
-- so on a real project every client held full DML on every table and only RLS
-- stood in the way — and RLS does not cover column choice inside a permitted
-- row. Reproduced 2026-07-30 against the local Supabase stack:
--   * a signed-in user UPDATEd their own users.phone_verified_at, forging the
--     identity evidence read by private.assert_identity_evidence (0012, 0030);
--   * authenticated held DELETE on pitch_assets, bypassing every guard in
--     remove_pitch_draft_asset (0046).
-- The sweep below revokes everything from the client roles and grants back
-- only what the client surfaces actually use (packages/data, apps/web,
-- apps/mobile) plus the direct-DML capabilities the DB suite pins as intended
-- (owner accept via UPDATE on interests, trigger-guarded intro_rooms INSERT).
-- service_role is untouched. Sequences: none exist today; the revoke keeps a
-- later SERIAL/IDENTITY column from arriving world-writable.

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;

-- anon holds no table privileges at all. Every no-signup surface (published
-- pitch page, OG image, consent preview, anonymous report, waitlist) reads and
-- writes through the service-role server client or a SECURITY DEFINER RPC.

-- authenticated reads: table-level SELECT, row visibility enforced by RLS.
-- Tables absent from this list (app_config, qa_preview_allowlist, media_*,
-- text_moderations, ops_alerts, pitch_video_ingests, video_moderation_reviews,
-- purchase_event_reviews, referral_claims, waitlist_signups) never had client
-- grants and stay service-only.
GRANT SELECT ON
  users,
  profiles,
  dating_profiles,
  introducer_profiles,
  pitch_drafts,
  pitch_assets,
  consent_requests,
  consent_revisions,
  campaigns,
  campaign_memberships,
  vouches,
  interests,
  intro_rooms,
  messages,
  reports,
  blocks,
  verification_checks,
  purchase_events,
  purchase_credit_ledger,
  campaign_entitlements,
  share_kits,
  ai_processing_consents,
  deletion_requests,
  analytics_events,
  provider_usage_events,
  cost_ledger
TO authenticated;
GRANT SELECT (id, user_id, product_id, scope_type, scope_id, status, created_at, expires_at)
  ON purchase_intents TO authenticated;

-- authenticated writes: column lists mirror what the client code sends.
-- users.phone_verified_at and profiles.verification_status stay out of every
-- client grant on purpose — they are identity evidence, service-role only.
GRANT INSERT (id, preferences),
      UPDATE (preferences)
  ON users TO authenticated;
-- The UPDATE lists for profiles and dating_profiles include the conflict key
-- user_id because PostgREST merge upserts (supabase-js .upsert without
-- ignoreDuplicates: auth.ts confirmed-name bootstrap, interestRepo
-- .saveDatingProfile) compile to
--   ON CONFLICT (user_id) DO UPDATE SET user_id = EXCLUDED.user_id, ...
-- and PostgreSQL checks the DO UPDATE arm's column privileges even when no
-- conflict fires — without the key column both requests fail with 42501.
-- The grant is safe: EXCLUDED.user_id always equals the conflicting key, and
-- the RLS update policies' USING/WITH CHECK (auth.uid() = user_id) reject any
-- attempt to re-point a row at another user (pinned by tests/27).
GRANT INSERT (user_id, display_name, birth_date, locale, display_name_confirmed),
      UPDATE (user_id, display_name, birth_date, locale, display_name_confirmed)
  ON profiles TO authenticated;
GRANT INSERT (user_id, bio, photos, dating_intent, approximate_location),
      UPDATE (user_id, bio, photos, dating_intent, approximate_location)
  ON dating_profiles TO authenticated;
GRANT INSERT (created_by_user_id, headline, body, structure, relationship_type, relationship_duration),
      UPDATE (headline, body, structure, relationship_type, relationship_duration)
  ON pitch_drafts TO authenticated;
-- Registration only; no UPDATE and no DELETE — removal must go through the
-- remove_pitch_draft_asset RPC (0046) so voice/status/uploader guards hold.
GRANT INSERT (pitch_draft_id, uploaded_by_user_id, asset_type, storage_path, sort_order, width, height)
  ON pitch_assets TO authenticated;
-- Owner decides a submitted interest with a plain UPDATE (02_rls pins this);
-- creation is submit_interest-only since the RPC owns eligibility evidence.
GRANT UPDATE (status, decided_at) ON interests TO authenticated;
GRANT INSERT (campaign_id, dater_user_id, interested_user_id) ON intro_rooms TO authenticated;
GRANT INSERT (intro_room_id, sender_user_id, body) ON messages TO authenticated;
GRANT INSERT (reporter_user_id, reported_user_id, campaign_id, reason) ON reports TO authenticated;
GRANT INSERT (blocker_user_id, blocked_user_id) ON blocks TO authenticated;
