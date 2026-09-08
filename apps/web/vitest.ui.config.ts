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
    // Node >= 25 ships an experimental global `localStorage` accessor that
    // shadows jsdom's window.localStorage (returns undefined without
    // --localstorage-file). Disable it in the worker so jsdom owns storage.
    poolOptions: {
      forks: {
        execArgv: ['--no-experimental-webstorage'],
      },
    },
  },
};
