import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { colors, fonts, radii, spacing } from '@friendword/ui-tokens';

import { createAuthGateway } from '../../services/authSession';
import { getSupabaseClient } from '../../services/supabaseClient';

type SignInSheetProps = {
  readonly visible: boolean;
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
 * Email OTP sign-in, shown on demand right before a pitch is submitted.
 * Matches the product rule: composing is free, acting requires an account.
 */
export function SignInSheet({ visible, onClose, onSignedIn }: SignInSheetProps) {
  const [stage, setStage] = useState<Stage>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const keyboardHeight = useIosKeyboardHeight();

  const client = getSupabaseClient();

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
          <View style={styles.badge}>
            <Text style={styles.badgeText}>Almost there</Text>
          </View>
          <Text style={styles.title}>
            {stage === 'email' ? 'Sign in to send it' : 'Check your inbox'}
          </Text>
          <Text style={styles.subtitle}>
            {stage === 'email'
              ? 'Your pitch stays private until your friend approves it. We just need to know who is hyping.'
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
              placeholder={'12345678'.slice(0, EMAIL_OTP_LENGTH)}
              placeholderTextColor={colors.textFaint}
              style={[styles.input, styles.codeInput]}
              value={code}
              onChangeText={setCode}
            />
          )}

          {error !== null ? <Text style={styles.error}>{error}</Text> : null}

          <Pressable
            accessibilityRole="button"
            disabled={
              busy ||
              (stage === 'email' ? email.trim() === '' : code.trim().length < EMAIL_OTP_LENGTH)
            }
            style={({ pressed }) => [
              styles.primaryButton,
              pressed && styles.primaryButtonPressed,
              (busy ||
                (stage === 'email'
                  ? email.trim() === ''
                  : code.trim().length < EMAIL_OTP_LENGTH)) &&
                styles.primaryButtonDisabled,
            ]}
            onPress={() => {
              void (stage === 'email' ? sendCode() : confirmCode());
            }}
          >
            {busy ? (
              <ActivityIndicator color={colors.onPop} />
            ) : (
              <Text style={styles.primaryButtonText}>
                {stage === 'email' ? 'Send my code' : 'Verify and send pitch'}
              </Text>
            )}
          </Pressable>

          {stage === 'code' ? (
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={() => {
                setStage('email');
                setCode('');
                setError(null);
              }}
            >
              <Text style={styles.secondaryAction}>Use a different email</Text>
            </Pressable>
          ) : null}

          <Pressable accessibilityRole="button" disabled={busy} onPress={handleClose}>
            <Text style={styles.secondaryAction}>Not now</Text>
          </Pressable>
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
    backgroundColor: colors.background,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    borderWidth: 2,
    borderBottomWidth: 0,
    borderColor: colors.ink,
    padding: spacing.lg,
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.hype,
    borderColor: colors.ink,
    borderRadius: radii.pill,
    borderWidth: 2,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    transform: [{ rotate: '-2deg' }],
  },
  badgeText: {
    color: colors.onHype,
    fontFamily: fonts.body,
    fontSize: 13,
    fontWeight: '700',
  },
  title: {
    color: colors.ink,
    fontFamily: fonts.display,
    fontSize: 26,
  },
  subtitle: {
    color: colors.textSecondary,
    fontFamily: fonts.body,
    fontSize: 16,
    lineHeight: 23,
  },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.ink,
    borderRadius: radii.md,
    borderWidth: 2,
    color: colors.ink,
    fontFamily: fonts.body,
    fontSize: 17,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  codeInput: {
    fontSize: 24,
    letterSpacing: 8,
    textAlign: 'center',
  },
  error: {
    color: colors.danger,
    fontFamily: fonts.body,
    fontSize: 14,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: colors.pop,
    borderColor: colors.ink,
    borderRadius: radii.md,
    borderWidth: 2,
    paddingVertical: spacing.md,
    shadowColor: colors.ink,
    shadowOffset: { width: 3, height: 3 },
    shadowOpacity: 1,
    shadowRadius: 0,
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
    fontFamily: fonts.body,
    fontSize: 17,
    fontWeight: '700',
  },
  secondaryAction: {
    color: colors.textSecondary,
    fontFamily: fonts.body,
    fontSize: 15,
    textAlign: 'center',
    textDecorationLine: 'underline',
  },
});
