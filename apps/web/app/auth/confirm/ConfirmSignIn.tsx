'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { verifyOtpTokenHash, type BrowserSupabaseClient } from '@friendword/data';

import { EmailSignIn } from '@/components/EmailSignIn';
import { FlowNav } from '@/components/FlowNav';
import { getSupabaseBrowserClient } from '@/lib/supabaseClient';
import styles from '@/styles/flowCard.module.css';

import { resolveSameOriginPath } from './redirect';

type ConfirmState = 'ready' | 'verifying' | 'failed';

const MISSING_TOKEN_COPY =
  'This confirmation link is incomplete, so we cannot sign you in with it. Send yourself a fresh email below.';
const VERIFY_FAILED_COPY =
  'That sign-in link has expired or was already used. Some email apps open links automatically before you do, which uses the link up. Send yourself a fresh one below — only the newest email works.';

/**
 * Explicit-click confirmation for emailed sign-in links. The token is exchanged
 * for a session ONLY when the person presses the button: mail scanners fetch
 * the link and would otherwise burn the one-time token before the real user
 * ever opens it.
 */
export function ConfirmSignIn() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const clientRef = useRef<BrowserSupabaseClient | null | undefined>(undefined);
  if (clientRef.current === undefined) {
    clientRef.current = getSupabaseBrowserClient();
  }
  const client = clientRef.current;

  const tokenHash = searchParams.get('token_hash');
  const rawRedirect = searchParams.get('redirect_to');

  const [origin, setOrigin] = useState<string | null>(null);
  const [state, setState] = useState<ConfirmState>('ready');
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const redirectPath = origin === null ? '/' : resolveSameOriginPath(rawRedirect, origin);
  const resendOptions = origin === null ? {} : { emailRedirectTo: `${origin}${redirectPath}` };

  async function handleConfirm() {
    if (client === null || state === 'verifying') {
      return;
    }
    if (tokenHash === null || tokenHash === '') {
      setState('failed');
      setMessage(MISSING_TOKEN_COPY);
      return;
    }

    setState('verifying');
    setMessage(null);
    try {
      const session = await verifyOtpTokenHash(client, tokenHash);
      if (session === null) {
        throw new Error('verifyOtpTokenHash returned no session');
      }
      router.replace(redirectPath);
    } catch {
      setState('failed');
      setMessage(VERIFY_FAILED_COPY);
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        {/* Tabs off: this screen exists to spend a one-time sign-in token, and
            navigating away before the tap wastes it. Sign-out off for the same
            reason turned up a notch (T008): this is the act of signing IN, and
            the previous session is exactly what the confirm button is about to
            replace. */}
        <FlowNav tabs={false} signOut={false} />

        {client === null && (
          <section className={styles.card}>
            <h1 className={styles.title}>Almost ready</h1>
            <p className={styles.muted}>This environment is missing its Supabase configuration.</p>
          </section>
        )}

        {client !== null && state !== 'failed' && (
          <section className={styles.card}>
            <span className={styles.badge}>One last tap</span>
            <h1 className={styles.title}>Confirm it’s really you.</h1>
            <p className={styles.lede}>
              Press the button to finish signing in. We wait for your tap on purpose — email apps
              often open links on their own, and that would use your link up before you got here.
            </p>
            <button
              className={styles.primary}
              type="button"
              disabled={state === 'verifying'}
              onClick={() => {
                void handleConfirm();
              }}
            >
              {state === 'verifying' ? 'Signing you in…' : 'Sign me in'}
            </button>
          </section>
        )}

        {client !== null && state === 'failed' && (
          <section className={styles.card}>
            <span className={styles.badgeDanger}>Link didn’t work</span>
            <h1 className={styles.title}>We couldn’t sign you in.</h1>
            <p className={styles.lede} role="alert">
              {message ?? VERIFY_FAILED_COPY}
            </p>
            <EmailSignIn
              client={client}
              reason="Enter your email and we’ll send a new sign-in link right away."
              finePrint="Only the newest email works — older links stop working."
              {...resendOptions}
            />
          </section>
        )}
      </div>
    </main>
  );
}
