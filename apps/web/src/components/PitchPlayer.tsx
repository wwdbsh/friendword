'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import type { PitchView } from '@/pitch/view';

import styles from './PitchPlayer.module.css';

type PitchPlayerProps = {
  readonly pitch: PitchView;
};

const TICK_MS = 80;

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
  }, []);

  useEffect(() => {
    if (!isPlaying || hasRealAudio) {
      return;
    }

    const startedAt = window.performance.now() - elapsedRef.current;
    const intervalId = window.setInterval(() => {
      const nextElapsed = Math.min(durationMs, window.performance.now() - startedAt);
      elapsedRef.current = nextElapsed;
      setElapsedMs(nextElapsed);

      if (nextElapsed >= durationMs) {
        window.clearInterval(intervalId);
        setIsPlaying(false);
      }
    }, TICK_MS);

    return () => window.clearInterval(intervalId);
  }, [isPlaying, hasRealAudio, durationMs]);

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

  const progress = durationMs > 0 ? elapsedMs / durationMs : 0;
  // Real audio has no per-photo timeline yet; spread the photos evenly.
  const activePhotoIndex = hasRealAudio
    ? Math.min(Math.floor(progress * pitch.photos.length), pitch.photos.length - 1)
    : pitch.photos.findIndex((photo) => elapsedMs >= photo.startMs && elapsedMs < photo.endMs);
  const activeCaption =
    pitch.captions.find((caption) => elapsedMs >= caption.startMs && elapsedMs < caption.endMs) ??
    pitch.captions[0];
  const captionWords = activeCaption.text.split(' ');
  const captionProgress =
    (elapsedMs - activeCaption.startMs) / (activeCaption.endMs - activeCaption.startMs);
  const activeWordIndex = Math.floor(captionProgress * captionWords.length);

  const togglePlayback = () => {
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
              className={`${styles.photo} ${index === activePhotoIndex || (activePhotoIndex < 0 && index === 0) ? styles.photoActive : ''}`}
              key={photo.src}
              src={photo.src}
              alt={photo.alt}
              aria-hidden={index !== activePhotoIndex && !(activePhotoIndex < 0 && index === 0)}
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
          <h1>{pitch.age === null ? pitch.daterName : `${pitch.daterName}, ${pitch.age}`}</h1>
          <span className={styles.relationshipSticker}>{pitch.relationship}</span>
        </header>

        {pitch.approximateLocation !== null && (
          <div className={styles.location}>{pitch.approximateLocation}</div>
        )}

        <div className={styles.caption} aria-live="off">
          {captionWords.map((word, index) => (
            <span
              className={index <= activeWordIndex ? styles.wordActive : undefined}
              key={`${word}-${index}`}
            >
              {word}{' '}
            </span>
          ))}
        </div>

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
            <svg
              className={`${styles.waveform} ${isPlaying ? styles.waveformPlaying : ''}`}
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              role="img"
              aria-label={`Pitch progress ${Math.round(progress * 100)} percent`}
            >
              {pitch.waveform.map((level, index) => {
                const barWidth = 100 / pitch.waveform.length;
                const played = (index + 1) / pitch.waveform.length <= progress;
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
            <div className={styles.timeRow}>
              <span>{formatTime(elapsedMs)}</span>
              <span>{formatTime(durationMs)}</span>
            </div>
          </div>
        </div>

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
