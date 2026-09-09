import {
  OVERLAY_GEOMETRY,
  WAVEFORM_IDLE_OPACITY,
  type RenderOverlayFrame,
} from '@/lib/pitchRender/overlay';
import { WORD_CAPTION_ACTIVE_SCALE } from '@/lib/pitchRender/wordCaption';

import styles from './RenderOverlay.module.css';

// §2.3/§2.4 — the render-only overlay layer.
//
// It exists ONLY on the capture page: the public player and the approved scene
// are untouched (§0 verdict 1). Every value it draws is handed to it by
// `renderOverlayFrame`, so this file has no logic to disagree with the frame
// signature — it is markup plus inline styles, exactly like the v2 scene
// layers, and for the same reason (a CSS transition would interpolate on the
// wall clock and smear a discrete seek).
//
// The data-* attributes are what `domSignature()` reads back: they are the
// PROOF that the committed DOM is this millisecond's frame and not the last
// one's.

export function RenderOverlay({ frame }: { readonly frame: RenderOverlayFrame }) {
  const { stage, waveform, caption } = frame;
  return (
    <div
      className={styles.overlay}
      data-render-overlay
      data-overlay-variant={frame.variant}
      data-overlay-window={frame.windowIndex}
      data-overlay-chrome-only={frame.overlayOnly ? 'true' : 'false'}
    >
      <div
        className={styles.stage}
        style={{
          top: `${OVERLAY_GEOMETRY.stage.top}px`,
          left: `${OVERLAY_GEOMETRY.stage.left}px`,
          right: `${OVERLAY_GEOMETRY.stage.right}px`,
        }}
        data-overlay-stage
      >
        {stage.introducerLabel !== '' && (
          <p className={styles.label} data-overlay-label>
            {stage.introducerLabel}
          </p>
        )}
        {stage.daterName !== '' && (
          <p className={styles.name} data-overlay-name>
            {stage.daterName}
          </p>
        )}
        {stage.relationshipChip !== null && (
          <p className={styles.chip} data-overlay-chip>
            {stage.relationshipChip}
          </p>
        )}
      </div>

      {waveform !== null && (
        <div
          className={styles.waveform}
          style={{
            bottom: `${OVERLAY_GEOMETRY.waveform.bottom}px`,
            left: `${OVERLAY_GEOMETRY.waveform.left}px`,
            right: `${OVERLAY_GEOMETRY.waveform.right}px`,
            height: `${OVERLAY_GEOMETRY.waveform.height}px`,
          }}
          data-overlay-waveform={waveform.playheadBar}
          data-overlay-level={waveform.frameLevel}
        >
          {waveform.bars.map((height, index) => (
            <span
              // The bar list is a fixed-length measured array; its index IS its
              // identity, and nothing is inserted or reordered.
              key={index}
              className={styles.bar}
              style={{
                height: `${Math.round(height * 100)}%`,
                opacity: index <= waveform.playheadBar ? 1 : WAVEFORM_IDLE_OPACITY,
                background:
                  index <= waveform.playheadBar ? 'var(--color-flirt)' : 'var(--color-ink)',
              }}
            />
          ))}
        </div>
      )}

      {caption !== null && (
        <div
          className={styles.caption}
          style={{
            bottom: `${OVERLAY_GEOMETRY.caption.bottom}px`,
            left: `${OVERLAY_GEOMETRY.caption.left}px`,
            right: `${OVERLAY_GEOMETRY.caption.right}px`,
          }}
          data-overlay-caption={caption.lineIndex}
          data-overlay-active-word={caption.activeWordIndex}
        >
          {caption.words.map((word, index) => (
            <span
              key={`${caption.lineIndex}:${index}`}
              className={word.active ? `${styles.word} ${styles.wordActive}` : styles.word}
              // Static, never animated (§2.4): a spring here would depend on
              // how fast the capture loop happened to run.
              style={word.active ? { transform: `scale(${WORD_CAPTION_ACTIVE_SCALE})` } : undefined}
            >
              {word.text}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
