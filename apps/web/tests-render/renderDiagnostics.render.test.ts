/* global afterEach, describe, expect, it */

// T012: the render pipeline's REMOTE diagnostics. Production answered the first
// linux bench with `{"error":"NetworkError: A network error occurred."}` and
// nothing else — no stage, no Chromium stderr, no proof the extracted binary
// was even intact. These tests pin the primitives that make the next 500
// self-describing, and they must hold WITHOUT a browser on the box.

import { spawn } from 'node:child_process';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { launchRenderBrowser } from '@/lib/pitchRender/browser';
import {
  DIAGNOSTIC_LIMITS,
  collectProcessDiagnostics,
  createStageTracker,
  createStderrTail,
  describeError,
  truncateUtf8,
  type BrowserExit,
  type LaunchProbe,
  type RenderStage,
} from '@/lib/pitchRender/diagnostics';
import { renderScene } from '@/lib/pitchRender/renderScene';

import { photoAsset, qaScene } from './fixtures';

describe('truncateUtf8', () => {
  it('passes a value under the ceiling through untouched', () => {
    expect(truncateUtf8('short', 100)).toEqual({ text: 'short', totalBytes: 5, truncated: false });
  });

  it('caps at the byte ceiling and reports the original size', () => {
    const result = truncateUtf8('x'.repeat(5_000), 1_000);
    expect(Buffer.byteLength(result.text, 'utf8')).toBe(1_000);
    expect(result.totalBytes).toBe(5_000);
    expect(result.truncated).toBe(true);
  });

  it('never splits a multi-byte character', () => {
    // 10 chars x 3 bytes = 30 bytes; a 10-byte cut lands mid-character.
    const result = truncateUtf8('가'.repeat(10), 10);
    expect(result.text).toBe('가가가');
    expect(Buffer.byteLength(result.text, 'utf8')).toBe(9);
    expect(result.totalBytes).toBe(30);
    expect(result.truncated).toBe(true);
  });
});

describe('createStderrTail', () => {
  it('keeps the LAST bytes across chunks and reports the full volume', () => {
    const tail = createStderrTail(10);
    tail.append(Buffer.from('AAAAAAAAAA', 'utf8'));
    tail.append(Buffer.from('0123456789', 'utf8'));
    const read = tail.read();
    expect(read.text).toBe('0123456789');
    expect(read.totalBytes).toBe(20);
    expect(read.truncated).toBe(true);
  });

  it('reports an untruncated tail when everything fits', () => {
    const tail = createStderrTail(1_000);
    tail.append(Buffer.from('boot\n', 'utf8'));
    expect(tail.read()).toEqual({ text: 'boot\n', totalBytes: 5, truncated: false });
  });

  it('drops a partial leading character rather than emitting mojibake', () => {
    const tail = createStderrTail(4);
    tail.append(Buffer.from('가가', 'utf8'));
    const read = tail.read();
    expect(read.text).toBe('가');
    expect(read.totalBytes).toBe(6);
  });
});

describe('describeError', () => {
  it('carries name, message and stack off a real Error', () => {
    const detail = describeError(new Error('launch exploded'), 'fallback');
    expect(detail.name).toBe('Error');
    expect(detail.message).toBe('launch exploded');
    expect(detail.stack).toContain('launch exploded');
    expect(detail.truncated).toBe(false);
  });

  it('caps message and stack at the declared ceilings', () => {
    const error = new Error('X'.repeat(50_000));
    error.stack = 'S'.repeat(80_000);
    const detail = describeError(error, 'fallback');
    expect(Buffer.byteLength(detail.message, 'utf8')).toBe(DIAGNOSTIC_LIMITS.errorMessageBytes);
    expect(detail.stack).not.toBeNull();
    expect(Buffer.byteLength(detail.stack ?? '', 'utf8')).toBe(DIAGNOSTIC_LIMITS.errorStackBytes);
    expect(detail.truncated).toBe(true);
  });

  it('falls back for a non-Error throw without inventing a stack', () => {
    const detail = describeError({ weird: true }, 'bench render failed');
    expect(detail.name).toBe('NonError');
    expect(detail.message).toBe('bench render failed');
    expect(detail.stack).toBeNull();
  });
});

describe('createStageTracker', () => {
  it('reports the most recently entered stage', () => {
    const tracker = createStageTracker('input-synthesis');
    expect(tracker.current()).toBe('input-synthesis');
    tracker.mark('browser-launch');
    tracker.mark('page-goto');
    expect(tracker.current()).toBe('page-goto');
  });
});

describe('collectProcessDiagnostics', () => {
  it('tails a real child process stderr and captures its exit code', async () => {
    const tail = createStderrTail(1_000);
    const exits: BrowserExit[] = [];
    const child = spawn(process.execPath, [
      '-e',
      "process.stderr.write('E'.repeat(40000)); process.exit(7);",
    ]);
    collectProcessDiagnostics(child, {
      onStderr: (chunk) => {
        tail.append(chunk);
      },
      onExit: (info) => {
        exits.push(info);
      },
    });
    await new Promise<void>((resolve) => {
      child.once('close', () => {
        resolve();
      });
    });
    const read = tail.read();
    expect(read.totalBytes).toBe(40_000);
    expect(read.text).toBe('E'.repeat(1_000));
    expect(read.truncated).toBe(true);
    expect(exits).toEqual([{ code: 7, signal: null }]);
  });
});

describe('launchRenderBrowser pre-launch probe', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    for (const dir of tempDirs.splice(0)) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  /** An executable that EXISTS but is not a browser: resolution succeeds, the
   * launch dies — the shape of the production failure being instrumented. */
  async function fakeChromium(): Promise<string> {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'friendword-probe-'));
    tempDirs.push(dir);
    const file = path.join(dir, 'fake-chromium');
    await writeFile(file, '#!/bin/sh\necho "FAKE CHROMIUM STDERR" >&2\nexit 9\n', 'utf8');
    await chmod(file, 0o755);
    return file;
  }

  it('reports the resolved binary, its size and /tmp headroom before launching', async () => {
    const fake = await fakeChromium();
    const probes: LaunchProbe[] = [];
    await expect(
      launchRenderBrowser(fake, {
        onProbe: (value) => {
          probes.push(value);
        },
      }),
    ).rejects.toThrow();

    const seen = probes.at(0);
    if (seen === undefined) {
      throw new Error('the probe was never emitted');
    }
    expect(seen.mode).toBe('local');
    expect(seen.executablePath).toBe(fake);
    expect(seen.executableExists).toBe(true);
    expect(seen.executableBytes ?? 0).toBeGreaterThan(0);
    expect(seen.executableMode).toBe('755');
    expect(seen.statError).toBeNull();
    expect(seen.resolveError).toBeNull();
    expect(seen.tmpFreeBytes ?? 0).toBeGreaterThan(0);
    expect(seen.tmpTotalBytes ?? 0).toBeGreaterThan(0);
    expect(seen.headless).toBe('true');
    expect(seen.argCount).toBeGreaterThan(0);
    expect(seen.args).toContain('--disable-gpu');
    expect(seen.argsTruncated).toBe(false);
  });

  // The engine's own marks, not a stub's: these two stages are reachable
  // without a working browser, which is exactly the production situation.
  it('propagates scene-prepare from renderScene when the scene is refused', async () => {
    const stages: RenderStage[] = [];
    await expect(
      renderScene(
        { schemaVersion: 2, nonsense: true },
        { photos: [], audio: null },
        {
          baseUrl: 'http://127.0.0.1:3120',
          renderKey: 'diag-invalid-scene',
          campaignSlug: 'bench',
          shareOrigin: 'https://example.test',
          diagnostics: {
            onStage: (entered) => {
              stages.push(entered);
            },
          },
        },
      ),
    ).rejects.toThrow();
    expect(stages).toEqual(['scene-prepare']);
  });

  it('propagates browser-launch from renderScene when Chromium will not start', async () => {
    const fake = await fakeChromium();
    const workDir = await mkdtemp(path.join(os.tmpdir(), 'friendword-stage-'));
    tempDirs.push(workDir);
    const scene = qaScene();
    const photos = scene.assetIds.map((assetId, index) => photoAsset(assetId, index));

    const stages: RenderStage[] = [];
    await expect(
      renderScene(
        scene,
        { photos, audio: null },
        {
          baseUrl: 'http://127.0.0.1:3120',
          renderKey: 'diag-dead-browser',
          campaignSlug: 'bench',
          shareOrigin: 'https://example.test',
          executablePath: fake,
          workDir,
          diagnostics: {
            onStage: (entered) => {
              stages.push(entered);
            },
          },
        },
      ),
    ).rejects.toThrow();
    expect(stages).toEqual(['scene-prepare', 'browser-launch']);
  });
});
