import Link from 'next/link';

import {
  BoundaryActions,
  BoundaryHomeLink,
  BoundaryScreen,
  boundaryStyles,
} from '@/components/BoundaryScreen';

/**
 * The 404 for a campaign URL (T013 / WUI-4, GAP-7).
 *
 * This is the boundary a stranger from a reel hits, so it is the one that most
 * needed to stop being the framework's black-on-white default.
 *
 * A campaign whose window closed gets its own screen from `page.tsx`, which can
 * read that fact from the row. Everything this file catches is a case the
 * server deliberately will NOT distinguish — an unknown slug, a page the owner
 * paused or took down, one the public gate is not exposing — so the copy names
 * the possibilities without asserting which one happened (§12).
 *
 * No `metadata` export, and none in the page's `generateMetadata` either:
 * measured, Next.js reads NEITHER for a segment `not-found`, so the tab keeps
 * the layout's "Friendword". A dead export here would read as a title that is
 * being set when it is not. The `noindex` that matters is already carried by
 * the page's own metadata, which runs before `notFound()` is raised.
 */
export default function PitchNotFound() {
  return (
    <BoundaryScreen badge="Not found" title="This pitch isn’t here.">
      <p className={boundaryStyles.muted}>
        The link may be mistyped, or this page may have ended or been taken down.
      </p>
      <BoundaryActions>
        <Link className={boundaryStyles.secondary} href="/p/demo-blair">
          See a demo pitch
        </Link>
        <BoundaryHomeLink />
      </BoundaryActions>
    </BoundaryScreen>
  );
}
