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
    setErrorMessage(error.message);
    return;
  }
  throw error;
}

export function assertNever(value: never): never {
  return value;
}
