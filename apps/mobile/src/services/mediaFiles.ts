/**
 * Best-effort deletion of a local media file that has been purged from a draft.
 *
 * Only on-device `file://` URIs are touched — remote/server URIs are left
 * alone. Failures are swallowed on purpose: the load-bearing privacy guarantee
 * is that the caller has already dropped the URI from AsyncStorage, so deleting
 * the underlying bytes is a best-effort follow-up that must never surface an
 * error (the file may not exist, or `expo-file-system` may be unavailable in a
 * given runtime such as tests or web).
 */
/**
 * PUT a local `file://` asset to a signed upload URL.
 *
 * On device this must stream through `expo-file-system`: React Native's Blob
 * cannot be constructed from an ArrayBuffer, so `fetch(uri).blob()` throws
 * ("Creating blobs from 'ArrayBuffer' ... are not supported"). Runtimes
 * without the native module (tests, web) fall back to fetch + blob, which
 * works there. Returns the HTTP status of the upload response.
 */
export async function putLocalFile(
  url: string,
  fileUri: string,
  headers: Record<string, string>,
): Promise<number> {
  let uploadAsync:
    | ((
        uploadUrl: string,
        uri: string,
        options?: { httpMethod?: string; headers?: Record<string, string> },
      ) => Promise<{ status: number }>)
    | undefined;
  try {
    const moduleName: string = 'expo-file-system/legacy';
    uploadAsync = ((await import(moduleName)) as { uploadAsync?: typeof uploadAsync }).uploadAsync;
  } catch {
    uploadAsync = undefined;
  }
  if (uploadAsync !== undefined) {
    const result = await uploadAsync(url, fileUri, { httpMethod: 'PUT', headers });
    return result.status;
  }
  const response = await fetch(url, {
    method: 'PUT',
    headers,
    body: await (await fetch(fileUri)).blob(),
  });
  return response.status;
}

export async function deleteLocalMediaFile(uri: string): Promise<void> {
  if (!uri.startsWith('file://')) {
    return;
  }
  try {
    // Resolve the module name through a typed `string` so the bundler/TS does
    // not hard-require `expo-file-system` at import time; the legacy entry
    // exposes the imperative `deleteAsync` used here.
    const moduleName: string = 'expo-file-system/legacy';
    const fileSystem = (await import(moduleName)) as {
      deleteAsync?: (fileUri: string, options?: { idempotent?: boolean }) => Promise<void>;
    };
    await fileSystem.deleteAsync?.(uri, { idempotent: true });
  } catch {
    // Best-effort only — see the doc comment above.
  }
}
