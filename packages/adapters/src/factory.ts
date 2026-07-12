import { z } from 'zod';

import { MockIdentityVerificationProvider } from './mockIdentityVerification';
import { MockModerationProvider } from './mockModeration';
import { MockPitchStructureProvider } from './mockPitchStructure';
import { MockTranscriptionProvider } from './mockTranscription';
import type { Providers } from './types';

const providerEnvSchema = z.object({
  FRIENDWORD_PROVIDER_MODE: z.enum(['mock', 'real']),
  MOCK_PROVIDER_DELAY_MS: z.coerce.number().int().min(0).default(0),
});

export type ProviderEnv = Readonly<Record<string, string | undefined>>;

export class ProviderNotImplementedError extends Error {
  override readonly name = 'ProviderNotImplementedError';

  constructor() {
    super('not implemented');
  }
}

export function createProviders(env: ProviderEnv): Providers {
  const parsedEnv = providerEnvSchema.parse(env);
  if (parsedEnv.FRIENDWORD_PROVIDER_MODE === 'real') {
    throw new ProviderNotImplementedError();
  }

  const options = { delayMs: parsedEnv.MOCK_PROVIDER_DELAY_MS };
  return {
    transcription: new MockTranscriptionProvider(options),
    pitchStructure: new MockPitchStructureProvider(options),
    identityVerification: new MockIdentityVerificationProvider(options),
    moderation: new MockModerationProvider(options),
  };
}
