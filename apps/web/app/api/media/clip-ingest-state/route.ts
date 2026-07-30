import { after, NextResponse } from 'next/server';
import { z } from 'zod';

import { createBrowserClient, type ServiceSupabaseClient } from '@friendword/data';

import { isActiveAccount } from '@/lib/accountStatus';
import { triggerIngestRun } from '@/lib/clipIngest/trigger';
import { getSupabaseServiceClient } from '@/lib/supabaseServer';

export const dynamic = 'force-dynamic';

const PITCH_MEDIA_BUCKET = 'pitch-media';
const SIGNED_URL_TTL_SECONDS = 600;

const requestSchema = z.object({
  bucket: z.literal(PITCH_MEDIA_BUCKET),
  draftId: z.string().uuid(),
  objectNames: z
    .array(
      z
        .string()
        .min(3)
        .max(255)
        // Bare file names under the draft prefix, exactly as registered — a
        // path separator or dot-dot is someone probing, not the mobile app.
        .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)
        .refine((name) => !name.includes('..')),
    )
    .min(1)
    .max(16),
});

/**
 * pitch_video_ingests (0050) postdates the generated database.types.ts, so it
 * is read through the same loose seam providerBudget.ts documents, and every
 * row is re-validated structurally before anything is reported.
 */
const ingestStateRowSchema = z.object({
  asset_id: z.string().uuid(),
  ingest_status: z.enum(['pending', 'processing', 'succeeded', 'flagged', 'failed']),
  duration_ms: z.number().int().nullable(),
  proxy_path: z.string().nullable(),
  poster_path: z.string().nullable(),
});

type IngestStateRow = z.infer<typeof ingestStateRowSchema>;

type LooseSelect = (
  table: string,
  columns: string,
  inColumn: string,
  inValues: readonly string[],
) => PromiseLike<{ data: unknown; error: { readonly message?: string | null } | null }>;

function looseSelect(serviceClient: ServiceSupabaseClient): LooseSelect {
  const from = serviceClient.from.bind(serviceClient) as unknown as (table: string) => {
    select: (columns: string) => {
      in: (
        column: string,
        values: readonly string[],
      ) => PromiseLike<{ data: unknown; error: { readonly message?: string | null } | null }>;
    };
  };
  return (table, columns, inColumn, inValues) => from(table).select(columns).in(inColumn, inValues);
}

/**
 * One clip's consent-surface card. Deliberately narrow: state, length, and —
 * only once ingest succeeded — short-lived signed URLs for the poster and the
 * SILENT proxy. `face_boxes` is never selected by this route, matching the 0050
 * service-only contract; the audit3 test pins its absence from the payload.
 */
type ClipCard = {
  readonly state: string;
  readonly durationMs: number | null;
  readonly posterUrl: string | null;
  readonly proxyUrl: string | null;
};

async function signIfPresent(
  serviceClient: ServiceSupabaseClient,
  storagePath: string | null,
): Promise<string | null> {
  if (storagePath === null || !storagePath.startsWith(`${PITCH_MEDIA_BUCKET}/`)) {
    return null;
  }
  const objectPath = storagePath.slice(`${PITCH_MEDIA_BUCKET}/`.length);
  const { data, error } = await serviceClient.storage
    .from(PITCH_MEDIA_BUCKET)
    .createSignedUrl(objectPath, SIGNED_URL_TTL_SECONDS);
  return error === null ? (data?.signedUrl ?? null) : null;
}

/**
 * Ingest state per uploaded clip object — the server half of the contract the
 * mobile app wired first (apps/mobile/src/services/clipIngest.ts): POST with a
 * bearer Supabase JWT and `{bucket, draftId, objectNames}`, answer
 * `{states: {"<objectName>": "pending|processing|succeeded|flagged|failed"}}`.
 * Lookup is by pitch_assets.storage_path. `clips` is additive card data for the
 * web consent surface; a client that only knows `states` is unaffected.
 *
 * Authorization mirrors /api/media/validate on pitch-media: the draft's
 * creator at any time, the subject only while the draft awaits their consent.
 * Anyone else — signed in or not — learns nothing, not even whether the draft
 * exists.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const serviceClient = getSupabaseServiceClient();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (serviceClient === null || url === undefined || anonKey === undefined) {
    return NextResponse.json({ error: 'not configured' }, { status: 501 });
  }

  const accessToken = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (accessToken === '') {
    return NextResponse.json({ error: 'authentication required' }, { status: 401 });
  }

  const parsedBody = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsedBody.success) {
    return NextResponse.json(
      { error: 'bucket, draftId and objectNames required' },
      { status: 400 },
    );
  }
  const { draftId, objectNames } = parsedBody.data;

  const authClient = createBrowserClient(url, anonKey);
  const { data: userData, error: userError } = await authClient.auth.getUser(accessToken);
  if (userError !== null || userData.user === null) {
    return NextResponse.json({ error: 'authentication required' }, { status: 401 });
  }
  const callerId = userData.user.id;
  if (!(await isActiveAccount(serviceClient, callerId))) {
    return NextResponse.json({ error: 'account is not active' }, { status: 403 });
  }

  const { data: draft } = await serviceClient
    .from('pitch_drafts')
    .select('created_by_user_id, subject_user_id, status')
    .eq('id', draftId)
    .maybeSingle();
  const isCreator = draft !== null && draft.created_by_user_id === callerId;
  const isConsentSubject =
    draft !== null && draft.subject_user_id === callerId && draft.status === 'consent_pending';
  if (draft === null || (!isCreator && !isConsentSubject)) {
    return NextResponse.json({ error: 'draft is not yours to read' }, { status: 403 });
  }

  const { data: assets, error: assetsError } = await serviceClient
    .from('pitch_assets')
    .select('id, storage_path')
    .eq('pitch_draft_id', draftId)
    .eq('asset_type', 'video');
  if (assetsError !== null) {
    return NextResponse.json({ error: 'clip lookup failed' }, { status: 500 });
  }

  const assetIdByObjectName = new Map<string, string>();
  for (const objectName of objectNames) {
    const storagePath = `${PITCH_MEDIA_BUCKET}/${draftId}/${objectName}`;
    const asset = assets.find((row) => row.storage_path === storagePath);
    if (asset !== undefined) {
      assetIdByObjectName.set(objectName, asset.id);
    }
  }

  const states: Record<string, string> = {};
  const clips: Record<string, ClipCard> = {};
  if (assetIdByObjectName.size > 0) {
    const { data: ingests, error: ingestsError } = await looseSelect(serviceClient)(
      'pitch_video_ingests',
      // face_boxes stays unselected: no browser-reachable query may carry it.
      'asset_id, ingest_status, duration_ms, proxy_path, poster_path',
      'asset_id',
      [...assetIdByObjectName.values()],
    );
    if (ingestsError !== null) {
      return NextResponse.json({ error: 'clip lookup failed' }, { status: 500 });
    }
    const rows: readonly IngestStateRow[] = (Array.isArray(ingests) ? ingests : [])
      .map((row) => ingestStateRowSchema.safeParse(row))
      .flatMap((parsed) => (parsed.success ? [parsed.data] : []));
    for (const [objectName, assetId] of assetIdByObjectName) {
      const row = rows.find((candidate) => candidate.asset_id === assetId);
      if (row === undefined) {
        continue;
      }
      states[objectName] = row.ingest_status;
      const succeeded = row.ingest_status === 'succeeded';
      clips[objectName] = {
        state: row.ingest_status,
        durationMs: row.duration_ms,
        posterUrl: succeeded ? await signIfPresent(serviceClient, row.poster_path) : null,
        proxyUrl: succeeded ? await signIfPresent(serviceClient, row.proxy_path) : null,
      };
    }
  }

  // A poll that still sees unfinished work pushes the worker once, after the
  // response is sent. `after` throws outside a real request scope (unit
  // tests); losing the push there is exactly the fallback the queue tolerates.
  const hasUnfinished = Object.values(states).some(
    (state) => state === 'pending' || state === 'failed',
  );
  if (hasUnfinished) {
    const origin = new URL(request.url).origin;
    try {
      after(() => triggerIngestRun(origin));
    } catch {
      // Not in a request scope; the next poll (or an operator) pushes instead.
    }
  }

  return NextResponse.json({ states, clips });
}
