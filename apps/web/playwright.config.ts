import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  outputDir: '/tmp/friendword-playwright-results',
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3000',
    channel: 'chrome',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
});
