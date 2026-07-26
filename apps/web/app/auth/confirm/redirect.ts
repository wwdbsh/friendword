/** Fallback destination when `redirect_to` is missing or points off-site. */
export const DEFAULT_REDIRECT_PATH = '/';

/**
 * Turns an emailed `redirect_to` into a path we are willing to navigate to.
 * Anything that does not resolve to `origin` is dropped: the value arrives from
 * an email, so an unchecked redirect would be an open redirect out of the
 * signed-in flow.
 */
export function resolveSameOriginPath(rawRedirect: string | null, origin: string): string {
  if (rawRedirect === null || rawRedirect.trim() === '') {
    return DEFAULT_REDIRECT_PATH;
  }

  let target: URL;
  try {
    target = new URL(rawRedirect, origin);
  } catch {
    return DEFAULT_REDIRECT_PATH;
  }

  if (target.origin !== origin) {
    return DEFAULT_REDIRECT_PATH;
  }

  const path = `${target.pathname}${target.search}${target.hash}`;
  return path.startsWith('/') ? path : DEFAULT_REDIRECT_PATH;
}
