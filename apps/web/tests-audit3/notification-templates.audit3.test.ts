// T003 / 0058 — the four notification mails, as pure functions.
//
// What is pinned here is not "the copy someone liked" but the two rules the
// copy has to obey and one routing rule:
//   (a) §12: no promise the code does not keep — no timing, no "we will
//       review", no claim about what the other person will do;
//   (b) 0058 decision 2: the only personal datum in a mail is the recipient's
//       OWN name, HTML-escaped because it is user-authored;
//   (c) every mail lands on the T004 screen for its event, built against the
//       configured share origin — never a hardcoded host.
/* global describe, expect, it */

import { buildNotificationMail, escapeHtml } from '@/lib/notifications/templates';

const ORIGIN = 'https://share.example';

/** All four events 0058 can queue — every copy rule below sweeps this list. */
const EVENT_TYPES = [
  'interest_received',
  'interest_accepted',
  'interest_declined',
  'pitch_render_completed',
] as const;

function mail(
  eventType: Parameters<typeof buildNotificationMail>[0]['eventType'],
  overrides: Partial<Parameters<typeof buildNotificationMail>[0]> = {},
) {
  return buildNotificationMail({
    eventType,
    recipientName: 'Blair Dater',
    pitchDraftId: null,
    shareOrigin: ORIGIN,
    ...overrides,
  });
}

describe('notification templates — landing (T004 screens)', () => {
  it('the dater lands on the inbox', () => {
    const built = mail('interest_received');
    expect(built?.path).toBe('/inbox');
    expect(built?.text).toContain(`${ORIGIN}/inbox`);
  });

  it('both answers land the sender on their rooms', () => {
    expect(mail('interest_accepted')?.path).toBe('/rooms');
    expect(mail('interest_declined')?.path).toBe('/rooms');
  });

  it('a finished render lands on that draft’s kit page', () => {
    const built = mail('pitch_render_completed', { pitchDraftId: 'abc-123' });
    expect(built?.path).toBe('/kit/abc-123');
    expect(built?.text).toContain(`${ORIGIN}/kit/abc-123`);
  });

  it('a render event with no draft id is refused, not guessed at', () => {
    expect(mail('pitch_render_completed', { pitchDraftId: null })).toBeNull();
  });

  it('the host is the configured share origin, never a hardcoded one', () => {
    const built = mail('interest_received', { shareOrigin: 'https://friendword.test' });
    expect(built?.text).toContain('https://friendword.test/inbox');
    expect(built?.html).not.toContain('vercel.app');
    expect(built?.html).not.toContain('localhost');
  });
});

describe('notification templates — §12: only what the code gives', () => {
  const FORBIDDEN = [
    'will review',
    'will reply',
    'will respond',
    'soon',
    'within 24',
    'shortly',
    'check back',
    'guarantee',
    'hours',
    'minutes',
  ];

  it('no mail promises a timeline or an answer', () => {
    for (const eventType of EVENT_TYPES) {
      const built = mail(eventType, { pitchDraftId: 'draft-1' });
      expect(built, `${eventType} produced no mail`).not.toBeNull();
      const body = `${built?.subject ?? ''} ${built?.text ?? ''}`.toLowerCase();
      for (const phrase of FORBIDDEN) {
        expect(body, `${eventType} promises "${phrase}"`).not.toContain(phrase);
      }
    }
  });

  it('the decline notice states that no reason travels with it', () => {
    const built = mail('interest_declined');
    // The other end of the same promise is the inbox line the decider sees,
    // 'Declined. Your reason and details are never shared with them.', pinned
    // by tests/interest-decision.spec.ts. Both must say "no reason and no
    // details", or the product tells the two people different things about
    // one decision.
    expect(built?.text).toContain('No reason was shared with you');
    expect(built?.text).not.toContain('reason:');
  });

  it('no mail asserts that another mail was sent', () => {
    // §12 again, and the reason the inbox line stopped claiming a notice goes
    // out: queueing is not delivery. app_config can be off, the secret can be
    // unset, and an entry older than the max age expires unsent — so nothing
    // written here may promise the other person heard anything.
    for (const eventType of EVENT_TYPES) {
      const built = mail(eventType, { pitchDraftId: 'draft-1' });
      expect(built, `${eventType} produced no mail`).not.toBeNull();
      const body = `${built?.subject ?? ''} ${built?.text ?? ''}`.toLowerCase();
      for (const phrase of ['we emailed', 'we have emailed', 'they were notified', 'we notified']) {
        expect(body, `${eventType} claims "${phrase}"`).not.toContain(phrase);
      }
    }
  });
});

describe('notification templates — privacy of the payload', () => {
  it('a user-authored display name cannot inject markup', () => {
    const built = mail('interest_received', {
      recipientName: '<img src=x onerror="alert(1)">',
    });
    expect(built?.html).not.toContain('<img');
    expect(built?.html).toContain('&lt;img');
  });

  it('a blank name degrades to a neutral greeting rather than "Hi ,"', () => {
    expect(mail('interest_received', { recipientName: '   ' })?.text.startsWith('Hi,')).toBe(true);
    expect(mail('interest_received', { recipientName: null })?.text.startsWith('Hi,')).toBe(true);
  });

  it('escapeHtml covers the five characters that matter', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
  });
});
