import type { ReactNode } from 'react';

/**
 * Static render for React Native trees under Vitest.
 *
 * The app has no native runtime in tests, so every suite that wanted to assert
 * on a screen mocked `react-native` down to host elements and rendered with
 * `react-dom/server`. Five suites had five copies of the same twelve-line
 * loader for it. This is that loader, once.
 *
 * `require` rather than `import` because `react-dom/server` is not part of the
 * app's own dependency graph — only its tests reach for it — and the runtime
 * check keeps a missing or reshaped renderer from failing as a confusing
 * "markup is undefined" deep inside an assertion.
 */
export function renderStatic(node: ReactNode): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const renderModule: unknown = require('react-dom/server');
  if (typeof renderModule !== 'object' || renderModule === null) {
    throw new Error('react-dom/server renderer is unavailable');
  }
  if (!('renderToStaticMarkup' in renderModule)) {
    throw new Error('react-dom/server renderer is unavailable');
  }
  const renderer = renderModule.renderToStaticMarkup;
  if (typeof renderer !== 'function') {
    throw new Error('react-dom/server renderer is invalid');
  }
  const markup: unknown = renderer(node);
  if (typeof markup !== 'string') {
    throw new Error('react-dom/server returned non-string markup');
  }
  return markup;
}
