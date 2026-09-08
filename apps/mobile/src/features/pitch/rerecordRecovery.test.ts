import { describe, expect, it, vi } from 'vitest';

// The recovery reuses the real failure-message mapper, which reaches the
// Supabase client through the consent module. There is no native runtime here
// and this suite never signs anything in.
vi.mock('../../services/supabaseClient', () => ({ getSupabaseClient: () => null }));

import { PitchDraftSchema, type PitchDraft } from '../../services/types';
import {
  discardRefusedTake,
  furthestResumableTrack,
  INSUFFICIENT_SPEECH_NOTICE,
  parseRequestedTrack,
  RECORDING_TRACK,
  rerecordRoute,
  resumeComposerState,
  sendBackToRecordAgain,
  shouldShowRerecordNotice,
} from './rerecordRecovery';

function makeDraft(overrides: Record<string, unknown> = {}): PitchDraft {
  return PitchDraftSchema.parse({
    id: 'draft-1',
    status: 'draft',
    contextRole: 'INTRODUCER',
    relationship: {
      kind: 'Friend',
      duration: '1–3 years',
      friendFirstName: 'Dahee',
      contact: { kind: 'email', value: 'dahee@example.com' },
    },
    photos: [
      { uri: 'file:///a.jpg', width: 800, height: 600 },
      { uri: 'file:///b.jpg', width: 800, height: 600 },
    ],
    clips: [],
    recording: { uri: 'file:///take.m4a', durationMillis: 36_000, caption: '' },
    server: {
      draftId: '11111111-1111-4111-8111-111111111111',
      consentRequestId: null,
      consentToken: null,
      mediaUploaded: true,
    },
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  });
}

// T001 follow-up (issue #70). The server refuses an inaudible take with 422 and
// deletes the stored object; every screen that can receive that refusal has to
// leave the draft in the same state — this draft, at its recording step, with
// the take gone.
describe('recovering from a take the server could not hear', () => {
  it('sends the introducer to the recording step of the SAME draft', () => {
    expect(rerecordRoute(makeDraft().id)).toEqual({
      pathname: '/pitch/new',
      params: { draftId: 'draft-1', track: '4', notice: INSUFFICIENT_SPEECH_NOTICE },
    });
    // Not a new pitch, and not the review screen — which cannot prepare a draft
    // that has no voice track.
    expect(RECORDING_TRACK).toBe(4);
  });

  it('drops this device’s claim that the deleted voice object still exists', async () => {
    const discardStoredRecording = vi.fn(async () => makeDraft({ recording: null }));

    const recovery = await discardRefusedTake({ discardStoredRecording }, makeDraft().id);

    expect(discardStoredRecording).toHaveBeenCalledWith(makeDraft().id);
    expect(recovery).toEqual({ kind: 'rerecord' });
  });

  it('navigates only after the refused take is actually dropped', async () => {
    const replace = vi.fn();
    const discardStoredRecording = vi.fn(async () => makeDraft({ recording: null }));

    await sendBackToRecordAgain({ discardStoredRecording }, makeDraft().id, { replace });

    expect(replace).toHaveBeenCalledWith(rerecordRoute(makeDraft().id));
  });

  it('does not send them to a step that would refuse the new take', async () => {
    const replace = vi.fn();
    const discardStoredRecording = vi.fn(async () => {
      throw new Error('local draft is locked');
    });

    const recovery = await sendBackToRecordAgain({ discardStoredRecording }, makeDraft().id, {
      replace,
    });

    expect(recovery.kind).toBe('blocked');
    expect(replace).not.toHaveBeenCalled();
  });
});

// The composer used to ignore its route params entirely, so "record it again"
// opened an empty five-track wizard with the relationship and duration gone.
describe('reopening a saved draft in the composer', () => {
  it('restores the relationship, photos and take instead of starting over', () => {
    const resumed = resumeComposerState(makeDraft(), parseRequestedTrack('4'));

    expect(resumed.track).toBe(4);
    expect(resumed.relationshipKind).toBe('Friend');
    expect(resumed.relationshipDuration).toBe('1–3 years');
    expect(resumed.friendFirstName).toBe('Dahee');
    expect(resumed.contactValue).toBe('dahee@example.com');
    expect(resumed.photos).toHaveLength(2);
    // Track 5 renders from the saved relationship, not from the pickers.
    expect(resumed.savedRelationship?.friendFirstName).toBe('Dahee');
  });

  it('reopens a draft whose take was just discarded at the recording step', () => {
    const discarded = makeDraft({ recording: null });

    expect(furthestResumableTrack(discarded)).toBe(4);
    expect(resumeComposerState(discarded, parseRequestedTrack('4')).recording).toBeNull();
  });

  it('never renders a step the saved draft cannot fill', () => {
    // Track 5 reads the take; asking for it with none is what left the screen
    // blank, so the request is capped rather than honoured.
    expect(resumeComposerState(makeDraft({ recording: null }), 5).track).toBe(4);
    // Every track past the first reads the relationship.
    expect(resumeComposerState(makeDraft({ relationship: null }), 4).track).toBe(1);
  });

  it('ignores a track param that is not a track', () => {
    expect(parseRequestedTrack(undefined)).toBeNull();
    expect(parseRequestedTrack('0')).toBeNull();
    expect(parseRequestedTrack('6')).toBeNull();
    expect(parseRequestedTrack('4')).toBe(4);
    // With nothing requested, a complete draft opens at its review step.
    expect(resumeComposerState(makeDraft(), null).track).toBe(5);
  });
});

// Device QA: the refusal DID reach the recording step, but as `saveErrorMessage`
// under the recorder card — below the fold on a phone, so the introducer saw a
// reset recorder and no reason for it.
describe('telling the introducer why the recording step came back', () => {
  const take = { uri: 'file:///take.m4a', durationMillis: 36_000, caption: '' };

  it('shows the notice on the step with the take cleared', () => {
    expect(shouldShowRerecordNotice('record it again', null, false)).toBe(true);
  });

  it('drops it the moment a new take starts, not when it finishes', () => {
    expect(shouldShowRerecordNotice('record it again', null, true)).toBe(false);
    // A take already in hand means they acted on it.
    expect(shouldShowRerecordNotice('record it again', take, false)).toBe(false);
  });

  it('shows nothing on an ordinary visit to the recording step', () => {
    expect(shouldShowRerecordNotice(null, null, false)).toBe(false);
  });
});
