// WAITLIST INVITES AND ERASURE — the rules scripts/send-waitlist-invites.mjs
// cannot get wrong (Issue #52, GAP-10).
//
// `waitlist_signups` holds plaintext addresses collected for one purpose and,
// until this script, served by nothing: no sender, no deletion path, and a
// landing page promising a mail that no code could produce. The pure parts of
// the repair live in scripts/lib/waitlistInvites.mjs so they can be asserted
// without a hosted project and without sending anything.
//
// Three failure modes are covered:
//   1. An address escaping into output — a log line, a receipt, an error.
//   2. Sending by accident, or sending something that is not true.
//   3. An erasure request quietly widening into a sweep.
import { describe, expect, it } from 'vitest';

import {
  containsAddress,
  inviteEmail,
  inviteFailureCode,
  parseForgetInput,
  parseInviteArgs,
  sourceLabel,
  summarizeSignups,
} from '../../../scripts/lib/waitlistInvites.mjs';

const NOW = Date.parse('2026-08-12T12:00:00.000Z');

function daysAgo(days: number): string {
  return new Date(NOW - days * 86_400_000).toISOString();
}

describe('containsAddress — the output tripwire', () => {
  it('catches anything address-shaped', () => {
    expect(containsAddress('sent 1 to someone@example.com')).toBe(true);
    expect(containsAddress('waitlist invites: sent=3 failed=0')).toBe(false);
  });
});

describe('summarizeSignups', () => {
  it('reports counts, the oldest age and source labels — never a row', () => {
    const summary = summarizeSignups(
      [
        { id: 'a', source: 'launch-partner', created_at: daysAgo(14) },
        { id: 'b', source: null, created_at: daysAgo(2) },
        { id: 'c', source: 'launch-partner', created_at: daysAgo(1) },
      ],
      NOW,
    );

    expect(summary.total).toBe(3);
    expect(summary.oldestDays).toBe(14);
    expect(summary.bySource).toBe('launch-partner=2 direct=1');
  });

  it('labels a source the UI never produces instead of echoing it', () => {
    expect(sourceLabel('drop table signups')).toBe('unlisted');
    expect(sourceLabel('')).toBe('direct');
    expect(sourceLabel(null)).toBe('direct');
  });

  it('is empty-safe', () => {
    expect(summarizeSignups([], NOW)).toEqual({ total: 0, oldestDays: 0, bySource: '' });
  });
});

describe('inviteEmail', () => {
  const mail = inviteEmail({ inviteUrl: 'https://apps.apple.com/app/friendword' });

  it('carries the destination and nothing about the recipient', () => {
    expect(mail.text).toContain('https://apps.apple.com/app/friendword');
    // The table holds an address, a source and a timestamp; none of them may
    // appear in the body. Identical mail for everyone is what keeps this
    // address single-purpose.
    expect(containsAddress(mail.text)).toBe(false);
    expect(containsAddress(mail.html)).toBe(false);
  });

  it('states the deletion the landing page promised', () => {
    expect(mail.text).toContain('deleted');
    expect(mail.text).toContain('only email this list sends');
  });

  it('refuses to build a mail with nothing to invite anyone to', () => {
    expect(() => inviteEmail({ inviteUrl: '' })).toThrow(/https/);
    expect(() => inviteEmail({ inviteUrl: 'http://insecure.example' })).toThrow(/https/);
  });

  it('escapes the URL it links, so a crafted invite target cannot inject markup', () => {
    const crafted = inviteEmail({ inviteUrl: 'https://x.test/"><script>alert(1)</script>' });
    expect(crafted.html).not.toContain('<script>');
  });
});

describe('parseInviteArgs', () => {
  it('defaults to the harmless mode', () => {
    const args = parseInviteArgs([]);
    expect(args.send).toBe(false);
    expect(args.forget).toBe(false);
    expect(args.limit).toBe(100);
  });

  it('will not send without an explicit destination', () => {
    // There is deliberately no default invite URL: at the time of writing
    // there is nothing to invite anyone to, so --send cannot be stumbled into.
    expect(() => parseInviteArgs(['--send'])).toThrow(/--invite-url/);
    expect(() => parseInviteArgs(['--send', '--invite-url=notaurl'])).toThrow(/--invite-url/);
    expect(parseInviteArgs(['--send', '--invite-url=https://x.test']).inviteUrl).toBe(
      'https://x.test',
    );
  });

  it('keeps sending and forgetting apart', () => {
    expect(() => parseInviteArgs(['--send', '--invite-url=https://x.test', '--forget'])).toThrow(
      /separate runs/,
    );
  });

  it('rejects an unreadable limit rather than guessing one', () => {
    expect(() => parseInviteArgs(['--limit=0'])).toThrow(/--limit/);
    expect(() => parseInviteArgs(['--limit=all'])).toThrow(/--limit/);
    expect(() => parseInviteArgs(['--limit=501'])).toThrow(/500/);
    expect(parseInviteArgs(['--limit=25']).limit).toBe(25);
  });

  it('rejects an unknown flag instead of ignoring it', () => {
    expect(() => parseInviteArgs(['--dry-run'])).toThrow(/unknown argument/);
  });
});

describe('parseForgetInput', () => {
  it('reads one address per line, ignoring blanks and comments', () => {
    expect(parseForgetInput('# request 2026-08-12\n\na@x.test\n b@x.test \n')).toEqual([
      'a@x.test',
      'b@x.test',
    ]);
  });

  it('folds case, because the table is unique on lower(email)', () => {
    expect(parseForgetInput('A@X.test\na@x.TEST')).toEqual(['a@x.test']);
  });

  it('is empty for empty input, so an accidental run deletes nothing', () => {
    expect(parseForgetInput('')).toEqual([]);
    expect(parseForgetInput(null)).toEqual([]);
    expect(parseForgetInput('   \n# only a comment\n')).toEqual([]);
  });
});

describe('inviteFailureCode', () => {
  it('keeps a code and collapses anything else', () => {
    expect(inviteFailureCode('resend_http_422')).toBe('resend_http_422');
    // A provider error body quotes the address it rejected.
    expect(inviteFailureCode('rejected recipient someone@example.com')).toBe('unknown_error');
    expect(inviteFailureCode(undefined)).toBe('unknown_error');
  });
});
