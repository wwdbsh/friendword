import type { BrowserSupabaseClient } from '@friendword/data';

/**
 * profile-media storage deletion for the Interested-person flow (third audit
 * H-5).
 *
 * Before this, the UI Remove button and the submit-failure rollback only
 * dropped local React state / revoked blob URLs — the uploaded storage object
 * stayed behind as an orphan. These helpers actually delete the objects the
 * caller uploaded THIS session.
 *
 * Deletion is restricted client-side to the caller's own owner prefix
 * (`<user-id>/…`). The server-side authority is migration 0037's owner-prefix
 * client DELETE policy on `storage.objects` for the `profile-media` bucket
 * (mirrors the 0006 INSERT owner check); this layer is defense in depth so a
 * bug can never even request a delete outside the owner folder. `pitch-media`
 * has no client DELETE policy and is never touched here.
 *
 * Supabase's `storage.remove()` returns `error === null` with an EMPTY `data`
 * array when RLS silently blocks the delete, so a per-object removed/failed
 * count is derived from the returned rows rather than trusting a null error.
 */

export const PROFILE_MEDIA_BUCKET = 'profile-media';

export type RemoveOutcome = {
  /** Owned objects a delete was actually requested for. */
  readonly attempted: number;
  /** Objects Storage confirmed removed. */
  readonly removed: number;
  /** Owned objects that were requested but not confirmed removed. */
  readonly failed: number;
  /** Objects skipped because they fall outside the caller's owner prefix. */
  readonly skipped: number;
};

/** Converts 'profile-media/<user>/<file>' to '<user>/<file>', or null. */
export function profilePhotoObjectName(storagePath: string): string | null {
  const prefix = `${PROFILE_MEDIA_BUCKET}/`;
  return storagePath.startsWith(prefix) ? storagePath.slice(prefix.length) : null;
}

/** True only when the object lives directly under the caller's owner prefix. */
export function isOwnedProfilePhoto(objectName: string, ownerUserId: string): boolean {
  return ownerUserId.length > 0 && objectName.startsWith(`${ownerUserId}/`);
}

/**
 * Deletes profile-media objects the caller uploaded, limited to the caller's
 * own owner prefix. Returns a per-object outcome and never throws — callers
 * surface a ret.ryable error (Remove) or a console warning (rollback) but the
 * user flow is never blocked by a cleanup failure.
 */
export async function removeOwnProfilePhotos(
  client: BrowserSupabaseClient,
  storagePaths: readonly string[],
  ownerUserId: string,
): Promise<RemoveOutcome> {
  const objectNames = storagePaths
    .map(profilePhotoObjectName)
    .filter((name): name is string => name !== null);
  const owned = objectNames.filter((name) => isOwnedProfilePhoto(name, ownerUserId));
  const skipped = objectNames.length - owned.length;

  if (owned.length === 0) {
    return { attempted: 0, removed: 0, failed: 0, skipped };
  }

  try {
    const { data, error } = await client.storage.from(PROFILE_MEDIA_BUCKET).remove([...owned]);
    if (error !== null) {
      return { attempted: owned.length, removed: 0, failed: owned.length, skipped };
    }
    const removed = Array.isArray(data) ? data.length : 0;
    return { attempted: owned.length, removed, failed: owned.length - removed, skipped };
  } catch {
    return { attempted: owned.length, removed: 0, failed: owned.length, skipped };
  }
}
