/**
 * Decides whether an auth state change must wipe the raw consent bearer tokens
 * held in local drafts.
 *
 * The token lets its holder open a dater's private approval flow, so it must
 * not survive on a device that has signed out (`SIGNED_OUT`) or been handed to
 * a *different* account (`SIGNED_IN` with a changed user id). A cold-start
 * sign-in (`previousUserId === undefined`) or a same-user token refresh keeps
 * the tokens — they belong to the user resuming their own session.
 */
export function shouldPurgeConsentTokensOnAuthChange(
  event: string,
  previousUserId: string | null | undefined,
  nextUserId: string | null,
): boolean {
  if (event === 'SIGNED_OUT') {
    return true;
  }
  if (event === 'SIGNED_IN') {
    return previousUserId !== undefined && previousUserId !== nextUserId;
  }
  return false;
}
