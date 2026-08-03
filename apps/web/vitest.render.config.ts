// The MP4 render engine's suite. The unit half (validation, encoder argv, end
// card, deterministic paths) always runs; the integration half drives a real
// headless Chrome against a running `next start` and is gated behind
// PITCH_RENDER_E2E=1 (plus PITCH_RENDER_MEASURE=1 for the 60s worst-case
// feasibility measurement), because CI boxes without Chrome must stay green.
export default {
  root: new URL('.', import.meta.url).pathname,
  resolve: {
    alias: {
      '@': new URL('./src', import.meta.url).pathname,
    },
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['tests-render/**/*.render.test.ts'],
    testTimeout: 600_000,
    hookTimeout: 120_000,
  },
};
