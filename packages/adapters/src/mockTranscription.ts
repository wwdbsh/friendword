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

    return {
      text: `A ${audio.durationMs}ms introduction recorded at ${audio.uri}.`,
      language: 'en',
    };
  }
}
