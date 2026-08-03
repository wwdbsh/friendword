'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { trackEvent } from '@friendword/data';

import { MotionPitchPlayer } from '@/components/MotionPitchPlayer';
import { getSupabaseBrowserClient } from '@/lib/supabaseClient';
import { normalizeChannel } from '@/lib/waitlist';
import type { PitchPlayerView } from '@/pitch/view';

import styles from './PitchPlayer.module.css';

// Fifth audit (verdict 4): this is a client component, so every prop lands in
// the RSC flight payload of the public page's HTML. It takes `PitchPlayerView`
// — not `PitchView` — so the published `structure` (hard claims included), the
// approved body and the full transcript cannot ride along. Widen this type
// only if the player genuinely renders the new field.
type PitchPlayerProps = {
  readonly pitch: PitchPlayerView;
};

/**
 * The public page's shell around the shared motion player: attribution and
 * view analytics, the interest CTA, and the sticky mobile CTA. Playback itself
 * — photo windows, captions, waveform, transport — belongs to
 * `MotionPitchPlayer`, which the Dater's consent preview renders too. That
 * shared component is the reason the published page cannot play a different
 * timeline from the one the Dater approved.
 */
export function PitchPlayer({ pitch }: PitchPlayerProps) {
  const [isFooterVisible, setIsFooterVisible] = useState(false);

  useEffect(() => {
    const search = new URLSearchParams(window.location.search);
    const source = search.get('src');
    if (source !== null && source.length > 0) {
      // Preserved for the verified-interest flow to attach after authentication lands.
      window.sessionStorage.setItem('fw_attribution', source);
    }

    const viewedKey = `fw_viewed_${pitch.campaignSlug}`;
    if (window.sessionStorage.getItem(viewedKey) === null) {
      window.sessionStorage.setItem(viewedKey, '1');
      trackEvent(getSupabaseBrowserClient(), 'pitch_viewed_unique', {
        campaign_slug: pitch.campaignSlug,
        source: source ?? window.sessionStorage.getItem('fw_attribution'),
        // Which acquisition channel brought this view (viral-loop slice).
        channel: normalizeChannel(search.get('ch')),
      });
    }
  }, [pitch.campaignSlug]);

  useEffect(() => {
    const footer = document.querySelector('[data-pitch-footer]');
    if (footer === null) {
      return;
    }

    const observer = new IntersectionObserver((entries) =>
      setIsFooterVisible(entries[0]?.isIntersecting ?? false),
    );
    observer.observe(footer);
    return () => observer.disconnect();
  }, []);

  const interestButton = (className: string | undefined) => (
    <Link className={className} href={`/p/${pitch.campaignSlug}/interest`}>
      I&apos;m interested
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 12h14m-6-6 6 6-6 6" />
      </svg>
    </Link>
  );

  return (
    <>
      <MotionPitchPlayer
        photos={pitch.photos}
        scene={pitch.scene}
        sceneWords={pitch.sceneWords}
        sceneText={pitch.sceneText}
        captions={pitch.captions}
        audioUrl={pitch.audioUrl}
        fallbackDurationMs={pitch.durationMs}
        location={pitch.approximateLocation}
        playLabel={`Play ${pitch.introducerPseudonym}’s pitch`}
        pauseLabel={`Pause ${pitch.introducerPseudonym}’s pitch`}
        noAudioNote="No voice recording in this preview — a real Friendword page plays the friend’s actual voice note."
        header={
          <header className={styles.pitchHeader}>
            <p>
              <strong>{pitch.introducerPseudonym}</strong> introduces
            </p>
            {/* GP-P0-3: age appears only when real, dater-confirmed data provides
                it (pitch.age non-null). The demo carries no age, so it shows the
                name alone — no fabricated "Blair, 29". */}
            <h1>{pitch.age === null ? pitch.daterName : `${pitch.daterName}, ${pitch.age}`}</h1>
            <span className={styles.relationshipSticker}>{pitch.relationship}</span>
          </header>
        }
      >
        {interestButton(styles.desktopInterest)}
      </MotionPitchPlayer>

      <div
        className={`${styles.mobileInterest} ${isFooterVisible ? styles.mobileInterestHidden : ''}`}
      >
        {interestButton(styles.interestButton)}
      </div>
    </>
  );
}
