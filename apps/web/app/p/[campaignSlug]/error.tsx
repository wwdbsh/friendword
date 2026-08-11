'use client';

import {
  BoundaryActions,
  BoundaryHomeLink,
  BoundaryScreen,
  boundaryStyles,
} from '@/components/BoundaryScreen';

/**
 * The error boundary for a campaign URL (T013 / WUI-4). The public pitch page
 * mints signed media URLs on every request, so a storage or database hiccup
 * throws here — on the one route strangers arrive at from a reel.
 *
 * §12: a failed load says nothing about whether the campaign exists, so this
 * screen says nothing about it either. It offers the retry it can actually
 * perform and the way home.
 */
export default function PitchError({
  reset,
}: {
  readonly error: Error & { readonly digest?: string };
  readonly reset: () => void;
}) {
  return (
    <BoundaryScreen badge="Hold up" badgeTone="danger" title="This pitch didn’t load.">
      <p className={boundaryStyles.muted}>
        Something went wrong on our side while loading it. We can’t tell you from here whether the
        page is still up.
      </p>
      <BoundaryActions>
        <button className={boundaryStyles.primary} type="button" onClick={() => reset()}>
          Try again
        </button>
        <BoundaryHomeLink />
      </BoundaryActions>
    </BoundaryScreen>
  );
}
