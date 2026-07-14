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
