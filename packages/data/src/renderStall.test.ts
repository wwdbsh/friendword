// RENDER QUEUE STALL DETECTION — the hourly pass's third queue (Issue #52,
// GAP-8).
//
// The MP4 render queue has no cron: it advances only while something kicks it
// (kit poll, worker self-kick, operator curl). When every kicker stops, a job
// stays `queued`/`leased` forever and nothing in the system says so —
// `ops_alerts` only learns about a render when a CLAIM exhausts its retry
// budget, and a claim is exactly what is not happening. So an aged unfinished
// job is now an escalation, and these are the decisions that check cannot get
// wrong:
//
//   1. WHEN a job counts as late (threshold arithmetic and its boundary).
//   2. WHICH jobs are eligible — a paused campaign's job waits by design, and
//      counting it would nag hourly for a state no operator can clear.
//   3. WHAT the pass may print — this output is mailed, so it is ids, closed-
//      set status labels and ages, and nothing else.
import { describe, expect, it } from 'vitest';

import {
  RENDER_STALL_DEFAULT_MINUTES,
  isStalledRender,
  renderStallLines,
  renderStallQuery,
  resolveStallMinutes,
  stallCutoffIso,
} from '../../../scripts/lib/renderStall.mjs';

const NOW = Date.parse('2026-08-12T12:00:00.000Z');
const JOB_A = '70000000-0000-4000-8000-000000000001';
const JOB_B = '70000000-0000-4000-8000-000000000002';

function minutesAgo(minutes: number): string {
  return new Date(NOW - minutes * 60_000).toISOString();
}

describe('the stall threshold', () => {
  it('is 30 minutes, above the worst healthy life of a job (15m lease + 6.1m render)', () => {
    expect(RENDER_STALL_DEFAULT_MINUTES).toBe(30);
    // A job re-claimed after one lapsed 900s lease and then running the
    // slowest measured render (364s) is ~21 minutes old and healthy.
    expect(isStalledRender(minutesAgo(21), NOW, RENDER_STALL_DEFAULT_MINUTES)).toBe(false);
  });

  it('is exclusive at the boundary and true past it', () => {
    expect(isStalledRender(minutesAgo(29), NOW, 30)).toBe(false);
    expect(isStalledRender(minutesAgo(30), NOW, 30)).toBe(false);
    expect(isStalledRender(minutesAgo(31), NOW, 30)).toBe(true);
  });

  it('treats an unparseable timestamp as not-stalled rather than paging on it', () => {
    expect(isStalledRender('not a date', NOW, 30)).toBe(false);
    expect(isStalledRender(null, NOW, 30)).toBe(false);
  });
});

describe('resolveStallMinutes', () => {
  it('accepts an in-range override', () => {
    expect(resolveStallMinutes('45')).toBe(45);
    expect(resolveStallMinutes(' 5 ')).toBe(5);
    expect(resolveStallMinutes('1440')).toBe(1440);
  });

  it('degrades a typo to the default instead of silencing or spamming the alarm', () => {
    // The notification_max_age_hours posture (docs/OPS.md): an operational
    // knob with a bad value must not become an outage in either direction.
    for (const bad of ['', '   ', 'thirty', '0', '-10', '4', '1441', undefined, null]) {
      expect(resolveStallMinutes(bad)).toBe(RENDER_STALL_DEFAULT_MINUTES);
    }
  });
});

describe('renderStallQuery', () => {
  const query = renderStallQuery({ cutoffIso: stallCutoffIso(NOW, 30), limit: 25 });

  it('asks only for jobs a worker would claim right now', () => {
    // !inner + the embedded filter is what excludes a PAUSED campaign's job.
    // claim_media_render_job leaves those alone on purpose (they wait for a
    // resume), so counting them would produce a permanent red run.
    expect(query).toContain('campaigns!inner(status)');
    expect(query).toContain('campaigns.status=eq.published');
    expect(query).toContain('status=in.(queued,leased)');
  });

  it('measures age from created_at, not the retry-bumped updated_at', () => {
    expect(query).toContain(`created_at=lt.${encodeURIComponent('2026-08-12T11:30:00.000Z')}`);
    expect(query).not.toContain('updated_at');
  });

  it('selects no column that could carry free text or a person', () => {
    const select = /select=([^&]+)/.exec(query)?.[1] ?? '';
    for (const forbidden of [
      'last_error',
      'campaign_id',
      'pitch_draft_id',
      'requested_by_user_id',
      'output_storage_path',
      'scene_hash',
    ]) {
      expect(select).not.toContain(forbidden);
    }
  });
});

describe('renderStallLines', () => {
  it('says the queue is clear without listing anything', () => {
    expect(renderStallLines({ rows: [], total: 0, minutes: 30, nowMs: NOW })).toEqual([
      'render queue: 0 stalled (> 30m)',
    ]);
  });

  it('prints id, status and age only', () => {
    const lines = renderStallLines({
      rows: [
        { id: JOB_A, status: 'queued', created_at: minutesAgo(95) },
        { id: JOB_B, status: 'leased', created_at: minutesAgo(200) },
      ],
      total: 2,
      minutes: 30,
      nowMs: NOW,
    });

    expect(lines).toEqual([
      'render queue: 2 stalled (> 30m)',
      '  oldest: 95m',
      `  - ${JOB_A} queued 95m`,
      `  - ${JOB_B} leased 3h`,
    ]);
  });

  it('collapses a status outside the CHECK set instead of echoing it', () => {
    const lines = renderStallLines({
      rows: [{ id: JOB_A, status: 'queued; DROP TABLE', created_at: minutesAgo(60) }],
      total: 1,
      minutes: 30,
      nowMs: NOW,
    });

    expect(lines.at(-1)).toBe(`  - ${JOB_A} unlisted 60m`);
  });

  it('reports the exact total even when the listing is truncated', () => {
    const lines = renderStallLines({
      rows: [{ id: JOB_A, status: 'queued', created_at: minutesAgo(60) }],
      total: 7,
      minutes: 30,
      nowMs: NOW,
    });

    expect(lines[0]).toBe('render queue: 7 stalled (> 30m)');
    expect(lines.at(-1)).toBe('  … 6 more not listed');
  });
});
