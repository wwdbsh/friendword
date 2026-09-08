// KIT LOAD FAILURES — M-10 / M-16.
//
// The launch kit had exactly one failure screen: "We hit a snag. The kit could
// not load. Refresh to try again." It was shown for every reason the load could
// fail, including the two most likely ones — a mistyped draft id, and a link
// belonging to somebody else's pitch. Both of those are answered by PostgREST
// as PGRST116 ("0 rows", because `.single()` found none, or because RLS hid the
// one that exists), and for both of them "refresh to try again" is an
// instruction that can never succeed. These tests pin the split: an unretryable
// miss says the link is not theirs, a genuinely transient failure keeps the
// refresh copy, and the two never bleed into each other.
//
// The 401 half (M-16) covers the same class of lie one layer down: a download
// whose bearer token the server rejects is a dead session, not a flaky
// request, so the card offers a way to sign in instead of a retry.
/* global describe, expect, it, beforeEach, afterEach */

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';

const DRAFT_ID = '33333333-3333-4333-8333-333333333333';
const CAMPAIGN_ID = '11111111-1111-4111-8111-111111111111';
const REVISION_ID = '44444444-4444-4444-8444-444444444444';

const FAKE_SESSION = {
  access_token: 'ui-access-token',
  user: { id: '00000000-0000-4000-8000-000000000002' },
} as const;

const harness = vi.hoisted(() => ({
  /** What PitchDraftRepo.getDraft rejects with, per test. */
  draftFailure: null as unknown,
}));

vi.mock('@friendword/data', () => {
  class DataLayerError extends Error {
    constructor(
      readonly operation: string,
      public override readonly cause: unknown,
    ) {
      super(`Supabase operation failed: ${operation}`);
    }
  }
  class CreatorCreditRequiredError extends Error {}
  class KitNotPublishedError extends Error {}
  class BenefitsRepo {}
  class PitchDraftRepo {
    getDraft() {
      return Promise.reject(harness.draftFailure);
    }
  }
  class RenderJobRepo {
    getRenderState() {
      return Promise.resolve({
        jobId: 'job-1',
        jobStatus: 'done' as const,
        revisionId: REVISION_ID,
        outputStoragePath: `pitch-media/${DRAFT_ID}/renders/${REVISION_ID}.mp4`,
        lastError: null,
        freeRenderUsed: true,
        passActive: false,
        updatedAt: null,
      });
    }
  }
  return {
    BenefitsRepo,
    CreatorCreditRequiredError,
    DataLayerError,
    KitNotPublishedError,
    PitchDraftRepo,
    RenderJobRepo,
    signInWithOtp: () => Promise.resolve(),
    trackEvent: () => undefined,
    verifyOtp: () => Promise.resolve(),
  };
});

const client = vi.hoisted(() => ({
  auth: {
    getSession: () =>
      Promise.resolve({
        data: { session: { access_token: 'ui-access-token' } },
        error: null,
      }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }),
  },
  from: () => ({
    select: () => ({
      eq: () => ({
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
        eq: () => ({
          order: () => ({
            order: () => ({
              limit: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }),
            }),
          }),
        }),
      }),
    }),
  }),
}));

vi.mock('@/lib/supabaseClient', () => ({ getSupabaseBrowserClient: () => client }));

vi.mock('@/lib/useSession', () => ({
  useSession: () => ({ session: FAKE_SESSION, loading: false, ended: false }),
}));

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children?: unknown }) => (
    <a href={href}>{children as never}</a>
  ),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(''),
}));

import { DataLayerError } from '@friendword/data';

import { KitView } from '../app/kit/[draftId]/KitView';
import { PitchExportCard } from '../app/kit/[draftId]/PitchExportCard';

function pageText(): string {
  return document.body.textContent ?? '';
}

describe('the launch kit tells a missing kit apart from a broken one (M-10)', () => {
  beforeEach(() => {
    harness.draftFailure = null;
    cleanup();
  });

  it('says the link is not theirs — and never offers a refresh — when the draft is not visible', async () => {
    // PGRST116 is what `.single()` returns both for a draft id that does not
    // exist and for one RLS hides from this caller. Same sentence either way.
    harness.draftFailure = new DataLayerError('pitchDraft.get', {
      code: 'PGRST116',
      message: 'JSON object requested, multiple (or no) rows returned',
    });

    render(<KitView draftId={DRAFT_ID} />);
    await waitFor(() => expect(pageText()).toContain('We can’t find that kit.'));

    const text = pageText();
    expect(text).toContain('doesn’t point at a pitch on your account');
    expect(text).not.toContain('We hit a snag');
    expect(text).not.toContain('Refresh to try again');
  });

  it('keeps the retryable copy when the load fails for any other reason', async () => {
    harness.draftFailure = new TypeError('Failed to fetch');

    render(<KitView draftId={DRAFT_ID} />);
    await waitFor(() => expect(pageText()).toContain('We hit a snag.'));

    const text = pageText();
    expect(text).toContain('Refresh to try again');
    expect(text).not.toContain('We can’t find that kit.');
  });

  it('does not mistake a non-PGRST116 PostgREST failure for a missing kit', async () => {
    // A JWT that expired between page load and query is transient: signing in
    // again or simply retrying fixes it, and it must not read as "not yours".
    harness.draftFailure = new DataLayerError('pitchDraft.get', {
      code: 'PGRST301',
      message: 'JWT expired',
    });

    render(<KitView draftId={DRAFT_ID} />);
    await waitFor(() => expect(pageText()).toContain('We hit a snag.'));
    expect(pageText()).not.toContain('We can’t find that kit.');
  });
});

describe('a revoked session during download asks for a sign-in, not a retry (M-16)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    cleanup();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function mountReadyCard() {
    render(
      <PitchExportCard
        client={client as never}
        draftId={DRAFT_ID}
        campaignId={CAMPAIGN_ID}
        campaignSlug="demo-real"
      />,
    );
    await act(async () => {});
    return screen.getByRole('button', { name: /download/i });
  }

  it('offers the sign-in form when render-download answers 401', async () => {
    fetchMock = vi.fn(() =>
      Promise.resolve(new Response('{"error":"authentication required"}', { status: 401 })),
    );
    vi.stubGlobal('fetch', fetchMock);

    const button = await mountReadyCard();
    fireEvent.click(button);
    await waitFor(() => expect(pageText()).toContain('Your session expired'));

    const text = pageText();
    expect(text).toContain('Sign in again and the download will work');
    // The lie this replaces. A retry sends the same dead token.
    expect(text).not.toContain('The download didn’t complete');
    // The way out is on the page, not just described in it.
    expect(document.querySelector('[data-render-signed-out] form')).not.toBeNull();
  });

  it('keeps the retry copy — and no sign-in form — for a non-401 download failure', async () => {
    fetchMock = vi.fn(() => Promise.resolve(new Response('nope', { status: 502 })));
    vi.stubGlobal('fetch', fetchMock);

    const button = await mountReadyCard();
    fireEvent.click(button);
    await waitFor(() => expect(pageText()).toContain('The download didn’t complete'));

    expect(pageText()).not.toContain('Your session expired');
    expect(document.querySelector('[data-render-signed-out]')).toBeNull();
  });
});
