'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  BenefitsRepo,
  InterestRepo,
  SafetyRepo,
  type BrowserSupabaseClient,
  type CampaignFunnelRow,
  type CampaignInterest,
  type CampaignPassState,
} from '@friendword/data';

import { EmailSignIn } from '@/components/EmailSignIn';
import { FlowNav } from '@/components/FlowNav';
import { kickNotificationSender } from '@/lib/notifications/kick';
import { getSupabaseBrowserClient } from '@/lib/supabaseClient';
import { useSession } from '@/lib/useSession';

import styles from '@/styles/flowCard.module.css';

type InboxInterest = CampaignInterest & {
  readonly campaignId: string;
  readonly photoUrls: readonly string[];
};

type OwnedCampaign = {
  readonly id: string;
  readonly slug: string | null;
  readonly status: string;
  readonly endsAt: string | null;
  readonly pass: CampaignPassState;
};

/**
 * H-5 consistency: the public page 404s once ends_at passes even before
 * the expiration job runs, so the inbox must never offer Live/Resume for
 * a campaign whose window ended.
 */
function displayStatus(campaign: Pick<OwnedCampaign, 'status' | 'endsAt'>): string {
  if (campaign.status === 'expired') {
    return 'expired';
  }
  if (
    (campaign.status === 'published' || campaign.status === 'paused') &&
    campaign.endsAt !== null &&
    new Date(campaign.endsAt).getTime() <= Date.now()
  ) {
    return 'expired';
  }
  return campaign.status;
}

const FUNNEL_LABELS: Record<string, string> = {
  pitch_viewed_unique: 'Unique views',
  interest_started: 'Interest started',
  interest_submitted: 'Interest submitted',
  campaign_shared: 'Shares',
};

type InboxState =
  | { readonly step: 'loading' }
  | {
      readonly step: 'ready';
      readonly campaigns: readonly OwnedCampaign[];
      readonly interests: readonly InboxInterest[];
    }
  | { readonly step: 'error' };

const INTENT_LABELS: Record<string, string> = {
  'long-term': 'Looking for long-term',
  'short-term': 'Looking for short-term',
  'open-to-either': 'Open to either',
};

const REPORT_REASONS = [
  { value: 'impersonation', label: 'Pretending to be someone else' },
  { value: 'safety_risk', label: 'Threatening or unsafe behavior' },
  { value: 'minor', label: 'Appears to be under 18' },
  { value: 'harassment', label: 'Harassment' },
  { value: 'spam', label: 'Spam or scam' },
  { value: 'other', label: 'Something else' },
] as const;

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
  const [openedRoomId, setOpenedRoomId] = useState<string | null>(null);
  const [reportingInterestId, setReportingInterestId] = useState<string | null>(null);
  const [funnels, setFunnels] = useState<Record<string, readonly CampaignFunnelRow[]>>({});
  const [loadingFunnel, setLoadingFunnel] = useState<string | null>(null);
  const [reportReason, setReportReason] = useState<string>(REPORT_REASONS[0].value);
  const [submittingReport, setSubmittingReport] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [accountDeleted, setAccountDeleted] = useState(false);

  const loadInbox = useCallback(async () => {
    if (client === null) {
      return;
    }
    const repo = new InterestRepo(client);
    const benefits = new BenefitsRepo(client);
    try {
      const ownedCampaigns = await repo.listMyOwnedCampaigns();
      const campaigns: OwnedCampaign[] = await Promise.all(
        ownedCampaigns.map(async (campaign) => ({
          ...campaign,
          pass: await benefits
            .getCampaignPassState(campaign.id)
            .catch((): CampaignPassState => ({ active: false, expiresAt: null })),
        })),
      );
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
      setState({ step: 'ready', campaigns, interests });
    } catch {
      setState({ step: 'error' });
    }
  }, [client]);

  useEffect(() => {
    if (session !== null) {
      void loadInbox();
    }
  }, [session, loadInbox]);

  async function changeCampaignStatus(
    campaignId: string,
    nextStatus: 'published' | 'paused' | 'archived',
  ) {
    if (client === null) {
      return;
    }
    if (
      nextStatus === 'archived' &&
      !window.confirm('Take your page down for good? Archived pages cannot be republished.')
    ) {
      return;
    }
    try {
      await new InterestRepo(client).setCampaignStatus(campaignId, nextStatus);
      setDecisionNote(
        nextStatus === 'published'
          ? 'Your page is live again.'
          : nextStatus === 'paused'
            ? 'Your page is paused — the link shows nothing until you resume.'
            : 'Your page is permanently down.',
      );
      await loadInbox();
    } catch {
      setDecisionNote('That change did not go through. Refresh and try again.');
    }
  }

  async function decide(interestId: string, decision: 'accepted' | 'declined') {
    if (client === null) {
      return;
    }
    setDeciding(interestId);
    setDecisionNote(null);
    try {
      const repo = new InterestRepo(client);
      const { introRoomId } = await repo.decideInterest(interestId, decision);
      setOpenedRoomId(decision === 'accepted' ? introRoomId : null);
      setDecisionNote(
        decision === 'accepted'
          ? introRoomId === null
            ? 'Accepted!'
            : 'Accepted — a private intro room is open for the two of you.'
          : // §12: this sentence must be true the day 0058 deploys, the day
            // before, and on any day the ops kill switch is off — so it says
            // nothing about whether a notice goes out. "They get a short
            // notice" would be a claim about delivery, and delivery is exactly
            // what this code does not know: the mail is queued by a trigger,
            // gated by app_config, and may expire unsent. What IS invariant
            // is the CONTENT boundary, and it is also the only part the person
            // declining actually cares about.
            'Declined. Your reason and details are never shared with them.',
      );
      // The decision just queued a notification to the sender; push the
      // sender's queue while a request path is still open. Fire-and-forget:
      // it must never delay or fail the decision the dater just made.
      void kickNotificationSender(client);
      await loadInbox();
    } catch {
      setDecisionNote('That decision did not go through. Refresh and try again.');
    } finally {
      setDeciding(null);
    }
  }

  async function loadFunnel(campaignId: string) {
    if (client === null) {
      return;
    }
    setLoadingFunnel(campaignId);
    try {
      const rows = await new BenefitsRepo(client).getCampaignAnalytics(campaignId);
      setFunnels((current) => ({ ...current, [campaignId]: rows }));
    } catch {
      setDecisionNote('The funnel could not load. Refresh and try again.');
    } finally {
      setLoadingFunnel(null);
    }
  }

  async function submitInterestReport(interestId: string) {
    if (client === null) {
      return;
    }
    setSubmittingReport(true);
    try {
      await new SafetyRepo(client).reportContent({
        targetType: 'interest',
        targetId: interestId,
        reason: reportReason,
      });
      setDecisionNote('Report received. Our team reviews every report.');
      setReportingInterestId(null);
    } catch {
      setDecisionNote('The report did not go through. Refresh and try again.');
    } finally {
      setSubmittingReport(false);
    }
  }

  async function deleteAccount() {
    if (client === null) {
      return;
    }
    if (
      !window.confirm(
        'Delete your account for good? Your pages, interests, and chats are ' +
          'removed and cannot be recovered.',
      )
    ) {
      return;
    }
    setDeletingAccount(true);
    try {
      await new SafetyRepo(client).requestAccountDeletion();
      await client.auth.signOut();
      setAccountDeleted(true);
    } catch {
      setDecisionNote('Account deletion did not go through. Refresh and try again.');
    } finally {
      setDeletingAccount(false);
    }
  }

  if (accountDeleted) {
    return (
      <main className={styles.page}>
        <div className={styles.shell}>
          <FlowNav tabs={false} />
          <section className={styles.card}>
            <h1 className={styles.title}>Your account is being deleted.</h1>
            <p className={styles.muted}>
              You are signed out. Your data and media are removed by our deletion job; this cannot
              be undone.
            </p>
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <FlowNav current="inbox" />

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

        {client !== null && session !== null && state.step === 'ready' && (
          <>
            <section>
              <span className={styles.badge}>Interest inbox</span>
              <h1 className={styles.title}>People who want to meet you.</h1>
              {decisionNote !== null && <p className={styles.lede}>{decisionNote}</p>}
              {openedRoomId !== null && (
                <Link className={styles.primary} href={`/rooms/${openedRoomId}`}>
                  Open the intro room
                </Link>
              )}
            </section>

            {state.campaigns.map((campaign) => {
              const shownStatus = displayStatus(campaign);
              return (
                <section key={campaign.id} className={styles.card}>
                  <span className={shownStatus === 'published' ? styles.badgeFresh : styles.badge}>
                    {shownStatus === 'published'
                      ? 'Live'
                      : shownStatus === 'paused'
                        ? 'Paused'
                        : shownStatus === 'expired'
                          ? 'Ended'
                          : 'Down'}
                  </span>
                  <h2 className={styles.subTitle}>Your page</h2>
                  <p className={styles.muted}>
                    {campaign.slug === null
                      ? 'No public link yet.'
                      : `friendword — /p/${campaign.slug}`}
                  </p>
                  <div className={styles.actionRow}>
                    {campaign.slug !== null && shownStatus === 'published' && (
                      <Link className={styles.secondary} href={`/p/${campaign.slug}`}>
                        View my page
                      </Link>
                    )}
                    {shownStatus === 'published' && (
                      <button
                        className={styles.secondary}
                        type="button"
                        onClick={() => {
                          void changeCampaignStatus(campaign.id, 'paused');
                        }}
                      >
                        Pause my page
                      </button>
                    )}
                    {shownStatus === 'paused' && (
                      <button
                        className={styles.primary}
                        type="button"
                        onClick={() => {
                          void changeCampaignStatus(campaign.id, 'published');
                        }}
                      >
                        Resume my page
                      </button>
                    )}
                    {(shownStatus === 'published' ||
                      shownStatus === 'paused' ||
                      shownStatus === 'expired') && (
                      <button
                        className={styles.danger}
                        type="button"
                        onClick={() => {
                          void changeCampaignStatus(campaign.id, 'archived');
                        }}
                      >
                        Take it down for good
                      </button>
                    )}
                  </div>

                  <h3 className={styles.subTitle}>Campaign Pass</h3>
                  {campaign.pass.active ? (
                    <>
                      <p className={styles.muted}>
                        Active
                        {campaign.pass.expiresAt !== null
                          ? ` until ${new Date(campaign.pass.expiresAt).toLocaleDateString()}`
                          : ''}
                        . The Pass added 30 days to your live window and unlocked the funnel below.
                      </p>
                      {(() => {
                        const funnel = funnels[campaign.id];
                        if (funnel === undefined) {
                          return (
                            <button
                              className={styles.secondary}
                              type="button"
                              disabled={loadingFunnel === campaign.id}
                              onClick={() => {
                                void loadFunnel(campaign.id);
                              }}
                            >
                              {loadingFunnel === campaign.id ? 'Loading…' : 'View my funnel'}
                            </button>
                          );
                        }
                        if (funnel.length === 0) {
                          return <p className={styles.muted}>No activity recorded yet.</p>;
                        }
                        return (
                          <ul className={styles.claimList}>
                            {funnel.map((row) => (
                              <li key={`${row.eventName}-${row.source}`}>
                                {FUNNEL_LABELS[row.eventName] ?? row.eventName} · {row.source}:{' '}
                                {row.total}
                              </li>
                            ))}
                          </ul>
                        );
                      })()}
                    </>
                  ) : (
                    <p className={styles.muted}>
                      Not active. The Pass adds 30 days to your live window and unlocks the
                      view-and-interest funnel — purchase it in the Friendword app. Accepting
                      interest, chat, and safety tools are always free.
                    </p>
                  )}
                </section>
              );
            })}

            {state.interests.length === 0 && (
              <section className={styles.card}>
                <h2 className={styles.subTitle}>No interest yet.</h2>
                <p className={styles.muted}>
                  When someone with a complete dating profile sends interest on your page, their
                  profile shows up here for you to accept or decline.
                </p>
                {/* T004: the empty inbox was the end of the road. Only the one
                    destination this card does not already offer is added — the
                    campaign card above carries "View my page" for a live page,
                    and repeating it here made two links to one screen. */}
                <div className={styles.actionRow}>
                  <Link className={styles.secondary} href="/rooms">
                    My intro rooms
                  </Link>
                </div>
              </section>
            )}

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

                {reportingInterestId === interest.interestId ? (
                  <form
                    className={styles.form}
                    onSubmit={(event) => {
                      event.preventDefault();
                      void submitInterestReport(interest.interestId);
                    }}
                  >
                    <label
                      className={styles.label}
                      htmlFor={`report-reason-${interest.interestId}`}
                    >
                      Why are you reporting this profile?
                    </label>
                    <select
                      id={`report-reason-${interest.interestId}`}
                      className={styles.input}
                      value={reportReason}
                      onChange={(event) => setReportReason(event.target.value)}
                    >
                      {REPORT_REASONS.map((reason) => (
                        <option key={reason.value} value={reason.value}>
                          {reason.label}
                        </option>
                      ))}
                    </select>
                    <div className={styles.actionRow}>
                      <button className={styles.danger} type="submit" disabled={submittingReport}>
                        {submittingReport ? 'Sending…' : 'Send report'}
                      </button>
                      <button
                        className={styles.secondary}
                        type="button"
                        onClick={() => setReportingInterestId(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : (
                  <button
                    className={styles.quietAction}
                    type="button"
                    onClick={() => {
                      setReportReason(REPORT_REASONS[0].value);
                      setReportingInterestId(interest.interestId);
                    }}
                  >
                    Report this profile
                  </button>
                )}
              </section>
            ))}

            <section className={styles.card}>
              <h2 className={styles.subTitle}>Your account</h2>
              <p className={styles.muted}>
                Deleting your account removes your pages, interests, chats, and photos. This cannot
                be undone.
              </p>
              <button
                className={styles.danger}
                type="button"
                disabled={deletingAccount}
                onClick={() => {
                  void deleteAccount();
                }}
              >
                {deletingAccount ? 'Deleting…' : 'Delete my account'}
              </button>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
