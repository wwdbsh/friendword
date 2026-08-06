/* global afterEach, beforeEach, describe, expect, it, vi */

// T012: /api/media/render-bench must answer a FAILED production pass with
// enough to name the failing stage and the cause candidate (binary integrity,
// headless/binary pairing, flag set, real memory) from the 500 body alone.
// Both cases below run without a browser: one dies in synthesis (real route,
// crippled ffmpeg), one dies deep in the engine (renderScene stubbed to emit
// the diagnostics a dying Chromium would and then throw).

import type { RenderSceneOptions, RenderSceneResult } from '@/lib/pitchRender/renderScene';
import type { LaunchProbe } from '@/lib/pitchRender/diagnostics';
import type { MemorySource } from '@/lib/pitchRender/peakMemory';

const SECRET = 'unit-render-secret-0123456789';
const BASE_URL = 'http://127.0.0.1:3120';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Every source the T013 chain may honestly report (peakMemory.ts). */
const MEMORY_SOURCES: readonly MemorySource[] = [
  'cgroup-v2-peak',
  'cgroup-v2-current-sampled',
  'cgroup-v1-max-usage',
  'self-maxrss',
];

const PROBE: LaunchProbe = {
  mode: 'sparticuz-linux',
  platform: 'linux-x64',
  executablePath: '/tmp/chromium',
  executableExists: true,
  executableBytes: 219_000_000,
  executableMode: '755',
  statError: null,
  resolveError: null,
  tmpDir: '/tmp',
  tmpFreeBytes: 100_000_000,
  tmpTotalBytes: 512_000_000,
  headless: 'shell',
  argCount: 2,
  args: '--no-sandbox --disable-gpu',
  argsTruncated: false,
};

function benchRequest(): Request {
  return new Request(`${BASE_URL}/api/media/render-bench`, {
    method: 'POST',
    headers: { authorization: `Bearer ${SECRET}` },
  });
}

async function postBench(): Promise<{ status: number; body: Record<string, unknown> }> {
  const route = await import('../app/api/media/render-bench/route');
  const response = await route.POST(benchRequest());
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

/** Every failure body, whatever the stage, keeps the pre-T012 contract. */
function expectLegacyFailureFields(body: Record<string, unknown>): void {
  expect(body.instanceId).toMatch(UUID);
  expect(body.coldStart).toBe(true);
  expect(typeof body.error).toBe('string');
  expect(typeof body.elapsedMs).toBe('number');
  expect(body.elapsedMs as number).toBeGreaterThanOrEqual(0);
}

describe('render-bench failure diagnostics', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.FRIENDWORD_MEDIA_RENDER_SECRET = SECRET;
  });

  afterEach(() => {
    vi.doUnmock('ffmpeg-static');
    vi.doUnmock('@/lib/pitchRender/renderScene');
    vi.resetModules();
    delete process.env.FRIENDWORD_MEDIA_RENDER_SECRET;
  });

  it('names the synthesis stage when the fixture inputs cannot be built', async () => {
    vi.doMock('ffmpeg-static', () => ({ default: null }));

    const { status, body } = await postBench();

    expect(status).toBe(500);
    expectLegacyFailureFields(body);
    expect(body.stage).toBe('input-synthesis');
    expect(body.errorName).toBe('Error');
    expect(body.error).toBe('ffmpeg-static did not resolve a binary for this platform');
    expect(typeof body.errorStack).toBe('string');
    expect(body.errorStack as string).toContain('Error:');
    expect(body.errorTruncated).toBe(false);
    // Nothing launched, so the browser fields are honestly empty — not absent.
    expect(body.launchProbe).toBeNull();
    expect(body.chromiumStderrTail).toBe('');
    expect(body.chromiumStderrBytes).toBe(0);
    expect(body.browserExitCode).toBeNull();
    expect(body.browserExitSignal).toBeNull();
    expect(body.peakMemoryBytes as number).toBeGreaterThan(0);
    expect(MEMORY_SOURCES).toContain(body.memorySource);
    // The source is only useful next to the honesty flag and the attempts.
    expect(typeof body.memorySampled).toBe('boolean');
    expect(body.memorySampled).toBe(body.memorySource === 'cgroup-v2-current-sampled');
    expect((body.memoryProbes as unknown[]).length).toBe(3);
  });

  it('carries stage, probe, stderr tail and exit signal when the engine dies mid-capture', async () => {
    const stubbed = async (
      _scene: unknown,
      _assets: unknown,
      options: RenderSceneOptions,
    ): Promise<RenderSceneResult> => {
      const diagnostics = options.diagnostics;
      diagnostics?.onStage?.('browser-launch');
      diagnostics?.launch?.onProbe?.(PROBE);
      diagnostics?.onStage?.('page-goto');
      diagnostics?.launch?.onStderr?.(Buffer.from('E'.repeat(40_000), 'utf8'));
      diagnostics?.onStage?.('capture');
      diagnostics?.launch?.onExit?.({ code: null, signal: 'SIGKILL' });
      const error = new Error('X'.repeat(50_000));
      error.stack = 'S'.repeat(80_000);
      throw error;
    };
    vi.doMock('@/lib/pitchRender/renderScene', () => ({ renderScene: stubbed }));

    const { status, body } = await postBench();

    expect(status).toBe(500);
    expectLegacyFailureFields(body);
    expect(body.stage).toBe('capture');
    expect(body.errorName).toBe('Error');
    expect(body.errorTruncated).toBe(true);
    // Ceilings, not "usually small": a runaway message must not become the
    // response body.
    expect(Buffer.byteLength(body.error as string, 'utf8')).toBe(2_000);
    expect(Buffer.byteLength(body.errorStack as string, 'utf8')).toBe(4_000);
    expect(body.chromiumStderrBytes).toBe(40_000);
    expect(Buffer.byteLength(body.chromiumStderrTail as string, 'utf8')).toBe(16_000);
    expect(body.chromiumStderrTruncated).toBe(true);
    expect(body.browserExitCode).toBeNull();
    expect(body.browserExitSignal).toBe('SIGKILL');
    expect(body.launchProbe).toEqual(PROBE);
    expect(body.peakMemoryBytes as number).toBeGreaterThan(0);
    expect(MEMORY_SOURCES).toContain(body.memorySource);
    // The source is only useful next to the honesty flag and the attempts.
    expect(typeof body.memorySampled).toBe('boolean');
    expect(body.memorySampled).toBe(body.memorySource === 'cgroup-v2-current-sampled');
    expect((body.memoryProbes as unknown[]).length).toBe(3);
  });

  it('leaks no authorization header or secret into the failure body', async () => {
    vi.doMock('ffmpeg-static', () => ({ default: null }));

    const { body } = await postBench();

    expect(JSON.stringify(body)).not.toContain(SECRET);
    expect(JSON.stringify(body).toLowerCase()).not.toContain('authorization');
  });
});
