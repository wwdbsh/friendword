export type TextModerationOutcome = 'passed' | 'flagged' | 'unavailable';

/**
 * Client-side companion of /api/moderate-text (second audit Slice 2).
 * `flagged` must block the flow with an honest message. `unavailable`
 * (501/offline) defers to the DB gate, which fails closed while
 * media_validation_enforcement is on.
 */
export async function requestTextModeration(
  kind: 'profile_bio' | 'interest_note',
  text: string,
  accessToken: string,
): Promise<TextModerationOutcome> {
  if (text.trim() === '') {
    return 'passed';
  }
  try {
    const response = await fetch('/api/moderate-text', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ kind, text }),
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
