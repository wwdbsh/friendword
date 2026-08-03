import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import ffmpegPath from 'ffmpeg-static';
import type { Page } from 'puppeteer-core';

import type { SceneTextFields, SceneWord } from '@/pitch/sceneV2';

import { launchRenderBrowser } from './browser';
import { audioFileExtension, buildEncoderArgs, startEncoder, type FrameSink } from './encode';
import { END_CARD_MS, buildEndCard } from './endCard';
import type { RenderPayload, RenderPayloadPhoto } from './payload';
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
  readonly executablePath?: string;
  readonly workDir?: string;
  /** Abort mid-capture once exceeded, leaving headroom under maxDuration. */
  readonly timeBudgetMs?: number;
  /** Keep the audio/output files for measurement runs. */
  readonly keepWorkFiles?: boolean;
  readonly jpegQuality?: number;
  readonly onFrame?: (frameIndex: number, totalFrames: number) => void;
};

export type RenderStats = {
  readonly sceneFrames: number;
  readonly endCardFrames: number;
  readonly fps: number;
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
): { readonly audioPath: string | null; readonly outputPath: string } {
  if (!RENDER_KEY_PATTERN.test(renderKey)) {
    throw new Error('renderKey must be 1-120 chars of [A-Za-z0-9._-]');
  }
  return {
    audioPath:
      audioMimeType === null
        ? null
        : path.join(workDir, `${renderKey}.audio.${audioFileExtension(audioMimeType)}`),
    outputPath: path.join(workDir, `${renderKey}.mp4`),
  };
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
    readonly sceneFrames: number;
    readonly endCardFrames: number;
    readonly fps: number;
    readonly jpegQuality: number;
    readonly deadline: number;
    readonly onFrame: ((frameIndex: number, totalFrames: number) => void) | undefined;
  },
): Promise<number> {
  const { sceneFrames, endCardFrames, fps, jpegQuality, deadline, onFrame } = input;
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
    // The interpreter's own clock, not wall time: frame N is the picture at
    // exactly N/fps seconds, and seek() resolves only once the DOM shows it.
    const tMs = (frame * 1000) / fps;
    await page.evaluate(async (t) => {
      if (window.__friendwordRender === undefined) {
        throw new Error('render harness missing');
      }
      await window.__friendwordRender.seek(t);
    }, tMs);
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
  const sceneFrames = Math.round((scene.durationMs / 1000) * fps);
  const endCardFrames = Math.round((END_CARD_MS / 1000) * fps);
  const deadline = startedAt + (options.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS);

  const workDir = options.workDir ?? path.join(os.tmpdir(), 'friendword-pitch-render');
  await mkdir(workDir, { recursive: true });
  const { audioPath, outputPath } = workFilePaths(
    workDir,
    options.renderKey,
    assets.audio?.mimeType ?? null,
  );
  if (audioPath !== null && assets.audio !== null) {
    await writeFile(audioPath, assets.audio.bytes);
  }

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
    endCard: buildEndCard(options.shareOrigin, options.campaignSlug),
  };

  const browser = await launchRenderBrowser(options.executablePath);
  try {
    const page = await browser.newPage();
    const captureUrl = `${options.baseUrl.replace(/\/$/, '')}/internal/render/${options.renderKey}`;
    await page.goto(captureUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForFunction(() => window.__friendwordRenderReady === true, {
      timeout: 60_000,
    });
    // First-frame gate (P3): loadPayload resolves only after every photo has
    // decoded and document.fonts.ready settled — a downloaded file with a
    // fallback font or a blank frame cannot be recalled.
    await page.evaluate(async (p) => {
      if (window.__friendwordRender === undefined) {
        throw new Error('render harness missing');
      }
      await window.__friendwordRender.loadPayload(p);
    }, payload);

    const encoder = startEncoder(
      ffmpegPath,
      buildEncoderArgs({
        fps,
        audioPath,
        audioMimeType: assets.audio?.mimeType ?? null,
        outputPath,
      }),
    );

    const captureStart = Date.now();
    let bytesPiped = 0;
    try {
      bytesPiped = await captureFrames(page, encoder.sink, {
        sceneFrames,
        endCardFrames,
        fps,
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
    await encoder.done;
    const encodeTailMs = Date.now() - captureStart - captureMs;

    const mp4 = await readFile(outputPath);
    const stats: RenderStats = {
      sceneFrames,
      endCardFrames,
      fps,
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
      if (audioPath !== null) {
        await rm(audioPath, { force: true });
      }
      await rm(outputPath, { force: true });
    }
  }
}
