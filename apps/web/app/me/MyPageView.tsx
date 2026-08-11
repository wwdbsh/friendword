'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import { InterestRepo, IntroRoomRepo, type BrowserSupabaseClient } from '@friendword/data';

import { EmailSignIn } from '@/components/EmailSignIn';
import { FlowNav } from '@/components/FlowNav';
import { SignedOutNotice } from '@/components/SignedOutNotice';
import { campaignStatusLabel, displayCampaignStatus } from '@/lib/campaignStatus';
import { getSupabaseBrowserClient } from '@/lib/supabaseClient';
import { useSession } from '@/lib/useSession';

import styles from '@/styles/flowCard.module.css';

type CampaignSummary = {
  readonly id: string;
  readonly slug: string | null;
  readonly shownStatus: string;
};

/**
 * `null` everywhere means "this could not be read", never "there is none of
 * it". The two are different claims and only one of them is safe to render as
 * a number (§12) — the same boundary the mobile campaign screen draws for its
 * waiting count.
 */
type Summary = {
  readonly campaigns: readonly CampaignSummary[] | null;
  readonly waiting: number | null;
  readonly sent: number | null;
  readonly rooms: number | null;
};

type HubState =
  { readonly step: 'loading' } | { readonly step: 'ready'; readonly summary: Summary };

/**
 * The PII boundary for the waiting count. `list_campaign_interests` returns
 * every sender's display name, age, bio, location and photo paths; this screen
 * needs one integer, so nothing else is allowed to leave this function into
 * component state, a re-render or a screenshot.
 */
async function countWaiting(
  repo: InterestRepo,
  campaigns: readonly CampaignSummary[],
): Promise<number | null> {
  const counts = await Promise.all(
    campaigns.map(async (campaign) => {
      const rows = await repo.listCampaignInterests(campaign.id).catch(() => null);
      if (rows === null) {
        return null;
      }
      return rows.filter((row) => row.interestStatus === 'submitted').length;
    }),
  );
  // One unreadable campaign makes the total unknown: a partial sum rendered as
  // a total would tell a dater fewer people are waiting than actually are.
  if (counts.some((count) => count === null)) {
    return null;
  }
  return counts.reduce((total: number, count) => total + (count ?? 0), 0);
}

export function waitingCopy(waiting: number | null, anyLive: boolean): string {
  if (waiting === null) {
    return 'The people waiting could not be counted. Your inbox has the real list.';
  }
  if (waiting === 0) {
    return 'Nobody is waiting on your answer right now.';
  }
  const subject = waiting === 1 ? '1 person is' : `${waiting} people are`;
  // `decide_interest` (0044) refuses an accept unless the campaign is published
  // AND inside its window, so "waiting for your answer" is only true while a
  // page of theirs is live. With none live the sentence states the block
  // instead of implying an action the server would refuse.
  return anyLive
    ? `${subject} waiting for your answer.`
    : `${subject} waiting, but no page of yours is live right now.`;
}

export function sentCopy(sent: number | null): string {
  if (sent === null) {
    return 'The interest you sent could not be counted.';
  }
  if (sent === 0) {
    return 'You haven’t sent any interest yet.';
  }
  return sent === 1 ? '1 interest sent.' : `${sent} interests sent.`;
}

export function roomsCopy(rooms: number | null): string {
  if (rooms === null) {
    return 'Your intro rooms could not be counted.';
  }
  if (rooms === 0) {
    return 'No rooms yet.';
  }
  return rooms === 1 ? '1 intro room is open.' : `${rooms} intro rooms are open.`;
}

/**
 * The account hub (T009, Issue #46).
 *
 * The audit's finding was not a missing screen: interest received, interest
 * sent, intro rooms and the campaigns about a person lived on three web routes
 * and two mobile screens with no place that says what a person actually has.
 * This is that place — a summary and a directory, not a fifth data surface. It
 * introduces no RPC, no migration and no permission of its own: every number
 * below comes from a read the funnel already performs (`campaigns`,
 * `list_campaign_interests`, `list_my_interests`, `list_my_intro_rooms`), and
 * every control still lives on the screen that owns it.
 */
export function MyPageView() {
  const clientRef = useRef<BrowserSupabaseClient | null | undefined>(undefined);
  if (clientRef.current === undefined) {
    clientRef.current = getSupabaseBrowserClient();
  }
  const client = clientRef.current;
  const { session, loading, ended } = useSession(client);

  const [state, setState] = useState<HubState>({ step: 'loading' });

  useEffect(() => {
    if (client === null || session === null) {
      // T008: what a person has is private to the account that has it, so the
      // summary must not survive that account's session in this tab.
      setState({ step: 'loading' });
      return;
    }
    let cancelled = false;
    const interests = new InterestRepo(client);
    const rooms = new IntroRoomRepo(client);

    void (async () => {
      // Four independent reads: one failing area states its own failure rather
      // than blanking the whole hub, because the other three are still true.
      const owned = await interests.listMyOwnedCampaigns().catch(() => null);
      const campaigns =
        owned === null
          ? null
          : owned.map((campaign) => ({
              id: campaign.id,
              slug: campaign.slug,
              shownStatus: displayCampaignStatus(campaign),
            }));
      const [waiting, sent, roomCount] = await Promise.all([
        campaigns === null ? Promise.resolve(null) : countWaiting(interests, campaigns),
        interests
          .listMyInterests()
          .then((rows) => rows.length)
          .catch(() => null),
        rooms
          .listMyRooms()
          .then((rows) => rows.length)
          .catch(() => null),
      ]);
      if (!cancelled) {
        setState({ step: 'ready', summary: { campaigns, waiting, sent, rooms: roomCount } });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [client, session]);

  const summary = state.step === 'ready' ? state.summary : null;
  const anyLive = summary?.campaigns?.some((campaign) => campaign.shownStatus === 'published');

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <FlowNav current="me" />

        {client === null && (
          <section className={styles.card}>
            <h1 className={styles.title}>Almost ready</h1>
            <p className={styles.muted}>This environment is missing its Supabase configuration.</p>
          </section>
        )}

        {client !== null && loading && (
          <section className={styles.card} aria-live="polite">
            <h1 className={styles.title}>Opening my page…</h1>
          </section>
        )}

        {client !== null && !loading && session === null && (
          <section className={styles.card}>
            <SignedOutNotice ended={ended} />
            <span className={styles.badge}>My page</span>
            <h1 className={styles.title}>Everything you have on Friendword, in one place.</h1>
            <EmailSignIn
              client={client}
              reason="Sign in with the email your account uses. Nothing here is public."
            />
          </section>
        )}

        {client !== null && !loading && session !== null && state.step === 'loading' && (
          <section className={styles.card} aria-live="polite">
            <h1 className={styles.title}>Opening my page…</h1>
          </section>
        )}

        {client !== null && !loading && session !== null && summary !== null && (
          <>
            {/* No "My page" badge here: the shell's pill directly above already
                carries that word as the current page, and two identical yellow
                pills stacked read as one control repeated by mistake (browser
                QA at 375px and 1280px). */}
            <section>
              <h1 className={styles.title}>Everything you have, in one place.</h1>
            </section>

            <section className={styles.card}>
              {/* The badge stays neutral even with people waiting: `badgeFresh`
                  is teal, and teal is the verification/trust signal in this
                  system (DESIGN.md). The emphasis this card needs is the
                  tangerine primary action it already has. */}
              <span className={styles.badge}>Interest inbox</span>
              <h2 className={styles.subTitle}>People who want to meet you</h2>
              <p className={styles.lede}>{waitingCopy(summary.waiting, anyLive === true)}</p>
              <div className={styles.actionRow}>
                <Link className={styles.primary} href="/inbox">
                  Open my inbox
                </Link>
              </div>
            </section>

            <section className={styles.card}>
              <span className={styles.badge}>My interests</span>
              <h2 className={styles.subTitle}>Interest you sent</h2>
              <p className={styles.lede}>{sentCopy(summary.sent)}</p>
              <div className={styles.actionRow}>
                <Link className={styles.secondary} href="/interests">
                  Open my interests
                </Link>
              </div>
            </section>

            <section className={styles.card}>
              <span className={styles.badge}>Intro rooms</span>
              <h2 className={styles.subTitle}>Your introductions</h2>
              <p className={styles.lede}>{roomsCopy(summary.rooms)}</p>
              <div className={styles.actionRow}>
                <Link className={styles.secondary} href="/rooms">
                  Open my intro rooms
                </Link>
              </div>
            </section>

            <section className={styles.card}>
              <span className={styles.badge}>My campaigns</span>
              {/* The app calls this same set "Campaigns about me"; one area,
                  one noun on both surfaces. */}
              <h2 className={styles.subTitle}>Campaigns about you</h2>
              {summary.campaigns === null && (
                <p className={styles.lede}>
                  Your campaigns could not be read. Refresh to try again — nothing about them has
                  changed.
                </p>
              )}
              {summary.campaigns !== null && summary.campaigns.length === 0 && (
                <p className={styles.lede}>
                  No page about you yet. One appears here once a pitch about you is approved and
                  published.
                </p>
              )}
              {summary.campaigns?.map((campaign) => (
                <p key={campaign.id} className={styles.muted}>
                  <strong>{campaignStatusLabel(campaign.shownStatus)}</strong>
                  {campaign.slug === null ? ' · no public link yet' : ` · /p/${campaign.slug}`}
                </p>
              ))}
              {summary.campaigns !== null && summary.campaigns.length > 0 && (
                <div className={styles.actionRow}>
                  <Link className={styles.secondary} href="/inbox">
                    Manage my public page
                  </Link>
                </div>
              )}
              {/* The introducer's own drafts and approval requests are made and
                  listed in the Friendword app; the web has no list of them, so
                  this says where they are instead of implying they are here. */}
              <p className={styles.finePrint}>
                Pitches you are making for friends live in the Friendword app.
              </p>
            </section>

            <section className={styles.card}>
              <h2 className={styles.subTitle}>Your account</h2>
              <p className={styles.muted}>
                Sign out is in the bar at the top of every signed-in screen.
              </p>
              <p className={styles.muted}>
                Deleting your account removes your pages, interests, chats, and photos. This cannot
                be undone.
              </p>
              {/* A link, not a second delete control: one destructive button in
                  one place. The inbox owns it, and its confirmation is what
                  actually deletes anything. */}
              <div className={styles.actionRow}>
                <Link className={styles.secondary} href="/inbox#account">
                  Delete my account
                </Link>
              </div>
              <p className={styles.finePrint}>
                You confirm on that screen before anything is deleted.
              </p>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
