// The render worker's kick trigger (pitchRender/trigger.ts). Pinned here:
//   (a) an unset secret sends NOTHING — the queue waits for an operator and
//       never processes unauthenticated,
//   (b) a set secret fires exactly one POST to /api/media/render-run with the
//       Bearer secret AND a timeout signal — the deliberate difference from
//       the ingest trigger, whose await would pin the kick invocation for the
//       whole ~260s pass,
//   (c) a rejected fetch (abort/timeout/network) is swallowed with a warn:
//       kicks are best-effort and a missed push is recovered by the next one.
/* global afterEach, beforeEach, describe, expect, it, vi */

const SECRET = 'unit-render-secret-0123456789';

import { triggerRenderRun } from '../src/lib/pitchRender/trigger';

describe('pitch render trigger', () => {
  beforeEach(() => {
    process.env.FRIENDWORD_MEDIA_RENDER_SECRET = SECRET;
  });

  afterEach(() => {
    delete process.env.FRIENDWORD_MEDIA_RENDER_SECRET;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('sends nothing while the secret is unset', async () => {
    delete process.env.FRIENDWORD_MEDIA_RENDER_SECRET;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await triggerRenderRun('https://friendword.example');

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fires one POST with the Bearer secret and a timeout signal', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);

    await triggerRenderRun('https://friendword.example');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://friendword.example/api/media/render-run');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ authorization: `Bearer ${SECRET}` });
    // The signal is the load-bearing difference from the ingest trigger: the
    // worker answers only when the whole pass finishes, and waiting for that
    // would hold the kick invocation past its own maxDuration.
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('swallows a rejected fetch with a warning instead of throwing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new DOMException('timed out', 'TimeoutError'))),
    );

    await expect(triggerRenderRun('https://friendword.example')).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
