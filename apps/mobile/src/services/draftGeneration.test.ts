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

function requestWithBody(status: number, body: string): DraftGenerationRequest {
  return {
    accessToken: 'test-access-token',
    origin: 'https://friendword.example',
    send: async () => new Response(body, { status }),
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

  // T001 (issue #70): the app has to tell "we could not hear you" apart from
  // every other 422, and it may only trust a code the server actually sent.
  it('carries the server error code for an insufficient-speech refusal', async () => {
    await expect(
      requestDraftGeneration(
        '10000000-0000-4000-8000-000000000001',
        requestWithBody(
          422,
          JSON.stringify({
            error: 'insufficient speech',
            code: 'insufficient_speech',
            reason: 'no_words',
          }),
        ),
      ),
    ).rejects.toEqual(
      expect.objectContaining<Partial<DraftGenerationError>>({
        status: 422,
        code: 'insufficient_speech',
      }),
    );
  });

  it('leaves the code null when the error body carries none or is not JSON', async () => {
    await expect(
      requestDraftGeneration(
        '10000000-0000-4000-8000-000000000001',
        requestWithBody(422, 'gateway timeout'),
      ),
    ).rejects.toEqual(
      expect.objectContaining<Partial<DraftGenerationError>>({ status: 422, code: null }),
    );
    await expect(
      requestDraftGeneration('10000000-0000-4000-8000-000000000001', requestWithStatus(500)),
    ).rejects.toEqual(expect.objectContaining<Partial<DraftGenerationError>>({ code: null }));
  });
});
