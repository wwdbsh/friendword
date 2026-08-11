import {
  ACCOUNT_DELETION_CONFIRMATION_WORD,
  ACCOUNT_DELETION_FACTS,
  accountDeletionConfirmationMatches,
} from '@friendword/contracts';
import { getSession, SafetyRepo, UnauthenticatedError } from '@friendword/data';
import { colors, fonts, fontSizes, radii, spacing, strokes } from '@friendword/ui-tokens';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  HypeButton,
  PendingCard,
  ScreenHeading,
  SignInPromptCard,
  TrustCard,
} from '../../src/components';
import { SignInSheet } from '../../src/features/auth/SignInSheet';
import { pitchDraftService } from '../../src/services/draftServiceInstance';
import { getSupabaseClient } from '../../src/services/supabaseClient';

/**
 * The confirmation word and the deletion facts are the SAME copy the web
 * prints, and they now live in one place — `@friendword/contracts`
 * (`accountDeletionCopy.ts`). T013 left the two lists as deliberate twins and
 * named this promotion as T014's job; two nine-line promises about somebody's
 * data drift the first time one of them is edited alone.
 *
 * Re-exported under this screen's original names because they are what the
 * screen and its tests call the thing, and because the export identity — not a
 * string comparison — is what `accountIndex.test.tsx` pins to the shared array.
 */
export const DELETE_CONFIRMATION_WORD = ACCOUNT_DELETION_CONFIRMATION_WORD;
export const isDeleteConfirmed = accountDeletionConfirmationMatches;
export { ACCOUNT_DELETION_FACTS };

/**
 * What signing out does, and — the part people get wrong — what it does not.
 *
 * Sign-out is not a small deletion. It ends the session and nothing else:
 *
 * - "The pitches saved on this phone stay": deliberate. `eraseAllLocalDrafts`
 *   belongs to account deletion; sign-out never calls it, because the same
 *   person signing back in expects their unfinished pitch to still be there
 *   (see the contract note on `PitchDraftService.eraseAllLocalDrafts`).
 * - "the approval links … stop working on this device": `_layout` purges every
 *   draft's raw consent bearer token on `SIGNED_OUT`
 *   (`shouldPurgeConsentTokensOnAuthChange`). That token opens a dater's
 *   private approval flow for whoever holds it, so it must not survive on a
 *   signed-out phone. Saying "nothing is deleted" would therefore be false, and
 *   a person who signs out mid-consent needs to know why the link went quiet.
 * - Nothing is said about the server: sign-out touches this device only.
 */
export const SIGN_OUT_FACTS: readonly string[] = [
  'Signing out ends your session on this phone. Your account, your campaigns, and your chats are untouched.',
  'The pitches saved on this phone stay where they are, ready for when you sign back in.',
  'The approval links you have already sent stop working on this device — sign back in to open them again.',
];

export const SIGN_OUT_UNCONFIGURED_MESSAGE =
  'This build is not connected to Friendword, so there is no session to end.';
/**
 * §12: `signOut` clears the stored session before it talks to the server, so a
 * failure leaves a state this screen has not verified. It says what failed and
 * where to look, and claims nothing about which side of the line the session
 * landed on.
 */
export const SIGN_OUT_FAILED_MESSAGE =
  'Signing out did not finish. Open this screen again to see where your session stands.';

export type AccountSignOutStep = 'idle' | 'signing_out';

export type SignOutOutcome = 'signed_out' | 'unconfigured' | 'failed';

/** All sign-out needs from the client — narrow on purpose, see {@link endSession}. */
type SignOutClient = { readonly auth: { signOut(): Promise<{ readonly error: unknown }> } };

/**
 * Ending the session, and ONLY the session (T008, Issue #45).
 *
 * Split out of the screen because the local half of sign-out is defined by what
 * it does NOT do, and "does not do" is only testable if there is something to
 * call. It takes an auth client and nothing else: it cannot reach
 * `pitchDraftService`, so it cannot erase a draft. That separation is the
 * difference between this and account deletion, which erases every local draft
 * and its media through `closeLocally`.
 *
 * The consent bearer tokens ARE cleared, but not from here: the root layout
 * purges them off the `SIGNED_OUT` event for every sign-out in the app.
 */
export async function endSession(client: SignOutClient | null): Promise<SignOutOutcome> {
  if (client === null) {
    return 'unconfigured';
  }
  return client.auth
    .signOut()
    .then(({ error }): SignOutOutcome => (error === null ? 'signed_out' : 'failed'))
    .catch((): SignOutOutcome => 'failed');
}

export type AccountDeletionStep = 'idle' | 'confirming' | 'deleting' | 'deleted';

/**
 * `closed` is the re-entry case: the server says this account is already
 * `deleted`, whatever this app previously believed about the request.
 */
export type AccountSessionState = 'loading' | 'signed_in' | 'signed_out' | 'closed';

/**
 * Whether this device is actually clean.
 *
 * - `pending`: closing the account has not been attempted from this screen.
 * - `done`: the local drafts, their media files and the session are all gone.
 * - `partial`: the account is closed but at least one of those did not finish.
 *   The card has to say so — telling someone "the pitches saved here are gone"
 *   while a voice recording sits in the app's document directory is the one
 *   claim on this screen that would be a lie about their data.
 */
export type LocalClosureOutcome = 'pending' | 'done' | 'partial';

type AccountContentProps = {
  readonly session: AccountSessionState;
  readonly step: AccountDeletionStep;
  readonly signOutStep: AccountSignOutStep;
  readonly signOutError: string | null;
  readonly typed: string;
  readonly errorMessage: string | null;
  readonly localClosure: LocalClosureOutcome;
  readonly onSignIn: () => void;
  readonly onSignOut: () => void;
  readonly onStartConfirmation: () => void;
  readonly onCancel: () => void;
  readonly onTyped: (value: string) => void;
  readonly onConfirmDelete: () => void;
  readonly onReturnHome: () => void;
};

export function AccountContent({
  session,
  step,
  signOutStep,
  signOutError,
  typed,
  errorMessage,
  localClosure,
  onSignIn,
  onSignOut,
  onStartConfirmation,
  onCancel,
  onTyped,
  onConfirmDelete,
  onReturnHome,
}: AccountContentProps) {
  if (step === 'deleted' || session === 'closed') {
    return (
      <TrustCard tone={localClosure === 'partial' ? 'danger' : 'success'}>
        <Text style={styles.cardTitle}>Your account is closed.</Text>
        <Text style={styles.message}>
          The rest of your data is erased by our scheduled job; it cannot be recovered.
        </Text>
        {localClosure === 'partial' ? (
          <Text style={styles.message}>
            We could not finish clearing this device. Some pitches or recordings saved here may
            still be on this phone — delete the app to remove them.
          </Text>
        ) : (
          <Text style={styles.message}>
            You are signed out on this device and the pitches saved here are gone.
          </Text>
        )}
        <HypeButton label="Back to the start" onPress={onReturnHome} variant="trust" />
      </TrustCard>
    );
  }

  if (session === 'loading') {
    return <PendingCard label="Checking your account…" />;
  }

  if (session === 'signed_out') {
    return (
      <SignInPromptCard
        title="Sign in to manage your account"
        message="Deleting an account only ever affects the account that asks for it, so we need to know who you are."
        onSignIn={onSignIn}
      />
    );
  }

  return (
    <>
      {/* T008 (Issue #45): leaving and being erased are different acts, so they
          are different cards. This one is `neutral` and its button is
          `secondary` — nothing here is destructive, and dressing it in the
          danger tone next to a real deletion would teach people to fear the
          safe one and stop reading the other. It is also FIRST: it is the thing
          almost everyone who opens this screen actually wants. Hidden once the
          deletion confirmation is armed, so the screen never offers two
          competing account actions at the same time. */}
      {step === 'idle' && (
        <TrustCard>
          <Text style={styles.cardTitle}>Sign out</Text>
          {SIGN_OUT_FACTS.map((fact) => (
            <Text key={fact} style={styles.message}>
              {fact}
            </Text>
          ))}
          <HypeButton
            label={signOutStep === 'signing_out' ? 'Signing out…' : 'Sign out'}
            disabled={signOutStep === 'signing_out'}
            onPress={onSignOut}
            secondary
            variant="trust"
          />
          {signOutError === null ? null : <Text style={styles.error}>{signOutError}</Text>}
        </TrustCard>
      )}
      <TrustCard tone="danger">
        <Text style={styles.cardTitle}>Delete your account</Text>
        {ACCOUNT_DELETION_FACTS.map((fact) => (
          <Text key={fact} style={styles.message}>
            {fact}
          </Text>
        ))}
        {step === 'idle' ? (
          <HypeButton label="Delete my account" onPress={onStartConfirmation} variant="trust" />
        ) : (
          <View style={styles.confirmation}>
            <Text style={styles.confirmationLabel}>
              Type {DELETE_CONFIRMATION_WORD} to confirm.
            </Text>
            <TextInput
              accessibilityLabel={`Type ${DELETE_CONFIRMATION_WORD} to confirm`}
              autoCapitalize="characters"
              autoCorrect={false}
              editable={step === 'confirming'}
              onChangeText={onTyped}
              placeholder={DELETE_CONFIRMATION_WORD}
              placeholderTextColor={colors.textFaint}
              style={styles.input}
              value={typed}
            />
            <HypeButton
              label={step === 'deleting' ? 'Deleting…' : 'Permanently delete my account'}
              disabled={step === 'deleting' || !isDeleteConfirmed(typed)}
              onPress={onConfirmDelete}
              variant="trust"
            />
            <HypeButton
              label="Keep my account"
              disabled={step === 'deleting'}
              onPress={onCancel}
              secondary
              variant="trust"
            />
          </View>
        )}
        {errorMessage === null ? null : <Text style={styles.error}>{errorMessage}</Text>}
      </TrustCard>
    </>
  );
}

/**
 * What the screen says when the request did not come back cleanly.
 *
 * Only two of these three outcomes are determinate. A build with no Supabase
 * configuration never reached the server, and `authentication required` is the
 * server itself refusing — in both cases the account is provably untouched. A
 * dropped or failed round trip is NOT: `request_account_deletion` may well have
 * committed with the response lost on the way back, and this screen used to
 * assert "nothing was deleted" for it anyway. It now says what it knows, and
 * re-entry resolves the ambiguity by reading `account_status` from the server.
 */
export const DELETION_UNCONFIGURED_MESSAGE =
  'This build is not connected to Friendword, so it cannot delete anything.';
export const DELETION_REFUSED_MESSAGE =
  'Friendword refused the request because your session is no longer valid, so your account was not deleted. Sign in and try again.';
export const DELETION_UNCONFIRMED_MESSAGE =
  'We could not confirm whether that went through. Your account may already be closed. Open this screen again to see where it stands, and only try again if it still offers to delete.';

export default function AccountScreen() {
  const router = useRouter();
  const client = getSupabaseClient();
  const [session, setSession] = useState<AccountSessionState>('loading');
  const [step, setStep] = useState<AccountDeletionStep>('idle');
  const [typed, setTyped] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [localClosure, setLocalClosure] = useState<LocalClosureOutcome>('pending');
  const [signInVisible, setSignInVisible] = useState(false);
  const [signOutStep, setSignOutStep] = useState<AccountSignOutStep>('idle');
  const [signOutError, setSignOutError] = useState<string | null>(null);

  /**
   * Clears this device and ends the session, and reports whether both finished.
   *
   * Runs for a deletion this screen performed and for one it discovers on
   * re-entry: either way the account is closed and the local copies are the
   * ones nobody can reach to erase later.
   */
  const closeLocally = useCallback(async (): Promise<void> => {
    const erasure = await pitchDraftService
      .eraseAllLocalDrafts()
      .then((result) => result.complete)
      .catch(() => false);
    const signedOut =
      client === null
        ? true
        : await client.auth
            .signOut()
            .then(({ error }) => error === null)
            .catch(() => false);
    setLocalClosure(erasure && signedOut ? 'done' : 'partial');
  }, [client]);

  const readSession = useCallback(() => {
    if (client === null) {
      setSession('signed_out');
      return;
    }
    let active = true;
    void getSession(client)
      .then(async (current) => {
        if (current === null) {
          return 'signed_out' as const;
        }
        // A closed account still has a valid session until the scheduled job
        // deletes the auth user, so the session alone cannot answer this.
        const status = await new SafetyRepo(client)
          .readAccountStatus(current.user.id)
          .catch(() => null);
        return status === 'deleted' ? ('closed' as const) : ('signed_in' as const);
      })
      .then(async (next) => {
        if (!active) return;
        setSession(next);
        if (next === 'closed') {
          await closeLocally();
        }
      })
      .catch(() => {
        if (active) {
          setSession('signed_out');
        }
      });
    return () => {
      active = false;
    };
  }, [client, closeLocally]);

  useFocusEffect(readSession);

  /** Runs {@link endSession} and turns its outcome into what the screen shows. */
  async function signOut(): Promise<void> {
    if (client === null) {
      setSignOutError(SIGN_OUT_UNCONFIGURED_MESSAGE);
      return;
    }
    setSignOutStep('signing_out');
    setSignOutError(null);
    const outcome = await endSession(client);
    setSignOutStep('idle');
    if (outcome !== 'signed_out') {
      setSignOutError(
        outcome === 'unconfigured' ? SIGN_OUT_UNCONFIGURED_MESSAGE : SIGN_OUT_FAILED_MESSAGE,
      );
      return;
    }
    setSession('signed_out');
    router.replace('/');
  }

  async function deleteAccount(): Promise<void> {
    if (client === null) {
      setErrorMessage(DELETION_UNCONFIGURED_MESSAGE);
      return;
    }
    setStep('deleting');
    setErrorMessage(null);
    try {
      await new SafetyRepo(client).requestAccountDeletion();
    } catch (error: unknown) {
      setStep('confirming');
      setErrorMessage(
        error instanceof UnauthenticatedError
          ? DELETION_REFUSED_MESSAGE
          : DELETION_UNCONFIRMED_MESSAGE,
      );
      return;
    }
    // The request succeeded; from here the account is already closed server
    // side, so local cleanup failures must not be reported as a failed
    // deletion. They are, however, the last chance to get this device's copies
    // of the recordings and photos off the phone — and if that does not finish,
    // the card says so.
    await closeLocally();
    setTyped('');
    setStep('deleted');
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <ScreenHeading eyebrow="ACCOUNT" title="Your account" />
        <AccountContent
          session={session}
          step={step}
          signOutStep={signOutStep}
          signOutError={signOutError}
          typed={typed}
          errorMessage={errorMessage}
          localClosure={localClosure}
          onSignIn={() => setSignInVisible(true)}
          onSignOut={() => {
            void signOut();
          }}
          onStartConfirmation={() => {
            setErrorMessage(null);
            setStep('confirming');
          }}
          onCancel={() => {
            setTyped('');
            setErrorMessage(null);
            setStep('idle');
          }}
          onTyped={setTyped}
          onConfirmDelete={() => {
            void deleteAccount();
          }}
          onReturnHome={() => router.replace('/')}
        />
      </ScrollView>
      <SignInSheet
        visible={signInVisible}
        onClose={() => setSignInVisible(false)}
        onSignedIn={() => setSignInVisible(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  content: { gap: spacing.lg, padding: spacing.lg, paddingBottom: spacing.xxl },
  cardTitle: { color: colors.ink, fontFamily: 'BricolageGrotesqueBold', fontSize: fontSizes.lg },
  message: {
    color: colors.textSecondary,
    fontFamily: fonts.body,
    fontSize: fontSizes.md,
    lineHeight: 24,
  },
  confirmation: { gap: spacing.sm },
  confirmationLabel: {
    color: colors.ink,
    fontFamily: 'BricolageGrotesqueBold',
    fontSize: fontSizes.md,
  },
  input: {
    minHeight: 52,
    borderColor: colors.ink,
    borderRadius: radii.sm,
    borderWidth: strokes.trust,
    backgroundColor: colors.background,
    color: colors.ink,
    fontFamily: 'BricolageGrotesqueSemiBold',
    fontSize: fontSizes.md,
    paddingHorizontal: spacing.md,
  },
  error: { color: colors.danger, fontFamily: 'BricolageGrotesqueBold', fontSize: fontSizes.md },
});
