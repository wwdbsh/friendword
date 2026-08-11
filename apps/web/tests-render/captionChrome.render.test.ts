import { describe, expect, it } from 'vitest';

import {
  CAPTION_ENTER_MS,
  CAPTION_EXIT_MS,
  activeCaptionIndex,
  captionFrame,
  captionMotion,
  captionParts,
  cubicBezier,
  type CaptionSegment,
  type CaptionWord,
} from '@/pitch/captionChrome';

// T017 — the caption chrome's interpretation layer.
//
// The MP4 renderer captures frames by SEEKING (RenderStage.seek), so every
// caption pixel has to be a pure function of (segments, elapsedMs). A CSS
// transition or anything reading the wall clock would smear the band by
// capture speed and break the [t1, t2, t1] byte-identity guarantee the render
// suite already pins for the scene layer (docs/SESSION_HANDOFF §5). These tests
// are the guard: they pin purity, the segment-boundary behaviour, and the fact
// that a keyword highlight is SELECTED from real provider word data or skipped
// entirely — never fabricated.

const SEGMENTS: readonly CaptionSegment[] = [
  {
    segmentIndex: 0,
    startMs: 0,
    endMs: 4_000,
    text: 'Honestly, Blair is the most curious person I know.',
  },
  {
    segmentIndex: 1,
    startMs: 4_000,
    endMs: 9_000,
    text: 'She drove four hours for a birthday dinner.',
  },
  { segmentIndex: 2, startMs: 10_000, endMs: 14_000, text: 'You should meet her.' },
];

const WORDS: readonly CaptionWord[] = [
  { segmentIndex: 0, wordIndex: 0, text: 'Honestly,' },
  { segmentIndex: 0, wordIndex: 1, text: 'Blair' },
  { segmentIndex: 1, wordIndex: 0, text: 'She' },
  { segmentIndex: 1, wordIndex: 1, text: 'drove' },
];

describe('cubicBezier', () => {
  it('is a total, monotonic, deterministic easing', () => {
    const ease = cubicBezier(0.2, 1.4, 0.4, 1);
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
    expect(ease(-1)).toBe(0);
    expect(ease(2)).toBe(1);
    // The approved entrance overshoots: that is the "pop".
    expect(ease(0.5)).toBeGreaterThan(1);
    // Same input, same output — twice, and from a second solver instance.
    expect(ease(0.37)).toBe(ease(0.37));
    expect(cubicBezier(0.2, 1.4, 0.4, 1)(0.37)).toBe(ease(0.37));
  });
});

describe('captionParts — keyword selection', () => {
  it('highlights the first emphasis candidate the provider actually recorded', () => {
    const parts = captionParts(SEGMENTS[1]!.text, WORDS, 1);
    // 'She' is 3 chars — below the emphasis floor — so 'drove' wins.
    expect(parts.keyword).toBe('drove');
    expect(`${parts.before}${parts.keyword}${parts.after}`).toBe(SEGMENTS[1]!.text);
  });

  it('keeps the caption spelling, not the provider token', () => {
    const parts = captionParts('Honestly, Blair is curious.', WORDS, 0);
    expect(parts.keyword).toBe('Honestly');
    expect(parts.before).toBe('');
    expect(parts.after).toBe(', Blair is curious.');
  });

  it('never fabricates a highlight without word data', () => {
    expect(captionParts(SEGMENTS[0]!.text, [], 0).keyword).toBeNull();
    expect(captionParts(SEGMENTS[2]!.text, WORDS, 2).keyword).toBeNull();
  });

  it('skips a recorded word that is not in this caption', () => {
    const parts = captionParts('A different sentence entirely.', WORDS, 0);
    expect(parts.keyword).toBeNull();
    expect(parts.before).toBe('A different sentence entirely.');
  });

  it('matches whole words only', () => {
    const words: readonly CaptionWord[] = [{ segmentIndex: 0, wordIndex: 0, text: 'drove' }];
    expect(captionParts('He overdrove the corner.', words, 0).keyword).toBeNull();
  });
});

describe('activeCaptionIndex', () => {
  it('returns the last segment that has started, and nothing before the first', () => {
    expect(activeCaptionIndex(SEGMENTS, -1)).toBeNull();
    expect(activeCaptionIndex(SEGMENTS, 0)).toBe(0);
    expect(activeCaptionIndex(SEGMENTS, 3_999)).toBe(0);
    expect(activeCaptionIndex(SEGMENTS, 4_000)).toBe(1);
    // Inside the gap the previous segment is still the last one that started;
    // captionFrame is what decides it has already faded out.
    expect(activeCaptionIndex(SEGMENTS, 9_500)).toBe(1);
    expect(activeCaptionIndex([], 100)).toBeNull();
  });
});

describe('captionMotion — pure function of elapsedMs', () => {
  const segment = SEGMENTS[0]!;

  it('starts hidden, pops in, then rests', () => {
    expect(captionMotion(segment, 0, false).opacity).toBe(0);
    const mid = captionMotion(segment, CAPTION_ENTER_MS / 2, false);
    expect(mid.opacity).toBeGreaterThan(0);
    expect(mid.opacity).toBeLessThanOrEqual(1);
    // Overshoot: past the rest position before settling.
    expect(mid.translateCqh).toBeLessThan(0);
    expect(mid.scale).toBeGreaterThan(1);
    const rest = captionMotion(segment, CAPTION_ENTER_MS, false);
    expect(rest).toEqual({ opacity: 1, translateCqh: 0, scale: 1, rotateDeg: 0 });
  });

  it('fades down over the last 260ms and is gone at the boundary', () => {
    const resting = captionMotion(segment, segment.endMs - CAPTION_EXIT_MS, false);
    expect(resting.opacity).toBe(1);
    const leaving = captionMotion(segment, segment.endMs - CAPTION_EXIT_MS / 2, false);
    expect(leaving.opacity).toBeLessThan(1);
    expect(leaving.opacity).toBeGreaterThan(0);
    expect(leaving.translateCqh).toBeGreaterThan(0);
    expect(captionMotion(segment, segment.endMs, false).opacity).toBe(0);
  });

  it('is a step function under prefers-reduced-motion', () => {
    expect(captionMotion(segment, 10, true)).toEqual({
      opacity: 1,
      translateCqh: 0,
      scale: 1,
      rotateDeg: 0,
    });
    expect(captionMotion(segment, segment.endMs, true).opacity).toBe(0);
  });

  it('ignores the wall clock (mutation guard for the render path)', () => {
    const realNow = Date.now;
    const realPerf = performance.now;
    const sample = (): readonly unknown[] =>
      Array.from({ length: 200 }, (_, step) => captionMotion(segment, step * 20, false));

    Date.now = () => 1_000;
    performance.now = () => 1_000;
    const first = sample();
    Date.now = () => 9_876_543;
    performance.now = () => 9_876_543;
    const second = sample();
    Date.now = realNow;
    performance.now = realPerf;

    expect(second).toEqual(first);
  });
});

describe('captionFrame', () => {
  const options = { words: WORDS, reducedMotion: false } as const;

  it('is byte-stable for the same millisecond', () => {
    for (const t of [0, 190, 1_500, 3_900, 4_000, 4_010, 8_900, 13_999]) {
      expect(captionFrame(SEGMENTS, t, options)).toEqual(captionFrame(SEGMENTS, t, options));
    }
  });

  it('shows nothing before the first segment, in a gap, or after the last', () => {
    expect(captionFrame(SEGMENTS, -50, options)).toBeNull();
    expect(captionFrame(SEGMENTS, 9_500, options)).toBeNull();
    expect(captionFrame(SEGMENTS, 14_000, options)).toBeNull();
    expect(captionFrame(SEGMENTS, 20_000, options)).toBeNull();
    expect(captionFrame([], 500, options)).toBeNull();
  });

  it('swaps caption exactly at a segment boundary', () => {
    const before = captionFrame(SEGMENTS, 3_999, options);
    const after = captionFrame(SEGMENTS, 4_000, options);
    expect(before?.segmentIndex).toBe(0);
    // 3999ms is inside segment 0's fade-down.
    expect(before?.motion.opacity).toBeLessThan(1);
    // 4000ms is segment 1's first frame: present in the DOM, still invisible.
    expect(after).toBeNull();
    const settled = captionFrame(SEGMENTS, 4_000 + CAPTION_ENTER_MS, options);
    expect(settled?.segmentIndex).toBe(1);
    expect(settled?.parts.keyword).toBe('drove');
    expect(settled?.motion.opacity).toBe(1);
  });

  it('emits a transform string in container units', () => {
    const frame = captionFrame(SEGMENTS, 100, options);
    expect(frame?.transform).toMatch(
      /^translateY\(-?[\d.]+cqh\) scale\([\d.]+\) rotate\(-?[\d.]+deg\)$/,
    );
  });
});
