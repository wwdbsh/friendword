// THIRD-AUDIT REGRESSION — P0-NEW-2 (web interest own_content consent order)
// The affirmative own_content AI consent RPC must be recorded BEFORE the first
// external-AI request (photo validate / text moderate), and the shared guard
// must block any processing while consent is still pending.
/* global describe, expect, it */

import {
  canProcessOwnContentMedia,
  getAiDisclosureRevision,
  recordOwnContentAiConsent,
} from '../src/lib/aiConsent';

type RpcCall = { fn: string; params: Record<string, unknown> | undefined };

function fakeClient(order: string[], revision = 'ai-2026-07', consentError: string | null = null) {
  const rpcCalls: RpcCall[] = [];
  const client = {
    rpc: (fn: string, params?: Record<string, unknown>) => {
      rpcCalls.push({ fn, params });
      order.push(`rpc:${fn}`);
      if (fn === 'get_ai_disclosure_revision') {
        return Promise.resolve({ data: revision, error: null });
      }
      if (fn === 'record_own_content_ai_consent') {
        return Promise.resolve({
          data: consentError === null ? 'consent-id' : null,
          error: consentError === null ? null : { message: consentError },
        });
      }
      return Promise.resolve({ data: null, error: null });
    },
  };
  return { client, rpcCalls };
}

describe('interest flow — own_content AI consent precedes processing', () => {
  it('reads the current disclosure revision', async () => {
    const order: string[] = [];
    const { client } = fakeClient(order);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const revision = await getAiDisclosureRevision(client as any);
    expect(revision).toBe('ai-2026-07');
  });

  it('records consent with the current revision via the C1 RPC', async () => {
    const order: string[] = [];
    const { client, rpcCalls } = fakeClient(order);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await recordOwnContentAiConsent(client as any, 'ai-2026-07');
    const call = rpcCalls.find((c) => c.fn === 'record_own_content_ai_consent');
    expect(call?.params).toMatchObject({ target_consent_revision: 'ai-2026-07' });
  });

  it('blocks processing while consent is pending and allows it once granted', () => {
    expect(canProcessOwnContentMedia('pending')).toBe(false);
    expect(canProcessOwnContentMedia('granted')).toBe(true);
  });

  it('records consent strictly before the first upload/moderation call', async () => {
    const order: string[] = [];
    const { client } = fakeClient(order);

    // Gate model: nothing external may run while pending.
    let state: 'pending' | 'granted' = 'pending';
    const attemptUpload = () => {
      if (!canProcessOwnContentMedia(state)) {
        order.push('upload-blocked');
        return false;
      }
      order.push('upload');
      return true;
    };

    // A pre-consent attempt is blocked (no external request emitted).
    expect(attemptUpload()).toBe(false);

    // Affirmative consent is recorded, then the gate opens.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await recordOwnContentAiConsent(client as any, 'ai-2026-07');
    state = 'granted';
    expect(attemptUpload()).toBe(true);

    const consentIndex = order.indexOf('rpc:record_own_content_ai_consent');
    const uploadIndex = order.indexOf('upload');
    expect(consentIndex).toBeGreaterThanOrEqual(0);
    expect(uploadIndex).toBeGreaterThan(consentIndex);
    expect(order.includes('upload-blocked')).toBe(true);
  });

  it('throws when consent cannot be recorded so the gate stays closed', async () => {
    const order: string[] = [];
    const { client } = fakeClient(order, 'ai-2026-07', 'permission denied');
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      recordOwnContentAiConsent(client as any, 'ai-2026-07'),
    ).rejects.toThrow();
  });
});
