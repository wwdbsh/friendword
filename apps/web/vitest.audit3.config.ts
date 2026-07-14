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
  test: {
    environment: 'node',
    globals: true,
    include: ['tests-audit3/**/*.audit3.test.ts'],
  },
};
