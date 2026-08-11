import { timingSafeEqual } from 'node:crypto';

/**
 * Shared secret for the notification sender endpoint, mirroring the ingest and
 * render workers (FRIENDWORD_MEDIA_* precedent): operators, the opportunistic
 * kick relay and the scheduled backstop call it; browsers never do — a browser
 * that held this could drain the queue and, worse, cause mail to be sent.
 * Null when the environment is not configured, which the route reports as 501.
 */
export function notificationSendSecret(): string | null {
  const secret = process.env.FRIENDWORD_NOTIFY_SECRET;
  return secret !== undefined && secret.length >= 16 ? secret : null;
}

export function notificationSecretMatches(provided: string, expected: string): boolean {
  const providedBytes = Buffer.from(provided);
  const expectedBytes = Buffer.from(expected);
  return (
    providedBytes.length === expectedBytes.length && timingSafeEqual(providedBytes, expectedBytes)
  );
}
