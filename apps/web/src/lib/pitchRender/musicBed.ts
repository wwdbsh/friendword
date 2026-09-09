// §2.6 — the music bed, synthesized here rather than licensed.
//
// Three reasons this is generated and not a file:
//   1. Rights. A bed we compute from a seed has no licensor, no attribution
//      requirement and no takedown risk on a platform that scans audio.
//   2. Determinism. `cut_hash` (or the scene hash) is the seed, so the same
//      approved pitch always gets the same bed, and the PCM hash the render
//      determinism test compares is stable.
//   3. Size. Nothing is shipped or fetched at render time (P3).
//
// It is deliberately plain — a slow pad under a voice, mixed 20 dB down and
// ducked further while the voice speaks (§2.2-3). It is not a song and must
// never compete with the Introducer's recording.
//
// Determinism note: the oscillators run on an INTEGER phase accumulator against
// an integer sine table, so no float accumulates across 48,000 samples per
// second. The table itself is rounded to whole Int16 values at module load,
// which collapses any last-bit difference between platform `Math.sin`
// implementations before it can reach a sample.

export const MUSIC_SAMPLE_RATE = 48_000;
/** §2.6: the bed fades out over its last 1.5s, always. */
export const MUSIC_FADE_OUT_MS = 1_500;
/** §2.6 tempi, one per approved template. */
export const MUSIC_BPM: Readonly<Record<'warm' | 'hype', number>> = { warm: 84, hype: 104 };
/** §2.6: a four-bar loop, repeated. */
export const MUSIC_LOOP_BARS = 4;
const BEATS_PER_BAR = 4;

/** Peak amplitude of the raw bed. The mix stage sets the real level. */
const PAD_PEAK = 6_000;
const KICK_PEAK = 5_000;

const TABLE_BITS = 10;
const TABLE_SIZE = 1 << TABLE_BITS;
const PHASE_FRACTION_BITS = 16;

/** Int16 sine, one cycle. Integers only — see the determinism note above. */
const SINE_TABLE: readonly number[] = Array.from({ length: TABLE_SIZE }, (_unused, index) =>
  Math.round(Math.sin((2 * Math.PI * index) / TABLE_SIZE) * 32_767),
);

/**
 * Four fixed progressions, as semitone offsets above the root, one triad per
 * bar. The seed picks the progression; it never invents intervals, so every
 * possible bed is one of four known-consonant loops.
 */
const CHORD_SETS: readonly (readonly (readonly number[])[])[] = [
  [
    [0, 7, 12],
    [5, 12, 17],
    [8, 15, 20],
    [3, 10, 15],
  ],
  [
    [0, 7, 16],
    [7, 14, 23],
    [5, 12, 21],
    [3, 10, 19],
  ],
  [
    [0, 5, 12],
    [3, 10, 15],
    [7, 12, 19],
    [0, 7, 12],
  ],
  [
    [0, 7, 15],
    [8, 15, 24],
    [5, 12, 20],
    [10, 17, 22],
  ],
];

/** A2. Low enough to sit under speech without masking it. */
const ROOT_MIDI = 45;

/**
 * The rest of what the seed chooses. The bed is deliberately a FINITE family —
 * four progressions x four roots x four rotations x eight detunes = 512 beds —
 * rather than a free parameter space: every member is one we can reason about,
 * and none of them can come out dissonant. Different seeds therefore usually,
 * but not provably, differ; the render only needs "same seed, same bed", which
 * is what `cut_hash` identity depends on.
 */
const ROOT_OFFSETS: readonly number[] = [0, 2, -3, 5];
const MAX_DETUNE_CENTS = 8;

/** A 32-bit seed from a sha256 hex string (or any text), fold-hashed. */
export function musicSeedFromHash(hash: string): number {
  let seed = 0x811c9dc5;
  for (let index = 0; index < hash.length; index += 1) {
    seed = (seed ^ hash.charCodeAt(index)) >>> 0;
    seed = Math.imul(seed, 0x01000193) >>> 0;
  }
  return seed >>> 0;
}

/** Fixed-point phase increment for a MIDI note, rounded once to an integer. */
function phaseIncrement(midi: number, detuneCents: number): number {
  const frequency = 440 * Math.pow(2, (midi - 69) / 12 + detuneCents / 1200);
  return Math.round((frequency * TABLE_SIZE * (1 << PHASE_FRACTION_BITS)) / MUSIC_SAMPLE_RATE);
}

function sineAt(phase: number): number {
  return SINE_TABLE[(phase >>> PHASE_FRACTION_BITS) & (TABLE_SIZE - 1)] ?? 0;
}

/** Integer triangle over the same phase space, for the pad's second voice. */
function triangleAt(phase: number): number {
  const position = (phase >>> PHASE_FRACTION_BITS) & (TABLE_SIZE - 1);
  const quarter = TABLE_SIZE >> 2;
  const ramp = position < TABLE_SIZE / 2 ? position - quarter : TABLE_SIZE / 2 + quarter - position;
  return Math.round((ramp * 32_767) / quarter);
}

export type MusicBedInput = {
  /** `cut_hash ?? scene_hash` (§2.6). Any stable text works. */
  readonly seed: string;
  readonly template: 'warm' | 'hype';
  /** Exactly the cut total plus the end card (§2.2-6). */
  readonly durationMs: number;
};

/**
 * The bed as signed 16-bit mono PCM at 48 kHz. Pure: same input, same samples,
 * on every machine (musicBed.render.test.ts pins that with a hash).
 */
export function synthesizeMusicBed(input: MusicBedInput): Int16Array {
  const totalSamples = Math.max(1, Math.round((input.durationMs * MUSIC_SAMPLE_RATE) / 1000));
  const samples = new Int16Array(totalSamples);
  const seed = musicSeedFromHash(input.seed);
  const progression = CHORD_SETS[seed % CHORD_SETS.length] ?? CHORD_SETS[0];
  if (progression === undefined) {
    return samples;
  }
  // Separate bit ranges, so two seeds that agree on the progression still tend
  // to disagree on the key, the bar order and the detune.
  const rootOffset = ROOT_OFFSETS[(seed >>> 8) % ROOT_OFFSETS.length] ?? 0;
  const rotation = (seed >>> 16) % MUSIC_LOOP_BARS;
  const detuneCents = (seed >>> 24) % MAX_DETUNE_CENTS;
  const chords = Array.from(
    { length: MUSIC_LOOP_BARS },
    (_unused, bar) => progression[(bar + rotation) % progression.length] ?? [],
  );
  const bpm = MUSIC_BPM[input.template];
  const samplesPerBeat = Math.round((60 * MUSIC_SAMPLE_RATE) / bpm);
  const samplesPerBar = samplesPerBeat * BEATS_PER_BAR;
  const loopSamples = samplesPerBar * MUSIC_LOOP_BARS;

  // Phase increments are the only floating-point arithmetic in the synth, and
  // they depend on (bar, note) alone — never on the sample. Computed once here
  // rather than 48,000 times a second: the samples are identical either way
  // (the increment is rounded to an integer before any sample uses it), and a
  // 60s bed stops paying for ~8.6M Math.pow calls.
  const incrementsByBar = chords.map((chord) =>
    chord.map((semitone) => phaseIncrement(ROOT_MIDI + rootOffset + semitone, detuneCents)),
  );
  const kickIncrement = phaseIncrement(ROOT_MIDI - 12, 0);

  // One phase accumulator per (bar, voice, note): the loop restarts the phase
  // every four bars, which is what makes the tail of the loop join its head
  // without a click.
  for (let index = 0; index < totalSamples; index += 1) {
    const loopPosition = index % loopSamples;
    const barIndex = Math.floor(loopPosition / samplesPerBar) % MUSIC_LOOP_BARS;
    const barPosition = loopPosition % samplesPerBar;
    const chord = chords[barIndex] ?? chords[0] ?? [];

    // Bar envelope: a fifth of the bar to swell in, a fifth to fall away.
    const rampSamples = Math.max(1, Math.floor(samplesPerBar / 5));
    const envelope =
      barPosition < rampSamples
        ? Math.floor((barPosition * 1024) / rampSamples)
        : barPosition > samplesPerBar - rampSamples
          ? Math.floor(((samplesPerBar - barPosition) * 1024) / rampSamples)
          : 1024;

    let value = 0;
    const increments = incrementsByBar[barIndex] ?? [];
    for (let note = 0; note < chord.length; note += 1) {
      const increment = increments[note] ?? 0;
      const phase = (loopPosition * increment) >>> 0;
      // Sine carries the body, triangle a quieter edge so the pad is audible
      // through a phone speaker without being bright.
      value += sineAt(phase) + (triangleAt(phase) >> 2);
    }
    const voices = Math.max(1, chord.length) * 2;
    let sample = Math.round((value * PAD_PEAK * envelope) / (voices * 32_767 * 1024));

    if (input.template === 'hype') {
      // A soft kick on beats 1 and 3 — felt, not heard over speech.
      const beatPosition = barPosition % samplesPerBeat;
      const beatIndex = Math.floor(barPosition / samplesPerBeat);
      const kickSamples = Math.floor(MUSIC_SAMPLE_RATE / 8);
      if ((beatIndex === 0 || beatIndex === 2) && beatPosition < kickSamples) {
        const decay = Math.floor(((kickSamples - beatPosition) * 1024) / kickSamples);
        const kickPhase = (beatPosition * kickIncrement) >>> 0;
        sample += Math.round(
          (sineAt(kickPhase) * KICK_PEAK * decay * decay) / (32_767 * 1024 * 1024),
        );
      }
    }

    samples[index] = Math.max(-32_768, Math.min(32_767, sample));
  }

  // §2.6: the last 1.5s fades to silence, so the bed never stops abruptly at
  // the end card cut.
  const fadeSamples = Math.min(
    totalSamples,
    Math.round((MUSIC_FADE_OUT_MS * MUSIC_SAMPLE_RATE) / 1000),
  );
  for (let index = 0; index < fadeSamples; index += 1) {
    const position = totalSamples - fadeSamples + index;
    // (index + 1) so the LAST sample of the fade is exactly silence.
    const gain = 1024 - Math.floor(((index + 1) * 1024) / fadeSamples);
    samples[position] = Math.round(((samples[position] ?? 0) * gain) / 1024);
  }
  return samples;
}

/** A canonical 16-bit mono WAV container around the samples. */
export function musicBedWav(samples: Int16Array): Uint8Array {
  const dataBytes = samples.length * 2;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(MUSIC_SAMPLE_RATE, 24);
  buffer.writeUInt32LE(MUSIC_SAMPLE_RATE * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataBytes, 40);
  for (let index = 0; index < samples.length; index += 1) {
    buffer.writeInt16LE(samples[index] ?? 0, 44 + index * 2);
  }
  return new Uint8Array(buffer);
}
