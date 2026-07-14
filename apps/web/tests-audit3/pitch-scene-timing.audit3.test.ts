// THIRD-AUDIT REGRESSION — CP-2 (structured voice → pitch)
// Photo scenes and captions must follow the recording's ACTUAL duration and
// real segment timing, not a fixed 60s grid or a fabricated MAX_SAFE_INTEGER
// fallback. These assertions fail against the pre-fix view.ts, which spread
// photos over a hardcoded 60_000ms and invented a caption spanning the whole
// number line when segments were absent.
/* global describe, expect, it */

import { activeWindowIndex, distributePhotoScenes, type SceneWindow } from '../src/pitch/scenes';

const segMs = (pairs: readonly [number, number][]): SceneWindow[] =>
  pairs.map(([startMs, endMs]) => ({ startMs, endMs }));

describe('distributePhotoScenes — real audio duration + segment timing (CP-2)', () => {
  it('spans the true recording duration, never a hardcoded 60s', () => {
    const scenes = distributePhotoScenes(3, 42_000, segMs([]));
    expect(scenes[0]?.startMs).toBe(0);
    expect(scenes.at(-1)?.endMs).toBe(42_000);
    // A 60s grid would have put the first boundary at 20_000; a real 42s
    // even split puts it at 14_000.
    expect(scenes[0]?.endMs).toBe(14_000);
  });

  it('snaps scene boundaries to real segment starts when segments cover the photos', () => {
    // 4 segments, 2 photos -> photo 1 covers segs 0-1, photo 2 covers segs 2-3.
    const segments = segMs([
      [0, 5_000],
      [5_000, 11_000],
      [11_000, 18_000],
      [18_000, 25_000],
    ]);
    const scenes = distributePhotoScenes(2, 25_000, segments);
    expect(scenes).toEqual([
      { startMs: 0, endMs: 11_000 },
      { startMs: 11_000, endMs: 25_000 },
    ]);
  });

  it('gives the remainder segments to the earliest photos', () => {
    // 5 segments, 2 photos -> [3,2]. Boundary at segment index 3 start.
    const segments = segMs([
      [0, 4_000],
      [4_000, 9_000],
      [9_000, 15_000],
      [15_000, 21_000],
      [21_000, 30_000],
    ]);
    const scenes = distributePhotoScenes(2, 30_000, segments);
    expect(scenes).toEqual([
      { startMs: 0, endMs: 15_000 },
      { startMs: 15_000, endMs: 30_000 },
    ]);
  });

  it('falls back to an even split of the real duration when segments are too few', () => {
    const scenes = distributePhotoScenes(3, 30_000, segMs([[0, 30_000]]));
    expect(scenes).toEqual([
      { startMs: 0, endMs: 10_000 },
      { startMs: 10_000, endMs: 20_000 },
      { startMs: 20_000, endMs: 30_000 },
    ]);
  });

  it('collapses a single photo to the whole recording', () => {
    expect(distributePhotoScenes(1, 18_500, segMs([]))).toEqual([{ startMs: 0, endMs: 18_500 }]);
  });
});

describe('activeWindowIndex — clamps within real bounds', () => {
  const windows = segMs([
    [0, 10_000],
    [10_000, 20_000],
    [20_000, 30_000],
  ]);

  it('returns the window containing the elapsed time', () => {
    expect(activeWindowIndex(windows, 0)).toBe(0);
    expect(activeWindowIndex(windows, 9_999)).toBe(0);
    expect(activeWindowIndex(windows, 10_000)).toBe(1);
    expect(activeWindowIndex(windows, 25_000)).toBe(2);
  });

  it('clamps past the end to the last window', () => {
    expect(activeWindowIndex(windows, 999_999)).toBe(2);
  });

  it('returns 0 for an empty timeline instead of a negative index', () => {
    expect(activeWindowIndex([], 5_000)).toBe(0);
  });
});
