// THIRD-AUDIT REGRESSION — H-5 (web interest photo Remove + rollback delete storage)
// The UI Remove button and the submit-failure rollback must actually delete the
// profile-media objects the caller uploaded THIS session, not just drop local
// state (which left orphaned objects behind). Deletion is restricted to the
// caller's own owner prefix (defense in depth ahead of the 0037 client DELETE
// policy) and reports a per-object outcome without throwing.
/* global describe, expect, it */

import {
  isOwnedProfilePhoto,
  profilePhotoObjectName,
  removeOwnProfilePhotos,
} from '../src/lib/profileMedia';

type RemoveCall = { bucket: string; objectNames: readonly string[] };

function fakeStorageClient(
  removeResult: { data: unknown; error: { message: string } | null } | Error,
) {
  const removeCalls: RemoveCall[] = [];
  const client = {
    storage: {
      from(bucket: string) {
        return {
          remove(objectNames: readonly string[]) {
            removeCalls.push({ bucket, objectNames });
            if (removeResult instanceof Error) {
              return Promise.reject(removeResult);
            }
            return Promise.resolve(removeResult);
          },
        };
      },
    },
  };
  return { client, removeCalls };
}

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

describe('interest flow — photo Remove/rollback delete storage objects (H-5)', () => {
  it('derives the bucket-relative object name from a storage path', () => {
    expect(profilePhotoObjectName(`profile-media/${OWNER}/photo-1.jpg`)).toBe(
      `${OWNER}/photo-1.jpg`,
    );
    expect(profilePhotoObjectName('pitch-media/draft/clip.mp4')).toBeNull();
    expect(profilePhotoObjectName(`${OWNER}/photo-1.jpg`)).toBeNull();
  });

  it('treats only objects under the caller owner prefix as owned', () => {
    expect(isOwnedProfilePhoto(`${OWNER}/photo-1.jpg`, OWNER)).toBe(true);
    expect(isOwnedProfilePhoto(`${OTHER}/photo-1.jpg`, OWNER)).toBe(false);
    expect(isOwnedProfilePhoto(`${OWNER}/photo-1.jpg`, '')).toBe(false);
  });

  it('deletes an uploaded object under the owner prefix (Remove path)', async () => {
    const { client, removeCalls } = fakeStorageClient({
      data: [{ name: `${OWNER}/photo-1.jpg` }],
      error: null,
    });
    const outcome = await removeOwnProfilePhotos(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client as any,
      [`profile-media/${OWNER}/photo-1.jpg`],
      OWNER,
    );
    expect(removeCalls).toHaveLength(1);
    expect(removeCalls[0]).toEqual({
      bucket: 'profile-media',
      objectNames: [`${OWNER}/photo-1.jpg`],
    });
    expect(outcome).toEqual({ attempted: 1, removed: 1, failed: 0, skipped: 0 });
  });

  it('deletes every object uploaded this session (rollback path)', async () => {
    const names = [`${OWNER}/photo-1.jpg`, `${OWNER}/photo-2.jpg`];
    const { client, removeCalls } = fakeStorageClient({
      data: names.map((name) => ({ name })),
      error: null,
    });
    const outcome = await removeOwnProfilePhotos(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client as any,
      names.map((n) => `profile-media/${n}`),
      OWNER,
    );
    expect(removeCalls[0]?.objectNames).toEqual(names);
    expect(outcome).toEqual({ attempted: 2, removed: 2, failed: 0, skipped: 0 });
  });

  it('never requests a delete outside the caller owner prefix', async () => {
    const { client, removeCalls } = fakeStorageClient({ data: [], error: null });
    const outcome = await removeOwnProfilePhotos(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client as any,
      [`profile-media/${OTHER}/photo-1.jpg`],
      OWNER,
    );
    expect(removeCalls).toHaveLength(0);
    expect(outcome).toEqual({ attempted: 0, removed: 0, failed: 0, skipped: 1 });
  });

  it('reports a partial failure when RLS silently removes nothing', async () => {
    // Supabase returns error === null but an empty data array when the DELETE
    // policy blocks the row — that must count as a failure, not a success.
    const { client } = fakeStorageClient({ data: [], error: null });
    const outcome = await removeOwnProfilePhotos(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client as any,
      [`profile-media/${OWNER}/photo-1.jpg`],
      OWNER,
    );
    expect(outcome).toEqual({ attempted: 1, removed: 0, failed: 1, skipped: 0 });
  });

  it('reports failure without throwing when the storage call errors', async () => {
    const { client } = fakeStorageClient({ data: null, error: { message: 'boom' } });
    const outcome = await removeOwnProfilePhotos(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client as any,
      [`profile-media/${OWNER}/photo-1.jpg`],
      OWNER,
    );
    expect(outcome).toEqual({ attempted: 1, removed: 0, failed: 1, skipped: 0 });
  });

  it('reports failure without throwing when the storage call rejects', async () => {
    const { client } = fakeStorageClient(new Error('network down'));
    const outcome = await removeOwnProfilePhotos(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client as any,
      [`profile-media/${OWNER}/photo-1.jpg`],
      OWNER,
    );
    expect(outcome).toEqual({ attempted: 1, removed: 0, failed: 1, skipped: 0 });
  });
});
