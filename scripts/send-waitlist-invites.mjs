#!/usr/bin/env node
// Waitlist invites and waitlist erasure (fcp Issue #52, GAP-10).
//
// `waitlist_signups` (migration 0039) has held plaintext email addresses since
// launch prep, collected for exactly one stated purpose — writing to those
// people when there is something to invite them to. Until this script there
// was no code that could send that mail and no procedure that could delete an
// address: the account-deletion job cannot reach this table (no users FK) and
// the landing page's promise had no implementation behind it.
//
// Three modes, defaulting to the harmless one:
//
//   node scripts/send-waitlist-invites.mjs
//       Dry run. Counts, ages and source labels. Sends nothing, deletes
//       nothing, prints no address.
//
//   node scripts/send-waitlist-invites.mjs --send --invite-url=https://…
//       Sends the one invite and DELETES each row as its send succeeds. A
//       failed send keeps its row, so the next run retries it. There is no
//       default invite URL on purpose — at the time of writing there is
//       nothing to invite anyone to, so this cannot be run into by accident.
//
//   node scripts/send-waitlist-invites.mjs --forget < addresses.txt
//       Erasure request. Reads addresses from STDIN (never argv — an address
//       must not enter shell history or `ps`) and deletes the matching rows.
//
// PRIVACY, and this is the whole design: an address goes from the query into
// the Resend request body and NOWHERE else. It is not logged, not written to
// the receipt file, not interpolated into an error. Every line this script
// prints is run past `containsAddress` before it reaches the terminal, so a
// future edit that starts echoing a row fails loudly instead of quietly
// putting a mailing list in a CI log. Provider failures are recorded as a
// status code — a Resend error body routinely quotes the address it rejected.
//
// Run from the repo root; needs .env with SUPABASE_URL,
// SUPABASE_SERVICE_ROLE_KEY and (for --send) RESEND_API_KEY and
// FRIENDWORD_NOTIFY_FROM.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  containsAddress,
  inviteEmail,
  inviteFailureCode,
  parseForgetInput,
  parseInviteArgs,
  sourceLabel,
  summarizeSignups,
} from './lib/waitlistInvites.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RECEIPT_PATH = path.join(repoRoot, 'scripts/.out/waitlist-invites.log');
const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const REQUEST_TIMEOUT_MS = 20_000;

const USAGE = `Usage:
  node scripts/send-waitlist-invites.mjs                                  dry run (default)
  node scripts/send-waitlist-invites.mjs --send --invite-url=https://…    send + delete each sent row
  node scripts/send-waitlist-invites.mjs --forget < addresses.txt         delete addresses read from stdin

  --limit=N   rows to touch in one run (default 100, max 500)

Sending deletes the row: the purpose the address was collected for is served
exactly once. A failed send keeps its row for the next run. See docs/OPS.md →
"waitlist 초대와 삭제".`;

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

/** The tripwire. Nothing reaches the terminal except through here. */
function say(line) {
  if (containsAddress(line)) {
    console.error('send-waitlist-invites: refused to print a line containing an address');
    process.exit(1);
  }
  console.log(line);
}

/** Receipt of what happened, by row id and outcome only. Gitignored (*.log).
 *  The durable "processed" state is the row's ABSENCE; this is the paper
 *  trail for the run that removed it. */
function receipt(line) {
  if (containsAddress(line)) {
    console.error('send-waitlist-invites: refused to write a receipt containing an address');
    process.exit(1);
  }
  try {
    mkdirSync(path.dirname(RECEIPT_PATH), { recursive: true });
    appendFileSync(RECEIPT_PATH, `${line}\n`);
  } catch {
    // A missing receipt must not stop an erasure or a send that already
    // happened; the console line above is the fallback record.
  }
}

async function rest(config, pathAndQuery, init = {}) {
  const response = await fetch(`${config.url.replace(/\/$/, '')}/rest/v1/${pathAndQuery}`, {
    ...init,
    headers: {
      apikey: config.serviceKey,
      Authorization: `Bearer ${config.serviceKey}`,
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  // Never surface the body: a PostgREST error quotes the query, and this
  // query selects an email column.
  if (!response.ok) {
    throw new Error(`waitlist_signups: HTTP ${response.status}`);
  }
  const text = await response.text();
  return text === '' ? null : JSON.parse(text);
}

async function sendInvite(config, address, mail) {
  let response;
  try {
    response = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.resendKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: config.from,
        to: [address],
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (cause) {
    // The error NAME only: a fetch failure message can echo the request.
    return { ok: false, code: inviteFailureCode(`resend_request_${cause?.name ?? 'error'}`) };
  }
  if (!response.ok) {
    return { ok: false, code: inviteFailureCode(`resend_http_${response.status}`) };
  }
  return { ok: true };
}

function readStdin() {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

let args;
try {
  args = parseInviteArgs(process.argv.slice(2));
} catch (error) {
  console.error(`send-waitlist-invites: ${error.message}\n\n${USAGE}`);
  process.exit(1);
}

if (args.help) {
  console.log(USAGE);
  process.exit(0);
}

const env = { ...readEnvFile(), ...process.env };
const config = {
  url: env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL,
  serviceKey: env.SUPABASE_SERVICE_ROLE_KEY,
  resendKey: env.RESEND_API_KEY,
  from: env.FRIENDWORD_NOTIFY_FROM,
};
if (!config.url || !config.serviceKey) {
  console.error('send-waitlist-invites: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  process.exit(1);
}
if (args.send && (!config.resendKey || !config.from)) {
  console.error(
    'send-waitlist-invites: --send needs RESEND_API_KEY and FRIENDWORD_NOTIFY_FROM ' +
      '(docs/OPS.md → 이벤트 이메일 알림)',
  );
  process.exit(1);
}

const nowMs = Date.now();
const startedAt = new Date(nowMs).toISOString();

if (args.forget) {
  const requested = parseForgetInput(readStdin());
  if (requested.length === 0) {
    console.error('send-waitlist-invites: --forget expects one address per line on stdin');
    process.exit(1);
  }

  let forgotten = 0;
  let notFound = 0;
  for (const address of requested) {
    // Match case-insensitively (the unique index is on lower(email)) but
    // confirm the exact value in JS before deleting: `ilike` treats % and _
    // as wildcards, and a wildcard must never widen an erasure into a sweep.
    const rows = await rest(
      config,
      `waitlist_signups?select=id,email&email=ilike.${encodeURIComponent(address)}`,
    );
    const match = (rows ?? []).find((row) => String(row.email).toLowerCase() === address);
    if (match === undefined) {
      notFound += 1;
      continue;
    }
    await rest(config, `waitlist_signups?id=eq.${encodeURIComponent(match.id)}`, {
      method: 'DELETE',
    });
    forgotten += 1;
    receipt(`${startedAt} ${match.id} forgotten`);
  }

  say(`waitlist forget: requested=${requested.length} forgotten=${forgotten} absent=${notFound}`);
  process.exit(0);
}

const rows =
  (await rest(
    config,
    `waitlist_signups?select=id,email,source,created_at&order=created_at.asc&limit=${args.limit}`,
  )) ?? [];

const summary = summarizeSignups(rows, nowMs);

if (!args.send) {
  say(`DRY RUN waitlist: ${summary.total} pending signup(s), oldest ${summary.oldestDays}d`);
  if (summary.total > 0) {
    say(`  by source: ${summary.bySource}`);
    say('  --send would write to each of them once and delete the row as it succeeds');
    say('  a failed send keeps its row for the next run');
  }
  process.exit(0);
}

const mail = inviteEmail({ inviteUrl: args.inviteUrl });
let sent = 0;
const failures = new Map();

for (const row of rows) {
  const result = await sendInvite(config, row.email, mail);
  if (!result.ok) {
    failures.set(result.code, (failures.get(result.code) ?? 0) + 1);
    receipt(`${startedAt} ${row.id} failed ${result.code} source=${sourceLabel(row.source)}`);
    continue;
  }
  // Delete AFTER the provider accepted it. The other order would lose the
  // address on a provider outage and the person would never be written to.
  await rest(config, `waitlist_signups?id=eq.${encodeURIComponent(row.id)}`, { method: 'DELETE' });
  sent += 1;
  receipt(`${startedAt} ${row.id} sent source=${sourceLabel(row.source)}`);
}

const failureLine =
  failures.size === 0
    ? 'none'
    : [...failures.entries()].map(([code, count]) => `${code}=${count}`).join(' ');
say(`waitlist invites: sent=${sent} failed=${rows.length - sent} (${failureLine})`);
say(`  remaining rows keep their address for the next run; sent rows are deleted`);
process.exit(rows.length - sent === 0 ? 0 : 2);
