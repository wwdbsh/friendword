import Link from 'next/link';

import {
  BoundaryActions,
  BoundaryHomeLink,
  BoundaryScreen,
  boundaryStyles,
} from '@/components/BoundaryScreen';

/**
 * The confirmed terminal state of every campaign, given its own screen instead
 * of the shared 404 (GAP-7 / T013, Issue #50).
 *
 * Every live window is finite by design, so "it ended" is the single most
 * likely reason a link someone shared months ago stops working. Told that, a
 * reader stops wondering whether they mistyped it — and stops trying.
 *
 * §12: it states the fact and stops. It does not say the page may come back (an
 * expired campaign cannot be resumed), does not say when it ended, and offers
 * no way to reach the person it was about — interest cannot be delivered
 * through a closed campaign, so any such affordance would be a false promise.
 */
export function CampaignEnded() {
  return (
    <BoundaryScreen badge="Ended" title="This campaign has ended.">
      <p className={boundaryStyles.muted}>
        Its window closed, so the page is no longer public and nothing can be sent through it.
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
