import type { BrowserSupabaseClient } from '@friendword/data';

/**
 * own_content AI disclosure + consent (third audit P0-NEW-2).
 *
 * The Interested person's photos and text are sent to an external AI provider
 * (OpenAI) for safety review. That transfer must be preceded by an affirmative,
 * current-revision consent — never the reverse. These helpers wrap the C1 RPCs
 * `get_ai_disclosure_revision()` (anon/authenticated) and
 * `record_own_content_ai_consent(revision)` (authenticated).
 *
 * The RPCs land in migration 0035 (`supabase/**`) and are regenerated into
 * `packages/data` at integration time; this layer owns only `apps/web/**` and
 * cannot edit the generated types, so the calls go through a deliberately loose
 * adapter and are asserted by the audit3 tests.
 */
type LooseRpc = (
  fn: string,
  params?: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: { readonly message?: string | null } | null }>;

function looseRpc(client: BrowserSupabaseClient): LooseRpc {
  return client.rpc.bind(client) as unknown as LooseRpc;
}

export const AI_DISCLOSURE_COPY =
  'To keep everyone safe, your photos and note are sent to an external AI provider (OpenAI) for a safety review before {daterName} ever sees them. Uploading only reaches Friendword’s storage — nothing goes to the AI until you agree here.';

export const AI_CONSENT_REQUIRED_COPY =
  'Expressing interest needs a safety review of your photos and note, so we can’t continue without your agreement.';

/** One-time gate state for the Interested media flow. */
export type OwnContentConsentState = 'pending' | 'granted';

/**
 * The single guard both the photo upload and the text-moderation submit read:
 * no external-AI processing may start until own_content consent is granted.
 */
export function canProcessOwnContentMedia(state: OwnContentConsentState): boolean {
  return state === 'granted';
}

export async function getAiDisclosureRevision(
  client: BrowserSupabaseClient,
): Promise<string | null> {
  const { data, error } = await looseRpc(client)('get_ai_disclosure_revision');
  if (error !== null) {
    return null;
  }
  return typeof data === 'string' && data !== '' ? data : null;
}

/**
 * Records affirmative own_content consent for the current disclosure revision.
 * Idempotent server-side (returns the existing/created consent id). Throws on
 * failure so the caller can keep the gate closed and never begin processing.
 */
export async function recordOwnContentAiConsent(
  client: BrowserSupabaseClient,
  revision: string,
): Promise<void> {
  const { error } = await looseRpc(client)('record_own_content_ai_consent', {
    target_consent_revision: revision,
  });
  if (error !== null) {
    throw new Error(error.message ?? 'consent record failed');
  }
}
