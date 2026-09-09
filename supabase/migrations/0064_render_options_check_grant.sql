-- 0064: let the roles that write media_render_jobs evaluate its CHECK.
--
-- 0063 added `CHECK (private.render_options_are_valid(options))` and revoked
-- the function from PUBLIC without granting it back to anyone. A CHECK runs
-- as the role performing the write, so every direct UPDATE by service_role
-- (the render worker's recordRenderJobCut, 0063-era) failed on hosted with
-- `42501 permission denied for function render_options_are_valid` — the
-- worker reported it as "lease no longer holds" and the first production
-- highlight render failed three times (job 6fe55a1d…, 2026-09-09). The
-- SECURITY DEFINER RPCs (request/claim/complete) never hit it because they
-- run as the migration owner, which is why the harness stayed green.
--
-- The function is IMMUTABLE and side-effect free; executing it grants no
-- data access. anon stays revoked (it never writes the table).

GRANT EXECUTE ON FUNCTION private.render_options_are_valid(JSONB) TO service_role, authenticated;
