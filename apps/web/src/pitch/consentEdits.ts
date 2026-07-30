import {
  isPitchSceneV2,
  type PitchSceneAnyVersion,
  type PitchSceneTemplate,
} from '@friendword/contracts';
import type { EditablePitchStructure } from '@friendword/data';

// What counts as an unsaved edit on the consent screen.
//
// This is not cosmetic bookkeeping: "dirty" is what disables **Approve &
// publish**. Anything the Dater can change that ends up in the published page has
// to appear here, or they could approve a page that does not match what is on
// screen — and `approve_and_publish_pitch` would either publish the stale version
// or refuse the mismatch. Pulled out of the component so each input is a test
// case rather than a click path.

/** The template a save uses when the revision carries no v2 scene to read one from. */
export const DEFAULT_PITCH_SCENE_TEMPLATE: PitchSceneTemplate = 'warm';

/** Set equality — the include list is a selection, so its order means nothing. */
export function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id) => right.includes(id));
}

export function sameStructure(
  left: EditablePitchStructure | null,
  right: EditablePitchStructure | null,
): boolean {
  if (left === null || right === null) {
    return left === right;
  }
  return (
    left.hook === right.hook &&
    left.relationship_context === right.relationship_context &&
    left.evidence_or_anecdote === right.evidence_or_anecdote &&
    left.good_match_for === right.good_match_for &&
    left.three_specific_qualities.length === right.three_specific_qualities.length &&
    left.three_specific_qualities.every(
      (quality, index) => quality === right.three_specific_qualities[index],
    )
  );
}

/**
 * The template this revision's motion was built with. A v1 (or absent) scene has
 * no template, and the switcher then shows the default — which is honest: that is
 * the template the next save would build, and switching away from it is a real
 * change.
 */
export function sceneTemplate(scene: PitchSceneAnyVersion | null): PitchSceneTemplate {
  return scene !== null && isPitchSceneV2(scene) ? scene.template : DEFAULT_PITCH_SCENE_TEMPLATE;
}

/** Every photo the scene shows, in whichever version it is stored. */
export function scenePhotoAssetIds(scene: PitchSceneAnyVersion | null): readonly string[] {
  if (scene === null) {
    return [];
  }
  return isPitchSceneV2(scene) ? scene.assetIds : scene.scenes.map((window) => window.assetId);
}

/**
 * True when the stored scene describes exactly the photos that are included right
 * now. An unsaved photo change makes it false, and the motion preview then waits
 * for the save that rebuilds the scene rather than showing a photo the Dater just
 * excluded (which publish would reject anyway).
 */
export function sceneMatchesPhotos(
  scene: PitchSceneAnyVersion | null,
  includedPhotoAssetIds: readonly string[],
): boolean {
  return scene !== null && sameIds([...scenePhotoAssetIds(scene)], [...includedPhotoAssetIds]);
}

export type ConsentEditState = {
  /** Null on a legacy snapshot the section editor cannot parse. */
  readonly structure: EditablePitchStructure | null;
  readonly savedStructure: EditablePitchStructure | null;
  readonly headline: string;
  readonly savedHeadline: string;
  readonly body: string;
  readonly savedBody: string;
  /** A flagged claim marked "I took that out" is only gone once saved. */
  readonly claimsDirty: boolean;
  readonly includedAssetIds: readonly string[];
  readonly revisionPhotoIds: readonly string[];
  readonly template: PitchSceneTemplate;
  readonly savedTemplate: PitchSceneTemplate;
};

export function consentEditsDirty(state: ConsentEditState): boolean {
  const textDirty =
    state.structure !== null
      ? !sameStructure(state.structure, state.savedStructure)
      : state.headline !== state.savedHeadline || state.body !== state.savedBody;

  return (
    textDirty ||
    state.claimsDirty ||
    !sameIds([...state.includedAssetIds], [...state.revisionPhotoIds]) ||
    // The template is stored inside the approved scene, so switching it is an
    // unsaved change to the published page exactly like an edited sentence is.
    state.template !== state.savedTemplate
  );
}
