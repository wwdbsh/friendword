import 'server-only';

import { createServiceClient, type ServiceSupabaseClient } from '@friendword/data';

/**
 * Service-role client for server components. Never import from client code —
 * the 'server-only' marker makes that a build error. Null when the server
 * env vars are missing so pages can fall back to fixtures.
 */
export function getSupabaseServiceClient(): ServiceSupabaseClient | null {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url === undefined || url === '' || serviceRoleKey === undefined || serviceRoleKey === '') {
    return null;
  }

  return createServiceClient(url, serviceRoleKey);
}
