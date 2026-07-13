import { NextResponse } from 'next/server';
import { z } from 'zod';

import { createProviders, ProviderNotImplementedError } from '@friendword/adapters';
import {
  ALLOWED_IMAGE_KINDS,
  checkMediaSignature,
  MEDIA_MAX_BYTES,
  type MediaKind,
} from '@friendword/domain';
import { createBrowserClient } from '@friendword/data';

import { isActiveAccount } from '@/lib/accountStatus';
import { getSupabaseServiceClient } from '@/lib/supabaseServer';

export const dynamic = 'force-dynamic';

const requestSchema = z.object({
  bucket: z.enum(['pitch-media', 'profile-media']),
  objectName: z.string().min(3).max(400),
});

type ValidationRow = {
  readonly bucket_id: string;
  readonly object_name: string;
  readonly validated_at: string;
  readonly mime_ok: boolean;
  readonly magic_ok: boolean;
  readonly size_ok: boolean;
  readonly decode_ok: boolean;
  readonly moderation_status: 'passed' | 'flagged' | 'skipped';
  readonly moderation_ref: string | null;
};

function expectedKinds(bucket: string, objectName: string): readonly MediaKind[] {
  if (bucket === 'profile-media') {
    return ALLOWED_IMAGE_KINDS;
  }

  return objectName.endsWith('.m4a') ? ['audio/mp4'] : ALLOWED_IMAGE_KINDS;
}

/**
 * Server-authoritative media validation (audit P0-5): after a client
 * uploads to storage it must call this endpoint, which re-reads the object
 * with the service role, sniffs the real content (magic bytes + structure),
 * enforces the shared size ceiling, runs moderation when OPENAI_API_KEY is
 * present (recorded as `skipped` otherwise — enforcement treats only
 * `passed` as publishable), and records the verdict in media_validations.
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
    return NextResponse.json({ error: 'bucket and objectName required' }, { status: 400 });
  }
  const { bucket, objectName } = parsedBody.data;
  if (objectName.includes('..')) {
    return NextResponse.json({ error: 'invalid object name' }, { status: 400 });
  }

  const authClient = createBrowserClient(url, anonKey);
  const { data: userData, error: userError } = await authClient.auth.getUser(accessToken);
  if (userError !== null || userData.user === null) {
    return NextResponse.json({ error: 'authentication required' }, { status: 401 });
  }
  const callerId = userData.user.id;
  if (!(await isActiveAccount(serviceClient, callerId))) {
    return NextResponse.json({ error: 'account is not active' }, { status: 403 });
  }

  const ownerPrefix = objectName.split('/')[0] ?? '';
  if (bucket === 'profile-media') {
    if (ownerPrefix !== callerId) {
      return NextResponse.json({ error: 'object is not yours to validate' }, { status: 403 });
    }
  } else {
    const { data: draft } = await serviceClient
      .from('pitch_drafts')
      .select('created_by_user_id')
      .eq('id', ownerPrefix)
      .maybeSingle();
    if (draft === null || draft.created_by_user_id !== callerId) {
      return NextResponse.json({ error: 'object is not yours to validate' }, { status: 403 });
    }
  }

  const { data: blob, error: downloadError } = await serviceClient.storage
    .from(bucket)
    .download(objectName);
  if (downloadError !== null || blob === null) {
    return NextResponse.json({ error: 'object not found' }, { status: 404 });
  }

  const sizeOk = blob.size <= MEDIA_MAX_BYTES;
  const bytes = new Uint8Array(await blob.slice(0, 64 * 1024).arrayBuffer());
  const trailer = new Uint8Array(
    await blob.slice(Math.max(0, blob.size - 16), blob.size).arrayBuffer(),
  );
  const merged = new Uint8Array(bytes.length + trailer.length);
  merged.set(bytes);
  merged.set(trailer, bytes.length);

  const signature = checkMediaSignature(merged);
  const allowed = expectedKinds(bucket, objectName);
  const mimeOk = signature.kind !== null && allowed.includes(signature.kind);
  const magicOk = signature.magicOk && mimeOk;
  const decodeOk = magicOk && signature.structureOk;

  let moderationStatus: ValidationRow['moderation_status'] = 'skipped';
  let moderationRef: string | null = null;
  if (decodeOk && sizeOk && signature.kind !== null && signature.kind !== 'audio/mp4') {
    try {
      const providers = createProviders({
        FRIENDWORD_PROVIDER_MODE: 'real',
        OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      });
      const { data: signed, error: signError } = await serviceClient.storage
        .from(bucket)
        .createSignedUrl(objectName, 300);
      if (signError !== null || signed === null) {
        return NextResponse.json({ error: 'object not found' }, { status: 404 });
      }
      const verdict = await providers.moderation.checkImage(signed.signedUrl);
      moderationStatus = verdict.allowed ? 'passed' : 'flagged';
      moderationRef = verdict.allowed ? null : verdict.categories.join(',').slice(0, 200);
    } catch (error: unknown) {
      if (!(error instanceof ProviderNotImplementedError)) {
        console.warn('media validation: moderation call failed');
        return NextResponse.json({ error: 'moderation unavailable' }, { status: 502 });
      }
    }
  }

  const row: ValidationRow = {
    bucket_id: bucket,
    object_name: objectName,
    validated_at: new Date().toISOString(),
    mime_ok: mimeOk,
    magic_ok: magicOk,
    size_ok: sizeOk,
    decode_ok: decodeOk,
    moderation_status: moderationStatus,
    moderation_ref: moderationRef,
  };
  const { error: upsertError } = await serviceClient
    .from('media_validations')
    .upsert(row, { onConflict: 'bucket_id,object_name' });
  if (upsertError !== null) {
    console.warn('media validation: verdict write failed');
    return NextResponse.json({ error: 'validation write failed' }, { status: 500 });
  }

  return NextResponse.json({
    ok: mimeOk && magicOk && sizeOk && decodeOk && moderationStatus !== 'flagged',
    mimeOk,
    magicOk,
    sizeOk,
    decodeOk,
    moderationStatus,
  });
}
