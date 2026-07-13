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
    include: ['tests-audit2/**/*.audit2.test.ts'],
  },
};
