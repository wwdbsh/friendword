import 'server-only';

import type { ServiceSupabaseClient } from '@friendword/data';

/**
 * Second audit H-1: service-role API routes must not do work (provider
 * calls, storage reads, writes) for suspended, deletion-requested, or
 * deleted accounts. Fail closed: an unreadable row counts as inactive.
 */
export async function isActiveAccount(
  serviceClient: ServiceSupabaseClient,
  userId: string,
): Promise<boolean> {
  const { data, error } = await serviceClient
    .from('users')
    .select('account_status')
    .eq('id', userId)
    .maybeSingle();
  if (error !== null || data === null) {
    return false;
  }
  return data.account_status === 'active';
}
