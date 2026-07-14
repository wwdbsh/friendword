// CP-2 (docs/FRIENDWORD_THIRD_AUDIT_HANDOFF_2026-07-14.md §CP-2): photo scenes
// and captions must be driven by the recording's ACTUAL duration and segment
// timing, not a synthetic 60-second grid or a fabricated fallback timestamp.
// These are pure helpers so the timing contract can be unit-tested without a
// browser (tests-audit3/pitch-scene-timing.audit3.test.ts).

export type SceneWindow = {
  readonly startMs: number;
  readonly endMs: number;
};

function evenSplit(count: number, totalMs: number): readonly SceneWindow[] {
  const windows: SceneWindow[] = [];
  for (let index = 0; index < count; index += 1) {
    windows.push({
      startMs: index === 0 ? 0 : Math.round((index * totalMs) / count),
      endMs: index === count - 1 ? totalMs : Math.round(((index + 1) * totalMs) / count),
    });
  }
  return windows;
}

function alignedToSegments(
  count: number,
  totalMs: number,
  segments: readonly SceneWindow[],
): readonly SceneWindow[] {
  // Give each photo a contiguous, roughly equal run of real transcript
  // segments so a scene changes on the friend's actual pauses. The first
  // photo always starts at 0 and the last always ends at the true duration.
  const base = Math.floor(segments.length / count);
  const remainder = segments.length % count;
  const windows: SceneWindow[] = [];
  let segmentIndex = 0;
  for (let photo = 0; photo < count; photo += 1) {
    const take = base + (photo < remainder ? 1 : 0);
    const startSegment = segmentIndex;
    segmentIndex += take;
    windows.push({
      startMs: photo === 0 ? 0 : (segments[startSegment]?.startMs ?? Math.round((photo * totalMs) / count)),
      endMs:
        photo === count - 1
          ? totalMs
          : (segments[segmentIndex]?.startMs ?? Math.round(((photo + 1) * totalMs) / count)),
    });
  }
  return windows;
}

/**
 * Distribute `photoCount` photo scenes across a recording of `durationMs`.
 * When there are at least as many transcript segments as photos, scene
 * boundaries snap to real segment starts; otherwise the photos split the
 * REAL duration evenly. Never returns a hardcoded 60s window.
 */
export function distributePhotoScenes(
  photoCount: number,
  durationMs: number,
  segments: readonly SceneWindow[],
): readonly SceneWindow[] {
  const count = Math.max(1, Math.floor(photoCount));
  const totalMs = durationMs > 0 ? durationMs : 1;
  if (count === 1) {
    return [{ startMs: 0, endMs: totalMs }];
  }
  if (segments.length >= count) {
    return alignedToSegments(count, totalMs, segments);
  }
  return evenSplit(count, totalMs);
}

/**
 * Index of the window active at `elapsedMs`. Clamps to the first window
 * before the timeline starts and to the last once it ends. Returns 0 for an
 * empty list so callers can index safely.
 */
export function activeWindowIndex(
  windows: readonly SceneWindow[],
  elapsedMs: number,
): number {
  if (windows.length === 0) {
    return 0;
  }
  for (let index = windows.length - 1; index >= 0; index -= 1) {
    if (elapsedMs >= (windows[index]?.startMs ?? 0)) {
      return index;
    }
  }
  return 0;
}
