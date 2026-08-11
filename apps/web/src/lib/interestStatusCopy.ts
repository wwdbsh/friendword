import type { MyInterest } from '@friendword/data';

/**
 * The sender's own view of an interest they sent (T006, Issue #43).
 *
 * One vocabulary for two surfaces: the /p/[slug]/interest status card a
 * returning sender lands on, and the /interests list. They were written once
 * because they describe the SAME row — two hand-written variants would drift,
 * and only one of them can be the true one.
 *
 * §12 boundary. Every sentence here is limited to what the row already proves:
 *
 *  - 'submitted' means an `interests` row exists at status 'submitted', which
 *    is exactly what `list_campaign_interests` shows the dater. "It is in their
 *    inbox" is therefore a fact about state, not a forecast. No sentence may
 *    promise a reply, a review, or a timeline — the product has none.
 *  - 'accepted' means `decide_interest` created the intro room (0006/0044), so
 *    the room is a real screen and gets a link rather than an instruction.
 *  - 'declined' means the dater answered; `submit_interest` refuses any further
 *    submission for an answered interest ('this interest was already answered'),
 *    so "cannot be sent again" is enforced by the RPC, not a policy sentence.
 *    Nothing here attributes a reason to the dater: the decline reason is never
 *    shared, which is the promise the dater's own decline copy makes.
 */
export type SenderInterestStatus = MyInterest['interestStatus'];

/**
 * Statuses that mean the interest already reached the dater's inbox and must
 * not send the visitor back through the profile form. 'started' and
 * 'verification_pending' never left the sender, and 'withdrawn' was taken back
 * — for those three the staged flow is still the correct screen.
 *
 * Mirrors `submit_interest`'s own ON CONFLICT boundary minus 'submitted': the
 * RPC would accept a resubmit of a 'submitted' row, but walking a whole profile
 * form to re-deliver an interest that is already there only re-notifies the
 * dater, and answered rows ('accepted'/'declined') are refused outright.
 */
const DELIVERED_STATUSES: readonly SenderInterestStatus[] = ['submitted', 'accepted', 'declined'];

export function isDeliveredInterest(status: SenderInterestStatus): boolean {
  return DELIVERED_STATUSES.includes(status);
}

/** Short badge word for one interest, from the sender's side. */
export function senderStatusLabel(status: SenderInterestStatus): string {
  switch (status) {
    case 'started':
      return 'Not sent';
    case 'verification_pending':
      return 'Not sent';
    case 'submitted':
      return 'Sent';
    case 'accepted':
      return 'Accepted';
    case 'declined':
      return 'Declined';
    case 'withdrawn':
      return 'Withdrawn';
    default:
      return assertNever(status);
  }
}

/**
 * The one sentence(s) that describe the state. Deliberately free of the dater's
 * name so both surfaces share the exact string; the screens carry the name in
 * their own heading, where it is theirs to phrase.
 */
export function senderStatusBody(status: SenderInterestStatus): string {
  switch (status) {
    case 'started':
      return 'This was never sent, so nothing about it reached them.';
    case 'verification_pending':
      return 'This was never sent: it still needs a completed dating profile — 2 current photos, a short bio, and your dating intent.';
    case 'submitted':
      return 'It is in their inbox. What happens next is up to them — a reply is not promised, and there is no timeline. If they accept, a private intro room opens for the two of you; your email and phone number stay hidden either way.';
    case 'accepted':
      return 'A private intro room is open for the two of you. Messages are answered there, and your email and phone number stay hidden.';
    case 'declined':
      return 'No reason was shared with you, and this interest cannot be sent again.';
    case 'withdrawn':
      return 'You withdrew this interest.';
    default:
      return assertNever(status);
  }
}

/** Campaign-level context. Null when the campaign is live and needs no caption. */
export function campaignStateNote(campaignStatus: MyInterest['campaignStatus']): string | null {
  switch (campaignStatus) {
    case 'published':
      return null;
    case 'paused':
      return 'This campaign is paused, so its public page is not open right now.';
    case 'expired':
      return 'This campaign’s window has ended, so its public page is closed.';
    case 'archived':
      return 'This campaign was taken down for good.';
    default:
      return assertNever(campaignStatus);
  }
}

/** The pitch page 404s unless the campaign is published — never link a dead URL. */
export function pitchHref(interest: MyInterest): string | null {
  return interest.campaignSlug !== null && interest.campaignStatus === 'published'
    ? `/p/${interest.campaignSlug}`
    : null;
}

export function senderInterestTitle(interest: MyInterest): string {
  const name = interest.daterDisplayName?.trim();
  if (name !== undefined && name !== '') {
    return name;
  }
  const headline = interest.campaignHeadline?.trim();
  return headline !== undefined && headline !== '' ? headline : 'A Friendword member';
}

/** "Sent 13 Jul 2026", or the honest absence of a submission date. */
export function formatSentAt(submittedAt: string | null): string {
  if (submittedAt === null) {
    return 'Never sent';
  }
  const date = new Date(submittedAt);
  if (Number.isNaN(date.getTime())) {
    return 'Sent — date unavailable';
  }
  return `Sent ${date.toLocaleDateString('en-US', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })}`;
}

function assertNever(value: never): never {
  throw new Error(`unhandled interest state: ${JSON.stringify(value)}`);
}
