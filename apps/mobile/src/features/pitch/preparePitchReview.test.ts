import { describe, expect, it, vi } from 'vitest';

vi.mock('../../services/supabaseClient', () => ({ getSupabaseClient: () => null }));

import { AiConsentRequiredError } from '../../services/aiConsent';
import { DraftGenerationError } from '../../services/draftGeneration';
import { PitchDraftSchema, type PitchDraft, type PitchReview } from '../../services/types';
import {
  getAiDraftFailureMessage,
  isAiConsentRequiredFailure,
  preparePitchReview,
  type PitchReviewPreparationDependencies,
} from './preparePitchReview';

function draftWithServer(): PitchDraft {
  return PitchDraftSchema.parse({
    id: 'qa-flow',
    status: 'draft',
    contextRole: 'INTRODUCER',
    relationship: null,
    photos: [],
    recording: null,
    server: {
      draftId: '10000000-0000-4000-8000-000000000001',
      consentRequestId: null,
      consentToken: null,
    },
    createdAt: '2026-07-13T00:00:00.000Z',
    updatedAt: '2026-07-13T00:00:00.000Z',
  });
}

function dependencies(
  overrides: Partial<PitchReviewPreparationDependencies> = {},
): PitchReviewPreparationDependencies {
  return {
    generateDraft: async () => ({ kind: 'generated' }),
    hasAiConsent: async () => true,
    recordAiConsent: async () => undefined,
    ...overrides,
  };
}

describe('preparePitchReview', () => {
  it('persists a pending state until generation returns a terminal result', async () => {
    const draft = draftWithServer();

    expect(draft.review.generationMode).toBe('pending');
    await expect(
      preparePitchReview(
        {
          prepareForReview: async () => draft,
          loadGeneratedReview: async () => draft,
          saveReview: async () => draft,
        },
        draft.id,
        'use_existing_ai_consent',
        dependencies({
          generateDraft: async () => {
            throw new Error('temporary generation failure');
          },
        }),
      ),
    ).rejects.toThrow('temporary generation failure');
    expect(draft.review.generationMode).toBe('pending');
  });

  it('awaits generation before loading the editable AI review', async () => {
    const events: string[] = [];
    const draft = draftWithServer();
    const result = await preparePitchReview(
      {
        prepareForReview: async () => {
          events.push('draft prepared');
          return draft;
        },
        loadGeneratedReview: async () => {
          events.push('review loaded');
          return draft;
        },
        saveReview: async () => draft,
      },
      draft.id,
      'affirm_ai_consent',
      dependencies({
        recordAiConsent: async () => {
          events.push('consent recorded');
        },
        generateDraft: async () => {
          events.push('generation awaited');
          return { kind: 'generated' };
        },
      }),
    );

    expect(events).toEqual([
      'draft prepared',
      'consent recorded',
      'generation awaited',
      'review loaded',
    ]);
    expect(result.id).toBe(draft.id);
  });

  it('stores an empty manual review instead of mock content after a 501 result', async () => {
    const draft = draftWithServer();
    let savedReview: PitchReview | null = null;
    await preparePitchReview(
      {
        prepareForReview: async () => draft,
        loadGeneratedReview: async () => draft,
        saveReview: async (_id, review) => {
          savedReview = review;
          return { ...draft, review };
        },
      },
      draft.id,
      'affirm_ai_consent',
      dependencies({ generateDraft: async () => ({ kind: 'not_configured' }) }),
    );

    expect(savedReview).toEqual(
      expect.objectContaining({ headline: '', body: '', generationMode: 'manual' }),
    );
  });

  it('does not call transcribe when recording affirmative consent fails', async () => {
    const draft = draftWithServer();
    const generateDraft = vi.fn().mockResolvedValue({ kind: 'generated' });

    await expect(
      preparePitchReview(
        {
          prepareForReview: async () => draft,
          loadGeneratedReview: async () => draft,
          saveReview: async () => draft,
        },
        draft.id,
        'affirm_ai_consent',
        dependencies({
          generateDraft,
          recordAiConsent: async () => {
            throw new Error('consent write failed');
          },
        }),
      ),
    ).rejects.toThrow('consent write failed');
    expect(generateDraft).not.toHaveBeenCalled();
  });

  it('uses existing current-revision consent without recording it again', async () => {
    const draft = draftWithServer();
    const recordAiConsent = vi.fn().mockResolvedValue(undefined);
    const generateDraft = vi.fn().mockResolvedValue({ kind: 'generated' });

    await preparePitchReview(
      {
        prepareForReview: async () => draft,
        loadGeneratedReview: async () => draft,
        saveReview: async () => draft,
      },
      draft.id,
      'use_existing_ai_consent',
      dependencies({ generateDraft, recordAiConsent }),
    );

    expect(recordAiConsent).not.toHaveBeenCalled();
    expect(generateDraft).toHaveBeenCalledOnce();
  });

  it('requires disclosure again when current-revision consent is absent', async () => {
    const draft = draftWithServer();
    const generateDraft = vi.fn().mockResolvedValue({ kind: 'generated' });

    await expect(
      preparePitchReview(
        {
          prepareForReview: async () => draft,
          loadGeneratedReview: async () => draft,
          saveReview: async () => draft,
        },
        draft.id,
        'use_existing_ai_consent',
        dependencies({ generateDraft, hasAiConsent: async () => false }),
      ),
    ).rejects.toBeInstanceOf(AiConsentRequiredError);
    expect(generateDraft).not.toHaveBeenCalled();
  });

  it('maps the authoritative 409 response back to the disclosure', () => {
    expect(isAiConsentRequiredFailure(new DraftGenerationError(409))).toBe(true);
    expect(isAiConsentRequiredFailure(new DraftGenerationError(429))).toBe(false);
  });

  it('keeps manual writing free of consent records and AI generation', async () => {
    const draft = draftWithServer();
    const recordAiConsent = vi.fn().mockResolvedValue(undefined);
    const generateDraft = vi.fn().mockResolvedValue({ kind: 'generated' });

    const result = await preparePitchReview(
      {
        prepareForReview: async () => draft,
        loadGeneratedReview: async () => draft,
        saveReview: async (_id, review) => ({ ...draft, review }),
      },
      draft.id,
      'write_manually',
      dependencies({ generateDraft, recordAiConsent }),
    );

    expect(result.review.generationMode).toBe('manual');
    expect(recordAiConsent).not.toHaveBeenCalled();
    expect(generateDraft).not.toHaveBeenCalled();
  });

  it('shows distinct usage-limit and kill-switch messages', () => {
    expect(getAiDraftFailureMessage(new DraftGenerationError(429))).toBe(
      'AI usage limit reached — try again later',
    );
    expect(getAiDraftFailureMessage(new DraftGenerationError(503))).toBe(
      'AI features are temporarily disabled',
    );
  });
});
