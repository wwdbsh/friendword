'use client';

import {
  BoundaryActions,
  BoundaryHomeLink,
  BoundaryScreen,
  boundaryStyles,
} from '@/components/BoundaryScreen';

/**
 * The app-wide error boundary (T013 / WUI-4). Any uncaught throw in a page or
 * layout below the root lands here instead of on the framework's own screen.
 *
 * §12: this screen knows one thing — the page did not finish loading. It does
 * not claim the problem is temporary, does not claim anything was or was not
 * saved, and does not surface `error.message`, which can carry internals.
 * "Try again" is the real thing `reset()` does: re-render this route.
 */
export default function RouteError({
  reset,
}: {
  readonly error: Error & { readonly digest?: string };
  readonly reset: () => void;
}) {
  return (
    <BoundaryScreen badge="Hold up" badgeTone="danger" title="This page didn’t load.">
      <p className={boundaryStyles.muted}>Something went wrong on our side while loading it.</p>
      <BoundaryActions>
        <button className={boundaryStyles.primary} type="button" onClick={() => reset()}>
          Try again
        </button>
        <BoundaryHomeLink />
      </BoundaryActions>
    </BoundaryScreen>
  );
}
