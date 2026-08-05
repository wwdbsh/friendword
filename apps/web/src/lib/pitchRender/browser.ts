import { existsSync } from 'node:fs';
import { stat, statfs } from 'node:fs/promises';
import os from 'node:os';

import chromium from '@sparticuz/chromium';
import puppeteer, { type Browser } from 'puppeteer-core';

import {
  DIAGNOSTIC_LIMITS,
  collectProcessDiagnostics,
  truncateUtf8,
  type LaunchDiagnostics,
  type LaunchProbe,
} from './diagnostics';

// One frame of the reel is exactly one CSS pixel grid: 1080x1920 at DPR 1, GPU
// off. Changing any of these changes what every downloaded file looks like.
export const RENDER_VIEWPORT = { width: 1080, height: 1920, deviceScaleFactor: 1 } as const;

const SHARED_ARGS = [
  '--disable-gpu',
  '--hide-scrollbars',
  '--mute-audio',
  // Screenshot pixels must not depend on the host's display profile.
  '--force-color-profile=srgb',
  '--disable-lcd-text',
  // One origin, one page, no third-party content: fewer processes is pure
  // memory headroom here (the function budget is shared with ffmpeg).
  '--disable-features=IsolateOrigins,site-per-process',
  '--renderer-process-limit=1',
  '--disable-extensions',
  '--no-first-run',
  '--disable-background-networking',
];

/** Local (darwin/dev) fallbacks; production always goes through @sparticuz. */
const LOCAL_CHROME_PATHS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
];

function localExecutablePath(override: string | undefined): string {
  const candidates = [
    override,
    process.env.PITCH_RENDER_CHROME,
    process.env.PUPPETEER_EXECUTABLE_PATH,
    ...LOCAL_CHROME_PATHS,
  ];
  for (const candidate of candidates) {
    if (candidate !== undefined && candidate.length > 0 && existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error(
    'no Chrome executable found for pitch render; set PITCH_RENDER_CHROME to a local Chrome/Chromium binary',
  );
}

/**
 * Describe the launch attempt from outside the browser, BEFORE puppeteer is
 * asked for anything — the only moment at which "the binary was there and
 * /tmp had room" is still observable if the launch then dies.
 */
async function probeLaunch(input: {
  readonly mode: LaunchProbe['mode'];
  readonly executablePath: string | null;
  readonly resolveError: string | null;
  readonly headless: string;
  readonly args: readonly string[];
}): Promise<LaunchProbe> {
  let executableBytes: number | null = null;
  let executableMode: string | null = null;
  let statError: string | null = null;
  if (input.executablePath !== null) {
    try {
      const info = await stat(input.executablePath);
      executableBytes = info.size;
      executableMode = (info.mode & 0o777).toString(8);
    } catch (error) {
      statError = error instanceof Error ? error.message : 'stat failed';
    }
  }

  const tmpDir = os.tmpdir();
  let tmpFreeBytes: number | null = null;
  let tmpTotalBytes: number | null = null;
  try {
    const volume = await statfs(tmpDir);
    tmpFreeBytes = volume.bavail * volume.bsize;
    tmpTotalBytes = volume.blocks * volume.bsize;
  } catch {
    // statfs is unavailable on some platforms; the rest of the probe still ships.
  }

  const args = truncateUtf8(input.args.join(' '), DIAGNOSTIC_LIMITS.launchArgsBytes);
  return {
    mode: input.mode,
    platform: `${process.platform}-${process.arch}`,
    executablePath: input.executablePath,
    executableExists: executableBytes !== null,
    executableBytes,
    executableMode,
    statError,
    resolveError: input.resolveError,
    tmpDir,
    tmpFreeBytes,
    tmpTotalBytes,
    headless: input.headless,
    argCount: input.args.length,
    args: args.text,
    argsTruncated: args.truncated,
  };
}

/**
 * Headless Chromium sized for capture. On linux (Vercel) the @sparticuz build
 * self-extracts to /tmp (~209MB, counted in the runtime /tmp budget); anywhere
 * else a locally installed Chrome is used — the sparticuz binaries are
 * linux-x64 only, so local runs measure the pipeline, not the deploy target.
 *
 * `diagnostics` is instrumentation only and OPTIONAL: with no sink the launch
 * flags, the executable choice and the syscalls made are exactly what they were
 * before, so the bench keeps measuring the pass the product runs.
 */
export async function launchRenderBrowser(
  executablePathOverride?: string,
  diagnostics?: LaunchDiagnostics,
): Promise<Browser> {
  const sparticuz = process.platform === 'linux' && executablePathOverride === undefined;

  let executablePath: string | null = null;
  let resolveFailure: unknown = null;
  try {
    executablePath = sparticuz
      ? await chromium.executablePath()
      : localExecutablePath(executablePathOverride);
  } catch (error) {
    resolveFailure = error;
  }

  const args = sparticuz ? [...chromium.args, ...SHARED_ARGS] : SHARED_ARGS;
  const headless: 'shell' | true = sparticuz ? 'shell' : true;

  if (diagnostics?.onProbe !== undefined) {
    diagnostics.onProbe(
      await probeLaunch({
        mode: sparticuz ? 'sparticuz-linux' : 'local',
        executablePath,
        resolveError:
          resolveFailure === null
            ? null
            : resolveFailure instanceof Error
              ? resolveFailure.message
              : 'executable path resolution failed',
        headless: String(headless),
        args,
      }),
    );
  }
  if (executablePath === null) {
    // Rethrow the ORIGINAL failure object: its message is the contract callers
    // and tests already read, and the probe is an addition to it, not a
    // replacement.
    throw resolveFailure;
  }

  const browser = await puppeteer.launch({
    executablePath,
    args,
    headless,
    defaultViewport: RENDER_VIEWPORT,
  });
  if (diagnostics !== undefined) {
    const child = browser.process();
    if (child !== null) {
      collectProcessDiagnostics(child, diagnostics);
    }
  }
  return browser;
}
