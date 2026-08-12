// Waitlist invite + erasure mechanics, extracted from
// scripts/send-waitlist-invites.mjs so the parts that must never be wrong can
// be tested without a hosted project and without sending mail (the
// scripts/lib/accountErasure.mjs precedent; types in waitlistInvites.d.mts).
//
// WHY THIS EXISTS (fcp Issue #52, GAP-10). `waitlist_signups` has collected
// plaintext email addresses since migration 0039 for one stated purpose —
// "출시 초대 연락" — and until now the repository contained NO code that could
// send that invite and NO path that could delete an address. Collected-for-a-
// purpose-never-served is the worst state a PII table can be in.
//
// Two rules are encoded here and enforced by the tests:
//
//  1. THE ADDRESS NEVER LEAVES. It goes from the query into the Resend
//     request and nowhere else — not into a log line, not into a receipt
//     file, not into an error message. `containsAddress` is the tripwire the
//     script runs over every line before printing it.
//  2. SENDING IS THE END OF THE PURPOSE. The row is deleted as its invite
//     succeeds, so the table holds only addresses that have not yet been
//     written to. That is also the only "processed" state there is: no
//     migration adds an `invited_at` column, and none is needed, because
//     "still here" means "not yet invited" and a failed send simply leaves
//     the row for the next run.

/** Reason-code shape shared with the notification sender: lowercase, short. */
const REASON_CODE = /^[a-z0-9_]{1,60}$/;

/**
 * Anything that could be an address. Used as an assertion over OUTPUT, not as
 * validation of input — the point is to catch a future edit that starts
 * interpolating a row into a log line.
 */
export function containsAddress(line) {
  return typeof line === 'string' && line.includes('@');
}

/** Normalizes a provider/transport failure into a code safe to print. */
export function inviteFailureCode(raw) {
  const candidate = String(raw ?? '')
    .trim()
    .toLowerCase();
  return REASON_CODE.test(candidate) ? candidate : 'unknown_error';
}

/**
 * `source` is a short slug the signup carried (`?src=`), already constrained
 * by join_waitlist to [A-Za-z0-9_-]{1,64}. It is still labelled rather than
 * echoed, for the same reason the escalation pass labels report reasons: the
 * column is free TEXT in the database, and this output is read in a terminal
 * an operator may paste anywhere.
 */
export function sourceLabel(source) {
  if (source === null || source === undefined || String(source).trim() === '') {
    return 'direct';
  }
  return /^[A-Za-z0-9_-]{1,64}$/.test(String(source)) ? String(source) : 'unlisted';
}

function ageDays(createdAt, nowMs) {
  const created = Date.parse(createdAt ?? '');
  if (Number.isNaN(created)) {
    return null;
  }
  return Math.max(0, Math.floor((nowMs - created) / 86_400_000));
}

/**
 * The dry-run picture: how many addresses are being held, how old the oldest
 * is, and where they came from. Deliberately NOT a listing — there is nothing
 * an operator can do with an individual row here that they cannot do with the
 * count, and a listing is one careless column away from being a mailing list
 * in a terminal.
 */
export function summarizeSignups(rows, nowMs) {
  const counts = new Map();
  for (const row of rows) {
    const label = sourceLabel(row.source);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const oldest = rows.reduce((worst, row) => {
    const days = ageDays(row.created_at, nowMs);
    return days === null ? worst : Math.max(worst, days);
  }, 0);
  return {
    total: rows.length,
    oldestDays: rows.length === 0 ? 0 : oldest,
    bySource: [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([label, count]) => `${label}=${count}`)
      .join(' '),
  };
}

/**
 * The one mail this list exists to produce.
 *
 * It is identical for every recipient — no name, no source, no referral, no
 * tracking parameter — because the table holds nothing else and because a
 * personalised launch mail would make the address harder to argue is
 * single-purpose. It says what it is, where to go, and that the address is
 * being deleted, which is the promise the landing page makes and this script
 * keeps.
 *
 * There is no unsubscribe link: this is the only mail the address will ever
 * receive, and it is deleted on the way out. An unsubscribe link that outlives
 * the record it would unsubscribe from is theatre.
 */
export function inviteEmail({ inviteUrl }) {
  if (typeof inviteUrl !== 'string' || !/^https:\/\/[^\s]+$/.test(inviteUrl)) {
    throw new Error('inviteUrl must be an https URL');
  }
  const subject = 'Friendword is open';
  const lines = [
    'You asked us to write once, when Friendword’s iOS app was out.',
    'It is:',
    inviteUrl,
    'A Friendword starts with a friend recording what they’d say about you — you approve every word before anyone else sees it.',
    'This is the only email this list sends. Your address is deleted as it goes out, so there is nothing to unsubscribe from.',
  ];
  const escape = (value) =>
    value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return {
    subject,
    text: lines.join('\n\n'),
    html: lines
      .map((line) =>
        line === inviteUrl
          ? `<p><a href="${escape(line)}">${escape(line)}</a></p>`
          : `<p>${escape(line)}</p>`,
      )
      .join('\n'),
  };
}

const LIMIT_PATTERN = /^--limit=([1-9][0-9]*)$/;
const INVITE_URL_PATTERN = /^--invite-url=(https:\/\/\S+)$/;

/**
 * Modes, and why the default is the harmless one.
 *
 *   (no flags)  dry run — counts only, sends nothing, deletes nothing
 *   --send      send the invite and delete each row as it succeeds
 *   --forget    delete addresses supplied on STDIN (an erasure request)
 *
 * `--send` REQUIRES `--invite-url=`. There is no default, and that is the
 * point: at the time of writing there is nothing to invite anyone to (the app
 * is not on any store), so the flag cannot be run into by accident and the
 * operator has to name the thing that now exists.
 *
 * `--forget` reads from stdin rather than argv so an address never lands in
 * shell history, and never appears in `ps`.
 */
export function parseInviteArgs(argv) {
  const known = (arg) =>
    arg === '--help' ||
    arg === '--send' ||
    arg === '--forget' ||
    LIMIT_PATTERN.test(arg) ||
    INVITE_URL_PATTERN.test(arg);
  const unknown = argv.find((arg) => !known(arg));
  if (unknown !== undefined) {
    if (unknown.startsWith('--limit=')) {
      throw new Error('--limit must be a positive integer');
    }
    if (unknown.startsWith('--invite-url=')) {
      throw new Error('--invite-url must be an https URL');
    }
    throw new Error(`unknown argument: ${unknown}`);
  }

  const help = argv.includes('--help');
  const send = argv.includes('--send');
  const forget = argv.includes('--forget');
  if (send && forget) {
    throw new Error('--send and --forget are separate runs');
  }

  const limitArg = argv.find((arg) => LIMIT_PATTERN.test(arg));
  const limit = limitArg === undefined ? 100 : Number(LIMIT_PATTERN.exec(limitArg)[1]);
  if (limit > 500) {
    throw new Error('--limit must be 500 or fewer');
  }

  const urlArg = argv.find((arg) => INVITE_URL_PATTERN.test(arg));
  const inviteUrl = urlArg === undefined ? null : INVITE_URL_PATTERN.exec(urlArg)[1];
  if (send && inviteUrl === null) {
    throw new Error('--send requires --invite-url=https://… (there is no default)');
  }

  return { help, send, forget, limit, inviteUrl };
}

/**
 * Parses the stdin payload of a `--forget` run: one address per line, blanks
 * and `#` comments ignored, de-duplicated case-insensitively (the table's
 * unique index is on lower(email), so two casings are one row).
 */
export function parseForgetInput(raw) {
  const seen = new Set();
  for (const line of String(raw ?? '').split('\n')) {
    const candidate = line.trim();
    if (candidate === '' || candidate.startsWith('#')) {
      continue;
    }
    seen.add(candidate.toLowerCase());
  }
  return [...seen];
}
