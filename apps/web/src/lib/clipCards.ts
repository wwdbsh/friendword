/**
 * Consent-surface view of one uploaded clip, as /api/media/clip-ingest-state
 * reports it (Phase 3a): where the ingest pipeline stands, how long the source
 * ran, and — only after every automated check passed — short-lived URLs for the
 * poster and the SILENT proxy. Nothing here can include or exclude a clip or
 * touch a face; those are Phase 3b.
 */
export type ClipIngestCard = {
  readonly state: 'pending' | 'processing' | 'succeeded' | 'flagged' | 'failed';
  readonly durationMs: number | null;
  readonly posterUrl: string | null;
  readonly proxyUrl: string | null;
};

const CLIP_STATES = ['pending', 'processing', 'succeeded', 'flagged', 'failed'] as const;

function asCard(value: unknown): ClipIngestCard | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const state = CLIP_STATES.find((candidate) => candidate === record.state);
  if (state === undefined) {
    return null;
  }
  return {
    state,
    durationMs: typeof record.durationMs === 'number' ? record.durationMs : null,
    posterUrl: typeof record.posterUrl === 'string' ? record.posterUrl : null,
    proxyUrl: typeof record.proxyUrl === 'string' ? record.proxyUrl : null,
  };
}

/**
 * Reads clip cards for a draft's uploaded clip objects. Anything that is not a
 * well-formed answer — offline, a 4xx, a malformed body — is an absent entry,
 * never a made-up state: an unreachable server can neither fake progress nor
 * fake a pass (mirrors the mobile requestClipIngestStates contract).
 */
export async function requestClipIngestCards(
  draftId: string,
  objectNames: readonly string[],
  accessToken: string,
): Promise<ReadonlyMap<string, ClipIngestCard>> {
  const empty = new Map<string, ClipIngestCard>();
  if (objectNames.length === 0) {
    return empty;
  }
  try {
    const response = await fetch('/api/media/clip-ingest-state', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ bucket: 'pitch-media', draftId, objectNames: [...objectNames] }),
    });
    if (!response.ok) {
      return empty;
    }
    const body: unknown = await response.json().catch(() => null);
    if (typeof body !== 'object' || body === null || !('clips' in body)) {
      return empty;
    }
    const clips: unknown = (body as { readonly clips: unknown }).clips;
    if (typeof clips !== 'object' || clips === null) {
      return empty;
    }
    const cards = new Map<string, ClipIngestCard>();
    for (const objectName of objectNames) {
      const card = asCard((clips as Record<string, unknown>)[objectName]);
      if (card !== null) {
        cards.set(objectName, card);
      }
    }
    return cards;
  } catch {
    return empty;
  }
}
