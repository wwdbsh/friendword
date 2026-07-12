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
