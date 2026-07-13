export type MediaKind = 'image/jpeg' | 'image/png' | 'image/webp' | 'audio/mp4';

export type SignatureCheck = {
  readonly kind: MediaKind | null;
  readonly magicOk: boolean;
  readonly structureOk: boolean;
};

export const MEDIA_MAX_BYTES = 15 * 1024 * 1024;

export const ALLOWED_IMAGE_KINDS: readonly MediaKind[] = ['image/jpeg', 'image/png', 'image/webp'];

function startsWith(bytes: Uint8Array, prefix: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + prefix.length) {
    return false;
  }

  return prefix.every((expected, index) => bytes[offset + index] === expected);
}

function asciiAt(bytes: Uint8Array, text: string, offset: number): boolean {
  return startsWith(
    bytes,
    Array.from(text, (character) => character.charCodeAt(0)),
    offset,
  );
}

/**
 * Server-authoritative content sniffing: identifies the real media kind from
 * magic bytes and runs a light structural check (headers/trailers), without
 * pulling a native decoder into the deployment.
 */
export function checkMediaSignature(bytes: Uint8Array): SignatureCheck {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
    const structureOk =
      bytes.length > 4 && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9;
    return { kind: 'image/jpeg', magicOk: true, structureOk };
  }

  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    // A valid PNG opens with an IHDR chunk right after the signature.
    const structureOk = asciiAt(bytes, 'IHDR', 12);
    return { kind: 'image/png', magicOk: true, structureOk };
  }

  if (asciiAt(bytes, 'RIFF', 0) && asciiAt(bytes, 'WEBP', 8)) {
    const structureOk =
      asciiAt(bytes, 'VP8 ', 12) || asciiAt(bytes, 'VP8L', 12) || asciiAt(bytes, 'VP8X', 12);
    return { kind: 'image/webp', magicOk: true, structureOk };
  }

  if (asciiAt(bytes, 'ftyp', 4)) {
    const brand = ['M4A ', 'M4B ', 'mp42', 'isom', 'iso2', 'mp41'].some((candidate) =>
      asciiAt(bytes, candidate, 8),
    );
    return { kind: 'audio/mp4', magicOk: true, structureOk: brand };
  }

  return { kind: null, magicOk: false, structureOk: false };
}
