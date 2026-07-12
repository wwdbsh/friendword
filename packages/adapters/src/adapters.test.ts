import { afterEach, describe, expect, it, vi } from 'vitest';

import { createProviders, ProviderNotImplementedError } from './factory';
import { MockIdentityVerificationProvider } from './mockIdentityVerification';
import { MockModerationProvider } from './mockModeration';
import { MockPitchStructureProvider } from './mockPitchStructure';
import { MockTranscriptionProvider } from './mockTranscription';

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
