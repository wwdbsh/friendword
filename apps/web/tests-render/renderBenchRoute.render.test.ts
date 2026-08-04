/* global afterEach, beforeEach, describe, expect, it */

// /api/media/render-bench — the Linux 실측 instrument. The unit half pins the
// same secret discipline as render-run (501 unconfigured, 401 on a wrong
// bearer — no fixture work, no browser, no ffmpeg happens before the gate).
// The full bench — a real 1,845-frame worst-case render against a running
// `next start` — is gated behind PITCH_RENDER_E2E=1 exactly like the capture
// e2e, because CI boxes without Chrome must stay green and the pass takes
// minutes.

import { POST } from '../app/api/media/render-bench/route';

const SECRET = 'unit-render-secret-0123456789';
const BASE_URL = process.env.PITCH_RENDER_BASE_URL ?? 'http://127.0.0.1:3120';
const E2E = process.env.PITCH_RENDER_E2E === '1';

function benchRequest(authorization?: string): Request {
  return new Request(`${BASE_URL}/api/media/render-bench`, {
    method: 'POST',
    headers: authorization === undefined ? {} : { authorization },
  });
}

describe('render-bench route — secret gate', () => {
  beforeEach(() => {
    process.env.FRIENDWORD_MEDIA_RENDER_SECRET = SECRET;
  });

  afterEach(() => {
    delete process.env.FRIENDWORD_MEDIA_RENDER_SECRET;
  });

  it('501 when the secret is not configured', async () => {
    delete process.env.FRIENDWORD_MEDIA_RENDER_SECRET;
    const response = await POST(benchRequest(`Bearer ${SECRET}`));
    expect(response.status).toBe(501);
  });

  it('401 without a bearer token', async () => {
    const response = await POST(benchRequest());
    expect(response.status).toBe(401);
  });

  it('401 on a wrong secret', async () => {
    const response = await POST(benchRequest('Bearer not-the-secret-but-long-enough'));
    expect(response.status).toBe(401);
  });
});

describe.runIf(E2E)('render-bench route — full worst-case measurement', () => {
  beforeEach(() => {
    process.env.FRIENDWORD_MEDIA_RENDER_SECRET = SECRET;
  });

  afterEach(() => {
    delete process.env.FRIENDWORD_MEDIA_RENDER_SECRET;
  });

  it('renders 1,845 frames from synthetic fixtures and answers metrics JSON', async () => {
    const response = await POST(benchRequest(`Bearer ${SECRET}`));
    const payload = (await response.json()) as Record<string, unknown>;
    console.log(`[render bench] ${JSON.stringify(payload, null, 2)}`);

    expect(response.status).toBe(200);
    // 60s scene at 30fps (1,800) + 1.5s end card (45) — the measured worst case.
    expect(payload.frames).toBe(1_845);
    expect(payload.fps).toBe(30);
    expect(payload.instanceId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(typeof payload.coldStart).toBe('boolean');
    expect(payload.renderMs).toBeGreaterThan(0);
    expect(payload.captureMs).toBeGreaterThan(0);
    expect(payload.outputBytes).toBeGreaterThan(1e6);
    expect(payload.peakMemoryBytes).toBeGreaterThan(0);
    expect(['cgroup-v2-peak', 'self-maxrss']).toContain(payload.memorySource);
    expect(payload.audio).toBe(true);
  });
});
