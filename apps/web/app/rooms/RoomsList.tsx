'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import { IntroRoomRepo, type BrowserSupabaseClient, type IntroRoomSummary } from '@friendword/data';

import { EmailSignIn } from '@/components/EmailSignIn';
import { FlowNav } from '@/components/FlowNav';
import { SignedOutNotice } from '@/components/SignedOutNotice';
import { getSupabaseBrowserClient } from '@/lib/supabaseClient';
import { useSession } from '@/lib/useSession';

import styles from '@/styles/flowCard.module.css';

export function RoomsList() {
  const clientRef = useRef<BrowserSupabaseClient | null | undefined>(undefined);
  if (clientRef.current === undefined) {
    clientRef.current = getSupabaseBrowserClient();
  }
  const client = clientRef.current;
  const { session, loading, ended } = useSession(client);

  const [rooms, setRooms] = useState<readonly IntroRoomSummary[] | null>(null);

  useEffect(() => {
    if (client === null || session === null) {
      // T008: the room list goes with the session, so the next account to sign
      // in on this browser cannot be shown the previous one's rooms.
      setRooms(null);
      return;
    }
    let cancelled = false;
    const repo = new IntroRoomRepo(client);
    void repo
      .listMyRooms()
      .then((loadedRooms) => {
        if (!cancelled) {
          setRooms(loadedRooms);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRooms([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [client, session]);

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <FlowNav />

        {client === null && (
          <section className={styles.card}>
            <h1 className={styles.title}>Almost ready</h1>
            <p className={styles.muted}>This environment is missing its Supabase configuration.</p>
          </section>
        )}

        {client !== null && loading && (
          <section className={styles.card} aria-live="polite">
            <h1 className={styles.title}>Opening your rooms…</h1>
          </section>
        )}

        {client !== null && !loading && session === null && (
          <section className={styles.card}>
            <SignedOutNotice ended={ended} />
            <span className={styles.badge}>Intro rooms</span>
            <h1 className={styles.title}>Your conversations live here.</h1>
            <EmailSignIn client={client} reason="Sign in to open your intro rooms." />
          </section>
        )}

        {client !== null && session !== null && rooms !== null && rooms.length === 0 && (
          <section className={styles.card}>
            <span className={styles.badge}>Intro rooms</span>
            <h1 className={styles.title}>No rooms yet.</h1>
            <p className={styles.muted}>
              A private room opens the moment an interest is accepted — by you or about you.
            </p>
            {/* T004: an empty room list is where both sides of the funnel land.
                The dater's next move is their interest inbox; a viewer's is a
                public pitch, so both are linked rather than described. */}
            <div className={styles.actionRow}>
              <Link className={styles.secondary} href="/inbox">
                My interest inbox
              </Link>
              <Link className={styles.secondary} href="/p/demo-blair">
                See a demo pitch
              </Link>
            </div>
          </section>
        )}

        {client !== null && session !== null && rooms !== null && rooms.length > 0 && (
          <>
            <section>
              <span className={styles.badge}>Intro rooms</span>
              <h1 className={styles.title}>Your introductions.</h1>
            </section>
            {rooms.map((room) => (
              <section key={room.roomId} className={styles.card}>
                <h2 className={styles.subTitle}>{room.otherDisplayName}</h2>
                <p className={styles.muted}>
                  Introduced through{' '}
                  {room.campaignSlug === null ? 'a friend’s pitch' : `/p/${room.campaignSlug}`}
                </p>
                <Link className={styles.primary} href={`/rooms/${room.roomId}`}>
                  Open the room
                </Link>
              </section>
            ))}
          </>
        )}
      </div>
    </main>
  );
}
