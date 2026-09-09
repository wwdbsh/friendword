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

// 2026-09-09 (REEL_V3_DESIGN §0 verdict 3): P5 was "the AAC is copied bit for
// bit; no filter touches the waveform". It now reads: THE WEB PAGE IS THE
// ORIGINAL, LOSSLESS; THE MP4 IS A DERIVATIVE. The published page still streams
// the Introducer's recording exactly as stored — that boundary is unchanged and
// nothing in this file touches it. The MP4 alone may be cut to the highlight
// windows, faded at those cuts and mixed with the generated bed, and it is then
// re-encoded because a copy is impossible.
//
// The old assertions therefore split in two: the LEGACY path (full variant,
// music off, or RENDER_HIGHLIGHT_ENABLED=false) must still produce the byte
// identical argv it always did, and the derivative path is pinned separately.

describe('P5 (legacy path): the voice is copied or codec-transcoded, never filtered', () => {
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

  it('is the argv it has always been — the rollback flag renders this', () => {
    // A pinned snapshot, not a property: RENDER_HIGHLIGHT_ENABLED=false must
    // reproduce the released file, and "same behaviour" has to be checkable at
    // a glance in a review.
    expect(
      buildEncoderArgs({
        fps: 30,
        audioPath: '/tmp/w/key.audio.m4a',
        audioMimeType: 'audio/mp4',
        outputPath: '/tmp/w/key.mp4',
      }).join(' '),
    ).toBe(
      '-y -hide_banner -loglevel error -f image2pipe -framerate 30 -c:v mjpeg -i pipe:0 ' +
        '-i /tmp/w/key.audio.m4a -map 0:v -map 1:a -c:v libx264 -preset veryfast -crf 20 ' +
        '-threads 2 -vf scale=out_color_matrix=bt709:out_range=tv,format=yuv420p ' +
        '-color_primaries bt709 -color_trc bt709 -colorspace bt709 -r 30 -c:a copy ' +
        '-movflags +faststart /tmp/w/key.mp4',
    );
  });

  it('maps audio extensions from the mime types the product stores', () => {
    expect(audioFileExtension('audio/mp4')).toBe('m4a');
    expect(audioFileExtension('audio/webm;codecs=opus')).toBe('webm');
    expect(audioFileExtension('application/octet-stream')).toBe('bin');
  });
});

describe('§2.2-7: the derivative track is re-encoded, bitexact', () => {
  it('encodes AAC 128k once audio.ts has cut or mixed the waveform', () => {
    const args = buildEncoderArgs({
      fps: 30,
      audioPath: '/tmp/w/key.cut.wav',
      audioMimeType: 'audio/wav',
      outputPath: '/tmp/w/key.mp4',
      audioTouched: true,
    });
    expect(args.join(' ')).toContain('-c:a aac -b:a 128k');
    // §0 verdict 6: the same derivative must produce the same bytes.
    expect(args.join(' ')).toContain('-fflags +bitexact -flags +bitexact');
    expect(audioCodecArgs('audio/mp4', true)).toEqual(['-c:a', 'aac', '-b:a', '128k']);
  });

  it('still refuses -shortest: the end card outlives the audio (P4)', () => {
    const args = buildEncoderArgs({
      fps: 30,
      audioPath: '/tmp/w/key.mix.wav',
      audioMimeType: 'audio/wav',
      outputPath: '/tmp/w/key.mp4',
      audioTouched: true,
    });
    expect(args).not.toContain('-shortest');
  });

  it('adds nothing to the legacy argv — bitexact included', () => {
    const legacy = buildEncoderArgs({
      fps: 30,
      audioPath: '/tmp/w/key.audio.m4a',
      audioMimeType: 'audio/mp4',
      outputPath: '/tmp/w/key.mp4',
    });
    expect(legacy).not.toContain('+bitexact');
    expect(legacy.join(' ')).toContain('-c:a copy');
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
