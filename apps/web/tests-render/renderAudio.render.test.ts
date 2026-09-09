import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import ffmpegPath from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';
import { describe, expect, it } from 'vitest';

import {
  CUT_FADE_MS,
  DUCK_RATIO,
  DUCK_THRESHOLD,
  MUSIC_BED_BELOW_VOICE_DB,
  buildRenderAudio,
  cutFilterGraph,
  measureRmsDb,
  musicMixGraph,
  readWavSamples,
  rmsEnvelope,
} from '@/lib/pitchRender/audio';
import {
  MUSIC_BPM,
  MUSIC_SAMPLE_RATE,
  musicBedWav,
  musicSeedFromHash,
  synthesizeMusicBed,
} from '@/lib/pitchRender/musicBed';

import { audioM4a } from './fixtures';

// §2.2 (2)-(3) and §2.6. The graph assertions run everywhere; the measured
// ones drive the bundled ffmpeg, which every machine that can render has.

const WORK = path.join(os.tmpdir(), 'friendword-render-audio-test');

function pcmHash(samples: Int16Array): string {
  return createHash('sha256')
    .update(Buffer.from(samples.buffer, 0, samples.byteLength))
    .digest('hex');
}

describe('§2.2-2: the cut is windows spliced with a fade at every boundary', () => {
  it('trims each window and fades 20ms in and out of it', () => {
    const graph = cutFilterGraph([
      { startMs: 1_000, endMs: 5_000 },
      { startMs: 9_000, endMs: 12_000 },
    ]);
    expect(graph).toContain('atrim=start=1.000:end=5.000');
    expect(graph).toContain('atrim=start=9.000:end=12.000');
    // 20ms in at the head, 20ms out ending exactly at the window's end.
    expect(graph).toContain('afade=t=in:st=0:d=0.020');
    expect(graph).toContain('afade=t=out:st=3.980:d=0.020');
    expect(graph).toContain('afade=t=out:st=2.980:d=0.020');
    expect(graph).toContain('concat=n=2:v=0:a=1[cut]');
    expect(CUT_FADE_MS).toBe(20);
  });

  it('resets timestamps per window so concat does not leave a gap', () => {
    expect(cutFilterGraph([{ startMs: 0, endMs: 1_000 }])).toContain('asetpts=N/SR/TB');
  });
});

describe('§2.2-3: the bed is ducked by the voice, never the other way round', () => {
  it('keys the compressor on the voice with the pinned constants', () => {
    const graph = musicMixGraph(-12.5, 11_000);
    expect(graph).toContain('volume=-12.50dB');
    // [bed] is the main input, the PADDED voice the sidechain key.
    expect(graph).toContain(
      `[bed][key]sidechaincompress=threshold=${DUCK_THRESHOLD}:ratio=${DUCK_RATIO}:attack=5:release=250`,
    );
    // sidechaincompress ends with its SHORTER input, so an unpadded voice key
    // would truncate the ducked bed — and the whole mix — to the voice's
    // length, leaving the end card silent and cutting the fade-out.
    expect(graph).toContain('[0:a]apad=whole_dur=11.000[key]');
    expect(graph).toContain('amix=inputs=2:duration=longest');
    // normalize=0: amix's default halves the voice, which is the one thing
    // this mix may never do.
    expect(graph).toContain('normalize=0');
  });
});

describe('§2.6: the bed is a deterministic function of its seed', () => {
  it('gives the same seed the same samples, byte for byte', () => {
    const a = synthesizeMusicBed({ seed: 'a'.repeat(64), template: 'warm', durationMs: 4_000 });
    const b = synthesizeMusicBed({ seed: 'a'.repeat(64), template: 'warm', durationMs: 4_000 });
    expect(pcmHash(a)).toBe(pcmHash(b));
  });

  it('is pinned to a golden hash, so a refactor cannot move the bed quietly', () => {
    // Update this deliberately, and say so, whenever the synth intentionally
    // changes: it is the only thing that would catch a "harmless" optimisation
    // that shifts a sample.
    expect(
      pcmHash(synthesizeMusicBed({ seed: 'golden', template: 'warm', durationMs: 2_000 })),
    ).toBe('10fc0cf644c018eefd39da836d60f7a7c130a72d91d6d8286c0a1cef2e14a7ba');
    expect(
      pcmHash(synthesizeMusicBed({ seed: 'golden', template: 'hype', durationMs: 2_000 })),
    ).toBe('fb3b9b7f1102fc23ef3da223ec8dcf24b619334b7bd70da1bc9f7accd3f82fbe');
  });

  it('gives a different seed different samples', () => {
    const a = synthesizeMusicBed({ seed: 'a'.repeat(64), template: 'warm', durationMs: 4_000 });
    const b = synthesizeMusicBed({ seed: 'b'.repeat(64), template: 'warm', durationMs: 4_000 });
    expect(musicSeedFromHash('a'.repeat(64))).not.toBe(musicSeedFromHash('b'.repeat(64)));
    expect(pcmHash(a)).not.toBe(pcmHash(b));
  });

  it('is exactly as long as it was asked to be, and fades out', () => {
    const bed = synthesizeMusicBed({ seed: 'seed', template: 'hype', durationMs: 6_000 });
    expect(bed.length).toBe(6 * MUSIC_SAMPLE_RATE);
    // The final sample of the 1.5s fade is silence, and the bed is not silent
    // a second earlier.
    expect(bed[bed.length - 1]).toBe(0);
    const beforeFade = bed.subarray(
      bed.length - 4 * MUSIC_SAMPLE_RATE,
      bed.length - 3 * MUSIC_SAMPLE_RATE,
    );
    expect(beforeFade.some((sample) => Math.abs(sample) > 100)).toBe(true);
  });

  it('carries the two approved tempi and stays inside 16-bit range', () => {
    expect(MUSIC_BPM).toEqual({ warm: 84, hype: 104 });
    for (const template of ['warm', 'hype'] as const) {
      const bed = synthesizeMusicBed({ seed: 'x', template, durationMs: 3_000 });
      expect(bed.every((sample) => sample >= -32_768 && sample <= 32_767)).toBe(true);
    }
  });

  it('wraps the samples in a canonical 16-bit mono WAV', () => {
    const wav = musicBedWav(synthesizeMusicBed({ seed: 's', template: 'warm', durationMs: 100 }));
    const buffer = Buffer.from(wav);
    expect(buffer.toString('ascii', 0, 4)).toBe('RIFF');
    expect(buffer.toString('ascii', 8, 12)).toBe('WAVE');
    expect(buffer.readUInt16LE(22)).toBe(1);
    expect(buffer.readUInt32LE(24)).toBe(MUSIC_SAMPLE_RATE);
  });
});

describe('§2.3: the envelope is measured, at frame resolution', () => {
  it('normalizes to 0..1 with three decimals and one entry per frame', () => {
    const samples = new Int16Array(48_000);
    for (let index = 0; index < samples.length; index += 1) {
      // Loud first second-half, quiet first half: the shape must survive.
      samples[index] = index < 24_000 ? 1_000 : 20_000;
    }
    const envelope = rmsEnvelope(samples, 30, 30);
    expect(envelope).toHaveLength(30);
    expect(Math.max(...envelope)).toBe(1);
    expect(envelope[0]).toBeLessThan(0.1);
    expect(envelope.every((value) => value >= 0 && value <= 1)).toBe(true);
    expect(envelope.every((value) => Math.round(value * 1000) === value * 1000)).toBe(true);
  });

  it('is silent, not NaN, for silence', () => {
    expect(rmsEnvelope(new Int16Array(4_800), 30, 3)).toEqual([0, 0, 0]);
  });
});

describe('the built audio track (measured with the bundled ffmpeg)', () => {
  const ffmpeg = ffmpegPath;
  if (ffmpeg === null) {
    throw new Error('ffmpeg-static did not resolve a binary');
  }
  mkdirSync(WORK, { recursive: true });
  const voice = audioM4a(20);
  const sourcePath = path.join(WORK, 'source.m4a');

  const paths = {
    cutWav: path.join(WORK, 'cut.wav'),
    bedWav: path.join(WORK, 'bed.wav'),
    mixWav: path.join(WORK, 'mix.wav'),
    openWav: path.join(WORK, 'open.wav'),
  };

  it('cuts to the windows and measures an envelope over the output frames', async () => {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(sourcePath, voice.bytes);
    const result = await buildRenderAudio({
      ffmpegPath: ffmpeg,
      sourcePath,
      windows: [
        { startMs: 1_000, endMs: 6_000 },
        { startMs: 10_000, endMs: 16_000 },
      ],
      music: false,
      template: 'warm',
      seed: 'cut-hash',
      endCardMs: 3_000,
      fps: 30,
      frameCount: 330,
      paths,
    });
    expect(result.touched).toBe(true);
    // 5s + 6s of source, ±one frame of splice rounding.
    expect(result.voiceMs).toBeGreaterThanOrEqual(10_950);
    expect(result.voiceMs).toBeLessThanOrEqual(11_050);
    expect(result.envelope).toHaveLength(330);
    expect(Math.max(...result.envelope)).toBe(1);
    const samples = await readWavSamples(paths.cutWav);
    expect(samples.length).toBeGreaterThan(10_000);
  });

  // §2.2-4: the selfie opening is SILENT, so the whole track moves back by it.
  it('pushes the voice back by exactly the silent opening, in whole frames', async () => {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(sourcePath, voice.bytes);
    const common = {
      ffmpegPath: ffmpeg,
      sourcePath,
      windows: [{ startMs: 0, endMs: 4_000 }],
      music: false,
      template: 'warm' as const,
      seed: 'cut-hash',
      endCardMs: 3_000,
      fps: 30,
      frameCount: 120,
      paths,
    };
    const plain = await buildRenderAudio(common);
    const OPENING_FRAMES = 75; // 2.5s at 30fps
    const opened = await buildRenderAudio({ ...common, openingFrames: OPENING_FRAMES });

    // The lead is whole frames of the OUTPUT clock, so the picture (which is
    // that same frame count) can never end before the sound — §2.2-6.
    const leadMs = (OPENING_FRAMES * 1000) / 30;
    expect(opened.durationMs - plain.durationMs).toBeGreaterThanOrEqual(leadMs - 2);
    expect(opened.durationMs - plain.durationMs).toBeLessThanOrEqual(leadMs + 2);
    // The voice itself is untouched: only where it starts moved.
    expect(opened.voiceMs).toBe(plain.voiceMs);

    // The opening's own frames are silence, and the voice envelope follows it
    // unchanged — the waveform must not flicker at the join.
    expect(opened.envelope).toHaveLength(OPENING_FRAMES + plain.envelope.length);
    expect(opened.envelope.slice(0, OPENING_FRAMES).every((level) => level === 0)).toBe(true);
    expect(opened.envelope.slice(OPENING_FRAMES)).toEqual(plain.envelope);

    // …and the leading samples really are digital silence, not a fade.
    const samples = await readWavSamples(opened.path);
    const leadSamples = Math.round((leadMs * 48_000) / 1000);
    expect(samples.length).toBeGreaterThan(leadSamples);
    expect(samples.slice(0, leadSamples).every((sample) => sample === 0)).toBe(true);
  });

  it('is byte-identical with no opening asked for', async () => {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(sourcePath, voice.bytes);
    const result = await buildRenderAudio({
      ffmpegPath: ffmpeg,
      sourcePath,
      windows: [{ startMs: 0, endMs: 4_000 }],
      music: false,
      template: 'warm',
      seed: 'cut-hash',
      endCardMs: 3_000,
      fps: 30,
      frameCount: 120,
      openingFrames: 0,
      paths,
    });
    // The pre-T004 path returns the cut itself, never a re-muxed copy of it.
    expect(result.path).toBe(paths.cutWav);
  });

  it('places the bed at least 18 dB under the voice before ducking', async () => {
    const result = await buildRenderAudio({
      ffmpegPath: ffmpeg,
      sourcePath,
      windows: [{ startMs: 0, endMs: 8_000 }],
      music: true,
      template: 'warm',
      seed: 'cut-hash',
      endCardMs: 3_000,
      fps: 30,
      frameCount: 240,
      paths,
    });
    expect(result.bedGainDb).not.toBeNull();
    const bedRmsDb = await measureRmsDb(ffmpeg, paths.bedWav);
    const gain = result.bedGainDb ?? 0;
    expect(bedRmsDb + gain).toBeLessThanOrEqual(result.voiceRmsDb - 18);
    expect(MUSIC_BED_BELOW_VOICE_DB).toBeGreaterThanOrEqual(18);

    // MEASURED off the file the encoder will read, not computed from the
    // inputs: the arithmetic version of this assertion passed while the mix
    // was actually being truncated to the voice (review, 2026-09-09).
    const probed = Number.parseFloat(
      execFileSync(ffprobeStatic.path, [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'csv=p=0',
        paths.mixWav,
      ])
        .toString('utf8')
        .trim(),
    );
    expect(probed * 1000).toBeGreaterThanOrEqual(result.voiceMs + 2_900);
    expect(Math.abs(probed * 1000 - result.durationMs)).toBeLessThan(50);
    // And the bed really is still audible under the card, before its fade.
    expect(result.durationMs).toBeGreaterThanOrEqual(result.voiceMs + 2_900);
  });
});
