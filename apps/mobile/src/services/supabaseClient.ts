import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createMobileClient, type BrowserSupabaseClient } from '@friendword/data';
import Constants from 'expo-constants';
import { z } from 'zod';

const extraSchema = z.object({
  supabaseUrl: z.url(),
  supabaseAnonKey: z.string().min(1),
});

let cached: BrowserSupabaseClient | null | undefined;

/**
 * Returns the shared Supabase client, or null when the root .env does not
 * provide EXPO_PUBLIC_SUPABASE_* values — callers must treat null as
 * "local mock mode", never as an error.
 */
export function getSupabaseClient(): BrowserSupabaseClient | null {
  if (cached !== undefined) {
    return cached;
  }

  const parsed = extraSchema.safeParse(Constants.expoConfig?.extra);
  cached = parsed.success
    ? createMobileClient(parsed.data.supabaseUrl, parsed.data.supabaseAnonKey, AsyncStorage)
    : null;
  return cached;
}
