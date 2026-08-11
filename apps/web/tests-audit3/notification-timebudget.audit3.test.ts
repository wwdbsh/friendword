/* global describe, expect, it, vi */

// T003 / 0058 — the notification sender's time budgets, checked as RELATIONS.
//
// Written in the shape of tests-render/timeBudget.render.test.ts, for the same
// reason: asserting NOTIFICATION_LEASE_SECONDS === 300 is the same literal
// written twice and proves nothing. What must hold is the STRUCTURE.
//
// The relation that matters, and the bug it closes: a pass claims entries
// under a Postgres-clock lease, then makes one provider call per entry. If the
// worst-case pass can outlast the lease, the row becomes claimable while the
// first sender is still mid-send, a second sender takes it, and the SAME
// PERSON GETS THE SAME MAIL TWICE — the exact failure the outbox and its
// unique index exist to prevent, arriving through the one door neither of them
// guards. 0058 shipped a 120s lease against a batch of 10 at a 15s provider
// timeout: 150s of sending inside a 120s lease. These assertions fail if any
// future change re-opens that gap by moving one number without the others.

// send/route.ts pulls in the service client, the trigger and the sender (which
// import 'server-only'); none of that has anything to do with the segment
// config being read. Same stubs notification-routes.audit3.test.ts uses.
vi.mock('@/lib/supabaseServer', () => ({ getSupabaseServiceClient: () => ({}) }));
vi.mock('@/lib/notifications/trigger', () => ({
  triggerNotificationSend: async () => undefined,
}));

import { readFileSync } from 'node:fs';

import { maxDuration as sendMaxDuration } from '../app/api/notifications/send/route';
import {
  BATCH_SIZE_CEILING,
  LEASE_CLOCK_SKEW_MARGIN_MS,
  LEASE_SECONDS_CEILING,
  LEASE_SECONDS_FLOOR,
  NOTIFICATION_BATCH_SIZE,
  NOTIFICATION_ENTRY_BUDGET_MS,
  NOTIFICATION_LEASE_MS,
  NOTIFICATION_LEASE_SECONDS,
  NOTIFICATION_MAX_DURATION_MS,
  NOTIFICATION_MAX_DURATION_SECONDS,
  NOTIFICATION_PASS_DEADLINE_MS,
  NOTIFICATION_PASS_WORST_CASE_MS,
  RESEND_REQUEST_TIMEOUT_MS,
  SUPABASE_ROUNDTRIP_ALLOWANCE_MS,
} from '@/lib/notifications/timeBudget';

const MIGRATION = readFileSync(
  new URL('../../../supabase/migrations/0058_notification_outbox.sql', import.meta.url),
  'utf8',
);

describe('notification time budgets — a pass must finish inside its lease', () => {
  it('bounds one entry by the provider timeout plus room for its database calls', () => {
    expect(NOTIFICATION_ENTRY_BUDGET_MS).toBe(
      RESEND_REQUEST_TIMEOUT_MS + SUPABASE_ROUNDTRIP_ALLOWANCE_MS,
    );
    // Three Supabase round trips per entry (mailbox, display name,
    // completion). The allowance is a ceiling used to prove a pass fits, so it
    // is worthless if it is not pessimistic.
    expect(SUPABASE_ROUNDTRIP_ALLOWANCE_MS).toBeGreaterThanOrEqual(3 * 1_000);
  });

  it('THE RELATION: batch x per-entry cap + skew margin fits inside the lease', () => {
    expect(NOTIFICATION_PASS_WORST_CASE_MS).toBe(
      NOTIFICATION_BATCH_SIZE * NOTIFICATION_ENTRY_BUDGET_MS,
    );
    expect(NOTIFICATION_PASS_WORST_CASE_MS + LEASE_CLOCK_SKEW_MARGIN_MS).toBeLessThan(
      NOTIFICATION_LEASE_MS,
    );
    // The lease deadline is Postgres's clock, the pass clock is the instance's.
    // A margin that shrinks toward zero is the same bug arriving slowly.
    expect(LEASE_CLOCK_SKEW_MARGIN_MS).toBeGreaterThanOrEqual(30_000);
  });

  it('derives the pass deadline as lease − one entry − skew, and keeps it positive', () => {
    expect(NOTIFICATION_PASS_DEADLINE_MS).toBe(
      NOTIFICATION_LEASE_MS - NOTIFICATION_ENTRY_BUDGET_MS - LEASE_CLOCK_SKEW_MARGIN_MS,
    );
    // An entry STARTED at the deadline still lands before the lease lapses —
    // that is what makes "refuse to start" a sufficient rule.
    expect(NOTIFICATION_PASS_DEADLINE_MS + NOTIFICATION_ENTRY_BUDGET_MS).toBeLessThanOrEqual(
      NOTIFICATION_LEASE_MS - LEASE_CLOCK_SKEW_MARGIN_MS,
    );
    // And the deadline must leave room for a whole ordinary pass, or it would
    // be cutting healthy batches short instead of guarding the lease.
    expect(NOTIFICATION_PASS_DEADLINE_MS).toBeGreaterThan(NOTIFICATION_PASS_WORST_CASE_MS);
  });

  it('keeps the whole pass inside the platform invocation ceiling', () => {
    expect(NOTIFICATION_MAX_DURATION_MS).toBe(NOTIFICATION_MAX_DURATION_SECONDS * 1_000);
    // A kill before the pass's own deadline would make the deadline
    // decorative: no summary, no log, leases left dangling.
    expect(NOTIFICATION_PASS_DEADLINE_MS + NOTIFICATION_ENTRY_BUDGET_MS).toBeLessThan(
      NOTIFICATION_MAX_DURATION_MS,
    );
    expect(NOTIFICATION_MAX_DURATION_MS - NOTIFICATION_PASS_WORST_CASE_MS).toBeGreaterThanOrEqual(
      60_000,
    );
  });
});

describe('notification time budgets — the clamps 0058 applies', () => {
  // least(greatest(coalesce(lease_seconds, 300), 30), 900) and
  // least(greatest(coalesce(batch_size, 4), 1), 50): a request outside these
  // ranges is silently rewritten by the database, which would break every
  // relation above without changing a single line of TypeScript.
  it('requests a lease the database will actually grant', () => {
    expect(NOTIFICATION_LEASE_SECONDS).toBeGreaterThanOrEqual(LEASE_SECONDS_FLOOR);
    expect(NOTIFICATION_LEASE_SECONDS).toBeLessThanOrEqual(LEASE_SECONDS_CEILING);
    expect(NOTIFICATION_LEASE_MS).toBe(NOTIFICATION_LEASE_SECONDS * 1_000);
  });

  it('requests a batch the database will actually grant', () => {
    expect(NOTIFICATION_BATCH_SIZE).toBeGreaterThanOrEqual(1);
    expect(NOTIFICATION_BATCH_SIZE).toBeLessThanOrEqual(BATCH_SIZE_CEILING);
  });

  it('the clamps mirrored here are the ones the migration really writes', () => {
    // If 0058's clamp moves, these constants become a comment about the past.
    expect(MIGRATION).toContain(
      `least(greatest(coalesce(lease_seconds, ${NOTIFICATION_LEASE_SECONDS}), ` +
        `${LEASE_SECONDS_FLOOR}), ${LEASE_SECONDS_CEILING})`,
    );
    expect(MIGRATION).toContain(
      `least(greatest(coalesce(batch_size, ${NOTIFICATION_BATCH_SIZE}), 1), ` +
        `${BATCH_SIZE_CEILING})`,
    );
  });
});

describe('notification time budgets — the literals Next.js forces us to repeat', () => {
  it('the send route declares the ceiling the budgets are derived from', () => {
    expect(sendMaxDuration).toBe(NOTIFICATION_MAX_DURATION_SECONDS);
  });

  it('vercel.json gives the deployed function the same ceiling', () => {
    // The segment config alone is not what ships: vercel.json's `functions`
    // block is what the platform reads. render-run shipped budgeted for 760s
    // into a function killed at 300s exactly because this file was missed.
    const config: unknown = JSON.parse(
      readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'),
    );
    const functions = (config as { functions?: Record<string, { maxDuration?: number }> })
      .functions;
    expect(functions?.['app/api/notifications/send/route.ts']?.maxDuration).toBe(
      NOTIFICATION_MAX_DURATION_SECONDS,
    );
    // The render worker is a different job with a Chromium-sized ceiling; the
    // notification sender must not drag it, or be dragged by it.
    expect(functions?.['app/api/media/render-run/route.ts']?.maxDuration).toBe(800);
  });
});
