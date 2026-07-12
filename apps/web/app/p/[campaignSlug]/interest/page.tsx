import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { getPublishedPitchBySlug } from '@friendword/data';

import { getPitchFixture } from '@/fixtures/pitch';
import { getSupabaseServiceClient } from '@/lib/supabaseServer';
import flowStyles from '@/styles/flowCard.module.css';

import { InterestFlow } from './InterestFlow';

type InterestPageProps = {
  readonly params: Promise<{ readonly campaignSlug: string }>;
};

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Send verified interest — Friendword',
  robots: { index: false, follow: false },
};

export default async function InterestPage({ params }: InterestPageProps) {
  const { campaignSlug } = await params;

  if (getPitchFixture(campaignSlug) !== undefined) {
    return (
      <main className={flowStyles.page}>
        <div className={flowStyles.shell}>
          <p className={flowStyles.wordmark}>Friendword</p>
          <section className={flowStyles.card}>
            <span className={flowStyles.badge}>Demo pitch</span>
            <h1 className={flowStyles.title}>This one’s just a demo.</h1>
            <p className={flowStyles.muted}>
              Verified interest works on real campaigns. When a friend publishes a pitch about a
              real person, this is where you’d introduce yourself.
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
    notFound();
  }

  return (
    <InterestFlow
      campaignId={pitch.campaignId}
      campaignSlug={pitch.campaignSlug}
      daterName={pitch.daterDisplayName}
    />
  );
}
