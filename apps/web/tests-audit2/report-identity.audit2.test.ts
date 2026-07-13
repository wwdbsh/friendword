// AUDIT2 REGRESSION: P0-1, anonymous reporter identity must not be spoofable
// through client-controlled x-forwarded-for prefixes.
/* global describe, expect, it */

import { reporterIpFromForwardedHeader } from '../src/lib/reporterIdentity';

describe('anonymous reporter identity (proxy trust)', () => {
  it('uses the trusted proxy-appended last hop, not client prefixes', () => {
    const real = reporterIpFromForwardedHeader('203.0.113.7');
    const spoofedOnce = reporterIpFromForwardedHeader('1.1.1.1, 203.0.113.7');
    const spoofedTwice = reporterIpFromForwardedHeader('2.2.2.2, 9.9.9.9, 203.0.113.7');

    expect(spoofedOnce).toBe(real);
    expect(spoofedTwice).toBe(real);
  });

  it('distinguishes genuinely different peers', () => {
    expect(reporterIpFromForwardedHeader('1.1.1.1, 203.0.113.7')).not.toBe(
      reporterIpFromForwardedHeader('1.1.1.1, 198.51.100.9'),
    );
  });

  it('falls back to a stable unknown identity without the header', () => {
    expect(reporterIpFromForwardedHeader(null)).toBe('unknown');
    expect(reporterIpFromForwardedHeader('  ')).toBe('unknown');
  });
});
