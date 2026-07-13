import { AI_PROCESSING_CONSENT_REVISION } from '@friendword/config';

import { getSupabaseClient } from './supabaseClient';

export class AiConsentRequiredError extends Error {
  override readonly name = 'AiConsentRequiredError';

  constructor() {
    super('External AI processing consent is required before creating this draft.');
  }
}

export class AiConsentPersistenceError extends Error {
  override readonly name = 'AiConsentPersistenceError';

  constructor(action: 'check' | 'record') {
    super(
      action === 'check'
        ? 'AI processing consent could not be checked. Please try again.'
        : 'AI processing consent could not be recorded. No AI request was started.',
    );
  }
}

export type AiConsentPersistence = {
  hasConsent(draftId: string, revision: string): Promise<boolean>;
  recordConsent(draftId: string, revision: string): Promise<void>;
};

export type AiConsentService = {
  hasCurrentConsent(draftId: string): Promise<boolean>;
  recordCurrentConsent(draftId: string): Promise<void>;
  requireCurrentConsent(draftId: string): Promise<void>;
};

export function createAiConsentService(
  persistence: AiConsentPersistence,
  revision = AI_PROCESSING_CONSENT_REVISION,
): AiConsentService {
  return {
    hasCurrentConsent: (draftId) => persistence.hasConsent(draftId, revision),
    recordCurrentConsent: (draftId) => persistence.recordConsent(draftId, revision),
    requireCurrentConsent: async (draftId) => {
      if (!(await persistence.hasConsent(draftId, revision))) {
        throw new AiConsentRequiredError();
      }
    },
  };
}

const supabasePersistence: AiConsentPersistence = {
  hasConsent: async (draftId, revision) => {
    const client = getSupabaseClient();
    if (client === null) {
      throw new AiConsentPersistenceError('check');
    }
    const { data, error } = await client
      .from('ai_processing_consents')
      .select('id')
      .eq('pitch_draft_id', draftId)
      .eq('consent_revision', revision)
      .limit(1);
    if (error !== null) {
      throw new AiConsentPersistenceError('check');
    }
    return data.length > 0;
  },
  recordConsent: async (draftId, revision) => {
    const client = getSupabaseClient();
    if (client === null) {
      throw new AiConsentPersistenceError('record');
    }
    const { error } = await client.rpc('record_ai_processing_consent', {
      target_draft_id: draftId,
      target_consent_revision: revision,
    });
    if (error !== null) {
      throw new AiConsentPersistenceError('record');
    }
  },
};

const currentAiConsent = createAiConsentService(supabasePersistence);

export const hasCurrentAiProcessingConsent = currentAiConsent.hasCurrentConsent;
export const recordCurrentAiProcessingConsent = currentAiConsent.recordCurrentConsent;
export const requireCurrentAiProcessingConsent = currentAiConsent.requireCurrentConsent;
