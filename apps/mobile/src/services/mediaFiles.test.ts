import { describe, expect, it } from 'vitest';

import {
  createPhotoAssetKey,
  photoMimeType,
  photoObjectName,
  pickedPhotoMimeType,
} from './mediaFiles';

describe('pickedPhotoMimeType', () => {
  it('keeps the type the picker reports for publishable formats', () => {
    expect(pickedPhotoMimeType({ mimeType: 'image/png', uri: 'file:///a.png' })).toBe('image/png');
    expect(pickedPhotoMimeType({ mimeType: 'image/webp', uri: 'file:///a.webp' })).toBe(
      'image/webp',
    );
    expect(
      pickedPhotoMimeType({ mimeType: 'IMAGE/JPEG; charset=binary', uri: 'file:///a.jpg' }),
    ).toBe('image/jpeg');
  });

  it('rejects formats the server will refuse instead of renaming them', () => {
    // These reach the picker's result: `mediaTypes: ['images']` is
    // PHPickerFilter.images, which includes GIFs and screenshots, and
    // Compatible mode does not transcode every one of them.
    expect(pickedPhotoMimeType({ mimeType: 'image/gif', uri: 'file:///a.gif' })).toBeNull();
    expect(pickedPhotoMimeType({ mimeType: 'image/heic', uri: 'file:///a.heic' })).toBeNull();
    expect(pickedPhotoMimeType({ mimeType: 'image/tiff', uri: 'file:///a.tiff' })).toBeNull();
    expect(pickedPhotoMimeType({ mimeType: null, uri: 'file:///a.avif' })).toBeNull();
  });

  it('falls back to the file extension when the picker reports no type', () => {
    expect(pickedPhotoMimeType({ uri: 'file:///a.PNG' })).toBe('image/png');
    expect(pickedPhotoMimeType({ mimeType: null, uri: 'file:///a.jpeg' })).toBe('image/jpeg');
  });
});

describe('photo object naming', () => {
  it('names the stored object after the bytes it holds', () => {
    expect(
      photoObjectName({ uri: 'file:///a.png', width: 1, height: 1, mimeType: 'image/png' }, 0),
    ).toBe('photo-1.png');
    expect(
      photoObjectName({ uri: 'file:///a.jpg', width: 1, height: 1, mimeType: 'image/jpeg' }, 1),
    ).toBe('photo-2.jpg');
    expect(
      photoObjectName({ uri: 'file:///a.webp', width: 1, height: 1, mimeType: 'image/webp' }, 2),
    ).toBe('photo-3.webp');
  });

  it('assumes JPEG only when neither the draft nor the uri says otherwise', () => {
    expect(photoMimeType({ uri: 'file:///no-extension', width: 1, height: 1 })).toBe('image/jpeg');
  });

  it('names the object after the photo, not its position, once it has an identity', () => {
    const photo = {
      uri: 'file:///a.jpg',
      width: 1,
      height: 1,
      mimeType: 'image/jpeg' as const,
      assetKey: 'abc123',
    };

    expect(photoObjectName(photo, 0)).toBe('photo-abc123.jpg');
    // Position changes when an earlier photo is removed; the object must not.
    expect(photoObjectName(photo, 2)).toBe('photo-abc123.jpg');
  });

  it('mints identities the storage object-name pattern accepts', () => {
    const keys = Array.from({ length: 50 }, () => createPhotoAssetKey());

    // The whole object name has to match the storage policy's pattern; these
    // keys sit inside `photo-<key>.<ext>`, so check the name it produces.
    expect(
      keys.every((key) =>
        /^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/.test(
          photoObjectName({ uri: 'file:///a.jpg', width: 1, height: 1, assetKey: key }, 0),
        ),
      ),
    ).toBe(true);
    expect(keys.every((key) => /^[a-z0-9]{1,32}$/.test(key))).toBe(true);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
