import { describe, expect, it } from '../../../../../packages/data/node_modules/vitest';

import { PitchDraftSchema, type PitchDraft, type PitchReview } from '../../services/types';
import { preparePitchReview } from './preparePitchReview';

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
        async () => {
          throw new Error('temporary generation failure');
        },
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
      async () => {
        events.push('generation awaited');
        return { kind: 'generated' };
      },
    );

    expect(events).toEqual(['draft prepared', 'generation awaited', 'review loaded']);
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
      async () => ({ kind: 'not_configured' }),
    );

    expect(savedReview).toEqual(
      expect.objectContaining({ headline: '', body: '', generationMode: 'manual' }),
    );
  });
});
