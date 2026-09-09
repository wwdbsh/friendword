import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import ffmpegPath from 'ffmpeg-static';
import { NextResponse } from 'next/server';

import { buildPitchSceneV2, type PitchSceneV2 } from '@friendword/contracts';

import type { CaptionSegment } from '@/pitch/captionChrome';
import type { SceneTextFields, SceneWord } from '@/pitch/sceneV2';
import {
  DIAGNOSTIC_LIMITS,
  createStageTracker,
  createStderrTail,
  describeError,
  type BrowserExit,
  type LaunchProbe,
} from '@/lib/pitchRender/diagnostics';
import { resolveShareOrigin } from '@/lib/pitchRender/shareOrigin';
import { startMemorySampler } from '@/lib/pitchRender/peakMemory';
import { renderScene, type RenderPhotoAsset } from '@/lib/pitchRender/renderScene';
import { renderRunSecret, renderSecretMatches } from '@/lib/pitchRender/secret';
import { BENCH_TIME_BUDGET_MS } from '@/lib/pitchRender/timeBudget';

export const dynamic = 'force-dynamic';

/**
 * Same Fluid ceiling as render-run. A literal because Next.js rejects an
 * imported constant here; timeBudget.test.ts asserts it equals
 * RENDER_MAX_DURATION_SECONDS, and vercel.json carries the same number.
 */
export const maxDuration = 800;

// The Linux 실측 instrument (SESSION_HANDOFF §3-2): one POST renders the
// measured worst case — a 60s schemaVersion 2 scene at 30fps plus the 1.5s end
// card = 1,845 frames — through the REAL engine (renderScene: headless
// Chromium capture + ffmpeg encode) and answers with throughput and memory
// metrics. It must be usable BEFORE migration 0054 exists on hosted, so it
// touches ZERO database and ZERO storage: every input is synthesized in code
// (ffmpeg test patterns and a sine-sweep AAC — no user data anywhere), and the
// MP4 is byte-counted and discarded.
//
// TWO OPERATIONAL CAVEATS:
//   1. Bench against PRODUCTION only. The pass loads /internal/render over the
//      network from its own origin, and Vercel deployment protection blocks
//      that page on preview deployments — a preview bench dies at page.goto.
//   2. Once 0054 is live on hosted, do NOT bench while real renders may be in
//      flight: a bench is itself a ~1.2GB render pass and shares the instance
//      memory budget with them (see INSTANCE_ID below).
//
// Operator invocation (same secret as render-run):
//
//   curl -X POST "$ORIGIN/api/media/render-bench" \
//     -H "authorization: Bearer $FRIENDWORD_MEDIA_RENDER_SECRET"

/**
 * Module-scope on purpose: Vercel Fluid can serve CONCURRENT invocations from
 * ONE shared instance, and two concurrent bench calls returning the SAME
 * instanceId is the proof that they co-resided — i.e. that two leased renders
 * would share one memory budget. That measurement is this field's entire
 * point.
 */
const INSTANCE_ID = randomUUID();
/** First invocation of this module instance = the cold start being measured. */
let invokedBefore = false;

const execFileAsync = promisify(execFile);

async function ffmpeg(args: readonly string[]): Promise<void> {
  if (ffmpegPath === null) {
    throw new Error('ffmpeg-static did not resolve a binary for this platform');
  }
  await execFileAsync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', ...args]);
}

/** Synthetic reviewed sentences — fixture text, never user data. */
const BENCH_TEXT: SceneTextFields = {
  hook: 'The friend who never cancels',
  relationship_context: 'Roommates for three years',
  three_specific_qualities: ['Loyal', 'Curious', 'Funny'],
  evidence_or_anecdote: 'Drove four hours for a birthday dinner',
  good_match_for: 'Someone who loves slow mornings',
};

function benchAssetId(index: number): string {
  return `98000000-0000-0000-0000-0000000000${String(10 + index)}`;
}

/**
 * The measured worst case, byte-identical in construction to the render
 * suite's worstCaseScene fixture (tests-render/fixtures.ts): a full 60s scene
 * from the REAL builder — cards, badges, word pops and leaks at the density
 * the builder actually emits — never a hand-tiled document the validator
 * might refuse.
 */
function benchScene(): {
  scene: PitchSceneV2;
  assetIds: readonly string[];
  words: readonly SceneWord[];
  text: SceneTextFields;
  captions: readonly CaptionSegment[];
} {
  const assetIds = [0, 1, 2, 3].map(benchAssetId);
  const segments = Array.from({ length: 12 }, (_, index) => ({
    startMs: index * 5_000,
    endMs: (index + 1) * 5_000,
  }));
  const words = segments.map((segment, index) => ({
    segmentIndex: index,
    wordIndex: 0,
    startMs: segment.startMs + 400,
    endMs: segment.startMs + 900,
  }));
  const scene = buildPitchSceneV2({
    template: 'warm',
    photoAssetIds: assetIds,
    segments,
    words,
    structure: BENCH_TEXT,
  });
  if (scene === null) {
    throw new Error('builder refused the worst-case bench input');
  }
  if (scene.durationMs !== 60_000) {
    throw new Error(`expected a 60s bench scene, got ${scene.durationMs}ms`);
  }
  return {
    scene,
    assetIds,
    words: words.map((word) => ({
      segmentIndex: word.segmentIndex,
      wordIndex: word.wordIndex,
      text: `Word${word.segmentIndex}`,
    })),
    text: BENCH_TEXT,
    // T017: the bench composites the caption band too, or it would measure a
    // cheaper frame than production actually renders.
    captions: segments.map((segment, index) => ({
      segmentIndex: index,
      startMs: segment.startMs,
      endMs: segment.endMs,
      text: `Segment ${index}: Word${index} carries this line of the pitch.`,
    })),
  };
}

/** A distinct 1440x2560 JPEG per index — realistic photo dimensions. */
async function benchPhoto(
  workDir: string,
  assetId: string,
  index: number,
): Promise<RenderPhotoAsset> {
  const file = path.join(workDir, `bench-photo-${index}.jpg`);
  await ffmpeg([
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=1440x2560:rate=1:duration=1',
    '-vf',
    `hue=h=${index * 70}`,
    '-frames:v',
    '1',
    '-q:v',
    '3',
    file,
  ]);
  return { assetId, bytes: await readFile(file), mimeType: 'image/jpeg' };
}

/** 60s AAC-in-m4a (sine sweep): exercises the product's `-c:a copy` path. */
async function benchAudio(workDir: string): Promise<{ bytes: Buffer; mimeType: string }> {
  const file = path.join(workDir, 'bench-audio.m4a');
  await ffmpeg([
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=330:duration=60',
    '-c:a',
    'aac',
    '-b:a',
    '96k',
    file,
  ]);
  return { bytes: await readFile(file), mimeType: 'audio/mp4' };
}

export async function POST(request: Request): Promise<NextResponse> {
  const secret = renderRunSecret();
  if (secret === null) {
    return NextResponse.json({ error: 'not configured' }, { status: 501 });
  }
  const provided = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!renderSecretMatches(provided, secret)) {
    return NextResponse.json({ error: 'authentication required' }, { status: 401 });
  }

  const coldStart = !invokedBefore;
  invokedBefore = true;

  const requestOrigin = new URL(request.url).origin;
  const baseUrl = process.env.PITCH_RENDER_BASE_URL ?? requestOrigin;
  const shareOrigin = resolveShareOrigin(baseUrl);
  if (shareOrigin === null) {
    return NextResponse.json({ error: 'share origin not configured' }, { status: 501 });
  }

  // Unique per invocation: two concurrent benches on one shared instance (the
  // very case INSTANCE_ID exists to expose) must not collide on work files.
  const benchKey = `bench-${randomUUID()}`;
  const workDir = path.join(os.tmpdir(), `friendword-render-${benchKey}`);
  const startedAt = Date.now();

  // T012 instrumentation. A production bench failure is observable ONLY through
  // this response — the first one said "NetworkError: A network error occurred."
  // and nothing else, which named neither the stage nor a cause. Everything
  // below is collected as the pass runs so the catch can answer even when the
  // browser process is already gone.
  const stages = createStageTracker('input-synthesis');
  const stderrTail = createStderrTail(DIAGNOSTIC_LIMITS.stderrTailBytes);
  // A holder, not two `let`s: these are written only from callbacks, and the
  // narrowing of a closure-assigned `let` would read as permanently null.
  const browserFacts: { probe: LaunchProbe | null; exit: BrowserExit | null } = {
    probe: null,
    exit: null,
  };
  // T013: started HERE, after the secret gate and before any work, so a polled
  // memory.current maximum covers the whole pass. Bench-only — the render-run
  // worker never polls, so a real render pays nothing for this.
  const memoryProbe = startMemorySampler();

  try {
    await mkdir(workDir, { recursive: true });
    const { scene, assetIds, words, text, captions } = benchScene();
    const photos: RenderPhotoAsset[] = [];
    for (const [index, assetId] of assetIds.entries()) {
      photos.push(await benchPhoto(workDir, assetId, index));
    }
    const audio = await benchAudio(workDir);

    const { stats } = await renderScene(
      scene,
      { photos, audio },
      {
        // The capture page /internal/render/<key> is payload-agnostic — the
        // scene arrives via page.evaluate and the URL segment is only a key —
        // so this deployment's own origin serves the bench capture too.
        baseUrl,
        renderKey: benchKey,
        campaignSlug: 'bench',
        shareOrigin,
        words,
        text,
        captions,
        workDir,
        timeBudgetMs: BENCH_TIME_BUDGET_MS,
        diagnostics: {
          onStage: stages.mark,
          launch: {
            onProbe: (probe) => {
              browserFacts.probe = probe;
            },
            onStderr: (chunk) => {
              stderrTail.append(chunk);
            },
            onExit: (exit) => {
              browserFacts.exit = exit;
            },
          },
        },
      },
    );

    const memory = await memoryProbe.read();
    return NextResponse.json({
      instanceId: INSTANCE_ID,
      coldStart,
      frames: stats.sceneFrames + stats.endCardFrames,
      fps: stats.fps,
      renderMs: stats.totalMs,
      captureMs: stats.captureMs,
      encodeMs: stats.encodeTailMs,
      outputBytes: stats.outputBytes,
      peakMemoryBytes: memory.bytes,
      memorySource: memory.source,
      // An approximation must never be read as a kernel high-water mark: the
      // T002 verdict depends on knowing which one this is.
      memorySampled: memory.sampled,
      memorySamples: memory.samples,
      memoryProbes: memory.probes,
      audio: true,
      platform: `${process.platform}-${process.arch}`,
    });
  } catch (error) {
    // Synthetic inputs only, so nothing below carries personal data: the stack
    // is code paths, the stderr tail is Chromium's own output, and the probe is
    // filesystem facts about a binary the platform extracted. Every
    // variable-length field is capped in diagnostics.ts.
    const detail = describeError(error, 'bench render failed');
    const stderr = stderrTail.read();
    const memory = await memoryProbe.read();
    return NextResponse.json(
      {
        instanceId: INSTANCE_ID,
        coldStart,
        error: detail.message,
        elapsedMs: Date.now() - startedAt,
        stage: stages.current(),
        errorName: detail.name,
        errorStack: detail.stack,
        errorTruncated: detail.truncated,
        chromiumStderrTail: stderr.text,
        chromiumStderrBytes: stderr.totalBytes,
        chromiumStderrTruncated: stderr.truncated,
        browserExitCode: browserFacts.exit?.code ?? null,
        browserExitSignal: browserFacts.exit?.signal ?? null,
        launchProbe: browserFacts.probe,
        peakMemoryBytes: memory.bytes,
        memorySource: memory.source,
        memorySampled: memory.sampled,
        memorySamples: memory.samples,
        // Which memory source answered, and why the others did not — a failed
        // bench is otherwise the only place this platform fact is observable.
        memoryProbes: memory.probes,
        platform: `${process.platform}-${process.arch}`,
      },
      { status: 500 },
    );
  } finally {
    memoryProbe.stop();
    // Discard everything: the MP4 was counted, never kept.
    await rm(workDir, { recursive: true, force: true });
  }
}
