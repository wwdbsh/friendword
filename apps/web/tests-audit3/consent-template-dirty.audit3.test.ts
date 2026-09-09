// MOTION PHASE 2 — switching the template is an unsaved edit.
//
// The template lives INSIDE the approved scene, so picking a different one means
// the page the Dater is looking at is not the page the server would publish. The
// approve button is gated on `editsDirty`, so if the template were left out of it
// the Dater could approve while the stored scene still held the old look — and the
// motion preview beside the button would be showing that old look while the
// switcher said otherwise.
/* global describe, expect, it */

import { examplePitchSceneV2, type PitchSceneV1 } from '@friendword/contracts';
import type { EditablePitchStructure } from '@friendword/data';

import {
  consentEditsDirty,
  sceneMatchesPhotos,
  sceneTemplate,
  scenePhotoAssetIds,
  type ConsentEditState,
} from '../src/pitch/consentEdits';

const PHOTO_ONE = '40000000-0000-0000-0000-000000000001';
const PHOTO_TWO = '40000000-0000-0000-0000-000000000002';

const STRUCTURE: EditablePitchStructure = {
  hook: 'Blair turns ordinary Tuesdays into stories.',
  relationship_context: 'We shared a wall for four years.',
  three_specific_qualities: ['Remembers every birthday', 'Cooks for a crowd', 'Never gossips'],
  evidence_or_anecdote: 'Blair drove three hours after my surgery.',
  good_match_for: 'Someone kind.',
};

/** A saved, untouched review: nothing to save, so approve is open. */
function saved(overrides: Partial<ConsentEditState> = {}): ConsentEditState {
  return {
    structure: STRUCTURE,
    savedStructure: STRUCTURE,
    headline: STRUCTURE.hook,
    savedHeadline: STRUCTURE.hook,
    body: 'A derived body.',
    savedBody: 'A derived body.',
    claimsDirty: false,
    includedAssetIds: [PHOTO_ONE, PHOTO_TWO],
    revisionPhotoIds: [PHOTO_ONE, PHOTO_TWO],
    clipAnswerKeys: [],
    savedClipAnswerKeys: [],
    template: 'warm',
    savedTemplate: 'warm',
    ...overrides,
  };
}

describe('consentEditsDirty', () => {
  it('is clean when nothing has been touched', () => {
    expect(consentEditsDirty(saved())).toBe(false);
  });

  it('is dirty after a template switch', () => {
    expect(consentEditsDirty(saved({ template: 'hype' }))).toBe(true);
    // …and clean again once the save has stored a scene built with it.
    expect(consentEditsDirty(saved({ template: 'hype', savedTemplate: 'hype' }))).toBe(false);
  });

  it('still catches every other unsaved change', () => {
    expect(consentEditsDirty(saved({ structure: { ...STRUCTURE, hook: 'Rewritten.' } }))).toBe(
      true,
    );
    expect(consentEditsDirty(saved({ claimsDirty: true }))).toBe(true);
    expect(consentEditsDirty(saved({ includedAssetIds: [PHOTO_ONE] }))).toBe(true);
  });

  it('falls back to headline/body on a legacy snapshot', () => {
    const legacy = saved({ structure: null, savedStructure: null });

    expect(consentEditsDirty(legacy)).toBe(false);
    expect(consentEditsDirty({ ...legacy, headline: 'Rewritten.' })).toBe(true);
    // A legacy revision can still switch the look — the save builds its first v2
    // scene with the chosen template.
    expect(consentEditsDirty({ ...legacy, template: 'hype' })).toBe(true);
  });

  it('ignores the order the photos were tapped in', () => {
    expect(consentEditsDirty(saved({ includedAssetIds: [PHOTO_TWO, PHOTO_ONE] }))).toBe(false);
  });
});

describe('reading the stored scene', () => {
  const v1: PitchSceneV1 = {
    schemaVersion: 1,
    canvas: { width: 1080, height: 1920, fps: 30 },
    durationMs: 24_000,
    scenes: [
      { assetId: PHOTO_ONE, startMs: 0, endMs: 12_000 },
      { assetId: PHOTO_TWO, startMs: 12_000, endMs: 24_000 },
    ],
  };

  it('reads the template off a v2 scene and defaults otherwise', () => {
    expect(sceneTemplate(examplePitchSceneV2())).toBe('warm');
    expect(sceneTemplate({ ...examplePitchSceneV2(), template: 'hype' })).toBe('hype');
    // A v1 row has no template. Showing the default is honest: it is what the
    // next save would build, so switching away from it IS a change.
    expect(sceneTemplate(v1)).toBe('warm');
    expect(sceneTemplate(null)).toBe('warm');
  });

  it('reads the photo set out of either version', () => {
    expect(scenePhotoAssetIds(v1)).toEqual([PHOTO_ONE, PHOTO_TWO]);
    expect(scenePhotoAssetIds(examplePitchSceneV2()).length).toBe(4);
    expect(scenePhotoAssetIds(null)).toEqual([]);
  });

  it('holds the motion preview back until the scene matches the selection', () => {
    expect(sceneMatchesPhotos(v1, [PHOTO_ONE, PHOTO_TWO])).toBe(true);
    // The state right after excluding a photo: publishing this would delete an
    // asset the scene still points at, and the RPC refuses it.
    expect(sceneMatchesPhotos(v1, [PHOTO_ONE])).toBe(false);
    expect(sceneMatchesPhotos(null, [PHOTO_ONE])).toBe(false);
  });
});
