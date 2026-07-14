export type TextModerationOutcome = 'passed' | 'flagged' | 'unavailable';

/**
 * Dater revision copy outcome (third audit P0-NEW-3). Adds `consent-required`
 * (the reserve gate answered 409) so ConsentFlow can re-open the AI disclosure
 * instead of silently proceeding. `unavailable` (501/502/429) still defers to
 * the DB revision gate, which fails closed while enforcement is on.
 */
export type DaterPitchModerationOutcome = 'passed' | 'flagged' | 'unavailable' | 'consent-required';

/**
 * Moderates the Dater's about-to-be-frozen revision copy. headline/body must be
 * the exact (trimmed) strings passed to create_dater_revision so the verdict is
 * recorded against the hash the DB gate checks. Returns before any revision is
 * cut so flagged copy blocks with an honest message.
 */
export async function requestDaterPitchModeration(
  draftId: string,
  headline: string,
  body: string,
  accessToken: string,
): Promise<DaterPitchModerationOutcome> {
  try {
    const response = await fetch('/api/moderate-text', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ kind: 'dater_pitch_content', draftId, headline, body }),
    });
    if (response.status === 409) {
      return 'consent-required';
    }
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
