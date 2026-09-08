import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  colors,
  fonts,
  fontSizes,
  maxControlFontScale,
  radii,
  spacing,
  strokes,
} from '@friendword/ui-tokens';

import { createAuthGateway } from '../../services/authSession';
import { getSupabaseClient } from '../../services/supabaseClient';

/**
 * Why this sheet was opened, which is the only thing that makes its copy true.
 *
 * M-1 (T004, Issue #73): the sheet was written for one caller — the submit step
 * — and then reused by four more. Opened from Account it still said "Sign in to
 * send it", promised "your pitch stays private until your friend approves it",
 * and offered "Verify and send pitch" to somebody who was trying to change
 * their name. The copy is not decoration: the button names the act it performs,
 * and naming the wrong one is how a person learns not to read the buttons.
 */
export type SignInPurpose = 'send-pitch' | 'account' | 'generic';

type SignInCopy = {
  readonly badge: string;
  readonly title: string;
  readonly subtitle: string;
  readonly confirmLabel: string;
};

/**
 * One entry per purpose, and every entry says what the code will actually do
 * next. Only `send-pitch` may promise anything about a pitch, because it is the
 * only one whose caller submits one when this sheet closes.
 */
export const SIGN_IN_COPY: Readonly<Record<SignInPurpose, SignInCopy>> = {
  'send-pitch': {
    badge: 'Almost there',
    title: 'Sign in to send it',
    subtitle:
      'Your pitch stays private until your friend approves it. We just need to know who is hyping.',
    confirmLabel: 'Verify and send pitch',
  },
  account: {
    badge: 'Your account',
    title: 'Sign in to your account',
    subtitle:
      'Your name, your pitches and your account settings are tied to your email. Sign in to manage them.',
    confirmLabel: 'Verify and sign in',
  },
  generic: {
    badge: 'Sign in',
    title: 'Sign in to Friendword',
    subtitle: 'We email you a one-time code — there is no password to remember.',
    confirmLabel: 'Verify and sign in',
  },
};

type SignInSheetProps = {
  readonly visible: boolean;
  /** Required, not defaulted: a wrong-context sheet is exactly the bug M-1 is. */
  readonly purpose: SignInPurpose;
  readonly onClose: () => void;
  readonly onSignedIn: () => void;
};

type Stage = 'email' | 'code';

// Must match the OTP length configured in Supabase Auth (email OTP settings).
const EMAIL_OTP_LENGTH = 8;

/**
 * iOS 26 draws the keyboard as a translucent rounded panel, so whatever sits
 * behind it shows through its corners. Instead of lifting the sheet above the
 * keyboard (which leaves the dark modal backdrop behind it), we grow the
 * sheet's bottom padding by the keyboard height so the sheet's own background
 * extends underneath. Android keeps the window-resize behavior, so it stays 0.
 */
function useIosKeyboardHeight(): number {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    if (Platform.OS !== 'ios') {
      return;
    }
    const show = Keyboard.addListener('keyboardWillShow', (event) => {
      setHeight(event.endCoordinates.height);
    });
    const hide = Keyboard.addListener('keyboardWillHide', () => {
      setHeight(0);
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return height;
}

/**
 * Email OTP sign-in, shown on demand at the moment an act needs an account.
 * Matches the product rule: composing is free, acting requires an account.
 *
 * `purpose` decides what it says. Every caller states why it opened the sheet,
 * because the heading, the promise under it and the confirm button all describe
 * what happens next — and what happens next is the caller's, not the sheet's.
 *
 * T014 (audit MUI-11, MUI-12, MUI-14) rebuilt its surface, not its behaviour:
 *
 * - Every hard-coded number is gone. The sheet used raw `fontSize: 26/17/16/15`
 *   and `borderWidth: 2` while every other surface read them from
 *   `@friendword/ui-tokens`, so it was the one screen a token change could not
 *   reach.
 * - The bold weights actually apply now. `fontFamily: 'BricolageGrotesque'`
 *   with `fontWeight: '700'` does nothing on either platform — a custom family
 *   has one weight per registered name — so the badge, the button and the
 *   headings were rendering regular while claiming bold. The bold faces are
 *   separate families (`BricolageGrotesqueBold`), which is what the rest of the
 *   app already used.
 * - The content scrolls. On a small phone with the keyboard up, the sheet was
 *   taller than what was left of the screen and had no scroll view, so the
 *   "Not now" escape and the error text under the input were simply
 *   unreachable — on the one modal that blocks the pitch from being sent.
 */
export function SignInSheet({ visible, purpose, onClose, onSignedIn }: SignInSheetProps) {
  const [stage, setStage] = useState<Stage>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const keyboardHeight = useIosKeyboardHeight();

  const client = getSupabaseClient();
  const copy = SIGN_IN_COPY[purpose];

  const reset = (): void => {
    setStage('email');
    setCode('');
    setBusy(false);
    setError(null);
  };

  const handleClose = (): void => {
    reset();
    onClose();
  };

  const sendCode = async (): Promise<void> => {
    if (client === null) {
      setError('Server connection is not configured.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await createAuthGateway(client).requestEmailCode(email.trim());
      setStage('code');
    } catch {
      setError('We could not send a code to that email. Double-check it and retry.');
    } finally {
      setBusy(false);
    }
  };

  const confirmCode = async (): Promise<void> => {
    if (client === null) {
      setError('Server connection is not configured.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await createAuthGateway(client).confirmEmailCode(email.trim(), code.trim());
      reset();
      onSignedIn();
    } catch (cause) {
      // TODO(qa): temporary diagnostics while device QA hunts an OTP failure.
      console.warn('[SignInSheet] verifyOtp failed', cause);
      setError('That code did not work. Request a fresh one and try again.');
      setBusy(false);
    }
  };

  const incomplete =
    stage === 'email' ? email.trim() === '' : code.trim().length < EMAIL_OTP_LENGTH;

  return (
    <Modal animationType="slide" transparent visible={visible} onRequestClose={handleClose}>
      <View style={styles.backdrop}>
        <Pressable
          accessibilityLabel="Close sign-in"
          accessibilityRole="button"
          disabled={busy}
          style={styles.backdropDismiss}
          onPress={handleClose}
        />
        <View
          style={[
            styles.sheet,
            keyboardHeight > 0 && { paddingBottom: keyboardHeight + spacing.lg },
          ]}
        >
          {/* MUI-12: the sheet is capped at 88% of the screen and its contents
              scroll, so a small phone with the keyboard up can still reach the
              error text and the "Not now" way out. */}
          <ScrollView
            contentContainerStyle={styles.sheetContent}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.badge}>
              <Text maxFontSizeMultiplier={maxControlFontScale} style={styles.badgeText}>
                {copy.badge}
              </Text>
            </View>
            <Text style={styles.title}>{stage === 'email' ? copy.title : 'Check your inbox'}</Text>
            <Text style={styles.subtitle}>
              {stage === 'email'
                ? copy.subtitle
                : `We emailed a ${EMAIL_OTP_LENGTH}-digit code to ${email.trim()}.`}
            </Text>

            {stage === 'email' ? (
              <TextInput
                accessibilityLabel="Email address"
                autoCapitalize="none"
                autoComplete="email"
                autoFocus
                editable={!busy}
                inputMode="email"
                placeholder="you@example.com"
                placeholderTextColor={colors.textFaint}
                style={styles.input}
                value={email}
                onChangeText={setEmail}
              />
            ) : (
              <TextInput
                accessibilityLabel={`${EMAIL_OTP_LENGTH}-digit code`}
                autoFocus
                editable={!busy}
                inputMode="numeric"
                maxLength={EMAIL_OTP_LENGTH}
                // MUI-14: eight wide-tracked digits are the one field where an
                // unbounded text size runs off the edge instead of wrapping.
                maxFontSizeMultiplier={maxControlFontScale}
                placeholder={'12345678'.slice(0, EMAIL_OTP_LENGTH)}
                placeholderTextColor={colors.textFaint}
                style={[styles.input, styles.codeInput]}
                value={code}
                onChangeText={setCode}
              />
            )}

            {error !== null ? (
              <Text accessibilityLiveRegion="polite" style={styles.error}>
                {error}
              </Text>
            ) : null}

            <Pressable
              accessibilityRole="button"
              disabled={busy || incomplete}
              style={({ pressed }) => [
                styles.primaryButton,
                pressed && !busy && !incomplete && styles.primaryButtonPressed,
                (busy || incomplete) && styles.primaryButtonDisabled,
              ]}
              onPress={() => {
                void (stage === 'email' ? sendCode() : confirmCode());
              }}
            >
              {busy ? (
                <ActivityIndicator color={colors.onPop} />
              ) : (
                <Text maxFontSizeMultiplier={maxControlFontScale} style={styles.primaryButtonText}>
                  {stage === 'email' ? 'Send my code' : copy.confirmLabel}
                </Text>
              )}
            </Pressable>

            {stage === 'code' ? (
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                style={styles.secondaryButton}
                onPress={() => {
                  setStage('email');
                  setCode('');
                  setError(null);
                }}
              >
                <Text style={styles.secondaryAction}>Use a different email</Text>
              </Pressable>
            ) : null}

            <Pressable
              accessibilityRole="button"
              disabled={busy}
              style={styles.secondaryButton}
              onPress={handleClose}
            >
              <Text style={styles.secondaryAction}>Not now</Text>
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(34, 27, 21, 0.55)',
    justifyContent: 'flex-end',
  },
  backdropDismiss: {
    flex: 1,
  },
  sheet: {
    maxHeight: '88%',
    backgroundColor: colors.background,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    borderWidth: strokes.sticker,
    borderBottomWidth: 0,
    borderColor: colors.ink,
  },
  sheetContent: {
    gap: spacing.md,
    padding: spacing.lg,
    paddingBottom: spacing.xl,
  },
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.hype,
    borderColor: colors.ink,
    borderRadius: radii.pill,
    borderWidth: strokes.sticker,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    transform: [{ rotate: '-2deg' }],
  },
  badgeText: {
    color: colors.onHype,
    fontFamily: 'BricolageGrotesqueBold',
    fontSize: fontSizes.sm,
  },
  title: {
    color: colors.ink,
    fontFamily: fonts.display,
    fontSize: fontSizes.xl,
    lineHeight: fontSizes.xl * 1.25,
  },
  subtitle: {
    color: colors.textSecondary,
    fontFamily: fonts.body,
    fontSize: fontSizes.md,
    lineHeight: fontSizes.md * 1.45,
  },
  input: {
    minHeight: 52,
    backgroundColor: colors.surface,
    borderColor: colors.ink,
    borderRadius: radii.md,
    borderWidth: strokes.sticker,
    color: colors.ink,
    fontFamily: fonts.body,
    fontSize: fontSizes.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  codeInput: {
    fontSize: fontSizes.xl,
    letterSpacing: 8,
    textAlign: 'center',
  },
  error: {
    color: colors.danger,
    fontFamily: 'BricolageGrotesqueBold',
    fontSize: fontSizes.sm,
  },
  primaryButton: {
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.pop,
    borderColor: colors.ink,
    borderRadius: radii.md,
    borderWidth: strokes.sticker,
    paddingVertical: spacing.md,
    shadowColor: colors.ink,
    shadowOffset: { width: spacing.xs, height: spacing.xs },
    shadowOpacity: 1,
    shadowRadius: 0,
    elevation: spacing.xs,
  },
  primaryButtonPressed: {
    backgroundColor: colors.popPressed,
    transform: [{ scale: 0.97 }],
  },
  primaryButtonDisabled: {
    opacity: 0.5,
  },
  primaryButtonText: {
    color: colors.onPop,
    fontFamily: 'BricolageGrotesqueBold',
    fontSize: fontSizes.md,
  },
  // 44pt minimum on the two text-only escapes; they were bare Text rows.
  secondaryButton: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryAction: {
    color: colors.textSecondary,
    fontFamily: fonts.body,
    fontSize: fontSizes.md,
    textAlign: 'center',
    textDecorationLine: 'underline',
  },
});
