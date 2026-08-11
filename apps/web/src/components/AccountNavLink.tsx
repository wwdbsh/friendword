'use client';

import Link from 'next/link';
import { useRef } from 'react';

import type { BrowserSupabaseClient } from '@friendword/data';

import { getSupabaseBrowserClient } from '@/lib/supabaseClient';
import { useSession } from '@/lib/useSession';

/**
 * The landing page's only account door (T004 / Issue #41). /inbox was linked
 * from nowhere in the whole product: a dater who approved their page and then
 * closed the tab had to be told the URL. The link is rendered ONLY for a
 * visitor who already has a Supabase session — a signed-out visitor gets
 * nothing rather than a promise of an account they cannot open (§12).
 *
 * T009 (Issue #46): the door is now the hub rather than one of the four areas
 * behind it. A person arriving from a bookmark no longer has to already know
 * which of inbox / interests sent / rooms / their own page they came for.
 */
export function AccountNavLink({ className }: { readonly className: string | undefined }) {
  const clientRef = useRef<BrowserSupabaseClient | null | undefined>(undefined);
  if (clientRef.current === undefined) {
    clientRef.current = getSupabaseBrowserClient();
  }
  const { session, loading } = useSession(clientRef.current);

  if (loading || session === null) {
    return null;
  }

  return (
    <Link className={className} href="/me">
      My page
    </Link>
  );
}
