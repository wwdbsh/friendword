-- Three corrections to 0050, all found by executing the exploit rather than
-- reading the file (2026-07-30, against a local Supabase stack).
--
-- 1. THE INGEST RPCs WERE ANONYMOUSLY CALLABLE. 0050 wrote
--    `REVOKE ALL ON FUNCTION ... FROM PUBLIC` and read as service-role only. It
--    is not: hosted Supabase installs
--
--      ALTER DEFAULT PRIVILEGES IN SCHEMA public
--        GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
--
--    so every function created in schema public carries an EXPLICIT grant to
--    anon and authenticated, and an explicit grant is untouched by a revoke
--    aimed at PUBLIC. Confirmed on the running stack: anon held EXECUTE on all
--    four RPCs and could claim another worker's job, report a forged 'succeeded'
--    without running ffmpeg at all, list the moderation review queue, and
--    resolve a human moderation decision. 0035:430 already had the right form —
--    `FROM PUBLIC, anon, authenticated` — and the same audit found five older
--    service-role RPCs written with the weaker one, including the RevenueCat
--    webhook sink and the erasure RPC. All of them are corrected here; every
--    caller in the repo uses the service key (apps/web/app/api/revenuecat/route.ts,
--    scripts/process-deletions.mjs, scripts/scrub-review-payloads.mjs), so no
--    legitimate path loses anything.
--
--    supabase/tests/helpers/auth_stub.sql now installs those default privileges,
--    because a harness that grants less than production makes this whole class of
--    bug invisible.
--
-- 2. A CLIP COULD NAME ANOTHER DRAFT'S BYTES. pitch_assets.storage_path was free
--    text, so a creator could insert a row on THEIR OWN draft carrying a victim's
--    prefix. The ingest worker trusts that path completely: it downloads the
--    object, writes the derivatives under the attacker's prefix, and on success
--    DELETES THE ORIGINAL — a private clip copied and destroyed through an
--    ordinary insert. The same row shape leaks a photo, which the consent surface
--    signs by storage_path.
--
-- 3. A REMOVED FLAG LEFT NOTHING BEHIND. video_moderation_reviews cascades with
--    its asset, and 0050 deliberately lets an introducer remove a flagged clip,
--    so the record that anything was ever flagged left with it. Low severity —
--    the fix is a trace on the ops surface, not a new lifecycle.

-- ── 1. Service-role-only EXECUTE, spelled out by role ───────────────────
-- Naming the roles is the whole fix: these functions are SECURITY DEFINER, so an
-- EXECUTE grant is the only thing standing between an anonymous request and the
-- worker's own authority.
REVOKE ALL ON FUNCTION public.claim_media_ingest_job(INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_media_ingest_job(INTEGER) TO service_role;

REVOKE ALL ON FUNCTION public.complete_media_ingest_job(
  UUID, UUID, TEXT, TEXT, TEXT, INTEGER, INTEGER, INTEGER, JSONB, BOOLEAN, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_media_ingest_job(
  UUID, UUID, TEXT, TEXT, TEXT, INTEGER, INTEGER, INTEGER, JSONB, BOOLEAN, TEXT
) TO service_role;

REVOKE ALL ON FUNCTION public.list_pending_video_reviews(INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_pending_video_reviews(INTEGER) TO service_role;

REVOKE ALL ON FUNCTION public.resolve_video_moderation_review(UUID, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_video_moderation_review(UUID, TEXT, TEXT)
  TO service_role;

-- The same leak, in the service-role RPCs that predate this migration. Each one
-- was written `FROM PUBLIC` and each one was anon-callable on hosted: a forged
-- purchase webhook, a scrub of review payloads, a storage-owner reassignment, a
-- creator credit consumed by nobody, and the erasure of any draft by id.
REVOKE ALL ON FUNCTION public.record_revenuecat_event(JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_revenuecat_event(JSONB) TO service_role;

REVOKE ALL ON FUNCTION public.scrub_resolved_purchase_review_payloads(INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.scrub_resolved_purchase_review_payloads(INTEGER)
  TO service_role;

REVOKE ALL ON FUNCTION public.reassign_pitch_storage_owner(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reassign_pitch_storage_owner(UUID, UUID) TO service_role;

REVOKE ALL ON FUNCTION public.consume_creator_credit(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_creator_credit(UUID) TO service_role;

REVOKE ALL ON FUNCTION public.erase_pitch_draft(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.erase_pitch_draft(UUID) TO service_role;

-- Reserve/release stay callable by a signed-in creator (0039) — they read
-- auth.uid() — but never by anon.
REVOKE ALL ON FUNCTION public.reserve_creator_credit(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reserve_creator_credit(UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.release_creator_credit(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.release_creator_credit(UUID) TO authenticated;

-- ── 2. storage_path belongs to its own draft ────────────────────────────
-- Two accepted shapes, and the asymmetry is deliberate:
--
--   'pitch-media/<draft>/<name>'  the canonical form buildPitchMediaPath writes
--                                 (packages/data/src/pitchDraftRepo.ts) and the
--                                 only one the ingest worker can split into
--                                 bucket and object (apps/web/src/lib/clipIngest/
--                                 pipeline.ts refuses anything else), so a VIDEO
--                                 must be in it
--   '<draft>/<name>'              the bucket-less form that predates
--                                 buildPitchMediaPath. Live rows do not use it,
--                                 but tests 05, 12, 13 and 22 are written in it
--                                 and the five read paths that strip the bucket
--                                 (0016:616, 0030:98, 0036:66, 0048:447,
--                                 0049:1258) all still tolerate it. Refusing it
--                                 would be a rewrite of four suites for no
--                                 security gain: those rows already name their
--                                 OWN draft, which is the entire property under
--                                 protection here.
--
-- '..' is refused in both, so "under the prefix" cannot be walked back out of by
-- a path that also reaches ffmpeg and a filesystem.
--
-- VALID rather than NOT VALID, following the asset_type CHECK in 0050:63: every
-- writer in the repo produces the canonical form, so a hosted row that fails this
-- is a row pointing at bytes it does not own — something this migration should
-- refuse to deploy over rather than tolerate.
ALTER TABLE public.pitch_assets
  ADD CONSTRAINT pitch_assets_storage_path_is_own_draft CHECK (
    position('..' IN storage_path) = 0
    AND (
      storage_path LIKE 'pitch-media/' || pitch_draft_id::TEXT || '/%'
      OR (
        asset_type <> 'video'
        AND storage_path LIKE pitch_draft_id::TEXT || '/%'
      )
    )
  );

COMMENT ON COLUMN public.pitch_assets.storage_path IS
  'Object path under this draft''s own pitch-media prefix, enforced by pitch_assets_storage_path_is_own_draft. A video must carry the bucket prefix (pitch-media/<draft>/...), because that path is what the ingest worker downloads, transcodes and — on success — deletes.';

-- ── 3. A removed review leaves its flag on the ops surface ──────────────
-- The uploader is stamped at INSERT rather than looked up at DELETE: by the time
-- the cascade from pitch_assets reaches this row, the asset it would have to join
-- is already gone. A trigger rather than a rewrite of complete_media_ingest_job,
-- so the identifier is captured on every writer including a hand-written service
-- query.
ALTER TABLE public.video_moderation_reviews
  ADD COLUMN uploaded_by_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.video_moderation_reviews.uploaded_by_user_id IS
  'Who registered the flagged clip, copied from pitch_assets at insert. Kept so a flag that is deleted with its asset can still name an account; NULL after the account is erased, which is the erasure contract winning over moderation history.';

CREATE FUNCTION private.stamp_video_moderation_review_uploader()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  NEW.uploaded_by_user_id := (
    SELECT uploaded_by_user_id FROM public.pitch_assets WHERE id = NEW.asset_id
  );
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.stamp_video_moderation_review_uploader()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER video_moderation_reviews_stamp_uploader
BEFORE INSERT ON public.video_moderation_reviews
FOR EACH ROW EXECUTE FUNCTION private.stamp_video_moderation_review_uploader();

UPDATE public.video_moderation_reviews review
   SET uploaded_by_user_id = asset.uploaded_by_user_id
  FROM public.pitch_assets asset
 WHERE asset.id = review.asset_id;

-- ops_alerts is the surface a human already watches, and it holds no reference to
-- the asset, so nothing takes this row away with the clip.
CREATE FUNCTION private.record_video_moderation_review_deletion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  -- Erasure wins. erase_pitch_draft (0018) deletes the draft with
  -- friendword.erasure set, and that cascade reaches this row: writing the
  -- uploader's id and the evidence path into ops_alerts there would copy the
  -- identifiers an erasure request exists to remove into a table nothing scrubs.
  -- An erased account has no next strike to catch, which is the whole purpose of
  -- the trace. Same transaction-local flag the consent-revision guard reads.
  IF coalesce(current_setting('friendword.erasure', true), '') = 'on' THEN
    RETURN OLD;
  END IF;

  INSERT INTO public.ops_alerts (alert_type, campaign_id, detail)
  VALUES (
    'video_moderation_review_deleted',
    (SELECT id FROM public.campaigns WHERE pitch_draft_id = OLD.pitch_draft_id),
    jsonb_build_object(
      'pitch_asset_id', OLD.asset_id,
      'pitch_draft_id', OLD.pitch_draft_id,
      'uploaded_by_user_id', OLD.uploaded_by_user_id,
      'flagged_reason', OLD.flagged_reason,
      'disposition', OLD.disposition,
      'evidence_storage_path', OLD.evidence_storage_path,
      'flagged_at', OLD.created_at,
      'resolved_at', OLD.resolved_at
    )
  );
  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION private.record_video_moderation_review_deletion()
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION private.record_video_moderation_review_deletion() IS
  'Copies a moderation review''s identifiers to ops_alerts as the row disappears. Without it, removing the flagged clip — which the introducer is allowed to do — also removes the evidence that the account was ever flagged, so a second strike would read as a first.';

CREATE TRIGGER video_moderation_reviews_record_deletion
BEFORE DELETE ON public.video_moderation_reviews
FOR EACH ROW EXECUTE FUNCTION private.record_video_moderation_review_deletion();
