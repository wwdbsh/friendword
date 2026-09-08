// T002 (Issue #71) — the gate that stops a pitch going out under a name its
// owner never chose.
//
// `handle_new_auth_user` (0011) creates the profile with `display_name` set to
// the email local-part and `display_name_confirmed = false`. These tests pin
// the three decisions that follow from that: when to ask, what counts as a
// usable answer, and — the one that matters — that "saved" means the SERVER
// says so, not that the write did not throw.
import type { BrowserSupabaseClient } from '@friendword/data';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getDisplayNameStatus: vi.fn(),
  confirmDisplayName: vi.fn(),
}));

vi.mock('@friendword/data', () => ({
  getDisplayNameStatus: mocks.getDisplayNameStatus,
  confirmDisplayName: mocks.confirmDisplayName,
}));

import {
  confirmAndRecheckDisplayName,
  DISPLAY_NAME_MAX_LENGTH,
  readDisplayNameGate,
  validateDisplayName,
} from './displayNameConfirmation';

// Every data-layer call this module makes is mocked above, so the client is
// only ever passed through. `Object.create(null)` gives a value of the right
// type without asserting one onto an empty object literal.
const client: BrowserSupabaseClient = Object.create(null);

describe('what counts as a name', () => {
  it('rejects an empty field and a field of spaces', () => {
    expect(validateDisplayName('')).toBe('empty');
    expect(validateDisplayName('   ')).toBe('empty');
    expect(validateDisplayName('\n\t ')).toBe('empty');
  });

  // `profiles_display_name_length_check` (0025) is 60 characters. Checked here
  // so the refusal arrives in the field, not as an opaque database error in
  // the middle of sending a pitch.
  it('accepts exactly the database limit and rejects one character more', () => {
    expect(validateDisplayName('a'.repeat(DISPLAY_NAME_MAX_LENGTH))).toBe(null);
    expect(validateDisplayName('a'.repeat(DISPLAY_NAME_MAX_LENGTH + 1))).toBe('too_long');
  });

  it('measures the trimmed value, because that is what gets stored', () => {
    expect(validateDisplayName(`  ${'a'.repeat(DISPLAY_NAME_MAX_LENGTH)}  `)).toBe(null);
  });

  it('accepts an ordinary name', () => {
    expect(validateDisplayName('Drew Kim')).toBe(null);
  });
});

describe('deciding whether to ask', () => {
  it('asks when the account has never confirmed a name', async () => {
    mocks.getDisplayNameStatus.mockResolvedValue({ displayName: 'drew.kim92', confirmed: false });

    await expect(readDisplayNameGate(client)).resolves.toBe('needs_confirmation');
  });

  it('does not ask again once a name is confirmed', async () => {
    mocks.getDisplayNameStatus.mockResolvedValue({ displayName: 'Drew', confirmed: true });

    await expect(readDisplayNameGate(client)).resolves.toBe('confirmed');
  });

  // Fails OPEN, deliberately. The public surfaces already withhold an
  // unconfirmed name on their own (0061 and `publicDisplayName`), so a failed
  // profile read must not become a reason somebody cannot send their pitch.
  it('does not block the submit when there is no server configured', async () => {
    mocks.getDisplayNameStatus.mockClear();

    await expect(readDisplayNameGate(null)).resolves.toBe('unavailable');
    expect(mocks.getDisplayNameStatus).not.toHaveBeenCalled();
  });

  it('does not block the submit when the profile read fails', async () => {
    mocks.getDisplayNameStatus.mockRejectedValue(new Error('offline'));

    await expect(readDisplayNameGate(client)).resolves.toBe('unavailable');
  });
});

describe('saving the chosen name', () => {
  it('writes the trimmed name and then believes only the re-read', async () => {
    mocks.confirmDisplayName.mockReset();
    mocks.confirmDisplayName.mockResolvedValue(undefined);
    mocks.getDisplayNameStatus.mockResolvedValue({ displayName: 'Drew Kim', confirmed: true });

    await expect(confirmAndRecheckDisplayName(client, '  Drew Kim  ')).resolves.toBe('confirmed');
    expect(mocks.confirmDisplayName).toHaveBeenCalledWith(client, 'Drew Kim');
  });

  // The write resolving is not evidence the account changed. If the re-read
  // still says unconfirmed, the caller must not carry on and send the pitch.
  it('reports needs_confirmation when the write did not take', async () => {
    mocks.confirmDisplayName.mockResolvedValue(undefined);
    mocks.getDisplayNameStatus.mockResolvedValue({ displayName: 'drew.kim92', confirmed: false });

    await expect(confirmAndRecheckDisplayName(client, 'Drew')).resolves.toBe('needs_confirmation');
  });

  it('lets a failed write surface rather than reporting success', async () => {
    mocks.confirmDisplayName.mockRejectedValue(new Error('network'));

    await expect(confirmAndRecheckDisplayName(client, 'Drew')).rejects.toThrow('network');
  });
});
