import { describe, expect, it } from 'vitest';

import {
  ACCOUNT_DELETION_CONFIRMATION_WORD,
  ACCOUNT_DELETION_FACTS,
  accountDeletionConfirmationMatches,
} from './accountDeletionCopy';

/**
 * T014 (T013 carry-over). The confirmation copy used to exist twice — once in
 * `apps/web/src/lib/accountDeletion.ts` and once in
 * `apps/mobile/app/account/index.tsx` — with nothing keeping the two in step.
 * Both now import this module, so these tests are the single place the promise
 * is pinned, and each app has a test asserting it renders THIS array rather
 * than a copy of it.
 */
describe('the account deletion confirmation word', () => {
  it('arms only on the exact word, whitespace forgiven', () => {
    expect(accountDeletionConfirmationMatches('DELETE')).toBe(true);
    expect(accountDeletionConfirmationMatches('  DELETE  ')).toBe(true);
    expect(accountDeletionConfirmationMatches('delete')).toBe(false);
    expect(accountDeletionConfirmationMatches('Delete')).toBe(false);
    expect(accountDeletionConfirmationMatches('DELETE ME')).toBe(false);
    expect(accountDeletionConfirmationMatches('')).toBe(false);
  });

  it('is the word both surfaces print', () => {
    expect(ACCOUNT_DELETION_CONFIRMATION_WORD).toBe('DELETE');
  });
});

describe('the account deletion facts', () => {
  it('says the account closes immediately and the erasure is scheduled', () => {
    const copy = ACCOUNT_DELETION_FACTS.join(' ');

    expect(copy).toContain('closed the moment you confirm');
    expect(copy).toContain('scheduled job');
    expect(copy).toContain('will not promise you a time');
  });

  it('keeps the two claims a shorter list would flatten into a false one', () => {
    const copy = ACCOUNT_DELETION_FACTS.join(' ');

    // Interests are deleted rather than anonymised, and the pitch a person
    // recorded for a friend survives as writing while its voice is erased.
    expect(copy).toContain('deleted, not anonymised');
    expect(copy).toContain('voice recording and any video made from it are erased');
    expect(copy).toContain('the words you wrote and the text transcript');
    expect(copy).toContain('Safety reports');
    expect(copy).toContain('cannot be undone');
  });

  it('claims nothing a browser cannot keep, so one list can serve both surfaces', () => {
    // "on this phone" is a mobile-only claim; the shared list must not make it.
    const copy = ACCOUNT_DELETION_FACTS.join(' ').toLowerCase();

    expect(copy).not.toContain('this phone');
    expect(copy).not.toContain('this device');
    expect(copy).not.toContain('the app');
  });
});
