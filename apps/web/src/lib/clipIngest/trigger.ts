import 'server-only';

/**
 * The shared-secret header value the ingest worker route requires. One env var
 * serves both sides: the route checks it, the poll-time trigger sends it. When
 * it is unset the worker route answers 501 and the trigger stays silent — the
 * queue then waits for an operator, it never processes unauthenticated.
 */
export function ingestRunSecret(env: NodeJS.ProcessEnv = process.env): string | null {
  const secret = env.FRIENDWORD_MEDIA_INGEST_SECRET ?? '';
  return secret.length >= 16 ? secret : null;
}

/**
 * Kicks the ingest worker for the deployment that served this request.
 * Fire-from-`after()`: the standard run path is opportunistic — the mobile app
 * polls clip state every 5s while a clip is pending, and each poll that still
 * sees a queued job pushes the worker once. There is no cron dependency
 * (scheduled-ops precedent: pg_cron cannot exec ffmpeg, and GitHub Actions was
 * retired 2026-07-25), and a stalled queue can always be pushed by hand:
 *
 *   curl -X POST "$ORIGIN/api/media/ingest-run" \
 *     -H "authorization: Bearer $FRIENDWORD_MEDIA_INGEST_SECRET"
 */
export async function triggerIngestRun(origin: string): Promise<void> {
  const secret = ingestRunSecret();
  if (secret === null) {
    return;
  }
  try {
    await fetch(`${origin}/api/media/ingest-run`, {
      method: 'POST',
      headers: { authorization: `Bearer ${secret}` },
    });
  } catch {
    // The queue survives a missed push: the next poll pushes again.
    console.warn('clip ingest: trigger request failed');
  }
}
