// The render path's time budgets, in ONE place (T014).
//
// Why a module and not three literals: every one of these numbers is defined
// RELATIVE to the platform's invocation ceiling, and the relations between
// them are what keeps a render honest. Scattered across two routes and a
// worker they drifted silently — the bench kept 30s of margin, the worker kept
// 40s, and nothing anywhere proved either still held. timeBudget.test.ts now
// asserts the RELATIONS, so raising the ceiling can never again leave a budget
// behind at the old one.
//
// The one number that cannot live here is `export const maxDuration` itself:
// Next.js statically analyses route segment config and rejects a non-literal.
// So each route keeps its literal and the relation test asserts the literal
// equals RENDER_MAX_DURATION_SECONDS — the duplication is pinned, not trusted.
//
// Production context (Issue #3): on Vercel Hobby's 1 vCPU the capture ran at
// ~4.2fps, so the 1,845-frame worst case aborted honestly at ~1,130 frames
// inside a 270s budget. The instance moved to Vercel Pro + Performance
// (4GB / 2 vCPU) and Fluid's ceiling there is 800s, which is what these
// budgets now spend.

/**
 * The Fluid-compute invocation ceiling on Pro. Both render routes declare this
 * as their `maxDuration`; ingest-run is deliberately NOT changed — its pass
 * budget is 150s and it has no reason to hold an instance longer.
 */
export const RENDER_MAX_DURATION_SECONDS = 800;

export const RENDER_MAX_DURATION_MS = RENDER_MAX_DURATION_SECONDS * 1_000;

/**
 * Margin between a budget and the platform kill. It does NOT scale with the
 * ceiling: what it absorbs is fixed overhead — module cold start before the
 * pass clock starts, the JSON response, and the platform's own kill jitter —
 * not anything proportional to how long the render ran.
 */
export const BENCH_SAFETY_MARGIN_MS = 30_000;

/**
 * The worker keeps MORE margin than the bench because it has further to fall:
 * a bench that overruns loses a measurement, a worker that overruns loses a
 * user's render AND leaves the job to lease-expiry limbo with no ops alert.
 */
export const WORKER_SAFETY_MARGIN_MS = 40_000;

/** Abort the bench capture here, leaving BENCH_SAFETY_MARGIN_MS under the kill. */
export const BENCH_TIME_BUDGET_MS = RENDER_MAX_DURATION_MS - BENCH_SAFETY_MARGIN_MS;

/** Everything — render, upload, completion — inside the route's ceiling. */
export const WORKER_HARD_BUDGET_MS = RENDER_MAX_DURATION_MS - WORKER_SAFETY_MARGIN_MS;

/** Upload + completion must land while the lease is still held. */
export const COMPLETION_MARGIN_MS = 30_000;

/** Below this there is no point launching Chromium at all: fail before starting. */
export const MIN_START_BUDGET_MS = 15_000;

/**
 * Stop CLAIMING once this much of the pass has elapsed. Deliberately unchanged
 * by the ceiling raise: its job is to keep a pass from claiming work it cannot
 * finish, and the pass-end self-kick (render-run route) chains another pass for
 * whatever is still queued — so a wider window buys throughput the queue
 * already has, at the cost of two renders sharing one instance's memory.
 */
export const DEFAULT_CLAIM_WINDOW_MS = 90_000;

/**
 * Lease length requested at claim time. 0054 clamps this to [60, 3600] and
 * defaults to 900 itself, so this value must stay inside that range.
 */
export const DEFAULT_LEASE_SECONDS = 900;

/** 0054: `least(greatest(coalesce(lease_seconds, 900), 60), 3600)`. */
export const LEASE_SECONDS_FLOOR = 60;
export const LEASE_SECONDS_CEILING = 3_600;

/**
 * The lease deadline comes from POSTGRES's clock; the hard budget is measured
 * on the INSTANCE's. When the two disagree the worker takes the earlier one and
 * can refuse to start a render it actually had time for, so the lease must
 * cover the whole hard budget plus room for skew. At 260s of budget this was
 * slack nobody had to think about; at 760s it is 140s, which is why it is
 * asserted rather than assumed.
 */
export const LEASE_CLOCK_SKEW_MARGIN_MS = 60_000;
