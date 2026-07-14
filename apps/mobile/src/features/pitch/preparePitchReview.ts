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
import type { PitchDraftService } from '../../services/pitchDrafts';
import type { PitchDraft, PitchDraftId } from '../../services/types';

type ReviewPreparationService = Pick<
  PitchDraftService,
  'prepareForReview' | 'uploadDraftMedia' | 'loadGeneratedReview' | 'saveReview'
>;

type GenerateDraft = (serverDraftId: string) => Promise<DraftGenerationResult>;

export type PitchReviewPreparationChoice =
  'affirm_ai_consent' | 'use_existing_ai_consent' | 'write_manually';

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

export function isAiConsentRequiredFailure(error: unknown): boolean {
  return (
    error instanceof AiConsentRequiredError ||
    (error instanceof DraftGenerationError && error.status === 409)
  );
}

export function getAiDraftFailureMessage(error: unknown): string {
  if (error instanceof DraftGenerationError && error.status === 429) {
    return 'AI usage limit reached — try again later';
  }
  if (error instanceof DraftGenerationError && error.status === 503) {
    return 'AI features are temporarily disabled';
  }
  return error instanceof Error
    ? error.message
    : 'The AI draft could not be created. Please try again.';
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
