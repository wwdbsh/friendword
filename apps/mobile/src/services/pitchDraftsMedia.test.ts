import { describe, expect, it, vi } from 'vitest';
import { DataLayerError } from '@friendword/data';
import type {
  ConsentSubmission,
  PitchAssetRow,
  PitchDraftRow,
  SignedAssetUpload,
} from '@friendword/data';

import { requestMediaValidation, type MediaValidationOutcome } from './mediaValidation';
import { MockPitchDraftService, type PitchDraftStorage } from './pitchDrafts';
import {
  HybridPitchDraftService,
  ManualPitchNeedsAiReviewError,
  MEDIA_VALIDATION_INCOMPLETE_MESSAGE,
} from './pitchDraftsSupabase';
import { EMPTY_PITCH_STRUCTURE } from './types';
import type { PitchDraft, PitchDraftId, PitchPhoto } from './types';

const SERVER_DRAFT_ID = '10000000-0000-4000-8000-000000000001';
const SERVER_ROW: PitchDraftRow = {
  id: SERVER_DRAFT_ID,
  created_by_user_id: '00000000-0000-4000-8000-000000000001',
  subject_user_id: null,
  status: 'draft',
  headline: 'Jordan makes ordinary days memorable',
  body: 'Jordan is thoughtful, curious, and always ready with a good story.',
  structure: EMPTY_PITCH_STRUCTURE,
  transcript: null,
  audience_policy: null,
  location_precision: null,
  publish_days: null,
  relationship_type: 'friend',
  relationship_duration: 'y3to10',
  created_at: '2026-07-29T00:00:00.000Z',
  updated_at: '2026-07-29T00:00:00.000Z',
};
const JPEG_PHOTO: PitchPhoto = {
  uri: 'file:///one.jpg',
  width: 100,
  height: 100,
  mimeType: 'image/jpeg',
};

type PutRecord = { readonly url: string; readonly contentType: string | undefined };

type Harness = {
  readonly local: MockPitchDraftService;
  readonly id: PitchDraftId;
  readonly service: HybridPitchDraftService;
  readonly uploads: readonly string[];
  readonly registrations: ReadonlyArray<{ readonly kind: string; readonly fileName: string }>;
  readonly puts: readonly PutRecord[];
  readonly validated: readonly string[];
  currentDraft(): Promise<PitchDraft>;
};

function createLocalService(): MockPitchDraftService {
  const values = new Map<string, string>();
  const storage: PitchDraftStorage = {
    getItem: async (key) => values.get(key) ?? null,
    setItem: async (key, value) => {
      values.set(key, value);
    },
  };
  return new MockPitchDraftService(storage);
}

/**
 * Replaces the global fetch for the whole file: `putLocalFile` falls back to
 * fetch + blob outside the native runtime, so both the local file read and the
 * signed upload PUT go through here. `putStatus` is indexed by PUT order.
 */
function installFetchMock(putStatus: (attempt: number) => number): PutRecord[] {
  const puts: PutRecord[] = [];
  const mock = vi.fn(
    async (
      input: unknown,
      init?: { method?: string; headers?: Record<string, string> },
    ): Promise<Response> => {
      if (init?.method !== 'PUT') {
        return new Response('', { status: 200 });
      }
      const status = putStatus(puts.length);
      puts.push({ url: String(input), contentType: init.headers?.['Content-Type'] });
      return new Response('', { status });
    },
  );
  globalThis.fetch = mock as unknown as typeof fetch;
  return puts;
}

async function createHarness(options: {
  readonly photos: readonly PitchPhoto[];
  readonly validate: (objectName: string) => Promise<MediaValidationOutcome>;
  readonly putStatus?: (attempt: number) => number;
  readonly submitForConsent?: (draftId: string) => Promise<ConsentSubmission>;
}): Promise<Harness> {
  const puts = installFetchMock(options.putStatus ?? (() => 200));
  const uploads: string[] = [];
  const registrations: Array<{ kind: string; fileName: string }> = [];
  const validated: string[] = [];
  const local = createLocalService();
  const draft = await local.createDraft();
  await local.saveRelationship(draft.id, {
    kind: 'Friend',
    duration: '3–10 years',
    friendFirstName: 'Jordan',
    contact: { kind: 'email', value: 'friend@example.com' },
  });
  await local.savePhotos(draft.id, options.photos);
  await local.saveRecording(draft.id, {
    uri: 'file:///voice.m4a',
    durationMillis: 30_000,
    caption: 'A real story about Jordan.',
  });
  await local.attachServerDraft(draft.id, SERVER_DRAFT_ID);
  const unexpected = async (): Promise<never> => {
    throw new Error('Unexpected repository method');
  };
  const service = new HybridPitchDraftService(
    null,
    local,
    {
      createDraft: unexpected,
      getDraft: unexpected,
      listMyConsentRequests: unexpected,
      listMyDrafts: unexpected,
      submitForConsent: options.submitForConsent ?? unexpected,
      updateDraft: async (): Promise<PitchDraftRow> => SERVER_ROW,
      requestAssetUpload: async (draftId, fileName): Promise<SignedAssetUpload> => {
        uploads.push(fileName);
        return {
          storagePath: `pitch-media/${draftId}/${fileName}`,
          signedUrl: `https://storage.test/upload/${fileName}`,
          token: 'signed-token',
        };
      },
      registerAsset: async (draftId, kind, fileName, sortOrder): Promise<PitchAssetRow> => {
        registrations.push({ kind, fileName });
        return {
          id: `asset-${fileName}`,
          pitch_draft_id: draftId,
          uploaded_by_user_id: '00000000-0000-4000-8000-000000000001',
          asset_type: kind,
          storage_path: `pitch-media/${draftId}/${fileName}`,
          sort_order: sortOrder ?? 0,
          created_at: '2026-07-29T00:00:00.000Z',
          updated_at: '2026-07-29T00:00:00.000Z',
        };
      },
    },
    8_000,
    async (objectName) => {
      validated.push(objectName);
      return options.validate(objectName);
    },
  );
  return {
    local,
    id: draft.id,
    service,
    uploads,
    registrations,
    puts,
    validated,
    currentDraft: async (): Promise<PitchDraft> => {
      const drafts = await local.getMyDrafts();
      const current = drafts.find((candidate) => candidate.id === draft.id);
      if (current === undefined) {
        throw new Error('Expected the draft to still exist');
      }
      return current;
    },
  };
}

const alwaysPassed = async (): Promise<MediaValidationOutcome> => 'passed';

describe('pitch draft media upload', () => {
  it('uploads a PNG under its own name and content type', async () => {
    const harness = await createHarness({
      photos: [{ uri: 'file:///shot.png', width: 10, height: 10, mimeType: 'image/png' }],
      validate: alwaysPassed,
    });

    await harness.service.uploadDraftMedia(harness.id);

    expect(harness.uploads).toEqual(['voice.m4a', 'photo-1.png']);
    expect(harness.registrations).toEqual([
      { kind: 'voice', fileName: 'voice.m4a' },
      { kind: 'photo', fileName: 'photo-1.png' },
    ]);
    expect(harness.puts.map((put) => put.contentType)).toEqual(['audio/mp4', 'image/png']);
    expect(harness.validated).toEqual([
      `${SERVER_DRAFT_ID}/voice.m4a`,
      `${SERVER_DRAFT_ID}/photo-1.png`,
    ]);
  });

  it('falls back to the file extension for photos saved before mimeType was tracked', async () => {
    const harness = await createHarness({
      photos: [{ uri: 'file:///legacy-shot.webp', width: 10, height: 10 }],
      validate: alwaysPassed,
    });

    await harness.service.uploadDraftMedia(harness.id);

    expect(harness.uploads).toEqual(['voice.m4a', 'photo-1.webp']);
    expect(harness.puts.map((put) => put.contentType)).toEqual(['audio/mp4', 'image/webp']);
  });

  it('does not mark media validated when the validation call fails, and runs it again', async () => {
    const harness = await createHarness({
      photos: [JPEG_PHOTO],
      // The real client mapping for a server error: never a pass, never a
      // rejection the introducer could act on.
      validate: (objectName) =>
        requestMediaValidation(objectName, {
          accessToken: 'token',
          origin: 'https://friendword.test',
          send: async () => new Response(JSON.stringify({ error: 'boom' }), { status: 500 }),
        }),
    });

    await harness.service.uploadDraftMedia(harness.id);
    const afterFailure = await harness.currentDraft();

    expect(afterFailure.recording?.upload?.validated).toBe(false);
    expect(afterFailure.photos[0]?.upload?.validated).toBe(false);
    // The bytes are on the server, which is what the post-publish local purge
    // keys off — but validation is not done, so it must not be latched as done.
    expect(afterFailure.server?.mediaUploaded).toBe(true);

    await harness.service.uploadDraftMedia(harness.id);

    expect(harness.uploads).toEqual(['voice.m4a', 'photo-1.jpg']);
    expect(harness.registrations).toHaveLength(2);
    expect(harness.validated).toEqual([
      `${SERVER_DRAFT_ID}/voice.m4a`,
      `${SERVER_DRAFT_ID}/photo-1.jpg`,
      `${SERVER_DRAFT_ID}/voice.m4a`,
      `${SERVER_DRAFT_ID}/photo-1.jpg`,
    ]);
  });

  it('stops re-validating once every asset has passed', async () => {
    const harness = await createHarness({ photos: [JPEG_PHOTO], validate: alwaysPassed });

    await harness.service.uploadDraftMedia(harness.id);
    const validatedOnce = [...harness.validated];
    await harness.service.uploadDraftMedia(harness.id);
    const draft = await harness.currentDraft();

    expect(harness.validated).toEqual(validatedOnce);
    expect(draft.photos[0]?.upload).toEqual({
      objectName: 'photo-1.jpg',
      registered: true,
      validated: true,
    });
  });

  it('resumes a retry after a mid-sequence upload failure', async () => {
    // PUT #1 is the voice track, #2 is the photo and fails; the retry's PUT
    // (#3) succeeds.
    const harness = await createHarness({
      photos: [JPEG_PHOTO],
      validate: alwaysPassed,
      putStatus: (attempt) => (attempt === 1 ? 500 : 200),
    });

    await expect(harness.service.uploadDraftMedia(harness.id)).rejects.toThrow(
      'Upload of Photo 1 failed (500).',
    );
    expect(harness.registrations).toEqual([{ kind: 'voice', fileName: 'voice.m4a' }]);

    await harness.service.uploadDraftMedia(harness.id);

    expect(harness.uploads).toEqual(['voice.m4a', 'photo-1.jpg', 'photo-1.jpg']);
    expect(harness.registrations).toEqual([
      { kind: 'voice', fileName: 'voice.m4a' },
      { kind: 'photo', fileName: 'photo-1.jpg' },
    ]);
    expect(harness.validated).toEqual([
      `${SERVER_DRAFT_ID}/voice.m4a`,
      `${SERVER_DRAFT_ID}/photo-1.jpg`,
    ]);
  });

  it('treats an already-stored object as uploaded instead of failing the retry', async () => {
    const harness = await createHarness({
      photos: [JPEG_PHOTO],
      validate: alwaysPassed,
      putStatus: (attempt) => (attempt === 1 ? 409 : 200),
    });

    await harness.service.uploadDraftMedia(harness.id);
    const draft = await harness.currentDraft();

    expect(draft.photos[0]?.upload?.validated).toBe(true);
    expect(harness.registrations).toHaveLength(2);
  });

  it('refuses a rejected asset without marking it validated', async () => {
    const harness = await createHarness({
      photos: [JPEG_PHOTO],
      validate: async (objectName) => (objectName.endsWith('.jpg') ? 'rejected' : 'passed'),
    });

    await expect(harness.service.uploadDraftMedia(harness.id)).rejects.toThrow(
      'Photo 1 is not a file we can publish.',
    );
    const draft = await harness.currentDraft();

    expect(draft.photos[0]?.upload?.validated).toBe(false);
    expect(draft.recording?.upload?.validated).toBe(true);
  });

  it('re-runs validation on submit and sends once every asset passes', async () => {
    let reachable = false;
    const harness = await createHarness({
      photos: [JPEG_PHOTO],
      validate: async () => (reachable ? 'passed' : 'unavailable'),
      submitForConsent: async () => ({
        consentRequestId: '30000000-0000-4000-8000-000000000001',
        consentToken: 'a'.repeat(32),
      }),
    });
    await harness.service.uploadDraftMedia(harness.id);
    expect((await harness.currentDraft()).photos[0]?.upload?.validated).toBe(false);

    reachable = true;
    const finalized = await harness.service.finalizeConsent(harness.id);

    expect(finalized.status).toBe('consent_pending');
    expect((await harness.currentDraft()).photos[0]?.upload?.validated).toBe(true);
    // Only the verdict was missing, so nothing was uploaded a second time.
    expect(harness.uploads).toEqual(['voice.m4a', 'photo-1.jpg']);
  });

  it('tells an AI-reviewed pitch the truth when the server gate refuses it', async () => {
    const gateError = new DataLayerError('pitchDraft.submitForConsent', {
      message: 'pitch media requires completed validation',
      code: 'P0001',
    });
    const harness = await createHarness({
      photos: [JPEG_PHOTO],
      validate: async () => 'unavailable',
      submitForConsent: async () => {
        throw gateError;
      },
    });
    await harness.service.uploadDraftMedia(harness.id);
    await harness.local.saveReview(harness.id, {
      headline: SERVER_ROW.headline ?? '',
      body: SERVER_ROW.body ?? '',
      structure: EMPTY_PITCH_STRUCTURE,
      generationMode: 'generated',
      responseNote: null,
    });

    const failure = harness.service.finalizeConsent(harness.id);

    await expect(failure).rejects.toThrow(MEDIA_VALIDATION_INCOMPLETE_MESSAGE);
    await expect(failure).rejects.not.toBeInstanceOf(ManualPitchNeedsAiReviewError);
  });

  it('re-validates a draft uploaded before per-asset records without re-uploading', async () => {
    const harness = await createHarness({
      photos: [{ uri: 'file:///shot.png', width: 10, height: 10, mimeType: 'image/png' }],
      validate: alwaysPassed,
    });
    // A draft persisted by the previous build: the flag is set, no asset
    // carries a record, and its objects use the old always-.jpg names.
    await harness.local.markDraftMediaUploaded(harness.id);

    await harness.service.uploadDraftMedia(harness.id);

    expect(harness.uploads).toEqual([]);
    expect(harness.registrations).toEqual([]);
    expect(harness.validated).toEqual([
      `${SERVER_DRAFT_ID}/voice.m4a`,
      `${SERVER_DRAFT_ID}/photo-1.jpg`,
    ]);
  });
});
