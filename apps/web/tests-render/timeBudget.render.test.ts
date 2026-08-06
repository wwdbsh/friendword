/* global describe, expect, it, vi */

// T014: the render path's time budgets, checked as RELATIONS.
//
// Not "does BENCH_TIME_BUDGET_MS equal 770000" — that is the same literal
// written twice and proves nothing. What must hold is the STRUCTURE: every
// budget sits a margin under the platform ceiling, the worker's render
// deadline sits a margin under its own budget, the Postgres-clock lease covers
// the instance-clock budget, and the two route literals Next.js forces us to
// hand-write still agree with the module. Those are what silently broke when
// the ceiling moved from 300s to 800s, and each one below fails if a future
// change moves one number without the others.

// render-run pulls in the service client and the trigger (which imports
// 'server-only', refused by this node env); neither has anything to do with
// the segment config being read. Same stubs renderRunRoute.render.test.ts uses.
vi.mock('@/lib/supabaseServer', () => ({ getSupabaseServiceClient: () => ({}) }));
vi.mock('@/lib/pitchRender/trigger', () => ({ triggerRenderRun: async () => undefined }));

import { readFileSync } from 'node:fs';

import { maxDuration as benchMaxDuration } from '../app/api/media/render-bench/route';
import { maxDuration as workerMaxDuration } from '../app/api/media/render-run/route';
import {
  BENCH_SAFETY_MARGIN_MS,
  BENCH_TIME_BUDGET_MS,
  COMPLETION_MARGIN_MS,
  DEFAULT_CLAIM_WINDOW_MS,
  DEFAULT_LEASE_SECONDS,
  LEASE_CLOCK_SKEW_MARGIN_MS,
  LEASE_SECONDS_CEILING,
  LEASE_SECONDS_FLOOR,
  MIN_START_BUDGET_MS,
  RENDER_MAX_DURATION_MS,
  RENDER_MAX_DURATION_SECONDS,
  WORKER_HARD_BUDGET_MS,
  WORKER_SAFETY_MARGIN_MS,
} from '@/lib/pitchRender/timeBudget';

describe('render time budgets — margin under the platform ceiling', () => {
  it('keeps the bench budget a full safety margin under the invocation ceiling', () => {
    expect(BENCH_TIME_BUDGET_MS).toBeLessThan(RENDER_MAX_DURATION_MS);
    expect(RENDER_MAX_DURATION_MS - BENCH_TIME_BUDGET_MS).toBe(BENCH_SAFETY_MARGIN_MS);
    // The margin absorbs cold start and kill jitter, which do not shrink just
    // because the ceiling grew.
    expect(BENCH_SAFETY_MARGIN_MS).toBeGreaterThanOrEqual(30_000);
  });

  it('keeps the worker budget under the ceiling by at least as much as the bench', () => {
    expect(WORKER_HARD_BUDGET_MS).toBeLessThan(RENDER_MAX_DURATION_MS);
    expect(RENDER_MAX_DURATION_MS - WORKER_HARD_BUDGET_MS).toBe(WORKER_SAFETY_MARGIN_MS);
    // A bench overrun costs a measurement; a worker overrun costs a user's
    // render and leaves the job in lease-expiry limbo with no ops alert.
    expect(WORKER_SAFETY_MARGIN_MS).toBeGreaterThanOrEqual(BENCH_SAFETY_MARGIN_MS);
  });

  it('leaves the worker room to upload and complete inside its own budget', () => {
    const renderDeadlineMs = WORKER_HARD_BUDGET_MS - COMPLETION_MARGIN_MS;
    expect(renderDeadlineMs).toBeGreaterThan(0);
    expect(COMPLETION_MARGIN_MS).toBeGreaterThanOrEqual(30_000);
    // Upload + completion must also land before the platform kill, not merely
    // before the pass budget.
    expect(renderDeadlineMs + COMPLETION_MARGIN_MS).toBeLessThan(RENDER_MAX_DURATION_MS);
  });

  it('always leaves a fresh pass enough time to be allowed to start a render', () => {
    const renderDeadlineMs = WORKER_HARD_BUDGET_MS - COMPLETION_MARGIN_MS;
    expect(MIN_START_BUDGET_MS).toBeLessThan(renderDeadlineMs);
    // And a job claimed at the very edge of the claim window still clears the
    // refuse-to-start floor, so the window can never hand out doomed work.
    expect(DEFAULT_CLAIM_WINDOW_MS + MIN_START_BUDGET_MS).toBeLessThan(renderDeadlineMs);
  });
});

describe('render time budgets — the lease must not become the binding deadline', () => {
  // jobRunner takes min(hardDeadline, leaseDeadline). hardDeadline is measured
  // on the instance clock from pass start; leaseDeadline comes from Postgres's
  // clock at claim time. If the lease is not comfortably longer than the whole
  // budget, a worker refuses renders it had time for — or worse, is cut short.
  it('covers the whole worker budget plus room for clock skew', () => {
    expect(DEFAULT_LEASE_SECONDS * 1_000).toBeGreaterThanOrEqual(
      WORKER_HARD_BUDGET_MS + LEASE_CLOCK_SKEW_MARGIN_MS,
    );
  });

  it('stays inside the clamp 0054 applies to lease_seconds', () => {
    // least(greatest(coalesce(lease_seconds, 900), 60), 3600) — a request
    // outside this range is silently rewritten by the database.
    expect(DEFAULT_LEASE_SECONDS).toBeGreaterThanOrEqual(LEASE_SECONDS_FLOOR);
    expect(DEFAULT_LEASE_SECONDS).toBeLessThanOrEqual(LEASE_SECONDS_CEILING);
  });
});

describe('render time budgets — the route literals Next.js forces us to repeat', () => {
  // `export const maxDuration` must be statically analysable, so it cannot
  // import RENDER_MAX_DURATION_SECONDS. These two assertions are the only
  // thing standing between that and a budget stranded at the old ceiling.
  it('render-run declares the ceiling the budgets are derived from', () => {
    expect(workerMaxDuration).toBe(RENDER_MAX_DURATION_SECONDS);
  });

  it('render-bench declares the same ceiling', () => {
    expect(benchMaxDuration).toBe(RENDER_MAX_DURATION_SECONDS);
  });

  it('vercel.json gives the deployed functions the same ceiling', () => {
    // The segment config alone is not what ships: vercel.json's `functions`
    // block is what the platform reads, and it carried 300 independently of
    // the route files. A raise that missed this file would deploy a worker
    // budgeted for 760s into a function killed at 300s.
    const config: unknown = JSON.parse(
      readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'),
    );
    const functions = (config as { functions?: Record<string, { maxDuration?: number }> })
      .functions;
    expect(functions?.['app/api/media/render-run/route.ts']?.maxDuration).toBe(
      RENDER_MAX_DURATION_SECONDS,
    );
    expect(functions?.['app/api/media/render-bench/route.ts']?.maxDuration).toBe(
      RENDER_MAX_DURATION_SECONDS,
    );
    // ingest-run is a different worker with a 150s pass; the render ceiling is
    // not its business and must not be dragged along by this file.
    expect(functions?.['app/api/media/ingest-run/route.ts']?.maxDuration).toBe(300);
  });
});
