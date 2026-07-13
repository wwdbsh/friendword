/**
 * Reporter identity for anonymous reports (second audit P0-1). A client
 * can prepend arbitrary entries to x-forwarded-for, but the trusted
 * proxy in front of this route always APPENDS the real peer address, so
 * only the last entry is identity-bearing. Never trust client-supplied
 * prefixes: they would let one attacker mint unlimited "distinct"
 * reporters and auto-pause a healthy campaign.
 */
export function reporterIpFromForwardedHeader(forwardedFor: string | null): string {
  const entries = (forwardedFor ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
  return entries.at(-1) ?? 'unknown';
}
