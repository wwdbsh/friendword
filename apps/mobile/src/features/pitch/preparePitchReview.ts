import {
  DraftGenerationError,
  requestDraftGeneration,
  type DraftGenerationResult,
} from '../../services/draftGeneration';
import {
  AiConsentRequiredError,
  hasCurrentAiProcessingConsent,
  recordCurrentAiProcessingConsent,
} from '../../services/aiConsent';
import type { PitchDraftService } from '../../services/pitchDrafts';
import type { PitchDraft, PitchDraftId } from '../../services/types';

type ReviewPreparationService = Pick<
  PitchDraftService,
  'prepareForReview' | 'loadGeneratedReview' | 'saveReview'
>;

type GenerateDraft = (serverDraftId: string) => Promise<DraftGenerationResult>;

export type PitchReviewPreparationChoice =
  'affirm_ai_consent' | 'use_existing_ai_consent' | 'write_manually';

export type PitchReviewPreparationDependencies = {
  readonly generateDraft: GenerateDraft;
  readonly hasAiConsent: (serverDraftId: string) => Promise<boolean>;
  readonly recordAiConsent: (serverDraftId: string) => Promise<void>;
};

const productionDependencies: PitchReviewPreparationDependencies = {
  generateDraft: requestDraftGeneration,
  hasAiConsent: hasCurrentAiProcessingConsent,
  recordAiConsent: recordCurrentAiProcessingConsent,
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
  const prepared = await service.prepareForReview(draftId);
  if (prepared.server === null || choice === 'write_manually') {
    return service.saveReview(draftId, { ...prepared.review, generationMode: 'manual' });
  }

  if (choice === 'affirm_ai_consent') {
    await dependencies.recordAiConsent(prepared.server.draftId);
  } else if (!(await dependencies.hasAiConsent(prepared.server.draftId))) {
    throw new AiConsentRequiredError();
  }

  const generated = await dependencies.generateDraft(prepared.server.draftId);
  if (generated.kind === 'generated') {
    return service.loadGeneratedReview(draftId);
  }
  return service.saveReview(draftId, { ...prepared.review, generationMode: 'manual' });
}
