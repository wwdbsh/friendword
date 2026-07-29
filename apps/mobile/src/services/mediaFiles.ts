import { PHOTO_MIME_TYPES, type PhotoMimeType, type PitchPhoto } from './types';

/**
 * A local file as this runtime can actually read it. Declared structurally
 * because the shape is only guaranteed where the native module is installed:
 * `expo-file-system` also resolves on web and in tests, where `File` exists but
 * its native methods do not.
 */
type NativeFile = {
  readonly exists?: unknown;
  readonly bytes?: unknown;
  readonly delete?: unknown;
};

/**
 * Constructs `expo-file-system`'s `File` for `uri`, or null when this runtime
 * cannot provide one. Import success is not enough of a signal: the module
 * resolves on web (where `File` extends a shim whose constructor only warns)
 * and can resolve with a `File` that lacks the native methods, so the caller
 * must fall back on the *instance*, not on the import.
 */
async function openNativeFile(uri: string): Promise<NativeFile | null> {
  try {
    const fileSystem: unknown = await import('expo-file-system');
    if (typeof fileSystem !== 'object' || fileSystem === null || !('File' in fileSystem)) {
      return null;
    }
    const fileConstructor = fileSystem.File;
    if (typeof fileConstructor !== 'function') {
      return null;
    }
    const construct = fileConstructor as new (fileUri: string) => NativeFile;
    return new construct(uri);
  } catch {
    return null;
  }
}

/**
 * Only the shape this module uses. `expo/fetch` accepts a raw byte body, which
 * React Native's global `fetch` type does not.
 */
type BytesFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: Uint8Array },
) => Promise<{ status: number }>;

async function loadExpoFetch(): Promise<BytesFetch | null> {
  try {
    const fetchModule: unknown = await import('expo/fetch');
    if (typeof fetchModule !== 'object' || fetchModule === null || !('fetch' in fetchModule)) {
      return null;
    }
    const expoFetch = fetchModule.fetch;
    return typeof expoFetch === 'function' ? (expoFetch as BytesFetch) : null;
  } catch {
    return null;
  }
}

/**
 * PUT a local `file://` asset to a signed upload URL.
 *
 * On device the bytes must be read through `expo-file-system`: React Native's
 * Blob cannot be constructed from an ArrayBuffer, so `fetch(uri).blob()`
 * throws ("Creating blobs from 'ArrayBuffer' ... are not supported").
 *
 * The request is sent with `expo/fetch`. `expo-file-system/legacy`'s
 * `uploadAsync` is banned here: its URLSession completion runs on the main
 * queue and releases the JSI `JavaScriptPromise` off the JS thread, which hard
 * crashes the app with EXC_BAD_ACCESS / KERN_PROTECTION_FAILURE (device crash
 * report Friendword-2026-07-27-162640.ips, expo-file-system@57.0.0).
 *
 * The body is passed as bytes rather than as the `File` (which implements
 * `Blob`) on purpose: for blob-like bodies `expo/fetch` overrides
 * `Content-Type` with `blob.type`, which would clobber the caller's explicit
 * content type.
 *
 * Runtimes without a usable native `File`/`expo/fetch` (tests, web) fall back
 * to fetch + blob, which works there. A native read that *starts* and then
 * fails is a real error and propagates — only unavailability falls back, so a
 * failure is never retried on a path that would send the bytes twice. Returns
 * the HTTP status of the upload response.
 */
export async function putLocalFile(
  url: string,
  fileUri: string,
  headers: Record<string, string>,
): Promise<number> {
  const file = await openNativeFile(fileUri);
  const readBytes = file?.bytes;
  const expoFetch = await loadExpoFetch();
  if (file !== null && typeof readBytes === 'function' && expoFetch !== null) {
    const read = readBytes as () => Promise<Uint8Array>;
    const bytes = await read.call(file);
    const nativeResponse = await expoFetch(url, { method: 'PUT', headers, body: bytes });
    return nativeResponse.status;
  }
  const response = await fetch(url, {
    method: 'PUT',
    headers,
    body: await (await fetch(fileUri)).blob(),
  });
  return response.status;
}

/**
 * Best-effort deletion of a local media file that has been purged from a draft.
 *
 * Only on-device `file://` URIs are touched — remote/server URIs are left
 * alone. Failures are swallowed on purpose: the load-bearing privacy guarantee
 * is that the caller has already dropped the URI from AsyncStorage, so deleting
 * the underlying bytes is a best-effort follow-up that must never surface an
 * error (the file may not exist, or `expo-file-system` may be unavailable in a
 * given runtime such as tests or web).
 *
 * Uses the new `File` API rather than `expo-file-system/legacy`. Whether the
 * legacy `deleteAsync` shares `uploadAsync`'s off-thread JSI release is not
 * established, but this path runs on publish and there is no reason to load the
 * banned module into the process when `File.delete()` exists. A native
 * EXC_BAD_ACCESS would not be caught by the try/catch below either way.
 */
export async function deleteLocalMediaFile(uri: string): Promise<void> {
  if (!uri.startsWith('file://')) {
    return;
  }
  try {
    const file = await openNativeFile(uri);
    const remove = file?.delete;
    if (file === null || typeof remove !== 'function' || file.exists === false) {
      return;
    }
    (remove as () => void).call(file);
  } catch {
    // Best-effort only — see the doc comment above.
  }
}

const PHOTO_FILE_EXTENSIONS: Record<PhotoMimeType, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

const PHOTO_MIME_TYPES_BY_EXTENSION: Record<string, PhotoMimeType> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

function asPhotoMimeType(value: string): PhotoMimeType | null {
  const normalized = value.split(';')[0]?.trim().toLowerCase() ?? '';
  const candidate = normalized === 'image/jpg' ? 'image/jpeg' : normalized;
  return PHOTO_MIME_TYPES.find((allowed) => allowed === candidate) ?? null;
}

function photoMimeTypeFromUri(uri: string): PhotoMimeType | null {
  const path = uri.split('?')[0] ?? uri;
  const extension = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  return PHOTO_MIME_TYPES_BY_EXTENSION[extension] ?? null;
}

/**
 * The publishable type of an asset the image picker returned, or null when it
 * is one the server would refuse (HEIC that was not transcoded, GIF, BMP,
 * TIFF, AVIF). iOS reports `mimeType` from the extension of the file it
 * actually wrote, so it describes the real bytes; the uri extension is only a
 * fallback for platforms that leave `mimeType` unset.
 */
export function pickedPhotoMimeType(asset: {
  readonly mimeType?: string | null;
  readonly uri: string;
}): PhotoMimeType | null {
  const declared = typeof asset.mimeType === 'string' ? asPhotoMimeType(asset.mimeType) : null;
  return declared ?? photoMimeTypeFromUri(asset.uri);
}

/**
 * The type a stored photo object must be uploaded as. Drafts saved before
 * `mimeType` was tracked fall back to the file extension, and finally to JPEG —
 * the server still sniffs the real bytes, so a wrong guess is reported by
 * validation rather than silently published.
 */
export function photoMimeType(photo: PitchPhoto): PhotoMimeType {
  return photo.mimeType ?? photoMimeTypeFromUri(photo.uri) ?? 'image/jpeg';
}

/**
 * A fresh photo identity.
 *
 * It is embedded in `photo-<key>.<ext>`, which must match
 * `[A-Za-z0-9][A-Za-z0-9._-]{0,254}` end to end to satisfy both the storage
 * policy's object-name pattern (0003:63, matched case-insensitively) and the
 * data layer's file-name schema. Lowercase alphanumerics stay well inside that
 * set; the key never sits at the start of the name, so its first character is
 * not itself constrained.
 */
export function createPhotoAssetKey(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Storage object name for a draft photo, with the extension its bytes call for.
 *
 * Named after the photo's own identity rather than its position, because a
 * position is not stable: removing a photo shifts every later one down, and a
 * position-named upload would then write to — or worse, silently reuse — the
 * removed photo's object. `upsert:false` makes that reuse a 409 the upload path
 * reads as "already stored", which is how a removed photo's bytes end up
 * published under a different photo's slot. Photos saved before identities
 * existed keep the position-derived name their object already has.
 */
export function photoObjectName(photo: PitchPhoto, index: number): string {
  const extension = PHOTO_FILE_EXTENSIONS[photoMimeType(photo)];
  return photo.assetKey === undefined
    ? `photo-${index + 1}${extension}`
    : `photo-${photo.assetKey}${extension}`;
}
