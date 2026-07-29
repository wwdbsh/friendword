import { describe, expect, it, vi } from 'vitest';
import { DataLayerError } from '@friendword/data';
import type {
  BrowserSupabaseClient,
  ConsentSubmission,
  PitchAssetRow,
  PitchDraftRow,
  SignedAssetUpload,
} from '@friendword/data';

import type { AssetDimensions } from '@friendword/data';
import type { PitchSceneSegment, PitchSceneV1 } from '@friendword/contracts';

import { requestMediaValidation, type MediaValidationOutcome } from './mediaValidation';
import type { PitchSceneBuilder } from './pitchSceneInput';

import {
  MockPitchDraftService,
  STORED_VOICE_REPLACEMENT_MESSAGE,
  StoredVoiceReplacementError,
  type PitchDraftStorage,
} from './pitchDrafts';
import {
  HybridPitchDraftService,
  ManualPitchNeedsAiReviewError,
  MEDIA_VALIDATION_INCOMPLETE_MESSAGE,
  STALE_PITCH_ASSETS_MESSAGE,
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
const INTRODUCER_ID = '00000000-0000-4000-8000-000000000001';
const DATER_ID = '00000000-0000-4000-8000-0000000000d1';

/**
 * Only `auth.getSession` is reached: the service uses the client for the signed
 * -in user id and goes through the injected repo for everything else.
 */
const SESSION_CLIENT = {
  auth: {
    getSession: async () => ({ data: { session: { user: { id: INTRODUCER_ID } } }, error: null }),
  },
} as unknown as BrowserSupabaseClient;

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
  readonly registrations: ReadonlyArray<{
    readonly kind: string;
    readonly fileName: string;
    readonly dimensions: AssetDimensions | undefined;
  }>;
  /** The scene each submit carried, so a test can see what the dater would get. */
  readonly submittedScenes: ReadonlyArray<PitchSceneV1 | null | undefined>;
  /** What the scene builder was asked to build from, in call order. */
  readonly sceneInputs: ReadonlyArray<{
    readonly photoAssetIds: readonly string[];
    readonly segments: readonly PitchSceneSegment[];
  }>;
  readonly puts: readonly PutRecord[];
  readonly validated: readonly string[];
  /** The raw persisted drafts, so a test can stage what an older build wrote. */
  readonly values: Map<string, string>;
  /** The pitch_assets rows the server holds — what a submit would snapshot. */
  readonly assetRows: PitchAssetRow[];
  /** Asset ids detached through remove_pitch_draft_asset, in order. */
  readonly removedAssets: readonly string[];
  currentDraft(): Promise<PitchDraft>;
};

function createLocalService(values: Map<string, string>): MockPitchDraftService {
  const storage: PitchDraftStorage = {
    getItem: async (key) => values.get(key) ?? null,
    setItem: async (key, value) => {
      values.set(key, value);
    },
  };
  return new MockPitchDraftService(storage);
}

/** The object name the draft records for one of its photos, once uploaded. */
async function storedPhotoObject(harness: Harness, index: number): Promise<string> {
  const draft = await harness.currentDraft();
  const objectName = draft.photos[index]?.upload?.objectName;
  if (objectName === undefined) {
    throw new Error(`Photo ${index} has no upload record`);
  }
  return objectName;
}

/**
 * Rewrites the persisted drafts as a build without photo identities wrote them.
 * Nothing in the app can produce this state any more — a save assigns an
 * identity — but drafts saved on a device before the change still carry it.
 */
function stripPhotoIdentities(harness: Harness): void {
  for (const [key, value] of harness.values) {
    harness.values.set(
      key,
      JSON.stringify(
        (JSON.parse(value) as ReadonlyArray<Record<string, unknown>>).map((draft) => ({
          ...draft,
          photos: (draft.photos as ReadonlyArray<Record<string, unknown>>).map((photo) =>
            Object.fromEntries(Object.entries(photo).filter(([field]) => field !== 'assetKey')),
          ),
        })),
      ),
    );
  }
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
  /** Makes every remove_pitch_draft_asset call fail, as an offline device would. */
  readonly removeAssetFails?: boolean;
  /** What `pitch_drafts.transcript` holds when the submit reads the saved row. */
  readonly serverTranscript?: unknown;
  /** Stands in for the contracts builder, whose own timing rules are tested there. */
  readonly buildScene?: PitchSceneBuilder;
}): Promise<Harness> {
  const puts = installFetchMock(options.putStatus ?? (() => 200));
  const uploads: string[] = [];
  const registrations: Array<{
    kind: string;
    fileName: string;
    dimensions: AssetDimensions | undefined;
  }> = [];
  const submittedScenes: Array<PitchSceneV1 | null | undefined> = [];
  const sceneInputs: Array<{
    photoAssetIds: readonly string[];
    segments: readonly PitchSceneSegment[];
  }> = [];
  const assetRows: PitchAssetRow[] = [];
  const removedAssets: string[] = [];
  const validated: string[] = [];
  const values = new Map<string, string>();
  const local = createLocalService(values);
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
    SESSION_CLIENT,
    local,
    {
      createDraft: unexpected,
      getDraft: unexpected,
      listAssets: async (): Promise<readonly PitchAssetRow[]> => [...assetRows],
      // Models 0046: photos the caller uploaded, on a still-editable draft.
      removeAsset: async (assetId): Promise<void> => {
        if (options.removeAssetFails === true) {
          throw new DataLayerError('pitchDraft.removeAsset', new Error('network request failed'));
        }
        const position = assetRows.findIndex((row) => row.id === assetId);
        const row = assetRows[position];
        if (row === undefined) {
          throw new DataLayerError(
            'pitchDraft.removeAsset',
            new Error('pitch asset not found or not yours to remove'),
          );
        }
        if (row.asset_type !== 'photo') {
          throw new DataLayerError(
            'pitchDraft.removeAsset',
            new Error('the introducer voice recording cannot be removed'),
          );
        }
        removedAssets.push(assetId);
        assetRows.splice(position, 1);
      },
      listMyConsentRequests: unexpected,
      listMyDrafts: unexpected,
      submitForConsent: async (draftId, _invitation, scene): Promise<ConsentSubmission> => {
        submittedScenes.push(scene);
        return (options.submitForConsent ?? unexpected)(draftId);
      },
      updateDraft: async (): Promise<PitchDraftRow> =>
        options.serverTranscript === undefined
          ? SERVER_ROW
          : { ...SERVER_ROW, transcript: options.serverTranscript as PitchDraftRow['transcript'] },
      requestAssetUpload: async (draftId, fileName): Promise<SignedAssetUpload> => {
        uploads.push(fileName);
        return {
          storagePath: `pitch-media/${draftId}/${fileName}`,
          signedUrl: `https://storage.test/upload/${fileName}`,
          token: 'signed-token',
        };
      },
      registerAsset: async (
        draftId,
        kind,
        fileName,
        sortOrder,
        dimensions,
      ): Promise<PitchAssetRow> => {
        registrations.push({ kind, fileName, dimensions });
        const row: PitchAssetRow = {
          id: `asset-${fileName}`,
          pitch_draft_id: draftId,
          uploaded_by_user_id: INTRODUCER_ID,
          asset_type: kind,
          storage_path: `pitch-media/${draftId}/${fileName}`,
          sort_order: sortOrder ?? 0,
          created_at: '2026-07-29T00:00:00.000Z',
          updated_at: '2026-07-29T00:00:00.000Z',
        };
        assetRows.push(row);
        return row;
      },
    },
    8_000,
    async (objectName) => {
      validated.push(objectName);
      return options.validate(objectName);
    },
    (input) => {
      sceneInputs.push({ photoAssetIds: input.photoAssetIds, segments: input.segments });
      return (options.buildScene ?? (() => null))(input);
    },
  );
  return {
    local,
    id: draft.id,
    service,
    uploads,
    registrations,
    submittedScenes,
    sceneInputs,
    puts,
    validated,
    values,
    assetRows,
    removedAssets,
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
    const photoObject = await storedPhotoObject(harness, 0);

    expect(photoObject).toMatch(/^photo-[a-z0-9]+\.png$/);
    expect(harness.uploads).toEqual(['voice.m4a', photoObject]);
    expect(harness.puts.map((put) => put.contentType)).toEqual(['audio/mp4', 'image/png']);
    expect(harness.validated).toEqual([
      `${SERVER_DRAFT_ID}/voice.m4a`,
      `${SERVER_DRAFT_ID}/${photoObject}`,
    ]);
  });

  it('falls back to the file extension for photos saved before mimeType was tracked', async () => {
    const harness = await createHarness({
      photos: [{ uri: 'file:///legacy-shot.webp', width: 10, height: 10 }],
      validate: alwaysPassed,
    });

    await harness.service.uploadDraftMedia(harness.id);

    expect(harness.uploads[1]).toMatch(/^photo-[a-z0-9]+\.webp$/);
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
    const photoObject = await storedPhotoObject(harness, 0);

    expect(harness.uploads).toEqual(['voice.m4a', photoObject]);
    expect(harness.validated).toEqual([
      `${SERVER_DRAFT_ID}/voice.m4a`,
      `${SERVER_DRAFT_ID}/${photoObject}`,
      `${SERVER_DRAFT_ID}/voice.m4a`,
      `${SERVER_DRAFT_ID}/${photoObject}`,
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
      objectName: await storedPhotoObject(harness, 0),
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

    await harness.service.uploadDraftMedia(harness.id);
    const photoObject = await storedPhotoObject(harness, 0);

    expect(harness.uploads).toEqual(['voice.m4a', photoObject, photoObject]);
    expect(harness.validated).toEqual([
      `${SERVER_DRAFT_ID}/voice.m4a`,
      `${SERVER_DRAFT_ID}/${photoObject}`,
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
    expect(harness.uploads).toEqual(['voice.m4a', await storedPhotoObject(harness, 0)]);
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
    // carries a record or an identity, and its objects use the old
    // always-.jpg names.
    await harness.local.markDraftMediaUploaded(harness.id);
    stripPhotoIdentities(harness);

    await harness.service.uploadDraftMedia(harness.id);

    expect(harness.uploads).toEqual([]);
    expect(harness.registrations).toEqual([]);
    expect(harness.validated).toEqual([
      `${SERVER_DRAFT_ID}/voice.m4a`,
      `${SERVER_DRAFT_ID}/photo-1.jpg`,
    ]);
  });
});

const CONSENT_SUBMISSION = async (): Promise<ConsentSubmission> => ({
  consentRequestId: '30000000-0000-4000-8000-000000000001',
  consentToken: 'a'.repeat(32),
});

const PHOTO_A: PitchPhoto = { uri: 'file:///a.jpg', width: 10, height: 10, mimeType: 'image/jpeg' };
const PHOTO_B: PitchPhoto = { uri: 'file:///b.jpg', width: 10, height: 10, mimeType: 'image/jpeg' };
const PHOTO_C: PitchPhoto = { uri: 'file:///c.jpg', width: 10, height: 10, mimeType: 'image/jpeg' };

describe('removing a photo from a draft', () => {
  it('registers each object as its bytes land, before the pitch is sent', async () => {
    const harness = await createHarness({
      photos: [PHOTO_A],
      validate: alwaysPassed,
      submitForConsent: CONSENT_SUBMISSION,
    });

    await harness.service.uploadDraftMedia(harness.id);

    // A pitch_assets row is what marks the object as in use. Without one, a
    // draft that is uploaded but not yet sent has neither a row nor a consent
    // revision, and scripts/cleanup-orphan-media.mjs deletes its voice and
    // photos 48h later while the local draft still calls them stored.
    expect(harness.registrations).toEqual([
      // The voice track has no pixels, so it registers without dimensions.
      { kind: 'voice', fileName: 'voice.m4a', dimensions: undefined },
      {
        kind: 'photo',
        fileName: await storedPhotoObject(harness, 0),
        dimensions: { width: PHOTO_A.width, height: PHOTO_A.height },
      },
    ]);
    expect(harness.assetRows.map((row) => row.storage_path)).toEqual([
      `pitch-media/${SERVER_DRAFT_ID}/voice.m4a`,
      `pitch-media/${SERVER_DRAFT_ID}/${await storedPhotoObject(harness, 0)}`,
    ]);
  });

  it('detaches a removed photo before the submit can snapshot it', async () => {
    const harness = await createHarness({
      photos: [PHOTO_A, PHOTO_B],
      validate: alwaysPassed,
      submitForConsent: CONSENT_SUBMISSION,
    });
    await harness.service.uploadDraftMedia(harness.id);
    const removedObject = await storedPhotoObject(harness, 0);

    // The photos screen holds freshly picked values with no upload record, so
    // this is exactly what "Lock the photo picks" saves after a removal.
    await harness.local.savePhotos(harness.id, [PHOTO_B]);
    const finalized = await harness.service.finalizeConsent(harness.id);

    const keptObject = await storedPhotoObject(harness, 0);
    expect(keptObject).not.toBe(removedObject);
    expect(finalized.status).toBe('consent_pending');
    // submit_pitch_for_consent snapshots every pitch_assets row of the draft,
    // so the removed photo's row has to be gone before the submit, not after.
    expect(harness.removedAssets).toEqual([`asset-${removedObject}`]);
    expect(harness.assetRows.map((row) => row.storage_path)).toEqual([
      `pitch-media/${SERVER_DRAFT_ID}/voice.m4a`,
      `pitch-media/${SERVER_DRAFT_ID}/${keptObject}`,
    ]);
    // The kept photo keeps its own object rather than inheriting the removed
    // photo's position — and so its bytes.
    expect(harness.uploads).toEqual(['voice.m4a', removedObject, keptObject]);
  });

  it('refuses the submit when the removed photo cannot be detached', async () => {
    const harness = await createHarness({
      photos: [PHOTO_A, PHOTO_B],
      validate: alwaysPassed,
      submitForConsent: CONSENT_SUBMISSION,
      removeAssetFails: true,
    });
    await harness.service.uploadDraftMedia(harness.id);
    await harness.local.savePhotos(harness.id, [PHOTO_B]);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    // Fails closed: sending a pitch that still carries a photo the introducer
    // took out is the outcome this whole path exists to prevent.
    await expect(harness.service.finalizeConsent(harness.id)).rejects.toThrow(
      STALE_PITCH_ASSETS_MESSAGE,
    );
    expect(harness.assetRows).toHaveLength(3);
    expect((await harness.currentDraft()).status).not.toBe('consent_pending');
  });

  it('sends a pitch whose removed photo was never uploaded', async () => {
    const harness = await createHarness({
      photos: [PHOTO_A, PHOTO_B],
      validate: alwaysPassed,
      submitForConsent: CONSENT_SUBMISSION,
    });
    await harness.local.savePhotos(harness.id, [PHOTO_B]);

    await harness.service.uploadDraftMedia(harness.id);
    const finalized = await harness.service.finalizeConsent(harness.id);

    expect(finalized.status).toBe('consent_pending');
    expect(harness.registrations).toHaveLength(2);
  });

  it('leaves the dater own consent-time photo uploads out of the reconciliation', async () => {
    const harness = await createHarness({
      photos: [PHOTO_A],
      validate: alwaysPassed,
      submitForConsent: CONSENT_SUBMISSION,
    });
    await harness.service.uploadDraftMedia(harness.id);
    // CP-1: the claimed dater may upload replacement photos while the draft is
    // in review (0032:84). Those rows are not the introducer's to reconcile.
    harness.assetRows.push({
      id: 'asset-dater-photo',
      pitch_draft_id: SERVER_DRAFT_ID,
      uploaded_by_user_id: DATER_ID,
      asset_type: 'photo',
      storage_path: `pitch-media/${SERVER_DRAFT_ID}/photo-dater.jpg`,
      sort_order: 5,
      created_at: '2026-07-29T00:00:00.000Z',
      updated_at: '2026-07-29T00:00:00.000Z',
    });

    const finalized = await harness.service.finalizeConsent(harness.id);

    expect(finalized.status).toBe('consent_pending');
  });

  it('gives a photo added after a removal an object of its own', async () => {
    const harness = await createHarness({
      photos: [PHOTO_A, PHOTO_B],
      validate: alwaysPassed,
    });
    await harness.service.uploadDraftMedia(harness.id);
    await harness.local.savePhotos(harness.id, [PHOTO_B]);
    await harness.local.savePhotos(harness.id, [PHOTO_B, PHOTO_C]);

    await harness.service.uploadDraftMedia(harness.id);

    // Four distinct objects: the voice, the removed photo, the kept photo, and
    // the new one. A reused name would be a 409 the upload path reads as
    // "already stored", publishing the earlier photo's bytes in its place.
    expect(new Set(harness.uploads).size).toBe(harness.uploads.length);
    expect(harness.uploads).toHaveLength(4);
    expect(harness.uploads[3]).toBe(await storedPhotoObject(harness, 1));
  });

  it('keeps an already uploaded photo out of a second upload after a save', async () => {
    const harness = await createHarness({ photos: [PHOTO_A], validate: alwaysPassed });
    await harness.service.uploadDraftMedia(harness.id);

    await harness.local.savePhotos(harness.id, [PHOTO_A]);
    await harness.service.uploadDraftMedia(harness.id);

    expect(harness.uploads).toEqual(['voice.m4a', await storedPhotoObject(harness, 0)]);
    expect((await harness.currentDraft()).photos[0]?.upload?.validated).toBe(true);
  });
});

describe('re-recording after the voice is stored', () => {
  const NEW_TAKE = { uri: 'file:///take-2.m4a', durationMillis: 40_000, caption: '' };

  it('refuses to swap in a take the server will never hold', async () => {
    const harness = await createHarness({ photos: [PHOTO_A], validate: alwaysPassed });
    await harness.service.uploadDraftMedia(harness.id);

    const replaced = harness.local.saveRecording(harness.id, NEW_TAKE);

    await expect(replaced).rejects.toBeInstanceOf(StoredVoiceReplacementError);
    await expect(replaced).rejects.toThrow(STORED_VOICE_REPLACEMENT_MESSAGE);
    const draft = await harness.currentDraft();
    expect(draft.recording?.uri).toBe('file:///voice.m4a');
    expect(draft.recording?.upload?.objectName).toBe('voice.m4a');
  });

  it('hands back the take the server holds so the screen can return to it', async () => {
    const harness = await createHarness({ photos: [PHOTO_A], validate: alwaysPassed });
    await harness.service.uploadDraftMedia(harness.id);

    const failure = await harness.local
      .saveRecording(harness.id, NEW_TAKE)
      .then(() => null)
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(StoredVoiceReplacementError);
    expect((failure as StoredVoiceReplacementError).keptRecording.uri).toBe('file:///voice.m4a');
  });

  it('still saves a text recap for the take that was sent', async () => {
    const harness = await createHarness({ photos: [PHOTO_A], validate: alwaysPassed });
    await harness.service.uploadDraftMedia(harness.id);

    const saved = await harness.local.saveRecording(harness.id, {
      uri: 'file:///voice.m4a',
      durationMillis: 30_000,
      caption: 'The night Jordan drove four hours to help me move.',
    });

    expect(saved.recording?.caption).toBe('The night Jordan drove four hours to help me move.');
    // The record has to survive the edit; losing it is what makes the next
    // upload treat the stored object as unknown.
    expect(saved.recording?.upload?.validated).toBe(true);
  });

  it('lets a draft whose voice was never sent record a different take', async () => {
    const harness = await createHarness({ photos: [PHOTO_A], validate: alwaysPassed });

    const saved = await harness.local.saveRecording(harness.id, NEW_TAKE);

    expect(saved.recording?.uri).toBe('file:///take-2.m4a');
  });
});

const STUB_SCENE: PitchSceneV1 = {
  schemaVersion: 1,
  canvas: { width: 1080, height: 1920, fps: 30 },
  durationMs: 4_000,
  scenes: [
    { assetId: '50000000-0000-4000-8000-000000000001', startMs: 0, endMs: 2_000 },
    { assetId: '50000000-0000-4000-8000-000000000002', startMs: 2_000, endMs: 4_000 },
  ],
};

/** A real /api/transcribe snapshot: seconds, with the text the captions use. */
const SERVER_TRANSCRIPT = {
  text: 'Jordan drove four hours. Then he unpacked every box.',
  language: 'en',
  segments: [
    { start: 0, end: 1.84, text: 'Jordan drove four hours.' },
    { start: 1.84, end: 4.002, text: 'Then he unpacked every box.' },
  ],
};

describe('the scene a submit sends for approval', () => {
  it('builds it from the saved transcript and the photo assets the submit will snapshot', async () => {
    const harness = await createHarness({
      photos: [PHOTO_A, PHOTO_B],
      validate: alwaysPassed,
      submitForConsent: CONSENT_SUBMISSION,
      serverTranscript: SERVER_TRANSCRIPT,
      buildScene: () => STUB_SCENE,
    });
    await harness.service.uploadDraftMedia(harness.id);

    const finalized = await harness.service.finalizeConsent(harness.id);

    expect(finalized.status).toBe('consent_pending');
    // Without this the dater who approves without editing gets a published page
    // with no motion at all: nothing else in the flow writes a scene for them.
    expect(harness.submittedScenes).toEqual([STUB_SCENE]);
    expect(harness.sceneInputs).toEqual([
      {
        // Photos only, in sort order — the voice asset is not a scene.
        photoAssetIds: [
          `asset-${await storedPhotoObject(harness, 0)}`,
          `asset-${await storedPhotoObject(harness, 1)}`,
        ],
        // Seconds → integer milliseconds, the same conversion the published
        // player applies to this same snapshot.
        segments: [
          { startMs: 0, endMs: 1_840 },
          { startMs: 1_840, endMs: 4_002 },
        ],
      },
    ]);
  });

  it('sends no scene when the recording was never transcribed', async () => {
    const harness = await createHarness({
      photos: [PHOTO_A],
      validate: alwaysPassed,
      submitForConsent: CONSENT_SUBMISSION,
      buildScene: () => STUB_SCENE,
    });
    await harness.service.uploadDraftMedia(harness.id);

    await harness.service.finalizeConsent(harness.id);

    // A manual (no-AI) pitch has no transcript, so there is no deterministic
    // timeline to approve. NULL is the honest answer; the surfaces fall back.
    expect(harness.submittedScenes).toEqual([null]);
    expect(harness.sceneInputs).toEqual([]);
  });

  it('leaves a photo the introducer removed out of the scene', async () => {
    const harness = await createHarness({
      photos: [PHOTO_A, PHOTO_B],
      validate: alwaysPassed,
      submitForConsent: CONSENT_SUBMISSION,
      serverTranscript: SERVER_TRANSCRIPT,
      buildScene: () => STUB_SCENE,
    });
    await harness.service.uploadDraftMedia(harness.id);
    const removedObject = await storedPhotoObject(harness, 0);
    await harness.local.savePhotos(harness.id, [PHOTO_B]);

    await harness.service.finalizeConsent(harness.id);

    // Approval requires the scene's photo set to equal the revision's photo
    // set, and approving deletes every asset outside that set — so a scene
    // built before the removal was reconciled would be a broken reference.
    const keptObject = await storedPhotoObject(harness, 0);
    expect(harness.sceneInputs[0]?.photoAssetIds).toEqual([`asset-${keptObject}`]);
    expect(keptObject).not.toBe(removedObject);
  });

  it('records the pixel size of each photo it registers, and none for the voice', async () => {
    const harness = await createHarness({
      photos: [{ uri: 'file:///tall.jpg', width: 900, height: 1_600, mimeType: 'image/jpeg' }],
      validate: alwaysPassed,
    });

    await harness.service.uploadDraftMedia(harness.id);

    // The render worker letterboxes onto a 1080x1920 canvas, so it needs the
    // source aspect ratio without downloading every photo first.
    expect(harness.registrations.map((call) => call.dimensions)).toEqual([
      undefined,
      { width: 900, height: 1_600 },
    ]);
  });

  it('registers a photo with no usable size without inventing one', async () => {
    const harness = await createHarness({
      // Drafts saved before the picker reported a size persist 0x0, and the
      // columns are CHECK (> 0) — so the measurement has to stay absent.
      photos: [{ uri: 'file:///legacy.jpg', width: 0, height: 0, mimeType: 'image/jpeg' }],
      validate: alwaysPassed,
    });

    await harness.service.uploadDraftMedia(harness.id);

    expect(harness.registrations.map((call) => call.dimensions)).toEqual([undefined, undefined]);
  });
});
