// MP4 EXPORT REGRESSION — kit export card lifecycle (Phase 4).
// Pinned here, in jsdom where React effect lifecycles actually run:
//  1. the poll applies an async "done" result after mount (the effect-
//     cancellation incident class this suite exists for: a polling effect
//     keyed on the state object it writes cancels its own fetch and the
//     finished render never appears),
//  2. unmount stops the poll chain — no timers keep hitting the server,
//  3. E3: a finished render for an OUTDATED revision is labeled stale and
//     never presented as the current file,
//  4. E2: the "already in progress" refusal consumed nothing and must never
//     render a Campaign Pass prompt or fire the paywall-view event,
//  5. the "campaign pass required" refusal (free render genuinely spent) is
//     the only path that shows the pass copy,
//  6. a download fetches a signed URL with the caller's token and reports
//     the kit_mp4_download channel.
/* global afterEach, beforeEach, describe, expect, it */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { vi } from 'vitest';

import type { BrowserSupabaseClient } from '@friendword/data';

type FakeRenderState = {
  jobId: string | null;
  jobStatus: 'queued' | 'leased' | 'done' | 'failed' | null;
  revisionId: string | null;
  outputStoragePath: string | null;
  lastError: string | null;
  freeRenderUsed: boolean;
  passActive: boolean;
  updatedAt: string | null;
};

const CAMPAIGN_ID = '11111111-1111-4111-8111-111111111111';
const DRAFT_ID = '22222222-2222-4222-8222-222222222222';
const REVISION_A = '33333333-3333-4333-8333-333333333333';
const REVISION_B = '44444444-4444-4444-8444-444444444444';

const harness = vi.hoisted(() => ({
  states: [] as FakeRenderState[],
  stateCalls: 0,
  requestError: null as Error | null,
  requests: [] as string[],
  approvedRevisionId: null as string | null,
  tracked: [] as { name: string; props: Record<string, unknown> }[],
}));

function renderState(overrides: Partial<FakeRenderState>): FakeRenderState {
  return {
    jobId: null,
    jobStatus: null,
    revisionId: null,
    outputStoragePath: null,
    lastError: null,
    freeRenderUsed: false,
    passActive: false,
    updatedAt: null,
    ...overrides,
  };
}

vi.mock('@friendword/data', () => {
  class DataLayerError extends Error {
    constructor(
      scope: string,
      public override readonly cause: unknown,
    ) {
      super(scope);
    }
  }
  class RenderJobRepo {
    getRenderState() {
      const state = harness.states[Math.min(harness.stateCalls, harness.states.length - 1)];
      harness.stateCalls += 1;
      return Promise.resolve(state);
    }
    requestRender(campaignId: string) {
      harness.requests.push(campaignId);
      if (harness.requestError !== null) {
        return Promise.reject(harness.requestError);
      }
      return Promise.resolve({
        jobId: 'job-1',
        jobStatus: 'queued',
        revisionId: REVISION_A,
        outputStoragePath: null,
        alreadyRequested: false,
      });
    }
  }
  return {
    DataLayerError,
    RenderJobRepo,
    trackEvent: (_client: unknown, name: string, props: Record<string, unknown>) => {
      harness.tracked.push({ name, props });
    },
  };
});

import { PitchExportCard } from '../app/kit/[draftId]/PitchExportCard';
import { DataLayerError } from '@friendword/data';

function makeClient(): BrowserSupabaseClient {
  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: () => builder,
    order: () => builder,
    limit: () => builder,
    maybeSingle: () =>
      Promise.resolve({
        data:
          harness.approvedRevisionId === null ? null : { revision_id: harness.approvedRevisionId },
        error: null,
      }),
  };
  return {
    from: () => builder,
    auth: {
      getSession: () =>
        Promise.resolve({ data: { session: { access_token: 'token-1' } }, error: null }),
    },
  } as unknown as BrowserSupabaseClient;
}

/** Stands in for an MP4 body; only its length is load-bearing here. */
const MP4_BODY = 'ftypisom'.repeat(8);

/** Puts the card in the one state that offers a download. */
function doneState(): boolean {
  harness.approvedRevisionId = REVISION_A;
  harness.states = [
    renderState({
      jobId: 'job-1',
      jobStatus: 'done',
      revisionId: REVISION_A,
      outputStoragePath: `pitch-media/${DRAFT_ID}/renders/${REVISION_A}.mp4`,
      freeRenderUsed: true,
    }),
  ];
  return true;
}

/** Records every anchor the card actually clicks, without letting jsdom try to
 *  navigate. */
function captureAnchorClicks(): { download: string; href: string }[] {
  const clicked: { download: string; href: string }[] = [];
  const create = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation((tag: string, options?: unknown) => {
    const element = create(tag as 'a', options as ElementCreationOptions | undefined);
    if (tag === 'a') {
      element.addEventListener('click', (event) => {
        event.preventDefault();
        const anchor = element as HTMLAnchorElement;
        clicked.push({ download: anchor.download, href: anchor.getAttribute('href') ?? '' });
      });
    }
    return element;
  });
  return clicked;
}

/** jsdom has no object-URL implementation; hand out predictable handles and
 *  keep the blobs so their size can be asserted. */
function stubObjectUrl(): Blob[] {
  const blobs: Blob[] = [];
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: (blob: Blob) => {
      blobs.push(blob);
      return `blob:friendword/${blobs.length - 1}`;
    },
    revokeObjectURL: () => undefined,
  });
  return blobs;
}

function stubDownloadFetch(body: string, declaredLength: string) {
  const fetchMock = vi.fn(() =>
    Promise.resolve(
      new Response(body, {
        status: 200,
        headers: { 'content-length': declaredLength, 'content-type': 'video/mp4' },
      }),
    ),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function mountCard() {
  return render(
    <PitchExportCard
      client={makeClient()}
      draftId={DRAFT_ID}
      campaignId={CAMPAIGN_ID}
      campaignSlug="demo-real"
    />,
  );
}

describe('kit MP4 export card lifecycle', () => {
  beforeEach(() => {
    harness.states = [];
    harness.stateCalls = 0;
    harness.requestError = null;
    harness.requests = [];
    harness.approvedRevisionId = null;
    harness.tracked = [];
    cleanup();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    // The download tests spy on document.createElement; leaving it installed
    // would silently follow the next test into a different file.
    vi.restoreAllMocks();
  });

  it('applies the polled "done" state after a queued mount (effect-cancellation red)', async () => {
    vi.useFakeTimers();
    harness.approvedRevisionId = REVISION_A;
    harness.states = [
      renderState({ jobId: 'job-1', jobStatus: 'queued', revisionId: REVISION_A }),
      renderState({
        jobId: 'job-1',
        jobStatus: 'done',
        revisionId: REVISION_A,
        outputStoragePath: `pitch-media/${DRAFT_ID}/renders/${REVISION_A}.mp4`,
        freeRenderUsed: true,
      }),
    ];

    mountCard();
    await act(async () => {});
    expect(screen.getByText('Rendering your MP4…')).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000);
    });

    expect(screen.getByRole('button', { name: 'Download the MP4' })).toBeTruthy();
  });

  it('stops polling when the card unmounts', async () => {
    vi.useFakeTimers();
    harness.states = [renderState({ jobId: 'job-1', jobStatus: 'queued', revisionId: REVISION_A })];

    const { unmount } = mountCard();
    await act(async () => {});
    const callsBeforeUnmount = harness.stateCalls;
    unmount();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });

    expect(harness.stateCalls).toBe(callsBeforeUnmount);
  });

  it('E3: a finished render of an outdated revision is labeled, not served as current', async () => {
    harness.approvedRevisionId = REVISION_B;
    harness.states = [
      renderState({
        jobId: 'job-1',
        jobStatus: 'done',
        revisionId: REVISION_A,
        outputStoragePath: `pitch-media/${DRAFT_ID}/renders/${REVISION_A}.mp4`,
        freeRenderUsed: true,
      }),
    ];

    mountCard();
    await act(async () => {});

    expect(
      screen.getByText(
        'This finished MP4 is from an earlier approved version of the page — the page has changed since.',
      ),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Download the earlier version' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Export the current version' })).toBeTruthy();
    // Never presented as the current file.
    expect(screen.queryByText('Your MP4 is ready.')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Download the MP4' })).toBeNull();
  });

  it('E2: the "already in progress" refusal never shows a pass prompt', async () => {
    harness.states = [renderState({})];
    harness.requestError = new DataLayerError('render.request', {
      message: 'a render for this campaign is already in progress',
    });

    mountCard();
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: 'Export the MP4' }));
    await act(async () => {});

    expect(
      screen.getByText(
        'A render for this campaign is already running. Nothing was used — wait for it to finish and check back here.',
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/Campaign Pass/)).toBeNull();
    expect(harness.tracked.map((event) => event.name)).not.toContain(
      'campaign_pass_paywall_viewed',
    );
  });

  it('shows the pass copy only for the genuine "campaign pass required" refusal', async () => {
    harness.states = [renderState({ freeRenderUsed: true })];
    harness.requestError = new DataLayerError('render.request', {
      message: 'campaign pass required',
    });

    const { container } = mountCard();
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: 'Export the MP4' }));
    await act(async () => {});

    expect(container.querySelector('[data-render-pass-required]')?.textContent).toBe(
      'This campaign’s free export is used, so this export needs an active Campaign Pass. Purchase it in the Friendword app, then come back here.',
    );
    expect(harness.tracked).toContainEqual({
      name: 'campaign_pass_paywall_viewed',
      props: { campaign_id: CAMPAIGN_ID },
    });
  });

  it('saves the streamed bytes as a named same-origin file and reports the channel', async () => {
    // GAP-9: the card used to read a signed Supabase URL out of the response
    // and click an anchor at it. Cross-origin, `download` is inert — the save
    // and the filename both depended on a header from another origin, and a
    // browser that plays video/mp4 inline navigated this page away instead.
    // What is pinned here is the repaired shape: bytes → same-origin blob →
    // anchor that actually carries our filename.
    const finished = doneState();
    const anchors = captureAnchorClicks();
    const created = stubObjectUrl();
    const fetchMock = stubDownloadFetch(MP4_BODY, String(MP4_BODY.length));

    mountCard();
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: 'Download the MP4' }));
    await act(async () => {});

    expect(finished).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      `/kit/${DRAFT_ID}/render-download?revisionId=${REVISION_A}`,
      { headers: { authorization: 'Bearer token-1' } },
    );
    expect(anchors).toHaveLength(1);
    expect(anchors[0]?.download).toBe('friendword-pitch.mp4');
    expect(anchors[0]?.href).toBe('blob:friendword/0');
    expect(created.map((blob) => blob.size)).toEqual([MP4_BODY.length]);
    expect(screen.queryByText('The download didn’t complete. Please try again.')).toBeNull();
    expect(harness.tracked).toContainEqual({
      name: 'campaign_shared',
      props: { campaign_slug: 'demo-real', channel: 'kit_mp4_download' },
    });
  });

  it('refuses a truncated file instead of saving a video that stops early', async () => {
    doneState();
    const anchors = captureAnchorClicks();
    stubObjectUrl();
    // Declares more than it delivers — the shape a dropped stream takes.
    stubDownloadFetch(MP4_BODY, String(MP4_BODY.length + 4_096));

    mountCard();
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: 'Download the MP4' }));
    await act(async () => {});

    expect(anchors).toHaveLength(0);
    expect(screen.getByText('The download didn’t complete. Please try again.')).toBeTruthy();
    expect(harness.tracked.map((event) => event.props.channel)).not.toContain('kit_mp4_download');
  });

  it('reports a failed download in place instead of leaving the page', async () => {
    doneState();
    const anchors = captureAnchorClicks();
    stubObjectUrl();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('nope', { status: 502 }))),
    );

    mountCard();
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: 'Download the MP4' }));
    await act(async () => {});

    expect(anchors).toHaveLength(0);
    expect(screen.getByText('The download didn’t complete. Please try again.')).toBeTruthy();
    // The card is still here, with its button, because nothing navigated.
    expect(screen.getByRole('button', { name: 'Download the MP4' })).toBeTruthy();
  });
});
