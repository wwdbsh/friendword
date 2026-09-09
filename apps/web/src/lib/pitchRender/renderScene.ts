import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import ffmpegPath from 'ffmpeg-static';
import type { Page } from 'puppeteer-core';

import type { TimedCaptionWord } from '@friendword/contracts';

import type { CaptionSegment } from '@/pitch/captionChrome';
import type { SceneTextFields, SceneWord } from '@/pitch/sceneV2';

import { buildRenderAudio, type CutWindow, type RenderAudioResult } from './audio';
import { launchRenderBrowser } from './browser';
import type { RenderDiagnostics, RenderStage } from './diagnostics';
import { audioFileExtension, buildEncoderArgs, startEncoder, type FrameSink } from './encode';
import { buildEndCard, endCardMsForVariant, type RenderVariant } from './endCard';
import type { RenderFrameCursor, RenderOverlayStage } from './overlay';
import type { RenderPayload, RenderPayloadPhoto } from './payload';
import { photoGradeForTemplate } from './photoGrade';
import { assertRenderableScene } from './validate';

// The pitch renderer: an approved PitchScene v2 in, a 1080x1920 MP4 out.
//
// The browser is the compositor — the capture page mounts the SAME
// MotionSceneV2 component the web player uses, stepped to each frame's
// millisecond — and ffmpeg only encodes what Chromium painted. Every frame is
// piped; none is ever written to disk (P1). The whole function is deterministic
// for a given (scene, assets, options): temp paths derive from `renderKey`, and
// the only "random" texture, film grain, is seeded inside the scene itself.

export type RenderPhotoAsset = {
  readonly assetId: string;
  readonly bytes: Uint8Array;
  readonly mimeType: string;
};

export type RenderAudioAsset = {
  readonly bytes: Uint8Array;
  readonly mimeType: string;
};

export type RenderAssets = {
  readonly photos: readonly RenderPhotoAsset[];
  /** Null only for QA of silent fixtures; a published pitch always has audio. */
  readonly audio: RenderAudioAsset | null;
};

export type RenderSceneOptions = {
  /** Origin serving this app's /internal/render capture page. */
  readonly baseUrl: string;
  /** Deterministic identity for temp paths and the capture URL (P7). */
  readonly renderKey: string;
  readonly campaignSlug: string;
  /** Canonical origin for the end card URL (env-configured; never hardcoded). */
  readonly shareOrigin: string;
  readonly words?: readonly SceneWord[];
  readonly text?: SceneTextFields | null;
  /** Subtitle band (T017); renderer chrome, never part of the approved scene. */
  readonly captions?: readonly CaptionSegment[];
  /**
   * Which MP4 this job asked for (§2.1). 'full' with `music` off is the LEGACY
   * path: same frames, same encoder argv, same bit-for-bit audio copy as before
   * this feature existed.
   */
  readonly variant?: RenderVariant;
  /**
   * The cut plan's windows, on the approved scene's own timeline. Required for
   * a highlight; an empty or missing plan falls back to the full render and is
   * reported as `effectiveVariant: 'full'` (§2.2-1).
   */
  readonly cutWindows?: readonly CutWindow[] | null;
  /** §2.6 backing bed. Off leaves the voice alone. */
  readonly music?: boolean;
  /** §2.3 stage chrome text. Absent draws no chrome. */
  readonly overlayStage?: RenderOverlayStage | null;
  /** §2.4 word captions; null falls back to the segment caption band. */
  readonly timedWords?: readonly TimedCaptionWord[] | null;
  /** The Dater's public display name for the end card badge (§2.5). */
  readonly daterName?: string | null;
  /** Music seed (§2.6): the cut hash when there is one, else the scene hash. */
  readonly musicSeed?: string | null;
  /**
   * T004 hook — the selfie opening. Frames extracted from the APPROVED,
   * snapshot-included selfie proxy, ready to pipe ahead of the scene. The
   * extraction, the consent toggle and the audio offset that goes with them are
   * T004's; this build accepts the field so that task adds a producer rather
   * than a new parameter, and refuses to silently render a misaligned file.
   */
  readonly openingFrames?: readonly Uint8Array[] | null;
  readonly executablePath?: string;
  readonly workDir?: string;
  /** Abort mid-capture once exceeded, leaving headroom under maxDuration. */
  readonly timeBudgetMs?: number;
  /** Keep the audio/output files for measurement runs. */
  readonly keepWorkFiles?: boolean;
  readonly jpegQuality?: number;
  readonly onFrame?: (frameIndex: number, totalFrames: number) => void;
  /**
   * Instrumentation sinks (T012). Purely observational: with no diagnostics the
   * pass makes the same calls in the same order, and no sink can influence what
   * is captured or encoded.
   */
  readonly diagnostics?: RenderDiagnostics;
};

export type RenderStats = {
  readonly sceneFrames: number;
  readonly endCardFrames: number;
  readonly fps: number;
  /** What was asked for, and what was actually rendered (§2.2-1). */
  readonly variant: RenderVariant;
  readonly effectiveVariant: RenderVariant;
  /** Sum of the rendered windows, ms of the approved timeline. */
  readonly cutTotalMs: number;
  /** The audio track's own length, end-card bed tail included. */
  readonly audioDurationMs: number;
  readonly endCardMs: number;
  readonly captureMs: number;
  readonly encodeTailMs: number;
  readonly totalMs: number;
  readonly bytesPiped: number;
  readonly outputBytes: number;
  readonly outputPath: string;
};

export type RenderSceneResult = {
  readonly mp4: Uint8Array;
  readonly stats: RenderStats;
};

const RENDER_KEY_PATTERN = /^[A-Za-z0-9._-]{1,120}$/;
const DEFAULT_TIME_BUDGET_MS = 240_000;
const DEFAULT_JPEG_QUALITY = 92;

/** Deterministic work file paths: same renderKey, same paths, no randomness. */
export function workFilePaths(
  workDir: string,
  renderKey: string,
  audioMimeType: string | null,
): {
  readonly audioPath: string | null;
  readonly outputPath: string;
  readonly derivative: {
    readonly cutWav: string;
    readonly bedWav: string;
    readonly mixWav: string;
  };
} {
  if (!RENDER_KEY_PATTERN.test(renderKey)) {
    throw new Error('renderKey must be 1-120 chars of [A-Za-z0-9._-]');
  }
  return {
    audioPath:
      audioMimeType === null
        ? null
        : path.join(workDir, `${renderKey}.audio.${audioFileExtension(audioMimeType)}`),
    outputPath: path.join(workDir, `${renderKey}.mp4`),
    // Derived from the same renderKey, so a retry reuses the same paths and
    // leaves nothing behind under another name (P7).
    derivative: {
      cutWav: path.join(workDir, `${renderKey}.cut.wav`),
      bedWav: path.join(workDir, `${renderKey}.bed.wav`),
      mixWav: path.join(workDir, `${renderKey}.mix.wav`),
    },
  };
}

/** One captured frame: which source millisecond, and where it lands in the file. */
export type CaptureFrame = {
  readonly tMs: number;
  readonly cursor: RenderFrameCursor;
};

/**
 * The capture list: every frame of the output, in order, each carrying the
 * millisecond of the APPROVED timeline it shows.
 *
 * Frame counts round UP per window. The audio is the exact window sum, so
 * rounding down anywhere would end the video before the sound — the one
 * invariant §2.2-6 states outright.
 */
export function planCaptureFrames(
  windows: readonly CutWindow[],
  fps: number,
): readonly CaptureFrame[] {
  const perWindow = windows.map((window) =>
    Math.max(1, Math.ceil(((window.endMs - window.startMs) * fps) / 1000)),
  );
  const totalFrames = perWindow.reduce((sum, count) => sum + count, 0);
  const frames: CaptureFrame[] = [];
  windows.forEach((window, windowIndex) => {
    const count = perWindow[windowIndex] ?? 0;
    for (let index = 0; index < count; index += 1) {
      frames.push({
        tMs: window.startMs + (index * 1000) / fps,
        cursor: { outputFrame: frames.length, totalFrames, windowIndex },
      });
    }
  });
  return frames;
}

function toDataUri(photo: RenderPhotoAsset): RenderPayloadPhoto {
  return {
    assetId: photo.assetId,
    src: `data:${photo.mimeType};base64,${Buffer.from(photo.bytes).toString('base64')}`,
  };
}

async function captureFrames(
  page: Page,
  sink: FrameSink,
  input: {
    readonly plan: readonly CaptureFrame[];
    readonly endCardFrames: number;
    readonly jpegQuality: number;
    readonly deadline: number;
    readonly onFrame: ((frameIndex: number, totalFrames: number) => void) | undefined;
  },
): Promise<number> {
  const { plan, endCardFrames, jpegQuality, deadline, onFrame } = input;
  const sceneFrames = plan.length;
  const totalFrames = sceneFrames + endCardFrames;
  let bytesPiped = 0;
  // No `clip`: the viewport IS the 1080x1920 frame (browser.ts), and measured
  // on 2026-08-03 the clipped capture path costs ~55ms extra per frame.
  const shoot = async (): Promise<Uint8Array> =>
    page.screenshot({
      type: 'jpeg',
      quality: jpegQuality,
      optimizeForSpeed: true,
    });

  for (let frame = 0; frame < sceneFrames; frame += 1) {
    if (Date.now() > deadline) {
      throw new Error(
        `render time budget exceeded at frame ${frame}/${totalFrames}; aborting before the platform kills the function`,
      );
    }
    // The interpreter's own clock, not wall time: this frame is the picture at
    // exactly the planned millisecond of the APPROVED timeline (for a highlight
    // the plan skips the milliseconds the cut left out), and seek() resolves
    // only once the DOM provably shows it.
    const step = plan[frame];
    if (step === undefined) {
      throw new Error(`capture plan is missing frame ${frame}`);
    }
    await page.evaluate(
      async (t, cursor) => {
        if (window.__friendwordRender === undefined) {
          throw new Error('render harness missing');
        }
        await window.__friendwordRender.seek(t, cursor);
      },
      step.tMs,
      step.cursor,
    );
    const shot = await shoot();
    bytesPiped += shot.byteLength;
    await sink.write(shot);
    onFrame?.(frame, totalFrames);
  }

  if (endCardFrames > 0) {
    await page.evaluate(async () => {
      if (window.__friendwordRender === undefined) {
        throw new Error('render harness missing');
      }
      await window.__friendwordRender.showEndCard();
    });
    // The card is a still: capture once, repeat the identical frame (P4 appends
    // after the approved timeline; nothing approved is overwritten).
    const still = await shoot();
    for (let frame = 0; frame < endCardFrames; frame += 1) {
      bytesPiped += still.byteLength;
      await sink.write(still);
      onFrame?.(sceneFrames + frame, totalFrames);
    }
  }
  return bytesPiped;
}

export async function renderScene(
  sceneJson: unknown,
  assets: RenderAssets,
  options: RenderSceneOptions,
): Promise<RenderSceneResult> {
  const startedAt = Date.now();
  // Marks the stage being ENTERED, so a throw names where the pass was.
  const stage = (entered: RenderStage): void => {
    options.diagnostics?.onStage?.(entered);
  };

  stage('scene-prepare');
  const scene = assertRenderableScene(sceneJson);

  const photoByAssetId = new Map(assets.photos.map((photo) => [photo.assetId, photo]));
  const missing = scene.assetIds.filter((assetId) => !photoByAssetId.has(assetId));
  if (missing.length > 0) {
    // Fail closed like the players do: a half-bound scene would render holes.
    throw new Error(`scene references photos the assets do not carry: ${missing.join(', ')}`);
  }

  if (ffmpegPath === null) {
    throw new Error('ffmpeg-static did not resolve a binary for this platform');
  }

  if (
    options.openingFrames !== undefined &&
    options.openingFrames !== null &&
    options.openingFrames.length > 0
  ) {
    // The hook exists so T004 adds a producer, not a parameter. Until it also
    // offsets the audio by the opening's length, piping these would ship a file
    // whose voice starts before the picture it belongs to — refuse instead.
    throw new Error('selfie opening frames are not composited yet (T004)');
  }

  const fps = scene.canvas.fps;
  const requestedVariant: RenderVariant = options.variant ?? 'full';
  const music = options.music === true;
  const windows =
    options.cutWindows === undefined || options.cutWindows === null
      ? []
      : options.cutWindows.filter((window) => window.endMs > window.startMs);
  // §2.2-1: a highlight with no usable plan is rendered full, and says so.
  const effectiveVariant: RenderVariant =
    requestedVariant === 'highlight' && windows.length > 0 ? 'highlight' : 'full';
  const renderWindows: readonly CutWindow[] =
    effectiveVariant === 'highlight' ? windows : [{ startMs: 0, endMs: scene.durationMs }];
  const plan = planCaptureFrames(renderWindows, fps);
  const sceneFrames = plan.length;
  const cutTotalMs = renderWindows.reduce(
    (total, window) => total + (window.endMs - window.startMs),
    0,
  );
  const endCardMs = endCardMsForVariant(effectiveVariant);
  // The derivative path (§0 verdict 3): anything that cuts or mixes the
  // waveform. Full + music off stays exactly the render it has always been.
  const derivative = effectiveVariant === 'highlight' || music;
  const deadline = startedAt + (options.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS);

  const workDir = options.workDir ?? path.join(os.tmpdir(), 'friendword-pitch-render');
  await mkdir(workDir, { recursive: true });
  const {
    audioPath: sourceAudioPath,
    outputPath,
    derivative: derivativePaths,
  } = workFilePaths(workDir, options.renderKey, assets.audio?.mimeType ?? null);
  if (sourceAudioPath !== null && assets.audio !== null) {
    await writeFile(sourceAudioPath, assets.audio.bytes);
  }

  let audio: RenderAudioResult | null = null;
  if (derivative && sourceAudioPath !== null && assets.audio !== null) {
    stage('audio-build');
    audio = await buildRenderAudio({
      ffmpegPath,
      sourcePath: sourceAudioPath,
      windows: effectiveVariant === 'highlight' ? renderWindows : null,
      music,
      template: scene.template,
      seed: options.musicSeed ?? options.renderKey,
      endCardMs,
      fps,
      frameCount: sceneFrames,
      paths: derivativePaths,
    });
  }
  const audioPath = audio === null ? sourceAudioPath : audio.path;
  const audioMimeType = audio === null ? (assets.audio?.mimeType ?? null) : 'audio/wav';
  const audioDurationMs = audio === null ? 0 : audio.durationMs;

  // §2.2-6, asserted rather than assumed: the picture must outlast the sound,
  // bed tail included. Frames are ceilinged per window, so this only ever adds
  // frames to the still end card — it can never truncate approved motion.
  const sceneMs = (sceneFrames * 1000) / fps;
  const endCardFrames = Math.max(
    Math.round((endCardMs / 1000) * fps),
    Math.ceil(((audioDurationMs - sceneMs) * fps) / 1000),
  );

  const payload: RenderPayload = {
    scene,
    photos: scene.assetIds.map((assetId) => {
      const photo = photoByAssetId.get(assetId);
      if (photo === undefined) {
        throw new Error(`scene references photos the assets do not carry: ${assetId}`);
      }
      return toDataUri(photo);
    }),
    words: options.words ?? [],
    text: options.text ?? null,
    captions: options.captions ?? [],
    endCard: buildEndCard(options.shareOrigin, options.campaignSlug, {
      variant: effectiveVariant,
      daterName: options.daterName ?? null,
    }),
    // Legacy path draws no overlay at all: the capture page then renders
    // exactly the tree it rendered before this feature existed.
    overlay: derivative
      ? {
          variant: effectiveVariant,
          stage: options.overlayStage ?? {
            introducerLabel: '',
            daterName: options.daterName ?? '',
            relationshipChip: null,
          },
          envelope: audio?.envelope ?? [],
          words: options.timedWords ?? null,
          windows: renderWindows,
          grade: photoGradeForTemplate(scene.template),
        }
      : null,
  };

  stage('browser-launch');
  const browser = await launchRenderBrowser(options.executablePath, options.diagnostics?.launch);
  try {
    const page = await browser.newPage();
    const captureUrl = `${options.baseUrl.replace(/\/$/, '')}/internal/render/${options.renderKey}`;
    stage('page-goto');
    await page.goto(captureUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    stage('harness-ready');
    await page.waitForFunction(() => window.__friendwordRenderReady === true, {
      timeout: 60_000,
    });
    // First-frame gate (P3): loadPayload resolves only after every photo has
    // decoded and document.fonts.ready settled — a downloaded file with a
    // fallback font or a blank frame cannot be recalled.
    stage('payload-load');
    await page.evaluate(async (p) => {
      if (window.__friendwordRender === undefined) {
        throw new Error('render harness missing');
      }
      await window.__friendwordRender.loadPayload(p);
    }, payload);

    stage('encode');
    const encoder = startEncoder(
      ffmpegPath,
      buildEncoderArgs({
        fps,
        audioPath,
        audioMimeType,
        outputPath,
        audioTouched: audio !== null && audio.touched,
      }),
    );

    const captureStart = Date.now();
    let bytesPiped = 0;
    stage('capture');
    try {
      bytesPiped = await captureFrames(page, encoder.sink, {
        plan,
        endCardFrames,
        jpegQuality: options.jpegQuality ?? DEFAULT_JPEG_QUALITY,
        deadline,
        onFrame: options.onFrame,
      });
      encoder.sink.end();
    } catch (error) {
      // A capture failure must still reap ffmpeg — and when the encoder itself
      // died (bad audio, EPIPE), ITS error is the one worth reading.
      encoder.sink.end();
      const encoderError = await encoder.done.then(
        () => null,
        (cause: unknown) => cause,
      );
      throw encoderError ?? error;
    }
    const captureMs = Date.now() - captureStart;
    stage('encode');
    await encoder.done;
    const encodeTailMs = Date.now() - captureStart - captureMs;

    stage('output-read');
    const mp4 = await readFile(outputPath);
    const stats: RenderStats = {
      sceneFrames,
      endCardFrames,
      fps,
      variant: requestedVariant,
      effectiveVariant,
      cutTotalMs,
      audioDurationMs,
      endCardMs,
      captureMs,
      encodeTailMs,
      totalMs: Date.now() - startedAt,
      bytesPiped,
      outputBytes: mp4.byteLength,
      outputPath,
    };
    return { mp4, stats };
  } finally {
    await browser.close();
    if (options.keepWorkFiles !== true) {
      if (sourceAudioPath !== null) {
        await rm(sourceAudioPath, { force: true });
      }
      for (const file of Object.values(derivativePaths)) {
        await rm(file, { force: true });
      }
      await rm(outputPath, { force: true });
    }
  }
}
