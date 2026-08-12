#!/usr/bin/env node
// Safety queue escalation check (fcp Issue #39, GAP-2; render queue added by
// Issue #52, GAP-8).
//
// `reports` and `ops_alerts` had no automatic consumer: during public beta a
// UGC report only reached the operator if someone remembered to run the SQL in
// docs/OPS.md. This pass reads those queues with the service role and exits
// non-zero while anything is still unhandled, so the scheduled workflow that
// runs it turns an unread queue into a GitHub run failure — and GitHub's
// failed-run notification mail to the repo owner is the v1 alert channel
// (docs/OPS.md, "신고 자동 에스컬레이션").
//
// A THIRD queue rides here for the same reason: the MP4 render queue has no
// cron and only moves when something kicks it, so a job can sit unfinished
// with no consumer and nothing else will ever say so (see scripts/lib/
// renderStall.mjs for the threshold and its derivation). It is on this pass
// rather than its own workflow because the GitHub Actions minute budget is
// what killed the previous scheduled setup (docs/OPS.md, 정기 운영 실행):
// this run already exists, already talks to PostgREST, and adds one request.
//
// Exit codes are distinct on purpose:
//   0  every queue is clear
//   2  unhandled rows exist (escalation — the expected "alert" state)
//   1  the check itself could not run (missing env, HTTP/query failure)
//
// PRIVACY: this runs in a log that ends up in mail. It prints counts, row ids,
// ages and a fixed allowlist of type labels only. Report `detail`, reporter or
// reported user ids, campaign slugs, alert `detail` payloads and any free text
// are never read into the output. `reason` is a closed set at the API layer
// but a TEXT column in the DB, so unlisted values collapse to `unlisted`.
//
// No @supabase/supabase-js on purpose: this script must run in a CI job with no
// `pnpm install` step (see the minute budget in .github/workflows/
// safety-escalation.yml), so it talks to PostgREST over plain fetch.
//
// Run: node scripts/check-safety-escalations.mjs   (repo root; needs .env)

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  renderStallLines,
  renderStallQuery,
  resolveStallMinutes,
  stallCutoffIso,
} from './lib/renderStall.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Cap on rows listed per queue. The exact total always comes from the
// count=exact header, so a truncated list never hides the real size.
const ROW_LIMIT = 25;
const REQUEST_TIMEOUT_MS = 20_000;

// Closed sets mirrored from the product surfaces. Anything else is a value the
// DB accepted but the UI does not produce; label it without echoing the text.
const KNOWN_REPORT_REASONS = new Set([
  'impersonation',
  'safety_risk',
  'minor',
  'harassment',
  'spam',
  'other',
]);
const KNOWN_REPORT_SEVERITIES = new Set(['low', 'high']);
// Every alert_type literal inserted by a migration today (0016/0024, 0050,
// 0051, 0054, 0058). A type added later shows up as `unlisted` — a count,
// never text.
const KNOWN_ALERT_TYPES = new Set([
  'campaign_auto_paused',
  'video_frame_moderation_flagged',
  'video_moderation_review_deleted',
  'pitch_render_failed',
  'notification_send_failed',
]);

function readEnvFile() {
  const envPath = path.join(repoRoot, '.env');
  if (!existsSync(envPath)) return {};
  return Object.fromEntries(
    readFileSync(envPath, 'utf8')
      .split('\n')
      .filter((line) => line.includes('=') && !line.trim().startsWith('#'))
      .map((line) => {
        const separator = line.indexOf('=');
        return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
      }),
  );
}

function label(value, allowlist) {
  return typeof value === 'string' && allowlist.has(value) ? value : 'unlisted';
}

function ageHours(createdAt) {
  const created = Date.parse(createdAt ?? '');
  if (Number.isNaN(created)) return null;
  return Math.max(0, Math.floor((Date.now() - created) / 3_600_000));
}

function formatAge(createdAt) {
  const hours = ageHours(createdAt);
  if (hours === null) return 'age?';
  return hours < 48 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}

function tally(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([key, count]) => `${key}=${count}`)
    .join(' ');
}

// PostgREST returns `content-range: 0-24/137` when Prefer: count=exact is set.
function totalFromContentRange(header, fallback) {
  const total = Number.parseInt(String(header ?? '').split('/')[1] ?? '', 10);
  return Number.isFinite(total) ? total : fallback;
}

async function fetchQueue({ url, serviceKey, table, query }) {
  const endpoint = `${url.replace(/\/$/, '')}/rest/v1/${table}?${query}`;

  let response;
  try {
    response = await fetch(endpoint, {
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        Accept: 'application/json',
        Prefer: 'count=exact',
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (cause) {
    // Only the error name: a fetch failure message can echo the request URL.
    throw new Error(`${table}: request failed (${cause?.name ?? 'Error'})`);
  }

  // Never surface the body — PostgREST error bodies quote the query.
  if (!response.ok) throw new Error(`${table}: HTTP ${response.status}`);

  const rows = await response.json();
  if (!Array.isArray(rows)) throw new Error(`${table}: unexpected response shape`);
  return { rows, total: totalFromContentRange(response.headers.get('content-range'), rows.length) };
}

function reportLines({ rows, total }) {
  if (total === 0) return ['reports: 0 open'];
  const lines = [
    `reports: ${total} open`,
    `  by severity: ${tally(rows.map((row) => label(row.severity, KNOWN_REPORT_SEVERITIES)))}`,
    `  by reason:   ${tally(rows.map((row) => label(row.reason, KNOWN_REPORT_REASONS)))}`,
    `  oldest:      ${formatAge(rows[0]?.created_at)}`,
  ];
  for (const row of rows) {
    lines.push(
      `  - ${row.id} ${label(row.severity, KNOWN_REPORT_SEVERITIES)}/` +
        `${label(row.reason, KNOWN_REPORT_REASONS)} ${formatAge(row.created_at)}`,
    );
  }
  if (total > rows.length) lines.push(`  … ${total - rows.length} more not listed`);
  return lines;
}

function alertLines({ rows, total }) {
  if (total === 0) return ['ops_alerts: 0 unresolved'];
  const lines = [
    `ops_alerts: ${total} unresolved`,
    `  by type: ${tally(rows.map((row) => label(row.alert_type, KNOWN_ALERT_TYPES)))}`,
    `  oldest:  ${formatAge(rows[0]?.created_at)}`,
  ];
  for (const row of rows) {
    lines.push(
      `  - ${row.id} ${label(row.alert_type, KNOWN_ALERT_TYPES)} ${formatAge(row.created_at)}`,
    );
  }
  if (total > rows.length) lines.push(`  … ${total - rows.length} more not listed`);
  return lines;
}

const env = { ...readEnvFile(), ...process.env };
const url = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error(
    'check-safety-escalations: missing SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY ' +
      '(local .env, or repo Actions secrets in CI)',
  );
  process.exit(1);
}

const nowMs = Date.now();
const stallMinutes = resolveStallMinutes(env.FRIENDWORD_RENDER_STALL_MINUTES);

let reports;
let alerts;
let renders;
try {
  [reports, alerts, renders] = await Promise.all([
    fetchQueue({
      url,
      serviceKey,
      table: 'reports',
      query:
        'status=eq.open&select=id,severity,reason,created_at' +
        `&order=created_at.asc&limit=${ROW_LIMIT}`,
    }),
    fetchQueue({
      url,
      serviceKey,
      table: 'ops_alerts',
      query:
        'resolved_at=is.null&select=id,alert_type,created_at' +
        `&order=created_at.asc&limit=${ROW_LIMIT}`,
    }),
    fetchQueue({
      url,
      serviceKey,
      table: 'media_render_jobs',
      query: renderStallQuery({
        cutoffIso: stallCutoffIso(nowMs, stallMinutes),
        limit: ROW_LIMIT,
      }),
    }),
  ]);
} catch (error) {
  console.error(`check-safety-escalations: ${error.message}`);
  process.exit(1);
}

for (const line of [
  ...reportLines(reports),
  ...alertLines(alerts),
  ...renderStallLines({ rows: renders.rows, total: renders.total, minutes: stallMinutes, nowMs }),
]) {
  console.log(line);
}

const pending = reports.total + alerts.total + renders.total;
if (pending === 0) {
  console.log('check-safety-escalations: every queue clear');
  process.exit(0);
}

const summary =
  `Safety queues need an operator: ${reports.total} open report(s), ` +
  `${alerts.total} unresolved ops alert(s), ` +
  `${renders.total} render(s) stalled over ${stallMinutes}m. ` +
  `Runbook: docs/OPS.md → 신고 자동 에스컬레이션.`;
// ::error:: puts the summary on the run page and in the failure mail preview.
if (process.env.GITHUB_ACTIONS === 'true') console.log(`::error::${summary}`);
console.error(`check-safety-escalations: ${summary}`);
process.exit(2);
