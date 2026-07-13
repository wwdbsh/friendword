import { describe, expect, it } from 'vitest';

import {
  DraftGenerationError,
  requestDraftGeneration,
  type DraftGenerationRequest,
} from './draftGeneration';

function requestWithStatus(status: number): DraftGenerationRequest {
  return {
    accessToken: 'test-access-token',
    origin: 'https://friendword.example',
    send: async () => new Response('{}', { status }),
  };
}

describe('draft generation request', () => {
  it('opens the honest direct-writing fallback when the API returns 501', async () => {
    await expect(
      requestDraftGeneration('10000000-0000-4000-8000-000000000001', requestWithStatus(501)),
    ).resolves.toEqual({ kind: 'not_configured' });
  });

  it('returns generated only after the API succeeds', async () => {
    await expect(
      requestDraftGeneration('10000000-0000-4000-8000-000000000001', requestWithStatus(200)),
    ).resolves.toEqual({ kind: 'generated' });
  });

  it('keeps retryable API failures visible to the caller', async () => {
    await expect(
      requestDraftGeneration('10000000-0000-4000-8000-000000000001', requestWithStatus(502)),
    ).rejects.toEqual(expect.objectContaining<Partial<DraftGenerationError>>({ status: 502 }));
  });
});
