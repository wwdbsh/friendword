import { simulateDelay } from './delay';
import type {
  AudioInput,
  MockProviderOptions,
  TranscriptionProvider,
  TranscriptionResult,
  TranscriptWord,
} from './types';

/** Three decimals, which is the precision the real provider reports (A7). */
function toSeconds(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * Word timings the real provider would return for this text: an even split of
 * the recording, in the same seconds unit as the segments. Deterministic so the
 * mock stays comparable across repeated calls.
 */
function evenWordTimings(text: string, durationMs: number): readonly TranscriptWord[] {
  const words = text.split(/\s+/).filter((word) => word !== '');
  const totalSeconds = durationMs / 1000;
  return words.map((word, index) => ({
    start: toSeconds((index * totalSeconds) / words.length),
    end: toSeconds(((index + 1) * totalSeconds) / words.length),
    word,
  }));
}

export class MockTranscriptionProvider implements TranscriptionProvider {
  readonly #options: MockProviderOptions;

  constructor(options: MockProviderOptions = {}) {
    this.#options = options;
  }

  async transcribe(audio: AudioInput): Promise<TranscriptionResult> {
    await simulateDelay(this.#options);

    const text = `A ${audio.durationMs}ms introduction recorded at ${audio.uri}.`;
    return {
      text,
      language: 'en',
      segments: [{ start: 0, end: audio.durationMs / 1000, text }],
      words: evenWordTimings(text, audio.durationMs),
    };
  }
}
