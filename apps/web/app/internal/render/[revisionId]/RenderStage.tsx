'use client';

import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';

import { MotionSceneV2 } from '@/components/MotionSceneV2';
import { CaptionLayer, PitchCaptionCard } from '@/components/PitchCaption';
import { RenderOverlay } from '@/components/RenderOverlay';
import { collectFontFaceSources, loadRenderFonts } from '@/lib/pitchRender/fontGate';
import {
  overlaySignature,
  renderOverlayFrame,
  type RenderFrameCursor,
  type RenderOverlayFrame,
} from '@/lib/pitchRender/overlay';
import type { RenderPayload } from '@/lib/pitchRender/payload';
import { grainDataUri } from '@/lib/pitchRender/photoGrade';
import { captionFrame, type CaptionFrame } from '@/pitch/captionChrome';
import { sceneV2Frame, sceneV2PhotoIndexes, type SceneV2Frame } from '@/pitch/sceneV2';

import styles from './RenderStage.module.css';

// The capture harness around MotionSceneV2 — the exact component both web
// surfaces render, so the MP4 cannot drift from what the Dater approved.
//
// The stage is driven with `isPlaying={false}`: MotionSceneV2 then never
// registers its audio-clock rAF loop and follows the `elapsedMs` prop, which
// this harness steps one frame at a time. That prop lands via a useEffect
// inside MotionSceneV2 (one commit late), so seek() does not trust timing: it
// computes the interpreter's expected frame signature and polls rAF until the
// committed DOM matches it. A screenshot taken after seek() resolves is
// therefore provably the frame for that millisecond — the guard the Advisor's
// P2 correction demanded against consistently-lagged captures.

/** Reserialize a style value through the engine so both sides compare equal. */
function makeNormalizer(): (property: 'transform' | 'filter' | 'opacity', value: string) => string {
  const probe = document.createElement('div');
  return (property, value) => {
    probe.style[property] = value;
    const out = probe.style[property];
    probe.style[property] = '';
    return out;
  };
}

/**
 * The expected DOM signature of a frame. The text-layer transform expressions
 * replicate MotionSceneV2.tsx VERBATIM — they are part of the frozen v2
 * interpretation, and this copy exists only so a stale commit is detectable.
 * Layers not listed (dim, warmth, vignette) are constant within a shot and are
 * covered by the shot index; React commits atomically, so any matching
 * per-millisecond value proves the whole frame committed.
 */
function expectedSignature(
  frame: SceneV2Frame,
  caption: CaptionFrame | null,
  overlay: RenderOverlayFrame | null,
  norm: (property: 'transform' | 'filter' | 'opacity', value: string) => string,
): string {
  const media = frame.photo ?? frame.backdrop;
  const mediaFilter =
    media === null || media.blurPx === 0 ? frame.filter : `${frame.filter} blur(${media.blurPx}px)`;
  const parts = [
    `shot=${frame.shotIndex}/${frame.level}`,
    media === null
      ? 'media=none'
      : `media=${media.assetId};${norm('transform', media.transform)};${norm('filter', mediaFilter)}`,
    frame.card === null
      ? 'card=none'
      : `card=${frame.card.text};${norm('opacity', String(frame.card.opacity))};${norm(
          'transform',
          `translateY(calc(-50% + ${(1 - frame.card.reveal) * 12}px)) scale(${
            1 + frame.card.emphasis * 0.04
          })`,
        )}`,
    frame.badge === null
      ? 'badge=none'
      : `badge=${frame.badge.text};${norm('opacity', String(frame.badge.opacity))};${norm(
          'transform',
          `scale(${1 + frame.badge.emphasis * 0.08})`,
        )}`,
    frame.wordPop === null
      ? 'wordPop=none'
      : `wordPop=${frame.wordPop.text};${norm('opacity', String(frame.wordPop.opacity))};${norm(
          'transform',
          `scale(${frame.wordPop.scale})`,
        )}`,
    frame.grain === null
      ? 'grain=none'
      : `grain=${frame.grain.seed};${norm('opacity', String(frame.grain.opacity))}`,
    frame.lightLeak === null
      ? 'leak=none'
      : `leak=${norm('opacity', String(frame.lightLeak.opacity))}`,
    frame.progressBar === null ? 'progress=none' : `progress=${frame.progressBar.percent}`,
    // T017 caption chrome. Included for the same reason every other layer is:
    // seek() must not resolve until the caption React committed is the one this
    // millisecond calls for, or a capture could trail the clock by a frame.
    caption === null
      ? 'caption=none'
      : `caption=${caption.segmentIndex};${caption.text};${norm(
          'opacity',
          String(caption.motion.opacity),
        )};${norm('transform', caption.transform)}`,
    // §2.3: the overlay is part of the frame, so seek() must not resolve until
    // the committed variant, window, active word and envelope frame are this
    // millisecond's — otherwise a highlight could be captured one window late.
    overlaySignature(overlay),
  ];
  return parts.join('|');
}

/**
 * §2.4: with timed words the overlay owns the subtitles and the T017 segment
 * band stands down. Stated once, so the signature and the render agree.
 */
function overlayCaptionsWin(overlay: { readonly words: unknown } | null | undefined): boolean {
  return overlay !== null && overlay !== undefined && overlay.words !== null;
}

/** The same signature, read back from what React actually committed. */
function domSignature(): string {
  const root = document.querySelector<HTMLElement>('[data-render-stage]');
  if (root !== null && root.dataset.renderMode === 'overlayOnly') {
    // §2.2-4 overlay-only: the scene is not mounted at all, so the frame IS
    // the chrome and the signature is the chrome's alone.
    return `overlayOnly|${overlayDomSignature(
      document.querySelector<HTMLElement>('[data-render-overlay]'),
    )}`;
  }
  const stage = document.querySelector<HTMLElement>('[data-scene-v2]');
  if (stage === null) {
    return 'stage=missing';
  }
  const images = Array.from(
    document.querySelectorAll<HTMLImageElement>('[data-render-stage] img'),
  ).filter((image) => image.style.transform !== '' && image.style.transform !== 'none');
  const image = images[0];
  const media =
    images.length !== 1 || image === undefined
      ? 'media=none'
      : `media=${image.dataset.motionPhoto ?? '?'};${image.style.transform};${image.style.filter}`;
  const card = document.querySelector<HTMLElement>('[data-scene-card]');
  const badge = document.querySelector<HTMLElement>('[data-scene-badge]');
  const wordPop = document.querySelector<HTMLElement>('[data-scene-word-pop]');
  const grain = document.querySelector<HTMLElement>('[data-scene-grain]');
  const leak = document.querySelector<HTMLElement>('[data-scene-light-leak]');
  const progress = document.querySelector<HTMLElement>('[data-scene-progress]');
  const caption = document.querySelector<HTMLElement>('[data-caption-card]');
  const overlay = document.querySelector<HTMLElement>('[data-render-overlay]');
  const parts = [
    `shot=${stage.dataset.motionShot ?? '?'}/${stage.dataset.motionShotLevel ?? '?'}`,
    media,
    card === null
      ? 'card=none'
      : `card=${card.textContent ?? ''};${card.style.opacity};${card.style.transform}`,
    badge === null
      ? 'badge=none'
      : `badge=${badge.textContent ?? ''};${badge.style.opacity};${badge.style.transform}`,
    wordPop === null
      ? 'wordPop=none'
      : `wordPop=${wordPop.textContent ?? ''};${wordPop.style.opacity};${wordPop.style.transform}`,
    grain === null
      ? 'grain=none'
      : `grain=${grain.dataset.sceneGrain ?? '?'};${grain.style.opacity}`,
    leak === null ? 'leak=none' : `leak=${leak.style.opacity}`,
    progress === null ? 'progress=none' : `progress=${progress.dataset.sceneProgress ?? '?'}`,
    caption === null
      ? 'caption=none'
      : `caption=${caption.dataset.captionSegment ?? '?'};${caption.textContent ?? ''};${
          caption.style.opacity
        };${caption.style.transform}`,
    overlayDomSignature(overlay),
  ];
  return parts.join('|');
}

/** The overlay half of the signature, read back off the committed DOM. */
function overlayDomSignature(overlay: HTMLElement | null): string {
  if (overlay === null) {
    return 'overlay=none';
  }
  const wave = overlay.querySelector<HTMLElement>('[data-overlay-waveform]');
  const word = overlay.querySelector<HTMLElement>('[data-overlay-caption]');
  const chromeOnly = overlay.dataset.overlayChromeOnly === 'true' ? '/chrome' : '';
  const wordPart =
    word === null
      ? 'word=none'
      : `word=${word.dataset.overlayCaption ?? '?'}/${word.dataset.overlayActiveWord ?? '?'}`;
  const wavePart =
    wave === null
      ? 'wave=none'
      : `wave=${wave.dataset.overlayWaveform ?? '?'}/${wave.dataset.overlayLevel ?? '?'}`;
  return `overlay=${overlay.dataset.overlayVariant ?? '?'}/${overlay.dataset.overlayWindow ?? '?'}${chromeOnly}|${wordPart}|${wavePart}`;
}

function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

export function RenderStage() {
  const [payload, setPayload] = useState<RenderPayload | null>(null);
  const [atMs, setAtMs] = useState(0);
  const [mode, setMode] = useState<'scene' | 'endCard'>('scene');
  // Where the capture is in the OUTPUT file. Null until the first seek and for
  // the legacy (no-overlay) path, which draws exactly what it always drew.
  const [cursor, setCursor] = useState<RenderFrameCursor | null>(null);
  const payloadRef = useRef<RenderPayload | null>(null);
  // Never populated: the capture stage has no audio element. With
  // isPlaying=false MotionSceneV2 never reads this clock.
  const silentClockRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const norm = makeNormalizer();

    const loadPayload = async (next: RenderPayload): Promise<void> => {
      if (
        sceneV2PhotoIndexes(
          next.scene,
          next.photos.map((photo) => photo.assetId),
        ) === null
      ) {
        throw new Error('payload photos do not cover the scene assetIds');
      }
      flushSync(() => {
        setMode('scene');
        setAtMs(0);
        setPayload(next);
      });
      payloadRef.current = next;
      // First-frame gate (P3): every photo decoded, both font families loaded.
      const images = Array.from(
        document.querySelectorAll<HTMLImageElement>('[data-render-stage] img'),
      );
      if (images.length !== next.photos.length) {
        throw new Error(`expected ${next.photos.length} mounted photos, found ${images.length}`);
      }
      await Promise.all(
        images.map(async (image) => {
          // The stage mounts hidden photos lazily; capture needs all of them.
          image.loading = 'eager';
          await image.decode();
        }),
      );
      const warmups = Array.from(
        document.querySelectorAll<HTMLElement>('[data-render-font-warmup]'),
      );
      // T013: load ONLY the url()-backed families, never next/font's
      // local()-sourced metric fallback — the headless shell cannot instantiate
      // local() and rejected the whole-stack load with NetworkError. The gate
      // still fails loudly if a real family will not load; see fontGate.ts.
      await loadRenderFonts({
        stacks: warmups.map((warmup) => getComputedStyle(warmup).fontFamily),
        faces: collectFontFaceSources(document.styleSheets),
        load: (spec) => document.fonts.load(spec),
        check: (spec) => document.fonts.check(spec),
      });
      // Settles the faces the stage's own layout kicked off. It never rejects —
      // a face that ends in the error state (the local() fallback does, in the
      // shell) leaves `loading` empty rather than pending — so this cannot
      // reintroduce the failure the load above just stopped.
      await document.fonts.ready;
      await nextPaint();
    };

    const seek = async (tMs: number, at?: RenderFrameCursor): Promise<string> => {
      const current = payloadRef.current;
      if (current === null) {
        throw new Error('seek before loadPayload');
      }
      const indexes = sceneV2PhotoIndexes(
        current.scene,
        current.photos.map((photo) => photo.assetId),
      );
      if (indexes === null) {
        throw new Error('payload photos do not cover the scene assetIds');
      }
      const nextCursor = at ?? { outputFrame: 0, totalFrames: 1, windowIndex: 0 };
      // §2.2-4 overlay-only: the frame has to arrive at ffmpeg with real alpha,
      // and Puppeteer's `omitBackground` only clears the DEFAULT page colour —
      // globals.css paints `body` opaque, which would flatten the chrome into a
      // rectangle and hide the selfie underneath it. Set imperatively rather
      // than in an effect so it is committed before the screenshot, in the same
      // synchronous step as the cursor it belongs to.
      const chromeOnly = nextCursor.overlayOnly === true;
      document.documentElement.style.background = chromeOnly ? 'transparent' : '';
      document.body.style.background = chromeOnly ? 'transparent' : '';
      flushSync(() => {
        setMode('scene');
        setAtMs(tMs);
        setCursor(nextCursor);
      });
      // MotionSceneV2 syncs the prop into its own frame state in a passive
      // effect (one commit late). An empty flushSync forces React to run the
      // pending passive effects AND the commit they schedule synchronously, so
      // on the happy path the DOM below already shows tMs with no frame waits —
      // this is what keeps 1,800-frame captures inside the time budget.
      flushSync(() => undefined);
      // The export honours the approved motion, not this machine's OS setting.
      const overlay = current.overlay ?? null;
      const overlayNow = overlay === null ? null : renderOverlayFrame(overlay, tMs, nextCursor);
      const expected =
        nextCursor.overlayOnly === true
          ? `overlayOnly|${overlaySignature(overlayNow)}`
          : expectedSignature(
              sceneV2Frame(current.scene, indexes, tMs, {
                words: current.words,
                text: current.text,
                reducedMotion: false,
              }),
              // Same millisecond, same pure call the render below made.
              overlayCaptionsWin(overlay)
                ? null
                : captionFrame(current.captions, tMs, {
                    words: current.words,
                    reducedMotion: false,
                  }),
              overlayNow,
              norm,
            );
      for (let attempt = 0; attempt < 120; attempt += 1) {
        if (domSignature() === expected) {
          // No paint wait: CDP's captureScreenshot composites the committed
          // tree itself, and the [t1, t2, t1] byte-identity test in
          // tests-render exists to prove captures never trail the seeks.
          return expected;
        }
        await new Promise(requestAnimationFrame);
      }
      throw new Error(
        `frame for t=${tMs}ms never committed; expected ${expected} got ${domSignature()}`,
      );
    };

    const showEndCard = async (): Promise<void> => {
      if (payloadRef.current === null) {
        throw new Error('showEndCard before loadPayload');
      }
      flushSync(() => setMode('endCard'));
      // The QR is an <img> of a generated data: URI. Decoding it BEFORE the
      // capture is the same first-frame gate the photos get (P3): a card
      // captured with an undecoded QR is an un-scannable file nobody can
      // recall.
      const qr = document.querySelector<HTMLImageElement>('[data-render-end-card-qr]');
      if (qr !== null) {
        await qr.decode();
      }
      await nextPaint();
    };

    window.__friendwordRender = { loadPayload, seek, showEndCard };
    window.__friendwordRenderReady = true;
    return () => {
      delete window.__friendwordRender;
      delete window.__friendwordRenderReady;
    };
  }, []);

  const photoIndexes =
    payload === null
      ? null
      : sceneV2PhotoIndexes(
          payload.scene,
          payload.photos.map((photo) => photo.assetId),
        );

  // T017: the caption band, evaluated as a PURE FUNCTION of (segments, atMs).
  // CSS keyframes are unusable here — they interpolate on the wall clock, so a
  // seek-and-screenshot capture would smear the band by however fast the loop
  // happened to run, and the [t1, t2, t1] byte-identity guarantee would fail
  // (docs/SESSION_HANDOFF §5; RenderStage.module.css already kills animations).
  // Instead the interpreter hands us opacity and transform for this exact
  // millisecond and we write them as inline style — the same shape the v2 scene
  // layers already use. Null in the end-card mode: the appended card carries no
  // caption.
  const overlay = payload?.overlay ?? null;
  const overlayFrame =
    overlay === null || payload === null || mode !== 'scene' || cursor === null
      ? null
      : renderOverlayFrame(overlay, atMs, cursor);
  // §2.4: word captions replace the segment band when the transcript carries
  // timings. Both at once would stack two subtitle blocks on one frame.
  const caption =
    payload === null || mode !== 'scene' || overlayCaptionsWin(overlay)
      ? null
      : captionFrame(payload.captions, atMs, { words: payload.words, reducedMotion: false });
  const grade = overlay?.grade ?? null;

  return (
    <div
      className={
        cursor?.overlayOnly === true ? `${styles.stage} ${styles.chromeOnly}` : styles.stage
      }
      data-render-stage
      data-render-mode={cursor?.overlayOnly === true ? 'overlayOnly' : mode}
    >
      {payload !== null &&
        photoIndexes !== null &&
        mode === 'scene' &&
        cursor?.overlayOnly !== true && (
          <div
            className={styles.graded}
            data-render-graded
            // §2.7: a per-channel curve over what the camera recorded. No
            // geometry, no pixel synthesis, constant for the whole render.
            style={grade === null ? undefined : { filter: grade.filter }}
          >
            <MotionSceneV2
              scene={payload.scene}
              photoIndexes={photoIndexes}
              photos={payload.photos.map((photo) => ({
                assetId: photo.assetId,
                src: photo.src,
                // Decorative in a capture context; the reel carries no DOM.
                alt: '',
              }))}
              words={payload.words}
              text={payload.text}
              reducedMotion={false}
              elapsedMs={atMs}
              isPlaying={false}
              clock={silentClockRef}
              imageMode="plain"
            />
            {grade !== null && grade.vignetteOpacity > 0 && (
              <div className={styles.vignette} style={{ opacity: grade.vignetteOpacity }} />
            )}
            {grade !== null && (
              <div
                className={styles.grain}
                style={{
                  opacity: grade.grainOpacity,
                  backgroundImage: `url("${grainDataUri(grade.grainSeed)}")`,
                }}
              />
            )}
          </div>
        )}
      {overlayFrame !== null && <RenderOverlay frame={overlayFrame} />}
      {caption !== null && (
        <CaptionLayer>
          <PitchCaptionCard
            parts={caption.parts}
            phase="frame"
            segmentIndex={caption.segmentIndex}
            style={{ opacity: caption.motion.opacity, transform: caption.transform }}
          />
        </CaptionLayer>
      )}
      {payload !== null && mode === 'endCard' && (
        <div className={styles.endCard} data-render-end-card>
          <p className={styles.endCardBrand}>{payload.endCard.brand}</p>
          {payload.endCard.approvedBy !== undefined && payload.endCard.approvedBy !== null && (
            <p className={styles.endCardBadge} data-render-end-card-badge>
              {payload.endCard.approvedBy}
            </p>
          )}
          {payload.endCard.qrDataUri !== undefined && (
            /* Generated locally from the campaign URL; the page fetches
               nothing (P3). eslint-disable-next-line @next/next/no-img-element */
            <img
              className={styles.endCardQr}
              data-render-end-card-qr
              src={payload.endCard.qrDataUri}
              alt=""
            />
          )}
          <p className={styles.endCardUrl}>{payload.endCard.urlText}</p>
          {payload.endCard.cta !== undefined && (
            <p className={styles.endCardCta}>{payload.endCard.cta}</p>
          )}
        </div>
      )}
      <div className={styles.fontWarmup} aria-hidden="true">
        <span data-render-font-warmup style={{ fontFamily: 'var(--font-display), sans-serif' }}>
          Friendword
        </span>
        <span data-render-font-warmup style={{ fontFamily: 'var(--font-body), sans-serif' }}>
          Friendword
        </span>
      </div>
    </div>
  );
}
