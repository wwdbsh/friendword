'use client';

import { useEffect, useState } from 'react';

import type { BrowserSupabaseClient } from '@friendword/data';
import type { Session } from '@supabase/supabase-js';

export type SessionState = {
  readonly session: Session | null;
  readonly loading: boolean;
};

/** Tracks the Supabase session, including the magic-link return. */
export function useSession(client: BrowserSupabaseClient | null): SessionState {
  const [state, setState] = useState<SessionState>({ session: null, loading: true });

  useEffect(() => {
    if (client === null) {
      setState({ session: null, loading: false });
      return;
    }

    let cancelled = false;
    void client.auth.getSession().then(({ data }) => {
      if (!cancelled) {
        setState({ session: data.session, loading: false });
      }
    });

    const { data: subscription } = client.auth.onAuthStateChange((_event, session) => {
      if (!cancelled) {
        setState({ session, loading: false });
      }
    });

    return () => {
      cancelled = true;
      subscription.subscription.unsubscribe();
    };
  }, [client]);

  return state;
}
