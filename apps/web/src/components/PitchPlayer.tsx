'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';

import { trackEvent } from '@friendword/data';

import { getSupabaseBrowserClient } from '@/lib/supabaseClient';
import { activeWindowIndex, distributePhotoScenes, type SceneWindow } from '@/pitch/scenes';
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

// CP-2: the waveform is decoded from the real audio. It has three honest
// states — never a fixed fake signal. 'loading' while decoding, 'error' when
// the fetch/decode fails, or the real per-bar peaks once decoded.
type WaveformState = readonly number[] | 'loading' | 'error';

function formatTime(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function PlayIcon({ paused }: { readonly paused: boolean }) {
  return paused ? (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m8 5 11 7L8 19z" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 5h4v14H7zm7 0h4v14h-4z" />
    </svg>
  );
}

export function PitchPlayer({ pitch }: PitchPlayerProps) {
  const [elapsedMs, setElapsedMs] = useState(0);
  const [durationMs, setDurationMs] = useState(pitch.durationMs);
  const [waveform, setWaveform] = useState<WaveformState>(
    pitch.audioUrl === null ? 'error' : 'loading',
  );
  const [isPlaying, setIsPlaying] = useState(false);
  const [isFooterVisible, setIsFooterVisible] = useState(false);
  const elapsedRef = useRef(0);
  const audioRef = useRef<HTMLAudioElement>(null);
  const hasRealAudio = pitch.audioUrl !== null;

  useEffect(() => {
    const source = new URLSearchParams(window.location.search).get('src');
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
      });
    }
  }, [pitch.campaignSlug]);

  // CP-3 honesty: there is no simulated playback. Without real audio the
  // player renders the written pitch statically — no Play, no fake timer.

  useEffect(() => {
    const audio = audioRef.current;
    if (!hasRealAudio || audio === null) {
      return;
    }

    if (isPlaying) {
      void audio.play().catch(() => setIsPlaying(false));
    } else {
      audio.pause();
    }
  }, [isPlaying, hasRealAudio]);

  // CP-2: derive the waveform from the actual audio. On any failure we surface
  // an accessible error state rather than silently keeping a fake placeholder.
  useEffect(() => {
    if (pitch.audioUrl === null) {
      return;
    }
    let cancelled = false;
    setWaveform('loading');
    void (async () => {
      try {
        const response = await fetch(pitch.audioUrl as string);
        if (!response.ok) {
          if (!cancelled) setWaveform('error');
          return;
        }
        const buffer = await response.arrayBuffer();
        const context = new AudioContext();
        try {
          const decoded = await context.decodeAudioData(buffer);
          const channel = decoded.getChannelData(0);
          const barCount = 48;
          const blockSize = Math.max(1, Math.floor(channel.length / barCount));
          const peaks: number[] = [];
          let maxPeak = 0;
          for (let bar = 0; bar < barCount; bar += 1) {
            let sum = 0;
            const start = bar * blockSize;
            for (
              let index = start;
              index < start + blockSize && index < channel.length;
              index += 1
            ) {
              sum += Math.abs(channel[index] ?? 0);
            }
            const average = sum / blockSize;
            peaks.push(average);
            maxPeak = Math.max(maxPeak, average);
          }
          if (!cancelled) {
            if (maxPeak > 0) {
              setWaveform(peaks.map((peak) => Math.max(12, Math.round((peak / maxPeak) * 100))));
            } else {
              setWaveform('error');
            }
          }
        } finally {
          void context.close();
        }
      } catch {
        if (!cancelled) setWaveform('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pitch.audioUrl]);

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

  const progress = durationMs > 0 ? Math.min(1, elapsedMs / durationMs) : 0;
  const progressPercent = Math.round(progress * 100);

  // CP-2: photo scenes follow the recording's real duration and segment
  // timing. Recomputes when the <audio> metadata corrects the duration.
  const segmentWindows: readonly SceneWindow[] = useMemo(
    () => pitch.captions.map((caption) => ({ startMs: caption.startMs, endMs: caption.endMs })),
    [pitch.captions],
  );
  const photoWindows = useMemo(
    () => distributePhotoScenes(pitch.photos.length, durationMs, segmentWindows),
    [pitch.photos.length, durationMs, segmentWindows],
  );
  const activePhotoIndex = hasRealAudio ? activeWindowIndex(photoWindows, elapsedMs) : 0;

  // CP-2 honesty: captions are segment-level (real provider timestamps), not
  // fabricated per-word highlights. The active segment is shown as a whole.
  const activeCaptionIndex = hasRealAudio ? activeWindowIndex(pitch.captions, elapsedMs) : 0;
  const activeCaption = pitch.captions[activeCaptionIndex];

  const togglePlayback = () => {
    if (!hasRealAudio) {
      return;
    }
    if (elapsedRef.current >= durationMs && durationMs > 0) {
      elapsedRef.current = 0;
      setElapsedMs(0);
      if (audioRef.current !== null) {
        audioRef.current.currentTime = 0;
      }
    }
    setIsPlaying((current) => !current);
  };

  const interestButton = (className: string | undefined) => (
    <Link className={className} href={`/p/${pitch.campaignSlug}/interest`}>
      I&apos;m interested
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 12h14m-6-6 6 6-6 6" />
      </svg>
    </Link>
  );

  return (
    <div className={styles.playerShell}>
      {pitch.audioUrl !== null && (
        <audio
          ref={audioRef}
          src={pitch.audioUrl}
          preload="metadata"
          onLoadedMetadata={(event) => {
            const seconds = event.currentTarget.duration;
            if (Number.isFinite(seconds) && seconds > 0) {
              setDurationMs(seconds * 1000);
            }
          }}
          onTimeUpdate={(event) => {
            const nextElapsed = event.currentTarget.currentTime * 1000;
            elapsedRef.current = nextElapsed;
            setElapsedMs(nextElapsed);
          }}
          onEnded={() => setIsPlaying(false)}
        />
      )}
      <article className={styles.stage}>
        <div className={styles.photos}>
          {pitch.photos.map((photo, index) => (
            <Image
              className={`${styles.photo} ${index === activePhotoIndex ? styles.photoActive : ''}`}
              key={photo.src}
              src={photo.src}
              alt={photo.alt}
              aria-hidden={index !== activePhotoIndex}
              fill
              priority={index === 0}
              sizes="(max-width: 700px) 100vw, 506px"
            />
          ))}
          <div className={styles.photoWash} />
        </div>

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

        {pitch.approximateLocation !== null && (
          <div className={styles.location}>{pitch.approximateLocation}</div>
        )}

        {hasRealAudio ? (
          activeCaption === undefined ? (
            // No transcript segments: don't fabricate a caption timeline.
            <div className={styles.caption} data-testid="no-captions">
              Captions aren’t available for this recording yet.
            </div>
          ) : (
            <div className={styles.caption} aria-live="polite" data-testid="segment-caption">
              {activeCaption.text}
            </div>
          )
        ) : (
          // CP-3 honesty: no recording here, so the whole written pitch is
          // shown at once instead of pretending to play.
          <div className={styles.caption} data-testid="written-pitch">
            {pitch.captions.map((caption) => (
              <span key={caption.startMs}>{caption.text} </span>
            ))}
          </div>
        )}

        {hasRealAudio ? (
          <div className={styles.controls}>
            <button
              className={styles.playButton}
              type="button"
              onClick={togglePlayback}
              aria-label={
                isPlaying
                  ? `Pause ${pitch.introducerPseudonym}’s pitch`
                  : `Play ${pitch.introducerPseudonym}’s pitch`
              }
            >
              <PlayIcon paused={!isPlaying} />
            </button>

            <div className={styles.timeline}>
              {Array.isArray(waveform) ? (
                <svg
                  className={`${styles.waveform} ${isPlaying ? styles.waveformPlaying : ''}`}
                  viewBox="0 0 100 100"
                  preserveAspectRatio="none"
                  role="img"
                  aria-label={`Pitch progress ${progressPercent} percent`}
                >
                  {waveform.map((level, index) => {
                    const barWidth = 100 / waveform.length;
                    const played = (index + 1) / waveform.length <= progress;
                    return (
                      <rect
                        className={played ? styles.barPlayed : styles.barWaiting}
                        key={`${level}-${index}`}
                        x={index * barWidth}
                        y={100 - level}
                        width={barWidth * 0.56}
                        height={level}
                        rx={barWidth * 0.28}
                      />
                    );
                  })}
                </svg>
              ) : (
                // CP-2: accessible fallback. Progress still tracks the real
                // audio; we never render a fabricated signal.
                <div className={styles.waveformFallback}>
                  <div
                    className={styles.progressTrack}
                    role="img"
                    aria-label={`Pitch progress ${progressPercent} percent`}
                  >
                    <div className={styles.progressFill} style={{ width: `${progressPercent}%` }} />
                  </div>
                  <p className={styles.waveformStatus} role="status">
                    {waveform === 'loading'
                      ? 'Analyzing the recording…'
                      : 'Couldn’t load the audio waveform — playback still works.'}
                  </p>
                </div>
              )}
              <div className={styles.timeRow}>
                <span>{formatTime(elapsedMs)}</span>
                <span>{formatTime(durationMs)}</span>
              </div>
            </div>
          </div>
        ) : (
          <p className={styles.noAudioNote}>
            No voice recording in this preview — a real Friendword page plays the friend’s actual
            voice note.
          </p>
        )}

        {interestButton(styles.desktopInterest)}
      </article>

      <div
        className={`${styles.mobileInterest} ${isFooterVisible ? styles.mobileInterestHidden : ''}`}
      >
        {interestButton(styles.interestButton)}
      </div>
    </div>
  );
}
