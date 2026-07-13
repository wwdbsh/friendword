export type MediaValidationOutcome = 'passed' | 'rejected' | 'unavailable';

export type MediaValidationRequest = {
  readonly accessToken: string;
  readonly origin: string;
  readonly send: (url: string, init: RequestInit) => Promise<Response>;
};

/**
 * Asks the web API to re-read an uploaded pitch object and record a
 * server-authoritative verdict (audit P0-5). `rejected` means the server
 * confirmed the content is not an allowed media type — the caller must
 * surface it. `unavailable` covers 501/offline: uploads stay usable while
 * media_validation_enforcement is off, and the server gate takes over once
 * the switch turns on.
 */
export async function requestMediaValidation(
  objectName: string,
  request?: MediaValidationRequest,
): Promise<MediaValidationOutcome> {
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

    const response = await activeRequest.send(`${activeRequest.origin}/api/media/validate`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${activeRequest.accessToken}`,
      },
      body: JSON.stringify({ bucket: 'pitch-media', objectName }),
    });
    if (response.status === 501) {
      return 'unavailable';
    }
    if (!response.ok) {
      return 'unavailable';
    }
    const verdict: unknown = await response.json().catch(() => null);
    const passed =
      typeof verdict === 'object' && verdict !== null && 'ok' in verdict && verdict.ok === true;
    return passed ? 'passed' : 'rejected';
  } catch {
    return 'unavailable';
  }
}
