/* global describe, expect, it */

// T013: the bench's memory instrument. The first production bench answered
// `self-maxrss` — Node alone, Chromium and ffmpeg excluded — so the T002
// verdict (peak ≤ 80% of the 2048MB budget) could not be reached. These tests
// pin the fallback chain and, above all, that `memorySource`/`sampled` never
// dress an approximation up as a kernel-tracked peak.

import { MEMORY_PATHS, procStatusPath, startMemorySampler } from '@/lib/pitchRender/peakMemory';

const MAX_RSS = 300 * 1024 * 1024;
/** The bench process itself in the simulated /proc trees below. */
const SELF_PID = 41;

function enoent(path: string): NodeJS.ErrnoException {
  const error: NodeJS.ErrnoException = new Error(`ENOENT: ${path}`);
  error.code = 'ENOENT';
  return error;
}

/**
 * A fake procfs: named files answer, everything else is ENOENT. Directories
 * answer only when the test declares them — an undeclared /proc is ENOENT,
 * which is exactly what darwin does and what the suite must not depend on the
 * host to provide.
 */
function fakeFs(
  files: Readonly<Record<string, string | readonly string[]>>,
  dirs: Readonly<Record<string, readonly string[]>> = {},
): {
  readFile: (path: string) => Promise<string>;
  readDir: (path: string) => Promise<readonly string[]>;
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
        throw enoent(path);
      }
      if (typeof value === 'string') {
        return value;
      }
      // A sequence: successive reads walk it, the last value repeats.
      const cursor = cursors.get(path) ?? 0;
      cursors.set(path, cursor + 1);
      return value[Math.min(cursor, value.length - 1)] ?? '';
    },
    readDir: async (path) => {
      const entries = dirs[path];
      if (entries === undefined) {
        throw enoent(path);
      }
      return entries;
    },
  };
}

function sampler(
  files: Readonly<Record<string, string | readonly string[]>>,
  dirs: Readonly<Record<string, readonly string[]>> = {},
) {
  const fs = fakeFs(files, dirs);
  // intervalMs 0: no timer, so the test drives sampling deterministically.
  return startMemorySampler({
    intervalMs: 0,
    readFile: fs.readFile,
    readDir: fs.readDir,
    maxRssBytes: () => MAX_RSS,
    selfPid: () => SELF_PID,
  });
}

/** One `/proc/<pid>/status`, trimmed to the two lines the sampler reads. */
function procStatus(input: {
  readonly pid: number;
  readonly ppid: number;
  readonly rssKb?: number;
}): string {
  const rss = input.rssKb === undefined ? '' : `VmRSS:\t${input.rssKb} kB\n`;
  // `Name:` is present in the real file and deliberately ignored: a process
  // command must never reach the bench response.
  return `Name:\tprocess-${input.pid}\nPid:\t${input.pid}\nPPid:\t${input.ppid}\n${rss}VmSwap:\t0 kB\n`;
}

/** Files + dirs for a simulated /proc holding the given processes. */
function fakeProc(
  processes: readonly { readonly pid: number; readonly ppid: number; readonly rssKb?: number }[],
  extraEntries: readonly string[] = [],
): {
  files: Record<string, string>;
  dirs: Record<string, readonly string[]>;
} {
  const files: Record<string, string> = {};
  for (const process of processes) {
    files[procStatusPath(process.pid)] = procStatus(process);
  }
  return {
    files,
    dirs: {
      [MEMORY_PATHS.procRoot]: [
        ...processes.map((process) => String(process.pid)),
        ...extraEntries,
      ],
    },
  };
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

  it('lands on self-maxrss only when every cgroup source AND /proc are unavailable', async () => {
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

// T014. Vercel answered ENOENT on all three cgroup files, which left
// self-maxrss — Node alone, the one number that cannot reach the T002 verdict
// because Chromium and ffmpeg are precisely what it excludes. These pin the
// /proc fallback that counts them, its place in the chain, and its honesty.
describe('bench peak memory — /proc process-tree fallback', () => {
  it('sums this process and every descendant, not just the direct children', async () => {
    // 41 self, 77 its child (Chromium), 91 a child of 77 (a renderer), 95 the
    // ffmpeg the bench spawned. 12 is init and 55 an unrelated neighbour:
    // counting either would inflate the verdict with memory we do not own.
    const proc = fakeProc([
      { pid: 12, ppid: 0, rssKb: 8_000 },
      { pid: SELF_PID, ppid: 12, rssKb: 100_000 },
      { pid: 55, ppid: 12, rssKb: 900_000 },
      { pid: 77, ppid: SELF_PID, rssKb: 400_000 },
      { pid: 91, ppid: 77, rssKb: 250_000 },
      { pid: 95, ppid: SELF_PID, rssKb: 50_000 },
    ]);
    const probe = sampler(proc.files, proc.dirs);

    const reading = await probe.read();

    expect(reading.source).toBe('proc-rss-sampled');
    expect(reading.bytes).toBe((100_000 + 400_000 + 250_000 + 50_000) * 1024);
    expect(reading.sampled).toBe(true);
    expect(reading.samples).toBe(1);
  });

  it('reports the maximum observed across the pass, not the last sample', async () => {
    // The tree is re-read every sample, so a child that grows and then frees
    // is simulated by a sequence of status contents at the same path.
    const child = (rssKb: number) => procStatus({ pid: 77, ppid: SELF_PID, rssKb });
    const probe = sampler(
      {
        [procStatusPath(SELF_PID)]: procStatus({ pid: SELF_PID, ppid: 1, rssKb: 100_000 }),
        [procStatusPath(77)]: [child(200_000), child(900_000), child(300_000)],
      },
      { [MEMORY_PATHS.procRoot]: [String(SELF_PID), '77'] },
    );
    await probe.sampleNow();
    await probe.sampleNow();

    // read() takes a third sample, which sees the SHRUNK tree.
    const reading = await probe.read();

    expect(reading.source).toBe('proc-rss-sampled');
    expect(reading.bytes).toBe((100_000 + 900_000) * 1024);
    expect(reading.samples).toBe(3);
  });

  it('ranks below every cgroup source — the kernel peak still wins', async () => {
    const proc = fakeProc([{ pid: SELF_PID, ppid: 1, rssKb: 2_000_000 }]);
    const probe = sampler(
      { ...proc.files, [MEMORY_PATHS.cgroupV2Peak]: '1610612736\n' },
      proc.dirs,
    );
    await probe.sampleNow();

    const reading = await probe.read();

    expect(reading.source).toBe('cgroup-v2-peak');
    expect(reading.bytes).toBe(1_610_612_736);
  });

  it('ranks below cgroup v1 max_usage too', async () => {
    const proc = fakeProc([{ pid: SELF_PID, ppid: 1, rssKb: 2_000_000 }]);
    const probe = sampler(
      { ...proc.files, [MEMORY_PATHS.cgroupV1MaxUsage]: '1073741824\n' },
      proc.dirs,
    );
    await probe.sampleNow();

    const reading = await probe.read();

    expect(reading.source).toBe('cgroup-v1-max-usage');
    expect(reading.bytes).toBe(1_073_741_824);
  });

  it('never walks /proc while memory.current is answering', async () => {
    const proc = fakeProc([{ pid: SELF_PID, ppid: 1, rssKb: 2_000_000 }]);
    const fs = fakeFs({ ...proc.files, [MEMORY_PATHS.cgroupV2Current]: '900000000' }, proc.dirs);
    const probe = startMemorySampler({
      intervalMs: 0,
      readFile: fs.readFile,
      readDir: fs.readDir,
      maxRssBytes: () => MAX_RSS,
      selfPid: () => SELF_PID,
    });
    await probe.sampleNow();

    const reading = await probe.read();

    expect(reading.source).toBe('cgroup-v2-current-sampled');
    expect(fs.reads.some((path) => path.startsWith(`${MEMORY_PATHS.procRoot}/`))).toBe(false);
  });

  it('falls honestly to self-maxrss where /proc does not exist (darwin)', async () => {
    // No dirs declared: readdir('/proc') is ENOENT, exactly as on darwin.
    const probe = sampler({});
    await probe.sampleNow();

    const reading = await probe.read();

    expect(reading.source).toBe('self-maxrss');
    expect(reading.bytes).toBe(MAX_RSS);
    expect(reading.sampled).toBe(false);
    const procProbe = (await probe.read()).probes.at(-1);
    expect(procProbe?.path).toBe(MEMORY_PATHS.procRoot);
    expect(procProbe?.ok).toBe(false);
    expect(procProbe?.detail).toContain('ENOENT');
  });

  it('refuses to answer from a /proc that does not even list this process', async () => {
    // A sum missing the bench's own Node process would be worse than silence.
    const proc = fakeProc([{ pid: 77, ppid: 1, rssKb: 500_000 }]);
    const probe = sampler(proc.files, proc.dirs);
    await probe.sampleNow();

    const reading = await probe.read();

    expect(reading.source).toBe('self-maxrss');
    expect(reading.probes.at(-1)?.detail).toContain('self-not-listed');
  });

  it('survives a descendant that exits mid-walk and a kernel thread with no VmRSS', async () => {
    // 79 is listed but its status file is gone — the classic procfs race.
    const proc = fakeProc(
      [
        { pid: SELF_PID, ppid: 1, rssKb: 100_000 },
        { pid: 77, ppid: SELF_PID, rssKb: 400_000 },
        // A kernel thread: listed, parented to us here, with no VmRSS line.
        { pid: 78, ppid: SELF_PID },
      ],
      ['79'],
    );
    const probe = sampler(proc.files, proc.dirs);

    const reading = await probe.read();

    expect(reading.source).toBe('proc-rss-sampled');
    expect(reading.bytes).toBe((100_000 + 400_000) * 1024);
  });

  it('ignores non-numeric /proc entries so procfs metadata is never parsed as a pid', async () => {
    const proc = fakeProc(
      [
        { pid: SELF_PID, ppid: 1, rssKb: 100_000 },
        { pid: 77, ppid: SELF_PID, rssKb: 400_000 },
      ],
      ['meminfo', 'self', 'sys', 'net'],
    );
    const probe = sampler(proc.files, proc.dirs);

    const reading = await probe.read();

    expect(reading.bytes).toBe((100_000 + 400_000) * 1024);
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
      MEMORY_PATHS.procRoot,
    ]);
    expect(probes[0]).toEqual({ path: MEMORY_PATHS.cgroupV2Peak, ok: true, detail: 'ok' });
    expect(probes[1]?.ok).toBe(false);
    expect(probes[1]?.detail).toContain('ENOENT');
    expect(probes[2]).toEqual({
      path: MEMORY_PATHS.cgroupV1MaxUsage,
      ok: false,
      detail: 'ENOENT',
    });
    expect(probes[3]?.ok).toBe(false);
    expect(probes[3]?.detail).toContain('ENOENT');
  });

  it('summarises the sampling run so the next bench sees what worked', async () => {
    const probe = sampler({ [MEMORY_PATHS.cgroupV2Current]: ['500', '900'] });
    await probe.sampleNow();

    const { probes } = await probe.read();

    expect(probes[1]?.ok).toBe(true);
    expect(probes[1]?.detail).toBe('2 samples, 0 failed, max 900');
  });

  it('names how many processes the /proc sum actually covered', async () => {
    // Without the count, a `proc-rss-sampled` reading is indistinguishable
    // from self-maxrss wearing a better name.
    const proc = fakeProc([
      { pid: SELF_PID, ppid: 1, rssKb: 100_000 },
      { pid: 77, ppid: SELF_PID, rssKb: 400_000 },
      { pid: 91, ppid: 77, rssKb: 250_000 },
    ]);
    const probe = sampler(proc.files, proc.dirs);

    const { probes } = await probe.read();

    expect(probes.at(-1)).toEqual({
      path: MEMORY_PATHS.procRoot,
      ok: true,
      detail: `1 samples, 3 processes, max ${750_000 * 1024}`,
    });
  });

  it('keeps process names out of the response', async () => {
    const proc = fakeProc([{ pid: SELF_PID, ppid: 1, rssKb: 100_000 }]);
    const probe = sampler(proc.files, proc.dirs);

    const reading = await probe.read();

    // procStatus() writes `Name: process-41`; nothing about a command line
    // belongs in a bench response, synthetic or not.
    expect(JSON.stringify(reading)).not.toContain('process-');
  });

  it('reads nothing after stop(), so the response cannot outrun the pass', async () => {
    const fs = fakeFs({ [MEMORY_PATHS.cgroupV2Current]: '500' });
    const probe = startMemorySampler({
      intervalMs: 0,
      readFile: fs.readFile,
      readDir: fs.readDir,
      maxRssBytes: () => MAX_RSS,
      selfPid: () => SELF_PID,
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
