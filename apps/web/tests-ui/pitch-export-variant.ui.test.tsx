// MP4 EXPORT — the pre-render choice (T005, REEL_V3_DESIGN §0 verdict 2 / §4).
// 0054 keeps ONE job per approved revision and a repeat request hands back the
// stored job, so the cut is chosen BEFORE the first request and then belongs to
// that job for its life. Pinned here:
//  1. the defaults the design names — Highlight selected, music on — and that
//     they are what a straight-to-export click actually sends,
//  2. a changed choice reaches requestRender as {variant, options:{music}},
//  3. while the APPROVED REVISION's job is queued, leased or done there is no
//     chooser and the card reports the recorded choice instead — but the state
//     RPC returns the campaign's LATEST job, so a job belonging to an older
//     revision, and a failed job the reset path lets you re-choose (0063 §3),
//     must both re-open the chooser,
//  4. a pre-0063 finished row (effective_variant null, variant at the column
//     DEFAULT 'highlight') reads as Full — the MP4 on record is the full
//     timeline the old worker made, and mislabeling it would name the file
//     after a cut that was never rendered,
//  5. the download is named per variant, so a later export of the other cut
//     cannot overwrite this one in the same folder.
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
  variant: 'full' | 'highlight' | null;
  effectiveVariant: 'full' | 'highlight' | null;
  options: { music?: boolean } | null;
};

const CAMPAIGN_ID = '11111111-1111-4111-8111-111111111111';
const DRAFT_ID = '22222222-2222-4222-8222-222222222222';
const REVISION_A = '33333333-3333-4333-8333-333333333333';
const REVISION_B = '44444444-4444-4444-8444-444444444444';

const harness = vi.hoisted(() => ({
  states: [] as FakeRenderState[],
  stateCalls: 0,
  requests: [] as { campaignId: string; choice: unknown }[],
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
    variant: null,
    effectiveVariant: null,
    options: null,
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
    requestRender(campaignId: string, choice: unknown) {
      harness.requests.push({ campaignId, choice });
      return Promise.resolve({
        jobId: 'job-1',
        jobStatus: 'queued',
        revisionId: REVISION_A,
        outputStoragePath: null,
        alreadyRequested: false,
      });
    }
  }
  return { DataLayerError, RenderJobRepo, trackEvent: () => undefined };
});

import { PitchExportCard, recordedRenderVariant } from '../app/kit/[draftId]/PitchExportCard';

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

function mountCard(daterName: string | null = 'Blair') {
  return render(
    <PitchExportCard
      client={makeClient()}
      draftId={DRAFT_ID}
      campaignId={CAMPAIGN_ID}
      campaignSlug="demo-real"
      daterName={daterName}
    />,
  );
}

// jsdom implements neither half of the object-URL API. These no-ops live on the
// real global rather than behind vi.stubGlobal because the card revokes on a
// 0ms timer, which can outlive the test that started the download — a stub
// removed by unstubAllGlobals first turned that into an uncaught TypeError.
Object.assign(URL, {
  createObjectURL: () => 'blob:friendword/0',
  revokeObjectURL: () => undefined,
});

function chip(value: 'highlight' | 'full'): HTMLButtonElement {
  const found = document.querySelector<HTMLButtonElement>(`[data-render-variant="${value}"]`);
  if (found === null) {
    throw new Error(`no ${value} chip`);
  }
  return found;
}

/** Records the anchor the card clicks without letting jsdom navigate. */
function captureAnchorClicks(): { download: string }[] {
  const clicked: { download: string }[] = [];
  const create = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation((tag: string, options?: unknown) => {
    const element = create(tag as 'a', options as ElementCreationOptions | undefined);
    if (tag === 'a') {
      element.addEventListener('click', (event) => {
        event.preventDefault();
        clicked.push({ download: (element as HTMLAnchorElement).download });
      });
    }
    return element;
  });
  return clicked;
}

async function downloadFrom(state: FakeRenderState): Promise<{ download: string }[]> {
  harness.approvedRevisionId = REVISION_A;
  harness.states = [state];
  const clicked = captureAnchorClicks();
  vi.stubGlobal('fetch', () =>
    Promise.resolve(new Response('ftypisom', { status: 200, headers: { 'content-length': '8' } })),
  );
  mountCard();
  await act(async () => {});
  fireEvent.click(screen.getByText('Download the MP4'));
  await act(async () => {});
  return clicked;
}

describe('the kit export card chooses the cut before the render', () => {
  beforeEach(() => {
    harness.states = [];
    harness.stateCalls = 0;
    harness.requests = [];
    harness.approvedRevisionId = null;
    cleanup();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('offers Highlight (selected) and Full with music on, and names the Dater', async () => {
    harness.states = [renderState({})];
    mountCard();
    await act(async () => {});

    expect(chip('highlight').getAttribute('aria-pressed')).toBe('true');
    expect(chip('full').getAttribute('aria-pressed')).toBe('false');
    expect(document.querySelector<HTMLInputElement>('[data-render-music]')?.checked).toBe(true);
    expect(
      screen.getByText(
        'One MP4 per approved version — pick before you export. Highlight uses only what Blair approved: same words, shorter cut.',
      ),
    ).toBeTruthy();
    // The free-render rule is untouched by the new chooser.
    expect(
      screen.getByText(
        'The first export this campaign finishes is free. A failed attempt doesn’t use it.',
      ),
    ).toBeTruthy();
  });

  it('sends the defaults when the person just exports', async () => {
    harness.states = [renderState({})];
    mountCard();
    await act(async () => {});
    fireEvent.click(screen.getByText('Export the MP4'));
    await act(async () => {});

    expect(harness.requests).toEqual([
      { campaignId: CAMPAIGN_ID, choice: { variant: 'highlight', options: { music: true } } },
    ]);
  });

  it('threads a changed choice into the request', async () => {
    harness.states = [renderState({})];
    mountCard();
    await act(async () => {});
    fireEvent.click(chip('full'));
    fireEvent.click(document.querySelector('[data-render-music]') as HTMLInputElement);
    fireEvent.click(screen.getByText('Export the MP4'));
    await act(async () => {});

    expect(harness.requests).toEqual([
      { campaignId: CAMPAIGN_ID, choice: { variant: 'full', options: { music: false } } },
    ]);
  });

  it('locks the choice while the approved revision’s job is in flight', async () => {
    harness.approvedRevisionId = REVISION_A;
    harness.states = [
      renderState({
        jobId: 'job-1',
        jobStatus: 'queued',
        revisionId: REVISION_A,
        variant: 'highlight',
        options: { music: false },
      }),
    ];
    mountCard();
    await act(async () => {});

    expect(document.querySelector('[data-render-choice]')).toBeNull();
    expect(document.querySelector('[data-render-variant="full"]')).toBeNull();
    expect(document.querySelector('[data-render-choice-recorded]')?.textContent).toBe(
      'This export was requested as Highlight (15–30s), no music.',
    );
  });

  it('reports the worker’s fallback, not the request, once it is recorded', async () => {
    harness.approvedRevisionId = REVISION_A;
    harness.states = [
      renderState({
        jobId: 'job-1',
        jobStatus: 'done',
        revisionId: REVISION_A,
        outputStoragePath: `pitch-media/${DRAFT_ID}/renders/${REVISION_A}.mp4`,
        variant: 'highlight',
        effectiveVariant: 'full',
        options: { music: true },
      }),
    ];
    mountCard();
    await act(async () => {});

    expect(document.querySelector('[data-render-choice-recorded]')?.textContent).toBe(
      'This export was requested as Full, music on.',
    );
  });

  it('reads a pre-0063 finished row as Full and names the file that way', async () => {
    // What the RPC returns for a job that finished before 0063: no
    // effective_variant, and `variant` sitting at the column DEFAULT.
    const preRow = renderState({
      jobId: 'job-1',
      jobStatus: 'done',
      revisionId: REVISION_A,
      outputStoragePath: `pitch-media/${DRAFT_ID}/renders/${REVISION_A}.mp4`,
      freeRenderUsed: true,
      variant: 'highlight',
      effectiveVariant: null,
      options: null,
    });
    expect(recordedRenderVariant(preRow)).toBe('full');

    const clicked = await downloadFrom(preRow);
    expect(clicked).toEqual([{ download: 'friendword-pitch-full.mp4' }]);
  });

  it('names a finished highlight download for its own cut', async () => {
    const clicked = await downloadFrom(
      renderState({
        jobId: 'job-1',
        jobStatus: 'done',
        revisionId: REVISION_A,
        outputStoragePath: `pitch-media/${DRAFT_ID}/renders/${REVISION_A}.mp4`,
        freeRenderUsed: true,
        variant: 'highlight',
        effectiveVariant: 'highlight',
        options: { music: true },
      }),
    );
    expect(clicked).toEqual([{ download: 'friendword-pitch-highlight.mp4' }]);
  });

  // ── The chooser follows the APPROVED REVISION, not "any job exists" ──────
  // get_pitch_render_state returns the campaign's LATEST job (0063 §4, ORDER BY
  // created_at DESC LIMIT 1). Keying the lock on "a job exists" made the first
  // export's choice silently govern every later revision — including the one
  // the Campaign Pass is paid for — and hid the re-choice the RPC's reset path
  // grants a failed job (0063 §3).
  it('offers the choice again for a NEW approved revision and sends the fresh one', async () => {
    harness.approvedRevisionId = REVISION_B;
    harness.states = [
      renderState({
        jobId: 'job-1',
        jobStatus: 'done',
        revisionId: REVISION_A,
        outputStoragePath: `pitch-media/${DRAFT_ID}/renders/${REVISION_A}.mp4`,
        freeRenderUsed: true,
        variant: 'highlight',
        effectiveVariant: 'highlight',
        options: { music: true },
      }),
    ];
    mountCard();
    await act(async () => {});

    expect(document.querySelector('[data-render-choice]')).toBeTruthy();
    // The previous job's choice is not restated as this export's.
    expect(document.querySelector('[data-render-choice-recorded]')).toBeNull();

    fireEvent.click(chip('full'));
    fireEvent.click(document.querySelector('[data-render-music]') as HTMLInputElement);
    fireEvent.click(screen.getByRole('button', { name: 'Export the current version' }));
    await act(async () => {});

    expect(harness.requests).toEqual([
      { campaignId: CAMPAIGN_ID, choice: { variant: 'full', options: { music: false } } },
    ]);
  });

  it('does not let a pre-0063 finished row of an OLD revision force Full on the new one', async () => {
    // The pre-0063 row reads as Full for its own FILE (effective_variant null),
    // but that says nothing about the revision now awaiting an export.
    harness.approvedRevisionId = REVISION_B;
    harness.states = [
      renderState({
        jobId: 'job-1',
        jobStatus: 'done',
        revisionId: REVISION_A,
        outputStoragePath: `pitch-media/${DRAFT_ID}/renders/${REVISION_A}.mp4`,
        freeRenderUsed: true,
        variant: 'highlight',
        effectiveVariant: null,
        options: null,
      }),
    ];
    mountCard();
    await act(async () => {});

    expect(chip('highlight').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Export the current version' }));
    await act(async () => {});

    expect(harness.requests).toEqual([
      { campaignId: CAMPAIGN_ID, choice: { variant: 'highlight', options: { music: true } } },
    ]);
  });

  it('re-opens the choice after a failed job, as the reset path allows', async () => {
    harness.approvedRevisionId = REVISION_A;
    harness.states = [
      renderState({
        jobId: 'job-1',
        jobStatus: 'failed',
        revisionId: REVISION_A,
        lastError: 'ffmpeg exited 1',
        variant: 'full',
        options: { music: false },
      }),
    ];
    mountCard();
    await act(async () => {});

    expect(document.querySelector('[data-render-choice]')).toBeTruthy();
    expect(document.querySelector('[data-render-choice-recorded]')).toBeNull();
    expect(screen.getByText('The export failed.')).toBeTruthy();

    fireEvent.click(chip('full'));
    fireEvent.click(screen.getByRole('button', { name: 'Try the export again' }));
    await act(async () => {});

    expect(harness.requests).toEqual([
      { campaignId: CAMPAIGN_ID, choice: { variant: 'full', options: { music: true } } },
    ]);
  });

  it('keeps a done job for the SAME approved revision locked', async () => {
    harness.approvedRevisionId = REVISION_A;
    harness.states = [
      renderState({
        jobId: 'job-1',
        jobStatus: 'done',
        revisionId: REVISION_A,
        outputStoragePath: `pitch-media/${DRAFT_ID}/renders/${REVISION_A}.mp4`,
        freeRenderUsed: true,
        variant: 'full',
        effectiveVariant: 'full',
        options: { music: true },
      }),
    ];
    mountCard();
    await act(async () => {});

    expect(document.querySelector('[data-render-choice]')).toBeNull();
    expect(document.querySelector('[data-render-choice-recorded]')?.textContent).toBe(
      'This export was requested as Full, music on.',
    );
  });
});
