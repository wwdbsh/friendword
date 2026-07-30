'use client';

import Image from 'next/image';
import { useEffect, useState, type RefObject } from 'react';

import type { PitchSceneV2 } from '@friendword/contracts';

import { grainTileUri, sceneV2Frame, type SceneTextFields, type SceneWord } from '@/pitch/sceneV2';

import styles from './MotionSceneV2.module.css';

// The v2 stage: the interpreter's frame, drawn.
//
// This component owns its own animation clock. The player around it updates on
// `timeupdate` (roughly 4Hz), which is right for a caption and a time readout and
// far too coarse for camera travel, so the shot layer reads `currentTime` on
// every animation frame instead. That is a READ of the media clock, never a
// re-derivation of the timeline: the shots, crops and effect windows all come out
// of the approved scene (see src/pitch/sceneV2.ts for why the interpretation is
// frozen).
//
// The loop runs in BOTH motion modes, because it is a clock read and not an
// animation: the interpreter is what drops travel, punch, the light leak and
// grain animation under `prefers-reduced-motion`, leaving a crossfaded shot list.
// What reduced motion still needs from the clock is resolution — the player's own
// `timeupdate` prop lands roughly every 250ms, so sampling a text layer's 150ms
// opacity ramp on it would render the ramp AS A STEP and put back exactly the
// flash the ramp exists to remove.

export type MotionSceneV2Photo = {
  readonly assetId: string | null;
  readonly src: string;
  readonly alt: string;
};

export type MotionSceneV2Props = {
  readonly scene: PitchSceneV2;
  readonly photoIndexes: ReadonlyMap<string, number>;
  readonly photos: readonly MotionSceneV2Photo[];
  readonly words: readonly SceneWord[];
  readonly text: SceneTextFields | null;
  readonly reducedMotion: boolean;
  /** The player's clock: authoritative while paused, seeking or unmounted audio. */
  readonly elapsedMs: number;
  readonly isPlaying: boolean;
  readonly clock: RefObject<HTMLAudioElement | null>;
  /** 'plain' skips next/image for signed storage URLs (the consent preview). */
  readonly imageMode: 'optimized' | 'plain';
};

export function MotionSceneV2({
  scene,
  photoIndexes,
  photos,
  words,
  text,
  reducedMotion,
  elapsedMs,
  isPlaying,
  clock,
  imageMode,
}: MotionSceneV2Props) {
  const [frameMs, setFrameMs] = useState(elapsedMs);
  // The media clock is running, so the stage follows it frame by frame.
  const followingClock = isPlaying;

  useEffect(() => {
    if (followingClock) {
      return;
    }
    setFrameMs(elapsedMs);
  }, [followingClock, elapsedMs]);

  useEffect(() => {
    if (!followingClock) {
      return;
    }
    let handle = 0;
    const step = () => {
      const audio = clock.current;
      if (audio !== null) {
        setFrameMs(audio.currentTime * 1000);
      }
      handle = requestAnimationFrame(step);
    };
    handle = requestAnimationFrame(step);
    return () => cancelAnimationFrame(handle);
  }, [followingClock, clock]);

  const frame = sceneV2Frame(scene, photoIndexes, frameMs, { words, text, reducedMotion });
  const media = frame.photo ?? frame.backdrop;
  const mediaFilter =
    media === null || media.blurPx === 0 ? frame.filter : `${frame.filter} blur(${media.blurPx}px)`;

  return (
    <div
      className={`${styles.scene} ${reducedMotion ? styles.reduced : ''}`}
      data-scene-v2
      data-motion-template={scene.template}
      data-motion-shot={frame.shotIndex}
      data-motion-shot-level={frame.level}
    >
      {photos.map((photo, index) => {
        const visible = media !== null && media.photoIndex === index;
        const className = `${styles.photo} ${visible ? styles.photoVisible : ''}`;
        const style = visible
          ? { transform: media.transform, filter: mediaFilter }
          : { transform: 'none' };
        return imageMode === 'plain' ? (
          <img
            className={className}
            key={photo.src}
            src={photo.src}
            alt={photo.alt}
            aria-hidden={!visible}
            data-motion-photo={photo.assetId ?? ''}
            style={style}
            loading={index === 0 ? 'eager' : 'lazy'}
            decoding="async"
          />
        ) : (
          <Image
            className={className}
            key={photo.src}
            src={photo.src}
            alt={photo.alt}
            aria-hidden={!visible}
            data-motion-photo={photo.assetId ?? ''}
            style={style}
            fill
            priority={index === 0}
            sizes="(max-width: 700px) 100vw, 506px"
          />
        );
      })}

      {media !== null && media.dim > 0 && (
        <div className={styles.dim} style={{ opacity: media.dim }} />
      )}

      {frame.warmth !== 0 && (
        <div
          className={`${styles.warmth} ${frame.warmth > 0 ? styles.warmthWarm : styles.warmthCool}`}
          // The grade's warmth is a signed tint, not a filter: a CSS sepia()
          // cannot go cool, and hue-rotate would move every hue, faces included.
          style={{ opacity: Math.abs(frame.warmth) * 0.35 }}
        />
      )}

      {frame.vignette > 0 && (
        <div className={styles.vignette} style={{ opacity: frame.vignette }} />
      )}

      {frame.grain !== null && (
        <div
          className={styles.grain}
          style={{
            opacity: frame.grain.opacity,
            backgroundImage: grainTileUri(frame.grain.seed, frame.grain.sizePx),
            backgroundSize: `${frame.grain.sizePx * 32}px`,
          }}
          data-scene-grain={frame.grain.seed}
        />
      )}

      {frame.lightLeak !== null && (
        <div
          className={styles.lightLeak}
          style={{
            opacity: frame.lightLeak.opacity,
            background: `linear-gradient(${frame.lightLeak.angleDeg}deg, transparent 30%, var(--color-stage-text) 120%)`,
          }}
          data-scene-light-leak
        />
      )}

      {frame.card !== null && (
        <p
          className={styles.card}
          style={{
            // Opacity is the interpreter's ramp, never the eased reveal: the
            // reveal may be as short as 80ms, which reads as a flash. The reveal
            // is spent on the slide instead, and reduced motion pins it to 1.
            opacity: frame.card.opacity,
            transform: `translateY(calc(-50% + ${(1 - frame.card.reveal) * 12}px)) scale(${
              1 + frame.card.emphasis * 0.04
            })`,
          }}
          data-scene-card
        >
          {frame.card.text}
        </p>
      )}

      {frame.badge !== null && (
        <p
          className={styles.badge}
          style={{
            opacity: frame.badge.opacity,
            transform: `scale(${1 + frame.badge.emphasis * 0.08})`,
          }}
          data-scene-badge
        >
          {frame.badge.text}
        </p>
      )}

      {frame.wordPop !== null && (
        <span
          className={styles.wordPop}
          // The scrim rides on this element, so the ramp covers the box of light
          // as well as the word.
          style={{
            opacity: frame.wordPop.opacity,
            transform: `scale(${frame.wordPop.scale})`,
          }}
          data-scene-word-pop
        >
          {frame.wordPop.text}
        </span>
      )}

      {frame.progressBar !== null && (
        <div
          className={`${styles.progressBar} ${
            frame.progressBar.anchor === 'top' ? styles.progressBarTop : styles.progressBarBottom
          }`}
          style={{
            height: `${frame.progressBar.thicknessPx}px`,
            opacity: frame.progressBar.opacity,
          }}
          data-scene-progress={frame.progressBar.percent}
        >
          <div className={styles.progressFill} style={{ width: `${frame.progressBar.percent}%` }} />
        </div>
      )}
    </div>
  );
}
