'use client';

import Image from 'next/image';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import type { PitchSceneAnyVersion } from '@friendword/contracts';

import type { PitchCaption } from '@/fixtures/pitch';
import { activeCaptionIndex, captionParts, type CaptionSegment } from '@/pitch/captionChrome';
import {
  activeMotionPhotoIndex,
  legacyMotionWindows,
  motionWindowSignature,
  sceneDurationDriftMs,
  sceneMotionWindows,
  type MotionWindow,
} from '@/pitch/motion';
import type { SceneWindow } from '@/pitch/scenes';
import {
  asPitchSceneV2,
  sceneV2ActivePhotoIndex,
  sceneV2Frame,
  sceneV2PhotoIndexes,
  sceneV2ShotSignature,
  type SceneTextFields,
  type SceneWord,
} from '@/pitch/sceneV2';

import { MotionSceneV2 } from './MotionSceneV2';
import { CaptionLayer, PitchCaptionCard } from './PitchCaption';
import styles from './PitchPlayer.module.css';

// The one player for an approved motion pitch. Both surfaces that must agree —
// the Dater's consent preview and the published page — render THIS component, so
// "what I approved" and "what publishes" cannot drift apart by construction.
//
// With an approved scene the photo windows come straight out of the scene JSON.
// The <audio> element's metadata duration is used for the clock and the time
// readout only; it never re-derives a window, because it differs per browser and
// the Dater approved the scene, not the browser's measurement.
//
// A v2 scene (a shot list with crops, effects and text cards) is handed to
// `MotionSceneV2`; a v1 scene keeps the original crossfade path, and a row with
// no scene keeps the legacy runtime distribution (A4). Nothing is backfilled: a
// v1 row plays as v1 forever, because nobody approved a v2 timeline for it.

export type MotionPhoto = {
  /** pitch_assets id, or null for imagery no scene can reference (fixtures). */
  readonly assetId: string | null;
  readonly src: string;
  readonly alt: string;
};

export type MotionPitchPlayerProps = {
  readonly photos: readonly MotionPhoto[];
  readonly scene: PitchSceneAnyVersion | null;
  /** Segment-level captions with the provider's real timestamps. */
  readonly captions: readonly PitchCaption[];
  /**
   * Transcript words with the (segmentIndex, wordIndex) pairs a v2 `wordPop`
   * references. Absent or short means the accent is silently skipped — never a
   * placeholder word (see src/pitch/sceneV2.ts).
   */
  readonly sceneWords?: readonly SceneWord[];
  /**
   * The five reviewed sentences a v2 text card may print. Null skips every card:
   * a scene names a field, so the text has to come from the revision, and a
   * revision that carries none must show nothing rather than invent a line.
   */
  readonly sceneText?: SceneTextFields | null;
  readonly audioUrl: string | null;
  /** Duration to show before the media reports its own; 0 when unknown. */
  readonly fallbackDurationMs: number;
  /** Surface-specific overlay (who is being introduced). */
  readonly header: ReactNode;
  readonly location: string | null;
  /** Shown instead of the transport when there is no recording (CP-3 honesty). */
  readonly noAudioNote: string;
  /**
   * 'plain' skips next/image. Required wherever the image is a signed storage URL
   * whose host is not on the optimizer allowlist (the consent preview), since the
   * optimizer would fail the request rather than show the Dater their own photo.
   */
  readonly imageMode?: 'optimized' | 'plain';
  readonly playLabel: string;
  readonly pauseLabel: string;
  /** Slot rendered at the bottom of the stage (e.g. the interest CTA). */
  readonly children?: ReactNode;
};

// The waveform is decoded from the real audio and has three honest states —
// never a fixed fake signal.
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

/**
 * Live `prefers-reduced-motion`. Defaults to false so the server render and the
 * first client render agree, then corrects on mount and tracks changes — a viewer
 * who turns the setting on mid-page gets the still version without a reload.
 */
function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(query.matches);
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return reduced;
}

export function MotionPitchPlayer({
  photos,
  scene,
  sceneWords = [],
  sceneText = null,
  captions,
  audioUrl,
  fallbackDurationMs,
  header,
  location,
  noAudioNote,
  imageMode = 'optimized',
  playLabel,
  pauseLabel,
  children,
}: MotionPitchPlayerProps) {
  const [elapsedMs, setElapsedMs] = useState(0);
  const [measuredDurationMs, setMeasuredDurationMs] = useState<number | null>(null);
  const [waveform, setWaveform] = useState<WaveformState>(audioUrl === null ? 'error' : 'loading');
  const [isPlaying, setIsPlaying] = useState(false);
  const elapsedRef = useRef(0);
  const audioRef = useRef<HTMLAudioElement>(null);
  const hasRealAudio = audioUrl !== null;

  const reducedMotion = useReducedMotion();

  const photoAssetIds = useMemo(() => photos.map((photo) => photo.assetId), [photos]);
  // v1 and v2 are separate paths on purpose: v1 rows were approved as a
  // crossfade of photo windows, and re-interpreting them as a shot list would be
  // handing the Dater's approval to a timeline they never saw (A4). Each reader
  // returns null for the other's version.
  const sceneV2 = asPitchSceneV2(scene);
  const approvedWindows = useMemo(
    () => sceneMotionWindows(scene, photoAssetIds),
    [scene, photoAssetIds],
  );
  // Fails closed exactly like the v1 binding: a scene naming a photo this page
  // does not render falls back rather than playing a timeline with holes.
  const sceneV2PhotoIndex = useMemo(
    () => (sceneV2 === null ? null : sceneV2PhotoIndexes(sceneV2, photoAssetIds)),
    [sceneV2, photoAssetIds],
  );
  const playableSceneV2 = sceneV2 !== null && sceneV2PhotoIndex !== null ? sceneV2 : null;

  const segmentWindows: readonly SceneWindow[] = useMemo(
    () => captions.map((caption) => ({ startMs: caption.startMs, endMs: caption.endMs })),
    [captions],
  );

  // Display duration only. The approved scene's duration wins over the
  // fallback, and the media's own duration wins over both for the readout.
  const durationMs = measuredDurationMs ?? scene?.durationMs ?? fallbackDurationMs;

  const legacyWindows = useMemo(
    () => legacyMotionWindows(photos.length, durationMs, segmentWindows),
    [photos.length, durationMs, segmentWindows],
  );
  // The approved scene is used verbatim; the runtime distribution only runs when
  // there is no scene to honour (A4).
  const windows: readonly MotionWindow[] = approvedWindows ?? legacyWindows;

  // Verification only: a scene whose duration disagrees with the media is worth
  // knowing about, but the approved windows are not adjusted for it.
  const driftMs = sceneDurationDriftMs(scene, measuredDurationMs);
  const reportedDriftRef = useRef(false);
  useEffect(() => {
    if (driftMs === null || Math.abs(driftMs) <= 1_000 || reportedDriftRef.current) {
      return;
    }
    reportedDriftRef.current = true;
    console.warn(
      `MotionPitchPlayer: media duration differs from the approved scene by ${driftMs}ms; playing the approved windows unchanged`,
    );
  }, [driftMs]);

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

  // Derive the waveform from the actual audio. On any failure we surface an
  // accessible error state rather than silently keeping a fake placeholder.
  useEffect(() => {
    if (audioUrl === null) {
      return;
    }
    let cancelled = false;
    setWaveform('loading');
    void (async () => {
      try {
        const response = await fetch(audioUrl);
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
  }, [audioUrl]);

  const progress = durationMs > 0 ? Math.min(1, elapsedMs / durationMs) : 0;
  const progressPercent = Math.round(progress * 100);

  // The v2 stage recomputes its own frame at animation rate; this one exists for
  // the QA attribute below and is deliberately driven by the same 4Hz clock the
  // rest of the shell uses.
  const shellFrame =
    playableSceneV2 === null || sceneV2PhotoIndex === null
      ? null
      : sceneV2Frame(playableSceneV2, sceneV2PhotoIndex, hasRealAudio ? elapsedMs : 0, {
          words: sceneWords,
          text: sceneText,
          reducedMotion,
        });
  const activePhotoIndex =
    shellFrame !== null
      ? sceneV2ActivePhotoIndex(shellFrame)
      : hasRealAudio
        ? activeMotionPhotoIndex(windows, elapsedMs)
        : 0;
  const motionSource =
    playableSceneV2 !== null ? 'scene-v2' : approvedWindows === null ? 'legacy' : 'scene';
  const motionWindows =
    playableSceneV2 !== null && sceneV2PhotoIndex !== null
      ? sceneV2ShotSignature(playableSceneV2, sceneV2PhotoIndex)
      : motionWindowSignature(windows);

  // Captions are segment-level (real provider timestamps), not fabricated
  // per-word highlights. The active segment is shown as a whole.
  //
  // T017: the band, its metrics and its motion live in PitchCaption/
  // captionChrome, which the MP4 renderer shares. Array position IS the
  // transcript's segmentIndex here — view.ts maps segments 1:1 — and that pair
  // is what a keyword highlight is looked up by.
  const captionSegments: readonly CaptionSegment[] = useMemo(
    () =>
      captions.map((caption, index) => ({
        segmentIndex: index,
        startMs: caption.startMs,
        endMs: caption.endMs,
        text: caption.text,
      })),
    [captions],
  );
  const activeCaptionSegment = hasRealAudio ? activeCaptionIndex(captionSegments, elapsedMs) : null;

  // The approved transition is a SEQUENCE: the outgoing card fades down, then
  // the incoming one pops in. The web player tweens with CSS (its clock only
  // ticks at `timeupdate` rate), so the swap is driven by the exit animation
  // ending rather than by a timer. Reduced motion has no exit to wait for.
  const [shownCaption, setShownCaption] = useState<{
    readonly index: number;
    readonly phase: 'entering' | 'leaving';
  } | null>(null);

  useEffect(() => {
    if (activeCaptionSegment === null) {
      setShownCaption(null);
      return;
    }
    setShownCaption((current) => {
      if (current === null || reducedMotion) {
        return { index: activeCaptionSegment, phase: 'entering' };
      }
      if (current.index === activeCaptionSegment) {
        return current;
      }
      return { index: current.index, phase: 'leaving' };
    });
  }, [activeCaptionSegment, reducedMotion]);

  const onCaptionAnimationEnd = () => {
    setShownCaption((current) => {
      if (current === null || current.phase !== 'leaving') {
        return current;
      }
      return activeCaptionSegment === null
        ? null
        : { index: activeCaptionSegment, phase: 'entering' };
    });
  };

  const shownSegment = shownCaption === null ? undefined : captionSegments[shownCaption.index];

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

  return (
    <div
      className={styles.playerShell}
      data-motion-player
      // QA/regression hooks: which timeline is playing, and exactly which
      // windows. The consent preview and the published page must print the same
      // signature for the same approved scene.
      data-motion-source={motionSource}
      data-motion-windows={motionWindows}
      data-motion-active-photo={activePhotoIndex}
      // Accessibility and photosensitivity are the same switch here: with it on,
      // the v2 stage drops travel, punch, flash and animated grain.
      data-motion-reduced-motion={reducedMotion ? 'true' : 'false'}
    >
      {audioUrl !== null && (
        <audio
          ref={audioRef}
          src={audioUrl}
          preload="metadata"
          onLoadedMetadata={(event) => {
            const seconds = event.currentTarget.duration;
            if (Number.isFinite(seconds) && seconds > 0) {
              setMeasuredDurationMs(seconds * 1000);
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
        {playableSceneV2 !== null && sceneV2PhotoIndex !== null ? (
          <MotionSceneV2
            scene={playableSceneV2}
            photoIndexes={sceneV2PhotoIndex}
            photos={photos}
            words={sceneWords}
            text={sceneText}
            reducedMotion={reducedMotion}
            elapsedMs={hasRealAudio ? elapsedMs : 0}
            isPlaying={isPlaying}
            clock={audioRef}
            imageMode={imageMode}
          />
        ) : (
          <div className={styles.photos}>
            {photos.map((photo, index) =>
              imageMode === 'plain' ? (
                <img
                  className={`${styles.photo} ${index === activePhotoIndex ? styles.photoActive : ''}`}
                  key={photo.src}
                  src={photo.src}
                  alt={photo.alt}
                  aria-hidden={index !== activePhotoIndex}
                  data-motion-photo={photo.assetId ?? ''}
                  loading={index === 0 ? 'eager' : 'lazy'}
                  decoding="async"
                />
              ) : (
                <Image
                  className={`${styles.photo} ${index === activePhotoIndex ? styles.photoActive : ''}`}
                  key={photo.src}
                  src={photo.src}
                  alt={photo.alt}
                  aria-hidden={index !== activePhotoIndex}
                  data-motion-photo={photo.assetId ?? ''}
                  fill
                  priority={index === 0}
                  sizes="(max-width: 700px) 100vw, 506px"
                />
              ),
            )}
          </div>
        )}
        <div className={styles.photoWash} />

        {header}

        {location !== null && <div className={styles.location}>{location}</div>}

        <CaptionLayer>
          {hasRealAudio ? (
            captionSegments.length === 0 ? (
              // No transcript segments: don't fabricate a caption timeline.
              <PitchCaptionCard
                parts={{
                  before: 'Captions aren’t available for this recording yet.',
                  keyword: null,
                  after: '',
                }}
                phase="static"
                testId="no-captions"
              />
            ) : shownSegment === undefined ? null : (
              <PitchCaptionCard
                key={shownSegment.segmentIndex}
                parts={captionParts(shownSegment.text, sceneWords, shownSegment.segmentIndex)}
                phase={shownCaption?.phase ?? 'entering'}
                segmentIndex={shownSegment.segmentIndex}
                onAnimationEnd={onCaptionAnimationEnd}
                ariaLive="polite"
                testId="segment-caption"
              />
            )
          ) : (
            // CP-3 honesty: no recording here, so the whole written pitch is
            // shown at once instead of pretending to play.
            <PitchCaptionCard
              parts={{
                before: captions.map((caption) => caption.text).join(' '),
                keyword: null,
                after: '',
              }}
              phase="static"
              testId="written-pitch"
            />
          )}
        </CaptionLayer>

        {hasRealAudio ? (
          <div className={styles.controls}>
            <button
              className={styles.playButton}
              type="button"
              onClick={togglePlayback}
              aria-label={isPlaying ? pauseLabel : playLabel}
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
                // Accessible fallback. Progress still tracks the real audio; we
                // never render a fabricated signal.
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
          <p className={styles.noAudioNote}>{noAudioNote}</p>
        )}

        {children}
      </article>
    </div>
  );
}
