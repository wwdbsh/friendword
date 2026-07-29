import { afterEach, describe, expect, it, vi } from 'vitest';

import { createProviders, ProviderNotImplementedError } from './factory';
import { MockIdentityVerificationProvider } from './mockIdentityVerification';
import { MockModerationProvider } from './mockModeration';
import { MockPitchStructureProvider } from './mockPitchStructure';
import { MockTranscriptionProvider } from './mockTranscription';
import { OpenAiTranscriptionProvider } from './openAi';

describe('mock providers', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns deterministic transcription when audio input is repeated', async () => {
    const provider = new MockTranscriptionProvider();
    const audio = { uri: 'file:///pitch.m4a', durationMs: 12_000 };

    const first = await provider.transcribe(audio);
    const second = await provider.transcribe(audio);

    expect(first).toEqual(second);
    expect(first.text).toContain(audio.uri);
  });

  it('reports word timings alongside the segment, in the same seconds unit', async () => {
    const provider = new MockTranscriptionProvider();

    const result = await provider.transcribe({ uri: 'file:///pitch.m4a', durationMs: 12_000 });

    const words = result.words ?? [];
    expect(words.length).toBeGreaterThan(1);
    expect(words[0]?.start).toBe(0);
    expect(words.at(-1)?.end).toBe(12);
    expect(words.map((word) => word.word).join(' ')).toBe(result.text);
  });

  it('waits for the configured simulated delay when one is provided', async () => {
    vi.useFakeTimers();
    const provider = new MockTranscriptionProvider({ delayMs: 25 });
    const pending = provider.transcribe({ uri: 'file:///pitch.m4a', durationMs: 1_000 });
    let resolved = false;
    void pending.then(() => {
      resolved = true;
    });

    await vi.advanceTimersByTimeAsync(24);
    expect(resolved).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(resolved).toBe(true);
  });

  it('structures transcript content with exactly three qualities and flagged claims', async () => {
    const provider = new MockPitchStructureProvider();

    const result = await provider.structure(
      'Mina is kind, curious, and reliable. She always makes time for her friends.',
      { relationshipType: 'friend', relationshipDuration: 'y3to10' },
    );

    expect(result.three_specific_qualities).toEqual(['kind', 'curious', 'reliable']);
    expect(result.hard_claims_requiring_confirmation).toEqual([
      'She always makes time for her friends',
    ]);
  });

  it('returns status only from deterministic identity verification results', async () => {
    const provider = new MockIdentityVerificationProvider();

    const started = await provider.startLivenessCheck('user-1');
    const result = await provider.getResult(started.reference);

    expect(started.reference).toBe('mock-liveness:user-1');
    expect(result).toEqual({ status: 'verified' });
  });

  it('classifies matching text and image categories deterministically', async () => {
    const provider = new MockModerationProvider();

    const textResult = await provider.checkText('I hate this stupid message.');
    const imageResult = await provider.checkImage('pitch-media/draft/explicit-photo.jpg');

    expect(textResult).toEqual({ allowed: false, categories: ['harassment'] });
    expect(imageResult).toEqual({ allowed: false, categories: ['explicit'] });
  });
});

describe('OpenAiTranscriptionProvider', () => {
  const realFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  /**
   * Captures the transcription request and answers it with `payload`. The first
   * call is the provider downloading the signed audio URL.
   */
  function installFetch(payload: unknown): { current: FormData | null } {
    const captured: { current: FormData | null } = { current: null };
    globalThis.fetch = (async (
      input: unknown,
      init?: { readonly body?: unknown },
    ): Promise<Response> => {
      if (String(input) === 'https://storage.test/voice.m4a') {
        return new Response('audio-bytes', { status: 200 });
      }
      captured.current = init?.body as FormData;
      return Response.json(payload);
    }) as unknown as typeof fetch;
    return captured;
  }

  it('requests word AND segment granularities as repeated bracketed form fields', async () => {
    // A7: the OpenAI multipart contract names the array parameter
    // `timestamp_granularities[]` and reads one repeated field per element.
    // Asking for 'word' alone drops `segments` from the response, and captions
    // and scene boundaries are both derived from segments.
    const captured = installFetch({ text: 'Hello there.', language: 'en', segments: [] });
    const provider = new OpenAiTranscriptionProvider('test-key');

    await provider.transcribe({ uri: 'https://storage.test/voice.m4a', durationMs: 4_000 });

    const form = captured.current;
    if (form === null) {
      throw new Error('The transcription request carried no form body');
    }
    expect(form.getAll('timestamp_granularities[]')).toEqual(['word', 'segment']);
    expect(form.get('response_format')).toBe('verbose_json');
    expect(form.get('model')).toBe('whisper-1');
  });

  it('keeps the word timings the response carries', async () => {
    const captured = installFetch({
      text: 'Hello there.',
      language: 'en',
      segments: [{ start: 0, end: 1.5, text: 'Hello there.' }],
      words: [
        { start: 0, end: 0.4, word: ' Hello ' },
        { start: 0.4, end: 1.5, word: 'there' },
        { start: 1.5, end: 1.6, word: '   ' },
        { start: 1.6, word: 'dropped' },
      ],
    });
    const provider = new OpenAiTranscriptionProvider('test-key');

    const result = await provider.transcribe({
      uri: 'https://storage.test/voice.m4a',
      durationMs: 1_600,
    });

    expect(captured.current).not.toBeNull();
    expect(result.words).toEqual([
      { start: 0, end: 0.4, word: 'Hello' },
      { start: 0.4, end: 1.5, word: 'there' },
    ]);
    expect(result.segments).toEqual([{ start: 0, end: 1.5, text: 'Hello there.' }]);
  });
});

describe('createProviders', () => {
  it('creates mock providers when mock mode is configured', () => {
    const providers = createProviders({ FRIENDWORD_PROVIDER_MODE: 'mock' });

    expect(providers.transcription).toBeInstanceOf(MockTranscriptionProvider);
    expect(providers.pitchStructure).toBeInstanceOf(MockPitchStructureProvider);
  });

  it('fails closed when provider mode is missing', () => {
    expect(() => createProviders({})).toThrow();
  });

  it('throws a typed not-implemented error when real providers are selected', () => {
    expect(() => createProviders({ FRIENDWORD_PROVIDER_MODE: 'real' })).toThrow(
      ProviderNotImplementedError,
    );
    expect(() => createProviders({ FRIENDWORD_PROVIDER_MODE: 'real' })).toThrow('not implemented');
  });
});
