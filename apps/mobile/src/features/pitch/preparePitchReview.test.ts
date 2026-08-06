import { describe, expect, it, vi } from 'vitest';

vi.mock('../../services/supabaseClient', () => ({ getSupabaseClient: () => null }));

import { AiConsentPersistenceError, AiConsentRequiredError } from '../../services/aiConsent';
import { DraftGenerationError } from '../../services/draftGeneration';
import { PitchDraftSchema, type PitchDraft, type PitchReview } from '../../services/types';
import {
  getAiDraftFailureMessage,
  isAiConsentRequiredFailure,
  ManualRecapRequiredError,
  preparePitchReview,
  type PitchReviewPreparationDependencies,
} from './preparePitchReview';

const SERVER_DRAFT_ID = '10000000-0000-4000-8000-000000000001';

function draftWithServer(): PitchDraft {
  return PitchDraftSchema.parse({
    id: 'qa-flow',
    status: 'draft',
    contextRole: 'INTRODUCER',
    relationship: null,
    photos: [],
    recording: null,
    server: {
      draftId: SERVER_DRAFT_ID,
      consentRequestId: null,
      consentToken: null,
    },
    createdAt: '2026-07-13T00:00:00.000Z',
    updatedAt: '2026-07-13T00:00:00.000Z',
  });
}

function draftWithServerRecording(caption: string): PitchDraft {
  return PitchDraftSchema.parse({
    ...draftWithServer(),
    recording: { uri: 'file:///voice.m4a', durationMillis: 32_000, caption },
  });
}

function localOnlyDraft(): PitchDraft {
  return PitchDraftSchema.parse({
    id: 'local-only',
    status: 'draft',
    contextRole: 'INTRODUCER',
    relationship: null,
    photos: [],
    recording: null,
    server: null,
    createdAt: '2026-07-13T00:00:00.000Z',
    updatedAt: '2026-07-13T00:00:00.000Z',
  });
}

type ReviewService = Parameters<typeof preparePitchReview>[0];

function serviceFor(draft: PitchDraft, overrides: Partial<ReviewService> = {}): ReviewService {
  return {
    prepareForReview: async () => draft,
    uploadDraftMedia: async () => draft,
    loadGeneratedReview: async () => draft,
    saveReview: async (_id, review) => ({ ...draft, review }),
    ...overrides,
  };
}

function dependencies(
  overrides: Partial<PitchReviewPreparationDependencies> = {},
): PitchReviewPreparationDependencies {
  return {
    generateDraft: async () => ({ kind: 'generated' }),
    getDisclosureRevision: async () => '2026-07-13.v1',
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
        serviceFor(draft),
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

  it('records AI consent before any media leaves for the external provider', async () => {
    const events: string[] = [];
    const draft = draftWithServer();
    const result = await preparePitchReview(
      serviceFor(draft, {
        prepareForReview: async () => {
          events.push('draft prepared');
          return draft;
        },
        uploadDraftMedia: async () => {
          events.push('media uploaded and validated');
          return draft;
        },
        loadGeneratedReview: async () => {
          events.push('review loaded');
          return draft;
        },
      }),
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
      'media uploaded and validated',
      'generation awaited',
      'review loaded',
    ]);
    expect(events.indexOf('consent recorded')).toBeLessThan(
      events.indexOf('media uploaded and validated'),
    );
    expect(result.id).toBe(draft.id);
  });

  it('records consent against the revision the server reports as current', async () => {
    const draft = draftWithServer();
    const recordAiConsent = vi.fn().mockResolvedValue(undefined);

    await preparePitchReview(
      serviceFor(draft),
      draft.id,
      'affirm_ai_consent',
      dependencies({ getDisclosureRevision: async () => 'server-revision-9', recordAiConsent }),
    );

    expect(recordAiConsent).toHaveBeenCalledWith(SERVER_DRAFT_ID, 'server-revision-9');
  });

  it('checks existing consent against the revision the server reports as current', async () => {
    const draft = draftWithServer();
    const hasAiConsent = vi.fn().mockResolvedValue(true);

    await preparePitchReview(
      serviceFor(draft),
      draft.id,
      'use_existing_ai_consent',
      dependencies({ getDisclosureRevision: async () => 'server-revision-9', hasAiConsent }),
    );

    expect(hasAiConsent).toHaveBeenCalledWith(SERVER_DRAFT_ID, 'server-revision-9');
  });

  it('fails the AI path closed and uploads nothing when the server revision is unavailable', async () => {
    const draft = draftWithServer();
    const uploadDraftMedia = vi.fn(async () => draft);
    const recordAiConsent = vi.fn().mockResolvedValue(undefined);
    const generateDraft = vi.fn().mockResolvedValue({ kind: 'generated' as const });

    await expect(
      preparePitchReview(
        serviceFor(draft, { uploadDraftMedia }),
        draft.id,
        'affirm_ai_consent',
        dependencies({
          generateDraft,
          recordAiConsent,
          getDisclosureRevision: async () => {
            throw new AiConsentPersistenceError('revision');
          },
        }),
      ),
    ).rejects.toBeInstanceOf(AiConsentPersistenceError);

    expect(uploadDraftMedia).not.toHaveBeenCalled();
    expect(recordAiConsent).not.toHaveBeenCalled();
    expect(generateDraft).not.toHaveBeenCalled();
  });

  it('stores an empty manual review instead of mock content after a 501 result', async () => {
    const draft = draftWithServer();
    let savedReview: PitchReview | null = null;
    await preparePitchReview(
      serviceFor(draft, {
        saveReview: async (_id, review) => {
          savedReview = review;
          return { ...draft, review };
        },
      }),
      draft.id,
      'affirm_ai_consent',
      dependencies({ generateDraft: async () => ({ kind: 'not_configured' }) }),
    );

    expect(savedReview).toEqual(
      expect.objectContaining({ headline: '', body: '', generationMode: 'manual' }),
    );
  });

  it('does not upload media or call transcribe when recording affirmative consent fails', async () => {
    const draft = draftWithServer();
    const uploadDraftMedia = vi.fn(async () => draft);
    const generateDraft = vi.fn().mockResolvedValue({ kind: 'generated' });

    await expect(
      preparePitchReview(
        serviceFor(draft, { uploadDraftMedia }),
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
    expect(uploadDraftMedia).not.toHaveBeenCalled();
    expect(generateDraft).not.toHaveBeenCalled();
  });

  it('uses existing current-revision consent without recording it again', async () => {
    const draft = draftWithServer();
    const recordAiConsent = vi.fn().mockResolvedValue(undefined);
    const generateDraft = vi.fn().mockResolvedValue({ kind: 'generated' });

    await preparePitchReview(
      serviceFor(draft),
      draft.id,
      'use_existing_ai_consent',
      dependencies({ generateDraft, recordAiConsent }),
    );

    expect(recordAiConsent).not.toHaveBeenCalled();
    expect(generateDraft).toHaveBeenCalledOnce();
  });

  it('requires disclosure again when current-revision consent is absent', async () => {
    const draft = draftWithServer();
    const uploadDraftMedia = vi.fn(async () => draft);
    const generateDraft = vi.fn().mockResolvedValue({ kind: 'generated' });

    await expect(
      preparePitchReview(
        serviceFor(draft, { uploadDraftMedia }),
        draft.id,
        'use_existing_ai_consent',
        dependencies({ generateDraft, hasAiConsent: async () => false }),
      ),
    ).rejects.toBeInstanceOf(AiConsentRequiredError);
    expect(uploadDraftMedia).not.toHaveBeenCalled();
    expect(generateDraft).not.toHaveBeenCalled();
  });

  it('maps the authoritative 409 response back to the disclosure', () => {
    expect(isAiConsentRequiredFailure(new DraftGenerationError(409))).toBe(true);
    expect(isAiConsentRequiredFailure(new DraftGenerationError(429))).toBe(false);
  });

  it('keeps manual writing free of consent and AI, yet still stores the media', async () => {
    const draft = draftWithServerRecording('A real recap story about Jordan.');
    const uploadDraftMedia = vi.fn(async () => draft);
    const recordAiConsent = vi.fn().mockResolvedValue(undefined);
    const generateDraft = vi.fn().mockResolvedValue({ kind: 'generated' });
    const getDisclosureRevision = vi.fn().mockResolvedValue('2026-07-13.v1');

    const result = await preparePitchReview(
      serviceFor(draft, { uploadDraftMedia }),
      draft.id,
      'write_manually',
      dependencies({ generateDraft, recordAiConsent, getDisclosureRevision }),
    );

    expect(result.review.generationMode).toBe('manual');
    expect(uploadDraftMedia).toHaveBeenCalledOnce();
    expect(recordAiConsent).not.toHaveBeenCalled();
    expect(generateDraft).not.toHaveBeenCalled();
    expect(getDisclosureRevision).not.toHaveBeenCalled();
  });

  it('lets the AI path proceed without a text recap (CP-8)', async () => {
    const draft = draftWithServerRecording('');
    const uploadDraftMedia = vi.fn(async () => draft);
    const generateDraft = vi.fn().mockResolvedValue({ kind: 'generated' });

    await preparePitchReview(
      serviceFor(draft, { uploadDraftMedia }),
      draft.id,
      'affirm_ai_consent',
      dependencies({ generateDraft }),
    );

    expect(uploadDraftMedia).toHaveBeenCalledOnce();
    expect(generateDraft).toHaveBeenCalledOnce();
  });

  it('blocks the manual path when there is no text recap, uploading nothing (CP-8)', async () => {
    const draft = draftWithServerRecording('   ');
    const uploadDraftMedia = vi.fn(async () => draft);
    const generateDraft = vi.fn().mockResolvedValue({ kind: 'generated' });

    await expect(
      preparePitchReview(
        serviceFor(draft, { uploadDraftMedia }),
        draft.id,
        'write_manually',
        dependencies({ generateDraft }),
      ),
    ).rejects.toBeInstanceOf(ManualRecapRequiredError);
    expect(uploadDraftMedia).not.toHaveBeenCalled();
    expect(generateDraft).not.toHaveBeenCalled();
  });

  it('never uploads or contacts AI for a local-only draft', async () => {
    const draft = localOnlyDraft();
    const uploadDraftMedia = vi.fn(async () => draft);
    const recordAiConsent = vi.fn().mockResolvedValue(undefined);
    const generateDraft = vi.fn().mockResolvedValue({ kind: 'generated' });

    const result = await preparePitchReview(
      serviceFor(draft, { uploadDraftMedia }),
      draft.id,
      'affirm_ai_consent',
      dependencies({ generateDraft, recordAiConsent }),
    );

    expect(result.review.generationMode).toBe('manual');
    expect(uploadDraftMedia).not.toHaveBeenCalled();
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

  it('carries the error class and frame for an unrecognised failure', () => {
    // T015 defect 2: the device-only "rest" crash reaches this branch and a
    // released build shows nothing but the message, which does not say whether
    // the throw came from app code or from a library call.
    const error = new TypeError("undefined is not an object (evaluating 'e.rest')");
    error.stack =
      "TypeError: undefined is not an object (evaluating 'e.rest')\n    at from (http://10.0.0.2:8081/index.bundle?platform=ios&dev=true:98765:12)";

    const message = getAiDraftFailureMessage(error);

    expect(message).toContain("evaluating 'e.rest'");
    expect(message).toContain('TypeError');
    expect(message).toContain('from@index.bundle:98765:12');
  });
});
