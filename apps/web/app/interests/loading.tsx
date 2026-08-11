import { BoundaryScreen } from '@/components/BoundaryScreen';

/**
 * The loading boundary for this segment (T013 / WUI-4). Deliberately the SAME
 * sentence the client view prints while it reads the session, so a cold
 * start reads as one continuous wait rather than two different screens.
 *
 * Boundaries are NOT declared at the app root: a `loading.tsx` anywhere above
 * `/p/[campaignSlug]` makes Next.js flush the response before the page resolves,
 * and a `notFound()` after that point can no longer set the status — the pitch
 * 404 measurably degraded to a soft 200. The public page keeps its honest
 * status code; the segments that never 404 keep their branded wait.
 */
export default function InterestsLoading() {
  return <BoundaryScreen badge="Friendword" title="Opening your interests…" status />;
}
