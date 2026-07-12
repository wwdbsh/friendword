import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import type { Database } from './database.types';

const clientScope = Symbol('Friendword Supabase client scope');

export type BrowserSupabaseClient = SupabaseClient<Database> & {
  readonly [clientScope]: 'browser';
};

export type ServiceSupabaseClient = SupabaseClient<Database> & {
  readonly [clientScope]: 'service';
};

export function createBrowserClient(url: string, anonKey: string): BrowserSupabaseClient {
  return Object.assign(createClient<Database>(url, anonKey), { [clientScope]: 'browser' as const });
}

/** Minimal async storage contract (matches @react-native-async-storage). */
export type AuthSessionStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

/**
 * React Native client: sessions persist in the provided async storage and
 * there is no URL to detect sessions from. Shares the browser scope so the
 * anon-key repos/auth helpers accept it.
 */
export function createMobileClient(
  url: string,
  anonKey: string,
  storage: AuthSessionStorage,
): BrowserSupabaseClient {
  return Object.assign(
    createClient<Database>(url, anonKey, {
      auth: {
        storage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    }),
    { [clientScope]: 'browser' as const },
  );
}

export function createServiceClient(url: string, serviceRoleKey: string): ServiceSupabaseClient {
  return Object.assign(
    createClient<Database>(url, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    }),
    { [clientScope]: 'service' as const },
  );
}
