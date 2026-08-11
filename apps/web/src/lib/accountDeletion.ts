/**
 * The confirmation contract for closing an account, on the web (T013, carried
 * over from T007 / Issue #44).
 *
 * The mobile screen (`apps/mobile/app/account/index.tsx`) makes a person read
 * what deletion does and then TYPE the word before the button arms. The web
 * asked once, in a `window.confirm()` — a single OK on a system dialog most
 * people dismiss reflexively — for the identical irreversible act on the
 * identical RPC. Two surfaces, one consequence, so: one bar.
 *
 * These constants are a deliberate mirror rather than a shared import. `apps/web`
 * and `apps/mobile` are separate applications and neither may import the other;
 * the honest place for a single source would be a shared package, and moving
 * the mobile screen's exports there is mobile work (T014) that this task is not
 * allowed to touch. `accountDeletionConfirmationMatches` and its mobile twin
 * `isDeleteConfirmed` are pinned to the same rule by tests on both sides.
 */
export const ACCOUNT_DELETION_CONFIRMATION_WORD = 'DELETE';

/**
 * The second gate. A click is a mis-tap; typing the word is not. Surrounding
 * whitespace is forgiven because mobile keyboards add it — nothing else is, so
 * a lower-case "delete" does not arm the button.
 */
export function accountDeletionConfirmationMatches(typed: string): boolean {
  return typed.trim() === ACCOUNT_DELETION_CONFIRMATION_WORD;
}

/**
 * What deletion actually does, in the order a person cares about — the same
 * facts the mobile screen prints, trimmed to what the WEB can honestly claim.
 *
 * Every line is a claim the code keeps; `docs/PRIVACY_DATA_MAP.md` is the table
 * this is the plain-language version of. The mobile-only line about drafts
 * saved on the phone is left out here: a browser holds none.
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
