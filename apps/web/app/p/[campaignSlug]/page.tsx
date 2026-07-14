import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { getPublishedPitchBySlug } from '@friendword/data';

import { PitchPlayer } from '@/components/PitchPlayer';
import { ReferralTracker } from '@/components/ReferralTracker';
import { ReportCampaignLink } from '@/components/ReportCampaignLink';
import { getPitchFixture } from '@/fixtures/pitch';
import { getSupabaseServiceClient } from '@/lib/supabaseServer';
import { fromFixture, fromPublishedPitch, type PitchView } from '@/pitch/view';

import styles from './page.module.css';

type PitchPageProps = {
  readonly params: Promise<{ readonly campaignSlug: string }>;
};

type HeaderReader = Pick<Headers, 'get'>;

function metadataOrigin(requestHeaders: HeaderReader): URL {
  const deploymentHost =
    process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL ?? null;
  if (deploymentHost !== null && deploymentHost.length > 0) {
    return new URL(`https://${deploymentHost}`);
  }

  const forwardedHost = requestHeaders.get('x-forwarded-host')?.split(',')[0]?.trim();
  const host = forwardedHost ?? requestHeaders.get('host') ?? 'localhost:3000';
  const forwardedProtocol = requestHeaders.get('x-forwarded-proto')?.split(',')[0]?.trim();
  const protocol =
    forwardedProtocol === 'http' || forwardedProtocol === 'https'
      ? forwardedProtocol
      : host.startsWith('localhost')
        ? 'http'
        : 'https';
  const origin = `${protocol}://${host}`;
  return URL.canParse(origin) ? new URL(origin) : new URL('http://localhost:3000');
}

// Signed media URLs must be minted per request, never cached at build time.
export const dynamic = 'force-dynamic';

async function loadPitch(campaignSlug: string): Promise<PitchView | null> {
  const fixture = getPitchFixture(campaignSlug);
  if (fixture !== undefined) {
    return fromFixture(fixture);
  }

  const serviceClient = getSupabaseServiceClient();
  if (serviceClient === null) {
    return null;
  }

  const published = await getPublishedPitchBySlug(serviceClient, campaignSlug);
  return published === null ? null : fromPublishedPitch(published);
}

export async function generateMetadata({ params }: PitchPageProps): Promise<Metadata> {
  const { campaignSlug } = await params;
  const origin = metadataOrigin(await headers());
  const isDemo = getPitchFixture(campaignSlug) !== undefined;
  const pitch = await loadPitch(campaignSlug);

  if (pitch === null) {
    return { robots: { index: false, follow: false } };
  }

  const title = `${pitch.daterName} — introduced by a friend`;
  const ogPath = isDemo
    ? '/fixtures/blair-og.svg'
    : `/api/og?slug=${encodeURIComponent(campaignSlug)}`;
  return {
    metadataBase: origin,
    title,
    description: pitch.description,
    robots: { index: false, follow: false },
    openGraph: {
      title,
      description: pitch.description,
      type: 'website',
      images: [
        {
          url: new URL(ogPath, origin).toString(),
          width: 1200,
          height: 630,
          alt: title,
        },
      ],
    },
  };
}

function StickerField() {
  return (
    <div className={styles.stickerField} aria-hidden="true">
      <svg className={styles.star} viewBox="0 0 120 120">
        <path d="m60 5 14 35 38 3-29 24 9 37-32-20-32 20 9-37L8 43l38-3z" />
      </svg>
      <svg className={styles.smile} viewBox="0 0 120 120">
        <circle cx="60" cy="60" r="49" />
        <circle cx="43" cy="49" r="5" className={styles.inkFill} />
        <circle cx="77" cy="49" r="5" className={styles.inkFill} />
        <path d="M36 68c9 24 39 27 50 0" />
      </svg>
      <svg className={styles.squiggle} viewBox="0 0 180 80">
        <path d="M4 54c20-45 39 24 60-13s37 35 58-4 36 23 54-12" />
      </svg>
    </div>
  );
}

export default async function PitchPage({ params }: PitchPageProps) {
  const { campaignSlug } = await params;
  const pitch = await loadPitch(campaignSlug);

  if (pitch === null) {
    notFound();
  }

  return (
    <main className={styles.page}>
      <ReferralTracker seedSlug={campaignSlug} />
      <StickerField />

      <section className={styles.stageRegion} aria-label={`${pitch.daterName}’s pitch`}>
        <PitchPlayer pitch={pitch} />
      </section>

      {(pitch.approvedBody !== null || pitch.transcriptText !== null) && (
        <section
          className={`${styles.storySection} ${styles.revealTwo}`}
          aria-labelledby="story-heading"
        >
          <article className={styles.storyCard}>
            <h2 id="story-heading">In {pitch.introducerPseudonym}’s words</h2>
            {pitch.approvedBody !== null && (
              <p className={styles.storyBody}>{pitch.approvedBody}</p>
            )}
            <p className={styles.storyMeta}>
              Structured from {pitch.introducerPseudonym}’s voice note — every word here was
              reviewed and approved by {pitch.daterName} before publishing.
            </p>
            {pitch.transcriptText !== null && (
              <details className={styles.transcript}>
                <summary>Read the full voice transcript</summary>
                <p>{pitch.transcriptText}</p>
              </details>
            )}
          </article>
        </section>
      )}

      {pitch.vouches.length > 0 && (
        <section className={styles.vouchSection} aria-labelledby="vouch-heading">
          <div className={`${styles.vouchHeading} ${styles.revealTwo}`}>
            <span className={styles.countBadge}>
              +{pitch.vouches.length} friend{pitch.vouches.length === 1 ? '' : 's'} vouch
            </span>
            <h2 id="vouch-heading">The liner notes</h2>
            <p>
              More people who know {pitch.daterName} in real life, shared only after{' '}
              {pitch.daterName} approved them.
            </p>
          </div>

          <div className={styles.vouchGrid}>
            {pitch.vouches.map((vouch, index) => (
              <article
                className={`${styles.vouchCard} ${index === 0 ? styles.vouchLeft : styles.vouchRight} ${index === 0 ? styles.revealThree : styles.revealFour}`}
                key={vouch.pseudonym}
              >
                <span className={styles.vouchBadge}>{vouch.relationship}</span>
                <blockquote>“{vouch.quote}”</blockquote>
                <p>— {vouch.pseudonym}</p>
              </article>
            ))}
          </div>
        </section>
      )}

      <section
        className={`${styles.trustNote} ${styles.revealFive}`}
        aria-labelledby="trust-heading"
      >
        <span className={styles.verifiedMark} aria-hidden="true">
          ✓
        </span>
        <div>
          <h2 id="trust-heading">{pitch.daterName} stays in control.</h2>
          {/* TODO(identity-provider): Restore identity-verification copy after verification ships. */}
          {/* Copy honesty (second audit §11): claims below match the shipped
              Slice 7 dater controls — text editing, own photos, audience,
              location precision, and duration — no more, no less. */}
          <p>
            {pitch.daterName} reviewed this pitch — the recording, the wording, the photos shown
            here, and its claims — could edit any of it, and chose who can reach out and how long
            this page stays up before approving it. Interest requires signing in and completing a
            dating profile with 2 photos, a bio, and dating intent. Contact details stay private.
          </p>
        </div>
      </section>

      <footer className={`${styles.footer} ${styles.revealSix}`} data-pitch-footer>
        <p className={styles.footerPrompt}>Know someone worth hyping up?</p>
        <div className={styles.footerActions}>
          <Link
            className={styles.primarySticker}
            href={`/?src=public-pitch&ref=${campaignSlug}#start`}
          >
            Pitch a friend
          </Link>
          <Link className={styles.secondarySticker} href="/#create">
            Create my Friendword
          </Link>
        </div>
        <p className={styles.wordmark}>Friendword</p>
        <p className={styles.tagline}>Dating, in your friends&apos; words.</p>
        <ReportCampaignLink campaignSlug={campaignSlug} />
      </footer>
    </main>
  );
}
