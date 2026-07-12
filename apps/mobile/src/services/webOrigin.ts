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
