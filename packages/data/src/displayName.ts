/**
 * Which display names may be shown to someone who is not the person named.
 *
 * `private.handle_new_auth_user` (0011) seeds `profiles.display_name` from the
 * email local-part — "sanghyun.lee92" — and marks it `display_name_confirmed
 * = false`, because a bootstrap cannot know whether the person agrees to be
 * introduced under a fragment of their email address. A name in that state is
 * a placeholder for the account's own screens, never a name to print on a
 * shared page, an OG card, a launch-kit image, or an email to a stranger.
 *
 * Every public reader routes its display names through here so the rule is one
 * function rather than a convention. The database has the same gate for the one
 * public reader it owns (`get_consent_preview`, migration 0061).
 */
export type DisplayNameProfile = {
  readonly display_name: string;
  readonly display_name_confirmed: boolean;
};

/**
 * The name to show publicly, or `null` when there is none to show.
 *
 * `null` is deliberately not a fallback string: each caller decides what its
 * own surface says instead, because "A friend" reads well as a card title and
 * badly in the middle of a sentence.
 */
export function publicDisplayName(profile: DisplayNameProfile | null | undefined): string | null {
  if (profile === null || profile === undefined || !profile.display_name_confirmed) {
    return null;
  }
  const trimmed = profile.display_name.trim();
  return trimmed === '' ? null : trimmed;
}
