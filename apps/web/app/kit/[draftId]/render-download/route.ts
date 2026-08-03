import { z } from 'zod';

import { createBrowserClient } from '@friendword/data';

import { getSupabaseServiceClient } from '@/lib/supabaseServer';

export const dynamic = 'force-dynamic';

const PITCH_MEDIA_BUCKET = 'pitch-media';
const SIGNED_MP4_SECONDS = 5 * 60;

const uuidSchema = z.string().uuid();

/**
 * Signed download URL for a finished MP4 render (Phase 4, E5). The output
 * object lives at pitch-media/<draftId>/renders/<revisionId>.mp4 — a NESTED
 * prefix that private.pitch_media_draft_id (0003) deliberately does not
 * parse, which keeps renders out of the 20-object quota (0054) but also
 * makes them invisible to the member storage SELECT policy. So the browser
 * cannot sign this path itself; this route does it with the service key
 * after re-checking the same relationship that policy enforces for every
 * flat object in the draft folder: the caller is the draft's introducer or
 * subject. It lives beside the kit page that calls it, and the object path
 * is built here from two validated UUIDs — no client-supplied path ever
 * reaches storage.
 */
export async function GET(
  request: Request,
  context: { readonly params: Promise<{ readonly draftId: string }> },
): Promise<Response> {
  const serviceClient = getSupabaseServiceClient();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (serviceClient === null || url === undefined || anonKey === undefined) {
    return Response.json({ error: 'not configured' }, { status: 501 });
  }

  const accessToken = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (accessToken === '') {
    return Response.json({ error: 'authentication required' }, { status: 401 });
  }

  const { draftId: rawDraftId } = await context.params;
  const draftId = uuidSchema.safeParse(rawDraftId);
  const revisionId = uuidSchema.safeParse(new URL(request.url).searchParams.get('revisionId'));
  if (!draftId.success || !revisionId.success) {
    return Response.json({ error: 'draftId and revisionId required' }, { status: 400 });
  }

  const authClient = createBrowserClient(url, anonKey);
  const { data: userData, error: userError } = await authClient.auth.getUser(accessToken);
  if (userError !== null || userData.user === null) {
    return Response.json({ error: 'authentication required' }, { status: 401 });
  }

  const { data: draft } = await serviceClient
    .from('pitch_drafts')
    .select('created_by_user_id, subject_user_id')
    .eq('id', draftId.data)
    .maybeSingle();
  if (draft === null || draft === undefined) {
    return Response.json({ error: 'draft not found' }, { status: 404 });
  }
  const callerId = userData.user.id;
  if (callerId !== draft.created_by_user_id && callerId !== draft.subject_user_id) {
    return Response.json({ error: 'not yours to download' }, { status: 403 });
  }

  // Existence first: createSignedUrl alone may not prove the object is there,
  // and a URL to a missing object would surface as a broken download instead
  // of an honest 404.
  const objectFileName = `${revisionId.data}.mp4`;
  const { data: entries } = await serviceClient.storage
    .from(PITCH_MEDIA_BUCKET)
    .list(`${draftId.data}/renders`, { search: objectFileName });
  const exists = entries?.some((entry) => entry.name === objectFileName) ?? false;
  if (!exists) {
    return Response.json({ error: 'render not found' }, { status: 404 });
  }

  const { data: signed, error: signError } = await serviceClient.storage
    .from(PITCH_MEDIA_BUCKET)
    .createSignedUrl(`${draftId.data}/renders/${objectFileName}`, SIGNED_MP4_SECONDS, {
      download: 'friendword-pitch.mp4',
    });
  if (signError !== null || signed === null) {
    return Response.json({ error: 'render not found' }, { status: 404 });
  }

  return Response.json(
    { url: signed.signedUrl },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}
