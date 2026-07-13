import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  outputDir: '/tmp/friendword-playwright-results',
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3000',
    // Locally we drive the real Chrome; CI uses the bundled Chromium.
    ...(process.env.CI === undefined ? { channel: 'chrome' as const } : {}),
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  // Specs mock every network call, so CI runs against a dev server with
  // placeholder Supabase env; locally an already-running :3000 is reused.
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
