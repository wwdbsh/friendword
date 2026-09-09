// The canonical origin every shared surface prints its links against.
//
// It lives in its own module because its callers are not all renderers: the
// notifications route and the render routes need it too, and importing it from
// endCard.ts dragged `qrcode` (and its transitive deps) into every one of those
// bundles. Nothing here has a dependency of any kind.

/**
 * An explicit env override first (friendword.com is not registered yet, so
 * nothing is ever hardcoded), then the production deployment host — the same
 * precedence the public page's metadata uses.
 */
export function resolveShareOrigin(fallbackOrigin: string | null): string | null {
  const configured = process.env.FRIENDWORD_SHARE_ORIGIN;
  if (configured !== undefined && configured.length > 0) {
    return configured;
  }
  const deploymentHost = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? null;
  if (deploymentHost !== null && deploymentHost.length > 0) {
    return `https://${deploymentHost}`;
  }
  return fallbackOrigin;
}
