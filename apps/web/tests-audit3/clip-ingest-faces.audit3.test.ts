// PHASE 3A — the vendored BlazeFace model loads from disk and runs.
//
// What this pins: the custom fs IOHandler over
// src/lib/clipIngest/blazeface-model (no tfhub/network fetch at runtime), and
// the box contract — whatever detection returns is normalized 0..1 with only
// x/y/width/height, never more than the DB's 64-box ceiling. It does NOT claim
// detection quality: the synthetic frame has no face and the honest result is
// an empty array ("detection ran and found nothing" is a real result in 0050).
/* global beforeAll, describe, expect, it */

import { execFile } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { resolveFfmpegPath } from '../src/lib/clipIngest/binaries';
import { detectFaceBoxes, MAX_FACE_BOXES } from '../src/lib/clipIngest/faces';

const execFileAsync = promisify(execFile);

let framePath: string;

beforeAll(async () => {
  const workDir = await mkdtemp(join(tmpdir(), 'clip-faces-test-'));
  framePath = join(workDir, 'frame.jpg');
  await execFileAsync(
    resolveFfmpegPath(),
    [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=512x910:rate=1',
      '-frames:v',
      '1',
      '-q:v',
      '4',
      framePath,
    ],
    { maxBuffer: 4 * 1024 * 1024 },
  );
}, 60_000);

describe('clip ingest face detection — vendored model, boxes only', () => {
  it('loads the model from the vendored files and returns only normalized boxes', async () => {
    const boxes = await detectFaceBoxes([framePath]);

    expect(Array.isArray(boxes)).toBe(true);
    expect(boxes.length).toBeLessThanOrEqual(MAX_FACE_BOXES);
    for (const box of boxes) {
      // Exactly the four keys 0050's face_boxes_are_normalized accepts —
      // an embedding or a name here must fail loudly.
      expect(Object.keys(box).sort()).toEqual(['height', 'width', 'x', 'y']);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(1);
      expect(box.y + box.height).toBeLessThanOrEqual(1);
    }
  }, 60_000);
});
