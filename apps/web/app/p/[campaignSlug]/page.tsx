import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { getPublishedPitchBySlug } from '@friendword/data';

import { PitchPlayer } from '@/components/PitchPlayer';
import { getPitchFixture } from '@/fixtures/pitch';
import { getSupabaseServiceClient } from '@/lib/supabaseServer';
import { fromFixture, fromPublishedPitch, type PitchView } from '@/pitch/view';

import styles from './page.module.css';

type PitchPageProps = {
  readonly params: Promise<{ readonly campaignSlug: string }>;
};

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
  const pitch = await loadPitch(campaignSlug);

  if (pitch === null) {
    return { robots: { index: false, follow: false } };
  }

  const title = `${pitch.daterName} — introduced by a friend`;
  return {
    title,
    description: pitch.description,
    robots: { index: false, follow: false },
    openGraph: {
      title,
      description: pitch.description,
      type: 'website',
      images: [{ url: '/fixtures/blair-og.svg', width: 1200, height: 630, alt: title }],
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
      <StickerField />

      <section className={styles.stageRegion} aria-label={`${pitch.daterName}’s pitch`}>
        <PitchPlayer pitch={pitch} />
      </section>

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
          <p>
            {pitch.daterName} approved every photo, word, and audience choice before this page went
            live. Interest requires signing in and completing a dating profile with 2 photos, a bio,
            and dating intent. Contact details stay private.
          </p>
        </div>
      </section>

      <footer className={`${styles.footer} ${styles.revealSix}`} data-pitch-footer>
        <p className={styles.footerPrompt}>Know someone worth hyping up?</p>
        <div className={styles.footerActions}>
          <Link className={styles.primarySticker} href="/">
            Pitch a friend
          </Link>
          <Link className={styles.secondarySticker} href="/">
            Create my Friendword
          </Link>
        </div>
        <p className={styles.wordmark}>Friendword</p>
        <p className={styles.tagline}>Dating, in your friends&apos; words.</p>
      </footer>
    </main>
  );
}
