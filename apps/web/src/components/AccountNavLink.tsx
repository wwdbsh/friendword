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
 * nothing rather than a promise of an inbox they cannot open (§12).
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
    <Link className={className} href="/inbox">
      My inbox
    </Link>
  );
}
