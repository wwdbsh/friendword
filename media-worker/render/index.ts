/**
 * The MP4 renderer lives in the web app, not here: the whole point of the
 * chosen architecture (2026-07-29) is that headless Chromium loads the SAME
 * MotionSceneV2 component the web player renders, so the engine has to run
 * where that page is served.
 *
 * - Engine (pure): apps/web/src/lib/pitchRender/renderScene.ts
 * - Capture page:  apps/web/app/internal/render/[revisionId]
 * - Worker route:  apps/web/app/api/media/render-run/route.ts
 *
 * Constraints that did not change:
 * - 9:16 vertical 1080x1920, 15-60s, original introducer voice only (no
 *   waveform-altering filters; AAC copied when possible)
 * - no face video, no generated faces, no voice cloning, no lip-sync
 * - server render runs exactly once, after dater approval (render late)
 * - end card is renderer chrome appended AFTER the approved timeline:
 *   platform constants + canonical campaign URL, never dater-authored text
 */
export {};
