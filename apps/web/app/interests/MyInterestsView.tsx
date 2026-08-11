'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import { InterestRepo, type BrowserSupabaseClient, type MyInterest } from '@friendword/data';

import { EmailSignIn } from '@/components/EmailSignIn';
import { FlowNav } from '@/components/FlowNav';
import { SignedOutNotice } from '@/components/SignedOutNotice';
import {
  campaignStateNote,
  formatSentAt,
  pitchHref,
  senderInterestTitle,
  senderStatusBody,
  senderStatusLabel,
} from '@/lib/interestStatusCopy';
import { getSupabaseBrowserClient } from '@/lib/supabaseClient';
import { useSession } from '@/lib/useSession';

import styles from '@/styles/flowCard.module.css';

type ListState =
  | { readonly step: 'loading' }
  | { readonly step: 'ready'; readonly interests: readonly MyInterest[] }
  | { readonly step: 'error' };

/**
 * The sender's half of the funnel on the web (T006, Issue #43).
 *
 * The mobile app has had this screen since 0033 (`list_my_interests`), the web
 * did not: a web sender could only infer "accepted" from a room appearing in
 * /rooms, and had no screen at all for a sent-but-undecided or a declined
 * interest. Everything shown here comes from that one RPC — no second read, and
 * nothing about the dater beyond what the RPC already returns to the sender.
 *
 * A failure is stated, never rendered as an empty list: "you have sent nothing"
 * and "we could not read what you sent" are different claims.
 */
export function MyInterestsView() {
  const clientRef = useRef<BrowserSupabaseClient | null | undefined>(undefined);
  if (clientRef.current === undefined) {
    clientRef.current = getSupabaseBrowserClient();
  }
  const client = clientRef.current;
  const { session, loading, ended } = useSession(client);

  const [state, setState] = useState<ListState>({ step: 'loading' });

  useEffect(() => {
    if (client === null || session === null) {
      // T008: interest a person sent is private to the account that sent it,
      // so it must not survive that account's session in this tab.
      setState({ step: 'loading' });
      return;
    }
    let cancelled = false;
    void new InterestRepo(client)
      .listMyInterests()
      .then((interests) => {
        if (!cancelled) {
          setState({ step: 'ready', interests });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setState({ step: 'error' });
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
            <h1 className={styles.title}>Opening your interests…</h1>
          </section>
        )}

        {client !== null && !loading && session === null && (
          <section className={styles.card}>
            <SignedOutNotice ended={ended} />
            <span className={styles.badge}>My interests</span>
            <h1 className={styles.title}>The interest you sent lives here.</h1>
            <EmailSignIn
              client={client}
              reason="Interest is private: it only appears for the account that sent it."
            />
          </section>
        )}

        {client !== null && !loading && session !== null && state.step === 'loading' && (
          <section className={styles.card} aria-live="polite">
            <h1 className={styles.title}>Opening your interests…</h1>
          </section>
        )}

        {client !== null && !loading && session !== null && state.step === 'error' && (
          <section className={styles.card}>
            <span className={styles.badgeDanger}>Hold up</span>
            <h1 className={styles.title}>We hit a snag.</h1>
            <p className={styles.muted}>
              Your interests could not load. Refresh to try again — nothing about what you sent has
              changed.
            </p>
          </section>
        )}

        {client !== null &&
          !loading &&
          session !== null &&
          state.step === 'ready' &&
          state.interests.length === 0 && (
            <section className={styles.card}>
              <span className={styles.badge}>My interests</span>
              <h1 className={styles.title}>You haven’t sent any interest yet.</h1>
              <p className={styles.muted}>
                When you send interest on someone’s Friendword page, it shows up here with whatever
                the dater decided.
              </p>
              <div className={styles.actionRow}>
                <Link className={styles.secondary} href="/p/demo-blair">
                  See a demo pitch
                </Link>
                <Link className={styles.secondary} href="/rooms">
                  My intro rooms
                </Link>
              </div>
            </section>
          )}

        {client !== null &&
          !loading &&
          session !== null &&
          state.step === 'ready' &&
          state.interests.length > 0 && (
            <>
              <section>
                <span className={styles.badge}>My interests</span>
                <h1 className={styles.title}>Interest you sent.</h1>
              </section>
              {state.interests.map((interest) => {
                const pitch = pitchHref(interest);
                const campaignNote = campaignStateNote(interest.campaignStatus);
                return (
                  <section key={interest.interestId} className={styles.card}>
                    <span
                      className={
                        interest.interestStatus === 'accepted' ? styles.badgeFresh : styles.badge
                      }
                    >
                      {senderStatusLabel(interest.interestStatus)}
                    </span>
                    <h2 className={styles.subTitle}>{senderInterestTitle(interest)}</h2>
                    {interest.campaignHeadline !== null && (
                      <p className={styles.muted}>{interest.campaignHeadline}</p>
                    )}
                    <p className={styles.muted}>{formatSentAt(interest.submittedAt)}</p>
                    <p className={styles.lede}>{senderStatusBody(interest.interestStatus)}</p>
                    {campaignNote !== null && <p className={styles.finePrint}>{campaignNote}</p>}
                    <div className={styles.actionRow}>
                      {interest.interestStatus === 'accepted' && (
                        <Link className={styles.primary} href="/rooms">
                          Open my intro rooms
                        </Link>
                      )}
                      {/* Only a published campaign has a page to return to: the
                          public route 404s the moment it is paused, expired or
                          archived, so a link would be a promise the URL breaks. */}
                      {pitch !== null && (
                        <Link className={styles.secondary} href={pitch}>
                          Back to the pitch
                        </Link>
                      )}
                    </div>
                  </section>
                );
              })}
            </>
          )}
      </div>
    </main>
  );
}
