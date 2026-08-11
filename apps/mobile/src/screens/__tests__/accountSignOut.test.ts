// SIGN OUT, THE LOCAL HALF — T008 / Issue #45.
//
// Sign-out and account deletion share a screen and end the same session, and
// that is exactly why they are easy to merge by accident. Deletion erases every
// draft this phone holds along with its voice recordings and photos
// (`eraseAllLocalDrafts`); sign-out must not, because the same person signing
// back in expects their unfinished pitch to still be there. This suite pins
// that difference as behaviour: the draft service is mocked with spies, and
// `endSession` must leave every one of them untouched.
import { describe, expect, it, vi } from 'vitest';

const drafts = vi.hoisted(() => ({
  eraseAllLocalDrafts: vi.fn(() => Promise.resolve({ complete: true })),
  purgeAllConsentTokens: vi.fn(() => Promise.resolve(0)),
  listMyDrafts: vi.fn(() => Promise.resolve({ drafts: [], sync: 'local' })),
}));

vi.mock('@friendword/data', () => ({
  SafetyRepo: class {},
  UnauthenticatedError: class extends Error {},
  getSession: vi.fn(),
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
vi.mock('expo-router', () => ({
  useFocusEffect: vi.fn(),
  useRouter: () => ({ replace: vi.fn() }),
}));
vi.mock('react-native', () => ({
  ScrollView: () => null,
  StyleSheet: { create: (styles: object) => styles },
  Text: () => null,
  TextInput: () => null,
  View: () => null,
}));
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: () => null }));
vi.mock('../../components', () => ({
  HypeButton: () => null,
  SignInPromptCard: () => null,
  TrustCard: () => null,
}));
vi.mock('../../features/auth/SignInSheet', () => ({ SignInSheet: () => null }));
vi.mock('../../services/draftServiceInstance', () => ({ pitchDraftService: drafts }));
vi.mock('../../services/supabaseClient', () => ({ getSupabaseClient: () => null }));

import { endSession } from '../../../app/account/index';

/** A client whose sign-out answers however the test needs it to. */
function clientThat(answer: () => Promise<{ readonly error: unknown }>) {
  const signOut = vi.fn(answer);
  return { client: { auth: { signOut } }, signOut };
}

describe('ending the session', () => {
  it('signs out exactly once and reports it', async () => {
    const { client, signOut } = clientThat(() => Promise.resolve({ error: null }));

    await expect(endSession(client)).resolves.toBe('signed_out');
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it('reports a refusal rather than pretending the session ended', async () => {
    const { client } = clientThat(() => Promise.resolve({ error: new Error('network') }));

    await expect(endSession(client)).resolves.toBe('failed');
  });

  it('survives a client that throws instead of answering', async () => {
    const { client } = clientThat(() => Promise.reject(new Error('offline')));

    await expect(endSession(client)).resolves.toBe('failed');
  });

  // A build with no Supabase configuration never had a session to end, and must
  // not report one as ended.
  it('separates "no client" from "sign-out failed"', async () => {
    await expect(endSession(null)).resolves.toBe('unconfigured');
  });
});

describe('sign-out and the pitches saved on this phone', () => {
  // The regression this exists for: routing sign-out through `closeLocally`
  // (the deletion helper) would erase the local drafts, their voice recordings
  // and their photos from a phone whose owner is simply logging out.
  it('does not erase, purge, or otherwise touch the local drafts', async () => {
    drafts.eraseAllLocalDrafts.mockClear();
    drafts.purgeAllConsentTokens.mockClear();
    drafts.listMyDrafts.mockClear();
    const { client } = clientThat(() => Promise.resolve({ error: null }));

    await expect(endSession(client)).resolves.toBe('signed_out');

    expect(drafts.eraseAllLocalDrafts).not.toHaveBeenCalled();
    expect(drafts.listMyDrafts).not.toHaveBeenCalled();
    // Not here either — the consent tokens are purged by the root layout off
    // the SIGNED_OUT event, for every sign-out in the app rather than only the
    // one this screen performs.
    expect(drafts.purgeAllConsentTokens).not.toHaveBeenCalled();
  });

  it('leaves them alone even when the sign-out fails', async () => {
    drafts.eraseAllLocalDrafts.mockClear();
    const { client } = clientThat(() => Promise.reject(new Error('offline')));

    await expect(endSession(client)).resolves.toBe('failed');

    expect(drafts.eraseAllLocalDrafts).not.toHaveBeenCalled();
  });
});
