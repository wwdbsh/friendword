import { describe, expect, it, vi } from 'vitest';
import type {
  BrowserSupabaseClient,
  ConsentSubmission,
  PitchAssetRow,
  PitchDraftRow,
  SignedAssetUpload,
} from '@friendword/data';
import type { PitchSceneSegment, PitchSceneTemplate } from '@friendword/contracts';

import type { ObservedClipIngest } from './clipIngest';
import type { MediaValidationOutcome } from './mediaValidation';
import type { PitchSceneBuilder } from './pitchSceneInput';
import {
  MockPitchDraftService,
  StoredClipRemovalError,
  type PitchDraftStorage,
} from './pitchDrafts';
import {
  CLIP_CEILING_REACHED_MESSAGE,
  CLIP_NEEDS_CAMPAIGN_PASS_MESSAGE,
  FLAGGED_CLIP_BLOCKS_SUBMIT_MESSAGE,
  hasPendingMediaValidation,
  HybridPitchDraftService,
  planDraftMedia,
  type PitchDraftRepository,
} from './pitchDraftsSupabase';
import {
  EMPTY_PITCH_STRUCTURE,
  type ClipIngestState,
  type PitchClip,
  type PitchDraft,
} from './types';

const SERVER_DRAFT_ID = '10000000-0000-4000-8000-000000000001';
const INTRODUCER_ID = '00000000-0000-4000-8000-000000000001';
const SERVER_ROW: PitchDraftRow = {
  id: SERVER_DRAFT_ID,
  created_by_user_id: INTRODUCER_ID,
  subject_user_id: null,
  status: 'draft',
  headline: 'Jordan makes ordinary days memorable',
  body: 'Jordan is thoughtful, curious, and always ready with a good story.',
  structure: EMPTY_PITCH_STRUCTURE,
  transcript: {
    text: 'Jordan is thoughtful.',
    segments: [{ start: 0, end: 2.5, text: 'Jordan is thoughtful.' }],
  } as unknown as PitchDraftRow['transcript'],
  audience_policy: null,
  location_precision: null,
  publish_days: null,
  relationship_type: 'friend',
  relationship_duration: 'y3to10',
  created_at: '2026-07-30T00:00:00.000Z',
  updated_at: '2026-07-30T00:00:00.000Z',
};

const SESSION_CLIENT = {
  auth: {
    getSession: async () => ({ data: { session: { user: { id: INTRODUCER_ID } } }, error: null }),
  },
} as unknown as BrowserSupabaseClient;

const MOV_CLIP: PitchClip = {
  uri: 'file:///beach.mov',
  width: 1080,
  height: 1920,
  durationMillis: 9_000,
  byteSize: 8_000_000,
  mimeType: 'video/quicktime',
};

/** Every observable step, in the order it happened, so ordering is testable. */
type Step =
  | { readonly kind: 'put'; readonly objectName: string; readonly contentType: string | undefined }
  | { readonly kind: 'register'; readonly assetType: string; readonly objectName: string }
  | { readonly kind: 'validate'; readonly objectName: string };

type Harness = {
  readonly id: PitchDraft['id'];
  readonly local: MockPitchDraftService;
  readonly service: HybridPitchDraftService;
  readonly steps: readonly Step[];
  readonly registrations: ReadonlyArray<{
    readonly assetType: string;
    readonly objectName: string;
    readonly sortOrder: number;
    readonly width: number | null;
  }>;
  readonly sceneInputs: ReadonlyArray<{
    readonly photoAssetIds: readonly string[];
    readonly segments: readonly PitchSceneSegment[];
  }>;
  readonly removedAssets: readonly string[];
  currentDraft(): Promise<PitchDraft>;
};

/** `putLocalFile` falls back to fetch + blob outside the native runtime. */
function installFetchMock(record: (objectName: string, contentType?: string) => void): void {
  globalThis.fetch = vi.fn(
    async (
      input: unknown,
      init?: { method?: string; headers?: Record<string, string> },
    ): Promise<Response> => {
      if (init?.method === 'PUT') {
        record(String(input).split('/').pop() ?? '', init.headers?.['Content-Type']);
      }
      return new Response('', { status: 200 });
    },
  ) as unknown as typeof fetch;
}

async function createHarness(options: {
  readonly clips: readonly PitchClip[];
  readonly validate?: (objectName: string) => Promise<MediaValidationOutcome>;
  readonly readClipIngest?: (objectNames: readonly string[]) => Promise<ObservedClipIngest>;
  readonly clipMaxBytes?: number;
  readonly submitForConsent?: () => Promise<ConsentSubmission>;
  /** The server's refusal for one registration attempt, by attempt count. */
  readonly registerFails?: (assetType: string, attempt: number) => Error | null;
}): Promise<Harness> {
  const steps: Step[] = [];
  const registrations: Array<{
    assetType: string;
    objectName: string;
    sortOrder: number;
    width: number | null;
  }> = [];
  const sceneInputs: Array<{
    photoAssetIds: readonly string[];
    segments: readonly PitchSceneSegment[];
  }> = [];
  const assetRows: PitchAssetRow[] = [];
  const removedAssets: string[] = [];
  installFetchMock((objectName, contentType) => {
    steps.push({ kind: 'put', objectName, contentType });
  });
  const values = new Map<string, string>();
  const storage: PitchDraftStorage = {
    getItem: async (key) => values.get(key) ?? null,
    setItem: async (key, value) => {
      values.set(key, value);
    },
  };
  const local = new MockPitchDraftService(storage);
  const draft = await local.createDraft();
  await local.saveRelationship(draft.id, {
    kind: 'Friend',
    duration: '3–10 years',
    friendFirstName: 'Jordan',
    contact: { kind: 'email', value: 'friend@example.com' },
  });
  await local.savePhotos(draft.id, [
    { uri: 'file:///one.jpg', width: 100, height: 120, mimeType: 'image/jpeg' },
  ]);
  await local.saveClips(draft.id, options.clips);
  await local.saveRecording(draft.id, {
    uri: 'file:///voice.m4a',
    durationMillis: 30_000,
    caption: 'A real story about Jordan.',
  });
  await local.attachServerDraft(draft.id, SERVER_DRAFT_ID);

  const unexpected = async (): Promise<never> => {
    throw new Error('Unexpected repository method');
  };
  const repository: PitchDraftRepository = {
    createDraft: unexpected,
    deleteDraft: unexpected,
    getDraft: unexpected,
    listAssets: async (): Promise<readonly PitchAssetRow[]> => [...assetRows],
    removeAsset: async (assetId): Promise<void> => {
      const position = assetRows.findIndex((row) => row.id === assetId);
      removedAssets.push(assetId);
      assetRows.splice(position, 1);
    },
    listMyConsentRequests: unexpected,
    listMyDrafts: unexpected,
    submitForConsent: async (): Promise<ConsentSubmission> =>
      (options.submitForConsent ?? unexpected)(),
    updateDraft: async (): Promise<PitchDraftRow> => SERVER_ROW,
    requestAssetUpload: async (draftId, fileName): Promise<SignedAssetUpload> => ({
      storagePath: `pitch-media/${draftId}/${fileName}`,
      signedUrl: `https://storage.test/upload/${fileName}`,
      token: 'signed-token',
    }),
    registerAsset: async (draftId, assetType, fileName, sortOrder, dimensions) => {
      steps.push({ kind: 'register', assetType, objectName: fileName });
      const refusal =
        options.registerFails?.(
          assetType,
          registrations.filter((entry) => entry.assetType === assetType).length,
        ) ?? null;
      if (refusal !== null) {
        throw refusal;
      }
      registrations.push({
        assetType,
        objectName: fileName,
        sortOrder: sortOrder ?? 0,
        width: dimensions?.width ?? null,
      });
      const row: PitchAssetRow = {
        id: `asset-${fileName}`,
        pitch_draft_id: draftId,
        uploaded_by_user_id: INTRODUCER_ID,
        asset_type: assetType,
        storage_path: `pitch-media/${draftId}/${fileName}`,
        sort_order: sortOrder ?? 0,
        created_at: SERVER_ROW.created_at,
        updated_at: SERVER_ROW.updated_at,
      };
      assetRows.push(row);
      return row;
    },
  };
  const buildScene: PitchSceneBuilder = (input: {
    template: PitchSceneTemplate;
    photoAssetIds: readonly string[];
    segments: readonly PitchSceneSegment[];
  }) => {
    sceneInputs.push({ photoAssetIds: input.photoAssetIds, segments: input.segments });
    return null;
  };
  const service = new HybridPitchDraftService(
    SESSION_CLIENT,
    local,
    repository,
    8_000,
    async (objectName) => {
      steps.push({ kind: 'validate', objectName });
      return (options.validate ?? (async () => 'passed' as MediaValidationOutcome))(objectName);
    },
    buildScene,
    () => undefined,
    async ({ objectNames }) => (options.readClipIngest ?? (async () => new Map()))(objectNames),
    async () => options.clipMaxBytes ?? 52_428_800,
  );
  return {
    id: draft.id,
    local,
    service,
    steps,
    registrations,
    sceneInputs,
    removedAssets,
    currentDraft: async (): Promise<PitchDraft> => {
      const current = (await local.getMyDrafts()).find((candidate) => candidate.id === draft.id);
      if (current === undefined) {
        throw new Error('Expected the draft to still exist');
      }
      return current;
    },
  };
}

describe('pitch clip upload', () => {
  it('uploads the clip under its own identity and container type', async () => {
    const harness = await createHarness({ clips: [MOV_CLIP] });

    await harness.service.uploadDraftMedia(harness.id);
    const clip = (await harness.currentDraft()).clips[0];

    expect(clip?.upload?.objectName).toMatch(/^clip-[a-z0-9]+\.mov$/);
    expect(harness.steps.filter((step) => step.kind === 'put')).toEqual([
      { kind: 'put', objectName: 'voice.m4a', contentType: 'audio/mp4' },
      { kind: 'put', objectName: expect.stringMatching(/^photo-/), contentType: 'image/jpeg' },
      { kind: 'put', objectName: clip?.upload?.objectName, contentType: 'video/quicktime' },
    ]);
  });

  it('registers the clip immediately after its bytes land, before anything else runs', async () => {
    const harness = await createHarness({ clips: [MOV_CLIP] });

    await harness.service.uploadDraftMedia(harness.id);
    const objectName = (await harness.currentDraft()).clips[0]?.upload?.objectName;
    const putIndex = harness.steps.findIndex(
      (step) => step.kind === 'put' && step.objectName === objectName,
    );
    const registerIndex = harness.steps.findIndex(
      (step) => step.kind === 'register' && step.objectName === objectName,
    );

    // The orphan sweep deletes any pitch-media object no pitch_assets row names,
    // so registration cannot be deferred to submit time.
    expect(putIndex).toBeGreaterThanOrEqual(0);
    expect(registerIndex).toBe(putIndex + 1);
    expect(harness.registrations.at(-1)).toEqual({
      assetType: 'video',
      objectName,
      sortOrder: 0,
      width: 1080,
    });
  });

  it('records the clip as pending ingest, never as a passed validation', async () => {
    const harness = await createHarness({ clips: [MOV_CLIP] });

    await harness.service.uploadDraftMedia(harness.id);
    const draft = await harness.currentDraft();
    const clip = draft.clips[0];

    expect(clip?.upload).toEqual({
      objectName: expect.stringMatching(/^clip-/),
      registered: true,
      validated: false,
    });
    expect(clip?.ingest).toBe('pending');
  });

  it('never sends clip bytes to the image/audio validator', async () => {
    const harness = await createHarness({ clips: [MOV_CLIP] });

    await harness.service.uploadDraftMedia(harness.id);
    const validated = harness.steps.flatMap((step) =>
      step.kind === 'validate' ? [step.objectName] : [],
    );

    expect(validated).toHaveLength(2);
    expect(validated.some((objectName) => objectName.includes('clip-'))).toBe(false);
  });

  it('does not re-upload or re-register a clip on a second pass', async () => {
    const harness = await createHarness({ clips: [MOV_CLIP] });

    await harness.service.uploadDraftMedia(harness.id);
    const stepsAfterFirst = harness.steps.length;
    await harness.service.uploadDraftMedia(harness.id);

    expect(harness.steps).toHaveLength(stepsAfterFirst);
  });

  it('refuses a clip over the configured ceiling before reading its bytes', async () => {
    const harness = await createHarness({
      clips: [{ ...MOV_CLIP, byteSize: 20_000_000 }],
      clipMaxBytes: 10_000_000,
    });

    await expect(harness.service.uploadDraftMedia(harness.id)).rejects.toThrow(/too large/);
    expect(
      harness.steps.some((step) => step.kind === 'put' && step.objectName.includes('clip-')),
    ).toBe(false);
    expect((await harness.currentDraft()).clips[0]?.upload).toBeUndefined();
  });

  it('plans a clip with the container type and measurements the upload needs', async () => {
    const harness = await createHarness({ clips: [MOV_CLIP] });
    const plans = planDraftMedia(await harness.currentDraft());

    expect(plans.map((plan) => plan.kind)).toEqual(['voice', 'photo', 'video']);
    expect(plans[2]).toEqual(
      expect.objectContaining({
        contentType: 'video/quicktime',
        objectName: expect.stringMatching(/^clip-[a-z0-9]+\.mov$/),
        dimensions: { width: 1080, height: 1920 },
        byteSize: 8_000_000,
        index: 0,
      }),
    );
  });

  it('does not treat a stored clip as an unfinished validation', async () => {
    const harness = await createHarness({ clips: [MOV_CLIP] });

    await harness.service.uploadDraftMedia(harness.id);

    // Voice and photo passed; the clip has no verdict to wait for here, so a
    // submit must not re-run the upload step on its account.
    expect(hasPendingMediaValidation(await harness.currentDraft())).toBe(false);
  });

  it('keeps the submitted scene photo-only while clips are not scene shots', async () => {
    const harness = await createHarness({
      clips: [MOV_CLIP],
      submitForConsent: async () => ({
        consentRequestId: '30000000-0000-4000-8000-000000000001',
        consentToken: 'a'.repeat(32),
      }),
    });

    await harness.service.uploadDraftMedia(harness.id);
    await harness.service.saveReview(harness.id, {
      headline: 'Jordan makes ordinary days memorable',
      body: 'Jordan is thoughtful, curious, and always ready with a good story.',
      structure: EMPTY_PITCH_STRUCTURE,
      generationMode: 'generated',
      responseNote: null,
    });
    await harness.service.finalizeConsent(harness.id);

    expect(harness.sceneInputs).toHaveLength(1);
    expect(harness.sceneInputs[0]?.photoAssetIds.every((id) => id.includes('photo-'))).toBe(true);
    // A registered clip is expected state, not a leftover to detach.
    expect(harness.removedAssets).toEqual([]);
  });
});

describe('clip ingest refresh', () => {
  it('writes the states the server reported into the local mirror', async () => {
    const states = new Map<string, ClipIngestState>();
    const harness = await createHarness({
      clips: [MOV_CLIP],
      readClipIngest: async (objectNames) => {
        const objectName = objectNames[0];
        return objectName === undefined ? new Map() : new Map(states.set(objectName, 'flagged'));
      },
    });

    await harness.service.uploadDraftMedia(harness.id);
    const refreshed = await harness.service.refreshClipIngest(harness.id);

    expect(refreshed.clips[0]?.ingest).toBe('flagged');
    expect((await harness.currentDraft()).clips[0]?.ingest).toBe('flagged');
  });

  it('leaves the mirror alone when the server says nothing', async () => {
    const harness = await createHarness({
      clips: [MOV_CLIP],
      readClipIngest: async () => new Map(),
    });

    await harness.service.uploadDraftMedia(harness.id);
    const refreshed = await harness.service.refreshClipIngest(harness.id);

    expect(refreshed.clips[0]?.ingest).toBe('pending');
  });

  it('asks about uploaded clips only', async () => {
    const asked: string[][] = [];
    const harness = await createHarness({
      clips: [MOV_CLIP],
      readClipIngest: async (objectNames) => {
        asked.push([...objectNames]);
        return new Map();
      },
    });

    await harness.service.refreshClipIngest(harness.id);
    await harness.service.uploadDraftMedia(harness.id);
    await harness.service.refreshClipIngest(harness.id);

    expect(asked).toHaveLength(1);
    expect(asked[0]?.[0]).toMatch(/^clip-[a-z0-9]+\.mov$/);
  });
});

describe('clip removal', () => {
  it('refuses to drop a clip whose bytes are already stored', async () => {
    const harness = await createHarness({ clips: [MOV_CLIP] });
    await harness.service.uploadDraftMedia(harness.id);

    await expect(harness.service.saveClips(harness.id, [])).rejects.toThrow(StoredClipRemovalError);

    const draft = await harness.currentDraft();
    expect(draft.clips).toHaveLength(1);
    expect(draft.clips[0]?.upload).toBeDefined();
  });

  it('allows dropping a clip that was never uploaded', async () => {
    const harness = await createHarness({ clips: [MOV_CLIP] });

    const saved = await harness.service.saveClips(harness.id, []);

    expect(saved.clips).toEqual([]);
  });

  it('keeps identity and ingest state across an unrelated edit', async () => {
    const harness = await createHarness({ clips: [MOV_CLIP] });
    await harness.service.uploadDraftMedia(harness.id);
    const stored = (await harness.currentDraft()).clips[0];

    const saved = await harness.service.saveClips(harness.id, [MOV_CLIP]);

    expect(saved.clips[0]?.assetKey).toBe(stored?.assetKey);
    expect(saved.clips[0]?.upload).toEqual(stored?.upload);
    expect(saved.clips[0]?.ingest).toBe('pending');
  });
});

describe('server refusals a clip can produce', () => {
  const REVIEW = {
    headline: 'Jordan makes ordinary days memorable',
    body: 'Jordan is thoughtful, curious, and always ready with a good story.',
    structure: EMPTY_PITCH_STRUCTURE,
    generationMode: 'generated' as const,
    responseNote: null,
  };

  it('drops a clip the entitlement refused and leaves the rest of the pitch sendable', async () => {
    const harness = await createHarness({
      clips: [MOV_CLIP],
      registerFails: (assetType) =>
        assetType === 'video' ? new Error('a second video clip requires a Campaign Pass') : null,
    });

    await expect(harness.service.uploadDraftMedia(harness.id)).rejects.toThrow(
      CLIP_NEEDS_CAMPAIGN_PASS_MESSAGE,
    );

    const draft = await harness.currentDraft();
    expect(draft.clips).toEqual([]);
    expect(draft.photos[0]?.upload?.validated).toBe(true);
    expect(draft.recording?.upload?.validated).toBe(true);
    // The retry has nothing left to refuse, so the pitch can be sent.
    await expect(harness.service.uploadDraftMedia(harness.id)).resolves.toBeDefined();
  });

  it('reports the absolute ceiling separately from the entitlement', async () => {
    const harness = await createHarness({
      clips: [MOV_CLIP],
      registerFails: (assetType) =>
        assetType === 'video' ? new Error('a pitch may carry at most 3 video clips') : null,
    });

    await expect(harness.service.uploadDraftMedia(harness.id)).rejects.toThrow(
      CLIP_CEILING_REACHED_MESSAGE,
    );
    expect((await harness.currentDraft()).clips).toEqual([]);
  });

  it('keeps the clip when the registration failed for any other reason', async () => {
    const harness = await createHarness({
      clips: [MOV_CLIP],
      registerFails: (assetType) =>
        assetType === 'video' ? new Error('network request failed') : null,
    });

    await expect(harness.service.uploadDraftMedia(harness.id)).rejects.toThrow('network request');

    // A clip silently dropped on a network error is a video the introducer thinks
    // they sent, so the local draft has to keep claiming it.
    expect((await harness.currentDraft()).clips).toHaveLength(1);
  });

  it('explains the flagged-clip submit gate instead of blaming the connection', async () => {
    const harness = await createHarness({
      clips: [MOV_CLIP],
      submitForConsent: async () => {
        throw new Error('remove the flagged video clip before requesting consent');
      },
    });

    await harness.service.uploadDraftMedia(harness.id);
    await harness.service.saveReview(harness.id, REVIEW);

    await expect(harness.service.finalizeConsent(harness.id)).rejects.toThrow(
      FLAGGED_CLIP_BLOCKS_SUBMIT_MESSAGE,
    );
  });
});
