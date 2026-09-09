import { execFileSync, execSync } from 'node:child_process';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import ffprobeStatic from 'ffprobe-static';
import { describe, expect, it } from 'vitest';

import { renderScene } from '@/lib/pitchRender/renderScene';

import { audioM4a, worstCaseScene } from './fixtures';

// The worst-case feasibility measurement the brief demands: 60s scene = 1,800
// frames + 45 end-card frames. Gated (PITCH_RENDER_MEASURE=1) because it takes
// minutes and needs a running server plus a local Chrome. The numbers printed
// here are the report's evidence — this file asserts only what must always
// hold (a playable file, no frame accumulation on disk).

const MEASURE = process.env.PITCH_RENDER_MEASURE === '1';
const BASE_URL = process.env.PITCH_RENDER_BASE_URL ?? 'http://127.0.0.1:3120';
const OUT_DIR = path.join(os.tmpdir(), 'friendword-render-out');

/**
 * RSS (KB) of this process plus every descendant (Chrome, ffmpeg), and the
 * same broken down by process kind — the vitest runner is NOT part of what a
 * production function would run, and summed RSS over-counts Chrome's shared
 * pages, so the judgement needs the parts as well as the naive total.
 */
function processTreeRssKb(): { total: number; byKind: Record<string, number> } {
  const rows = execSync('ps -axo pid=,ppid=,rss=,comm=', { encoding: 'utf8' })
    .trim()
    .split('\n')
    .map((line) => {
      const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/);
      return match === null
        ? null
        : { pid: Number(match[1]), ppid: Number(match[2]), kb: Number(match[3]), comm: match[4] };
    })
    .filter((row): row is { pid: number; ppid: number; kb: number; comm: string } => row !== null);
  const children = new Map<number, number[]>();
  const byPid = new Map<number, { kb: number; comm: string }>();
  for (const row of rows) {
    byPid.set(row.pid, { kb: row.kb, comm: row.comm });
    children.set(row.ppid, [...(children.get(row.ppid) ?? []), row.pid]);
  }
  let total = 0;
  const byKind: Record<string, number> = {};
  const queue = [process.pid];
  while (queue.length > 0) {
    const pid = queue.pop() as number;
    const info = byPid.get(pid);
    if (info !== undefined) {
      total += info.kb;
      const kind =
        pid === process.pid
          ? 'node-test-runner'
          : /chrome|chromium/i.test(info.comm)
            ? 'chrome'
            : /ffmpeg/.test(info.comm)
              ? 'ffmpeg'
              : 'other';
      byKind[kind] = (byKind[kind] ?? 0) + info.kb;
    }
    queue.push(...(children.get(pid) ?? []));
  }
  return { total, byKind };
}

function dirBytes(dir: string): number {
  try {
    return (
      Number(execSync(`du -sk ${JSON.stringify(dir)}`, { encoding: 'utf8' }).split('\t')[0]) * 1024
    );
  } catch {
    return 0;
  }
}

describe.runIf(MEASURE)('worst case: 60s scene, 1800 frames', () => {
  it('renders and reports throughput, memory and /tmp profile', async () => {
    const { scene, photos, words, text, captions } = worstCaseScene();
    const workDir = path.join(os.tmpdir(), 'friendword-render-measure-work');
    mkdirSync(workDir, { recursive: true });

    let peakRssKb = 0;
    let peakByKind: Record<string, number> = {};
    const perKindPeak: Record<string, number> = {};
    let peakWorkDirBytes = 0;
    let maxWorkDirFiles = 0;
    const sampler = setInterval(() => {
      const sample = processTreeRssKb();
      if (sample.total > peakRssKb) {
        peakRssKb = sample.total;
        peakByKind = sample.byKind;
      }
      for (const [kind, kb] of Object.entries(sample.byKind)) {
        perKindPeak[kind] = Math.max(perKindPeak[kind] ?? 0, kb);
      }
      peakWorkDirBytes = Math.max(peakWorkDirBytes, dirBytes(workDir));
      maxWorkDirFiles = Math.max(maxWorkDirFiles, readdirSync(workDir).length);
    }, 500);

    let firstFrameAt = 0;
    let lastFrameAt = 0;
    let framesSeen = 0;
    const startedAt = Date.now();
    try {
      const { mp4, stats } = await renderScene(
        scene,
        { photos, audio: audioM4a(60) },
        {
          baseUrl: BASE_URL,
          renderKey: 'measure-60s',
          campaignSlug: 'demo-blair',
          shareOrigin: 'https://friendword-e2e.example',
          words,
          text,
          captions,
          workDir,
          keepWorkFiles: true,
          timeBudgetMs: 570_000,
          onFrame: () => {
            framesSeen += 1;
            if (firstFrameAt === 0) {
              firstFrameAt = Date.now();
            }
            lastFrameAt = Date.now();
          },
        },
      );
      clearInterval(sampler);

      mkdirSync(OUT_DIR, { recursive: true });
      const outFile = path.join(OUT_DIR, 'worst-case-60s.mp4');
      writeFileSync(outFile, mp4);
      const probe = execFileSync(ffprobeStatic.path, [
        '-v',
        'error',
        '-print_format',
        'json',
        '-show_streams',
        '-show_format',
        outFile,
      ]).toString('utf8');

      const captureSeconds = stats.captureMs / 1000;
      const table = {
        sceneFrames: stats.sceneFrames,
        endCardFrames: stats.endCardFrames,
        captureThroughputFps: Number(
          ((stats.sceneFrames + stats.endCardFrames) / captureSeconds).toFixed(2),
        ),
        captureMs: stats.captureMs,
        encodeTailMs: stats.encodeTailMs,
        totalMs: stats.totalMs,
        wallMs: Date.now() - startedAt,
        peakProcessTreeRssMb: Number((peakRssKb / 1024).toFixed(0)),
        rssAtPeakByKindMb: Object.fromEntries(
          Object.entries(peakByKind).map(([kind, kb]) => [kind, Number((kb / 1024).toFixed(0))]),
        ),
        perKindPeakMb: Object.fromEntries(
          Object.entries(perKindPeak).map(([kind, kb]) => [kind, Number((kb / 1024).toFixed(0))]),
        ),
        peakWorkDirMb: Number((peakWorkDirBytes / 1e6).toFixed(1)),
        maxWorkDirFiles,
        bytesPipedMb: Number((stats.bytesPiped / 1e6).toFixed(1)),
        outputMb: Number((stats.outputBytes / 1e6).toFixed(1)),
        outputPath: outFile,
      };
      console.log(`[render measure] ${JSON.stringify(table, null, 2)}`);
      console.log(`[render measure] ffprobe ${probe}`);

      expect(stats.sceneFrames).toBe(1_800);
      expect(framesSeen).toBe(stats.sceneFrames + stats.endCardFrames);
      expect(lastFrameAt).toBeGreaterThanOrEqual(firstFrameAt);
      // P1 evidence: at no sampled moment did the work dir hold anything beyond
      // the audio input and the (single) growing output file.
      expect(maxWorkDirFiles).toBeLessThanOrEqual(3);
      expect(mp4.byteLength).toBeGreaterThan(1e6);
    } finally {
      clearInterval(sampler);
    }
  });

  // §7 budget check for the DERIVATIVE path: the same 60s scene, but with the
  // music bed, the overlay and word captions on — the most expensive thing the
  // export card can ask for, since a highlight renders a third of the frames.
  it('measures the worst DERIVATIVE case: 60s full + music + overlay + captions', async () => {
    const { scene, photos, words, text, captions } = worstCaseScene();
    const workDir = path.join(os.tmpdir(), 'friendword-render-measure-music');
    mkdirSync(workDir, { recursive: true });

    const startedAt = Date.now();
    const { mp4, stats } = await renderScene(
      scene,
      { photos, audio: audioM4a(60) },
      {
        baseUrl: BASE_URL,
        renderKey: 'measure-60s-music',
        campaignSlug: 'demo-blair',
        shareOrigin: 'https://friendword-e2e.example',
        words,
        text,
        captions,
        variant: 'full',
        music: true,
        musicSeed: 'd'.repeat(64),
        daterName: 'Blair',
        overlayStage: {
          introducerLabel: 'MAYA INTRODUCES',
          daterName: 'Blair',
          relationshipChip: 'Friends for 3–10 years',
        },
        timedWords: captions.flatMap((caption) =>
          caption.text.split(' ').map((word, wordIndex) => ({
            segmentIndex: caption.segmentIndex,
            wordIndex,
            text: word,
            startMs: caption.startMs + wordIndex * 300,
            endMs: caption.startMs + wordIndex * 300 + 280,
          })),
        ),
        workDir,
        keepWorkFiles: true,
        timeBudgetMs: 570_000,
      },
    );

    console.log(
      `[render measure derivative] ${JSON.stringify(
        {
          sceneFrames: stats.sceneFrames,
          endCardFrames: stats.endCardFrames,
          captureMs: stats.captureMs,
          encodeTailMs: stats.encodeTailMs,
          totalMs: stats.totalMs,
          wallMs: Date.now() - startedAt,
          audioDurationMs: stats.audioDurationMs,
          outputMb: Number((stats.outputBytes / 1e6).toFixed(1)),
        },
        null,
        2,
      )}`,
    );
    expect(stats.sceneFrames).toBe(1_800);
    expect(mp4.byteLength).toBeGreaterThan(1e6);
    // §7: the route's ceiling is 480s of render budget.
    expect(stats.totalMs).toBeLessThan(480_000);
  });
});
