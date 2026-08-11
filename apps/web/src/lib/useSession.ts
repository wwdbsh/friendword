'use client';

import { useEffect, useState } from 'react';

import type { BrowserSupabaseClient } from '@friendword/data';
import type { Session } from '@supabase/supabase-js';

export type SessionState = {
  readonly session: Session | null;
  readonly loading: boolean;
  /**
   * True once a session this mount actually had has gone away — a refresh that
   * failed, a sign-out in another tab, or the sign-out control on this shell
   * (T008, Issue #45).
   *
   * Without it the four account surfaces cannot tell "your session ended" from
   * "you were never signed in": both render the same sign-in card, so an inbox
   * that expires under someone looks exactly like a page that lost their data.
   * It is deliberately NOT persisted — a fresh visit to a signed-out surface is
   * not an expiry, and claiming one would be a guess.
   */
  readonly ended: boolean;
};

/** Tracks the Supabase session, including the magic-link return. */
export function useSession(client: BrowserSupabaseClient | null): SessionState {
  const [state, setState] = useState<SessionState>({
    session: null,
    loading: true,
    ended: false,
  });

  useEffect(() => {
    if (client === null) {
      setState({ session: null, loading: false, ended: false });
      return;
    }

    let cancelled = false;
    // Updated from both the initial read and the listener, so the two cannot
    // disagree about whether a session was ever held on this mount.
    let hadSession = false;

    const apply = (session: Session | null): void => {
      if (cancelled) {
        return;
      }
      const ended = session === null && hadSession;
      hadSession = hadSession || session !== null;
      setState({ session, loading: false, ended });
    };

    void client.auth.getSession().then(({ data }) => {
      apply(data.session);
    });

    const { data: subscription } = client.auth.onAuthStateChange((_event, session) => {
      apply(session);
    });

    return () => {
      cancelled = true;
      subscription.subscription.unsubscribe();
    };
  }, [client]);

  return state;
}
