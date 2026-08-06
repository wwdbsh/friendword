/* global describe, expect, it */

// T013: the bench's memory instrument. The first production bench answered
// `self-maxrss` — Node alone, Chromium and ffmpeg excluded — so the T002
// verdict (peak ≤ 80% of the 2048MB budget) could not be reached. These tests
// pin the fallback chain and, above all, that `memorySource`/`sampled` never
// dress an approximation up as a kernel-tracked peak.

import { MEMORY_PATHS, startMemorySampler } from '@/lib/pitchRender/peakMemory';

const MAX_RSS = 300 * 1024 * 1024;

/** A fake procfs: named files answer, everything else is ENOENT. */
function fakeFs(files: Readonly<Record<string, string | readonly string[]>>): {
  readFile: (path: string) => Promise<string>;
  reads: string[];
} {
  const cursors = new Map<string, number>();
  const reads: string[] = [];
  return {
    reads,
    readFile: async (path) => {
      reads.push(path);
      const value = files[path];
      if (value === undefined) {
        const error: NodeJS.ErrnoException = new Error(`ENOENT: ${path}`);
        error.code = 'ENOENT';
        throw error;
      }
      if (typeof value === 'string') {
        return value;
      }
      // A sequence: successive reads walk it, the last value repeats.
      const cursor = cursors.get(path) ?? 0;
      cursors.set(path, cursor + 1);
      return value[Math.min(cursor, value.length - 1)] ?? '';
    },
  };
}

function sampler(files: Readonly<Record<string, string | readonly string[]>>) {
  // intervalMs 0: no timer, so the test drives sampling deterministically.
  return startMemorySampler({
    intervalMs: 0,
    readFile: fakeFs(files).readFile,
    maxRssBytes: () => MAX_RSS,
  });
}

describe('bench peak memory — source chain', () => {
  it('prefers the kernel peak and reports it as not sampled', async () => {
    const probe = sampler({
      [MEMORY_PATHS.cgroupV2Peak]: '1610612736\n',
      [MEMORY_PATHS.cgroupV2Current]: '900000000\n',
      [MEMORY_PATHS.cgroupV1MaxUsage]: '111\n',
    });
    await probe.sampleNow();

    const reading = await probe.read();

    expect(reading.source).toBe('cgroup-v2-peak');
    expect(reading.bytes).toBe(1_610_612_736);
    expect(reading.sampled).toBe(false);
  });

  it('falls to a polled memory.current maximum and admits it is sampled', async () => {
    const probe = sampler({
      // memory.peak absent — the Vercel case the first bench actually hit.
      [MEMORY_PATHS.cgroupV2Current]: ['400000000', '1200000000', '700000000'],
    });
    await probe.sampleNow();
    await probe.sampleNow();

    const reading = await probe.read();

    expect(reading.source).toBe('cgroup-v2-current-sampled');
    // The maximum OBSERVED, not the last reading — read() takes a third sample.
    expect(reading.bytes).toBe(1_200_000_000);
    expect(reading.sampled).toBe(true);
    expect(reading.samples).toBe(3);
  });

  it('falls to the cgroup v1 high-water mark when v2 is absent', async () => {
    const probe = sampler({ [MEMORY_PATHS.cgroupV1MaxUsage]: '1073741824\n' });

    const reading = await probe.read();

    expect(reading.source).toBe('cgroup-v1-max-usage');
    expect(reading.bytes).toBe(1_073_741_824);
    expect(reading.sampled).toBe(false);
    expect(reading.samples).toBe(0);
  });

  it('lands on self-maxrss only when every cgroup source is unavailable', async () => {
    const probe = sampler({});

    const reading = await probe.read();

    expect(reading.source).toBe('self-maxrss');
    expect(reading.bytes).toBe(MAX_RSS);
    expect(reading.sampled).toBe(false);
  });

  it('treats an unparsable or zero peak as absent rather than reporting 0', async () => {
    const probe = sampler({
      [MEMORY_PATHS.cgroupV2Peak]: 'max\n',
      [MEMORY_PATHS.cgroupV1MaxUsage]: '0\n',
    });

    const reading = await probe.read();

    expect(reading.source).toBe('self-maxrss');
    expect(reading.bytes).toBe(MAX_RSS);
  });
});

describe('bench peak memory — probe diagnostics', () => {
  it('names every source it tried and why it failed', async () => {
    const probe = sampler({ [MEMORY_PATHS.cgroupV2Peak]: '2000\n' });

    const { probes } = await probe.read();

    expect(probes.map((entry) => entry.path)).toEqual([
      MEMORY_PATHS.cgroupV2Peak,
      MEMORY_PATHS.cgroupV2Current,
      MEMORY_PATHS.cgroupV1MaxUsage,
    ]);
    expect(probes[0]).toEqual({ path: MEMORY_PATHS.cgroupV2Peak, ok: true, detail: 'ok' });
    expect(probes[1]?.ok).toBe(false);
    expect(probes[1]?.detail).toContain('ENOENT');
    expect(probes[2]).toEqual({
      path: MEMORY_PATHS.cgroupV1MaxUsage,
      ok: false,
      detail: 'ENOENT',
    });
  });

  it('summarises the sampling run so the next bench sees what worked', async () => {
    const probe = sampler({ [MEMORY_PATHS.cgroupV2Current]: ['500', '900'] });
    await probe.sampleNow();

    const { probes } = await probe.read();

    expect(probes[1]?.ok).toBe(true);
    expect(probes[1]?.detail).toBe('2 samples, 0 failed, max 900');
  });

  it('reads nothing after stop(), so the response cannot outrun the pass', async () => {
    const fs = fakeFs({ [MEMORY_PATHS.cgroupV2Current]: '500' });
    const probe = startMemorySampler({
      intervalMs: 0,
      readFile: fs.readFile,
      maxRssBytes: () => MAX_RSS,
    });
    probe.stop();
    probe.stop();

    await probe.read();
    const afterRead = fs.reads.length;
    probe.stop();

    expect(fs.reads.filter((path) => path === MEMORY_PATHS.cgroupV2Current)).toHaveLength(1);
    expect(fs.reads).toHaveLength(afterRead);
  });
});
