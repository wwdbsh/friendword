export default {
  root: new URL('.', import.meta.url).pathname,
  resolve: {
    alias: {
      '@': new URL('./src', import.meta.url).pathname,
      // The tested routes pull in server-only libs (providerBudget,
      // accountStatus) directly, not only through the mocked supabaseServer.
      // Neutralize the 'server-only' guard in this node test env.
      'server-only': new URL('./tests-audit3/serverOnlyShim.ts', import.meta.url).pathname,
    },
  },
  // The image routes (/api/og, /api/kit-image) are .tsx and build their card
  // with JSX. The repo tsconfig leaves `jsx: preserve` for Next, which esbuild
  // falls back to the classic runtime for — and there is no `React` global in
  // this node env. The automatic runtime is what Next itself compiles these
  // routes with.
  esbuild: { jsx: 'automatic' as const },
  test: {
    environment: 'node',
    globals: true,
    include: ['tests-audit3/**/*.audit3.test.ts'],
  },
};
