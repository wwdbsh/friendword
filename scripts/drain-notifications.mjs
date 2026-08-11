#!/usr/bin/env node
// Notification outbox backstop (T003, migration 0058).
//
// The normal drain is opportunistic: the web request that CAUSED an event
// (interest submitted, inbox decision, render worker pass end) kicks
// /api/notifications/send through the relay. This pass exists for the case
// where every kick was missed — the tab closed before the fetch left, the
// deployment restarted mid-push — so the queue is not left to the 72h
// expiry (0058 decision 5).
//
// It is a PUSH, not a sender: all the logic, the service key and the provider
// key live in the deployed route. This script only knocks on the door with the
// shared secret, which is why it needs no Supabase credentials and no install.
//
// Exit codes:
//   0  the pass ran, or was deliberately skipped as unconfigured, or was
//      delivered but outlasted our wait for its answer (non-fatal — the pass
//      keeps running server-side; the log line distinguishes this case)
//   1  the push itself failed (HTTP error, unreachable origin)
//
// PRIVACY: the route answers with counts and reason codes only — no address,
// no recipient id (see runNotificationPass). That answer is echoed here
// verbatim BECAUSE it is already free of identifiers; if the route's summary
// ever gains one, this echo must be narrowed with it.
//
// Run: node scripts/drain-notifications.mjs   (repo root; needs .env)

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Long enough to outlast a WHOLE bounded pass, not just a fast one. The sender
// answers only after its batch of provider calls: 4 entries x a 25s per-entry
// cap = 100s worst case (apps/web/src/lib/notifications/timeBudget.ts), inside
// a 300s function ceiling. The old 60s cut the wait off in the middle of a
// perfectly healthy pass and reported a failure the operator would have
// chased. 240s covers the bounded worst case with room and still returns
// before the platform would kill the function anyway.
const REQUEST_TIMEOUT_MS = 240_000;

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

const env = { ...readEnvFile(), ...process.env };
const origin =
  env.FRIENDWORD_WEB_ORIGIN || env.FRIENDWORD_SHARE_ORIGIN || env.EXPO_PUBLIC_WEB_ORIGIN;
const secret = env.FRIENDWORD_NOTIFY_SECRET;

// Deliberately exit 0 rather than fail: until the operator sets the secret,
// notifications are simply not switched on, and failing a daily scheduled run
// every day for a feature that is off is how a real alarm gets ignored. The
// skip is logged so "why did nothing send" has an answer in the run log.
if (!origin || !secret) {
  console.log(
    'drain-notifications: skipped — FRIENDWORD_WEB_ORIGIN and/or FRIENDWORD_NOTIFY_SECRET ' +
      'are not set (see docs/OPS.md → 이벤트 이메일 알림)',
  );
  process.exit(0);
}

let response;
try {
  response = await fetch(`${origin.replace(/\/$/, '')}/api/notifications/send`, {
    method: 'POST',
    headers: { authorization: `Bearer ${secret}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
} catch (cause) {
  // Only the error name: a fetch failure message can echo the request URL,
  // and the URL carries no secret today but must not start to.
  const name = cause?.name ?? 'Error';
  if (name === 'TimeoutError') {
    // The push WAS delivered; only our wait for the answer was cut off, and
    // the pass keeps running server-side under its own lease and deadline. A
    // daily job that fails on this would page an operator about a queue that
    // is draining. Distinct message so "no summary" is never mistaken for
    // "no pass" in the run log.
    console.warn(
      'drain-notifications: the push was delivered but the pass did not answer within ' +
        `${REQUEST_TIMEOUT_MS / 1000}s — it continues server-side; check ` +
        'notification_outbox and ops_alerts if this repeats',
    );
    process.exit(0);
  }
  console.error(`drain-notifications: request failed (${name})`);
  process.exit(1);
}

if (!response.ok) {
  console.error(`drain-notifications: HTTP ${response.status}`);
  process.exit(1);
}

let summary = null;
try {
  summary = await response.json();
} catch {
  summary = null;
}
if (summary && typeof summary === 'object') {
  console.log(
    `drain-notifications: claimed=${summary.claimed ?? '?'} sent=${summary.sent ?? '?'} ` +
      `failed=${summary.failed ?? '?'}` +
      (Array.isArray(summary.failureCodes) && summary.failureCodes.length > 0
        ? ` codes=${summary.failureCodes.join(',')}`
        : ''),
  );
} else {
  console.log('drain-notifications: the sender answered without a summary');
}
process.exit(0);
