import { NextResponse } from 'next/server';

import { resolveShareOrigin } from '@/lib/pitchRender/endCard';
import { runRenderPass } from '@/lib/pitchRender/jobRunner';
import { renderRunSecret, renderSecretMatches } from '@/lib/pitchRender/secret';
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
  return NextResponse.json(summary);
}
