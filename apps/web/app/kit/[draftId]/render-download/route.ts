import { z } from 'zod';

import { createBrowserClient } from '@friendword/data';

import { RENDER_DOWNLOAD_FILENAME } from '@/lib/renderDownload';
import { getSupabaseServiceClient } from '@/lib/supabaseServer';

export const dynamic = 'force-dynamic';
// The invocation stays open for as long as the client is pulling bytes. The
// job row caps an output at 200MB (0054), so 300s covers a ~5.6Mbps client at
// the worst legal size; a real pitch export is a fraction of that. This is the
// price of owning the download instead of handing the browser a foreign URL —
// see the block comment below.
export const maxDuration = 300;

const PITCH_MEDIA_BUCKET = 'pitch-media';
const SIGNED_MP4_SECONDS = 5 * 60;

const uuidSchema = z.string().uuid();

/**
 * The finished MP4, streamed from THIS origin (Phase 4 E5; repaired for Issue
 * #52 GAP-9).
 *
 * The object lives at pitch-media/<draftId>/renders/<revisionId>.mp4 — a
 * NESTED prefix that private.pitch_media_draft_id (0003) deliberately does not
 * parse, which keeps renders out of the 20-object quota (0054) but also makes
 * them invisible to the member storage SELECT policy. So the browser cannot
 * sign this path itself; this route does it with the service key after
 * re-checking the same relationship that policy enforces for every flat object
 * in the draft folder: the caller is the draft's introducer or subject. The
 * object path is built here from two validated UUIDs — no client-supplied path
 * ever reaches storage.
 *
 * WHY IT STREAMS INSTEAD OF RETURNING THE SIGNED URL. This is the last step of
 * the growth loop: the MP4 has to land in the phone's camera roll or Files
 * before it can become a reel. The previous shape handed the browser a signed
 * Supabase URL and clicked an anchor at it, which put the whole outcome on a
 * cross-origin `content-disposition` we do not control:
 *
 *   - the anchor's `download` attribute is INERT cross-origin, so it could
 *     neither force the save nor name the file — the name came from whatever
 *     the storage host echoed;
 *   - where the header is not honoured and video/mp4 renders inline (iOS
 *     Safari, most in-app webviews), the click NAVIGATED THE KIT PAGE AWAY
 *     into a video player. The person loses the page they were working on and
 *     gets no file;
 *   - a failure — expired token, deleted object — replaced the app with a
 *     storage error document, and the card could not report it because the
 *     navigation had already happened.
 *
 * Served from our own origin the contract is ours end to end: the disposition
 * and the filename are set here, the caller fetches with its bearer token and
 * turns the bytes into a same-origin blob (where `download` DOES apply), and
 * every failure comes back as a status code the card can render in place.
 * `content-length` is passed through so the caller can compare it against the
 * bytes it received and refuse a truncated file.
 *
 * The upstream read is a signed URL rather than storage `download()` because
 * that returns a fully-buffered Blob: a 200MB export would be held in the
 * function's memory before a single byte reached the browser. Piping the body
 * through keeps the function flat.
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
  // of an honest 404. The listing also carries the size we advertise.
  const objectFileName = `${revisionId.data}.mp4`;
  const { data: entries } = await serviceClient.storage
    .from(PITCH_MEDIA_BUCKET)
    .list(`${draftId.data}/renders`, { search: objectFileName });
  const entry = entries?.find((candidate) => candidate.name === objectFileName) ?? null;
  if (entry === null) {
    return Response.json({ error: 'render not found' }, { status: 404 });
  }

  const { data: signed, error: signError } = await serviceClient.storage
    .from(PITCH_MEDIA_BUCKET)
    .createSignedUrl(`${draftId.data}/renders/${objectFileName}`, SIGNED_MP4_SECONDS);
  if (signError !== null || signed === null) {
    return Response.json({ error: 'render not found' }, { status: 404 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(signed.signedUrl);
  } catch {
    // The provider's failure text can quote the signed URL; never surface it.
    return Response.json({ error: 'render unavailable' }, { status: 502 });
  }
  if (!upstream.ok || upstream.body === null) {
    return Response.json({ error: 'render unavailable' }, { status: 502 });
  }

  // Prefer the size the object listing reported; fall back to whatever the
  // upstream declared. Omitted rather than guessed when neither is a number —
  // a WRONG content-length is worse than none (the caller's integrity check
  // would reject a perfectly good file).
  const listedSize: unknown = entry.metadata?.['size'];
  const upstreamLength = Number.parseInt(upstream.headers.get('content-length') ?? '', 10);
  const contentLength =
    typeof listedSize === 'number' && Number.isFinite(listedSize) && listedSize > 0
      ? listedSize
      : Number.isFinite(upstreamLength) && upstreamLength > 0
        ? upstreamLength
        : null;

  return new Response(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': 'video/mp4',
      'Content-Disposition': `attachment; filename="${RENDER_DOWNLOAD_FILENAME}"`,
      ...(contentLength === null ? {} : { 'Content-Length': String(contentLength) }),
      // The bytes are a private render behind a bearer check; nothing on the
      // way may keep a copy. Range serving is not offered — the caller reads
      // the whole object once.
      'Cache-Control': 'private, no-store',
      'Accept-Ranges': 'none',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
