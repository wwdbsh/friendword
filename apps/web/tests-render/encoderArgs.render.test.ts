import { describe, expect, it } from 'vitest';

import { audioCodecArgs, audioFileExtension, buildEncoderArgs } from '@/lib/pitchRender/encode';

describe('P1: frames stream over stdin, never through the filesystem', () => {
  it('reads video from pipe:0 as an image2pipe stream', () => {
    const args = buildEncoderArgs({
      fps: 30,
      audioPath: '/tmp/w/key.audio.m4a',
      audioMimeType: 'audio/mp4',
      outputPath: '/tmp/w/key.mp4',
    });
    const pipeIndex = args.indexOf('pipe:0');
    expect(pipeIndex).toBeGreaterThan(-1);
    expect(args[pipeIndex - 1]).toBe('-i');
    expect(args).toContain('image2pipe');
    // No frame directory, no %d pattern: the only file inputs are audio + out.
    expect(args.join(' ')).not.toMatch(/%\d*d/);
  });
});

describe('P5: the introducer voice is copied or codec-transcoded, never filtered', () => {
  it('copies the product audio kind (audio/mp4 = AAC in m4a) bit for bit', () => {
    expect(audioCodecArgs('audio/mp4')).toEqual(['-c:a', 'copy']);
    expect(audioCodecArgs('audio/mp4;codecs=mp4a.40.2')).toEqual(['-c:a', 'copy']);
  });

  it('transcodes non-AAC audio to AAC and nothing more', () => {
    expect(audioCodecArgs('audio/webm')).toEqual(['-c:a', 'aac', '-b:a', '160k']);
    expect(audioCodecArgs('audio/wav')).toEqual(['-c:a', 'aac', '-b:a', '160k']);
  });

  it('never emits a waveform-altering filter or -shortest', () => {
    for (const mime of ['audio/mp4', 'audio/webm', null] as const) {
      const argv = buildEncoderArgs({
        fps: 30,
        audioPath: mime === null ? null : '/tmp/w/key.audio.bin',
        audioMimeType: mime,
        outputPath: '/tmp/w/key.mp4',
      }).join(' ');
      expect(argv).not.toContain('loudnorm');
      expect(argv).not.toContain('atempo');
      expect(argv).not.toContain('afade');
      expect(argv).not.toContain('dynaudnorm');
      // -shortest would cut the end card off the video (P4); the audio simply
      // ends and the remaining frames play silent.
      expect(argv).not.toContain('-shortest');
      expect(argv).not.toContain('-af');
    }
  });

  it('maps audio extensions from the mime types the product stores', () => {
    expect(audioFileExtension('audio/mp4')).toBe('m4a');
    expect(audioFileExtension('audio/webm;codecs=opus')).toBe('webm');
    expect(audioFileExtension('application/octet-stream')).toBe('bin');
  });
});

describe('encoder output shape', () => {
  it('encodes H.264 yuv420p at the scene fps with faststart', () => {
    const args = buildEncoderArgs({
      fps: 30,
      audioPath: null,
      audioMimeType: null,
      outputPath: '/tmp/w/key.mp4',
    });
    expect(args).toContain('libx264');
    expect(args.join(' ')).toContain('format=yuv420p');
    expect(args.join(' ')).toContain('-movflags +faststart');
    // Memory bound + machine-independent output: see encode.ts.
    expect(args.join(' ')).toContain('-threads 2');
    expect(args.filter((arg) => arg === '30')).toHaveLength(2); // -framerate and -r
    expect(args[args.length - 1]).toBe('/tmp/w/key.mp4');
  });
});
