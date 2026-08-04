import { after, NextResponse } from 'next/server';

import { resolveShareOrigin } from '@/lib/pitchRender/endCard';
import { runRenderPass } from '@/lib/pitchRender/jobRunner';
import { renderRunSecret, renderSecretMatches } from '@/lib/pitchRender/secret';
import { triggerRenderRun } from '@/lib/pitchRender/trigger';
import { getSupabaseServiceClient } from '@/lib/supabaseServer';

export const dynamic = 'force-dynamic';

/**
 * Worst-case scene is 60s = 1,800 frames, measured ~150s on one vCPU; 300 is
 * the same Hobby-plan ceiling the ingest worker runs under, and the pass
 * budget inside runRenderPass leaves margin under it.
 */
export const maxDuration = 300;

/**
 * The render worker (motion pitch Phase 4). Claims leased jobs from
 * media_render_jobs (0054), pulls the approved scene + assets from the
 * database and storage, renders the MP4 with the pure engine, stores it under
 * the draft's renders/ prefix and completes the job under the held lease.
 * Service-secret only, like ingest-run: operators and job triggers call it,
 * browsers never do. The request body is ignored — the queue is the input.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const secret = renderRunSecret();
  const serviceClient = getSupabaseServiceClient();
  if (secret === null || serviceClient === null) {
    return NextResponse.json({ error: 'not configured' }, { status: 501 });
  }
  const provided = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!renderSecretMatches(provided, secret)) {
    return NextResponse.json({ error: 'authentication required' }, { status: 401 });
  }

  const requestOrigin = new URL(request.url).origin;
  const baseUrl = process.env.PITCH_RENDER_BASE_URL ?? requestOrigin;
  const shareOrigin = resolveShareOrigin(baseUrl);
  if (shareOrigin === null) {
    return NextResponse.json({ error: 'share origin not configured' }, { status: 501 });
  }

  const summary = await runRenderPass(serviceClient, { baseUrl, shareOrigin });

  // Pass-end self-kick: runRenderPass stops CLAIMING 90s in (its claim
  // window) while one render alone takes ~150s, so a pass that rendered job A
  // exits without ever claiming queued job B — and if the user has closed the
  // kit page by then, nothing kicks again and B stalls forever, turning the
  // kit card's "it keeps running" copy into a lie (§12 class). A processed>0
  // re-kick chains passes until one claims nothing (processed 0 → no re-kick
  // → the chain terminates; the DB's 3-attempt budget ends failure loops).
  if (summary.processed > 0) {
    try {
      after(() => triggerRenderRun(requestOrigin));
    } catch {
      // Not in a request scope (unit tests); a kick or operator pushes instead.
    }
  }

  return NextResponse.json(summary);
}
