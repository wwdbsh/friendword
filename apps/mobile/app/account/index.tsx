import { getSession, SafetyRepo, UnauthenticatedError } from '@friendword/data';
import { colors, fonts, fontSizes, radii, spacing, strokes } from '@friendword/ui-tokens';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { HypeButton, SignInPromptCard, TrustCard } from '../../src/components';
import { SignInSheet } from '../../src/features/auth/SignInSheet';
import { pitchDraftService } from '../../src/services/draftServiceInstance';
import { getSupabaseClient } from '../../src/services/supabaseClient';

/** The word the second step requires, typed exactly. */
export const DELETE_CONFIRMATION_WORD = 'DELETE';

/**
 * The second gate. A checkbox is a mis-tap; typing the word is not. Surrounding
 * whitespace is forgiven because iOS keyboards add it, nothing else is —
 * lower-case "delete" does not arm the button.
 */
export function isDeleteConfirmed(typed: string): boolean {
  return typed.trim() === DELETE_CONFIRMATION_WORD;
}

/**
 * What deletion actually does, in the order a person cares about. Every line is
 * a claim the code keeps — see docs/PRIVACY_DATA_MAP.md for the table this is
 * the plain-language version of:
 *
 * - "closed the moment you confirm": `request_account_deletion` (0037) flips
 *   `account_status` to 'deleted' in the same transaction, and every guarded
 *   RPC refuses a non-active account from then on.
 * - "erased later, on a schedule": the physical erasure is
 *   `scripts/process-deletions.mjs`, run by the daily scheduled-ops pass. No
 *   time is promised here because none is guaranteed — docs/OPS.md is explicit
 *   that daily is a floor, not an SLA.
 * - "interests are deleted, not anonymised": the job runs
 *   `DELETE FROM interests WHERE sender_user_id = …`, and the intro rooms the
 *   account is in go with it, taking both sides' messages.
 * - "a pitch you recorded for a friend stays with them": the draft is
 *   transferred to the campaign owner, but the voice — and the rendered video
 *   that copies the same audio — is erased, and 0037 archives the campaign
 *   that just lost it.
 * - "the words you wrote and the text transcript": `pitch_drafts.headline`,
 *   `.body` and `.transcript`, plus the `consent_revisions` snapshot, are kept
 *   deliberately (the approval record is an audit object, and 0032 froze the
 *   transcript into the revision the dater approved). Saying only that the
 *   voice goes would let someone believe their words go with it.
 * - "safety reports are kept": the job nulls the user references and marks the
 *   report anonymous rather than deleting it.
 */
export const ACCOUNT_DELETION_FACTS: readonly string[] = [
  'Your account is closed the moment you confirm. It stops working right away.',
  'Erasing the data itself happens afterwards, on a scheduled job. We will not promise you a time for it.',
  'Erased: your profile and photos, your voice recordings, the pitches you made, the interests you sent, and your chats.',
  'Interests you sent are deleted, not anonymised. They disappear from the inbox of the person you sent them to, and any chat you opened with them goes too — for both of you.',
  'A pitch you recorded for a friend stays with them as their campaign, but your voice recording and any video made from it are erased, so that campaign is archived and stops being public.',
  'What stays on that pitch is the written part your friend approved, including the words you wrote and the text transcript of what you said. It is their record of what they agreed to publish.',
  'Safety reports about or from you are kept for our moderation record, with your account removed from them.',
  'Anything already shared or downloaded by other people cannot be called back.',
  'This cannot be undone.',
];

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
  readonly typed: string;
  readonly errorMessage: string | null;
  readonly localClosure: LocalClosureOutcome;
  readonly onSignIn: () => void;
  readonly onStartConfirmation: () => void;
  readonly onCancel: () => void;
  readonly onTyped: (value: string) => void;
  readonly onConfirmDelete: () => void;
  readonly onReturnHome: () => void;
};

export function AccountContent({
  session,
  step,
  typed,
  errorMessage,
  localClosure,
  onSignIn,
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
    return <Text style={styles.message}>Checking your account…</Text>;
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
          <Text style={styles.confirmationLabel}>Type {DELETE_CONFIRMATION_WORD} to confirm.</Text>
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
        <View style={styles.heading}>
          <Text style={styles.eyebrow}>ACCOUNT</Text>
          <Text style={styles.title}>Your account</Text>
        </View>
        <AccountContent
          session={session}
          step={step}
          typed={typed}
          errorMessage={errorMessage}
          localClosure={localClosure}
          onSignIn={() => setSignInVisible(true)}
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
  heading: { gap: spacing.sm },
  eyebrow: {
    color: colors.pop,
    fontFamily: 'BricolageGrotesqueBold',
    fontSize: fontSizes.xs,
    letterSpacing: 1,
  },
  title: { color: colors.ink, fontFamily: fonts.display, fontSize: fontSizes.xl, lineHeight: 32 },
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
