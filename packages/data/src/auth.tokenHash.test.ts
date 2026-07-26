import { describe, expect, it, vi } from 'vitest';

import type { Session } from '@supabase/supabase-js';

import { verifyOtpTokenHash } from './auth';
import type { BrowserSupabaseClient } from './client';
import { DataLayerError } from './errors';

type VerifyOtpResult = {
  readonly data: { readonly session: Session | null };
  readonly error: { readonly message: string } | null;
};

function clientWithVerifyOtp(result: VerifyOtpResult): {
  readonly client: BrowserSupabaseClient;
  readonly verifyOtp: ReturnType<typeof vi.fn>;
} {
  const verifyOtp = vi.fn().mockResolvedValue(result);
  const client = { auth: { verifyOtp } } as unknown as BrowserSupabaseClient;

  return { client, verifyOtp };
}

describe('verifyOtpTokenHash', () => {
  it('exchanges a magic-link token hash for a session without an email', async () => {
    const session = { access_token: 'token' } as unknown as Session;
    const { client, verifyOtp } = clientWithVerifyOtp({ data: { session }, error: null });

    await expect(verifyOtpTokenHash(client, '  hash-from-email  ')).resolves.toBe(session);
    expect(verifyOtp).toHaveBeenCalledWith({ token_hash: 'hash-from-email', type: 'email' });
  });

  it('wraps a consumed or expired token hash in a DataLayerError', async () => {
    const { client } = clientWithVerifyOtp({
      data: { session: null },
      error: { message: 'Email link is invalid or has expired' },
    });

    await expect(verifyOtpTokenHash(client, 'hash-from-email')).rejects.toBeInstanceOf(
      DataLayerError,
    );
  });

  it('rejects an empty token hash before calling Supabase', async () => {
    const { client, verifyOtp } = clientWithVerifyOtp({ data: { session: null }, error: null });

    await expect(verifyOtpTokenHash(client, '   ')).rejects.toThrow();
    expect(verifyOtp).not.toHaveBeenCalled();
  });
});
