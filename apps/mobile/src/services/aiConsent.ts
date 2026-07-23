import { getSupabaseClient } from './supabaseClient';

export class AiConsentRequiredError extends Error {
  override readonly name = 'AiConsentRequiredError';

  constructor() {
    super('External AI processing consent is required before creating this draft.');
  }
}

export class AiConsentPersistenceError extends Error {
  override readonly name = 'AiConsentPersistenceError';

  constructor(action: 'check' | 'record' | 'revision') {
    super(
      action === 'check'
        ? 'AI processing consent could not be checked. Please try again.'
        : action === 'record'
          ? 'AI processing consent could not be recorded. No AI request was started.'
          : 'The AI disclosure revision could not be read. No AI request was started.',
    );
  }
}

export type AiConsentPersistence = {
  /** Server-authoritative disclosure revision the introducer must affirm. */
  currentRevision(): Promise<string>;
  hasConsent(draftId: string, revision: string): Promise<boolean>;
  recordConsent(draftId: string, revision: string): Promise<void>;
};

export type AiConsentService = {
  disclosureRevision(): Promise<string>;
  hasConsent(draftId: string, revision: string): Promise<boolean>;
  recordConsent(draftId: string, revision: string): Promise<void>;
  hasCurrentConsent(draftId: string): Promise<boolean>;
};

export function createAiConsentService(persistence: AiConsentPersistence): AiConsentService {
  return {
    disclosureRevision: () => persistence.currentRevision(),
    hasConsent: (draftId, revision) => persistence.hasConsent(draftId, revision),
    recordConsent: (draftId, revision) => persistence.recordConsent(draftId, revision),
    hasCurrentConsent: async (draftId) =>
      persistence.hasConsent(draftId, await persistence.currentRevision()),
  };
}

/**
 * `get_ai_disclosure_revision` and any future consent RPCs that the generated
 * database types do not yet describe are called through this narrow, untyped
 * shim. The revision is server-authoritative (second/third audit): the client
 * must never assume a compiled-in constant, so a missing RPC fails closed.
 */
type UntypedRpc = (
  name: string,
  args?: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message?: string } | null }>;

const supabasePersistence: AiConsentPersistence = {
  currentRevision: async () => {
    const client = getSupabaseClient();
    if (client === null) {
      throw new AiConsentPersistenceError('revision');
    }
    // bind: supabase-js rpc() reads this.rest, so a bare extraction loses `this`.
    const rpc = client.rpc.bind(client) as unknown as UntypedRpc;
    const { data, error } = await rpc('get_ai_disclosure_revision');
    if (error !== null || typeof data !== 'string' || data.trim() === '') {
      throw new AiConsentPersistenceError('revision');
    }
    return data;
  },
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

const aiConsent = createAiConsentService(supabasePersistence);

export const getAiDisclosureRevision = aiConsent.disclosureRevision;
export const hasAiProcessingConsent = aiConsent.hasConsent;
export const recordAiProcessingConsent = aiConsent.recordConsent;
export const hasCurrentAiProcessingConsent = aiConsent.hasCurrentConsent;
