// T004 — the clip include/exclude decision on the consent surface.
//
// REEL_V3_DESIGN §0 verdict 4(a): a selfie clip may reach the MP4 ONLY through
// the approved snapshot, and the snapshot only carries it when the Dater said
// yes. Before this task `revisionAssetIds()` auto-retained every non-photo
// asset, so a clip rode into `snapshot_video_asset_ids` (0050:2573) without
// anyone having answered a question about it.
//
// The answer has NO DEFAULT, in either direction. Defaulting to "included"
// publishes a video by inattention; defaulting to "excluded" DESTROYS one by
// inattention (a clip dropped from a snapshot never reappears on this screen),
// and an unrelated photo edit would have been enough to do it. So the two
// options are offered unselected and both the save and the approve gate stay
// shut until the Dater picks one.
//
// These tests mount the real ConsentFlow with photos and one selfie clip:
//   1. the question is asked, with neither answer preselected;
//   2. an unanswered clip blocks BOTH save and approve;
//   3. answering "include" and saving keeps the clip in the snapshot;
//   4. answering "leave it out" and saving removes it.
/* global beforeEach, afterEach, describe, expect, it */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { vi } from 'vitest';

const DRAFT_ID = '22222222-2222-4222-8222-222222222222';
const REVISION_ID = '33333333-3333-4333-8333-333333333333';
const PHOTO_ID = '44444444-4444-4444-8444-444444444444';
const PHOTO_TWO_ID = '66666666-6666-4666-8666-666666666666';
const CLIP_ID = '55555555-5555-4555-8555-555555555555';

const structure = {
  hook: 'The hook line',
  relationship_context: 'We met at work',
  three_specific_qualities: ['Kind', 'Curious', 'Steady'],
  evidence_or_anecdote: 'They drove two hours to help me move.',
  good_match_for: 'Someone who likes slow mornings.',
};

/** Every createDaterRevision call this mount made, newest last. */
const savedRevisions: { includedAssetIds: readonly string[] }[] = [];

/**
 * The asset ids the CURRENT revision snapshot carries, swapped per test.
 * It is the snapshot `request_consent` freezes — the Introducer attached a clip
 * and nobody has answered for it yet.
 */
let snapshotAssetIds: readonly string[] = [PHOTO_ID, PHOTO_TWO_ID, CLIP_ID];

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@/lib/moderateText', () => ({
  requestDaterPitchModeration: () => Promise.resolve('passed'),
}));

vi.mock('@/lib/supabaseClient', () => ({
  getSupabaseBrowserClient: () => ({
    auth: {
      getSession: () =>
        Promise.resolve({
          data: { session: { access_token: 'token-1', user: { id: 'user-1' } } },
          error: null,
        }),
      onAuthStateChange: () => ({
        data: { subscription: { subscription: { unsubscribe: () => undefined } } },
      }),
    },
  }),
}));

vi.mock('@friendword/data', () => {
  class DataLayerError extends Error {
    constructor(
      scope: string,
      public override readonly cause: unknown,
    ) {
      super(scope);
    }
  }
  class ConsentRepo {
    getPreview() {
      return Promise.resolve({
        introducerDisplayName: 'Sam',
        relationshipType: 'friend',
        relationshipDuration: 'y1to3',
        requestStatus: 'pending',
      });
    }
    claim() {
      return Promise.resolve({ pitchDraftId: DRAFT_ID });
    }
    getConsentReview() {
      return Promise.resolve({
        revision: {
          id: REVISION_ID,
          pitch_draft_id: DRAFT_ID,
          revision_number: 1,
          headline: 'The hook line',
          body: 'We met at work.',
          structure,
          asset_ids: [...snapshotAssetIds],
          voice_asset_path: null,
          content_hash: 'hash',
          scene_definition: null,
          scene_hash: null,
        },
        assets: [
          {
            id: PHOTO_ID,
            asset_type: 'photo',
            storage_path: `pitch-media/${DRAFT_ID}/photo-1.jpg`,
            sort_order: 0,
          },
          {
            id: PHOTO_TWO_ID,
            asset_type: 'photo',
            storage_path: `pitch-media/${DRAFT_ID}/photo-2.jpg`,
            sort_order: 1,
          },
          {
            id: CLIP_ID,
            asset_type: 'video',
            storage_path: `pitch-media/${DRAFT_ID}/clip-1.mp4`,
            sort_order: 1,
            asset_role: 'selfie',
          },
        ],
        hardClaims: [],
        editableStructure: structure,
        transcriptText: 'This is what I said about you.',
        transcriptSegments: [],
        transcriptWords: [],
        transcriptAudioDurationMs: null,
        scene: null,
        daterEdited: false,
      });
    }
    getAiDisclosureRevision() {
      return Promise.resolve('ai-disclosure-1');
    }
    createAssetViewUrl(storagePath: string) {
      return Promise.resolve(`https://example.test/${storagePath}`);
    }
    createDaterRevision(input: { includedAssetIds: readonly string[] }) {
      savedRevisions.push({ includedAssetIds: [...input.includedAssetIds] });
      return Promise.resolve(undefined);
    }
  }
  return {
    DataLayerError,
    ConsentRepo,
    ensureUserRow: () => Promise.resolve(),
    confirmDisplayName: () => Promise.resolve(),
    getDisplayNameStatus: () => Promise.resolve({ displayName: 'Blair', confirmed: true }),
    signInWithOtp: () => Promise.resolve(),
    verifyOtp: () => Promise.resolve(null),
    ageFromBirthDate: () => null,
    canonicalApproximateLocation: () => null,
  };
});

import { ConsentFlow, clipIdsForSave } from '../app/consent/[token]/ConsentFlow';

const SELFIE_QUESTION = 'Your friend’s selfie clip — include it as the opening of the video?';
const INCLUDE_LABEL = 'Include as the opening';
const EXCLUDE_LABEL = 'Leave it out';

/** The two radios of the one clip's decision. */
function clipChoices(): { include: HTMLInputElement; exclude: HTMLInputElement } {
  const group = screen.getByRole('group', { name: SELFIE_QUESTION });
  const radios = [...group.querySelectorAll('input[type="radio"]')] as HTMLInputElement[];
  const include = radios.find((radio) => radio.value === 'include');
  const exclude = radios.find((radio) => radio.value === 'exclude');
  if (include === undefined || exclude === undefined) {
    throw new Error('the clip decision is missing one of its two options');
  }
  return { include, exclude };
}

function approveButton(): HTMLButtonElement {
  return screen.getByRole('button', {
    name: 'Approve & publish my page',
  }) as HTMLButtonElement;
}

function saveButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'Save my edits' }) as HTMLButtonElement;
}

/**
 * The clip-ingest-state endpoint. `state: null` is the answer the surface gets
 * when the read did not come back at all (offline, or a clip registered but not
 * yet queued) — the card is then null, which used to exempt the clip from the
 * question entirely.
 */
function stubClipIngestFetch(state: 'succeeded' | 'pending' | null = 'succeeded'): void {
  vi.stubGlobal('fetch', (input: unknown) => {
    if (typeof input === 'string' && input.includes('/api/media/clip-ingest-state')) {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            clips:
              state === null
                ? {}
                : {
                    'clip-1.mp4': {
                      state,
                      durationMs: 8000,
                      posterUrl: state === 'succeeded' ? 'https://example.test/poster.jpg' : null,
                      proxyUrl: state === 'succeeded' ? 'https://example.test/proxy.mp4' : null,
                    },
                  },
          }),
      });
    }
    return Promise.reject(new Error(`unexpected fetch: ${String(input)}`));
  });
}

async function mountReview(): Promise<void> {
  render(<ConsentFlow token="tok_test" />);
  await act(async () => {});
  await act(async () => {});
}

function saveEdits(): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: 'Save my edits' }));
  return act(async () => {});
}

// B1, stated directly: the save list is built from an explicit "include" and
// nothing else. "Not excluded" would let an unanswered clip through if the gate
// above ever regressed, and the worker's own gate would then pass it.
describe('clipIdsForSave', () => {
  const clips = [{ assetId: CLIP_ID }, { assetId: PHOTO_ID }];
  it('writes only the clips answered "include"', () => {
    expect(clipIdsForSave(clips, new Map([[CLIP_ID, 'include']]))).toEqual([CLIP_ID]);
  });
  it('excludes an unanswered clip', () => {
    expect(clipIdsForSave(clips, new Map())).toEqual([]);
  });
  it('excludes a clip answered "exclude"', () => {
    expect(clipIdsForSave(clips, new Map([[CLIP_ID, 'exclude']]))).toEqual([]);
  });
});

describe('the consent surface asks about each clip', () => {
  beforeEach(() => {
    savedRevisions.length = 0;
    snapshotAssetIds = [PHOTO_ID, PHOTO_TWO_ID, CLIP_ID];
    stubClipIngestFetch();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('asks the selfie question with NEITHER answer preselected', async () => {
    await mountReview();
    const { include, exclude } = clipChoices();
    expect(include.checked).toBe(false);
    expect(exclude.checked).toBe(false);
    expect(screen.getByLabelText(INCLUDE_LABEL)).toBeTruthy();
    expect(screen.getByLabelText(EXCLUDE_LABEL)).toBeTruthy();
  });

  it('blocks both save and approve while the clip is unanswered', async () => {
    await mountReview();
    expect(approveButton().disabled).toBe(true);
    // …and a photo edit cannot slip past it either: the save that would carry
    // the photo change is the same save that would decide the clip's fate.
    fireEvent.click(screen.getByRole('button', { name: 'Exclude suggested photo 2' }));
    await act(async () => {});
    expect(saveButton().disabled).toBe(true);
    expect(
      screen.getAllByText(/Decide about your friend’s selfie clip first/).length,
    ).toBeGreaterThan(0);
    expect(savedRevisions).toHaveLength(0);
  });

  it('opens the gate once the clip is answered', async () => {
    await mountReview();
    // Same photo edit as above — blocked a moment ago, allowed now, and the
    // clip decision is the only thing that changed.
    fireEvent.click(screen.getByRole('button', { name: 'Exclude suggested photo 2' }));
    await act(async () => {});
    expect(saveButton().disabled).toBe(true);

    fireEvent.click(clipChoices().include);
    await act(async () => {});
    expect(saveButton().disabled).toBe(false);
    expect(screen.queryByText(/Decide about your friend’s selfie clip first/)).toBeNull();
  });

  it('takes the clip OUT of the saved snapshot only when asked to', async () => {
    await mountReview();
    fireEvent.click(clipChoices().exclude);
    await act(async () => {});
    // Answered but unsaved is dirty: the screen and the snapshot disagree.
    expect(approveButton().disabled).toBe(true);
    expect(saveButton().disabled).toBe(false);
    await saveEdits();

    const saved = savedRevisions.at(-1);
    expect(saved).toBeTruthy();
    expect(saved?.includedAssetIds).toContain(PHOTO_ID);
    expect(saved?.includedAssetIds).not.toContain(CLIP_ID);
  });

  it('keeps an included clip through an unrelated photo edit', async () => {
    await mountReview();
    fireEvent.click(clipChoices().include);
    // The save is about the photo; the clip must survive it untouched, on the
    // same list that drops the excluded photo.
    fireEvent.click(screen.getByRole('button', { name: 'Exclude suggested photo 2' }));
    await saveEdits();

    const saved = savedRevisions.at(-1);
    expect(saved).toBeTruthy();
    expect(saved?.includedAssetIds).toContain(CLIP_ID);
    expect(saved?.includedAssetIds).toContain(PHOTO_ID);
    expect(saved?.includedAssetIds).not.toContain(PHOTO_TWO_ID);
  });

  // B1: the question is not conditional on the ingest. `request_consent`
  // freezes every draft asset into the snapshot, and an ingest can reach
  // 'succeeded' AFTER approval — so a clip nobody was asked about would have
  // walked straight through the render worker's gate.
  for (const [name, state] of [
    ['still processing', 'pending'],
    ['whose state never came back', null],
  ] as const) {
    it(`still demands an answer for a clip ${name}`, async () => {
      stubClipIngestFetch(state);
      await mountReview();

      expect(clipChoices().include.checked).toBe(false);
      expect(clipChoices().exclude.checked).toBe(false);
      expect(approveButton().disabled).toBe(true);
      expect(
        screen.getAllByText(/Decide about your friend’s selfie clip first/).length,
      ).toBeGreaterThan(0);

      // …and with no answer it is EXCLUDED from the save, not carried along.
      fireEvent.click(clipChoices().exclude);
      await act(async () => {});
      await saveEdits();
      expect(savedRevisions.at(-1)?.includedAssetIds).not.toContain(CLIP_ID);
    });
  }

  // The Dater may only INCLUDE footage they can watch. Below 'succeeded' the
  // card has no proxy and no poster, so "include" there is consent to publish
  // an unseen video; the question itself still has to be answered.
  for (const [name, state] of [
    ['still processing', 'pending'],
    ['whose state never came back', null],
  ] as const) {
    it(`offers only "leave it out" for a clip ${name}`, async () => {
      stubClipIngestFetch(state);
      await mountReview();

      const { include, exclude } = clipChoices();
      expect(include.disabled).toBe(true);
      expect(exclude.disabled).toBe(false);
      expect(
        screen.getByText('Still processing — you can include it once you can watch it here.'),
      ).toBeTruthy();

      // The gate is unchanged: unanswered still blocks, and the answer that IS
      // available still opens it.
      expect(approveButton().disabled).toBe(true);
      fireEvent.click(exclude);
      await act(async () => {});
      expect(clipChoices().exclude.checked).toBe(true);
      expect(saveButton().disabled).toBe(false);
    });
  }

  it('offers "include" once the clip has passed and can be watched', async () => {
    await mountReview();
    const { include, exclude } = clipChoices();
    expect(include.disabled).toBe(false);
    expect(exclude.disabled).toBe(false);
    expect(
      screen.queryByText('Still processing — you can include it once you can watch it here.'),
    ).toBeNull();

    fireEvent.click(include);
    await act(async () => {});
    expect(clipChoices().include.checked).toBe(true);
    await saveEdits();
    expect(savedRevisions.at(-1)?.includedAssetIds).toContain(CLIP_ID);
  });

  // B1b: an "include" that matches the snapshot records nothing on its own.
  it('will not approve on an include the save has not written yet', async () => {
    await mountReview();
    fireEvent.click(clipChoices().include);
    await act(async () => {});

    // The gate is the dirty flag, not the clip question: the answer is given,
    // and it is still not on record.
    expect(approveButton().disabled).toBe(true);
    expect(screen.getByText('Save your edits before approving this page.')).toBeTruthy();
    expect(savedRevisions).toHaveLength(0);

    await saveEdits();
    // The save carried the answer, with the clip id in it.
    expect(savedRevisions).toHaveLength(1);
    expect(savedRevisions[0]?.includedAssetIds).toContain(CLIP_ID);
  });
});
