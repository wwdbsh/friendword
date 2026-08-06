import { formatErrorForDisplay } from '../../services/errorDiagnostics';
import type { PitchDraftId, PitchRecording, PitchRelationship } from '../../services/types';

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
