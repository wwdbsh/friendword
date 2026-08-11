// The notification sender's time budgets, in ONE place — the render path's
// timeBudget.ts applied to the second worker in this repo that holds a
// database lease across slow external calls.
//
// WHY THIS MODULE EXISTS, CONCRETELY. A sender pass claims entries under a
// Postgres-clock LEASE and then makes one provider call per entry. If the pass
// can still be sending after the lease has lapsed, the row is claimable again
// while the first sender is mid-flight — and the outbox's whole reason for
// existing (one event, one mail) is defeated by a DOUBLE SEND that no
// constraint can catch, because both senders are legitimately holding what
// they were given. 0058's original 120s lease against a batch of 10 entries at
// a 15s provider timeout was that bug: 150s of worst-case sending inside a
// 120s lease.
//
// So the numbers below are not preferences, they are a chain of relations, and
// notification-timebudget.audit3.test.ts asserts the chain rather than the
// literals. The binding one:
//
//   BATCH x (provider timeout + database round trips) + skew < lease
//
// The one number that cannot live here is `export const maxDuration`: Next.js
// statically analyses route segment config and rejects a non-literal, so the
// route keeps its literal, vercel.json keeps a third copy for the deployed
// function, and the relation test pins all three together (render-run
// precedent — that duplication silently stranded a budget at an old ceiling
// once already).

/** Resend's per-request abort. The sender's only genuinely slow call. */
export const RESEND_REQUEST_TIMEOUT_MS = 15_000;

/**
 * What one entry costs BESIDES the provider call: `auth.admin.getUserById`,
 * the `profiles` display-name read, and `complete_notification_outbox`. Three
 * Supabase round trips, generously budgeted — this is a ceiling used to prove
 * a pass fits, so it must be pessimistic to be worth anything.
 */
export const SUPABASE_ROUNDTRIP_ALLOWANCE_MS = 10_000;

/** The most one entry may cost before the pass must stop starting new ones. */
export const NOTIFICATION_ENTRY_BUDGET_MS =
  RESEND_REQUEST_TIMEOUT_MS + SUPABASE_ROUNDTRIP_ALLOWANCE_MS;

/**
 * Entries claimed per pass. Four, not ten: the batch multiplies the per-entry
 * cap into the pass's worst case, and the worst case has to fit inside the
 * lease. A bigger batch does not drain the queue faster — the pass-end
 * self-kick chains another pass, which claims with a FRESH lease. It only
 * makes one pass longer and one lease tighter.
 *
 * 0058's `claim_notification_outbox` defaults to this same 4 and clamps to
 * [1, 50]; the value is passed explicitly, so the default is a safety net.
 */
export const NOTIFICATION_BATCH_SIZE = 4;

/**
 * Lease requested at claim time, in seconds. 0058 clamps to [30, 900] and now
 * defaults to this value itself.
 */
export const NOTIFICATION_LEASE_SECONDS = 300;

export const NOTIFICATION_LEASE_MS = NOTIFICATION_LEASE_SECONDS * 1_000;

/** 0058: `least(greatest(coalesce(lease_seconds, 300), 30), 900)`. */
export const LEASE_SECONDS_FLOOR = 30;
export const LEASE_SECONDS_CEILING = 900;

/** 0058: `least(greatest(coalesce(batch_size, 4), 1), 50)`. */
export const BATCH_SIZE_CEILING = 50;

/**
 * The lease deadline is stamped by POSTGRES's clock; the pass measures itself
 * on the INSTANCE's. They are not the same clock, and the cost of them
 * disagreeing here is a double send, so the budget keeps a margin for the
 * disagreement rather than assuming there is none (render timeBudget's
 * LEASE_CLOCK_SKEW_MARGIN_MS, same argument).
 */
export const LEASE_CLOCK_SKEW_MARGIN_MS = 30_000;

/**
 * Everything a pass could spend if every entry ran to its cap. This is the
 * quantity that must fit inside the lease.
 */
export const NOTIFICATION_PASS_WORST_CASE_MS =
  NOTIFICATION_BATCH_SIZE * NOTIFICATION_ENTRY_BUDGET_MS;

/**
 * The wall-clock deadline `runNotificationPass` enforces, measured from pass
 * start. It does NOT stop a send in flight — it refuses to START one that
 * could still be running after the lease lapses. An entry left unsent keeps
 * its lease, goes back on the queue when that lease expires, and is delivered
 * by a later pass. That is a delay; sending it twice would be a defect.
 *
 * Derived, not chosen: lease − (one entry's cap) − (clock skew).
 */
export const NOTIFICATION_PASS_DEADLINE_MS =
  NOTIFICATION_LEASE_MS - NOTIFICATION_ENTRY_BUDGET_MS - LEASE_CLOCK_SKEW_MARGIN_MS;

/**
 * The invocation ceiling `/api/notifications/send` declares, in seconds. It
 * has to exceed the deadline above — a platform kill before the pass's own
 * deadline would make the deadline decorative and leave leases dangling with
 * no summary and no log. 300 is the same ceiling ingest-run uses and is the
 * default Fluid maximum; the render routes' 800 is for Chromium, not for this.
 */
export const NOTIFICATION_MAX_DURATION_SECONDS = 300;

export const NOTIFICATION_MAX_DURATION_MS = NOTIFICATION_MAX_DURATION_SECONDS * 1_000;
