import styles from '@/styles/flowCard.module.css';

/**
 * §12: every clause is something the code knows.
 *
 * - "You were signed out" — `useSession` saw a session it actually held become
 *   null. It does NOT say why: a failed refresh, an expiry and a sign-out in
 *   another tab all arrive as the same event, and naming one would be a guess.
 * - "Nothing here was lost" — the four account surfaces read everything they
 *   show from the server on each load. None of them holds unsaved work.
 * - "Sign in again to open it" — the form directly below is the whole
 *   instruction. No time, no promise about what will be waiting.
 */
export const SIGNED_OUT_NOTICE =
  'You were signed out. Nothing here was lost — sign in again to open it.';

/**
 * The one signed-out explanation the account surfaces share (T008, Issue #45).
 *
 * Before this, an inbox whose session expired swapped itself for the same
 * "See who wants to meet you." sign-in card a first-time visitor gets, with no
 * word that anything had changed — indistinguishable from having lost the
 * account. Rendered only when a session actually ended on this mount.
 */
export function SignedOutNotice({ ended }: { readonly ended: boolean }) {
  if (!ended) {
    return null;
  }

  return (
    <p className={styles.signedOutNotice} role="status">
      {SIGNED_OUT_NOTICE}
    </p>
  );
}
