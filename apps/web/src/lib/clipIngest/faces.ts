import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import * as blazeface from '@tensorflow-models/blazeface';
import '@tensorflow/tfjs-backend-cpu';
import * as tf from '@tensorflow/tfjs-core';
import jpeg from 'jpeg-js';

/**
 * One detected face as a BOX ONLY, normalized 0..1 against the frame it was
 * found in (which shares the proxy's aspect exactly — the moderation frames are
 * uniform downscales of the proxy). No embedding, no landmark, no identity is
 * computed or kept; this is the exact shape
 * private.face_boxes_are_normalized (0050) accepts and nothing more.
 */
export type FaceBox = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

/** The DB constraint's ceiling; a longer array must never be sent. */
export const MAX_FACE_BOXES = 64;

/**
 * Two boxes from different sampled frames that overlap this much are the same
 * face sitting still; keeping both would flood the 64-box ceiling with
 * duplicates of one person.
 */
const DEDUPE_IOU_THRESHOLD = 0.5;

/**
 * Where the vendored model files live. Resolution must stay invisible to the
 * bundler: webpack statically rewrites `new URL(..., import.meta.url)` into a
 * module request and fails the whole app build on this directory. So the
 * lookup walks REAL paths only — from cwd upward, trying the package-relative
 * and repo-relative locations. That covers the dev server and built function
 * (cwd at apps/web or the traced root, where outputFileTracingIncludes ships
 * the files under apps/web/src/...) and the vitest harnesses, whose cwd is a
 * sibling package.
 */
const MODEL_DIR_CANDIDATES = [
  'src/lib/clipIngest/blazeface-model',
  'apps/web/src/lib/clipIngest/blazeface-model',
] as const;
const MODEL_DIR_MAX_WALK_UP = 6;

function resolveModelDir(): string {
  let base = process.cwd();
  for (let depth = 0; depth < MODEL_DIR_MAX_WALK_UP; depth += 1) {
    for (const relativePath of MODEL_DIR_CANDIDATES) {
      const candidate = join(base, relativePath);
      if (existsSync(join(candidate, 'model.json'))) {
        return candidate;
      }
    }
    const parent = dirname(base);
    if (parent === base) {
      break;
    }
    base = parent;
  }
  throw new Error('the vendored BlazeFace model files were not found');
}

type WeightsManifestEntry = {
  readonly paths: readonly string[];
  readonly weights: tf.io.WeightsManifestEntry[];
};

/**
 * Loads the vendored BlazeFace graph model (Apache-2.0, boxes only) from disk.
 * Vendored rather than fetched from tfhub at runtime: an ingest job must not
 * depend on a third-party CDN being up, and the weights that were reviewed are
 * the weights that run.
 */
function vendoredModelHandler(): tf.io.IOHandler {
  return {
    load: async () => {
      const modelDir = resolveModelDir();
      const manifest = JSON.parse(await readFile(join(modelDir, 'model.json'), 'utf8')) as {
        readonly modelTopology: object;
        readonly weightsManifest: readonly WeightsManifestEntry[];
      };
      const weightSpecs = manifest.weightsManifest.flatMap((entry) => entry.weights);
      const shards = await Promise.all(
        manifest.weightsManifest.flatMap((entry) =>
          entry.paths.map((path) => readFile(join(modelDir, path))),
        ),
      );
      const totalBytes = shards.reduce((sum, shard) => sum + shard.byteLength, 0);
      const weightData = new Uint8Array(totalBytes);
      let offset = 0;
      for (const shard of shards) {
        weightData.set(shard, offset);
        offset += shard.byteLength;
      }
      return {
        modelTopology: manifest.modelTopology,
        weightSpecs,
        weightData: weightData.buffer,
      };
    },
  };
}

let modelPromise: Promise<blazeface.BlazeFaceModel> | null = null;

async function loadModel(): Promise<blazeface.BlazeFaceModel> {
  if (modelPromise === null) {
    modelPromise = (async () => {
      await tf.setBackend('cpu');
      await tf.ready();
      return blazeface.load({ modelUrl: vendoredModelHandler() });
    })();
  }
  return modelPromise;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function intersectionOverUnion(a: FaceBox, b: FaceBox): number {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  if (right <= left || bottom <= top) {
    return 0;
  }
  const intersection = (right - left) * (bottom - top);
  const union = a.width * a.height + b.width * b.height - intersection;
  return union <= 0 ? 0 : intersection / union;
}

function asPair(value: [number, number] | unknown): readonly [number, number] | null {
  return Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === 'number' &&
    typeof value[1] === 'number'
    ? [value[0], value[1]]
    : null;
}

/**
 * Face BOXES for a set of sampled JPEG frames, deduplicated across frames and
 * capped at the DB's 64-box ceiling. An empty array is a real result:
 * "detection ran and found no face".
 */
export async function detectFaceBoxes(jpegPaths: readonly string[]): Promise<readonly FaceBox[]> {
  const model = await loadModel();
  const collected: FaceBox[] = [];

  for (const jpegPath of jpegPaths) {
    const decoded = jpeg.decode(await readFile(jpegPath), {
      useTArray: true,
      formatAsRGBA: false,
    });
    const frame = tf.tensor3d(decoded.data, [decoded.height, decoded.width, 3], 'int32');
    try {
      const faces = await model.estimateFaces(frame, false);
      for (const face of faces) {
        const topLeft = asPair(face.topLeft);
        const bottomRight = asPair(face.bottomRight);
        if (topLeft === null || bottomRight === null) {
          continue;
        }
        const x = clamp01(topLeft[0] / decoded.width);
        const y = clamp01(topLeft[1] / decoded.height);
        const box: FaceBox = {
          x,
          y,
          width: clamp01(bottomRight[0] / decoded.width) - x,
          height: clamp01(bottomRight[1] / decoded.height) - y,
        };
        if (box.width <= 0 || box.height <= 0) {
          continue;
        }
        const duplicate = collected.some(
          (existing) => intersectionOverUnion(existing, box) >= DEDUPE_IOU_THRESHOLD,
        );
        if (!duplicate && collected.length < MAX_FACE_BOXES) {
          collected.push(box);
        }
      }
    } finally {
      frame.dispose();
    }
  }

  return collected;
}
