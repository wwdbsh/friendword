import { describe, expect, it } from 'vitest';

import {
  OVERLAY_GEOMETRY,
  WAVEFORM_BAR_COUNT,
  overlaySignature,
  renderOverlayFrame,
  stageIntroducerLabel,
  waveformBars,
  waveformPlayheadBar,
  type RenderOverlay,
} from '@/lib/pitchRender/overlay';
import {
  PHOTO_GRADE_HYPE,
  PHOTO_GRADE_WARM,
  grainDataUri,
  photoGradeForTemplate,
} from '@/lib/pitchRender/photoGrade';
import { planCaptureFrames } from '@/lib/pitchRender/renderScene';
import {
  FRAME_HEIGHT_PX,
  FRAME_WIDTH_PX,
  SAFE_BOTTOM_PX,
  SAFE_LEFT_PX,
  SAFE_RIGHT_PX,
  SAFE_TOP_PX,
  WORD_CAPTION_ACTIVE_SCALE,
  WORD_CAPTION_MAX_WORDS_PER_LINE,
  wordCaptionFrame,
  wordCaptionLines,
} from '@/lib/pitchRender/wordCaption';

// §2.3/§2.4/§2.7. Everything the overlay draws is a pure function, so the
// coordinates the cold review found violated are assertable without a browser.

const WORDS = [
  { segmentIndex: 0, wordIndex: 0, text: 'Honestly', startMs: 0, endMs: 400 },
  { segmentIndex: 0, wordIndex: 1, text: 'this', startMs: 400, endMs: 700 },
  { segmentIndex: 0, wordIndex: 2, text: 'is', startMs: 700, endMs: 900 },
  { segmentIndex: 0, wordIndex: 3, text: 'the', startMs: 900, endMs: 1_100 },
  { segmentIndex: 0, wordIndex: 4, text: 'friend', startMs: 1_100, endMs: 1_500 },
  { segmentIndex: 0, wordIndex: 5, text: 'who', startMs: 1_500, endMs: 1_700 },
  { segmentIndex: 1, wordIndex: 0, text: 'Loyal', startMs: 4_000, endMs: 4_500 },
  { segmentIndex: 1, wordIndex: 1, text: 'always', startMs: 4_500, endMs: 5_000 },
] as const;

describe('§2.4: word captions, five to a line, never across a sentence', () => {
  it('breaks at five words and at every segment boundary', () => {
    const lines = wordCaptionLines(WORDS);
    expect(lines.map((line) => [line.from, line.to])).toEqual([
      [0, 4],
      [5, 5],
      [6, 7],
    ]);
    expect(WORD_CAPTION_MAX_WORDS_PER_LINE).toBe(5);
    // The 6th word of segment 0 does not join segment 1's line.
    expect(lines[1]?.segmentIndex).toBe(0);
    expect(lines[2]?.segmentIndex).toBe(1);
  });

  it('lights the last word that has started, and holds it through a gap', () => {
    const at = wordCaptionFrame(WORDS, 1_000);
    expect(at?.words.map((word) => word.text)).toEqual(['Honestly', 'this', 'is', 'the', 'friend']);
    expect(at?.activeIndex).toBe(3);
    expect(at?.activeWordIndex).toBe(3);
    // 2.5s is silence between the sentences: the last spoken word stays lit
    // rather than the band blanking out.
    expect(wordCaptionFrame(WORDS, 2_500)?.activeWordIndex).toBe(5);
  });

  it('never shows a cut-out sentence on the frames after a cut', () => {
    // The highlight jumps from 1.7s straight to 4.0s. Without the window
    // clamp the first frames of the second window still showed "who" — the
    // last word of the sentence the cut removed — because its start is the
    // newest one behind the clock. Found in review, 2026-09-09.
    const window = { startMs: 4_000, endMs: 5_000 };
    expect(wordCaptionFrame(WORDS, 4_000, window)?.words.map((w) => w.text)).toEqual([
      'Loyal',
      'always',
    ]);
    expect(wordCaptionFrame(WORDS, 4_000, window)?.activeWordIndex).toBe(6);
    // The frame just before the window's first word is where the two differ:
    // clamped it shows nothing, unclamped it shows 'who' from the cut sentence.
    expect(wordCaptionFrame(WORDS, 3_999, window)).toBeNull();
    expect(wordCaptionFrame(WORDS, 3_999)?.words.map((w) => w.text)).toEqual(['who']);
    // The full variant passes no window and is unaffected.
    expect(wordCaptionFrame(WORDS, 2_500, null)?.activeWordIndex).toBe(5);
  });

  it('draws nothing before the first word and nothing without timings', () => {
    expect(wordCaptionFrame(WORDS, -1)).toBeNull();
    expect(wordCaptionFrame([], 100)).toBeNull();
    expect(wordCaptionFrame(null, 100)).toBeNull();
  });

  it('keeps the caption block inside the platform safe areas', () => {
    // The defect the cold review measured: text under the platform UI.
    expect(OVERLAY_GEOMETRY.caption.bottom).toBe(484);
    expect(OVERLAY_GEOMETRY.caption.left).toBe(44);
    expect(OVERLAY_GEOMETRY.caption.right).toBe(140);
    // The drawable band, in absolute pixels of the 1080x1920 frame.
    const left = OVERLAY_GEOMETRY.caption.left;
    const right = FRAME_WIDTH_PX - OVERLAY_GEOMETRY.caption.right;
    expect([left, right]).toEqual([44, 940]);
    expect(FRAME_HEIGHT_PX - OVERLAY_GEOMETRY.caption.bottom).toBe(1_436);
    expect([SAFE_TOP_PX, SAFE_BOTTOM_PX, SAFE_LEFT_PX, SAFE_RIGHT_PX]).toEqual([130, 484, 44, 140]);
    expect(WORD_CAPTION_ACTIVE_SCALE).toBe(1.06);
  });

  it('hangs the stage chrome below the top safe area, above the waveform', () => {
    expect(OVERLAY_GEOMETRY.stage.top).toBe(130);
    // Waveform sits between the captions and the chrome, inside the gutters.
    expect(OVERLAY_GEOMETRY.waveform.bottom).toBeGreaterThan(OVERLAY_GEOMETRY.caption.bottom);
    expect(OVERLAY_GEOMETRY.waveform.left).toBe(44);
    expect(OVERLAY_GEOMETRY.waveform.right).toBe(140);
  });
});

describe('§2.3: the waveform is measured, and the chrome names the people', () => {
  it('reduces the envelope to sixty bars by peak, not by average', () => {
    const envelope = Array.from({ length: 600 }, (_unused, index) => (index === 5 ? 1 : 0.1));
    const bars = waveformBars(envelope);
    expect(bars).toHaveLength(WAVEFORM_BAR_COUNT);
    // A single loud frame must survive into its bar; a mean would erase it.
    expect(bars[0]).toBe(1);
    expect(bars[1]).toBe(0.1);
  });

  it('draws nothing at all when nothing was measured', () => {
    expect(waveformBars([])).toEqual([]);
  });

  it('walks the playhead across the bars with integer arithmetic', () => {
    expect(waveformPlayheadBar(0, 600)).toBe(0);
    expect(waveformPlayheadBar(300, 600)).toBe(30);
    expect(waveformPlayheadBar(599, 600)).toBe(59);
    expect(waveformPlayheadBar(5, 0)).toBe(0);
  });

  it('upper-cases the introducer label with a fixed locale', () => {
    expect(stageIntroducerLabel('Maya')).toBe('MAYA INTRODUCES');
    // Not the Turkish dotless i: the pixels must not depend on the host locale.
    expect(stageIntroducerLabel('ilse')).toBe('ILSE INTRODUCES');
  });
});

function overlay(partial: Partial<RenderOverlay> = {}): RenderOverlay {
  return {
    variant: 'highlight',
    stage: { introducerLabel: 'MAYA INTRODUCES', daterName: 'Blair', relationshipChip: null },
    envelope: [0.2, 0.9, 0.5, 1],
    words: WORDS,
    windows: [],
    grade: PHOTO_GRADE_WARM,
    ...partial,
  };
}

describe('§2.3: the overlay is part of the frame signature', () => {
  it('names the variant, the window, the active word and the envelope frame', () => {
    const frame = renderOverlayFrame(overlay(), 1_000, {
      outputFrame: 1,
      totalFrames: 4,
      windowIndex: 2,
    });
    expect(overlaySignature(frame)).toBe('overlay=highlight/2|word=0/3|wave=15/0.9');
  });

  it('changes when the window changes, even at the same millisecond', () => {
    const a = renderOverlayFrame(overlay(), 1_000, {
      outputFrame: 1,
      totalFrames: 4,
      windowIndex: 0,
    });
    const b = renderOverlayFrame(overlay(), 1_000, {
      outputFrame: 1,
      totalFrames: 4,
      windowIndex: 1,
    });
    expect(overlaySignature(a)).not.toBe(overlaySignature(b));
  });

  it('says so when there is no overlay at all (the legacy path)', () => {
    expect(overlaySignature(null)).toBe('overlay=none');
  });

  it('drops the waveform rather than inventing one when nothing was measured', () => {
    const frame = renderOverlayFrame(overlay({ envelope: [] }), 1_000, {
      outputFrame: 0,
      totalFrames: 1,
      windowIndex: 0,
    });
    expect(frame.waveform).toBeNull();
    expect(overlaySignature(frame)).toContain('wave=none');
  });

  it('§2.2-4: overlay-only mode is a distinct frame, chrome and nothing else', () => {
    const frame = renderOverlayFrame(overlay(), 1_000, {
      outputFrame: 1,
      totalFrames: 4,
      windowIndex: 0,
      overlayOnly: true,
    });
    expect(frame.overlayOnly).toBe(true);
    expect(overlaySignature(frame)).toContain('/chrome');
    // The chrome itself is unchanged: it is the same stage text, over nothing.
    expect(frame.stage.daterName).toBe('Blair');
  });
});

describe('§2.7: the photo grade is a constant, not a per-photo decision', () => {
  it('carries the approved curves for each template', () => {
    expect(PHOTO_GRADE_WARM.filter).toBe('contrast(1.06) saturate(1.08) brightness(1.02)');
    expect(PHOTO_GRADE_WARM.vignetteOpacity).toBe(0.18);
    expect(PHOTO_GRADE_WARM.grainOpacity).toBe(0.06);
    expect(PHOTO_GRADE_HYPE.filter).toBe('contrast(1.12) saturate(1.18)');
    expect(PHOTO_GRADE_HYPE.grainOpacity).toBe(0.04);
    expect(photoGradeForTemplate('hype')).toEqual(PHOTO_GRADE_HYPE);
    expect(photoGradeForTemplate('warm')).toEqual(PHOTO_GRADE_WARM);
  });

  it('never moves geometry and never regenerates pixels', () => {
    for (const preset of [PHOTO_GRADE_WARM, PHOTO_GRADE_HYPE]) {
      expect(preset.filter).not.toMatch(/blur|scale|translate|rotate|drop-shadow/);
    }
  });

  it('seeds the grain so two runs produce the same texture', () => {
    expect(grainDataUri(7)).toBe(grainDataUri(7));
    expect(grainDataUri(7)).not.toBe(grainDataUri(11));
    expect(decodeURIComponent(grainDataUri(7))).toContain('seed="7"');
  });
});

describe('§2.2-5: the capture plan walks only the cut windows', () => {
  it('captures each window at fps and numbers the frames of the OUTPUT', () => {
    const plan = planCaptureFrames(
      [
        { startMs: 1_000, endMs: 1_200 },
        { startMs: 5_000, endMs: 5_100 },
      ],
      30,
    );
    // 200ms and 100ms at 30fps, rounded UP so the picture outlasts the sound.
    expect(plan).toHaveLength(6 + 3);
    expect(plan[0]?.tMs).toBe(1_000);
    expect(plan[6]?.tMs).toBe(5_000);
    expect(plan.map((frame) => frame.cursor.outputFrame)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(plan[6]?.cursor.windowIndex).toBe(1);
    expect(plan.every((frame) => frame.cursor.totalFrames === 9)).toBe(true);
    // No millisecond between the windows is ever captured.
    expect(plan.some((frame) => frame.tMs > 1_200 && frame.tMs < 5_000)).toBe(false);
  });

  it('rounds frame counts UP, never down (§2.2-6)', () => {
    // 110ms at 30fps is 3.3 frames: four, so 110ms of audio always has picture.
    const plan = planCaptureFrames([{ startMs: 0, endMs: 110 }], 30);
    expect(plan).toHaveLength(4);
    expect((plan.length * 1000) / 30).toBeGreaterThanOrEqual(110);
  });
});
