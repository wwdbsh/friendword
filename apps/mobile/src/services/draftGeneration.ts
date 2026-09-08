export type DraftGenerationResult = { readonly kind: 'generated' | 'not_configured' };

export class DraftGenerationError extends Error {
  /**
   * Machine-readable `code` from the server's error body, when it sent one.
   * T001: the transcribe route distinguishes its 422s this way, so the app can
   * tell "we could not hear you" from any other unprocessable response.
   */
  constructor(
    readonly status: number | null,
    readonly code: string | null = null,
  ) {
    super('We could not create the AI draft. Check your connection and try again.');
    this.name = 'DraftGenerationError';
  }
}

export type DraftGenerationRequest = {
  readonly accessToken: string;
  readonly origin: string;
  readonly send: (url: string, init: RequestInit) => Promise<Response>;
};

/**
 * Reads the server's machine-readable error code without ever letting a
 * non-JSON or truncated error body turn into a different (misleading) failure.
 */
async function readErrorCode(response: Response): Promise<string | null> {
  try {
    const body: unknown = await response.json();
    if (typeof body === 'object' && body !== null) {
      const code = (body as { readonly code?: unknown }).code;
      return typeof code === 'string' ? code : null;
    }
    return null;
  } catch {
    return null;
  }
}

export async function requestDraftGeneration(
  serverDraftId: string,
  request?: DraftGenerationRequest,
): Promise<DraftGenerationResult> {
  try {
    let activeRequest = request;
    if (activeRequest === undefined) {
      const [{ getSupabaseClient }, { getWebOrigin }] = await Promise.all([
        import('./supabaseClient'),
        import('./webOrigin'),
      ]);
      const client = getSupabaseClient();
      if (client === null) {
        return { kind: 'not_configured' };
      }
      const { data } = await client.auth.getSession();
      const accessToken = data.session?.access_token;
      if (accessToken === undefined) {
        throw new DraftGenerationError(401);
      }
      activeRequest = { accessToken, origin: getWebOrigin(), send: fetch };
    }

    const response = await activeRequest.send(`${activeRequest.origin}/api/transcribe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${activeRequest.accessToken}`,
      },
      body: JSON.stringify({ draftId: serverDraftId }),
    });
    if (response.status === 501) {
      return { kind: 'not_configured' };
    }
    if (!response.ok) {
      throw new DraftGenerationError(response.status, await readErrorCode(response));
    }
    return { kind: 'generated' };
  } catch (error: unknown) {
    if (error instanceof DraftGenerationError) {
      throw error;
    }
    throw new DraftGenerationError(null);
  }
}
