import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { getPublishedPitchBySlug } from '@friendword/data';

import { CampaignEnded } from '@/components/CampaignEnded';
import { FlowNav } from '@/components/FlowNav';
import { ReferralTracker } from '@/components/ReferralTracker';
import { getPitchFixture } from '@/fixtures/pitch';
import { loadPitchAbsence } from '@/lib/publicPitchAbsence';
import { getSupabaseServiceClient } from '@/lib/supabaseServer';
import flowStyles from '@/styles/flowCard.module.css';

import { InterestFlow } from './InterestFlow';

type InterestPageProps = {
  readonly params: Promise<{ readonly campaignSlug: string }>;
};

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Send your interest — Friendword',
  robots: { index: false, follow: false },
};

export default async function InterestPage({ params }: InterestPageProps) {
  const { campaignSlug } = await params;

  if (getPitchFixture(campaignSlug) !== undefined) {
    return (
      <main className={flowStyles.page}>
        <div className={flowStyles.shell}>
          <FlowNav tabs={false} />
          <section className={flowStyles.card}>
            <span className={flowStyles.badge}>Demo data</span>
            <h1 className={flowStyles.title}>This is a demo — Blair isn’t a real person.</h1>
            <p className={flowStyles.muted}>
              On a real campaign, expressing interest here starts the actual flow: you sign in and
              complete a dating profile (2 photos, a bio, and your dating intent), your interest
              lands in the dater’s inbox, and if they accept, Friendword opens a private Intro Room
              where the two of you can talk. Viewing a pitch never needs an account — only reaching
              out does.
            </p>
            <Link className={flowStyles.secondary} href={`/p/${campaignSlug}`}>
              Back to the demo pitch
            </Link>
          </section>
        </div>
      </main>
    );
  }

  const serviceClient = getSupabaseServiceClient();
  const pitch =
    serviceClient === null ? null : await getPublishedPitchBySlug(serviceClient, campaignSlug);

  if (pitch === null) {
    // GAP-7 (T013): the same two answers the pitch page gives, because this is
    // where a stranger lands after tapping the CTA on a page they had already
    // opened. Being told the window closed is the difference between "I did
    // something wrong" and "I was too late".
    if ((await loadPitchAbsence(campaignSlug)) === 'ended') {
      return <CampaignEnded />;
    }
    notFound();
  }

  return (
    <>
      {/* Sign-in returns the visitor to THIS page (EmailSignIn defaults
          emailRedirectTo to the current URL), so attribution must be seeded and
          claimable here — not only on the pitch page. recordVisit is off: the
          interest flow is a deeper step, not a funnel entry, and it reports
          `interest_started` itself. */}
      <ReferralTracker seedSlug={pitch.campaignSlug} recordVisit={false} />
      <InterestFlow
        campaignId={pitch.campaignId}
        campaignSlug={pitch.campaignSlug}
        daterName={pitch.daterDisplayName}
      />
    </>
  );
}
