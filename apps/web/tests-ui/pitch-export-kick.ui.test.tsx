// MP4 EXPORT — render worker kick wiring (Phase 4 activation slice).
// The queue has no cron: a queued job is only ever claimed because something
// POSTed /api/media/render-kick. Pinned here, in jsdom where the effects run:
//  1. a successful export request fires exactly one fire-and-forget kick with
//     the caller's own access token (browsers never hold the worker secret),
//  2. every poll tick while a render is in flight kicks once more — the
//     opportunistic re-push that revives a queue whose first kick was lost,
//  3. idle / done / failed states never kick: no render is in flight, so a
//     push would be pure noise against the worker route,
//  4. a kick failure never surfaces in the UI — the card renders exactly as
//     if the kick had succeeded (best-effort by design).
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

const harness = vi.hoisted(() => ({
  states: [] as FakeRenderState[],
  stateCalls: 0,
  requests: [] as string[],
  approvedRevisionId: null as string | null,
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
    trackEvent: () => undefined,
  };
});

import { PitchExportCard } from '../app/kit/[draftId]/PitchExportCard';

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

let fetchMock: ReturnType<typeof vi.fn>;

function kickCalls(): [string, RequestInit][] {
  return (fetchMock.mock.calls as [string, RequestInit][]).filter(
    ([url]) => url === '/api/media/render-kick',
  );
}

describe('kit MP4 export card — render worker kick wiring', () => {
  beforeEach(() => {
    harness.states = [];
    harness.stateCalls = 0;
    harness.requests = [];
    harness.approvedRevisionId = null;
    fetchMock = vi.fn(() => Promise.resolve(new Response('{}', { status: 202 })));
    vi.stubGlobal('fetch', fetchMock);
    cleanup();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('kicks the worker once, with the caller token, after a successful export request', async () => {
    vi.useFakeTimers();
    harness.approvedRevisionId = REVISION_A;
    harness.states = [
      renderState({}),
      renderState({ jobId: 'job-1', jobStatus: 'queued', revisionId: REVISION_A }),
    ];

    mountCard();
    await act(async () => {});
    expect(kickCalls()).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Export the MP4' }));
    await act(async () => {});

    expect(harness.requests).toEqual([CAMPAIGN_ID]);
    const calls = kickCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[1]).toMatchObject({
      method: 'POST',
      headers: { authorization: 'Bearer token-1' },
    });
  });

  it('kicks once per poll tick while a render is in flight', async () => {
    vi.useFakeTimers();
    harness.states = [renderState({ jobId: 'job-1', jobStatus: 'queued', revisionId: REVISION_A })];

    mountCard();
    await act(async () => {});
    expect(kickCalls()).toHaveLength(0);

    // First tick at 4s, second at +6s (1.5x backoff).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000);
    });
    expect(kickCalls()).toHaveLength(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000);
    });
    expect(kickCalls()).toHaveLength(2);
  });

  it('never kicks while idle, done, or failed — nothing is in flight to push', async () => {
    vi.useFakeTimers();
    for (const state of [
      renderState({}),
      renderState({
        jobId: 'job-1',
        jobStatus: 'done',
        revisionId: REVISION_A,
        outputStoragePath: `pitch-media/${DRAFT_ID}/renders/${REVISION_A}.mp4`,
        freeRenderUsed: true,
      }),
      renderState({ jobId: 'job-1', jobStatus: 'failed', revisionId: REVISION_A }),
    ]) {
      cleanup();
      harness.states = [state];
      harness.stateCalls = 0;
      harness.approvedRevisionId = REVISION_A;

      mountCard();
      await act(async () => {});
      await act(async () => {
        await vi.advanceTimersByTimeAsync(120_000);
      });

      expect(kickCalls()).toHaveLength(0);
    }
  });

  it('a kick failure never surfaces in the UI', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(() => Promise.reject(new TypeError('network down')));
    harness.approvedRevisionId = REVISION_A;
    harness.states = [
      renderState({}),
      renderState({ jobId: 'job-1', jobStatus: 'queued', revisionId: REVISION_A }),
    ];

    mountCard();
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: 'Export the MP4' }));
    await act(async () => {});

    // The card shows the render in flight exactly as if the kick had landed.
    expect(screen.getByText('Rendering your MP4…')).toBeTruthy();
    expect(screen.queryByText('We couldn’t start the export. Please try again.')).toBeNull();
  });
});
