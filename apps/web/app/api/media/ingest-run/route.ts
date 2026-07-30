import { timingSafeEqual } from 'node:crypto';

import { NextResponse } from 'next/server';

import { runClipIngestPass } from '@/lib/clipIngest/pipeline';
import { ingestRunSecret } from '@/lib/clipIngest/trigger';
import { getSupabaseServiceClient } from '@/lib/supabaseServer';

export const dynamic = 'force-dynamic';

/**
 * The whole pipeline for one 50MB clip measured ~90-150s p95 on one vCPU
 * (feasibility run, 2026-07-30), so 300s — the Hobby-plan ceiling, mirrored in
 * vercel.json — holds a full job with the pass budget (240s) inside it.
 */
export const maxDuration = 300;

function secretMatches(provided: string, expected: string): boolean {
  const providedBytes = Buffer.from(provided);
  const expectedBytes = Buffer.from(expected);
  return (
    providedBytes.length === expectedBytes.length && timingSafeEqual(providedBytes, expectedBytes)
  );
}

/**
 * The video ingest worker (motion pitch Phase 3a). Claims leased jobs from
 * media_ingest_jobs (0050) and runs each through probe → silent proxy → poster
 * → face boxes → frame moderation → complete, deleting the original on
 * success. Service-role only, behind a shared secret: this endpoint is invoked
 * by the clip-ingest-state poll trigger and by operators, never by browsers.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const secret = ingestRunSecret();
  const serviceClient = getSupabaseServiceClient();
  if (secret === null || serviceClient === null) {
    return NextResponse.json({ error: 'not configured' }, { status: 501 });
  }

  const provided = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!secretMatches(provided, secret)) {
    return NextResponse.json({ error: 'authentication required' }, { status: 401 });
  }

  // 150s budget against a 300s ceiling: a job may START only while the worst
  // measured single-job time (~150s p95 on one vCPU) still fits before the
  // platform kill. A job the platform kills anyway is retried by lease expiry,
  // but each kill spends one of the three attempts, so the margin is the point.
  const summary = await runClipIngestPass(serviceClient, { timeBudgetMs: 150_000, maxJobs: 5 });
  return NextResponse.json(summary);
}
