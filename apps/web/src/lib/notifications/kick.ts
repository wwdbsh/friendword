import type { BrowserSupabaseClient } from '@friendword/data';

/**
 * Client-side, best-effort push of the notification sender after the caller
 * has just CAUSED a notifiable event (an interest submitted, an inbox
 * decision). The browser never holds FRIENDWORD_NOTIFY_SECRET, so this goes
 * through /api/notifications/kick, which relays with the secret — the same
 * split as the render kick.
 *
 * The kick carries no job data and chooses no entry: the sender claims from
 * the queue under its own gates. A failure here changes nothing — the entry
 * stays queued for the next kick or the daily backstop — so it never surfaces
 * to the user and never blocks the flow that called it.
 */
export async function kickNotificationSender(client: BrowserSupabaseClient): Promise<void> {
  try {
    const { data, error } = await client.auth.getSession();
    const accessToken = data.session?.access_token;
    if (error !== null || accessToken === undefined) {
      return;
    }
    await fetch('/api/notifications/kick', {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}` },
    });
  } catch {
    // Best-effort by design.
  }
}
