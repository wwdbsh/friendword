import { describe, expect, it, vi } from 'vitest';

import {
  remainingVisualSelection,
  selectPickedVisuals,
  visualPickLimits,
  visualPickMessage,
  type PickedVisualAsset,
} from './pickedVisuals';
import {
  CLIP_MAX_SOURCE_DURATION_MS,
  DEFAULT_CLIP_MAX_BYTES,
  FREE_PITCH_CLIP_ALLOWANCE,
  MAX_PITCH_CLIPS,
  MAX_PITCH_PHOTOS,
  MAX_PITCH_VISUALS,
  type PitchClip,
  type PitchPhoto,
} from './types';

/** The absolute-ceiling limits, for the cap tests; the default mirrors the free allowance. */
const LIMITS = visualPickLimits(DEFAULT_CLIP_MAX_BYTES, MAX_PITCH_CLIPS);
const FREE_LIMITS = visualPickLimits(DEFAULT_CLIP_MAX_BYTES);
const EMPTY = { photos: [] as readonly PitchPhoto[], clips: [] as readonly PitchClip[] };

/** No runtime can measure a file in this test process; every clip declares its size. */
const noLocalSize = async (): Promise<number | null> => null;

function photoAsset(uri: string, mimeType = 'image/jpeg'): PickedVisualAsset {
  return { uri, width: 1000, height: 1200, type: 'image', mimeType };
}

function clipAsset(overrides: Partial<PickedVisualAsset> = {}): PickedVisualAsset {
  return {
    uri: 'file:///clip.mp4',
    width: 1080,
    height: 1920,
    type: 'video',
    mimeType: 'video/mp4',
    duration: 8_000,
    fileSize: 4_000_000,
    ...overrides,
  };
}

describe('mixed photo and video picking', () => {
  it('keeps photos and clips apart, carrying the measurements the upload needs', async () => {
    const result = await selectPickedVisuals(
      [photoAsset('file:///one.jpg'), clipAsset({ mimeType: 'video/quicktime' })],
      EMPTY,
      LIMITS,
      noLocalSize,
    );

    expect(result.rejections).toEqual([]);
    expect(result.photos).toEqual([
      { uri: 'file:///one.jpg', width: 1000, height: 1200, mimeType: 'image/jpeg' },
    ]);
    expect(result.clips).toEqual([
      {
        uri: 'file:///clip.mp4',
        width: 1080,
        height: 1920,
        durationMillis: 8_000,
        byteSize: 4_000_000,
        mimeType: 'video/quicktime',
      },
    ]);
  });

  it('classifies an asset the picker did not type, by mime and then by extension', async () => {
    const result = await selectPickedVisuals(
      [
        {
          uri: 'file:///untyped.mov',
          width: 720,
          height: 1280,
          duration: 5_000,
          fileSize: 900_000,
        },
        { uri: 'file:///untyped.png', width: 20, height: 20 },
      ],
      EMPTY,
      LIMITS,
      noLocalSize,
    );

    expect(result.clips.map((clip) => clip.mimeType)).toEqual(['video/quicktime']);
    expect(result.photos.map((photo) => photo.mimeType)).toEqual(['image/png']);
  });

  it('refuses a container the ingest probe would reject', async () => {
    const result = await selectPickedVisuals(
      [clipAsset({ uri: 'file:///clip.webm', mimeType: 'video/webm' })],
      EMPTY,
      LIMITS,
      noLocalSize,
    );

    expect(result.clips).toEqual([]);
    expect(result.rejections).toEqual(['unsupported_clip']);
    expect(visualPickMessage(result.rejections, LIMITS)).toContain('MP4 and MOV');
  });

  it('refuses a clip longer than the source cap, which the picker does not trim', async () => {
    const result = await selectPickedVisuals(
      [clipAsset({ duration: CLIP_MAX_SOURCE_DURATION_MS + 1 })],
      EMPTY,
      LIMITS,
      noLocalSize,
    );

    expect(result.clips).toEqual([]);
    expect(result.rejections).toEqual(['clip_too_long']);
    expect(visualPickMessage(result.rejections, LIMITS)).toContain('15 seconds');
  });

  it('accepts a clip exactly at the source cap', async () => {
    const result = await selectPickedVisuals(
      [clipAsset({ duration: CLIP_MAX_SOURCE_DURATION_MS })],
      EMPTY,
      LIMITS,
      noLocalSize,
    );

    expect(result.clips).toHaveLength(1);
    expect(result.rejections).toEqual([]);
  });

  it('refuses a clip over the configured byte ceiling', async () => {
    const result = await selectPickedVisuals(
      [clipAsset({ fileSize: DEFAULT_CLIP_MAX_BYTES + 1 })],
      EMPTY,
      LIMITS,
      noLocalSize,
    );

    expect(result.clips).toEqual([]);
    expect(result.rejections).toEqual(['clip_too_large']);
    expect(visualPickMessage(result.rejections, LIMITS)).toContain('50MB');
  });

  it('honours a lowered ceiling from configuration', async () => {
    const result = await selectPickedVisuals(
      [clipAsset({ fileSize: 6_000_000 })],
      EMPTY,
      visualPickLimits(5_000_000, MAX_PITCH_CLIPS),
      noLocalSize,
    );

    expect(result.rejections).toEqual(['clip_too_large']);
  });

  it('measures the local file when the picker reports no size', async () => {
    const readByteSize = vi.fn(async () => 3_000_000);

    const result = await selectPickedVisuals(
      [clipAsset({ fileSize: null })],
      EMPTY,
      LIMITS,
      readByteSize,
    );

    expect(readByteSize).toHaveBeenCalledWith('file:///clip.mp4');
    expect(result.clips[0]?.byteSize).toBe(3_000_000);
  });

  it('refuses a clip whose length or size cannot be measured at all', async () => {
    const unmeasuredDuration = await selectPickedVisuals(
      [clipAsset({ duration: null })],
      EMPTY,
      LIMITS,
      noLocalSize,
    );
    const unmeasuredSize = await selectPickedVisuals(
      [clipAsset({ fileSize: null })],
      EMPTY,
      LIMITS,
      noLocalSize,
    );

    expect(unmeasuredDuration.clips).toEqual([]);
    expect(unmeasuredSize.clips).toEqual([]);
    expect(unmeasuredDuration.rejections).toEqual(['clip_unmeasured']);
    expect(unmeasuredSize.rejections).toEqual(['clip_unmeasured']);
  });

  it('stops at the clip cap and keeps the earlier selections', async () => {
    const assets = Array.from({ length: MAX_PITCH_CLIPS + 1 }, (_, index) =>
      clipAsset({ uri: `file:///clip-${index}.mp4` }),
    );

    const result = await selectPickedVisuals(assets, EMPTY, LIMITS, noLocalSize);

    expect(result.clips.map((clip) => clip.uri)).toEqual([
      'file:///clip-0.mp4',
      'file:///clip-1.mp4',
      'file:///clip-2.mp4',
    ]);
    expect(result.rejections).toEqual(['clip_limit']);
  });

  it('stops at the photo cap, counting what the draft already holds', async () => {
    const current = {
      photos: Array.from({ length: MAX_PITCH_PHOTOS }, (_, index) => ({
        uri: `file:///stored-${index}.jpg`,
        width: 10,
        height: 10,
        mimeType: 'image/jpeg' as const,
      })),
      clips: [] as readonly PitchClip[],
    };

    const result = await selectPickedVisuals(
      [photoAsset('file:///extra.jpg')],
      current,
      LIMITS,
      noLocalSize,
    );

    expect(result.photos).toHaveLength(MAX_PITCH_PHOTOS);
    expect(result.rejections).toEqual(['photo_limit']);
  });

  it('never accepts more visuals than the combined ceiling', async () => {
    const assets = [
      ...Array.from({ length: MAX_PITCH_PHOTOS }, (_, index) =>
        photoAsset(`file:///photo-${index}.jpg`),
      ),
      ...Array.from({ length: MAX_PITCH_CLIPS }, (_, index) =>
        clipAsset({ uri: `file:///clip-${index}.mp4` }),
      ),
      photoAsset('file:///overflow.jpg'),
    ];

    const result = await selectPickedVisuals(assets, EMPTY, LIMITS, noLocalSize);

    expect(result.photos.length + result.clips.length).toBe(MAX_PITCH_VISUALS);
  });

  it('reports every distinct reason once, in the order they happened', async () => {
    const result = await selectPickedVisuals(
      [
        photoAsset('file:///nope.gif', 'image/gif'),
        clipAsset({ uri: 'file:///long.mp4', duration: 30_000 }),
        clipAsset({ uri: 'file:///long-too.mp4', duration: 40_000 }),
        photoAsset('file:///nope.bmp', 'image/bmp'),
      ],
      EMPTY,
      LIMITS,
      noLocalSize,
    );

    expect(result.rejections).toEqual(['unsupported_photo', 'clip_too_long']);
  });

  it('mirrors the free allowance of one clip by default, naming the Campaign Pass', async () => {
    const result = await selectPickedVisuals(
      [clipAsset({ uri: 'file:///clip-0.mp4' }), clipAsset({ uri: 'file:///clip-1.mp4' })],
      EMPTY,
      FREE_LIMITS,
      noLocalSize,
    );

    expect(FREE_LIMITS.maxClips).toBe(FREE_PITCH_CLIP_ALLOWANCE);
    expect(result.clips.map((clip) => clip.uri)).toEqual(['file:///clip-0.mp4']);
    expect(visualPickMessage(result.rejections, FREE_LIMITS)).toContain('Campaign Pass');
  });

  it('never lets a caller raise the clip allowance past the schema ceiling', () => {
    expect(visualPickLimits(DEFAULT_CLIP_MAX_BYTES, 9).maxClips).toBe(MAX_PITCH_CLIPS);
  });

  it('asks the picker for no more items than the caps allow, and never for zero', () => {
    expect(remainingVisualSelection(EMPTY, LIMITS)).toBe(MAX_PITCH_PHOTOS + MAX_PITCH_CLIPS);
    expect(
      remainingVisualSelection(
        {
          photos: Array.from({ length: MAX_PITCH_PHOTOS }, () => ({})),
          clips: Array.from({ length: MAX_PITCH_CLIPS }, () => ({})),
        },
        LIMITS,
      ),
    ).toBe(1);
  });

  it('never claims a check the pipeline does not run', () => {
    const messages = (
      [
        'unsupported_photo',
        'unsupported_clip',
        'clip_too_long',
        'clip_too_large',
        'clip_unmeasured',
        'photo_limit',
        'clip_limit',
      ] as const
    ).map((rejection) => visualPickMessage([rejection], LIMITS) ?? '');

    for (const message of messages) {
      expect(message).not.toBe('');
      expect(message.toLowerCase()).not.toMatch(/face|identity|verified|match/);
    }
    expect(visualPickMessage([], LIMITS)).toBeNull();
  });
});
