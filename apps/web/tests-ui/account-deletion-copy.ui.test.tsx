import {
  ACCOUNT_DELETION_CONFIRMATION_WORD as SHARED_WORD,
  ACCOUNT_DELETION_FACTS as SHARED_FACTS,
  accountDeletionConfirmationMatches as sharedMatches,
} from '@friendword/contracts';
import { describe, expect, it } from 'vitest';

import {
  ACCOUNT_DELETION_CONFIRMATION_WORD,
  ACCOUNT_DELETION_FACTS,
  accountDeletionConfirmationMatches,
} from '@/lib/accountDeletion';

/**
 * T014 (T013 carry-over). T013 shipped these constants as a deliberate mirror
 * of the mobile screen's and said the honest fix was a shared package. This is
 * the web half of that fix: `@/lib/accountDeletion` is now an import site, not
 * a second copy, and identity — not string equality — is what says so. A
 * re-typed twin of the array would satisfy `toEqual` and fail `toBe`.
 */
describe('the web deletion copy has exactly one source', () => {
  it('re-exports the shared contracts copy rather than restating it', () => {
    expect(ACCOUNT_DELETION_FACTS).toBe(SHARED_FACTS);
    expect(ACCOUNT_DELETION_CONFIRMATION_WORD).toBe(SHARED_WORD);
    expect(accountDeletionConfirmationMatches).toBe(sharedMatches);
  });

  it('keeps the confirmation gate the mobile screen enforces', () => {
    expect(accountDeletionConfirmationMatches('DELETE')).toBe(true);
    expect(accountDeletionConfirmationMatches('  DELETE ')).toBe(true);
    expect(accountDeletionConfirmationMatches('delete')).toBe(false);
  });

  it('still carries every line the inbox is expected to print', () => {
    expect(ACCOUNT_DELETION_FACTS).toHaveLength(9);
    expect(ACCOUNT_DELETION_FACTS.join(' ')).toContain('closed the moment you confirm');
    expect(ACCOUNT_DELETION_FACTS.at(-1)).toBe('This cannot be undone.');
  });
});
