import { z } from 'zod';

// PitchScene v1 — the scene list a Dater approves and a render worker replays.
//
// It carries NO text. Caption text and caption timing are derived by the player
// from the revision's transcript segments, so a scene can never disagree with
// the words the Dater was shown, and approving a scene can never smuggle in copy
// nobody reviewed.
//
// The floors below are mechanical safety, not aesthetics, and the database
// enforces the same ones (migration 0048). "No overlap" alone still admits
// 30ms x 100 scenes — a strobe with a photosensitive-seizure risk that lands on
// the viewer, who is outside the consent model. Hence a hard per-scene minimum.

export const PITCH_SCENE_SCHEMA_VERSION = 1;

/** Hard floor per scene, last scene included. Mirrored by the DB CHECK. */
export const MIN_SCENE_DURATION_MS = 1000;

/** Vertical share canvas for v1. Emitted by the builder; readers stay lenient. */
export const PITCH_SCENE_CANVAS = { width: 1080, height: 1920, fps: 30 } as const;

const sceneWindowSchema = z
  .object({
    assetId: z.string().uuid(),
    startMs: z.number().int().min(0),
    endMs: z.number().int().positive(),
  })
  .strict();

/**
 * Client-side mirror of the stored shape plus every floor the DB enforces. A
 * stored scene that fails this parse reads as "no scene" and the surface falls
 * back to the legacy runtime distribution — it is never rendered half-valid.
 *
 * `canvas` is checked for positive integers rather than pinned to
 * PITCH_SCENE_CANVAS on purpose: a reader stricter than the writer would
 * silently drop motion from a page whose scene the server accepted.
 */
export const pitchSceneV1Schema = z
  .object({
    schemaVersion: z.literal(PITCH_SCENE_SCHEMA_VERSION),
    canvas: z
      .object({
        width: z.number().int().positive(),
        height: z.number().int().positive(),
        fps: z.number().int().positive(),
      })
      .strict(),
    durationMs: z.number().int().positive(),
    scenes: z.array(sceneWindowSchema).min(1),
  })
  .strict()
  .superRefine((scene, ctx) => {
    const seen = new Set<string>();
    let expectedStart = 0;
    for (const [index, window] of scene.scenes.entries()) {
      if (seen.has(window.assetId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['scenes', index, 'assetId'],
          message: 'a photo may appear in at most one scene',
        });
      }
      seen.add(window.assetId);
      if (window.startMs !== expectedStart) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['scenes', index, 'startMs'],
          message: 'scenes must be contiguous with no gap or overlap',
        });
      }
      if (window.endMs - window.startMs < MIN_SCENE_DURATION_MS) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['scenes', index, 'endMs'],
          message: `every scene must last at least ${MIN_SCENE_DURATION_MS}ms`,
        });
      }
      expectedStart = window.endMs;
    }
    if (expectedStart !== scene.durationMs) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['scenes'],
        message: 'scenes must cover exactly [0, durationMs]',
      });
    }
  });

export type PitchSceneV1 = z.infer<typeof pitchSceneV1Schema>;

export type PitchSceneWindow = z.infer<typeof sceneWindowSchema>;

export type PitchSceneSegment = {
  readonly startMs: number;
  readonly endMs: number;
};

export type BuildPitchSceneInput = {
  /** Photo asset ids in the order they should play (publication sort order). */
  readonly photoAssetIds: readonly string[];
  /** The recording's real transcript segments, in order. */
  readonly segments: readonly PitchSceneSegment[];
};

type Window = { readonly startMs: number; readonly endMs: number };

function evenSplit(count: number, totalMs: number): readonly Window[] {
  const windows: Window[] = [];
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
  segments: readonly PitchSceneSegment[],
): readonly Window[] {
  // Give each photo a contiguous, roughly equal run of real transcript segments
  // so a scene changes on the friend's actual pauses. The first photo always
  // starts at 0 and the last always ends at the true duration.
  const base = Math.floor(segments.length / count);
  const remainder = segments.length % count;
  const windows: Window[] = [];
  let segmentIndex = 0;
  for (let photo = 0; photo < count; photo += 1) {
    const take = base + (photo < remainder ? 1 : 0);
    const startSegment = segmentIndex;
    segmentIndex += take;
    windows.push({
      startMs:
        photo === 0
          ? 0
          : (segments[startSegment]?.startMs ?? Math.round((photo * totalMs) / count)),
      endMs:
        photo === count - 1
          ? totalMs
          : (segments[segmentIndex]?.startMs ?? Math.round(((photo + 1) * totalMs) / count)),
    });
  }
  return windows;
}

/**
 * Same contract as the runtime distribution this replaces
 * (apps/web/src/pitch/scenes.ts): boundaries snap to real segment starts when
 * there are at least as many segments as photos, otherwise the photos split the
 * real duration evenly. Never a hardcoded 60s grid.
 */
function distributePhotoScenes(
  count: number,
  totalMs: number,
  segments: readonly PitchSceneSegment[],
): readonly Window[] {
  if (count === 1) {
    return [{ startMs: 0, endMs: totalMs }];
  }
  if (segments.length >= count) {
    return alignedToSegments(count, totalMs, segments);
  }
  return evenSplit(count, totalMs);
}

function isSafe(windows: readonly Window[], totalMs: number): boolean {
  let expectedStart = 0;
  for (const window of windows) {
    if (window.startMs !== expectedStart || window.endMs - window.startMs < MIN_SCENE_DURATION_MS) {
      return false;
    }
    expectedStart = window.endMs;
  }
  return expectedStart === totalMs;
}

/**
 * Builds the scene the Dater approves, or null when the recording cannot carry
 * one (no photos, no transcript segments, or a recording too short for even a
 * single legal scene). Null is a legitimate answer: the surface then falls back
 * to the legacy runtime distribution (A4) rather than publishing an illegal
 * timeline.
 *
 * Deterministic and pure. The duration is the last segment's end — never a
 * client-measured audio duration, which differs per device and would make the
 * approved scene depend on who happened to open the page.
 */
export function buildPitchSceneV1(input: BuildPitchSceneInput): PitchSceneV1 | null {
  // An asset may hold at most one scene, so a duplicated id is dropped rather
  // than allowed to fail the invariant later.
  const photoAssetIds = [...new Set(input.photoAssetIds)];
  const lastSegmentEnd = input.segments.at(-1)?.endMs;
  if (photoAssetIds.length === 0 || lastSegmentEnd === undefined) {
    return null;
  }
  const durationMs = Math.round(lastSegmentEnd);
  if (!Number.isFinite(durationMs) || durationMs < MIN_SCENE_DURATION_MS) {
    return null;
  }

  // All or nothing over the approved set. A 4s recording cannot give 8 photos a
  // legal turn, and quietly dropping four of them is not ours to decide: the
  // approved scene must reference exactly the photos the Dater included, which is
  // also what approve_and_publish_pitch requires before it publishes. So the
  // answer here is "no scene yet" and the surface falls back (A4).
  const count = photoAssetIds.length;
  if (count > Math.floor(durationMs / MIN_SCENE_DURATION_MS)) {
    return null;
  }

  const aligned = distributePhotoScenes(count, durationMs, input.segments);
  // Segment-aligned boundaries follow real pauses, and a very short opening
  // segment can put a boundary under the floor. The even split of the same
  // duration cannot (durationMs / count >= MIN_SCENE_DURATION_MS), so it is the
  // deterministic fallback rather than shifting boundaries by hand.
  const windows = isSafe(aligned, durationMs) ? aligned : evenSplit(count, durationMs);

  const scene = {
    schemaVersion: PITCH_SCENE_SCHEMA_VERSION,
    canvas: { ...PITCH_SCENE_CANVAS },
    durationMs,
    scenes: windows.map((window, index) => ({
      // `count === photoAssetIds.length` and the ids are unique, so this index
      // is always populated.
      assetId: photoAssetIds[index] as string,
      startMs: window.startMs,
      endMs: window.endMs,
    })),
  };

  // Fail closed: never hand out a scene the DB would reject.
  return pitchSceneV1Schema.safeParse(scene).success ? (scene as PitchSceneV1) : null;
}

/**
 * Index of the scene active at `elapsedMs`. Clamps to the first scene before
 * the timeline starts and to the last once it ends; returns 0 for an empty list
 * so callers can index safely.
 */
export function activeSceneIndex(
  windows: readonly { readonly startMs: number }[],
  elapsedMs: number,
): number {
  for (let index = windows.length - 1; index >= 0; index -= 1) {
    if (elapsedMs >= (windows[index]?.startMs ?? 0)) {
      return index;
    }
  }
  return 0;
}
