import { z } from 'zod';

/**
 * Server-side environment contract. Client apps must only ever see
 * EXPO_PUBLIC_* / NEXT_PUBLIC_* values; the service role key never
 * ships to a client (FRIENDWORD_HANDOFF.md, "API 경계").
 */
export const serverEnvSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  REVENUECAT_WEBHOOK_AUTH_TOKEN: z.string().min(1),
});

export const clientEnvKeys = [
  'EXPO_PUBLIC_SUPABASE_URL',
  'EXPO_PUBLIC_SUPABASE_ANON_KEY',
  'EXPO_PUBLIC_REVENUECAT_IOS_API_KEY',
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
] as const;

export type ServerEnv = z.infer<typeof serverEnvSchema>;
