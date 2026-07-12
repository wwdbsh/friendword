import { simulateDelay } from './delay';
import type {
  IdentityVerificationProvider,
  IdentityVerificationResult,
  LivenessCheckReference,
  MockProviderOptions,
} from './types';

const MOCK_REFERENCE_PREFIX = 'mock-liveness:';

export class MockIdentityVerificationProvider implements IdentityVerificationProvider {
  readonly #options: MockProviderOptions;

  constructor(options: MockProviderOptions = {}) {
    this.#options = options;
  }

  async startLivenessCheck(userId: string): Promise<LivenessCheckReference> {
    await simulateDelay(this.#options);
    return { reference: `${MOCK_REFERENCE_PREFIX}${userId}` };
  }

  async getResult(reference: string): Promise<IdentityVerificationResult> {
    await simulateDelay(this.#options);
    return { status: reference.startsWith(MOCK_REFERENCE_PREFIX) ? 'verified' : 'failed' };
  }
}
