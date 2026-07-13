import { simulateDelay } from './delay';
import type {
  AudioInput,
  MockProviderOptions,
  TranscriptionProvider,
  TranscriptionResult,
} from './types';

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
    };
  }
}
