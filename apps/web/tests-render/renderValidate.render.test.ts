import { describe, expect, it } from 'vitest';

import { examplePitchSceneV2 } from '@friendword/contracts';

import {
  INVALID_V2_SCENE_ERROR,
  assertRenderableScene,
  schemaVersionError,
} from '@/lib/pitchRender/validate';
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
