'use client';

import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';

import { MotionSceneV2 } from '@/components/MotionSceneV2';
import { collectFontFaceSources, loadRenderFonts } from '@/lib/pitchRender/fontGate';
import type { RenderPayload } from '@/lib/pitchRender/payload';
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
  ];
  return parts.join('|');
}

/** The same signature, read back from what React actually committed. */
function domSignature(): string {
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
  ];
  return parts.join('|');
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

    const seek = async (tMs: number): Promise<string> => {
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
      flushSync(() => {
        setMode('scene');
        setAtMs(tMs);
      });
      // MotionSceneV2 syncs the prop into its own frame state in a passive
      // effect (one commit late). An empty flushSync forces React to run the
      // pending passive effects AND the commit they schedule synchronously, so
      // on the happy path the DOM below already shows tMs with no frame waits —
      // this is what keeps 1,800-frame captures inside the time budget.
      flushSync(() => undefined);
      // The export honours the approved motion, not this machine's OS setting.
      const expected = expectedSignature(
        sceneV2Frame(current.scene, indexes, tMs, {
          words: current.words,
          text: current.text,
          reducedMotion: false,
        }),
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

  return (
    <div className={styles.stage} data-render-stage data-render-mode={mode}>
      {payload !== null && photoIndexes !== null && mode === 'scene' && (
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
      )}
      {payload !== null && mode === 'endCard' && (
        <div className={styles.endCard} data-render-end-card>
          <p className={styles.endCardBrand}>{payload.endCard.brand}</p>
          <p className={styles.endCardUrl}>{payload.endCard.urlText}</p>
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
