import { getSupabaseClient } from './supabaseClient';
import { getWebOrigin } from './webOrigin';

/**
 * Fire-and-forget request to the web API that turns the uploaded voice note
 * into the structured draft (headline/body). Failures are silent: the pitch
 * flow already succeeded, and the server responds 501 until the OpenAI key
 * is configured.
 */
export async function requestDraftGeneration(serverDraftId: string): Promise<void> {
  const client = getSupabaseClient();
  if (client === null) {
    return;
  }

  try {
    const { data } = await client.auth.getSession();
    const accessToken = data.session?.access_token;
    if (accessToken === undefined) {
      return;
    }

    await fetch(`${getWebOrigin()}/api/transcribe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ draftId: serverDraftId }),
    });
  } catch {
    // Draft generation is best-effort; the consent flow works without it.
  }
}
