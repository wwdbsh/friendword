import type { PitchSceneSegment, PitchSceneV1 } from '@friendword/contracts';

/**
 * Builds the scene the dater is asked to approve. Injected so the submit path
 * can be tested without depending on the builder's own timing rules.
 */
export type PitchSceneBuilder = (input: {
  readonly photoAssetIds: readonly string[];
  readonly segments: readonly PitchSceneSegment[];
}) => PitchSceneV1 | null;

/**
 * Segment windows (ms) read out of a `pitch_drafts.transcript` snapshot.
 *
 * The conversion has to stay identical to the one the published page applies to
 * the same snapshot (`segmentWindows` in `apps/web/src/pitch/view.ts`), because
 * the scene submitted from here describes the timeline that player will run: the
 * provider reports seconds, the timeline is integer milliseconds, and an end is
 * clamped to at least 1ms so a zero-length segment cannot collapse a window.
 *
 * Tolerant by design. The transcript is provider-shaped JSONB written by
 * `/api/transcribe`, and a manual (no-AI) pitch has none at all; anything this
 * cannot read yields an empty list, which makes the scene NULL rather than a
 * guessed timeline.
 */
export function transcriptSegmentWindows(transcript: unknown): readonly PitchSceneSegment[] {
  if (typeof transcript !== 'object' || transcript === null || Array.isArray(transcript)) {
    return [];
  }
  const segments = (transcript as { readonly segments?: unknown }).segments;
  if (!Array.isArray(segments)) {
    return [];
  }
  return segments.flatMap((segment: unknown) => {
    if (typeof segment !== 'object' || segment === null) {
      return [];
    }
    const { start, end, text } = segment as {
      readonly start?: unknown;
      readonly end?: unknown;
      readonly text?: unknown;
    };
    if (typeof start !== 'number' || typeof end !== 'number' || typeof text !== 'string') {
      return [];
    }
    return [
      {
        startMs: Math.max(0, Math.round(start * 1000)),
        endMs: Math.max(1, Math.round(end * 1000)),
      },
    ];
  });
}
