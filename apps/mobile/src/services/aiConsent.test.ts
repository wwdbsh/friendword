import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getSupabaseClient: vi.fn() }));

vi.mock('./supabaseClient', () => ({ getSupabaseClient: mocks.getSupabaseClient }));

import {
  AiConsentPersistenceError,
  createAiConsentService,
  getAiDisclosureRevision,
  hasAiProcessingConsent,
  hasCurrentAiProcessingConsent,
  recordAiProcessingConsent,
  type AiConsentPersistence,
} from './aiConsent';

const DRAFT_ID = '10000000-0000-4000-8000-000000000001';

describe('AI processing consent revision', () => {
  it('checks and records consent against the exact revision it is given', async () => {
    const hasConsent = vi.fn(async (_draftId: string, revision: string) => revision === 'v1');
    const recordConsent = vi.fn().mockResolvedValue(undefined);
    const service = createAiConsentService({
      currentRevision: vi.fn().mockResolvedValue('v1'),
      hasConsent,
      recordConsent,
    });

    await expect(service.hasConsent(DRAFT_ID, 'v1')).resolves.toBe(true);
    await expect(service.hasConsent(DRAFT_ID, 'v2')).resolves.toBe(false);
    await service.recordConsent(DRAFT_ID, 'v2');

    expect(recordConsent).toHaveBeenCalledWith(DRAFT_ID, 'v2');
  });

  it('resolves the current-consent shortcut against the server-reported revision', async () => {
    const hasConsent = vi.fn(
      async (_draftId: string, revision: string) => revision === 'server-rev',
    );
    const persistence: AiConsentPersistence = {
      currentRevision: vi.fn().mockResolvedValue('server-rev'),
      hasConsent,
      recordConsent: vi.fn().mockResolvedValue(undefined),
    };

    await expect(createAiConsentService(persistence).hasCurrentConsent(DRAFT_ID)).resolves.toBe(
      true,
    );
    expect(hasConsent).toHaveBeenLastCalledWith(DRAFT_ID, 'server-rev');
  });

  it('reads the current revision from the server RPC, never from a hard-coded constant', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: '2026-07-14.v2', error: null });
    mocks.getSupabaseClient.mockReturnValue({ rpc });

    await expect(getAiDisclosureRevision()).resolves.toBe('2026-07-14.v2');
    expect(rpc).toHaveBeenCalledWith('get_ai_disclosure_revision');
  });

  it('fails closed when the server cannot return a revision', async () => {
    mocks.getSupabaseClient.mockReturnValue({
      rpc: vi.fn().mockResolvedValue({ data: null, error: { message: 'boom' } }),
    });

    await expect(getAiDisclosureRevision()).rejects.toBeInstanceOf(AiConsentPersistenceError);
  });

  it('uses the deployed table and RPC contracts for the given revision', async () => {
    const limit = vi.fn().mockResolvedValue({ data: [{ id: 'consent-id' }], error: null });
    const revisionEq = vi.fn(() => ({ limit }));
    const draftEq = vi.fn(() => ({ eq: revisionEq }));
    const rpc = vi.fn().mockResolvedValue({ data: 'consent-id', error: null });
    mocks.getSupabaseClient.mockReturnValue({
      from: vi.fn(() => ({ select: vi.fn(() => ({ eq: draftEq })) })),
      rpc,
    });

    await expect(hasAiProcessingConsent(DRAFT_ID, '2026-07-14.v2')).resolves.toBe(true);
    await recordAiProcessingConsent(DRAFT_ID, '2026-07-14.v2');

    expect(draftEq).toHaveBeenCalledWith('pitch_draft_id', DRAFT_ID);
    expect(revisionEq).toHaveBeenCalledWith('consent_revision', '2026-07-14.v2');
    expect(rpc).toHaveBeenCalledWith('record_ai_processing_consent', {
      target_draft_id: DRAFT_ID,
      target_consent_revision: '2026-07-14.v2',
    });
  });

  it('resolves the current-consent shortcut end to end from the server revision', async () => {
    const limit = vi.fn().mockResolvedValue({ data: [], error: null });
    const revisionEq = vi.fn(() => ({ limit }));
    const draftEq = vi.fn(() => ({ eq: revisionEq }));
    mocks.getSupabaseClient.mockReturnValue({
      from: vi.fn(() => ({ select: vi.fn(() => ({ eq: draftEq })) })),
      rpc: vi.fn().mockResolvedValue({ data: 'server-rev', error: null }),
    });

    await expect(hasCurrentAiProcessingConsent(DRAFT_ID)).resolves.toBe(false);
    expect(revisionEq).toHaveBeenCalledWith('consent_revision', 'server-rev');
  });
});
