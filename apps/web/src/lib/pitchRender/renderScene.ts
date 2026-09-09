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
import { compositeOpeningFrames } from './openingFrames';
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
   * §2.2-4 — the selfie opening's BASE LAYER: one PNG per output frame, already
   * cover-cropped to 1080x1920, extracted by `openingFrames.ts` from the
   * APPROVED, snapshot-included selfie proxy. The caller supplies the picture;
   * this function owns everything that has to stay in step with it — the
   * transparent chrome captured for the same frames, the ffmpeg composite, the
   * silent lead the audio is pushed back by, and the frame cursors that carry
   * the waveform playhead across the join.
   *
   * Empty or absent is the render this pipeline shipped before T004, frame for
   * frame (`renderCapture.e2e` pins that).
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
  /** Frames of selfie opening spliced in front of the scene (§2.2-4). */
  readonly openingFrames: number;
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
    readonly openWav: string;
  };
  readonly opening: {
    readonly selfiePrefix: string;
    readonly chromePrefix: string;
    readonly compositePrefix: string;
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
      // The same track with the silent selfie lead in front of it.
      openWav: path.join(workDir, `${renderKey}.open.wav`),
    },
    // Numbered sequences, not single files: ffmpeg reads and writes them by
    // pattern, and the render key keeps two concurrent jobs apart.
    opening: {
      selfiePrefix: `${renderKey}.selfie`,
      chromePrefix: `${renderKey}.chrome`,
      compositePrefix: `${renderKey}.open`,
    },
  };
}

/**
 * The 1-based, five-digit file name ffmpeg's `image2` muxer reads and writes for
 * a sequence. Stated once so the writer, the reader and the cleanup agree.
 */
export function openingSequencePath(
  workDir: string,
  prefix: string,
  index: number,
  extension: 'png' | 'jpg',
): string {
  return path.join(workDir, `${prefix}-${String(index + 1).padStart(5, '0')}.${extension}`);
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
  openingFrames = 0,
): readonly CaptureFrame[] {
  const perWindow = windows.map((window) =>
    Math.max(1, Math.ceil(((window.endMs - window.startMs) * fps) / 1000)),
  );
  // The opening is part of the OUTPUT, so it counts in `totalFrames` and pushes
  // every scene frame along — otherwise the waveform playhead would restart the
  // file at the join and the last bar would light up early.
  const totalFrames = openingFrames + perWindow.reduce((sum, count) => sum + count, 0);
  const frames: CaptureFrame[] = [];
  windows.forEach((window, windowIndex) => {
    const count = perWindow[windowIndex] ?? 0;
    for (let index = 0; index < count; index += 1) {
      frames.push({
        tMs: window.startMs + (index * 1000) / fps,
        cursor: { outputFrame: openingFrames + frames.length, totalFrames, windowIndex },
      });
    }
  });
  return frames;
}

/**
 * The chrome captures that sit on the selfie: same count, same order, drawn
 * over nothing at all (`overlayOnly`).
 *
 * `tMs` is -1 on purpose. The opening happens BEFORE the recording starts — the
 * voice is pushed back by exactly this many frames — so no word has been spoken
 * yet, and a timestamp before every word timing is what makes `wordCaptionFrame`
 * say so rather than lighting the first line early.
 */
export function planOpeningCaptureFrames(
  openingFrames: number,
  totalFrames: number,
): readonly CaptureFrame[] {
  const frames: CaptureFrame[] = [];
  for (let index = 0; index < openingFrames; index += 1) {
    frames.push({
      tMs: OPENING_CAPTURE_MS,
      cursor: { outputFrame: index, totalFrames, windowIndex: 0, overlayOnly: true },
    });
  }
  return frames;
}

/** Before the first millisecond of the approved timeline. See above. */
export const OPENING_CAPTURE_MS = -1;

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
    /** Already composited (selfie + chrome), in output order. Piped first. */
    readonly openingFrames: readonly Uint8Array[];
    readonly endCardFrames: number;
    readonly jpegQuality: number;
    readonly deadline: number;
    readonly onFrame: ((frameIndex: number, totalFrames: number) => void) | undefined;
  },
): Promise<number> {
  const { plan, openingFrames, endCardFrames, jpegQuality, deadline, onFrame } = input;
  const openingCount = openingFrames.length;
  const sceneFrames = plan.length;
  const totalFrames = openingCount + sceneFrames + endCardFrames;
  let bytesPiped = 0;
  // No `clip`: the viewport IS the 1080x1920 frame (browser.ts), and measured
  // on 2026-08-03 the clipped capture path costs ~55ms extra per frame.
  const shoot = async (): Promise<Uint8Array> =>
    page.screenshot({
      type: 'jpeg',
      quality: jpegQuality,
      optimizeForSpeed: true,
    });

  // §2.2-4: the selfie opening. Already encoded, so it is written straight
  // through — the browser contributed only the transparent chrome on top of it,
  // and that capture has already happened by the time we get here.
  for (let frame = 0; frame < openingCount; frame += 1) {
    const opening = openingFrames[frame];
    if (opening === undefined) {
      throw new Error(`selfie opening is missing frame ${String(frame)}`);
    }
    bytesPiped += opening.byteLength;
    await sink.write(opening);
    onFrame?.(frame, totalFrames);
  }

  for (let frame = 0; frame < sceneFrames; frame += 1) {
    if (Date.now() > deadline) {
      throw new Error(
        `render time budget exceeded at frame ${openingCount + frame}/${totalFrames}; aborting before the platform kills the function`,
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
    onFrame?.(openingCount + frame, totalFrames);
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
      onFrame?.(openingCount + sceneFrames + frame, totalFrames);
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
  // The derivative path (§0 verdict 3): anything that cuts or mixes the
  // waveform. Full + music off stays exactly the render it has always been.
  const derivative = effectiveVariant === 'highlight' || music;
  // §2.2-1 again: a highlight with no usable plan falls back to FULL, which
  // draws no chrome — and an opening with no chrome over it would be raw
  // footage spliced in front of the approved scene with nothing identifying
  // it. Drop the opening rather than throw: the fallback is a legitimate
  // outcome of the render, not a caller error, and the MP4 must still ship.
  const openingBase = derivative ? (options.openingFrames ?? []) : [];
  const openingCount = openingBase.length;
  const plan = planCaptureFrames(renderWindows, fps, openingCount);
  const sceneFrames = plan.length;
  const cutTotalMs = renderWindows.reduce(
    (total, window) => total + (window.endMs - window.startMs),
    0,
  );
  const endCardMs = endCardMsForVariant(effectiveVariant);
  const openingPlan = planOpeningCaptureFrames(openingCount, openingCount + sceneFrames);
  const deadline = startedAt + (options.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS);

  const workDir = options.workDir ?? path.join(os.tmpdir(), 'friendword-pitch-render');
  await mkdir(workDir, { recursive: true });
  const {
    audioPath: sourceAudioPath,
    outputPath,
    derivative: derivativePaths,
    opening: openingPaths,
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
      // §2.2-4: the opening is SILENT. The voice and the bed are both pushed
      // back by exactly the opening's whole-frame length, so the first word
      // still lands on the frame it was captured for.
      openingFrames: openingCount,
      paths: derivativePaths,
    });
  }
  const audioPath = audio === null ? sourceAudioPath : audio.path;
  const audioMimeType = audio === null ? (assets.audio?.mimeType ?? null) : 'audio/wav';
  const audioDurationMs = audio === null ? 0 : audio.durationMs;

  // §2.2-6, asserted rather than assumed: the picture must outlast the sound,
  // bed tail included. Frames are ceilinged per window, so this only ever adds
  // frames to the still end card — it can never truncate approved motion.
  const sceneMs = ((openingCount + sceneFrames) * 1000) / fps;
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

    // §2.2-4: the chrome for the opening is captured over NOTHING — the scene is
    // not mounted, the page is transparent — and ffmpeg composites it onto the
    // extracted stills. That is why the capture page still has no `<video>`.
    let opening: readonly Uint8Array[] = [];
    if (openingCount > 0) {
      stage('capture');
      const selfiePaths: string[] = [];
      for (const [index, bytes] of openingBase.entries()) {
        const file = openingSequencePath(workDir, openingPaths.selfiePrefix, index, 'png');
        await writeFile(file, bytes);
        selfiePaths.push(file);
      }
      const chromePaths: string[] = [];
      for (const [index, step] of openingPlan.entries()) {
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
        const file = openingSequencePath(workDir, openingPaths.chromePrefix, index, 'png');
        // PNG with `omitBackground`: the composite needs the chrome's alpha, and
        // a JPEG here would paint an opaque rectangle over the selfie.
        await writeFile(file, await page.screenshot({ type: 'png', omitBackground: true }));
        chromePaths.push(file);
      }
      opening = await compositeOpeningFrames({
        ffmpegPath,
        basePaths: selfiePaths,
        overlayPaths: chromePaths,
        workDir,
        prefix: openingPaths.compositePrefix,
        jpegQuality: options.jpegQuality ?? DEFAULT_JPEG_QUALITY,
      });
    }

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
        openingFrames: opening,
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
      openingFrames: openingCount,
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
      // The opening's three sequences. Frames are the one thing this renderer
      // does stage on disk (P1's exception, §2.2-4), so they are removed by the
      // same finally that removes the audio and the MP4.
      for (const prefix of Object.values(openingPaths)) {
        for (let index = 0; index < openingCount; index += 1) {
          await rm(openingSequencePath(workDir, prefix, index, 'png'), { force: true });
          await rm(openingSequencePath(workDir, prefix, index, 'jpg'), { force: true });
        }
      }
      await rm(outputPath, { force: true });
    }
  }
}
