'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

import type { BrowserSupabaseClient } from '@friendword/data';

import { getSupabaseBrowserClient } from '@/lib/supabaseClient';
import { useSession } from '@/lib/useSession';

import styles from '@/styles/flowCard.module.css';

export const SIGN_OUT_LABEL = 'Sign out';
export const SIGN_OUT_BUSY_LABEL = 'Signing out…';

/**
 * §12: this says what failed, not what state the browser is in. `signOut`
 * clears the stored session before it ever calls the server, so "you are still
 * signed in" would be a guess — the honest instruction is to reload and look.
 */
export const SIGN_OUT_FAILED_COPY =
  'Signing out did not finish. Reload this page to see where you stand.';

/**
 * The account's exit (T008, Issue #45).
 *
 * Before this the web product had exactly one `signOut` call, buried in the
 * consent flow's contact-mismatch branch: a person signed in on a shared or
 * borrowed browser could reach their inbox, their intro rooms and their
 * launch kit, and had no way at all to leave. It lives in the FlowNav shell so
 * the answer is the same on every account surface.
 *
 * It renders NOTHING without a session. A "Sign out" control on a signed-out
 * screen is a claim about the visitor that the code has not checked.
 */
export function SignOutButton() {
  const clientRef = useRef<BrowserSupabaseClient | null | undefined>(undefined);
  if (clientRef.current === undefined) {
    clientRef.current = getSupabaseBrowserClient();
  }
  const client = clientRef.current;
  const { session, loading } = useSession(client);
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);
  const [failed, setFailed] = useState(false);

  if (client === null || loading || session === null) {
    return null;
  }

  async function signOut(auth: BrowserSupabaseClient): Promise<void> {
    setSigningOut(true);
    setFailed(false);
    try {
      const { error } = await auth.auth.signOut();
      if (error !== null) {
        // An already-expired or already-revoked session answers the global
        // sign-out with an error. Ending it on THIS device must still succeed,
        // or the one thing the person asked for is the one thing that did not
        // happen.
        const local = await auth.auth.signOut({ scope: 'local' });
        if (local.error !== null) {
          throw local.error;
        }
      }
    } catch {
      setSigningOut(false);
      setFailed(true);
      return;
    }
    // `replace`, not `push`: the signed-in screen must not be one Back away on
    // a shared browser. `refresh` drops anything the router cached for it.
    router.replace('/');
    router.refresh();
  }

  return (
    <div className={styles.navAccount}>
      <button
        className={styles.navSignOut}
        type="button"
        disabled={signingOut}
        onClick={() => {
          void signOut(client);
        }}
      >
        {signingOut ? SIGN_OUT_BUSY_LABEL : SIGN_OUT_LABEL}
      </button>
      {failed && (
        <p className={styles.navError} role="alert">
          {SIGN_OUT_FAILED_COPY}
        </p>
      )}
    </div>
  );
}
