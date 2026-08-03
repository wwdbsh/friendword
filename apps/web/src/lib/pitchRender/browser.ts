import { existsSync } from 'node:fs';

import chromium from '@sparticuz/chromium';
import puppeteer, { type Browser } from 'puppeteer-core';

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
 * Headless Chromium sized for capture. On linux (Vercel) the @sparticuz build
 * self-extracts to /tmp (~209MB, counted in the runtime /tmp budget); anywhere
 * else a locally installed Chrome is used — the sparticuz binaries are
 * linux-x64 only, so local runs measure the pipeline, not the deploy target.
 */
export async function launchRenderBrowser(executablePathOverride?: string): Promise<Browser> {
  if (process.platform === 'linux' && executablePathOverride === undefined) {
    return puppeteer.launch({
      executablePath: await chromium.executablePath(),
      args: [...chromium.args, ...SHARED_ARGS],
      headless: 'shell',
      defaultViewport: RENDER_VIEWPORT,
    });
  }
  return puppeteer.launch({
    executablePath: localExecutablePath(executablePathOverride),
    args: SHARED_ARGS,
    headless: true,
    defaultViewport: RENDER_VIEWPORT,
  });
}
