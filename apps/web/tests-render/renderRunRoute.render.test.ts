/* global afterEach, beforeEach, describe, expect, it, vi */

// D5: /api/media/render-run is a worker endpoint behind the shared service
// secret — public access is structurally impossible. Same discipline as
// ingest-run: 501 when unconfigured, 401 on a missing or wrong bearer, and
// the queue pass runs ONLY after the exact secret matched.

const mocks = vi.hoisted(() => ({
  getSupabaseServiceClient: vi.fn<() => unknown>(() => ({})),
  runRenderPass: vi.fn(async () => ({ processed: 0, jobs: [] })),
}));

vi.mock('@/lib/supabaseServer', () => ({
  getSupabaseServiceClient: mocks.getSupabaseServiceClient,
}));

vi.mock('@/lib/pitchRender/jobRunner', () => ({
  runRenderPass: mocks.runRenderPass,
}));

import { POST } from '../app/api/media/render-run/route';

const SECRET = 'unit-render-secret-0123456789';

function renderRunRequest(authorization?: string): Request {
  return new Request('http://127.0.0.1:3120/api/media/render-run', {
    method: 'POST',
    headers: authorization === undefined ? {} : { authorization },
  });
}

describe('render-run route — secret gate (D5)', () => {
  beforeEach(() => {
    process.env.FRIENDWORD_MEDIA_RENDER_SECRET = SECRET;
    mocks.getSupabaseServiceClient.mockReturnValue({});
    mocks.runRenderPass.mockClear();
  });

  afterEach(() => {
    delete process.env.FRIENDWORD_MEDIA_RENDER_SECRET;
  });

  it('501 when the secret is not configured; the queue is never touched', async () => {
    delete process.env.FRIENDWORD_MEDIA_RENDER_SECRET;
    const response = await POST(renderRunRequest(`Bearer ${SECRET}`));
    expect(response.status).toBe(501);
    expect(mocks.runRenderPass).not.toHaveBeenCalled();
  });

  it('401 without a bearer token', async () => {
    const response = await POST(renderRunRequest());
    expect(response.status).toBe(401);
    expect(mocks.runRenderPass).not.toHaveBeenCalled();
  });

  it('401 on a wrong secret', async () => {
    const response = await POST(renderRunRequest('Bearer not-the-secret-but-long-enough'));
    expect(response.status).toBe(401);
    expect(mocks.runRenderPass).not.toHaveBeenCalled();
  });

  it('501 when the service client is unavailable even with the right secret', async () => {
    mocks.getSupabaseServiceClient.mockReturnValue(null);
    const response = await POST(renderRunRequest(`Bearer ${SECRET}`));
    expect(response.status).toBe(501);
    expect(mocks.runRenderPass).not.toHaveBeenCalled();
  });

  it('runs one queue pass and returns its summary only for the exact secret', async () => {
    const response = await POST(renderRunRequest(`Bearer ${SECRET}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ processed: 0, jobs: [] });
    expect(mocks.runRenderPass).toHaveBeenCalledTimes(1);
  });
});
