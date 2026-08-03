import type { ServiceSupabaseClient } from '@friendword/data';

// Storage IO for the render worker (Phase 4). Input assets come out of the
// pitch-media bucket exactly as they were stored — the Introducer's original
// voice is downloaded byte-for-byte and never transformed here (CLAUDE.md §8
// boundary 1) — and the finished MP4 goes back under the draft's nested
// renders/ prefix, which migration 0054 CHECK-enforces. The nesting is
// deliberate: private.pitch_media_draft_id (0003:57) only parses FLAT
// '<uuid>/<name>' object names, so renders stay outside the 20-object
// per-draft quota (0025) while the 0037 recursive erasure still removes them.

export const PITCH_MEDIA_BUCKET = 'pitch-media';
const BUCKET_PREFIX = `${PITCH_MEDIA_BUCKET}/`;

/** The 0054 CHECK shape: pitch-media/<draftId>/renders/<revisionId>.mp4 */
export function renderOutputStoragePath(pitchDraftId: string, revisionId: string): string {
  return `${BUCKET_PREFIX}${pitchDraftId}/renders/${revisionId}.mp4`;
}

/**
 * DB rows store bucket-prefixed paths ('pitch-media/<draft>/<name>'); the
 * storage API wants the object name without the bucket. Null for a path that
 * names another bucket or tries to walk out of it.
 */
export function pitchMediaObjectName(storagePath: string): string | null {
  if (!storagePath.startsWith(BUCKET_PREFIX) || storagePath.includes('..')) {
    return null;
  }
  const objectName = storagePath.slice(BUCKET_PREFIX.length);
  return objectName.length > 0 ? objectName : null;
}

/**
 * Container-derived MIME for a stored pitch asset. Only the types the product
 * upload paths admit and the encoder understands (encode.ts) are mapped; an
 * unknown extension is a refusal, not a guess.
 */
const MEDIA_MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
};

export function mimeTypeForStoredMedia(storagePath: string): string | null {
  const dotIndex = storagePath.lastIndexOf('.');
  if (dotIndex === -1) {
    return null;
  }
  return MEDIA_MIME_BY_EXTENSION[storagePath.slice(dotIndex + 1).toLowerCase()] ?? null;
}

/** Downloads a stored asset as raw bytes. Errors name the path, never a URL. */
export async function downloadPitchMediaObject(
  client: ServiceSupabaseClient,
  storagePath: string,
): Promise<Uint8Array> {
  const objectName = pitchMediaObjectName(storagePath);
  if (objectName === null) {
    throw new Error(`asset path is outside the ${PITCH_MEDIA_BUCKET} bucket: ${storagePath}`);
  }
  const { data, error } = await client.storage.from(PITCH_MEDIA_BUCKET).download(objectName);
  if (error !== null || data === null) {
    throw new Error(`could not download ${storagePath}`);
  }
  return new Uint8Array(await data.arrayBuffer());
}

/**
 * Stores the finished MP4 at its 0054 path. Upsert on purpose: the path is
 * deterministic per revision, and a retried job that got as far as uploading
 * before its completion failed must be able to overwrite its own partial
 * upload instead of wedging on a 409.
 */
export async function uploadRenderOutput(
  client: ServiceSupabaseClient,
  outputStoragePath: string,
  mp4: Uint8Array,
): Promise<void> {
  const objectName = pitchMediaObjectName(outputStoragePath);
  if (objectName === null) {
    throw new Error(`render output path is outside the ${PITCH_MEDIA_BUCKET} bucket`);
  }
  const { error } = await client.storage
    .from(PITCH_MEDIA_BUCKET)
    .upload(objectName, Buffer.from(mp4), { contentType: 'video/mp4', upsert: true });
  if (error !== null) {
    throw new Error(`could not store the rendered MP4 at ${outputStoragePath}`);
  }
}
