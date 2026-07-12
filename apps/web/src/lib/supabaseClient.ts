import { createWebClient, type BrowserSupabaseClient } from '@friendword/data';

let cached: BrowserSupabaseClient | null | undefined;

/**
 * Browser-side anon client. Null when the public Supabase env vars are not
 * configured, so pages can degrade to a friendly setup message instead of
 * crashing at import time.
 */
export function getSupabaseBrowserClient(): BrowserSupabaseClient | null {
  if (cached === undefined) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    cached =
      url !== undefined && url !== '' && anonKey !== undefined && anonKey !== ''
        ? createWebClient(url, anonKey)
        : null;
  }

  return cached;
}
