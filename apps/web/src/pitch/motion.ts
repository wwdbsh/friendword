// How a player turns an approved PitchScene (or the absence of one) into the
// photo windows it plays. Pure so both the consent preview and the public page
// can be proven to use the same windows for the same scene.

import {
  isPitchSceneV1,
  MIN_SCENE_DURATION_MS,
  type PitchSceneAnyVersion,
} from '@friendword/contracts';

import { activeWindowIndex, distributePhotoScenes, type SceneWindow } from './scenes';

export type MotionWindow = {
  /** Index into the player's photo list. */
  readonly photoIndex: number;
  readonly startMs: number;
  readonly endMs: number;
};

/**
 * The scene's own windows, bound to the photos this player renders. Returns null
 * — i.e. "not playable as approved" — when any referenced asset is missing from
 * the rendered set, because a scene whose photo set differs from the page's
 * would leave holes or show a photo that is no longer included. Callers fall
 * back to `legacyMotionWindows` (A4) rather than render a partial timeline.
 *
 * A v2 scene also returns null: it is a shot list, not a window list, and
 * flattening it here would throw away the crops and effects the Dater approved.
 * Its own interpreter is `src/pitch/sceneV2.ts`, and the player checks for it
 * BEFORE reaching this function.
 *
 * The windows are used VERBATIM. Recomputing them here from a duration would
 * reintroduce the drift this phase exists to remove: the Dater approves the
 * scene JSON, so playback has to be that JSON and nothing else.
 */
export function sceneMotionWindows(
  scene: PitchSceneAnyVersion | null,
  photoAssetIds: readonly (string | null)[],
): readonly MotionWindow[] | null {
  if (scene === null || !isPitchSceneV1(scene)) {
    return null;
  }
  const windows: MotionWindow[] = [];
  for (const window of scene.scenes) {
    const photoIndex = photoAssetIds.indexOf(window.assetId);
    if (photoIndex === -1) {
      return null;
    }
    windows.push({ photoIndex, startMs: window.startMs, endMs: window.endMs });
  }
  return windows;
}

/**
 * Pre-0048 fallback: recompute the distribution at runtime from the real
 * duration and the real segment timings. Only legitimate when there is no
 * approved scene (a legacy row, a fixture, or a recording with no segments).
 */
export function legacyMotionWindows(
  photoCount: number,
  durationMs: number,
  segments: readonly SceneWindow[],
): readonly MotionWindow[] {
  // The strobe floor applies to the legacy path too: it is the viewer who bears
  // the photosensitivity risk, and they consented to nothing. A legacy row with
  // more photos than seconds shows the leading photos rather than flashing all
  // of them. Rows with an approved scene never reach this function.
  const affordable = Math.floor(durationMs / MIN_SCENE_DURATION_MS);
  const count = Math.max(1, Math.min(photoCount, affordable));
  return distributePhotoScenes(count, durationMs, segments).map((window, index) => ({
    photoIndex: index,
    startMs: window.startMs,
    endMs: window.endMs,
  }));
}

/** Photo index active at `elapsedMs`, clamped at both ends. */
export function activeMotionPhotoIndex(
  windows: readonly MotionWindow[],
  elapsedMs: number,
): number {
  if (windows.length === 0) {
    return 0;
  }
  return windows[activeWindowIndex(windows, elapsedMs)]?.photoIndex ?? 0;
}

/**
 * Difference between the media's own duration and the approved scene's, for
 * verification and logging ONLY. The scene never bends to the measured audio:
 * the measurement differs per browser, and the Dater approved the scene.
 */
export function sceneDurationDriftMs(
  // Any scene version: the drift is about the one field every version has, and
  // the answer is a log line either way.
  scene: { readonly durationMs: number } | null,
  measuredDurationMs: number | null,
): number | null {
  if (scene === null || measuredDurationMs === null || measuredDurationMs <= 0) {
    return null;
  }
  return Math.round(measuredDurationMs - scene.durationMs);
}

/** Stable, comparable serialization of the played windows for tests and QA. */
export function motionWindowSignature(windows: readonly MotionWindow[]): string {
  return windows
    .map((window) => `${window.photoIndex}:${window.startMs}-${window.endMs}`)
    .join(',');
}
