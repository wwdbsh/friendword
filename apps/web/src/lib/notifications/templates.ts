import type { NotificationEventType } from '@friendword/data';

/**
 * The four notification mails, as pure functions of (event, recipient's own
 * name, landing parameter). No network, no database, no environment — so the
 * copy rules below are unit-testable and cannot drift with the sender.
 *
 * COPY RULES (CLAUDE.md §12 — say only what the code gives):
 *   - No timing promise. Nothing here says "soon", "within 24 hours", "we will
 *     review", or "they will reply". The product makes no such guarantee.
 *   - No claim about the other person. Whether they read it, when they answer,
 *     or whether they answer at all is not something the server knows.
 *   - Every sentence names something the database has already recorded.
 *   - No mail claims that another mail was sent. Delivery depends on a queue,
 *     an app_config switch and a provider, none of which this module can see.
 *
 * TWO SURFACES, ONE SENTENCE. The declined mail's "No reason was shared with
 * you" and the inbox's "Declined. Your reason and details are never shared
 * with them." are the same promise read from the two ends of the same
 * decision, and they must stay that way: the mail is pinned by
 * notification-templates.audit3.test.ts, the inbox line by
 * tests/interest-decision.spec.ts. Weakening one without the other would let
 * the product tell the two people different things about the same event.
 *
 * PRIVACY RULES (0058 decision 2):
 *   - The only personal datum in a mail is the RECIPIENT'S OWN display name.
 *     No sender name, no profile photo, no bio, no interest note, no message
 *     body, and no campaign slug — an inbox is not a safe place to mirror
 *     someone else's profile, and a forwarded mail must not leak one.
 *   - The display name is user-authored text, so it is HTML-escaped before it
 *     reaches the markup.
 */
export type NotificationMail = {
  readonly subject: string;
  /** Origin-relative landing path (T004 screens). */
  readonly path: string;
  readonly html: string;
  readonly text: string;
};

type Copy = {
  readonly subject: string;
  readonly heading: string;
  readonly body: readonly string[];
  readonly actionLabel: string;
};

const FOOTER =
  'This is a service message about activity on your Friendword account. ' +
  'Friendword only mails you about things that happened on it.';

function copyFor(eventType: NotificationEventType): Copy | null {
  switch (eventType) {
    case 'interest_received':
      return {
        subject: 'Someone sent interest through your Friendword pitch',
        heading: 'A new interest is waiting.',
        body: [
          'Someone used your campaign page to send you an interest.',
          'Your inbox is where you see it and answer. Accepting is what opens a private intro room; declining shares no details with them.',
        ],
        actionLabel: 'Open my inbox',
      };
    case 'interest_accepted':
      return {
        subject: 'Your Friendword interest was accepted',
        heading: 'Your interest was accepted.',
        body: [
          'A private intro room is open for the two of you.',
          'Messages live in the room, not in email.',
        ],
        actionLabel: 'Open my intro rooms',
      };
    case 'interest_declined':
      return {
        subject: 'An answer to your Friendword interest',
        heading: 'This one did not go forward.',
        body: [
          'Your interest was declined. No reason was shared with you, and nothing further is needed from you.',
          'Any intro rooms you already have are unaffected.',
        ],
        actionLabel: 'See my intro rooms',
      };
    case 'pitch_render_completed':
      return {
        subject: 'Your Friendword video is ready',
        heading: 'Your video finished rendering.',
        body: ['The MP4 export of the approved pitch is ready to download from the share kit.'],
        actionLabel: 'Open the share kit',
      };
    default:
      return null;
  }
}

/**
 * The landing path per event (T004 screens). `pitch_render_completed` is the
 * only one that takes a parameter, and it is refused without one rather than
 * guessed at — a mail whose button goes nowhere is worse than no mail.
 */
function pathFor(eventType: NotificationEventType, pitchDraftId: string | null): string | null {
  switch (eventType) {
    case 'interest_received':
      return '/inbox';
    case 'interest_accepted':
    case 'interest_declined':
      return '/rooms';
    case 'pitch_render_completed':
      return pitchDraftId === null ? null : `/kit/${encodeURIComponent(pitchDraftId)}`;
    default:
      return null;
  }
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * A display name is user-authored and arrives from `profiles`. Trim it, cap
 * it, and drop it entirely if it is empty — an over-long or blank name becomes
 * the neutral greeting rather than deformed markup.
 */
function greeting(recipientName: string | null): string {
  const trimmed = (recipientName ?? '').trim().slice(0, 60);
  return trimmed === '' ? 'Hi,' : `Hi ${trimmed},`;
}

export function buildNotificationMail(input: {
  readonly eventType: NotificationEventType;
  readonly recipientName: string | null;
  readonly pitchDraftId: string | null;
  readonly shareOrigin: string;
}): NotificationMail | null {
  const copy = copyFor(input.eventType);
  const path = pathFor(input.eventType, input.pitchDraftId);
  if (copy === null || path === null) {
    return null;
  }
  // Built through `new URL` so a malformed configured origin throws here
  // rather than mailing a broken link (endCard.ts precedent).
  const url = new URL(path, input.shareOrigin).toString();
  const hello = greeting(input.recipientName);

  const text = [
    hello,
    '',
    copy.heading,
    ...copy.body,
    '',
    `${copy.actionLabel}: ${url}`,
    '',
    FOOTER,
  ].join('\n');

  const html = [
    '<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif;',
    'font-size:16px;line-height:1.6;color:#161616;max-width:520px;margin:0 auto;padding:24px">',
    `<p style="margin:0 0 16px">${escapeHtml(hello)}</p>`,
    `<h1 style="font-size:20px;line-height:1.3;margin:0 0 12px">${escapeHtml(copy.heading)}</h1>`,
    ...copy.body.map((line) => `<p style="margin:0 0 12px">${escapeHtml(line)}</p>`),
    `<p style="margin:24px 0"><a href="${escapeHtml(url)}" `,
    'style="display:inline-block;background:#161616;color:#ffffff;text-decoration:none;',
    `padding:12px 20px;border-radius:8px">${escapeHtml(copy.actionLabel)}</a></p>`,
    `<p style="margin:24px 0 0;font-size:13px;color:#6b6b6b">${escapeHtml(FOOTER)}</p>`,
    '</div>',
  ].join('');

  return { subject: copy.subject, path, html, text };
}
