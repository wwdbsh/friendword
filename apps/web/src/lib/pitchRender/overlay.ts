import type { TimedCaptionWord } from '@friendword/contracts';

import type { PhotoGradePreset } from './photoGrade';
import {
  FRAME_HEIGHT_PX,
  SAFE_LEFT_PX,
  SAFE_RIGHT_PX,
  SAFE_TOP_PX,
  WORD_CAPTION_BOTTOM_PX,
  wordCaptionFrame,
  type CaptionWindow,
  type WordCaptionFrame,
} from './wordCaption';

// §2.3 — the render-only overlay: stage chrome, the measured waveform, and the
// word captions, all evaluated as ONE pure function of (overlay, cursor).
//
// Why one function: the capture page draws from it AND the frame signature is
// computed from it, so "what the DOM shows" and "what seek() waits for" cannot
// drift apart. Adding a layer here without touching the signature is therefore
// impossible by construction.
//
// None of this is scene content. The approved PitchScene v2 document, its hash,
// the consent snapshot and the web player are untouched (§0 verdict 1) — this
// layer exists only inside the MP4.
//
// Client-safe: no Node APIs.

/** §2.3: sixty bars, measured from the audio, never a decorative loop. */
export const WAVEFORM_BAR_COUNT = 60;
/** Ink at 40% for bars not yet played; the playhead side is `flirt` pink. */
export const WAVEFORM_IDLE_OPACITY = 0.4;
/** The waveform band sits directly above the caption block. */
export const WAVEFORM_HEIGHT_PX = 96;
export const WAVEFORM_BOTTOM_PX = WORD_CAPTION_BOTTOM_PX + 168;
export const WAVEFORM_LEFT_PX = SAFE_LEFT_PX;
export const WAVEFORM_RIGHT_PX = SAFE_RIGHT_PX;
/** A silent frame still has to draw something, or the band flickers out. */
export const WAVEFORM_MIN_BAR = 0.06;

/** Stage chrome hangs immediately below the top safe area (§2.3). */
export const STAGE_CHROME_TOP_PX = SAFE_TOP_PX;
export const STAGE_CHROME_LEFT_PX = SAFE_LEFT_PX;
export const STAGE_CHROME_RIGHT_PX = SAFE_RIGHT_PX;

export type RenderOverlayStage = {
  /** "{INTRODUCER} INTRODUCES" — built by stageIntroducerLabel(). */
  readonly introducerLabel: string;
  /** The Dater's public display name (publicDisplayName rule) or 'A friend'. */
  readonly daterName: string;
  /** "Friends for 3–10 years" when the draft recorded it; null otherwise. */
  readonly relationshipChip: string | null;
};

export type RenderOverlay = {
  readonly variant: 'full' | 'highlight';
  readonly stage: RenderOverlayStage;
  /**
   * RMS of the FINAL voice audio, one entry per output frame, 0..1, rounded to
   * three decimals so the value is byte-identical across machines. Empty when
   * the audio could not be measured — the waveform is then not drawn at all
   * rather than drawn from an invented shape.
   */
  readonly envelope: readonly number[];
  /** Word captions, or null to fall back to the segment caption band (§2.4). */
  readonly words: readonly TimedCaptionWord[] | null;
  /**
   * The cut windows being rendered, indexed by the cursor's `windowIndex`.
   * Empty for the full variant, where there is only one window and it is the
   * whole timeline. The caption layer needs these to keep a cut-out sentence
   * off the frames right after the cut.
   */
  readonly windows: readonly CaptionWindow[];
  readonly grade: PhotoGradePreset;
};

/** Where the capture is inside the OUTPUT timeline, and inside the source. */
export type RenderFrameCursor = {
  /** Index of this frame in the output video. */
  readonly outputFrame: number;
  readonly totalFrames: number;
  /** Which cut window this frame came from; 0 for the full variant. */
  readonly windowIndex: number;
  /**
   * Chrome only over a transparent background (§2.2-4): the selfie opening is
   * composited by ffmpeg, so the capture page contributes the overlay alone.
   */
  readonly overlayOnly?: boolean;
};

export type WaveformFrame = {
  /** Sixty bar heights, 0..1. Constant for the whole render (measured once). */
  readonly bars: readonly number[];
  /** Bars at or before this index are the played (pink) side. */
  readonly playheadBar: number;
  /** The envelope sample for this exact frame — a signature input. */
  readonly frameLevel: number;
};

export type RenderOverlayFrame = {
  readonly variant: 'full' | 'highlight';
  readonly windowIndex: number;
  readonly overlayOnly: boolean;
  readonly stage: RenderOverlayStage;
  /** Null when there is no measured envelope: no waveform is drawn (§2.3). */
  readonly waveform: WaveformFrame | null;
  /** Null when the transcript carries no word timings (§2.4 fallback). */
  readonly caption: WordCaptionFrame | null;
};

/**
 * "MAYA INTRODUCES". Upper-cased with the invariant locale so a Turkish or
 * Azeri host cannot turn an `i` into a dotless one and change the pixels.
 */
export function stageIntroducerLabel(introducerName: string): string {
  return `${introducerName.toLocaleUpperCase('en-US')} INTRODUCES`;
}

/** Rounds to three decimals, away from float noise, for signature stability. */
function quantize(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * Sixty bars from the per-frame envelope. Each bar is the LOUDEST frame in its
 * slice: a mean would flatten speech into a straight line, and the bar is meant
 * to show that someone is talking.
 */
export function waveformBars(envelope: readonly number[]): readonly number[] {
  if (envelope.length === 0) {
    return [];
  }
  const bars: number[] = [];
  for (let bar = 0; bar < WAVEFORM_BAR_COUNT; bar += 1) {
    const from = Math.floor((bar * envelope.length) / WAVEFORM_BAR_COUNT);
    const to = Math.max(from + 1, Math.floor(((bar + 1) * envelope.length) / WAVEFORM_BAR_COUNT));
    let peak = 0;
    for (let index = from; index < to && index < envelope.length; index += 1) {
      peak = Math.max(peak, envelope[index] ?? 0);
    }
    bars.push(quantize(Math.max(WAVEFORM_MIN_BAR, peak)));
  }
  return bars;
}

/** Which bar the playhead is on. Integer arithmetic, no rounding drift. */
export function waveformPlayheadBar(outputFrame: number, totalFrames: number): number {
  if (totalFrames <= 0) {
    return 0;
  }
  const bar = Math.floor((outputFrame * WAVEFORM_BAR_COUNT) / totalFrames);
  return Math.min(WAVEFORM_BAR_COUNT - 1, Math.max(0, bar));
}

/**
 * Everything the overlay draws for one frame. `elapsedMs` is the SOURCE
 * timestamp (the millisecond of the original recording being captured), while
 * the cursor's frame index is the OUTPUT position — for a highlight the two
 * disagree, and each layer needs the one that is true for it: captions follow
 * the words that were actually spoken, the playhead follows the exported file.
 */
export function renderOverlayFrame(
  overlay: RenderOverlay,
  elapsedMs: number,
  cursor: RenderFrameCursor,
): RenderOverlayFrame {
  const bars = waveformBars(overlay.envelope);
  return {
    variant: overlay.variant,
    windowIndex: cursor.windowIndex,
    overlayOnly: cursor.overlayOnly === true,
    stage: overlay.stage,
    waveform:
      bars.length === 0
        ? null
        : {
            bars,
            playheadBar: waveformPlayheadBar(cursor.outputFrame, cursor.totalFrames),
            frameLevel: quantize(overlay.envelope[cursor.outputFrame] ?? 0),
          },
    caption: wordCaptionFrame(
      overlay.words,
      elapsedMs,
      overlay.windows[cursor.windowIndex] ?? null,
    ),
  };
}

/**
 * The overlay's contribution to the frame signature (§2.3): variant, window,
 * active word and envelope frame. seek() will not resolve until the committed
 * DOM reports this same string, so a capture can never trail the cursor.
 */
export function overlaySignature(frame: RenderOverlayFrame | null): string {
  if (frame === null) {
    return 'overlay=none';
  }
  const caption =
    frame.caption === null
      ? 'word=none'
      : `word=${frame.caption.lineIndex}/${frame.caption.activeWordIndex}`;
  const wave =
    frame.waveform === null
      ? 'wave=none'
      : `wave=${frame.waveform.playheadBar}/${frame.waveform.frameLevel}`;
  return `overlay=${frame.variant}/${frame.windowIndex}${frame.overlayOnly ? '/chrome' : ''}|${caption}|${wave}`;
}

/** Pixel geometry the stylesheet and the coordinate tests share. */
export const OVERLAY_GEOMETRY = {
  stage: { top: STAGE_CHROME_TOP_PX, left: STAGE_CHROME_LEFT_PX, right: STAGE_CHROME_RIGHT_PX },
  waveform: {
    bottom: WAVEFORM_BOTTOM_PX,
    left: WAVEFORM_LEFT_PX,
    right: WAVEFORM_RIGHT_PX,
    height: WAVEFORM_HEIGHT_PX,
  },
  caption: {
    bottom: WORD_CAPTION_BOTTOM_PX,
    left: SAFE_LEFT_PX,
    right: SAFE_RIGHT_PX,
  },
  frameHeight: FRAME_HEIGHT_PX,
} as const;
