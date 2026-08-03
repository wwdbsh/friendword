import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import ffprobeStatic from 'ffprobe-static';
import type { Browser, Page } from 'puppeteer-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { launchRenderBrowser } from '@/lib/pitchRender/browser';
import { buildEndCard } from '@/lib/pitchRender/endCard';
import type { RenderPayload } from '@/lib/pitchRender/payload';
import { renderScene, type RenderPhotoAsset } from '@/lib/pitchRender/renderScene';

import { FIXTURE_TEXT, FIXTURE_WORDS, audioM4a, photoAsset, qaScene } from './fixtures';

// Integration: a real headless Chrome against a running production server
// (`pnpm --filter @friendword/web build && next start`). Gated so machines
// without Chrome or a server stay green; run with PITCH_RENDER_E2E=1.

const E2E = process.env.PITCH_RENDER_E2E === '1';
const BASE_URL = process.env.PITCH_RENDER_BASE_URL ?? 'http://127.0.0.1:3120';
const OUT_DIR = path.join(os.tmpdir(), 'friendword-render-out');

function toPayload(scene: RenderPayload['scene'], photos: readonly RenderPhotoAsset[]) {
  const payload: RenderPayload = {
    scene,
    photos: photos.map((photo) => ({
      assetId: photo.assetId,
      src: `data:${photo.mimeType};base64,${Buffer.from(photo.bytes).toString('base64')}`,
    })),
    words: FIXTURE_WORDS,
    text: FIXTURE_TEXT,
    endCard: buildEndCard('https://friendword-e2e.example', 'demo-blair'),
  };
  return payload;
}

async function seekAndShoot(page: Page, tMs: number): Promise<Buffer> {
  await page.evaluate(async (t) => {
    if (window.__friendwordRender === undefined) {
      throw new Error('render harness missing');
    }
    await window.__friendwordRender.seek(t);
  }, tMs);
  // Same capture options as the engine (no clip: the viewport is the frame).
  return Buffer.from(
    await page.screenshot({
      type: 'jpeg',
      quality: 92,
      optimizeForSpeed: true,
    }),
  );
}

function ffprobe(file: string): {
  streams: { codec_type: string; codec_name: string; width?: number; height?: number }[];
  format: { duration: string };
} {
  const raw = execFileSync(ffprobeStatic.path, [
    '-v',
    'error',
    '-print_format',
    'json',
    '-show_streams',
    '-show_format',
    file,
  ]).toString('utf8');
  return JSON.parse(raw) as ReturnType<typeof ffprobe>;
}

describe.runIf(E2E)('capture purity against the live page', () => {
  let browser: Browser;
  let page: Page;
  const scene = qaScene();
  const photos = scene.assetIds.map((assetId, index) => photoAsset(assetId, index));

  beforeAll(async () => {
    browser = await launchRenderBrowser();
    page = await browser.newPage();
    await page.goto(`${BASE_URL}/internal/render/e2e-purity`, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForFunction(() => window.__friendwordRenderReady === true, {
      timeout: 60_000,
    });
    await page.evaluate(
      async (payload) => {
        if (window.__friendwordRender === undefined) {
          throw new Error('render harness missing');
        }
        await window.__friendwordRender.loadPayload(payload);
      },
      toPayload(scene, photos),
    );
  });

  afterAll(async () => {
    await browser?.close();
  });

  it('P2/completion 5: the same millisecond captures byte-identical frames', async () => {
    const first = await seekAndShoot(page, 5_000);
    const other = await seekAndShoot(page, 8_000);
    const again = await seekAndShoot(page, 5_000);
    expect(first.equals(again)).toBe(true);
    expect(first.equals(other)).toBe(false);
  });

  it('does not lag a frame behind the injected clock at a shot boundary', async () => {
    // qa scene: shot 1 (photo ...000b) ends at 6000ms, shot 2 (photo ...000c)
    // begins there. A capture loop that trails its seeks by one commit would
    // still show shot 1's photo at 6010ms — the failure the same-t-twice check
    // cannot see.
    const before = await seekAndShoot(page, 5_990);
    const stateBefore = await page.evaluate(() => {
      const stage = document.querySelector<HTMLElement>('[data-scene-v2]');
      const visible = Array.from(
        document.querySelectorAll<HTMLImageElement>('[data-render-stage] img'),
      ).find((image) => image.style.transform !== 'none' && image.style.transform !== '');
      return { shot: stage?.dataset.motionShot, photo: visible?.dataset.motionPhoto };
    });
    const after = await seekAndShoot(page, 6_010);
    const stateAfter = await page.evaluate(() => {
      const stage = document.querySelector<HTMLElement>('[data-scene-v2]');
      const visible = Array.from(
        document.querySelectorAll<HTMLImageElement>('[data-render-stage] img'),
      ).find((image) => image.style.transform !== 'none' && image.style.transform !== '');
      return { shot: stage?.dataset.motionShot, photo: visible?.dataset.motionPhoto };
    });
    expect(stateBefore).toEqual({
      shot: '1',
      photo: '97000000-0000-0000-0000-00000000000b',
    });
    expect(stateAfter).toEqual({
      shot: '2',
      photo: '97000000-0000-0000-0000-00000000000c',
    });
    expect(before.equals(after)).toBe(false);
  });

  it('P4: the end card shows the platform constants and canonical URL only', async () => {
    await page.evaluate(async () => {
      if (window.__friendwordRender === undefined) {
        throw new Error('render harness missing');
      }
      await window.__friendwordRender.showEndCard();
    });
    const text = await page.evaluate(
      () => document.querySelector('[data-render-end-card]')?.textContent ?? '',
    );
    expect(text).toContain('Friendword');
    expect(text).toContain('friendword-e2e.example/p/demo-blair');
  });
});

describe.runIf(E2E)('renderScene end to end (QA scene, 15s)', () => {
  it('produces a playable 1080x1920 MP4 with the original audio appended silent end card', async () => {
    const scene = qaScene();
    const photos = scene.assetIds.map((assetId, index) => photoAsset(assetId, index));
    const { mp4, stats } = await renderScene(
      scene,
      { photos, audio: audioM4a(15) },
      {
        baseUrl: BASE_URL,
        renderKey: 'e2e-qa-scene',
        campaignSlug: 'demo-blair',
        shareOrigin: 'https://friendword-e2e.example',
        words: FIXTURE_WORDS,
        text: FIXTURE_TEXT,
      },
    );
    mkdirSync(OUT_DIR, { recursive: true });
    const outFile = path.join(OUT_DIR, 'qa-15s.mp4');
    writeFileSync(outFile, mp4);

    const probed = ffprobe(outFile);
    const video = probed.streams.find((stream) => stream.codec_type === 'video');
    const audio = probed.streams.find((stream) => stream.codec_type === 'audio');
    expect(video).toMatchObject({ codec_name: 'h264', width: 1080, height: 1920 });
    expect(audio).toMatchObject({ codec_name: 'aac' });
    // 15s approved timeline + 1.5s end card; the audio track simply ends.
    expect(Number(probed.format.duration)).toBeGreaterThan(16.3);
    expect(Number(probed.format.duration)).toBeLessThan(16.8);
    expect(stats.sceneFrames).toBe(450);
    expect(stats.endCardFrames).toBe(45);

    console.log(`[render e2e] MP4 at ${outFile} (${(mp4.byteLength / 1e6).toFixed(1)}MB)`);
    console.log(`[render e2e] stats ${JSON.stringify(stats)}`);
  });
});
