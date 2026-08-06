import { readdir as readdirAsync, readFile as readFileAsync } from 'node:fs/promises';

// The bench's memory instrument (T013). The T002 verdict is "peak ≤ 80% of the
// instance budget" — 2048MB when it was written, 4GB since the move to a Pro
// Performance machine (T014) — and that verdict is only meaningful if the
// number counts the CHILDREN: a render pass is Node plus a headless Chromium plus
// ffmpeg, and Node's own maxRSS sees none of them. The first production bench
// answered `self-maxrss` — cgroup v2's memory.peak is not exposed on Vercel —
// so the verdict could not be reached at all.
//
// Hence a chain, ordered most to least trustworthy, with the source reported
// honestly so a reader never mistakes an approximation for a kernel high-water
// mark:
//
//   1. cgroup-v2-peak              /sys/fs/cgroup/memory.peak
//      The kernel's own maximum — what the OOM killer enforces. Exact.
//   2. cgroup-v2-current-sampled   /sys/fs/cgroup/memory.current, polled
//      memory.peak can be absent while memory.current is readable. Polling it
//      across the pass gives the maximum OBSERVED, which can miss a spike
//      between samples: an approximation, and `sampled` says so.
//   3. cgroup-v1-max-usage         /sys/fs/cgroup/memory/memory.max_usage_in_bytes
//      The v1 equivalent of memory.peak. Exact where the host is still v1.
//   4. proc-rss-sampled            /proc/<pid>/status VmRSS, self + descendants
//      T014. The production probe came back with all THREE cgroup files
//      ENOENT on Vercel, which left self-maxrss — the one answer that cannot
//      reach the verdict, because Chromium and ffmpeg are exactly what it
//      excludes. Summing VmRSS across the process TREE counts them. Polled, so
//      it is an approximation like (2) and says so; and it double-counts
//      nothing that matters less than it over-counts shared pages (see below).
//   5. self-maxrss                 process.resourceUsage().maxRSS
//      Last resort: this Node process ALONE. Children excluded.
//
// Every attempt is reported in `probes` so the next bench shows which fallback
// actually answered on this platform instead of leaving it to be guessed
// again. Probe details carry a path, an outcome and a byte count — no file
// contents beyond the number, and nothing user-derived: this route touches no
// user data at all. In particular the /proc walk reads `status` but keeps only
// PPid and VmRSS; the `Name:` line (a process's command) never leaves it.
//
// Honest limits of (4), because the T002 verdict rests on the number:
//   - Summing per-process RSS COUNTS SHARED PAGES ONCE PER PROCESS. Chromium's
//     zygote/renderer split shares a lot, so the sum is an UPPER bound on real
//     footprint, not an estimate of it. For a "peak ≤ 80% of budget" verdict an
//     upper bound is the safe direction to be wrong in.
//   - It is polled, so a spike between two samples is invisible.
//   - It sees only processes alive at sample time; a child that allocated hard
//     and exited between samples is missed.

export const MEMORY_PATHS = {
  cgroupV2Peak: '/sys/fs/cgroup/memory.peak',
  cgroupV2Current: '/sys/fs/cgroup/memory.current',
  cgroupV1MaxUsage: '/sys/fs/cgroup/memory/memory.max_usage_in_bytes',
  procRoot: '/proc',
} as const;

/** `/proc/<pid>/status` — PPid and VmRSS in one read, per process. */
export function procStatusPath(pid: number): string {
  return `${MEMORY_PATHS.procRoot}/${pid}/status`;
}

export type MemorySource =
  | 'cgroup-v2-peak'
  | 'cgroup-v2-current-sampled'
  | 'cgroup-v1-max-usage'
  | 'proc-rss-sampled'
  | 'self-maxrss';

/** What one source was asked, and what it answered. */
export type MemoryProbe = {
  readonly path: string;
  readonly ok: boolean;
  /** 'ok', an errno code ('ENOENT'), 'unparsable', or a sampling summary. */
  readonly detail: string;
};

export type MemoryReading = {
  readonly bytes: number;
  readonly source: MemorySource;
  /** true when `bytes` is a polled maximum, not a kernel-tracked peak. */
  readonly sampled: boolean;
  /**
   * How many successful samples stand behind `bytes` — 0 whenever `sampled` is
   * false, because a kernel high-water mark is not sampled at all. Both
   * sampled sources keep their own full tally in `probes` regardless of which
   * one answered.
   */
  readonly samples: number;
  readonly probes: readonly MemoryProbe[];
};

export type MemorySamplerOptions = {
  /** Poll period for memory.current. 0 disables the timer (tests drive it). */
  readonly intervalMs?: number;
  readonly readFile?: (path: string) => Promise<string>;
  readonly readDir?: (path: string) => Promise<readonly string[]>;
  readonly maxRssBytes?: () => number;
  /** Root of the /proc walk. Injected by tests; production is this process. */
  readonly selfPid?: () => number;
};

export type MemorySampler = {
  /** Take one sample now; the timer calls this too. */
  sampleNow(): Promise<void>;
  /** Stop polling. Idempotent, and always safe to call twice. */
  stop(): void;
  /** Stop, take a final sample, then resolve the chain above. */
  read(): Promise<MemoryReading>;
};

/**
 * 750ms: ~1,000 one-line procfs reads across the 770s worst-case bench budget.
 * The cost is unmeasurable next to a 1,845-frame capture, and the window is
 * short enough that a transient allocation spike is unlikely to hide entirely
 * between two samples. Where the /proc fallback is the one answering, a sample
 * costs one small read per process on the box instead of one — still nothing
 * against a capture, and bench-only either way.
 */
const DEFAULT_INTERVAL_MS = 750;

function errorDetail(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code: unknown = error.code;
    if (typeof code === 'string') {
      return code;
    }
  }
  return error instanceof Error ? error.name : 'unknown';
}

/**
 * Sampling and the one-shot reads must never take the bench down: a missing or
 * unreadable file is a probe entry, not an exception.
 */
async function readBytes(
  readFile: (path: string) => Promise<string>,
  path: string,
): Promise<{ bytes: number | null; detail: string }> {
  try {
    const parsed = Number.parseInt((await readFile(path)).trim(), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return { bytes: null, detail: 'unparsable' };
    }
    return { bytes: parsed, detail: 'ok' };
  } catch (error) {
    return { bytes: null, detail: errorDetail(error) };
  }
}

const PID_DIR = /^\d+$/;
const PPID_LINE = /^PPid:\s+(\d+)$/m;
/** procfs reports VmRSS in kB, always — no page-size assumption is needed. */
const VMRSS_LINE = /^VmRSS:\s+(\d+)\s+kB$/m;

type ProcScan =
  | { readonly bytes: number; readonly processes: number }
  | { readonly bytes: null; readonly detail: string };

/**
 * One /proc pass: sum VmRSS over this process and every descendant.
 *
 * Why a full scan of /proc rather than `/proc/<pid>/task/<tid>/children`:
 * children[] needs CONFIG_PROC_CHILDREN, is per-THREAD (so the walk has to
 * enumerate /proc/<pid>/task first), and gives only direct children — a
 * recursive descent would then be one readdir plus one read per node anyway.
 * We must read a file per descendant regardless (that is where VmRSS lives),
 * and one flat scan builds the whole parent map with the SAME number of reads
 * while depending on nothing but procfs's base layout. It also cannot miss a
 * grandchild that was re-parented mid-walk.
 *
 * `status` rather than `stat`: it carries PPid and VmRSS together, in kB, on
 * named lines — no positional parsing around `stat`'s comm field, which may
 * itself contain spaces and parentheses.
 */
async function scanProcTree(
  readDir: (path: string) => Promise<readonly string[]>,
  readFile: (path: string) => Promise<string>,
  selfPid: number,
): Promise<ProcScan> {
  let entries: readonly string[];
  try {
    entries = await readDir(MEMORY_PATHS.procRoot);
  } catch (error) {
    // darwin has no /proc at all: ENOENT here is the honest fall to maxRSS.
    return { bytes: null, detail: errorDetail(error) };
  }

  const parentOf = new Map<number, number>();
  const rssOf = new Map<number, number>();
  for (const entry of entries) {
    if (!PID_DIR.test(entry)) {
      continue;
    }
    const pid = Number.parseInt(entry, 10);
    let status: string;
    try {
      status = await readFile(procStatusPath(pid));
    } catch {
      // The process exited between the listing and the read. Not an error —
      // just gone, and a gone process holds no resident pages.
      continue;
    }
    const ppid = PPID_LINE.exec(status)?.[1];
    if (ppid === undefined) {
      continue;
    }
    parentOf.set(pid, Number.parseInt(ppid, 10));
    // Kernel threads carry no VmRSS line; they own no user pages to count.
    const vmRssKb = VMRSS_LINE.exec(status)?.[1];
    rssOf.set(pid, vmRssKb === undefined ? 0 : Number.parseInt(vmRssKb, 10) * 1024);
  }

  if (!parentOf.has(selfPid)) {
    // Not a Linux procfs, or a mount that hides us: reporting a sum that does
    // not even include this process would be worse than reporting nothing.
    return { bytes: null, detail: 'self-not-listed' };
  }

  const childrenOf = new Map<number, number[]>();
  for (const [pid, ppid] of parentOf) {
    const siblings = childrenOf.get(ppid);
    if (siblings === undefined) {
      childrenOf.set(ppid, [pid]);
    } else {
      siblings.push(pid);
    }
  }

  let bytes = 0;
  let processes = 0;
  const seen = new Set<number>();
  const pending = [selfPid];
  for (let pid = pending.pop(); pid !== undefined; pid = pending.pop()) {
    if (seen.has(pid)) {
      // pid reuse could in principle close a cycle; visiting once cannot.
      continue;
    }
    seen.add(pid);
    bytes += rssOf.get(pid) ?? 0;
    processes += 1;
    for (const child of childrenOf.get(pid) ?? []) {
      pending.push(child);
    }
  }
  return { bytes, processes };
}

/**
 * Start watching memory. Bench-only by construction: render-run's worker never
 * calls this, so the poll cannot cost a real render anything.
 */
export function startMemorySampler(options: MemorySamplerOptions = {}): MemorySampler {
  const readFile = options.readFile ?? ((path: string) => readFileAsync(path, 'utf8'));
  const readDir =
    options.readDir ?? (async (path: string): Promise<readonly string[]> => readdirAsync(path));
  const maxRssBytes = options.maxRssBytes ?? (() => process.resourceUsage().maxRSS * 1024);
  const selfPid = options.selfPid ?? (() => process.pid);
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;

  let sampledMax = 0;
  let samples = 0;
  let sampleFailures = 0;
  let lastFailure = '';
  let procMax = 0;
  let procSamples = 0;
  let procProcesses = 0;
  let procFailures = 0;
  let procLastFailure = '';
  let inFlight = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  const sampleNow = async (): Promise<void> => {
    if (inFlight) {
      // A previous read has not returned; skipping keeps the poll bounded.
      return;
    }
    inFlight = true;
    try {
      const reading = await readBytes(readFile, MEMORY_PATHS.cgroupV2Current);
      if (reading.bytes !== null) {
        samples += 1;
        sampledMax = Math.max(sampledMax, reading.bytes);
        // memory.current already beats /proc in the chain below, so the tree
        // walk — one file read per process on the box — is not paid for.
        return;
      }
      sampleFailures += 1;
      lastFailure = reading.detail;

      const tree = await scanProcTree(readDir, readFile, selfPid());
      if (tree.bytes === null) {
        procFailures += 1;
        procLastFailure = tree.detail;
        return;
      }
      procSamples += 1;
      procProcesses = tree.processes;
      procMax = Math.max(procMax, tree.bytes);
    } finally {
      inFlight = false;
    }
  };

  const stop = (): void => {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };

  if (intervalMs > 0) {
    timer = setInterval(() => {
      void sampleNow();
    }, intervalMs);
    // Never hold the process open for a poll.
    if (typeof timer === 'object' && 'unref' in timer && typeof timer.unref === 'function') {
      timer.unref();
    }
  }

  const read = async (): Promise<MemoryReading> => {
    stop();
    await sampleNow();

    const peak = await readBytes(readFile, MEMORY_PATHS.cgroupV2Peak);
    const v1 = await readBytes(readFile, MEMORY_PATHS.cgroupV1MaxUsage);
    const samplingDetail =
      samples > 0
        ? `${samples} samples, ${sampleFailures} failed, max ${sampledMax}`
        : `no samples, ${sampleFailures} failed${lastFailure === '' ? '' : ` (${lastFailure})`}`;
    // The process count is the point of this line: it is the only evidence
    // that the sum saw Chromium and ffmpeg rather than Node alone.
    const procDetail =
      procSamples > 0
        ? `${procSamples} samples, ${procProcesses} processes, max ${procMax}`
        : `no samples, ${procFailures} failed${procLastFailure === '' ? '' : ` (${procLastFailure})`}`;
    const probes: readonly MemoryProbe[] = [
      { path: MEMORY_PATHS.cgroupV2Peak, ok: peak.bytes !== null, detail: peak.detail },
      { path: MEMORY_PATHS.cgroupV2Current, ok: samples > 0, detail: samplingDetail },
      { path: MEMORY_PATHS.cgroupV1MaxUsage, ok: v1.bytes !== null, detail: v1.detail },
      { path: MEMORY_PATHS.procRoot, ok: procSamples > 0, detail: procDetail },
    ];

    if (peak.bytes !== null) {
      return { bytes: peak.bytes, source: 'cgroup-v2-peak', sampled: false, samples: 0, probes };
    }
    if (sampledMax > 0) {
      return {
        bytes: sampledMax,
        source: 'cgroup-v2-current-sampled',
        sampled: true,
        samples,
        probes,
      };
    }
    if (v1.bytes !== null) {
      return { bytes: v1.bytes, source: 'cgroup-v1-max-usage', sampled: false, samples: 0, probes };
    }
    if (procMax > 0) {
      return {
        bytes: procMax,
        source: 'proc-rss-sampled',
        sampled: true,
        samples: procSamples,
        probes,
      };
    }
    return { bytes: maxRssBytes(), source: 'self-maxrss', sampled: false, samples: 0, probes };
  };

  return { sampleNow, stop, read };
}
