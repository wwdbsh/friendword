import type { PitchSceneSegment, PitchSceneTemplate, PitchSceneV2 } from '@friendword/contracts';

/**
 * Builds the scene the dater is asked to approve. Injected so the submit path
 * can be tested without depending on the builder's own timing rules.
 *
 * Declared structurally rather than as `typeof buildPitchSceneV2` so this file
 * states the contract the submit path depends on: the template it picks, the
 * published photo order, and the transcript windows. `words` is deliberately
 * absent — see {@link PITCH_SCENE_TEMPLATE}.
 */
export type PitchSceneBuilder = (input: {
  readonly template: PitchSceneTemplate;
  readonly photoAssetIds: readonly string[];
  readonly segments: readonly PitchSceneSegment[];
}) => PitchSceneV2 | null;

/**
 * The only template the introducer's submit builds. There is no template picker
 * in the mobile flow yet, and 'warm' is the one that matches the copy the
 * introducer just recorded a friend's introduction into.
 *
 * No `words` are passed with it. `pitch_drafts.transcript` does carry provider
 * word timings (A7), but as a flat list of {start, end, word} in seconds with no
 * segment/word indices, and a v2 wordPop stores exactly that (segmentIndex,
 * wordIndex) pair. Deriving the pair here would mean inventing a
 * word→segment assignment that the DB check and the player must agree with; a
 * disagreement points an approved accent at a different word. So the builder is
 * left to degrade to segment rhythm, and word-level accents stay with whoever
 * owns that mapping.
 */
export const PITCH_SCENE_TEMPLATE: PitchSceneTemplate = 'warm';

/**
 * What the submit path observed when it dropped a built scene and sent the pitch
 * without motion. `reason` is the server's own rejection message, verbatim, so a
 * log line names the rule that was broken rather than a code this app invented.
 */
export type PitchSceneDemotion = {
  readonly draftId: string;
  readonly reason: string;
};

export type PitchSceneDemotionReporter = (demotion: PitchSceneDemotion) => void;

/**
 * The default reporter. A demotion is silent to the introducer by design — the
 * pitch is sent, only its motion is gone — so this log is the only signal that a
 * builder regression is turning every submit sceneless. It has to carry the
 * draft id and the server's reason for exactly that triage.
 *
 * `console.warn` because mobile has no analytics transport yet
 * (`src/analytics/README.md`); when one lands, this is the single place to
 * forward from.
 */
export const reportPitchSceneDemotion: PitchSceneDemotionReporter = (demotion) => {
  console.warn(
    `[pitchScene] submit demoted to sceneless draftId=${demotion.draftId} reason=${demotion.reason}`,
  );
};

/**
 * Prefix of every scene rejection raised by `private.pitch_scene_violation`
 * (0048, 0049) — the messages `assert_scene_definition` re-raises verbatim, so
 * PostgREST reports them as the error's `message`.
 *
 * The sceneless fallback keys off this prefix and nothing else: an error that
 * merely mentions a scene somewhere in its text (a Postgres context line, a
 * different gate) must not be able to turn a real failure into a silent
 * submit-without-motion.
 */
const PITCH_SCENE_REJECTION_PREFIX = 'pitch scene';

/**
 * The scene rejection message inside an error → cause chain, or null when this
 * failure is not one. Walks the chain because the repo wraps the PostgREST error
 * as the `cause` of a `DataLayerError`.
 */
export function pitchSceneRejectionMessage(error: unknown): string | null {
  return (
    errorMessageChain(error).find((message) =>
      message.trimStart().startsWith(PITCH_SCENE_REJECTION_PREFIX),
    ) ?? null
  );
}

/** Every `message` on an error → cause chain, outermost first. Depth-capped. */
function errorMessageChain(error: unknown, depth = 0): readonly string[] {
  if (depth > 5 || error === null || typeof error !== 'object') {
    return [];
  }
  const record = error as { message?: unknown; cause?: unknown };
  const own = typeof record.message === 'string' ? [record.message] : [];
  return [...own, ...errorMessageChain(record.cause, depth + 1)];
}

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
