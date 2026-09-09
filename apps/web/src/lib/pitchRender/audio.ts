import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';

import { musicBedWav, synthesizeMusicBed } from './musicBed';

const run = promisify(execFile);

// §2.2 (2)-(3) — the MP4's audio derivative.
//
// P5 used to read "the AAC is copied bit for bit, no filter touches the
// waveform". After the 2026-09-09 decision it reads: THE WEB PAGE IS THE
// ORIGINAL, LOSSLESS; THE MP4 IS A DERIVATIVE. The published page still streams
// the Introducer's recording exactly as stored — that is the artifact the Dater
// approved, and nothing in this module can reach it. The MP4 alone may be cut
// to the highlight windows, faded at those cuts and mixed with a bed.
//
// Everything here is measured or synthesized, never invented:
//   - the cut points come from the frozen transcript through buildHighlightPlan;
//   - the envelope the waveform draws is the RMS of the audio that is actually
//     exported, not a decorative shape;
//   - the bed's level is set FROM the measured voice level, so ducking cannot
//     accidentally bury a quiet speaker.

/** §2.2-2: a 20ms fade at each cut, so a splice is never a click. */
export const CUT_FADE_MS = 20;
/** §2.2-3 sidechain: -30 dB threshold expressed as ffmpeg's linear amplitude. */
export const DUCK_THRESHOLD = '0.0316228';
export const DUCK_RATIO = '8';
export const DUCK_ATTACK_MS = '5';
export const DUCK_RELEASE_MS = '250';
/**
 * How far under the measured voice the bed sits BEFORE ducking. The acceptance
 * criterion is -18 dB; the bed is placed at -20 dB so the test measures a
 * margin rather than a coin flip.
 */
export const MUSIC_BED_BELOW_VOICE_DB = 20;
export const AUDIO_SAMPLE_RATE = 48_000;

const BITEXACT = ['-fflags', '+bitexact', '-flags', '+bitexact'] as const;

export type CutWindow = { readonly startMs: number; readonly endMs: number };

function ffmpegBaseArgs(): readonly string[] {
  return ['-y', '-hide_banner', '-loglevel', 'error', ...BITEXACT];
}

function seconds(ms: number): string {
  return (ms / 1000).toFixed(3);
}

/**
 * The filter graph for the cut: one atrim per window, a 20ms fade at each end,
 * then a concat. Built as a string here (rather than inline) so
 * audioFilters.render.test.ts can assert it without running ffmpeg.
 */
export function cutFilterGraph(windows: readonly CutWindow[]): string {
  const parts = windows.map((window, index) => {
    const durationMs = Math.max(CUT_FADE_MS * 2, window.endMs - window.startMs);
    const fadeOutAt = seconds(durationMs - CUT_FADE_MS);
    return (
      `[0:a]atrim=start=${seconds(window.startMs)}:end=${seconds(window.endMs)},` +
      `asetpts=N/SR/TB,` +
      `afade=t=in:st=0:d=${seconds(CUT_FADE_MS)},` +
      `afade=t=out:st=${fadeOutAt}:d=${seconds(CUT_FADE_MS)}[w${index}]`
    );
  });
  const inputs = windows.map((_window, index) => `[w${index}]`).join('');
  return `${parts.join(';')};${inputs}concat=n=${windows.length}:v=0:a=1[cut]`;
}

/**
 * The duck + mix graph (§2.2-3): the voice keys a compressor on the bed.
 *
 * The key input is PADDED to the bed's full length first. sidechaincompress
 * ends when EITHER input ends, so an unpadded voice (which is always shorter —
 * the bed runs on under the end card) truncated the ducked bed to the voice,
 * and with it the whole mix: the end card played silent and the 1.5s fade-out
 * became a hard stop. Found in review, 2026-09-09; the duration assertion in
 * renderAudio.render.test.ts now measures the file rather than trusting the
 * arithmetic that hid it.
 */
export function musicMixGraph(bedGainDb: number, bedDurationMs: number): string {
  return (
    `[1:a]volume=${bedGainDb.toFixed(2)}dB[bed];` +
    `[0:a]apad=whole_dur=${seconds(bedDurationMs)}[key];` +
    `[bed][key]sidechaincompress=threshold=${DUCK_THRESHOLD}:ratio=${DUCK_RATIO}:` +
    `attack=${DUCK_ATTACK_MS}:release=${DUCK_RELEASE_MS}[duck];` +
    `[0:a][duck]amix=inputs=2:duration=longest:dropout_transition=0:normalize=0[mix]`
  );
}

/**
 * Ceiling for one audio pass. Each of these decodes or mixes at many times
 * real time, so a pass that is still running after two minutes is stuck (a
 * malformed input, a filter waiting on a stream that never ends) — and a stuck
 * ffmpeg would burn the whole render lease silently. Killed with a named error
 * instead, which the queue reports.
 */
export const AUDIO_PASS_TIMEOUT_MS = 120_000;

async function ffmpeg(ffmpegPath: string, args: readonly string[]): Promise<string> {
  try {
    const { stderr } = await run(ffmpegPath, [...args], {
      maxBuffer: 8 * 1024 * 1024,
      timeout: AUDIO_PASS_TIMEOUT_MS,
      killSignal: 'SIGKILL',
    });
    return stderr;
  } catch (error) {
    const killed =
      typeof error === 'object' && error !== null && 'killed' in error
        ? error.killed === true
        : false;
    if (killed) {
      throw new Error(
        `audio pass exceeded ${AUDIO_PASS_TIMEOUT_MS}ms and was killed; the render cannot continue`,
      );
    }
    throw error;
  }
}

/** Decodes any supported container to canonical 48k mono s16le WAV. */
export async function decodeToWav(
  ffmpegPath: string,
  inputPath: string,
  outputPath: string,
): Promise<void> {
  await ffmpeg(ffmpegPath, [
    ...ffmpegBaseArgs(),
    '-i',
    inputPath,
    '-ac',
    '1',
    '-ar',
    String(AUDIO_SAMPLE_RATE),
    '-c:a',
    'pcm_s16le',
    '-f',
    'wav',
    outputPath,
  ]);
}

/** The highlight's voice track: the windows, spliced, each end faded. */
export async function buildCutWav(
  ffmpegPath: string,
  inputPath: string,
  windows: readonly CutWindow[],
  outputPath: string,
): Promise<void> {
  if (windows.length === 0) {
    throw new Error('a cut needs at least one window');
  }
  await ffmpeg(ffmpegPath, [
    ...ffmpegBaseArgs(),
    '-i',
    inputPath,
    '-filter_complex',
    cutFilterGraph(windows),
    '-map',
    '[cut]',
    '-ac',
    '1',
    '-ar',
    String(AUDIO_SAMPLE_RATE),
    '-c:a',
    'pcm_s16le',
    '-f',
    'wav',
    outputPath,
  ]);
}

/** Overall RMS level in dBFS, as ffmpeg's own astats reports it. */
export async function measureRmsDb(ffmpegPath: string, inputPath: string): Promise<number> {
  const stderr = await ffmpeg(ffmpegPath, [
    '-y',
    '-hide_banner',
    '-loglevel',
    'info',
    ...BITEXACT,
    '-i',
    inputPath,
    '-af',
    'astats=metadata=0:reset=0',
    '-f',
    'null',
    '-',
  ]);
  const matches = [...stderr.matchAll(/RMS level dB:\s*(-?\d+(?:\.\d+)?|-inf)/g)];
  const last = matches.at(-1)?.[1];
  if (last === undefined || last === '-inf') {
    return Number.NEGATIVE_INFINITY;
  }
  const value = Number.parseFloat(last);
  return Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY;
}

/** Mixes the ducked bed under the voice. Both inputs must be WAV at 48k mono. */
export async function mixMusicBed(
  ffmpegPath: string,
  voiceWavPath: string,
  bedWavPath: string,
  outputPath: string,
  bedGainDb: number,
  bedDurationMs: number,
): Promise<void> {
  await ffmpeg(ffmpegPath, [
    ...ffmpegBaseArgs(),
    '-i',
    voiceWavPath,
    '-i',
    bedWavPath,
    '-filter_complex',
    musicMixGraph(bedGainDb, bedDurationMs),
    '-map',
    '[mix]',
    '-ac',
    '1',
    '-ar',
    String(AUDIO_SAMPLE_RATE),
    '-c:a',
    'pcm_s16le',
    '-f',
    'wav',
    '-threads',
    '2',
    outputPath,
  ]);
}

/**
 * The duration of a canonical WAV, read from its `data` chunk header.
 *
 * MEASURED, not computed. The truncation bug above was invisible for exactly as
 * long as this number came from arithmetic over the inputs; it now comes from
 * the file the encoder is about to read.
 */
export async function wavDurationMs(wavPath: string): Promise<number> {
  const samples = await readWavSamples(wavPath);
  return Math.round((samples.length * 1000) / AUDIO_SAMPLE_RATE);
}

/** The s16le samples of a canonical WAV, without a decode round trip. */
export async function readWavSamples(wavPath: string): Promise<Int16Array> {
  const bytes = await readFile(wavPath);
  // Walk the chunk list rather than assuming a 44-byte header: ffmpeg writes a
  // LIST chunk on some builds, and a fixed offset would read metadata as audio.
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const id = bytes.toString('ascii', offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'data') {
      const usable = Math.min(size, bytes.length - body) & ~1;
      const samples = new Int16Array(usable / 2);
      for (let index = 0; index < samples.length; index += 1) {
        samples[index] = bytes.readInt16LE(body + index * 2);
      }
      return samples;
    }
    offset = body + size + (size % 2);
  }
  return new Int16Array(0);
}

/**
 * Per-frame RMS, normalized to 0..1 and quantized to three decimals.
 *
 * Integer arithmetic throughout: the sum of squares of a frame's samples is an
 * exact integer well inside 2^53, so the envelope is the same on every machine
 * — which matters because it is a frame-signature input (§2.3).
 */
export function rmsEnvelope(
  samples: Int16Array,
  fps: number,
  frameCount: number,
): readonly number[] {
  const perFrame = Math.max(1, Math.round(AUDIO_SAMPLE_RATE / fps));
  const rms: number[] = [];
  for (let frame = 0; frame < frameCount; frame += 1) {
    const from = frame * perFrame;
    const to = Math.min(samples.length, from + perFrame);
    let sumSquares = 0;
    let count = 0;
    for (let index = from; index < to; index += 1) {
      const sample = samples[index] ?? 0;
      sumSquares += sample * sample;
      count += 1;
    }
    rms.push(count === 0 ? 0 : Math.floor(Math.sqrt(sumSquares / count)));
  }
  const peak = rms.reduce((max, value) => Math.max(max, value), 0);
  if (peak === 0) {
    return rms.map(() => 0);
  }
  return rms.map((value) => Math.round((value * 1000) / peak) / 1000);
}

export type RenderAudioInput = {
  readonly ffmpegPath: string;
  /** The stored voice asset, exactly as downloaded. */
  readonly sourcePath: string;
  /** Null for the full variant: the whole recording is used. */
  readonly windows: readonly CutWindow[] | null;
  readonly music: boolean;
  readonly template: 'warm' | 'hype';
  /** `cut_hash ?? scene_hash` (§2.6). */
  readonly seed: string;
  /** The appended end card, which the bed plays under. */
  readonly endCardMs: number;
  readonly fps: number;
  /** Output frames, for the envelope's resolution. */
  readonly frameCount: number;
  /** Deterministic work paths, derived from the render key by the caller. */
  readonly paths: {
    readonly cutWav: string;
    readonly bedWav: string;
    readonly mixWav: string;
  };
};

export type RenderAudioResult = {
  /** The file the encoder should read. */
  readonly path: string;
  /** True when the waveform was altered — the encoder must then re-encode. */
  readonly touched: boolean;
  /** Voice duration in the OUTPUT timeline (bed tail excluded). MEASURED. */
  readonly voiceMs: number;
  /** Total audio duration, bed tail included. MEASURED off the built file. */
  readonly durationMs: number;
  readonly envelope: readonly number[];
  /** Measured levels, reported for the render diagnostics. */
  readonly voiceRmsDb: number;
  readonly bedGainDb: number | null;
};

/**
 * Builds the MP4's audio track and measures it.
 *
 * The legacy path is preserved exactly: full variant, music off, and this is
 * never called — the caller hands the ORIGINAL file to the encoder and the
 * bit-for-bit copy still happens (encoderArgs.render.test.ts pins it).
 */
export async function buildRenderAudio(input: RenderAudioInput): Promise<RenderAudioResult> {
  const windows = input.windows;
  if (windows !== null && windows.length > 0) {
    await buildCutWav(input.ffmpegPath, input.sourcePath, windows, input.paths.cutWav);
  } else {
    await decodeToWav(input.ffmpegPath, input.sourcePath, input.paths.cutWav);
  }
  const voiceSamples = await readWavSamples(input.paths.cutWav);
  const voiceMs = Math.round((voiceSamples.length * 1000) / AUDIO_SAMPLE_RATE);
  const envelope = rmsEnvelope(voiceSamples, input.fps, input.frameCount);

  if (!input.music) {
    return {
      path: input.paths.cutWav,
      touched: true,
      voiceMs,
      durationMs: voiceMs,
      envelope,
      voiceRmsDb: await measureRmsDb(input.ffmpegPath, input.paths.cutWav),
      bedGainDb: null,
    };
  }

  // §2.2-6: the bed is exactly the cut plus the end card, so the video (which
  // is that same span, rounded UP to whole frames) can never end first.
  const bedMs = voiceMs + input.endCardMs;
  const bed = synthesizeMusicBed({
    seed: input.seed,
    template: input.template,
    durationMs: bedMs,
  });
  await writeFile(input.paths.bedWav, musicBedWav(bed));

  const voiceRmsDb = await measureRmsDb(input.ffmpegPath, input.paths.cutWav);
  const bedRmsDb = await measureRmsDb(input.ffmpegPath, input.paths.bedWav);
  // Place the bed relative to the MEASURED voice, not at a fixed gain: a quiet
  // recording must not end up under its own backing track.
  const target =
    Number.isFinite(voiceRmsDb) && Number.isFinite(bedRmsDb)
      ? voiceRmsDb - MUSIC_BED_BELOW_VOICE_DB - bedRmsDb
      : -MUSIC_BED_BELOW_VOICE_DB;
  // Rounded to 0.01 dB so the argv (and therefore the output) is reproducible.
  const bedGainDb = Math.round(target * 100) / 100;

  await mixMusicBed(
    input.ffmpegPath,
    input.paths.cutWav,
    input.paths.bedWav,
    input.paths.mixWav,
    bedGainDb,
    bedMs,
  );
  return {
    path: input.paths.mixWav,
    touched: true,
    voiceMs,
    // MEASURED off the mixed file: the bed plays under the end card and fades
    // out on it (§2.2-6), and this is the number the video-outlasts-audio
    // guard is checked against, so it may not be an estimate.
    durationMs: await wavDurationMs(input.paths.mixWav),
    envelope,
    voiceRmsDb,
    bedGainDb,
  };
}
