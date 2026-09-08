import {
  DraftGenerationError,
  requestDraftGeneration,
  type DraftGenerationResult,
} from '../../services/draftGeneration';
import {
  AiConsentRequiredError,
  getAiDisclosureRevision,
  hasAiProcessingConsent,
  recordAiProcessingConsent,
} from '../../services/aiConsent';
import { formatErrorForDisplay } from '../../services/errorDiagnostics';
import type { PitchDraftService } from '../../services/pitchDrafts';
import type { PitchDraft, PitchDraftId } from '../../services/types';

type ReviewPreparationService = Pick<
  PitchDraftService,
  'prepareForReview' | 'uploadDraftMedia' | 'loadGeneratedReview' | 'saveReview'
>;

type GenerateDraft = (serverDraftId: string) => Promise<DraftGenerationResult>;

export type PitchReviewPreparationChoice =
  'affirm_ai_consent' | 'use_existing_ai_consent' | 'write_manually';

/**
 * CP-8: the AI path derives captions from the transcript, so the recording step
 * no longer forces a text recap. The manual (no-AI) path has no transcript, so
 * the typed recap is its only caption source and stays required — this error is
 * thrown before any media is uploaded when a manual submission has no recap.
 */
export class ManualRecapRequiredError extends Error {
  constructor() {
    super('Add a short text recap to publish without AI captions.');
    this.name = 'ManualRecapRequiredError';
  }
}

export function isManualRecapRequiredFailure(error: unknown): boolean {
  return error instanceof ManualRecapRequiredError;
}

export type PitchReviewPreparationDependencies = {
  readonly generateDraft: GenerateDraft;
  readonly getDisclosureRevision: () => Promise<string>;
  readonly hasAiConsent: (serverDraftId: string, revision: string) => Promise<boolean>;
  readonly recordAiConsent: (serverDraftId: string, revision: string) => Promise<void>;
};

const productionDependencies: PitchReviewPreparationDependencies = {
  generateDraft: requestDraftGeneration,
  getDisclosureRevision: getAiDisclosureRevision,
  hasAiConsent: hasAiProcessingConsent,
  recordAiConsent: recordAiProcessingConsent,
};

/**
 * S1: /api/transcribe answers 409 for three different situations — consent must
 * be confirmed again, this recording was already transcribed, another attempt
 * is mid-transcription — and this used to map all of them back to the consent
 * disclosure, which is untrue for two of them. A 409 with no code at all is
 * still read as consent: that is what an older server sends, and consent was
 * its only 409 the app could act on.
 */
export function isAiConsentRequiredFailure(error: unknown): boolean {
  return (
    error instanceof AiConsentRequiredError ||
    (error instanceof DraftGenerationError &&
      error.status === 409 &&
      (error.code === 'ai_consent_required' || error.code === null))
  );
}

export const ALREADY_TRANSCRIBED_MESSAGE =
  'We already wrote a draft from this recording — open this pitch again to see it.';

export const TRANSCRIBE_IN_PROGRESS_MESSAGE =
  'This recording is still being written up. Give it a few seconds and try again.';

export const DRAFT_NOT_EDITABLE_MESSAGE = 'This pitch can no longer be edited.';

const CODED_FAILURE_MESSAGES: Readonly<Record<string, string>> = {
  already_transcribed: ALREADY_TRANSCRIBED_MESSAGE,
  transcription_in_progress: TRANSCRIBE_IN_PROGRESS_MESSAGE,
  draft_not_editable: DRAFT_NOT_EDITABLE_MESSAGE,
};

/**
 * T001 (issue #70): the server refused to draft because the recording carried
 * no usable speech. The only way forward is a new recording, so this failure is
 * routed back to the recording step rather than shown as a retryable error —
 * retrying the same upload would fail identically.
 */
export function isInsufficientSpeechFailure(error: unknown): boolean {
  return (
    error instanceof DraftGenerationError &&
    error.status === 422 &&
    error.code === 'insufficient_speech'
  );
}

export const INSUFFICIENT_SPEECH_MESSAGE =
  "We couldn't hear enough in that recording to write from — record it again.";

export function getAiDraftFailureMessage(error: unknown): string {
  if (isInsufficientSpeechFailure(error)) {
    return INSUFFICIENT_SPEECH_MESSAGE;
  }
  if (error instanceof DraftGenerationError && error.code !== null) {
    const coded = CODED_FAILURE_MESSAGES[error.code];
    if (coded !== undefined) {
      return coded;
    }
  }
  if (error instanceof DraftGenerationError && error.status === 429) {
    return 'AI usage limit reached — try again later';
  }
  if (error instanceof DraftGenerationError && error.status === 503) {
    return 'AI features are temporarily disabled';
  }
  // Anything else is unrecognised, so it is reported with the error class and
  // the frame it came from: on a released build this screen is the only place a
  // device-only failure is ever visible. See errorDiagnostics for what it may
  // and may not carry.
  return formatErrorForDisplay(error);
}

export async function preparePitchReview(
  service: ReviewPreparationService,
  draftId: PitchDraftId,
  choice: PitchReviewPreparationChoice,
  dependencies: PitchReviewPreparationDependencies = productionDependencies,
): Promise<PitchDraft> {
  // Step 1: create the server draft only. No bytes are uploaded and nothing is
  // sent to the external validator yet (third audit P0-NEW-2).
  const prepared = await service.prepareForReview(draftId);

  // Manual writing and local-only drafts never touch external AI. Manual still
  // needs its media on the server for the friend to review, so it uploads —
  // the server does a structure-only check when no AI consent is on record.
  if (prepared.server === null || choice === 'write_manually') {
    // CP-8: an explicit manual submission publishes the typed recap as its
    // captions, so it must carry one. The AI path below never reaches here.
    if (choice === 'write_manually' && (prepared.recording?.caption?.trim() ?? '') === '') {
      throw new ManualRecapRequiredError();
    }
    if (prepared.server !== null) {
      await service.uploadDraftMedia(draftId);
    }
    return service.saveReview(draftId, { ...prepared.review, generationMode: 'manual' });
  }

  // Step 2: consent for the CURRENT server revision must be on record before a
  // single byte leaves for the provider. Reading the revision from the server
  // also fails the AI path closed if it is unavailable; the manual path above
  // has already returned, so it stays usable.
  const revision = await dependencies.getDisclosureRevision();
  if (choice === 'affirm_ai_consent') {
    await dependencies.recordAiConsent(prepared.server.draftId, revision);
  } else if (!(await dependencies.hasAiConsent(prepared.server.draftId, revision))) {
    throw new AiConsentRequiredError();
  }

  // Step 3: only now upload + validate, then transcribe/structure.
  await service.uploadDraftMedia(draftId);

  const generated = await dependencies.generateDraft(prepared.server.draftId);
  if (generated.kind === 'generated') {
    return service.loadGeneratedReview(draftId);
  }
  return service.saveReview(draftId, { ...prepared.review, generationMode: 'manual' });
}
