import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { sha256Hex } from './sha256';

/**
 * The hand-written digest has to be SHA-256 and not merely a stable function of
 * its input, because `cut_hash` is compared against values produced elsewhere.
 * The published vectors pin the algorithm; the differential check against
 * `node:crypto` pins it over inputs no vector list covers (multi-byte UTF-8,
 * block boundaries, the exact JSON a cut plan hashes). `node:crypto` is used
 * HERE ONLY — the module itself must stay runtime-free so React Native can
 * import it.
 */
describe('sha256Hex', () => {
  it('matches the published FIPS 180-4 vectors', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
  });

  it('agrees with node:crypto across lengths, block edges and unicode', () => {
    const samples = [
      '',
      'a',
      'friendword',
      '[{"startMs":3560,"endMs":7940,"reason":"name"}]',
      'x'.repeat(55),
      'x'.repeat(56),
      'x'.repeat(63),
      'x'.repeat(64),
      'x'.repeat(65),
      'x'.repeat(1000),
      '마야를 소개합니다',
      'soup 🍲 at eleven at night',
    ];
    for (const sample of samples) {
      expect(sha256Hex(sample), sample.slice(0, 24)).toBe(
        createHash('sha256').update(sample, 'utf8').digest('hex'),
      );
    }
  });
});
