'use client';

import { useCallback, useEffect, useState } from 'react';

export type AuthLinkError = {
  /** `error_code` when Supabase sends one, else the coarse `error` value. */
  readonly code: string;
  readonly description: string;
};

const EXPIRED_LINK_COPY =
  'That sign-in link has expired or was already used. Some email apps open links automatically before you do, which uses the link up. Send yourself a fresh one below — only the newest email works.';
const GENERIC_LINK_COPY =
  'We could not sign you in with that link. Send yourself a fresh one below — only the newest email works.';

/**
 * Reads a Supabase auth error out of a URL fragment. Supabase returns failures
 * as `#error=...&error_code=...&error_description=...`, which never reaches the
 * server, so every surface has to parse it in the browser.
 */
export function parseAuthLinkError(hash: string): AuthLinkError | null {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  if (raw === '') {
    return null;
  }

  const params = new URLSearchParams(raw);
  const error = params.get('error');
  const code = params.get('error_code');
  if (error === null && code === null) {
    return null;
  }

  return {
    code: code ?? error ?? '',
    description: params.get('error_description') ?? '',
  };
}

export function authLinkErrorCopy(error: AuthLinkError): string {
  return error.code === 'otp_expired' || error.description.toLowerCase().includes('expired')
    ? EXPIRED_LINK_COPY
    : GENERIC_LINK_COPY;
}

export type AuthLinkErrorState = {
  readonly linkError: AuthLinkError | null;
  readonly clearAuthLinkError: () => void;
};

/**
 * Surfaces the auth error a magic link left in the URL fragment, then strips
 * the fragment so a refresh does not resurface a stale failure. Only error
 * fragments are removed — a successful `#access_token=...` fragment is left for
 * the Supabase client's own `detectSessionInUrl` handling.
 */
export function useAuthLinkError(): AuthLinkErrorState {
  const [linkError, setLinkError] = useState<AuthLinkError | null>(null);

  useEffect(() => {
    const parsed = parseAuthLinkError(window.location.hash);
    if (parsed === null) {
      return;
    }

    setLinkError(parsed);
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
  }, []);

  const clearAuthLinkError = useCallback(() => {
    setLinkError(null);
  }, []);

  return { linkError, clearAuthLinkError };
}
