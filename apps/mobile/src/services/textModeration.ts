export type TextModerationOutcome = 'passed' | 'flagged' | 'unavailable';

export type TextModerationRequest = {
  readonly accessToken: string;
  readonly origin: string;
  readonly send: (url: string, init: RequestInit) => Promise<Response>;
};

/**
 * Asks the web API to moderate the draft's current headline+body and
 * record a content-addressed verdict (second audit Slice 2). `flagged`
 * must block the consent submission with an honest message.
 * `unavailable` covers 501/offline: submissions stay possible while
 * media_validation_enforcement is off, and the DB gate (0026) takes over
 * once the switch turns on.
 */
export async function requestPitchTextModeration(
  serverDraftId: string,
  request?: TextModerationRequest,
): Promise<TextModerationOutcome> {
  try {
    let activeRequest = request;
    if (activeRequest === undefined) {
      const [{ getSupabaseClient }, { getWebOrigin }] = await Promise.all([
        import('./supabaseClient'),
        import('./webOrigin'),
      ]);
      const client = getSupabaseClient();
      if (client === null) {
        return 'unavailable';
      }
      const { data } = await client.auth.getSession();
      const accessToken = data.session?.access_token;
      if (accessToken === undefined) {
        return 'unavailable';
      }
      activeRequest = {
        accessToken,
        origin: getWebOrigin(),
        send: (url, init) => fetch(url, init),
      };
    }

    const response = await activeRequest.send(`${activeRequest.origin}/api/moderate-text`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${activeRequest.accessToken}`,
      },
      body: JSON.stringify({ kind: 'pitch_content', draftId: serverDraftId }),
    });
    if (!response.ok) {
      return 'unavailable';
    }
    const verdict: unknown = await response.json().catch(() => null);
    const passed =
      typeof verdict === 'object' && verdict !== null && 'ok' in verdict && verdict.ok === true;
    return passed ? 'passed' : 'flagged';
  } catch {
    return 'unavailable';
  }
}
