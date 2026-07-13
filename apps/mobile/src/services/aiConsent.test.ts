import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getSupabaseClient: vi.fn() }));

vi.mock('@friendword/config', () => ({
  AI_PROCESSING_CONSENT_REVISION: '2026-07-13.v1',
}));
vi.mock('./supabaseClient', () => ({ getSupabaseClient: mocks.getSupabaseClient }));

import {
  AiConsentRequiredError,
  createAiConsentService,
  hasCurrentAiProcessingConsent,
  recordCurrentAiProcessingConsent,
  type AiConsentPersistence,
} from './aiConsent';

const DRAFT_ID = '10000000-0000-4000-8000-000000000001';

describe('AI processing consent revision', () => {
  it('skips disclosure only when the stored revision matches the current revision', async () => {
    const hasConsent = vi.fn(async (_draftId: string, revision: string) => revision === 'v1');
    const persistence: AiConsentPersistence = {
      hasConsent,
      recordConsent: vi.fn().mockResolvedValue(undefined),
    };

    await expect(
      createAiConsentService(persistence, 'v1').hasCurrentConsent(DRAFT_ID),
    ).resolves.toBe(true);
    await expect(
      createAiConsentService(persistence, 'v2').requireCurrentConsent(DRAFT_ID),
    ).rejects.toBeInstanceOf(AiConsentRequiredError);
    expect(hasConsent).toHaveBeenLastCalledWith(DRAFT_ID, 'v2');
  });

  it('records the exact current disclosure revision', async () => {
    const recordConsent = vi.fn().mockResolvedValue(undefined);
    const persistence: AiConsentPersistence = {
      hasConsent: vi.fn().mockResolvedValue(false),
      recordConsent,
    };

    await createAiConsentService(persistence, 'v2').recordCurrentConsent(DRAFT_ID);

    expect(recordConsent).toHaveBeenCalledWith(DRAFT_ID, 'v2');
  });

  it('uses the deployed table and RPC contracts for the current revision', async () => {
    const limit = vi.fn().mockResolvedValue({ data: [{ id: 'consent-id' }], error: null });
    const revisionEq = vi.fn(() => ({ limit }));
    const draftEq = vi.fn(() => ({ eq: revisionEq }));
    const rpc = vi.fn().mockResolvedValue({ data: 'consent-id', error: null });
    mocks.getSupabaseClient.mockReturnValue({
      from: vi.fn(() => ({ select: vi.fn(() => ({ eq: draftEq })) })),
      rpc,
    });

    await expect(hasCurrentAiProcessingConsent(DRAFT_ID)).resolves.toBe(true);
    await recordCurrentAiProcessingConsent(DRAFT_ID);

    expect(draftEq).toHaveBeenCalledWith('pitch_draft_id', DRAFT_ID);
    expect(revisionEq).toHaveBeenCalledWith('consent_revision', '2026-07-13.v1');
    expect(rpc).toHaveBeenCalledWith('record_ai_processing_consent', {
      target_draft_id: DRAFT_ID,
      target_consent_revision: '2026-07-13.v1',
    });
  });
});
