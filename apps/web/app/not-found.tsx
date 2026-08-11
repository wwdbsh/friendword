import type { Metadata } from 'next';

import {
  BoundaryActions,
  BoundaryHomeLink,
  BoundaryScreen,
  boundaryStyles,
} from '@/components/BoundaryScreen';

export const metadata: Metadata = {
  title: 'Not found — Friendword',
  robots: { index: false, follow: false },
};

/**
 * The app-wide 404 (T013 / WUI-4). Reached by any URL no segment claims, and by
 * any `notFound()` a segment raises without a closer boundary.
 *
 * §12: it names the two things it can actually tell apart — a URL nothing
 * matches — and guesses at nothing else.
 */
export default function NotFound() {
  return (
    <BoundaryScreen badge="Not found" title="This page isn’t here.">
      <p className={boundaryStyles.muted}>
        The address may be mistyped, or the page may have been taken down.
      </p>
      <BoundaryActions>
        <BoundaryHomeLink />
      </BoundaryActions>
    </BoundaryScreen>
  );
}
