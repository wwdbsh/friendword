'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { InterestRepo, type BrowserSupabaseClient, type CampaignInterest } from '@friendword/data';

import { EmailSignIn } from '@/components/EmailSignIn';
import { getSupabaseBrowserClient } from '@/lib/supabaseClient';
import { useSession } from '@/lib/useSession';

import styles from '@/styles/flowCard.module.css';

type InboxInterest = CampaignInterest & {
  readonly campaignId: string;
  readonly photoUrls: readonly string[];
};

type InboxState =
  | { readonly step: 'loading' }
  | { readonly step: 'empty' }
  | { readonly step: 'list'; readonly interests: readonly InboxInterest[] }
  | { readonly step: 'error' };

const INTENT_LABELS: Record<string, string> = {
  'long-term': 'Looking for long-term',
  'short-term': 'Looking for short-term',
  'open-to-either': 'Open to either',
};

export function InboxView() {
  const clientRef = useRef<BrowserSupabaseClient | null | undefined>(undefined);
  if (clientRef.current === undefined) {
    clientRef.current = getSupabaseBrowserClient();
  }
  const client = clientRef.current;
  const { session, loading } = useSession(client);

  const [state, setState] = useState<InboxState>({ step: 'loading' });
  const [deciding, setDeciding] = useState<string | null>(null);
  const [decisionNote, setDecisionNote] = useState<string | null>(null);

  const loadInbox = useCallback(async () => {
    if (client === null) {
      return;
    }
    const repo = new InterestRepo(client);
    try {
      const campaigns = await repo.listMyOwnedCampaigns();
      const interests: InboxInterest[] = [];
      for (const campaign of campaigns) {
        const rows = await repo.listCampaignInterests(campaign.id).catch(() => []);
        for (const row of rows) {
          const photoUrls = (
            await Promise.all(
              row.senderPhotos.map((path) => repo.createPhotoViewUrl(path).catch(() => null)),
            )
          ).filter((url): url is string => url !== null);
          interests.push({ ...row, campaignId: campaign.id, photoUrls });
        }
      }
      interests.sort((left, right) =>
        (right.submittedAt ?? '').localeCompare(left.submittedAt ?? ''),
      );
      setState(interests.length === 0 ? { step: 'empty' } : { step: 'list', interests });
    } catch {
      setState({ step: 'error' });
    }
  }, [client]);

  useEffect(() => {
    if (session !== null) {
      void loadInbox();
    }
  }, [session, loadInbox]);

  async function decide(interestId: string, decision: 'accepted' | 'declined') {
    if (client === null) {
      return;
    }
    setDeciding(interestId);
    setDecisionNote(null);
    try {
      const repo = new InterestRepo(client);
      const { introRoomId } = await repo.decideInterest(interestId, decision);
      setDecisionNote(
        decision === 'accepted'
          ? introRoomId === null
            ? 'Accepted!'
            : 'Accepted — a private intro room is open for the two of you.'
          : 'Declined. They will not be notified with details.',
      );
      await loadInbox();
    } catch {
      setDecisionNote('That decision did not go through. Refresh and try again.');
    } finally {
      setDeciding(null);
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <p className={styles.wordmark}>Friendword</p>

        {client === null && (
          <section className={styles.card}>
            <h1 className={styles.title}>Almost ready</h1>
            <p className={styles.muted}>This environment is missing its Supabase configuration.</p>
          </section>
        )}

        {client !== null && loading && (
          <section className={styles.card} aria-live="polite">
            <h1 className={styles.title}>Opening your inbox…</h1>
          </section>
        )}

        {client !== null && !loading && session === null && (
          <section className={styles.card}>
            <span className={styles.badge}>Interest inbox</span>
            <h1 className={styles.title}>See who wants to meet you.</h1>
            <EmailSignIn
              client={client}
              reason="Sign in with the same email you used to approve your pitch."
            />
          </section>
        )}

        {client !== null && session !== null && state.step === 'loading' && (
          <section className={styles.card} aria-live="polite">
            <h1 className={styles.title}>Opening your inbox…</h1>
          </section>
        )}

        {client !== null && session !== null && state.step === 'error' && (
          <section className={styles.card}>
            <span className={styles.badgeDanger}>Hold up</span>
            <h1 className={styles.title}>We hit a snag.</h1>
            <p className={styles.muted}>Your inbox could not load. Refresh to try again.</p>
          </section>
        )}

        {client !== null && session !== null && state.step === 'empty' && (
          <section className={styles.card}>
            <span className={styles.badge}>Interest inbox</span>
            <h1 className={styles.title}>No interest yet.</h1>
            <p className={styles.muted}>
              When someone sends verified interest on your page, their profile shows up here for you
              to accept or decline.
            </p>
          </section>
        )}

        {client !== null && session !== null && state.step === 'list' && (
          <>
            <section>
              <span className={styles.badge}>Interest inbox</span>
              <h1 className={styles.title}>People who want to meet you.</h1>
              {decisionNote !== null && <p className={styles.lede}>{decisionNote}</p>}
            </section>

            {state.interests.map((interest) => (
              <section key={interest.interestId} className={styles.card}>
                <span
                  className={
                    interest.interestStatus === 'accepted'
                      ? styles.badgeFresh
                      : interest.interestStatus === 'declined'
                        ? styles.badgeDanger
                        : styles.badge
                  }
                >
                  {interest.interestStatus === 'submitted'
                    ? 'Waiting for you'
                    : interest.interestStatus === 'accepted'
                      ? 'Accepted'
                      : 'Declined'}
                </span>
                <h2 className={styles.subTitle}>
                  {interest.senderDisplayName}
                  {interest.senderAge !== null ? `, ${interest.senderAge}` : ''}
                </h2>
                <p className={styles.muted}>
                  {INTENT_LABELS[interest.senderDatingIntent ?? ''] ?? 'Intent not shared'}
                  {interest.senderLocation !== null ? ` · ${interest.senderLocation}` : ''}
                </p>

                {interest.photoUrls.length > 0 && (
                  <div className={styles.photoGrid}>
                    {interest.photoUrls.map((url, index) => (
                      <img
                        key={url}
                        className={styles.photo}
                        src={url}
                        alt={`${interest.senderDisplayName} photo ${index + 1}`}
                      />
                    ))}
                  </div>
                )}

                {interest.senderBio !== null && <p className={styles.lede}>{interest.senderBio}</p>}
                {interest.note !== null && <p className={styles.muted}>“{interest.note}”</p>}

                {interest.interestStatus === 'submitted' && (
                  <div className={styles.actionRow}>
                    <button
                      className={styles.primary}
                      type="button"
                      disabled={deciding === interest.interestId}
                      onClick={() => {
                        void decide(interest.interestId, 'accepted');
                      }}
                    >
                      Accept &amp; open intro room
                    </button>
                    <button
                      className={styles.danger}
                      type="button"
                      disabled={deciding === interest.interestId}
                      onClick={() => {
                        void decide(interest.interestId, 'declined');
                      }}
                    >
                      Decline
                    </button>
                  </div>
                )}
              </section>
            ))}
          </>
        )}
      </div>
    </main>
  );
}
