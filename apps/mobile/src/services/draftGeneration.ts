export type DraftGenerationResult = { readonly kind: 'generated' | 'not_configured' };

export class DraftGenerationError extends Error {
  constructor(readonly status: number | null) {
    super('We could not create the AI draft. Check your connection and try again.');
    this.name = 'DraftGenerationError';
  }
}

export type DraftGenerationRequest = {
  readonly accessToken: string;
  readonly origin: string;
  readonly send: (url: string, init: RequestInit) => Promise<Response>;
};

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
      throw new DraftGenerationError(response.status);
    }
    return { kind: 'generated' };
  } catch (error: unknown) {
    if (error instanceof DraftGenerationError) {
      throw error;
    }
    throw new DraftGenerationError(null);
  }
}
