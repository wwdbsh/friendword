// ACCOUNT ERASURE BOUNDARY — the two decisions a deletion job cannot get wrong.
//
// `scripts/process-deletions.mjs` is the only thing that physically erases a
// user, and until this suite existed nothing exercised it: the logic was proven
// only by running it against a real project. The parts worth pinning are pure,
// so they live in `scripts/lib/accountErasure.mjs` and are asserted here.
//
// Two failure modes are covered:
//   1. Over-deletion — a deleted introducer taking a dater's live campaign, or
//      an erased draft dragging someone else's campaign row with it.
//   2. Under-deletion — a preserved draft keeping the deleted introducer's
//      voice alive, in the source recording OR in the rendered MP4 that copies
//      the same audio stream verbatim.
import { describe, expect, it } from 'vitest';

import {
  collectVoiceDerivedPaths,
  planAccountErasure,
  renderFolderPath,
  voiceObjectPath,
} from '../../../scripts/lib/accountErasure.mjs';

const INTRODUCER = '00000000-0000-4000-8000-00000000000a';
const DATER = '00000000-0000-4000-8000-00000000000b';
const OTHER_INTRODUCER = '00000000-0000-4000-8000-00000000000c';

const SHARED_DRAFT = '10000000-0000-4000-8000-000000000001';
const OWN_DRAFT = '10000000-0000-4000-8000-000000000002';
const DRAFT_ABOUT_THEM = '10000000-0000-4000-8000-000000000003';

const SHARED_CAMPAIGN = '20000000-0000-4000-8000-000000000001';
const OWN_CAMPAIGN = '20000000-0000-4000-8000-000000000002';
const CAMPAIGN_ABOUT_THEM = '20000000-0000-4000-8000-000000000003';

describe('planAccountErasure', () => {
  it("preserves the dater's campaign and hands their draft back to them", () => {
    const plan = planAccountErasure({
      userId: INTRODUCER,
      drafts: [{ id: SHARED_DRAFT, created_by_user_id: INTRODUCER, subject_user_id: DATER }],
      campaigns: [{ id: SHARED_CAMPAIGN, pitch_draft_id: SHARED_DRAFT, owner_user_id: DATER }],
      rooms: [],
    });

    expect(plan.reassignments).toEqual([{ draftId: SHARED_DRAFT, newOwnerId: DATER }]);
    expect(plan.draftIds).toEqual([]);
    // The campaign row belongs to the dater; erasing the introducer must not
    // take it, its interests, or its intro rooms with it.
    expect(plan.campaignIds).toEqual([]);
  });

  it('erases an authored draft that never became someone else’s campaign', () => {
    const plan = planAccountErasure({
      userId: INTRODUCER,
      drafts: [{ id: OWN_DRAFT, created_by_user_id: INTRODUCER, subject_user_id: DATER }],
      campaigns: [],
      rooms: [],
    });

    expect(plan.draftIds).toEqual([OWN_DRAFT]);
    expect(plan.reassignments).toEqual([]);
  });

  it('erases the draft and campaign of a pitch made about the deleted user', () => {
    const plan = planAccountErasure({
      userId: DATER,
      drafts: [
        { id: DRAFT_ABOUT_THEM, created_by_user_id: OTHER_INTRODUCER, subject_user_id: DATER },
      ],
      campaigns: [
        { id: CAMPAIGN_ABOUT_THEM, pitch_draft_id: DRAFT_ABOUT_THEM, owner_user_id: DATER },
      ],
      rooms: [{ id: '40000000-0000-4000-8000-000000000001' }],
    });

    expect(plan.draftIds).toEqual([DRAFT_ABOUT_THEM]);
    expect(plan.campaignIds).toEqual([CAMPAIGN_ABOUT_THEM]);
    expect(plan.roomIds).toEqual(['40000000-0000-4000-8000-000000000001']);
    expect(plan.reassignments).toEqual([]);
  });

  it('keeps a self-authored campaign out of the reassignment path', () => {
    // A draft this user authored ABOUT THEMSELVES on their own campaign has no
    // other owner to hand it to; it must be erased, campaign included.
    const plan = planAccountErasure({
      userId: DATER,
      drafts: [{ id: OWN_DRAFT, created_by_user_id: DATER, subject_user_id: DATER }],
      campaigns: [{ id: OWN_CAMPAIGN, pitch_draft_id: OWN_DRAFT, owner_user_id: DATER }],
      rooms: [],
    });

    expect(plan.reassignments).toEqual([]);
    expect(plan.draftIds).toEqual([OWN_DRAFT]);
    expect(plan.campaignIds).toEqual([OWN_CAMPAIGN]);
  });
});

describe('collectVoiceDerivedPaths', () => {
  const RENDER_MP4 = `${SHARED_DRAFT}/renders/30000000-0000-4000-8000-000000000001.mp4`;

  function listing(): (folder: string) => Promise<readonly string[]> {
    const objects = new Map<string, readonly string[]>([
      [renderFolderPath(SHARED_DRAFT), [RENDER_MP4]],
    ]);
    return (folder) => Promise.resolve(objects.get(folder) ?? []);
  }

  it('erases the source recording of every preserved draft', async () => {
    await expect(collectVoiceDerivedPaths([SHARED_DRAFT], listing())).resolves.toContain(
      voiceObjectPath(SHARED_DRAFT),
    );
  });

  // The regression this whole task exists for: the renderer copies the
  // introducer's AAC stream into the MP4 untouched, so deleting only
  // `voice.m4a` left a bit-identical copy of the erased recording in storage,
  // still reachable through the kit's signed download route.
  it('erases the rendered MP4 that carries the same audio stream', async () => {
    await expect(collectVoiceDerivedPaths([SHARED_DRAFT], listing())).resolves.toContain(
      RENDER_MP4,
    );
  });

  it('names nothing under a draft that is not preserved for someone else', async () => {
    await expect(collectVoiceDerivedPaths([], listing())).resolves.toEqual([]);
  });

  it('does not name the dater’s own uploads under the preserved prefix', async () => {
    // Only the voice object and the renders folder are consulted; a photo the
    // dater supplied to the draft being kept for them is never listed.
    const paths = await collectVoiceDerivedPaths([SHARED_DRAFT], listing());

    expect(paths.some((path) => path.includes('photo'))).toBe(false);
    expect(paths).toHaveLength(2);
  });
});
