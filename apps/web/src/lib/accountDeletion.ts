/**
 * The confirmation contract for closing an account, on the web.
 *
 * T013 wrote these constants here as a deliberate mirror of the mobile screen
 * and named the fix: "the honest place for a single source would be a shared
 * package, and moving the mobile screen's exports there is mobile work (T014)".
 * T014 made that move — the copy, the word and the matching rule now live in
 * `@friendword/contracts` (`accountDeletionCopy.ts`), which both apps already
 * depend on and neither owns.
 *
 * This module stays as the web's import site so the pages keep one local name
 * for the thing, and so a future web-only addition has somewhere to go. It adds
 * nothing of its own: what it exports IS the shared array, by identity, and
 * `apps/web/src/lib/accountDeletion.test.ts` asserts exactly that.
 */
export {
  ACCOUNT_DELETION_CONFIRMATION_WORD,
  ACCOUNT_DELETION_FACTS,
  accountDeletionConfirmationMatches,
} from '@friendword/contracts';
