/**
 * Render entry point placeholder. The renderer choice (Remotion vs FFmpeg),
 * its latency, and per-render cost are an open decision tracked in
 * docs/DECISIONS.md. Constraints that will not change:
 * - 9:16 vertical, 15-60s, original introducer voice only
 * - no face video, no generated faces, no voice cloning, no lip-sync
 * - server render runs exactly once, after dater approval (render late)
 */
export {};
