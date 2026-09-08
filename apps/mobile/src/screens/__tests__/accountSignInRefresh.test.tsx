// M-2 (T004, Issue #73) — the account screen after a sign-in that happened ON it.
//
// The session read runs from `useFocusEffect`, and a sheet mounted on this
// screen never re-focuses it. Simulator QA signed in twice and both times the
// screen kept showing "Sign in to manage your account" behind a live session,
// until they navigated away and came back. The fix is not a re-render: it is
// asking the server again, which is what this suite pins.
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderStatic } from '../../testing/renderStatic';

const data = vi.hoisted(() => ({
  getSession: vi.fn(() => Promise.resolve(null)),
  getDisplayNameStatus: vi.fn(() => Promise.resolve({ displayName: 'Drew', confirmed: true })),
  confirmDisplayName: vi.fn(() => Promise.resolve()),
}));

type SheetProps = { readonly purpose: string; onClose(): void; onSignedIn(): void };

/** The sheet is a stub that hands its props back so the test can fire them. */
const sheet: { props: SheetProps | null } = vi.hoisted(() => ({ props: null }));

vi.mock('@friendword/data', () => ({
  SafetyRepo: class {
    readAccountStatus = () => Promise.resolve('active');
    requestAccountDeletion = () => Promise.resolve();
  },
  UnauthenticatedError: class extends Error {},
  getSession: data.getSession,
  getDisplayNameStatus: data.getDisplayNameStatus,
  confirmDisplayName: data.confirmDisplayName,
}));
vi.mock('@friendword/ui-tokens', () => ({
  colors: {
    background: '',
    borderMuted: '',
    danger: '',
    ink: '',
    pop: '',
    surface: '',
    textFaint: '',
    textSecondary: '',
  },
  fonts: { body: '', display: '' },
  fontSizes: { xs: 1, sm: 1, md: 1, lg: 1, xl: 1 },
  radii: { sm: 1, md: 1 },
  spacing: { xs: 1, sm: 1, md: 1, lg: 1, xxl: 1 },
  strokes: { trust: 1 },
}));
// Focus never fires under a static render, which is exactly the situation the
// defect lives in: the only session read this screen gets is the one it asks
// for itself.
vi.mock('expo-router', () => ({
  useFocusEffect: vi.fn(),
  useRouter: () => ({ replace: vi.fn() }),
}));
// The containers have to keep their children: the sign-in sheet is mounted
// inside them, and a stub that drops children would hide the very prop this
// suite fires.
vi.mock('react-native', async () => {
  const { createElement } = await import('react');
  const box = ({ children }: { readonly children?: ReactNode }) =>
    createElement('div', null, children);
  return {
    ScrollView: box,
    StyleSheet: { create: (styles: object) => styles },
    Text: box,
    TextInput: () => null,
    View: box,
  };
});
vi.mock('react-native-safe-area-context', async () => {
  const { createElement } = await import('react');
  return {
    SafeAreaView: ({ children }: { readonly children?: ReactNode }) =>
      createElement('div', null, children),
  };
});
vi.mock('../../components', () => ({
  HypeButton: () => null,
  PendingCard: () => null,
  ScreenHeading: () => null,
  SignInPromptCard: () => null,
  TrustCard: () => null,
}));
vi.mock('../../features/auth/SignInSheet', () => ({
  SignInSheet: (props: SheetProps) => {
    sheet.props = props;
    return null;
  },
}));
vi.mock('../../features/auth/DisplayNameSheet', () => ({ DisplayNameSheet: () => null }));
vi.mock('../../services/draftServiceInstance', () => ({
  pitchDraftService: { eraseAllLocalDrafts: vi.fn(() => Promise.resolve({ complete: true })) },
}));
vi.mock('../../services/supabaseClient', () => ({
  getSupabaseClient: () => ({ auth: { signOut: () => Promise.resolve({ error: null }) } }),
}));

import AccountScreen from '../../../app/account/index';

function mountScreen(): SheetProps {
  sheet.props = null;
  data.getSession.mockClear();
  renderStatic(<AccountScreen />);
  const props = sheet.props;
  if (props === null) {
    throw new Error('the account screen did not mount its sign-in sheet');
  }
  return props;
}

describe('the account screen after signing in on it', () => {
  it('reads the session again instead of waiting for the next focus', () => {
    const props = mountScreen();

    expect(data.getSession).not.toHaveBeenCalled();

    props.onSignedIn();

    expect(data.getSession).toHaveBeenCalledTimes(1);
  });

  it('does not re-read anything when the sheet is merely dismissed', () => {
    const props = mountScreen();

    props.onClose();

    expect(data.getSession).not.toHaveBeenCalled();
  });

  // M-1: the sheet this screen opens is not the one that sends a pitch.
  it('opens the sheet in its account context', () => {
    expect(mountScreen().purpose).toBe('account');
  });
});
