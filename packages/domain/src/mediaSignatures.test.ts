import { describe, expect, it } from 'vitest';

import { checkMediaSignature, MEDIA_MAX_BYTES } from './mediaSignatures';

function ascii(text: string): number[] {
  return Array.from(text, (character) => character.charCodeAt(0));
}

describe('checkMediaSignature', () => {
  it('accepts a structurally complete jpeg', () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0xff, 0xd9]);
    expect(checkMediaSignature(bytes)).toEqual({
      kind: 'image/jpeg',
      magicOk: true,
      structureOk: true,
    });
  });

  it('flags a truncated jpeg', () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x00, 0x00]);
    expect(checkMediaSignature(bytes).structureOk).toBe(false);
  });

  it('accepts a png with an IHDR chunk', () => {
    const bytes = new Uint8Array([
      0x89,
      0x50,
      0x4e,
      0x47,
      0x0d,
      0x0a,
      0x1a,
      0x0a,
      0x00,
      0x00,
      0x00,
      0x0d,
      ...ascii('IHDR'),
    ]);
    expect(checkMediaSignature(bytes)).toEqual({
      kind: 'image/png',
      magicOk: true,
      structureOk: true,
    });
  });

  it('accepts a webp riff container', () => {
    const bytes = new Uint8Array([
      ...ascii('RIFF'),
      0,
      0,
      0,
      0,
      ...ascii('WEBP'),
      ...ascii('VP8 '),
    ]);
    expect(checkMediaSignature(bytes).kind).toBe('image/webp');
    expect(checkMediaSignature(bytes).structureOk).toBe(true);
  });

  it('accepts an m4a ftyp box', () => {
    const bytes = new Uint8Array([0, 0, 0, 24, ...ascii('ftyp'), ...ascii('M4A '), 0, 0, 0, 0]);
    expect(checkMediaSignature(bytes)).toEqual({
      kind: 'audio/mp4',
      magicOk: true,
      structureOk: true,
    });
  });

  it('rejects renamed content that only claims an image extension', () => {
    const bytes = new Uint8Array(ascii('%PDF-1.7 not an image at all'));
    expect(checkMediaSignature(bytes)).toEqual({ kind: null, magicOk: false, structureOk: false });
  });

  it('keeps the shared size ceiling at 15MB', () => {
    expect(MEDIA_MAX_BYTES).toBe(15 * 1024 * 1024);
  });
});
