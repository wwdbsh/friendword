import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { toIsoInstant } from './pitchDraftsSupabase';

// The bug this file guards is only observable off UTC, so the device zone is
// pinned rather than inherited from whatever machine runs the suite.
const DEVICE_TIME_ZONE = 'Asia/Seoul';

describe('server timestamp normalization', () => {
  let originalTimeZone: string | undefined;

  beforeAll(() => {
    originalTimeZone = process.env.TZ;
    process.env.TZ = DEVICE_TIME_ZONE;
  });

  afterAll(() => {
    process.env.TZ = originalTimeZone;
  });

  it('reads an offsetless server timestamp as UTC, not as device-local time', () => {
    // A Postgres `timestamp` column or a computed RPC field arrives without an
    // offset. Interpreting it in the device zone would silently move the
    // instant nine hours on this device.
    expect(toIsoInstant('2026-07-29T10:39:45.309123')).toBe('2026-07-29T10:39:45.309Z');
  });

  it('normalizes the PostgREST timestamptz rendering', () => {
    expect(toIsoInstant('2026-07-29T10:39:45.3091+00:00')).toBe('2026-07-29T10:39:45.309Z');
  });

  it('shifts a non-UTC offset to the UTC instant', () => {
    expect(toIsoInstant('2026-07-29T19:39:45.309123+09:00')).toBe('2026-07-29T10:39:45.309Z');
  });

  it('accepts the offset spellings Postgres can emit', () => {
    expect(toIsoInstant('2026-07-29T19:39:45+09')).toBe('2026-07-29T10:39:45.000Z');
    expect(toIsoInstant('2026-07-29T19:39:45+0900')).toBe('2026-07-29T10:39:45.000Z');
    expect(toIsoInstant('2026-07-29 10:39:45.5Z')).toBe('2026-07-29T10:39:45.500Z');
  });

  it('pads and truncates the fraction to the millisecond width local drafts use', () => {
    // Local drafts are stamped with `new Date().toISOString()`, and
    // `syncServerReview` compares the two lexicographically, so both sides have
    // to carry exactly three fractional digits.
    expect(toIsoInstant('2026-07-29T10:39:45.5+00:00')).toBe('2026-07-29T10:39:45.500Z');
    expect(toIsoInstant('2026-07-29T10:39:45.309999+00:00')).toBe('2026-07-29T10:39:45.309Z');
  });

  it('passes an unparseable value through for the schema to report', () => {
    expect(toIsoInstant('not a timestamp')).toBe('not a timestamp');
  });
});
