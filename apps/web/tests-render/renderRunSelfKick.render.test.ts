/* global afterEach, beforeEach, describe, expect, it, vi */

// The render worker's pass-end self-kick. runRenderPass stops CLAIMING 90s in
// while one render alone takes ~150s, so a pass that rendered job A exits
// without claiming queued job B — and if the kit page is closed by then,
// nothing else ever kicks and B stalls forever. Pinned here:
//   (a) processed > 0 → one follow-up kick is scheduled (after()) with the
//       request's own origin,
//   (b) processed = 0 → NO kick: an idle pass ends the chain, which is the
//       chain's termination proof.

const mocks = vi.hoisted(() => ({
  getSupabaseServiceClient: vi.fn<() => unknown>(() => ({})),
  runRenderPass: vi.fn<() => Promise<{ processed: number; jobs: readonly unknown[] }>>(
    async () => ({ processed: 0, jobs: [] }),
  ),
  triggerRenderRun: vi.fn(async () => undefined),
  after: vi.fn((callback: () => unknown) => {
    callback();
  }),
}));

vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, after: (callback: () => unknown) => mocks.after(callback) };
});

vi.mock('@/lib/supabaseServer', () => ({
  getSupabaseServiceClient: mocks.getSupabaseServiceClient,
}));

vi.mock('@/lib/pitchRender/jobRunner', () => ({
  runRenderPass: mocks.runRenderPass,
}));

vi.mock('@/lib/pitchRender/trigger', () => ({
  triggerRenderRun: mocks.triggerRenderRun,
}));

import { POST } from '../app/api/media/render-run/route';

const SECRET = 'unit-render-secret-0123456789';

function renderRunRequest(): Request {
  return new Request('http://127.0.0.1:3120/api/media/render-run', {
    method: 'POST',
    headers: { authorization: `Bearer ${SECRET}` },
  });
}

describe('render-run route — pass-end self-kick', () => {
  beforeEach(() => {
    process.env.FRIENDWORD_MEDIA_RENDER_SECRET = SECRET;
    mocks.getSupabaseServiceClient.mockReturnValue({});
    mocks.runRenderPass.mockClear();
    mocks.triggerRenderRun.mockClear();
    mocks.after.mockClear();
    mocks.after.mockImplementation((callback: () => unknown) => {
      callback();
    });
  });

  afterEach(() => {
    delete process.env.FRIENDWORD_MEDIA_RENDER_SECRET;
  });

  it('schedules one follow-up kick when the pass processed a job', async () => {
    mocks.runRenderPass.mockResolvedValueOnce({
      processed: 1,
      jobs: [{ jobId: 'job-1', revisionId: 'rev-1', outcome: 'succeeded' }],
    });

    const response = await POST(renderRunRequest());

    expect(response.status).toBe(200);
    expect(mocks.after).toHaveBeenCalledTimes(1);
    expect(mocks.triggerRenderRun).toHaveBeenCalledTimes(1);
    expect(mocks.triggerRenderRun).toHaveBeenCalledWith('http://127.0.0.1:3120');
  });

  it('does NOT kick after an idle pass — the chain terminates', async () => {
    mocks.runRenderPass.mockResolvedValueOnce({ processed: 0, jobs: [] });

    const response = await POST(renderRunRequest());

    expect(response.status).toBe(200);
    expect(mocks.after).not.toHaveBeenCalled();
    expect(mocks.triggerRenderRun).not.toHaveBeenCalled();
  });

  it('still answers with the summary when after() throws outside a request scope', async () => {
    mocks.runRenderPass.mockResolvedValueOnce({
      processed: 2,
      jobs: [],
    });
    mocks.after.mockImplementation(() => {
      throw new Error('after was called outside a request scope');
    });

    const response = await POST(renderRunRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ processed: 2, jobs: [] });
    expect(mocks.triggerRenderRun).not.toHaveBeenCalled();
  });
});
