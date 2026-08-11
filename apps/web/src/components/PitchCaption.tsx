import type { CSSProperties, ReactNode } from 'react';

import type { CaptionParts } from '@/pitch/captionChrome';

import styles from './PitchCaption.module.css';

// The caption band, shared by the web player and the MP4 capture stage (T017).
// Presentation only: what to show and where in the timeline it belongs are
// decided by src/pitch/captionChrome.ts, which both surfaces call.

/**
 * 'entering'/'leaving' are the web player's CSS keyframes; 'static' is the
 * honest non-playing states; 'frame' is the MP4 renderer, which attaches NO
 * animation and drives opacity/transform from the interpreter instead.
 */
export type CaptionPhase = 'entering' | 'leaving' | 'static' | 'frame';

/**
 * The container-query container the whole band is measured against. It is an
 * inset overlay rather than the stage itself, so adding size containment cannot
 * disturb the stage's aspect-ratio box or its positioned descendants.
 */
export function CaptionLayer({ children }: { readonly children: ReactNode }) {
  return (
    <div className={styles.layer} data-caption-layer>
      <div className={styles.zone} data-caption-zone>
        {children}
      </div>
    </div>
  );
}

export type PitchCaptionCardProps = {
  readonly parts: CaptionParts;
  /**
   * 'entering'/'leaving' attach the web player's CSS keyframes. 'static' is
   * both the non-playing states and the MP4 renderer, which must not animate at
   * all — it passes the frame's computed transform/opacity through `style`.
   */
  readonly phase: CaptionPhase;
  readonly style?: CSSProperties;
  readonly testId?: string;
  readonly ariaLive?: 'polite';
  readonly onAnimationEnd?: () => void;
  /**
   * Transcript segment this card is drawing. The MP4 capture stage reads it back
   * off the DOM to prove the committed frame is the one the interpreter asked
   * for before it screenshots (RenderStage.domSignature).
   */
  readonly segmentIndex?: number;
};

export function PitchCaptionCard({
  parts,
  phase,
  style,
  testId,
  ariaLive,
  onAnimationEnd,
  segmentIndex,
}: PitchCaptionCardProps) {
  const phaseClass =
    phase === 'entering'
      ? styles.cardEntering
      : phase === 'leaving'
        ? styles.cardLeaving
        : phase === 'static'
          ? styles.cardStatic
          : '';
  return (
    <p
      className={`${styles.card} ${phaseClass}`}
      style={style}
      data-caption-card
      data-caption-phase={phase}
      data-caption-segment={segmentIndex}
      data-testid={testId}
      aria-live={ariaLive}
      onAnimationEnd={onAnimationEnd}
    >
      {parts.before}
      {parts.keyword !== null && (
        <span className={styles.keyword} data-caption-keyword>
          {parts.keyword}
        </span>
      )}
      {parts.after}
    </p>
  );
}
