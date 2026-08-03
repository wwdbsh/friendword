// MP4 END-CARD DISCLOSURE — consent surface (E6, docs/DECISIONS.md
// 2026-08-03). The end card is renderer chrome appended AFTER the approved
// timeline, so the Dater must be told about it AT approval time. This mounts
// the real ConsentFlow through claim → review and pins that the disclosure
// actually renders on the approve step — not that a string constant merely
// exists somewhere.
/* global beforeEach, describe, expect, it */

import { act, cleanup, render, screen } from '@testing-library/react';
import { vi } from 'vitest';

const DRAFT_ID = '22222222-2222-4222-8222-222222222222';
const REVISION_ID = '33333333-3333-4333-8333-333333333333';

const structure = {
  hook: 'The hook line',
  relationship_context: 'We met at work',
  three_specific_qualities: ['Kind', 'Curious', 'Steady'],
  evidence_or_anecdote: 'They drove two hours to help me move.',
  good_match_for: 'Someone who likes slow mornings.',
};

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
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
          asset_ids: [],
          voice_asset_path: null,
          content_hash: 'hash',
          scene_definition: null,
          scene_hash: null,
        },
        assets: [],
        hardClaims: [],
        editableStructure: structure,
        transcriptText: 'This is what I said about you.',
        transcriptSegments: [],
        transcriptWords: [],
        scene: null,
        daterEdited: false,
      });
    }
    getAiDisclosureRevision() {
      return Promise.resolve('ai-disclosure-1');
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

import { ConsentFlow } from '../app/consent/[token]/ConsentFlow';

describe('consent review disclosure of the exported video end card (E6)', () => {
  beforeEach(() => {
    cleanup();
  });

  it('renders the end-card notice on the approve step of the review', async () => {
    const { container } = render(<ConsentFlow token="tok_test" />);
    await act(async () => {});

    // The review actually opened (not an earlier step).
    expect(screen.getByText('Hear what Sam says about you.')).toBeTruthy();

    const note = container.querySelector('[data-consent-endcard-note]');
    expect(note).not.toBeNull();
    expect(note?.textContent).toContain(
      'If this pitch is exported as a video file, a short Friendword card — the Friendword name and your page’s address — plays after the end of everything you approve here.',
    );
    // The disclosure lives inside the approve step the Dater signs off on.
    expect(note?.closest('#consent-step-approve')).not.toBeNull();
  });
});
