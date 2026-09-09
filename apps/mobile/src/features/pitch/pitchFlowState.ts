import { formatErrorForDisplay } from '../../services/errorDiagnostics';
import type {
  PitchClip,
  PitchDraftId,
  PitchRecording,
  PitchRelationship,
} from '../../services/types';
import type { SelfieCapture } from './selfieClip';

export class PitchFlowStateError extends Error {
  constructor() {
    super('The pitch flow reached an incomplete review state.');
    this.name = 'PitchFlowStateError';
  }
}

export function requireDraftId(draftId: PitchDraftId | null): PitchDraftId {
  if (!draftId) {
    throw new PitchFlowStateError();
  }
  return draftId;
}

export function requireRecording(recording: PitchRecording | null): PitchRecording {
  if (!recording) {
    throw new PitchFlowStateError();
  }
  return recording;
}

export function requireReviewData(
  relationship: PitchRelationship | null,
  recording: PitchRecording | null,
): { readonly relationship: PitchRelationship; readonly recording: PitchRecording } {
  if (!relationship || !recording) {
    throw new PitchFlowStateError();
  }
  return { relationship, recording };
}

export function handleFlowError(error: unknown, setErrorMessage: (message: string) => void): void {
  if (error instanceof Error) {
    setErrorMessage('We could not save this track. Please try again.');
    return;
  }
  throw error;
}

export function handleSubmitError(
  error: unknown,
  setErrorMessage: (message: string) => void,
): void {
  if (error instanceof Error) {
    // TODO(qa): temporary diagnostics while device QA hunts a submit failure.
    console.warn('[pitchFlow] submit failed', error.message, error.stack);
    // The screen carries the error class and top frames as well as the message:
    // a released build has no console, so this is the only way a device-only
    // failure gets identified (T015 defect 2).
    setErrorMessage(formatErrorForDisplay(error));
    return;
  }
  throw error;
}

export function assertNever(value: never): never {
  return value;
}

/**
 * The selfie opener is not a fourth kind of media: it is one of the draft's
 * clips, carrying `role: 'selfie'` (docs/REEL_V3_DESIGN.md §3). That is what
 * puts it through the existing ingest path — signed upload, `pitch_assets`
 * row, probe, silent proxy, poster, frame moderation — instead of a second,
 * unreviewed one, and it is why the composer tracks it alongside the clips the
 * introducer picked rather than in a field of its own.
 *
 * At most one clip may hold the role, which is what the helpers below enforce.
 */
export const SELFIE_CLIP_ROLE = 'selfie';

/** The draft's selfie opener, or null when it has none. */
export function findSelfieClip(clips: readonly PitchClip[]): PitchClip | null {
  return clips.find((clip) => clip.role === SELFIE_CLIP_ROLE) ?? null;
}

/** True when this draft carries a selfie opener — what the review summary reads. */
export function hasSelfieClip(clips: readonly PitchClip[]): boolean {
  return findSelfieClip(clips) !== null;
}

/**
 * The clip list with `selfie` as its opener: replacing the one already there,
 * appending when there is none, and removing it for `null`.
 *
 * The picked clips keep their order and their identity, because their
 * `assetKey` names bytes that may already be stored — reordering them would
 * hand one clip another's object. The selfie is appended last for the same
 * reason.
 */
export function withSelfieClip(
  clips: readonly PitchClip[],
  selfie: PitchClip | null,
): readonly PitchClip[] {
  const picked = clips.filter((clip) => clip.role !== SELFIE_CLIP_ROLE);
  return selfie === null ? picked : [...picked, { ...selfie, role: SELFIE_CLIP_ROLE }];
}

/**
 * Whether this draft has a video slot left for a selfie.
 *
 * The server's clip budget counts every video on the pitch, selfie included:
 * 0050's `enforce_pitch_video_limits` allows one video per draft unless the
 * campaign holds a Campaign Pass, and it refuses the second one *inside the
 * registration*, after its bytes are already uploaded. Asking here is what
 * keeps the card from offering a recording that would be thrown away — the
 * refusal path still exists for the race, and it drops the selfie rather than
 * failing the submit.
 *
 * A selfie already on the draft occupies the slot it was given, so it is not
 * counted against itself: the card offers a delete, not a second capture.
 */
export function selfieClipSlotAvailable(clips: readonly PitchClip[], maxClips: number): boolean {
  return clips.filter((clip) => clip.role !== SELFIE_CLIP_ROLE).length < maxClips;
}

/**
 * A capture the camera just wrote, as the draft's selfie clip.
 *
 * `assetKey` is deliberately not set here: `saveClips` assigns one when the
 * clip is first stored and keeps it from then on, so minting one at this point
 * would only risk two names for the same bytes.
 */
export function selfieClipFromCapture(capture: SelfieCapture): PitchClip {
  return {
    uri: capture.uri,
    width: capture.width,
    height: capture.height,
    durationMillis: capture.durationMillis,
    byteSize: capture.byteSize,
    mimeType: capture.mimeType,
    role: SELFIE_CLIP_ROLE,
  };
}
