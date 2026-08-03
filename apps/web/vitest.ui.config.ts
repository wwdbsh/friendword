// UI regression suite: mounts client components in jsdom so React effect
// lifecycles (mount → state → cleanup) actually run — the audit suites are
// node-only unit tests and cannot catch effect-cancellation bugs.
export default {
  root: new URL('.', import.meta.url).pathname,
  resolve: {
    alias: {
      '@': new URL('./src', import.meta.url).pathname,
    },
  },
  esbuild: {
    jsx: 'automatic' as const,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['tests-ui/**/*.ui.test.tsx'],
  },
};
