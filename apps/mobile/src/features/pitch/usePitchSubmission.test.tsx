import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderStatic } from '../../testing/renderStatic';

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
const prepare = vi.hoisted(() => vi.fn());
const discardStoredRecording = vi.hoisted(() => vi.fn(async () => ({})));

vi.mock('expo-router', () => ({ useRouter: () => router }));
vi.mock('../../services/supabaseClient', () => ({ getSupabaseClient: () => null }));
vi.mock('../../services/aiConsent', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  hasCurrentAiProcessingConsent: vi.fn(async () => true),
}));
vi.mock('../../services/draftServiceInstance', () => ({
  pitchDraftService: {
    listMyDrafts: vi.fn(async () => ({ drafts: [], sync: 'confirmed' })),
    discardStoredRecording,
  },
}));
vi.mock('../../services/pitchDrafts', () => ({
  isUnconfirmedSubmission: () => false,
  unconfirmedDraftMessage: () => '',
}));
vi.mock('../../services/pitchDraftsSupabase', () => ({ NeedsSignInError: class extends Error {} }));
// Only the orchestrator is stubbed: the failure predicates under test are the
// real ones, so this cannot pass on a mock that always agrees with the branch.
vi.mock('./preparePitchReview', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  preparePitchReview: prepare,
}));

import { DraftGenerationError } from '../../services/draftGeneration';
import { INSUFFICIENT_SPEECH_MESSAGE } from './preparePitchReview';
import { usePitchSubmission } from './usePitchSubmission';
import type { PitchDraftId } from '../../services/types';

const DRAFT_ID = 'draft-1' as PitchDraftId;

// N1: every stub is reset here rather than per test, so a failing assertion
// cannot leave a queued rejection or a recorded navigation behind for the next
// test to read as its own.
beforeEach(() => {
  router.push.mockReset();
  router.replace.mockReset();
  prepare.mockReset();
  discardStoredRecording.mockReset();
  discardStoredRecording.mockResolvedValue({});
});

/**
 * Renders the hook once and hands back what it returned. `renderToStaticMarkup`
 * runs the component body (so `useState`/`useRef` behave), and deliberately
 * does not run effects — the consent refresh this hook kicks off on mount is
 * not what these tests are about.
 */
function mountSubmission(
  setErrorMessage: (message: string | null) => void = vi.fn(),
  onNeedsRerecord?: () => void,
): ReturnType<typeof usePitchSubmission> {
  let captured: ReturnType<typeof usePitchSubmission> | null = null;
  function Probe() {
    captured = usePitchSubmission(DRAFT_ID, setErrorMessage, onNeedsRerecord);
    return null;
  }
  renderStatic(<Probe />);
  if (captured === null) {
    throw new Error('the hook did not run');
  }
  return captured;
}

// MUI-4. The composer used to be PUSHED under the review screen, and the review
// screen replaces itself with /pitch/share once the pitch is sent. One back
// gesture from "your pitch is on its way" therefore landed on the five-track
// wizard for the pitch that had just gone.
describe('leaving the composer for the prepared review', () => {
  it('replaces the composer rather than stacking the review on top of it', async () => {
    prepare.mockResolvedValue({});

    await mountSubmission().writeManually();

    expect(router.push).not.toHaveBeenCalled();
    expect(router.replace).toHaveBeenCalledWith({
      pathname: '/pitch/review',
      params: { draftId: DRAFT_ID },
    });
  });

  it('navigates only after the draft is actually prepared', async () => {
    prepare.mockRejectedValue(new Error('server refused'));

    await mountSubmission().submitAi();

    expect(router.replace).not.toHaveBeenCalled();
  });
});

// T001 (issue #70). A recording that transcribed to nothing usable is refused
// by the server with nothing written, and retrying the same upload would fail
// identically — the only way forward is a new take.
describe('a recording the server could not hear', () => {
  it('sends the introducer back to record again instead of navigating on', async () => {
    const setErrorMessage = vi.fn();
    const onNeedsRerecord = vi.fn();
    prepare.mockRejectedValue(new DraftGenerationError(422, 'insufficient_speech'));

    await mountSubmission(setErrorMessage, onNeedsRerecord).submitAi();

    // The device's claim that the voice object exists has to go first, or the
    // recording step cannot accept the new take.
    expect(discardStoredRecording).toHaveBeenCalledWith(DRAFT_ID);
    expect(onNeedsRerecord).toHaveBeenCalledOnce();
    expect(setErrorMessage).toHaveBeenCalledWith(INSUFFICIENT_SPEECH_MESSAGE);
    expect(router.replace).not.toHaveBeenCalled();
    // N2 (leaving the consent state alone) is not asserted here on purpose:
    // this harness renders the hook once and never re-renders, so a state
    // update made after the await is not observable through the returned
    // object. Asserting on it would pass whatever the branch did.
  });

  it('does not send the introducer on when the stored take could not be dropped', async () => {
    const setErrorMessage = vi.fn();
    const onNeedsRerecord = vi.fn();
    prepare.mockRejectedValue(new DraftGenerationError(422, 'insufficient_speech'));
    discardStoredRecording.mockRejectedValue(new Error('local draft is locked'));

    await mountSubmission(setErrorMessage, onNeedsRerecord).submitAi();

    // Sending them to a step that will refuse the new take would be a worse
    // dead end than the error they are shown instead.
    expect(onNeedsRerecord).not.toHaveBeenCalled();
    expect(setErrorMessage).not.toHaveBeenCalledWith(INSUFFICIENT_SPEECH_MESSAGE);
  });

  it('does not send a different failure back to the recording step', async () => {
    const onNeedsRerecord = vi.fn();
    prepare.mockRejectedValue(new DraftGenerationError(429, null));

    await mountSubmission(vi.fn(), onNeedsRerecord).submitAi();

    expect(onNeedsRerecord).not.toHaveBeenCalled();
  });
});
