import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const renderModule: unknown = require('react-dom/server');
const renderToStaticMarkup = getRenderToStaticMarkup(renderModule);

function getRenderToStaticMarkup(value: unknown): (node: ReactNode) => string {
  if (typeof value !== 'object' || value === null || !('renderToStaticMarkup' in value)) {
    throw new Error('react-dom/server renderer is unavailable');
  }
  const renderer = value.renderToStaticMarkup;
  if (typeof renderer !== 'function') {
    throw new Error('react-dom/server renderer is invalid');
  }
  return (node) => {
    const markup: unknown = renderer(node);
    if (typeof markup !== 'string') {
      throw new Error('react-dom/server returned non-string markup');
    }
    return markup;
  };
}

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
vi.mock('react-native', async () => {
  const { createElement } = await import('react');
  return {
    ScrollView: ({ children }: { readonly children?: ReactNode }) =>
      createElement('main', null, children),
    StyleSheet: { create: (styles: object) => styles },
    Text: ({ children }: { readonly children?: ReactNode }) =>
      createElement('span', null, children),
    TextInput: ({
      accessibilityLabel,
      editable,
      value,
    }: {
      readonly accessibilityLabel: string;
      readonly editable?: boolean;
      readonly value: string;
    }) =>
      createElement('input', {
        'aria-label': accessibilityLabel,
        disabled: editable === false,
        readOnly: true,
        value,
      }),
    View: ({ children }: { readonly children?: ReactNode }) => createElement('div', null, children),
  };
});
vi.mock('react-native-safe-area-context', async () => {
  const { createElement } = await import('react');
  return {
    SafeAreaView: ({ children }: { readonly children?: ReactNode }) =>
      createElement('section', null, children),
  };
});
vi.mock('../../components', async () => {
  const { createElement } = await import('react');
  return {
    // `secondary` is rendered as a data attribute so a test can assert that
    // sign-out is NOT dressed as the destructive control next to it. It is
    // emitted only when set, so the existing exact-markup assertions on the
    // primary buttons keep matching.
    HypeButton: ({
      label,
      disabled = false,
      secondary = false,
    }: {
      readonly label: string;
      readonly onPress: () => void;
      readonly disabled?: boolean;
      readonly secondary?: boolean;
      readonly variant?: string;
    }) =>
      createElement(
        'button',
        secondary ? { disabled, 'data-secondary': 'true' } : { disabled },
        label,
      ),
    SignInPromptCard: ({ title }: { readonly title: string; readonly onSignIn: () => void }) =>
      createElement('article', null, createElement('span', null, title)),
    // The tone is what visually separates leaving from being erased, so it has
    // to survive into the markup for the test that pins the difference.
    TrustCard: ({
      children,
      tone = 'neutral',
    }: {
      readonly children?: ReactNode;
      readonly tone?: string;
    }) => createElement('article', { 'data-tone': tone }, children),
  };
});
vi.mock('../../features/auth/SignInSheet', () => ({ SignInSheet: () => null }));
vi.mock('../../services/draftServiceInstance', () => ({ pitchDraftService: {} }));
vi.mock('../../services/supabaseClient', () => ({ getSupabaseClient: () => null }));

import {
  ACCOUNT_DELETION_FACTS,
  AccountContent,
  DELETE_CONFIRMATION_WORD,
  DELETION_REFUSED_MESSAGE,
  DELETION_UNCONFIGURED_MESSAGE,
  DELETION_UNCONFIRMED_MESSAGE,
  SIGN_OUT_FACTS,
  SIGN_OUT_FAILED_MESSAGE,
  isDeleteConfirmed,
} from '../../../app/account/index';

const noop = (): void => {};

function render(overrides: Partial<Parameters<typeof AccountContent>[0]> = {}): string {
  return renderToStaticMarkup(
    <AccountContent
      session="signed_in"
      step="idle"
      signOutStep="idle"
      signOutError={null}
      typed=""
      errorMessage={null}
      localClosure="pending"
      onSignIn={noop}
      onSignOut={noop}
      onStartConfirmation={noop}
      onCancel={noop}
      onTyped={noop}
      onConfirmDelete={noop}
      onReturnHome={noop}
      {...overrides}
    />,
  );
}

// SIGN OUT — T008 / Issue #45. Until this, the app's only account action was
// deletion: a person who wanted to hand the phone over, or switch accounts, had
// no choice on this screen except the irreversible one.
describe('signing out', () => {
  it('offers sign-out to a signed-in person, above the deletion card', () => {
    const markup = render();

    expect(markup).toContain('>Sign out<');
    expect(markup.indexOf('>Sign out<')).toBeLessThan(markup.indexOf('Delete my account'));
  });

  // The whole visual point: leaving is not being erased. A destructive-looking
  // sign-out teaches people to fear the safe action and stop reading the other.
  it('is not dressed as a destructive control', () => {
    const markup = render();
    // Everything before the deletion card opens.
    const signOutCard = markup.slice(0, markup.indexOf('data-tone="danger"'));

    expect(signOutCard).toContain('data-tone="neutral"');
    expect(signOutCard).toContain('>Sign out<');
    expect(signOutCard).toContain('data-secondary="true"');
    // The deletion card that follows is the one carrying the danger tone.
    expect(markup).toContain('data-tone="danger"');
  });

  it('locks the control while the sign-out is in flight', () => {
    expect(render({ signOutStep: 'signing_out' })).toContain(
      '<button disabled="" data-secondary="true">Signing out…</button>',
    );
  });

  // Two account actions armed at once is how a mis-tap becomes a deleted
  // account. Once DELETE is being typed, this screen offers one thing.
  it('steps aside once the deletion confirmation is armed', () => {
    const markup = render({ step: 'confirming', typed: '' });

    expect(markup).not.toContain('>Sign out<');
    expect(markup).toContain('Permanently delete my account');
  });

  it('is not offered to a signed-out visitor or a closed account', () => {
    expect(render({ session: 'signed_out' })).not.toContain('>Sign out<');
    expect(render({ session: 'closed' })).not.toContain('>Sign out<');
  });

  it('shows the failure without claiming which side of the line the session landed on', () => {
    const markup = render({ signOutError: SIGN_OUT_FAILED_MESSAGE });

    expect(markup).toContain('Signing out did not finish');
    expect(SIGN_OUT_FAILED_MESSAGE).not.toMatch(/you are (still )?signed (in|out)/i);
    expect(SIGN_OUT_FAILED_MESSAGE).toContain('Open this screen again');
  });
});

// §12: sign-out is the one account action where the tempting lie is by
// omission. `eraseAllLocalDrafts` is NOT called here (it belongs to deletion),
// and the root layout DOES purge consent bearer tokens on `SIGNED_OUT` — the
// copy has to match both facts, not the comfortable half of each.
describe('sign-out copy', () => {
  const copy = SIGN_OUT_FACTS.join(' ');

  it('says the pitches saved on this phone are kept', () => {
    expect(copy).toContain('stay where they are');
    expect(copy).not.toMatch(/delete[sd]? (your|the) (pitches|drafts|recordings)/i);
  });

  it('says the account itself is untouched', () => {
    expect(copy).toContain('untouched');
  });

  // A person who signs out mid-consent needs to know why the approval link they
  // sent went quiet, rather than believing the pitch itself broke.
  it('does not hide that the approval links stop working on this device', () => {
    expect(copy).toContain('approval links');
    expect(copy).toContain('stop working on this device');
  });

  it('claims nothing was deleted nowhere and everywhere', () => {
    // "Nothing is deleted" would be false (the consent tokens go), and
    // "everything is deleted" would be false (the drafts stay). Neither
    // absolute may appear.
    expect(copy).not.toMatch(/nothing is deleted|nothing gets deleted/i);
    expect(copy).not.toMatch(/everything is (deleted|erased|removed)/i);
  });
});

describe('account deletion confirmation gate', () => {
  it('arms only on the exact word', () => {
    expect(isDeleteConfirmed(DELETE_CONFIRMATION_WORD)).toBe(true);
    // Keyboards add trailing space; nothing else is forgiven.
    expect(isDeleteConfirmed(' DELETE ')).toBe(true);
    expect(isDeleteConfirmed('delete')).toBe(false);
    expect(isDeleteConfirmed('DELETE MY ACCOUNT')).toBe(false);
    expect(isDeleteConfirmed('')).toBe(false);
  });

  it('does not show the typed confirmation until the first step is taken', () => {
    const markup = render();

    expect(markup).toContain('Delete my account');
    expect(markup).not.toContain('Permanently delete my account');
  });

  // The whole point of the second step: reaching it must not be enough.
  it('keeps the destructive button disabled until the word is typed', () => {
    expect(render({ step: 'confirming', typed: '' })).toContain(
      '<button disabled="">Permanently delete my account</button>',
    );
    expect(render({ step: 'confirming', typed: 'delete' })).toContain(
      '<button disabled="">Permanently delete my account</button>',
    );
    expect(render({ step: 'confirming', typed: 'DELETE' })).toContain(
      '<button>Permanently delete my account</button>',
    );
  });

  it('offers a way back out of the confirmation step', () => {
    expect(render({ step: 'confirming', typed: 'DELETE' })).toContain('Keep my account');
  });

  it('locks the controls while the request is in flight', () => {
    const markup = render({ step: 'deleting', typed: 'DELETE' });

    expect(markup).toContain('<button disabled="">Deleting…</button>');
    expect(markup).toContain('<button disabled="" data-secondary="true">Keep my account</button>');
  });

  it('asks a signed-out visitor to sign in rather than offering deletion', () => {
    const markup = render({ session: 'signed_out' });

    expect(markup).toContain('Sign in to manage your account');
    expect(markup).not.toContain('Delete my account');
  });

  it('confirms the closure without claiming the erasure has finished', () => {
    const markup = render({ step: 'deleted', localClosure: 'done' });

    expect(markup).toContain('Your account is closed.');
    expect(markup).toContain('scheduled job');
  });

  // Re-entry after a request whose answer was lost: the server, not this app,
  // decides whether the account is closed. `session: 'closed'` is that answer.
  it('shows the closed card to a session whose account the server says is deleted', () => {
    const markup = render({ session: 'closed', step: 'idle', localClosure: 'done' });

    expect(markup).toContain('Your account is closed.');
    expect(markup).not.toContain('Delete my account');
  });

  it('does not claim this device is clean when the local cleanup did not finish', () => {
    const markup = render({ step: 'deleted', localClosure: 'partial' });

    expect(markup).toContain('Your account is closed.');
    expect(markup).toContain('could not finish clearing this device');
    expect(markup).toContain('delete the app');
    // The success sentence is a claim about the phone; it must not appear when
    // a recording may still be sitting in the app's document directory.
    expect(markup).not.toContain('the pitches saved here are gone');
    expect(markup).not.toContain('You are signed out on this device');
  });
});

// A failed request has three outcomes and only two of them are determinate.
// The screen may assert "not deleted" for the two it can prove, and must not
// for the one it cannot — `request_account_deletion` can commit with the
// response lost on the way back.
describe('account deletion failure copy', () => {
  it('asserts nothing happened only where the code can prove it', () => {
    // No client at all: the RPC was never issued.
    expect(DELETION_UNCONFIGURED_MESSAGE).toContain('cannot delete anything');
    // The server itself refused with `authentication required`.
    expect(DELETION_REFUSED_MESSAGE).toContain('your account was not deleted');
  });

  it('leaves an unconfirmed round trip unconfirmed', () => {
    expect(DELETION_UNCONFIRMED_MESSAGE).not.toMatch(/nothing was deleted/i);
    expect(DELETION_UNCONFIRMED_MESSAGE).not.toMatch(/was not deleted/i);
    expect(DELETION_UNCONFIRMED_MESSAGE).toContain('could not confirm');
    expect(DELETION_UNCONFIRMED_MESSAGE).toContain('may already be closed');
    // It has to point at the thing that resolves the ambiguity.
    expect(DELETION_UNCONFIRMED_MESSAGE).toContain('Open this screen again');
  });

  it('renders the unconfirmed message on the confirmation step', () => {
    const markup = render({
      step: 'confirming',
      typed: 'DELETE',
      errorMessage: DELETION_UNCONFIRMED_MESSAGE,
    });

    expect(markup).toContain('could not confirm');
    expect(markup).not.toContain('nothing was deleted');
  });
});

// §12: the screen may only describe what the code does. These are the claims a
// reviewer and a user are entitled to, and each maps to a real code path — see
// the doc comment on ACCOUNT_DELETION_FACTS.
describe('account deletion copy', () => {
  const copy = ACCOUNT_DELETION_FACTS.join(' ');

  it('says the account closes now and the erasure happens later', () => {
    expect(copy).toContain('closed the moment you confirm');
    expect(copy).toContain('scheduled job');
  });

  it('promises no time for the erasure', () => {
    // The scheduled pass runs daily, which docs/OPS.md calls a floor and not an
    // SLA. A screen that names hours or days would be making that promise.
    expect(copy).not.toMatch(/\b(hour|hours|day|days|week|weeks|immediately|instantly)\b/i);
  });

  it('says interests are deleted rather than anonymised', () => {
    expect(copy).toContain('deleted, not anonymised');
  });

  it("says a friend's campaign survives but loses the voice and its video", () => {
    expect(copy).toContain('stays with them as their campaign');
    expect(copy).toContain('any video made from it are erased');
    expect(copy).toContain('archived');
  });

  // The job transfers the preserved draft and erases the audio; it does NOT
  // touch `pitch_drafts.headline`, `.body`, `.transcript` or the
  // `consent_revisions` snapshot that froze them (0032). Saying only that the
  // voice goes lets someone believe their words go with it, so the screen names
  // what stays — including the transcript, which is the written form of the
  // very recording being erased.
  it('says the written pitch and the transcript stay on the preserved campaign', () => {
    expect(copy).toContain('the words you wrote');
    expect(copy).toContain('the text transcript of what you said');
    expect(copy).toMatch(/stays on that pitch/i);
  });

  it('says safety reports are kept with the account removed', () => {
    expect(copy).toContain('Safety reports');
    expect(copy).toContain('with your account removed from them');
  });

  it('does not claim already-shared copies can be recalled', () => {
    expect(copy).toContain('cannot be called back');
  });
});
