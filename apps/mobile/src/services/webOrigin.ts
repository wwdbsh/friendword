import Constants from 'expo-constants';
import { z } from 'zod';

const originSchema = z.url();

/**
 * Where the web surface lives — consent links sent to the dater point here.
 * Falls back to the local dev server so the flow stays walkable end-to-end
 * before a production domain exists.
 */
export function getWebOrigin(): string {
  const extra: unknown = Constants.expoConfig?.extra?.['webOrigin'];
  const parsed = originSchema.safeParse(extra);
  return parsed.success ? parsed.data.replace(/\/$/, '') : 'http://localhost:3000';
}

export function buildConsentUrl(consentToken: string): string {
  return `${getWebOrigin()}/consent/${consentToken}`;
}

/**
 * The dater's own interest inbox. Accepting, declining, pausing and taking a
 * page down all live on the web surface, so mobile links out instead of
 * describing a screen the app does not have (T004 / FUN-2).
 */
export function buildInboxUrl(): string {
  return `${getWebOrigin()}/inbox`;
}

/** Intro rooms — the only place an accepted introduction can be answered. */
export function buildRoomsUrl(): string {
  return `${getWebOrigin()}/rooms`;
}
