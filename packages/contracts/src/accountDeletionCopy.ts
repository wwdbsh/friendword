/**
 * The confirmation contract for closing an account — one copy, both surfaces.
 *
 * T013 shipped the web half as a deliberate mirror of the mobile screen and
 * said so in its own doc comment: "the honest place for a single source would
 * be a shared package, and moving the mobile screen's exports there is mobile
 * work (T014)". This is that move. Two identical nine-line lists in two apps is
 * one list that will drift the first time a privacy fact changes and only one
 * of them is edited, and the thing that drifts is a promise about somebody's
 * data.
 *
 * It lives in `contracts` rather than in either app because `apps/web` and
 * `apps/mobile` may not import each other, and both already depend on this
 * package. It is copy, not a schema — but it is copy the code is held to, which
 * is the same thing a contract is.
 *
 * Every line is a claim the code keeps; `docs/PRIVACY_DATA_MAP.md` is the table
 * this is the plain-language version of.
 */

/** The word the second gate requires, typed exactly. */
export const ACCOUNT_DELETION_CONFIRMATION_WORD = 'DELETE';

/**
 * The second gate. A click (or a tap) is a mis-tap; typing the word is not.
 * Surrounding whitespace is forgiven because mobile keyboards add it — nothing
 * else is, so a lower-case "delete" does not arm the button.
 */
export function accountDeletionConfirmationMatches(typed: string): boolean {
  return typed.trim() === ACCOUNT_DELETION_CONFIRMATION_WORD;
}

/**
 * What deletion actually does, in the order a person cares about:
 *
 * - "closed the moment you confirm": `request_account_deletion` (0037) flips
 *   `account_status` to 'deleted' in the same transaction, and every guarded
 *   RPC refuses a non-active account from then on.
 * - "erased later, on a schedule": the physical erasure is
 *   `scripts/process-deletions.mjs`, run by the daily scheduled-ops pass. No
 *   time is promised here because none is guaranteed — docs/OPS.md is explicit
 *   that daily is a floor, not an SLA.
 * - "interests are deleted, not anonymised": the job runs
 *   `DELETE FROM interests WHERE sender_user_id = …`, and the intro rooms the
 *   account is in go with it, taking both sides' messages.
 * - "a pitch you recorded for a friend stays with them": the draft is
 *   transferred to the campaign owner, but the voice — and the rendered video
 *   that copies the same audio — is erased, and 0037 archives the campaign
 *   that just lost it.
 * - "the words you wrote and the text transcript": `pitch_drafts.headline`,
 *   `.body` and `.transcript`, plus the `consent_revisions` snapshot, are kept
 *   deliberately (the approval record is an audit object, and 0032 froze the
 *   transcript into the revision the dater approved). Saying only that the
 *   voice goes would let someone believe their words go with it.
 * - "safety reports are kept": the job nulls the user references and marks the
 *   report anonymous rather than deleting it.
 *
 * Deliberately free of anything only one surface can claim: nothing here says
 * "on this phone", because a browser holds no drafts. The mobile screen adds
 * what it clears locally in its own words, next to this list.
 */
export const ACCOUNT_DELETION_FACTS: readonly string[] = [
  'Your account is closed the moment you confirm. It stops working right away.',
  'Erasing the data itself happens afterwards, on a scheduled job. We will not promise you a time for it.',
  'Erased: your profile and photos, your voice recordings, the pitches you made, the interests you sent, and your chats.',
  'Interests you sent are deleted, not anonymised. They disappear from the inbox of the person you sent them to, and any chat you opened with them goes too — for both of you.',
  'A pitch you recorded for a friend stays with them as their campaign, but your voice recording and any video made from it are erased, so that campaign is archived and stops being public.',
  'What stays on that pitch is the written part your friend approved, including the words you wrote and the text transcript of what you said. It is their record of what they agreed to publish.',
  'Safety reports about or from you are kept for our moderation record, with your account removed from them.',
  'Anything already shared or downloaded by other people cannot be called back.',
  'This cannot be undone.',
];
