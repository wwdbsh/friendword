'use client';

import {
  BoundaryActions,
  BoundaryHomeLink,
  BoundaryScreen,
  boundaryStyles,
} from '@/components/BoundaryScreen';

import './globals.css';
import { themeCss } from './theme-tokens';

/**
 * The last boundary (T013 / WUI-4): a throw in the ROOT layout itself, which
 * `app/error.tsx` sits inside and therefore cannot catch. React replaces the
 * whole document here, so this file owns `<html>` and `<body>` — and has to
 * re-declare the design tokens, because the root layout that normally injects
 * them is exactly what failed.
 *
 * The web fonts are deliberately not re-loaded: fetching two font families is
 * one more thing that can fail on the screen whose whole job is to survive a
 * failure, and the sticker card reads fine in the system sans.
 */
export default function GlobalError({
  reset,
}: {
  readonly error: Error & { readonly digest?: string };
  readonly reset: () => void;
}) {
  return (
    <html lang="en">
      <head>
        <style>{themeCss}</style>
      </head>
      <body>
        <BoundaryScreen badge="Hold up" badgeTone="danger" title="Friendword didn’t load.">
          <p className={boundaryStyles.muted}>Something went wrong on our side.</p>
          <BoundaryActions>
            <button className={boundaryStyles.primary} type="button" onClick={() => reset()}>
              Try again
            </button>
            <BoundaryHomeLink />
          </BoundaryActions>
        </BoundaryScreen>
      </body>
    </html>
  );
}
