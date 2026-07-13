import { describe, expect, it } from 'vitest';

import { requestMediaValidation, type MediaValidationRequest } from './mediaValidation';

function requestWith(response: Response): MediaValidationRequest {
  return {
    accessToken: 'token',
    origin: 'https://friendword.test',
    send: async (url, init) => {
      expect(url).toBe('https://friendword.test/api/media/validate');
      expect(init.method).toBe('POST');
      return response;
    },
  };
}

describe('requestMediaValidation', () => {
  it('passes when the server confirms the object', async () => {
    const outcome = await requestMediaValidation(
      'draft-1/photo-1.jpg',
      requestWith(new Response(JSON.stringify({ ok: true }), { status: 200 })),
    );
    expect(outcome).toBe('passed');
  });

  it('rejects when the server flags the object', async () => {
    const outcome = await requestMediaValidation(
      'draft-1/photo-1.jpg',
      requestWith(new Response(JSON.stringify({ ok: false, magicOk: false }), { status: 200 })),
    );
    expect(outcome).toBe('rejected');
  });

  it('stays usable when validation is not configured (501)', async () => {
    const outcome = await requestMediaValidation(
      'draft-1/voice.m4a',
      requestWith(new Response(JSON.stringify({ error: 'not configured' }), { status: 501 })),
    );
    expect(outcome).toBe('unavailable');
  });

  it('treats network failures as unavailable, never as passed', async () => {
    const outcome = await requestMediaValidation('draft-1/photo-1.jpg', {
      accessToken: 'token',
      origin: 'https://friendword.test',
      send: async () => {
        throw new Error('offline');
      },
    });
    expect(outcome).toBe('unavailable');
  });
});
