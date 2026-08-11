// T017 — caption chrome on the WEB surface ("sticker pop", approved 2026-08-11).
//
// Three things have to hold and only a mounted player can show them:
//   1. the band is drawn by the shared PitchCaption component, inside the
//      container-query layer, with the keyword selected from real word data;
//   2. a segment change plays the approved out → in SEQUENCE, not a hard cut;
//   3. every metric is a container unit — the old caption sized itself in dvh,
//      which made the ~250px consent preview, the published page and a large
//      monitor three different designs.
//
// (3) cannot be measured in jsdom (it computes no container queries), so it is
// pinned against the stylesheet source itself, which is also what keeps the CSS
// keyframes and captionChrome.ts's exported constants from drifting apart.
/* global describe, expect, it */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

import { MotionPitchPlayer } from '@/components/MotionPitchPlayer';
import {
  CAPTION_ENTER_MS,
  CAPTION_ENTER_ROTATE_DEG,
  CAPTION_ENTER_SCALE,
  CAPTION_ENTER_TRANSLATE_CQH,
  CAPTION_EXIT_MS,
  CAPTION_EXIT_TRANSLATE_CQH,
} from '@/pitch/captionChrome';

const CAPTIONS = [
  { startMs: 0, endMs: 4_000, text: 'Honestly, this is the friend who never cancels.' },
  { startMs: 4_000, endMs: 9_000, text: 'Loyal in a way that costs her time.' },
];

const WORDS = [
  { segmentIndex: 0, wordIndex: 0, text: 'Honestly,' },
  { segmentIndex: 1, wordIndex: 0, text: 'Loyal' },
];

const PHOTOS = [{ assetId: null, src: '/demo.jpg', alt: 'demo' }];

function renderPlayer(overrides: { readonly audioUrl?: string | null } = {}) {
  return render(
    <MotionPitchPlayer
      photos={PHOTOS}
      scene={null}
      captions={CAPTIONS}
      sceneWords={WORDS}
      audioUrl={overrides.audioUrl === undefined ? '/voice.m4a' : overrides.audioUrl}
      fallbackDurationMs={9_000}
      header={<header>header</header>}
      location={null}
      noAudioNote="No recording yet."
      imageMode="plain"
      playLabel="Play"
      pauseLabel="Pause"
    />,
  );
}

/** Drives the player's clock the way the real <audio> element does. */
function seek(toMs: number): void {
  const audio = document.querySelector('audio');
  if (audio === null) {
    throw new Error('no audio element mounted');
  }
  Object.defineProperty(audio, 'currentTime', { value: toMs / 1000, configurable: true });
  act(() => {
    fireEvent.timeUpdate(audio);
  });
}

function card(): HTMLElement {
  const found = document.querySelector<HTMLElement>('[data-caption-card]');
  if (found === null) {
    throw new Error('no caption card rendered');
  }
  return found;
}

const CAPTION_CSS = readFileSync(
  path.join(process.cwd(), 'src/components/PitchCaption.module.css'),
  'utf8',
);
const PLAYER_CSS = readFileSync(
  path.join(process.cwd(), 'src/components/PitchPlayer.module.css'),
  'utf8',
);

describe('caption chrome — the sticker band', () => {
  it('draws the active segment inside the container-query layer', () => {
    renderPlayer();
    seek(1_000);
    expect(document.querySelector('[data-caption-layer]')).not.toBeNull();
    expect(document.querySelector('[data-caption-zone]')).not.toBeNull();
    const caption = screen.getByTestId('segment-caption');
    expect(caption.textContent).toBe(CAPTIONS[0]!.text);
    expect(caption.dataset.captionSegment).toBe('0');
    cleanup();
  });

  it('highlights one word, chosen from the provider word list', () => {
    renderPlayer();
    seek(1_000);
    const keyword = document.querySelector<HTMLElement>('[data-caption-keyword]');
    expect(keyword?.textContent).toBe('Honestly');
    cleanup();
  });

  it('never fabricates a highlight when there is no word data', () => {
    render(
      <MotionPitchPlayer
        photos={PHOTOS}
        scene={null}
        captions={CAPTIONS}
        sceneWords={[]}
        audioUrl="/voice.m4a"
        fallbackDurationMs={9_000}
        header={<header>header</header>}
        location={null}
        noAudioNote="No recording yet."
        imageMode="plain"
        playLabel="Play"
        pauseLabel="Pause"
      />,
    );
    seek(1_000);
    expect(document.querySelector('[data-caption-keyword]')).toBeNull();
    expect(screen.getByTestId('segment-caption').textContent).toBe(CAPTIONS[0]!.text);
    cleanup();
  });

  it('plays the approved out → in sequence across a segment change', () => {
    renderPlayer();
    seek(1_000);
    expect(card().dataset.captionPhase).toBe('entering');

    seek(5_000);
    // The outgoing card leaves FIRST; the new sentence is not cut in.
    expect(card().dataset.captionPhase).toBe('leaving');
    expect(card().textContent).toBe(CAPTIONS[0]!.text);

    act(() => {
      fireEvent.animationEnd(card());
    });
    expect(card().dataset.captionPhase).toBe('entering');
    expect(card().textContent).toBe(CAPTIONS[1]!.text);
    expect(document.querySelector('[data-caption-keyword]')?.textContent).toBe('Loyal');
    cleanup();
  });

  it('keeps the honest non-playing states on the same sticker', () => {
    renderPlayer({ audioUrl: null });
    const written = screen.getByTestId('written-pitch');
    expect(written.dataset.captionPhase).toBe('static');
    expect(written.textContent).toContain('never cancels');
    expect(written.textContent).toContain('costs her time');
    cleanup();
  });
});

describe('caption chrome — container-relative metrics', () => {
  it('sizes every metric in container units and declares the container', () => {
    expect(CAPTION_CSS).toMatch(/container:\s*pitchStage\s*\/\s*size/);
    expect(CAPTION_CSS).toContain('font-size: 4.8cqw');
    expect(CAPTION_CSS).toContain('padding: 2.2cqh 4.5cqw');
    expect(CAPTION_CSS).toContain('border: 0.8cqw solid');
    expect(CAPTION_CSS).toContain('border-radius: 4.5cqw');
    expect(CAPTION_CSS).toContain('1.6cqw 1.6cqw 0');
    expect(CAPTION_CSS).toContain('right: 6cqw');
    expect(CAPTION_CSS).toContain('left: 6cqw');
    expect(CAPTION_CSS).toMatch(/bottom:\s*max\(16cqh/);
  });

  it('has no viewport-relative sizing left in the caption band', () => {
    // dvh is what made the band a different design per surface.
    expect(CAPTION_CSS).not.toMatch(/\d(dvh|vh|vw)\b/);
    // And the player sheet no longer owns a caption rule at all.
    expect(PLAYER_CSS).not.toContain('.caption');
  });

  it('keeps the CSS keyframes and the renderer constants in step', () => {
    // The web tweens with CSS; the MP4 evaluates captionChrome's pure functions.
    // If these drift, the exported reel stops matching the approved preview.
    expect(CAPTION_CSS).toContain(`${CAPTION_ENTER_MS / 1000}s cubic-bezier(0.2, 1.4, 0.4, 1)`);
    expect(CAPTION_CSS).toContain(`${CAPTION_EXIT_MS / 1000}s ease-in`);
    expect(CAPTION_CSS).toContain(
      `translateY(${CAPTION_ENTER_TRANSLATE_CQH}cqh) scale(${CAPTION_ENTER_SCALE}) rotate(${CAPTION_ENTER_ROTATE_DEG}deg)`,
    );
    expect(CAPTION_CSS).toContain(`translateY(${CAPTION_EXIT_TRANSLATE_CQH}cqh)`);
  });

  it('reserves the transport bar so the band cannot invade it', () => {
    // The band is proportional, the transport is not; without the clearance a
    // 16cqh band sits inside the controls on the ~250px consent preview.
    expect(PLAYER_CSS).toContain('--caption-bar-clearance: 10.5rem');
    expect(PLAYER_CSS).toContain('--caption-bar-clearance: 6.5rem');
    expect(CAPTION_CSS).toContain('var(--caption-bar-clearance, 0px)');
  });
});
