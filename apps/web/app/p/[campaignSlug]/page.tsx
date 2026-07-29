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
import { daterControlLine, structureProvenanceLine, transcriptProvenanceLine } from '@/pitch/copy';
import { fromFixture, fromPublishedPitch, toPitchPlayerView, type PitchView } from '@/pitch/view';

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

  const transcriptLine = transcriptProvenanceLine(pitch);

  return (
    <main className={styles.page}>
      <ReferralTracker seedSlug={campaignSlug} />
      <StickerField />

      <section className={styles.stageRegion} aria-label={`${pitch.daterName}’s pitch`}>
        {/* Fifth audit (verdict 4): PitchPlayer is a client component, so its
            props are serialized into this page's HTML. Pass the narrow player
            projection, never the whole pitch. */}
        <PitchPlayer pitch={toPitchPlayerView(pitch)} />
      </section>

      {(pitch.structure !== null ||
        pitch.approvedBody !== null ||
        pitch.transcriptText !== null) && (
        <section
          className={`${styles.storySection} ${styles.revealTwo}`}
          aria-labelledby="story-heading"
        >
          <article className={styles.storyCard}>
            {pitch.isDemo && <span className={styles.demoBadge}>Demo data</span>}
            <h2 id="story-heading">In {pitch.introducerPseudonym}’s words</h2>

            {/* CP-2: render the dater-approved structure as distinct scenes —
                hook, qualities, anecdote, good match — instead of one generic
                body blob. Older pitches without a structure snapshot fall back
                to the approved body. */}
            {pitch.structure !== null ? (
              <div className={styles.structure}>
                <div className={styles.structureScene}>
                  <span className={styles.structureLabel}>The hook</span>
                  <p className={styles.storyBody}>{pitch.structure.hook}</p>
                </div>
                <div className={styles.structureScene}>
                  <span className={styles.structureLabel}>How they know each other</span>
                  <p>{pitch.structure.relationship_context}</p>
                </div>
                <div className={styles.structureScene}>
                  <span className={styles.structureLabel}>Three specific things</span>
                  <ul className={styles.qualityList}>
                    {pitch.structure.three_specific_qualities.map((quality) => (
                      <li key={quality}>{quality}</li>
                    ))}
                  </ul>
                </div>
                <div className={styles.structureScene}>
                  <span className={styles.structureLabel}>A moment that shows it</span>
                  <p>{pitch.structure.evidence_or_anecdote}</p>
                </div>
                <div className={styles.structureScene}>
                  <span className={styles.structureLabel}>A good match for</span>
                  <p>{pitch.structure.good_match_for}</p>
                </div>
              </div>
            ) : (
              pitch.approvedBody !== null && (
                <p className={styles.storyBody}>{pitch.approvedBody}</p>
              )
            )}

            {/* Copy honesty (fifth audit P0, CLAUDE.md §12). Every sentence
                here branches on what the row actually proves — see
                src/pitch/copy.ts for the guarantee behind each one. The
                previous "every word here was reviewed and approved" was false
                twice over: rows published before the section editor carry
                sections their Dater never saw, and the transcript (which also
                runs as the captions) is nobody's to edit. */}
            <p className={styles.storyMeta}>{structureProvenanceLine(pitch)}</p>
            {transcriptLine !== null && <p className={styles.storyMeta}>{transcriptLine}</p>}
            {pitch.transcriptText !== null && (
              <details className={styles.transcript}>
                <summary>Read the full voice transcript</summary>
                <p>{pitch.transcriptText}</p>
              </details>
            )}
          </article>
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
          <h2 id="trust-heading">
            {pitch.isDemo
              ? 'How control works on a real page.'
              : `${pitch.daterName} stays in control.`}
          </h2>
          {/* TODO(identity-provider): Restore identity-verification copy after verification ships. */}
          {/* Copy honesty (fifth audit, verdict 4): this block used to say the
              Dater "edited the wording, photos, and claims". Claims are not
              edited — they are kept or removed, one by one — and on a
              pre-section-editor row the wording was never theirs to edit at
              all. Framed as "who can reach out", not "who can see it"
              (viewing is open to anyone). */}
          <p>{daterControlLine(pitch)}</p>
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
