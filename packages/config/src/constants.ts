/** Product minimum age. Marketing targets 21-34, but usage minimum is 18+. */
export const MIN_AGE = 18;

/** Voice pitch recording bounds in seconds (FRIENDWORD_HANDOFF.md). */
export const PITCH_AUDIO_MIN_SECONDS = 30;
export const PITCH_AUDIO_MAX_SECONDS = 60;

/** Rendered pitch video bounds in seconds. */
export const PITCH_VIDEO_MIN_SECONDS = 15;
export const PITCH_VIDEO_MAX_SECONDS = 60;

/** Free starter campaign public window in days. */
export const FREE_CAMPAIGN_ACTIVE_DAYS = 14;

/** Campaign Pass active window in days. */
export const CAMPAIGN_PASS_ACTIVE_DAYS = 30;

/** Max approved vouch cards with a Campaign Pass. */
export const CAMPAIGN_PASS_MAX_VOUCHES = 5;

/** Monthly hard cap for total cloud/API spend in USD (docs/COST_MODEL.md). */
export const MONTHLY_CLOUD_SPEND_HARD_CAP_USD = 200;

// Second audit P0-10: version tag of the external-AI processing
// disclosure the introducer affirms before any provider work runs on
// their draft. Bump when the disclosure copy changes materially.
export const AI_PROCESSING_CONSENT_REVISION = '2026-07-13.v1';
