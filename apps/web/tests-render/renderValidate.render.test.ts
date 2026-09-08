import { describe, expect, it } from 'vitest';

import { buildPitchSceneV2, examplePitchSceneV2 } from '@friendword/contracts';

import {
  INVALID_V2_SCENE_ERROR,
  assertRenderableScene,
  schemaVersionError,
} from '@/lib/pitchRender/validate';
import { END_CARD_MS } from '@/lib/pitchRender/endCard';
import { workFilePaths } from '@/lib/pitchRender/renderScene';

import { qaScene } from './fixtures';

describe('P6: the renderer accepts v2 and refuses everything else by name', () => {
  it('accepts the QA scene and the contracts example scene', () => {
    expect(assertRenderableScene(qaScene()).schemaVersion).toBe(2);
    expect(assertRenderableScene(examplePitchSceneV2()).schemaVersion).toBe(2);
  });

  it('refuses a v1 scene with the pinned error', () => {
    expect(() => assertRenderableScene({ schemaVersion: 1, segments: [] })).toThrowError(
      'pitch render supports PitchScene schemaVersion 2 only; got 1',
    );
  });

  it('refuses a v3 scene with the pinned error', () => {
    expect(() => assertRenderableScene({ schemaVersion: 3, shots: [] })).toThrowError(
      'pitch render supports PitchScene schemaVersion 2 only; got 3',
    );
  });

  it('refuses documents with no version at all', () => {
    expect(() => assertRenderableScene(null)).toThrowError(schemaVersionError('none'));
    expect(() => assertRenderableScene({})).toThrowError(schemaVersionError('none'));
    expect(() => assertRenderableScene('scene')).toThrowError(schemaVersionError('none'));
  });

  it('refuses a malformed document that merely claims v2', () => {
    expect(() => assertRenderableScene({ schemaVersion: 2, shots: 'nope' })).toThrowError(
      INVALID_V2_SCENE_ERROR,
    );
  });
});

// T003 / issue #72 — the render is cut at `scene.durationMs`
// (`renderScene`: sceneFrames = round(durationMs / 1000 * fps), plus the 1.5s
// end card, and the audio is muxed at its own full length with no `-shortest`).
// A 54.543s recording that produced a 37660ms scene therefore encoded 39.17s of
// video under 54.54s of audio. Nothing in the renderer changes: it has to accept
// the longer scene the builder now produces, and its frame count has to follow
// it, so the video outlasts the audio instead of the other way round.
describe('T003: a scene as long as its recording renders to at least its audio', () => {
  const AUDIO_MS = 54_543;
  const scene = buildPitchSceneV2({
    template: 'warm',
    photoAssetIds: [0, 1, 2].map(
      (index) => `40000000-0000-0000-0000-${String(index + 1).padStart(12, '0')}`,
    ),
    segments: [
      { startMs: 0, endMs: 12_500 },
      { startMs: 12_500, endMs: 25_000 },
      { startMs: 25_000, endMs: 37_660 },
    ],
    audioDurationMs: AUDIO_MS,
  });

  it('is renderable, and its video covers the whole recording', () => {
    if (scene === null) {
      throw new Error('the builder must produce a scene for this recording');
    }
    const renderable = assertRenderableScene(scene);
    expect(renderable.durationMs).toBe(AUDIO_MS);
    // What renderScene will plan from it: the same arithmetic it runs, on the
    // scene the builder actually produced. The old scene planned 1175 frames —
    // 39.2s of video with the end card — under 54.5s of audio.
    const { fps } = renderable.canvas;
    const sceneFrames = Math.round((renderable.durationMs / 1000) * fps);
    const endCardFrames = Math.round((END_CARD_MS / 1000) * fps);
    // The picture reaches the end of the voice to within one frame (whole
    // frames cannot land on 54.543s), and the end card carries it past.
    expect(sceneFrames / fps).toBeGreaterThan(AUDIO_MS / 1000 - 1 / fps);
    expect((sceneFrames + endCardFrames) / fps).toBeGreaterThan(AUDIO_MS / 1000);
  });
});

describe('P7: work file paths are a pure function of the render key', () => {
  it('yields identical paths for identical inputs', () => {
    const first = workFilePaths('/tmp/work', 'rev-abc.123', 'audio/mp4');
    const second = workFilePaths('/tmp/work', 'rev-abc.123', 'audio/mp4');
    expect(first).toEqual(second);
    expect(first.outputPath).toBe('/tmp/work/rev-abc.123.mp4');
    expect(first.audioPath).toBe('/tmp/work/rev-abc.123.audio.m4a');
  });

  it('carries no audio path for a silent render', () => {
    expect(workFilePaths('/tmp/work', 'rev', null).audioPath).toBeNull();
  });

  it('refuses keys that could escape the work directory', () => {
    expect(() => workFilePaths('/tmp/work', '../evil', 'audio/mp4')).toThrowError(
      'renderKey must be 1-120 chars of [A-Za-z0-9._-]',
    );
    expect(() => workFilePaths('/tmp/work', 'a/b', 'audio/mp4')).toThrowError(
      'renderKey must be 1-120 chars of [A-Za-z0-9._-]',
    );
  });
});
