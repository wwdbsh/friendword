import { describe, expect, it } from 'vitest';

import { publicDisplayName } from './displayName';

describe('publicDisplayName', () => {
  it('returns the name once its owner has confirmed it', () => {
    expect(publicDisplayName({ display_name: 'Maya', display_name_confirmed: true })).toBe('Maya');
  });

  // The exact state `handle_new_auth_user` (0011) leaves a fresh account in.
  it('withholds an unconfirmed email-derived placeholder', () => {
    expect(publicDisplayName({ display_name: 'maya.park92', display_name_confirmed: false })).toBe(
      null,
    );
  });

  it('withholds a confirmed-but-blank name rather than printing whitespace', () => {
    expect(publicDisplayName({ display_name: '   ', display_name_confirmed: true })).toBe(null);
  });

  it('treats a missing profile row as no name', () => {
    expect(publicDisplayName(undefined)).toBe(null);
    expect(publicDisplayName(null)).toBe(null);
  });
});
