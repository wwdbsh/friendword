import {
  ensureUserRow,
  getSession,
  signInWithOtp,
  verifyOtp,
  type BrowserSupabaseClient,
} from '@friendword/data';

export type AuthGateway = {
  hasSession(): Promise<boolean>;
  requestEmailCode(email: string): Promise<void>;
  confirmEmailCode(email: string, code: string): Promise<void>;
};

/**
 * Email OTP session gateway. After a successful confirmation the users/
 * profiles rows are provisioned so RLS-scoped inserts work immediately.
 */
export function createAuthGateway(client: BrowserSupabaseClient): AuthGateway {
  return {
    async hasSession(): Promise<boolean> {
      return (await getSession(client)) !== null;
    },
    async requestEmailCode(email: string): Promise<void> {
      await signInWithOtp(client, email);
    },
    async confirmEmailCode(email: string, code: string): Promise<void> {
      const session = await verifyOtp(client, email, code);
      if (session === null) {
        throw new Error('Sign-in could not be completed. Try a fresh code.');
      }
      await ensureUserRow(client);
    },
  };
}
