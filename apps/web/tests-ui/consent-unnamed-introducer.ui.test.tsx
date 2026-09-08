// UNCONFIRMED INTRODUCER NAME — consent surface (T002, Issue #71).
//
// `private.handle_new_auth_user` (0011) seeds `profiles.display_name` from the
// email local-part, and migration 0061 makes `get_consent_preview` return NULL
// for it until the introducer confirms a name. This page is opened by someone
// who is not signed in, so it is the one place that NULL is visible — and it
// must read as English, not as a hole in a sentence.
//
// This mounts the real ConsentFlow with `introducerDisplayName: null` and pins
// the no-name copy on both the review heading and the possessive lines.
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
        introducerDisplayName: null,
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

describe('the consent page when the introducer has not confirmed a display name', () => {
  beforeEach(() => {
    cleanup();
  });

  it('names the introducer as "your friend" instead of leaving a gap', async () => {
    const { container } = render(<ConsentFlow token="tok_test" />);
    await act(async () => {});

    expect(screen.getByText('Hear what your friend says about you.')).toBeTruthy();
    expect(
      screen.getByText(
        /This is your friend’s original voice — exactly what people will hear if you approve it\./,
      ),
    ).toBeTruthy();

    // Nothing anywhere on the page says "null", "undefined" or prints the
    // email-derived placeholder in a possessive it never earned.
    const text = container.textContent ?? '';
    expect(text).not.toContain('null');
    expect(text).not.toContain('undefined');
  });
});
