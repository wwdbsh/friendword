import { describe, expect, it, vi } from 'vitest';

import { renderStatic } from '../../testing/renderStatic';

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
const prepare = vi.hoisted(() => vi.fn());

vi.mock('expo-router', () => ({ useRouter: () => router }));
vi.mock('../../services/aiConsent', () => ({
  hasCurrentAiProcessingConsent: vi.fn(async () => true),
}));
vi.mock('../../services/draftServiceInstance', () => ({
  pitchDraftService: { listMyDrafts: vi.fn(async () => ({ drafts: [], sync: 'confirmed' })) },
}));
vi.mock('../../services/pitchDrafts', () => ({
  isUnconfirmedSubmission: () => false,
  unconfirmedDraftMessage: () => '',
}));
vi.mock('../../services/pitchDraftsSupabase', () => ({ NeedsSignInError: class extends Error {} }));
vi.mock('./preparePitchReview', () => ({
  getAiDraftFailureMessage: () => 'failed',
  isAiConsentRequiredFailure: () => false,
  isManualRecapRequiredFailure: () => false,
  preparePitchReview: prepare,
}));

import { usePitchSubmission } from './usePitchSubmission';
import type { PitchDraftId } from '../../services/types';

const DRAFT_ID = 'draft-1' as PitchDraftId;

/**
 * Renders the hook once and hands back what it returned. `renderToStaticMarkup`
 * runs the component body (so `useState`/`useRef` behave), and deliberately
 * does not run effects — the consent refresh this hook kicks off on mount is
 * not what these tests are about.
 */
function mountSubmission(): ReturnType<typeof usePitchSubmission> {
  let captured: ReturnType<typeof usePitchSubmission> | null = null;
  function Probe() {
    captured = usePitchSubmission(DRAFT_ID, vi.fn());
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
    router.push.mockClear();
    router.replace.mockClear();
    prepare.mockResolvedValue({});

    await mountSubmission().writeManually();

    expect(router.push).not.toHaveBeenCalled();
    expect(router.replace).toHaveBeenCalledWith({
      pathname: '/pitch/review',
      params: { draftId: DRAFT_ID },
    });
  });

  it('navigates only after the draft is actually prepared', async () => {
    router.replace.mockClear();
    prepare.mockRejectedValue(new Error('server refused'));

    await mountSubmission().submitAi();

    expect(router.replace).not.toHaveBeenCalled();
  });
});
