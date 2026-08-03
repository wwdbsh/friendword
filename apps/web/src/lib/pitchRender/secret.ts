import { timingSafeEqual } from 'node:crypto';

/**
 * Shared secret for the render worker endpoint, mirroring the ingest worker's
 * pattern: operators and job triggers call it, browsers never do. Null when the
 * environment is not configured, which the route reports as 501.
 */
export function renderRunSecret(): string | null {
  const secret = process.env.FRIENDWORD_MEDIA_RENDER_SECRET;
  return secret !== undefined && secret.length >= 16 ? secret : null;
}

export function renderSecretMatches(provided: string, expected: string): boolean {
  const providedBytes = Buffer.from(provided);
  const expectedBytes = Buffer.from(expected);
  return (
    providedBytes.length === expectedBytes.length && timingSafeEqual(providedBytes, expectedBytes)
  );
}
