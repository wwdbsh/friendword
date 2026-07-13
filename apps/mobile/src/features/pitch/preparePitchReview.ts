import { requestDraftGeneration, type DraftGenerationResult } from '../../services/draftGeneration';
import type { PitchDraftService } from '../../services/pitchDrafts';
import type { PitchDraft, PitchDraftId } from '../../services/types';

type ReviewPreparationService = Pick<
  PitchDraftService,
  'prepareForReview' | 'loadGeneratedReview' | 'saveReview'
>;

type GenerateDraft = (serverDraftId: string) => Promise<DraftGenerationResult>;

export async function preparePitchReview(
  service: ReviewPreparationService,
  draftId: PitchDraftId,
  generateDraft: GenerateDraft = requestDraftGeneration,
): Promise<PitchDraft> {
  const prepared = await service.prepareForReview(draftId);
  if (prepared.server === null) {
    return service.saveReview(draftId, { ...prepared.review, generationMode: 'manual' });
  }

  const generated = await generateDraft(prepared.server.draftId);
  if (generated.kind === 'generated') {
    return service.loadGeneratedReview(draftId);
  }
  return service.saveReview(draftId, { ...prepared.review, generationMode: 'manual' });
}
