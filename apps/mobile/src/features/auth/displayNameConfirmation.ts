import {
  confirmDisplayName,
  getDisplayNameStatus,
  type BrowserSupabaseClient,
} from '@friendword/data';

/**
 * Asking the introducer what to call them, before their name goes anywhere.
 *
 * T002 (Issue #71). `private.handle_new_auth_user` (0011) creates a profile
 * with `display_name` set to the email local-part and
 * `display_name_confirmed = false`, because a bootstrap cannot know what
 * somebody wants to be called in front of the person they are introducing.
 * The web consent and interest flows have asked since 0011; the mobile
 * introducer — the person whose name is printed on the pitch — never did.
 *
 * The public surfaces now withhold an unconfirmed name (0061 for the anonymous
 * consent preview, `publicDisplayName` for everything else), so this gate is
 * about the introducer getting to CHOOSE their name rather than about
 * containing a leak. That is why it fails open: if the status cannot be read,
 * the submit proceeds and the pitch simply carries no introducer name until
 * the account screen sets one.
 */

/** `profiles_display_name_length_check` (migration 0025). */
export const DISPLAY_NAME_MAX_LENGTH = 60;

export const DISPLAY_NAME_EMPTY_MESSAGE = 'Enter the name your friend should see.';
export const DISPLAY_NAME_TOO_LONG_MESSAGE = `Keep it to ${DISPLAY_NAME_MAX_LENGTH} characters or fewer.`;

/**
 * - `confirmed`: this account has approved a display name.
 * - `needs_confirmation`: it has not, and the submit should ask first.
 * - `unavailable`: there is nobody signed in, no server configured, or the
 *   read failed. Never a reason to block a submit — see the note above.
 */
export type DisplayNameGate = 'confirmed' | 'needs_confirmation' | 'unavailable';

export type DisplayNameProblem = 'empty' | 'too_long';

/**
 * What is wrong with a typed name, or `null` when nothing is.
 *
 * `too_long` is measured on the TRIMMED value because that is what is stored,
 * and it is checked here rather than left to the database: a CHECK violation
 * arrives as an opaque failure in the middle of sending a pitch.
 */
export function validateDisplayName(value: string): DisplayNameProblem | null {
  const trimmed = value.trim();
  if (trimmed === '') {
    return 'empty';
  }
  if (trimmed.length > DISPLAY_NAME_MAX_LENGTH) {
    return 'too_long';
  }
  return null;
}

export function displayNameProblemMessage(problem: DisplayNameProblem): string {
  return problem === 'empty' ? DISPLAY_NAME_EMPTY_MESSAGE : DISPLAY_NAME_TOO_LONG_MESSAGE;
}

export async function readDisplayNameGate(
  client: BrowserSupabaseClient | null,
): Promise<DisplayNameGate> {
  if (client === null) {
    return 'unavailable';
  }
  try {
    const status = await getDisplayNameStatus(client);
    return status.confirmed ? 'confirmed' : 'needs_confirmation';
  } catch {
    // Nobody signed in (the submit path has its own sign-in sheet, and asking
    // for a name before an account exists is the wrong order), or the read
    // failed. Neither is a reason to refuse to send the pitch.
    return 'unavailable';
  }
}

/**
 * Writes the name and then RE-READS the server's answer.
 *
 * The re-read is the point: `confirmDisplayName` resolving means the request
 * did not error, not that this device's idea of the account is now true. The
 * submit continues on what the server says, never on local state.
 */
export async function confirmAndRecheckDisplayName(
  client: BrowserSupabaseClient | null,
  name: string,
): Promise<DisplayNameGate> {
  if (client === null) {
    return 'unavailable';
  }
  await confirmDisplayName(client, name.trim());
  return readDisplayNameGate(client);
}
